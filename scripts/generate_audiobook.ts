import * as fs from 'fs/promises'
import * as path from 'path'
import pLimit from 'p-limit'
import { MicrosoftEdgeTTSProvider } from '../src/tts/MicrosoftEdgeTTSProvider'

async function main() {
    const bookTitle = process.argv[2]
    const selectionArg = process.argv[3] // Optional limit or range/list (e.g., "5", "10-20", "2,4,10")
    const rateArg = process.argv[4] || '+0%' // Optional rate (e.g., '+20%', '-10%', '1.5')
    const concurrencyArg = process.argv[5] || '3' // Optional concurrency (default to 3)

    if (!bookTitle) {
        console.log('Usage: bun run scripts/generate_audiobook.ts <BookTitle> [Selection] [Rate] [Concurrency]')
        console.log('Examples:')
        console.log('  bun run scripts/generate_audiobook.ts "Book" 5          # First 5 chapters')
        console.log('  bun run scripts/generate_audiobook.ts "Book" 10-20      # Chapters 10 to 20')
        console.log('  bun run scripts/generate_audiobook.ts "Book" 2,4,10     # Chapters 2, 4, 10')
        console.log('  bun run scripts/generate_audiobook.ts "Book" all +20% 5 # All chapters, 1.2x speed, 5 concurrent')
        process.exit(1)
    }

    const concurrency = parseInt(concurrencyArg) || 3
    const outputDir = path.join(import.meta.dir, '..', 'output', bookTitle)
    const audioDir = path.join(outputDir, 'audio')
    let txtSourceDir = path.join(outputDir, 'txt')

    try {
        await fs.access(outputDir)
        try {
            await fs.access(txtSourceDir)
        } catch {
            txtSourceDir = outputDir
        }
    } catch {
        console.error(`Error: Book directory not found at ${outputDir}`)
        process.exit(1)
    }

    await fs.mkdir(audioDir, { recursive: true })

    const entries = await fs.readdir(txtSourceDir, { withFileTypes: true })
    let txtFiles = entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.txt') && entry.name !== 'metadata.txt')
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

    if (txtFiles.length === 0) {
        console.log(`No chapter text files found in ${txtSourceDir}`)
        return
    }

    // Handle selection
    if (selectionArg && selectionArg !== 'all') {
        const selectedIndices = new Set<number>()

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
            // Single number: if small, interpret as limit; if large or specific target index, interpret as limit up to that many chapters.
            // For better UX, if it's just a number "5", we'll treat it as "up to index 5" 
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

    console.log(`Processing ${txtFiles.length} chapters. Concurrency: ${concurrency}, Rate: ${rateArg}`)

    const ttsProvider = new MicrosoftEdgeTTSProvider('zh-CN-YunxiNeural', rateArg)
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

    console.log('\nAll selected chapters processed. Merging into final audiobook...')

    try {
        const audioFiles = (await fs.readdir(audioDir))
            .filter(f => f.endsWith('.mp3'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

        if (audioFiles.length > 0) {
            const finalOutputPath = path.join(outputDir, `${bookTitle}.mp3`)
            const buffers: Buffer[] = []

            console.log(`[Merging] ${audioFiles.length} files...`)
            for (const file of audioFiles) {
                const buf = await fs.readFile(path.join(audioDir, file))
                buffers.push(buf)
            }

            await fs.writeFile(finalOutputPath, Buffer.concat(buffers))
            console.log(`[Combined] Created final audiobook: ${finalOutputPath}`)
        }
    } catch (err) {
        console.error('[Error] Failed to merge audio files:', err)
    }

    console.log(`\nAudiobook generation complete for "${bookTitle}"!`)
}

main().catch(console.error)
