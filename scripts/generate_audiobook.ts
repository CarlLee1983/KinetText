import * as fs from 'fs/promises'
import * as path from 'path'
import pLimit from 'p-limit'
import { MicrosoftEdgeTTSProvider } from '../src/tts/MicrosoftEdgeTTSProvider'
import { listChapterTxtFiles, resolveBookDirectories } from '../src/workflows/chapterFiles'
import { formatCliError, parseCommonCliFlags } from '../src/cli/common'

async function main() {
    const { help, dryRun, positional } = parseCommonCliFlags(process.argv.slice(2))
    const bookTitle = positional[0]
    const selectionArg = positional[1] // Optional limit or range/list (e.g., "5", "10-20", "2,4,10")
    const rateArg = positional[2] || '+0%' // Optional rate (e.g., '+20%', '-10%', '1.5')
    const volArg = positional[3] || '+0%'  // Optional volume (e.g., '+50%', '-20%')
    const concurrencyArg = positional[4] || '3' // Optional concurrency (default to 3)
    const shouldMerge = positional[5] === 'true' // Optional merge flag (default to false)

    if (help) {
        console.log('Usage: bun run audiobook <BookTitle> [Selection] [Rate] [Volume] [Concurrency] [Merge] [--dry-run]')
        console.log('Options:')
        console.log('  --help, -h     Show help')
        console.log('  --dry-run      Show selected chapters and outputs without TTS/merge')
        process.exit(0)
    }

    if (!bookTitle) {
        console.log('Usage: bun run scripts/generate_audiobook.ts <BookTitle> [Selection] [Rate] [Volume] [Concurrency] [Merge]')
        console.log('Examples:')
        console.log('  bun run scripts/generate_audiobook.ts "Book" 5              # First 5 chapters')
        console.log('  bun run scripts/generate_audiobook.ts "Book" 10-20          # Chapters 10 to 20')
        console.log('  bun run scripts/generate_audiobook.ts "Book" 2,4,10         # Chapters 2, 4, 10')
        console.log('  bun run scripts/generate_audiobook.ts "Book" all +20% +0% 5 # All chapters, 1.2x speed, default vol, 5 concurrent')
        console.log('  bun run scripts/generate_audiobook.ts "Book" 1-100 +0% +50% 3 true # Chaps 1-100, normal speed, +50% vol, merge in end')
        process.exit(1)
    }

    const concurrency = parseInt(concurrencyArg) || 3
    const outputRoot = path.join(import.meta.dir, '..', 'output')
    let outputDir = ''
    let audioDir = ''
    let txtSourceDir = ''

    try {
        const dirs = await resolveBookDirectories(outputRoot, bookTitle)
        outputDir = dirs.bookDir
        audioDir = dirs.audioDir
        txtSourceDir = dirs.txtSourceDir
    } catch {
        console.error(`Error: Book directory not found at ${path.join(outputRoot, bookTitle)}`)
        process.exit(1)
    }

    await fs.mkdir(audioDir, { recursive: true })
    let txtFiles = await listChapterTxtFiles(txtSourceDir)

    if (txtFiles.length === 0) {
        console.log(`No chapter text files found in ${txtSourceDir}`)
        return
    }

    // Handle selection
    const selectedIndices = new Set<number>()
    if (selectionArg && selectionArg !== 'all') {
        if (selectionArg.includes(',')) {
            // List: 2,4,10
            selectionArg.split(',').forEach(s => {
                const num = parseInt(s.trim())
                if (!isNaN(num)) selectedIndices.add(num)
            })
        } else if (selectionArg.includes('-')) {
            // Range: 10-20
            const [start, end] = selectionArg.split('-').map(s => parseInt(s.trim()))
            if (!isNaN(start || 0) && !isNaN(end || 0)) {
                for (let i = start || 0; i <= (end || 0); i++) selectedIndices.add(i)
            }
        } else {
            // Single number: interpret as limit
            const limit = parseInt(selectionArg)
            if (!isNaN(limit)) {
                txtFiles = txtFiles.slice(0, limit)
            }
        }

        if (selectedIndices.size > 0) {
            txtFiles = txtFiles.filter(filename => {
                const match = filename.match(/^(\d+)/)
                if (match) {
                    const idx = parseInt(match[1] || '0')
                    return selectedIndices.has(idx)
                }
                return false
            })
        }
    }

    if (txtFiles.length === 0) {
        console.log('No chapters matched the selection.')
        return
    }

    if (dryRun) {
        console.log(`[Dry-run] Book: ${bookTitle}`)
        console.log(`[Dry-run] Chapters selected: ${txtFiles.length}`)
        console.log(`[Dry-run] Output directory: ${audioDir}`)
        console.log(`[Dry-run] Merge: ${shouldMerge ? 'enabled' : 'disabled'}`)
        console.log(`[Dry-run] Sample files: ${txtFiles.slice(0, 10).join(', ')}`)
        return
    }

    console.log(`Processing ${txtFiles.length} chapters. Concurrency: ${concurrency}, Rate: ${rateArg}, Volume: ${volArg}`)

    const ttsProvider = new MicrosoftEdgeTTSProvider('zh-CN-YunxiNeural', rateArg, volArg)
    const limit = pLimit(concurrency)
    let completedCount = 0

    const promises = txtFiles.map(filename => limit(async () => {
        const inputPath = path.join(txtSourceDir, filename)
        const outputFilename = filename.replace('.txt', '.mp3')
        const outputPath = path.join(audioDir, outputFilename)

        try {
            try {
                const stats = await fs.stat(outputPath)
                if (stats.size > 0) {
                    completedCount++
                    return
                }
            } catch { }

            console.log(`[Generating] ${outputFilename}...`)
            await ttsProvider.generateAudioFromFile(inputPath, outputPath)
            completedCount++
            console.log(`[Success] ${outputFilename} (${completedCount}/${txtFiles.length})`)
        } catch (error) {
            console.error(`[Error] Failed to generate ${outputFilename}:`, error)
        }
    }))

    await Promise.all(promises)

    if (shouldMerge) {
        // Selection name for filename (e.g. "1-100" or "all")
        const selectionName = (selectionArg && selectionArg !== 'all') ? `_${selectionArg}` : '';
        const finalOutputPath = path.join(outputDir, `${bookTitle}${selectionName}.mp3`);

        console.log(`\nAll selected chapters processed. Merging into: ${path.basename(finalOutputPath)}`)

        try {
            // We only merge the files that were part of the current selection
            const audioFilesToMerge = txtFiles.map(f => f.replace('.txt', '.mp3'))
                .filter(f => fs.access(path.join(audioDir, f)).then(() => true).catch(() => false));

            if (audioFilesToMerge.length > 0) {
                const buffers: Buffer[] = []

                console.log(`[Merging] ${audioFilesToMerge.length} files...`)
                for (const file of audioFilesToMerge) {
                    try {
                        const buf = await fs.readFile(path.join(audioDir, file))
                        buffers.push(buf)
                    } catch (e) {
                        console.warn(`[Warning] Could not read ${file} for merging, skipping.`)
                    }
                }

                if (buffers.length > 0) {
                    await fs.writeFile(finalOutputPath, Buffer.concat(buffers))
                    console.log(`[Combined] Created final audiobook: ${finalOutputPath}`)
                }
            }
        } catch (err) {
            console.error('[Error] Failed to merge audio files:', err)
        }
    } else {
        console.log('\nSkipping merge step (use "true" as 6th argument to merge).')
    }

    console.log(`\nAudiobook generation complete for "${bookTitle}"!`)
}

main().catch((error) => {
    console.error(`[Error] ${formatCliError(error)}`)
    process.exit(1)
})
