import * as fs from 'fs/promises'
import * as path from 'path'
import pLimit from 'p-limit'
import { MicrosoftEdgeTTSProvider } from '../src/tts/MicrosoftEdgeTTSProvider'
import {
    chapterFileToMp3,
    listChapterTextFiles,
    resolveBookDirectories,
    resolveLocalAudiobookPaths,
} from '../src/workflows/chapterFiles'
import { resolveExistingPathWithOutputFallback } from '../src/workflows/pathUtils'
import { formatCliError, parseCommonCliFlags } from '../src/cli/common'

function parseAudiobookCliArgs(argv: string[]) {
    let input: string | undefined
    let output: string | undefined
    const remaining: string[] = []

    for (const arg of argv) {
        if (arg.startsWith('--input=')) {
            input = arg.slice('--input='.length)
            continue
        }
        if (arg.startsWith('--output=')) {
            output = arg.slice('--output='.length)
            continue
        }
        remaining.push(arg)
    }

    const common = parseCommonCliFlags(remaining)
    return { input, output, ...common }
}

function applyChapterSelection(txtFiles: string[], selectionArg?: string): string[] {
    if (!selectionArg || selectionArg === 'all') return txtFiles

    const selectedIndices = new Set<number>()
    if (selectionArg.includes(',')) {
        selectionArg.split(',').forEach((s) => {
            const num = parseInt(s.trim(), 10)
            if (!isNaN(num)) selectedIndices.add(num)
        })
    } else if (selectionArg.includes('-')) {
        const [start, end] = selectionArg.split('-').map((s) => parseInt(s.trim(), 10))
        if (!isNaN(start) && !isNaN(end)) {
            for (let i = start; i <= end; i++) selectedIndices.add(i)
        }
    } else {
        const limit = parseInt(selectionArg, 10)
        if (!isNaN(limit)) return txtFiles.slice(0, limit)
    }

    if (selectedIndices.size === 0) return txtFiles

    return txtFiles.filter((filename) => {
        const match = filename.match(/^(\d+)/)
        if (!match) return false
        return selectedIndices.has(parseInt(match[1], 10))
    })
}

async function main() {
    const { input: inputFlag, output: outputFlag, help, dryRun, positional } = parseAudiobookCliArgs(Bun.argv.slice(2))

    const bookTitle = inputFlag ? undefined : positional[0]
    const selectionBase = inputFlag ? 0 : 1
    const selectionArg = positional[selectionBase]
    const rateArg = positional[selectionBase + 1] || '+0%'
    const volArg = positional[selectionBase + 2] || '+0%'
    const concurrencyArg = positional[selectionBase + 3] || '3'
    const shouldMerge = positional[selectionBase + 4] === 'true'

    if (help) {
        console.log('Usage:')
        console.log('  bun run audiobook <BookTitle> [Selection] [Rate] [Volume] [Concurrency] [Merge]')
        console.log('  bun run audiobook --input=/path/to/chapters [--output=/path/to/mp3] [Selection] ...')
        console.log('')
        console.log('Options:')
        console.log('  --input        Local chapter directory (.txt / .md)')
        console.log('  --output       MP3 output directory (default: sibling ../audio)')
        console.log('  --help, -h     Show help')
        console.log('  --dry-run      Show selected chapters without TTS')
        process.exit(0)
    }

    const concurrency = parseInt(concurrencyArg, 10) || 3
    const outputRoot = path.join(import.meta.dir, '..', 'output')

    let label = bookTitle ?? ''
    let outputDir = ''
    let audioDir = ''
    let txtSourceDir = ''

    if (inputFlag) {
        try {
            txtSourceDir = resolveExistingPathWithOutputFallback(inputFlag)
        } catch {
            console.error(`Error: Input directory not found: ${inputFlag}`)
            process.exit(1)
        }
        const resolvedOutput = outputFlag ? path.resolve(outputFlag) : undefined
        const paths = await resolveLocalAudiobookPaths(txtSourceDir, resolvedOutput)
        txtSourceDir = paths.txtSourceDir
        audioDir = paths.audioDir
        outputDir = path.dirname(audioDir)
        label = path.basename(txtSourceDir)
    } else {
        if (!bookTitle) {
            console.log('Usage: bun run audiobook <BookTitle> ... OR bun run audiobook --input=/path/to/chapters')
            process.exit(1)
        }
        try {
            const dirs = await resolveBookDirectories(outputRoot, bookTitle)
            outputDir = dirs.bookDir
            audioDir = dirs.audioDir
            txtSourceDir = dirs.txtSourceDir
        } catch {
            console.error(`Error: Book directory not found at ${path.join(outputRoot, bookTitle)}`)
            process.exit(1)
        }
    }

    await fs.mkdir(audioDir, { recursive: true })
    let txtFiles = await listChapterTextFiles(txtSourceDir)
    txtFiles = applyChapterSelection(txtFiles, selectionArg)

    if (txtFiles.length === 0) {
        console.log(`No chapter text files found in ${txtSourceDir}`)
        return
    }

    if (dryRun) {
        console.log(`[Dry-run] Source: ${label}`)
        console.log(`[Dry-run] Input: ${txtSourceDir}`)
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

    const promises = txtFiles.map((filename) =>
        limit(async () => {
            const inputPath = path.join(txtSourceDir, filename)
            const outputFilename = chapterFileToMp3(filename)
            const outputPath = path.join(audioDir, outputFilename)

            try {
                try {
                    const stats = await fs.stat(outputPath)
                    if (stats.size > 0) {
                        completedCount++
                        return
                    }
                } catch {}

                console.log(`[Generating] ${outputFilename}...`)
                await ttsProvider.generateAudioFromFile(inputPath, outputPath)
                completedCount++
                console.log(`[Success] ${outputFilename} (${completedCount}/${txtFiles.length})`)
            } catch (error) {
                console.error(`[Error] Failed to generate ${outputFilename}:`, error)
            }
        }),
    )

    await Promise.all(promises)

    if (shouldMerge) {
        const selectionName = selectionArg && selectionArg !== 'all' ? `_${selectionArg}` : ''
        const mergeBase = inputFlag ? path.basename(txtSourceDir) : bookTitle!
        const finalOutputPath = path.join(outputDir, `${mergeBase}${selectionName}.mp3`)

        console.log(`\nAll selected chapters processed. Merging into: ${path.basename(finalOutputPath)}`)

        try {
            const audioFilesToMerge = txtFiles.map((f) => chapterFileToMp3(f))

            if (audioFilesToMerge.length > 0) {
                const buffers: Buffer[] = []

                console.log(`[Merging] ${audioFilesToMerge.length} files...`)
                for (const file of audioFilesToMerge) {
                    try {
                        const buf = await fs.readFile(path.join(audioDir, file))
                        buffers.push(buf)
                    } catch {
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

    console.log(`\nAudiobook generation complete for "${label}"!`)
}

main().catch((error) => {
    console.error(`[Error] ${formatCliError(error)}`)
    process.exit(1)
})
