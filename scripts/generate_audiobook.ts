import * as fs from 'fs/promises'
import * as path from 'path'
import pLimit from 'p-limit'
import { MicrosoftEdgeTTSProvider } from '../src/tts/MicrosoftEdgeTTSProvider'

async function main() {
    const bookTitle = process.argv[2]
    const limitArg = process.argv[3] // Optional limit
    const rateArg = process.argv[4] || '+0%' // Optional rate (e.g., '+20%', '-10%', '1.5')

    if (!bookTitle) {
        console.log('Usage: bun run scripts/generate_audiobook.ts <BookTitle> [Limit] [Rate]')
        console.log('Example: bun run scripts/generate_audiobook.ts "請不要逼我做神仙" 5 +20%')
        process.exit(1)
    }

    const maxChapters = limitArg ? parseInt(limitArg) : Infinity

    const outputDir = path.join(import.meta.dir, '..', 'output', bookTitle)
    const audioDir = path.join(outputDir, 'audio')

    try {
        await fs.access(outputDir)
    } catch {
        console.error(`Error: Book directory not found at ${outputDir}`)
        process.exit(1)
    }

    await fs.mkdir(audioDir, { recursive: true })

    const entries = await fs.readdir(outputDir, { withFileTypes: true })
    let txtFiles = entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.txt') && entry.name !== 'metadata.txt')
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

    if (txtFiles.length === 0) {
        console.log(`No chapter text files found in ${outputDir}`)
        return
    }

    if (maxChapters !== Infinity) {
        txtFiles = txtFiles.slice(0, maxChapters)
    }

    console.log(`Found ${txtFiles.length} chapters. Starting audio generation (Edge TTS - Yunxi, Rate: ${rateArg})...`)

    const ttsProvider = new MicrosoftEdgeTTSProvider('zh-CN-YunxiNeural', rateArg)

    // Edge TTS is faster and more stable, 1 at a time is still recommended
    const limit = pLimit(1)
    let completedCount = 0

    const promises = txtFiles.map(filename => limit(async () => {
        const inputPath = path.join(outputDir, filename)
        const outputFilename = filename.replace('.txt', '.mp3')
        const outputPath = path.join(audioDir, outputFilename)

        try {
            // Check if audio file already exists and is not empty (Breakpoint resume)
            try {
                const stats = await fs.stat(outputPath)
                if (stats.size > 0) {
                    completedCount++
                    return
                }
            } catch {
                // File does not exist, proceed with generation
            }

            console.log(`[Generating] ${outputFilename}...`)
            await ttsProvider.generateAudioFromFile(inputPath, outputPath)
            completedCount++
            console.log(`[Success] ${outputFilename} (${completedCount}/${txtFiles.length})`)
        } catch (error) {
            console.error(`[Error] Failed to generate ${outputFilename}:`, error)
        }
    }))

    await Promise.all(promises)

    console.log('\nAll chapters generated. Merging into final audiobook...')

    try {
        const audioFiles = (await fs.readdir(audioDir))
            .filter(f => f.endsWith('.mp3'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

        if (audioFiles.length > 0) {
            const finalOutputPath = path.join(outputDir, `${bookTitle}.mp3`)
            const buffers: Buffer[] = []

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
    console.log(`Individual audio files: ${audioDir}`)
}

main().catch(console.error)
