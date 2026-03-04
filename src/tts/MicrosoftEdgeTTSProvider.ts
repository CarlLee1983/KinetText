import { v4 as uuidv4 } from 'uuid'
import * as crypto from 'crypto'
import WebSocket from 'ws'
import * as fs from 'fs/promises'
import pLimit from 'p-limit'
import type { TTSProvider } from './TTSProvider'

export class MicrosoftEdgeTTSProvider implements TTSProvider {
    private voice: string
    private rate: string
    private endpoint: string = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
    private trustedClientToken: string = process.env.MICROSOFT_TTS_TOKEN || ''

    constructor(voice: string = 'zh-CN-YunxiNeural', rate: string = '+0%') {
        this.voice = voice
        this.rate = rate
    }

    async generateAudioFromFile(inputFilePath: string, outputFilePath: string): Promise<void> {
        let text = await fs.readFile(inputFilePath, 'utf-8')

        // Remove chapter title and separator lines to prevent TTS from reading them
        const lines = text.split('\n')
        if (lines.length >= 2 && lines[1]?.startsWith('---')) {
            text = lines.slice(2).join('\n').trim()
        }

        const chunks = this.splitText(text, 1500)

        // Concurrent synthesis within a chapter (max 1 to avoid rate limiting)
        const limit = pLimit(1)
        const tasks = chunks.map(chunk => limit(async () => {
            if (!chunk.trim()) return Buffer.alloc(0)
            return await this.synthesizeWithRetry(chunk)
        }))

        const audioBuffers = await Promise.all(tasks)
        await fs.writeFile(outputFilePath, Buffer.concat(audioBuffers))
    }

    private escapeXml(unsafe: string): string {
        return unsafe.replace(/[<>&'"]/g, (c) => ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            "'": '&apos;',
            '"': '&quot;'
        }[c] || c))
    }

    private generateSecMsGec(): string {
        let ticks = Math.floor(Date.now() / 1000)
        ticks += 11644473600
        ticks -= ticks % 300
        const strToHash = ticks + '0000000' + this.trustedClientToken
        return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase()
    }

    private async synthesizeWithRetry(text: string, maxRetries: number = 5): Promise<Buffer> {
        let lastError: any
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await this.synthesize(text)
            } catch (err) {
                lastError = err
                const delay = 1000 * (i + 1)
                console.warn(`[TTS Retry] Attempt ${i + 1} failed. Retrying in ${delay}ms...`, err instanceof Error ? err.message : err)
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }
        throw new Error(`Failed to synthesize after ${maxRetries} attempts. Last error: ${lastError?.message || lastError}`)
    }

    private async synthesize(text: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const connectionId = uuidv4().replace(/-/g, '').toUpperCase()
            const secMsGec = this.generateSecMsGec()
            const url = `${this.endpoint}?TrustedClientToken=${this.trustedClientToken}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-143.0.3650.75`

            const ws = new WebSocket(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
                    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
                    'Pragma': 'no-cache',
                    'Cache-Control': 'no-cache',
                    'Accept-Encoding': 'gzip, deflate, br, zstd',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            })

            const audioData: Buffer[] = []
            const timestamp = new Date().toString()

            // Set a timeout for the entire synthesis process (60s per chunk)
            const timeout = setTimeout(() => {
                ws.close()
                reject(new Error('Edge TTS synthesis timed out (60s)'))
            }, 60000)

            ws.on('open', () => {
                // 必須嚴格使用 \r\n
                const configMsg = `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
                ws.send(configMsg)

                const escapedText = this.escapeXml(text)
                const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${this.voice}'><prosody rate='${this.rate}'>${escapedText}</prosody></voice></speak>`
                const requestMsg = `X-RequestId:${connectionId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}\r\nPath:ssml\r\n\r\n${ssml}`
                ws.send(requestMsg)
            })

            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    const message = data as Buffer
                    // 二進位訊息前 2 bytes 是標頭長度 (Big Endian)
                    const headerLength = message.readInt16BE(0)
                    const audioContent = message.slice(headerLength + 2)
                    if (audioContent.length > 0) {
                        audioData.push(audioContent)
                    }
                } else {
                    const textMsg = data.toString()
                    if (textMsg.includes('Path:turn.end')) {
                        clearTimeout(timeout)
                        ws.close()
                        resolve(Buffer.concat(audioData))
                    }
                }
            })

            ws.on('error', (err) => {
                clearTimeout(timeout)
                ws.close()
                reject(new Error(`Edge TTS WebSocket error: ${err.message}`))
            })

            ws.on('close', (code, reason) => {
                clearTimeout(timeout)
                if (audioData.length === 0) {
                    reject(new Error(`Edge TTS connection closed without data. Code: ${code}`))
                }
            })
        })
    }

    private splitText(text: string, maxLength: number): string[] {
        const chunks: string[] = []
        let start = 0
        while (start < text.length) {
            let end = start + maxLength
            if (end > text.length) end = text.length
            else {
                const lookback = Math.floor(maxLength * 0.2)
                const searchRange = text.slice(end - lookback, end)
                const lastPunct = searchRange.search(/[，。？！；、\n]/)
                if (lastPunct !== -1) {
                    const punctIndices = [...searchRange.matchAll(/[，。？！；、\n]/g)]
                    const lastMatch = punctIndices[punctIndices.length - 1]
                    if (lastMatch && lastMatch.index !== undefined) {
                        end = (end - lookback) + lastMatch.index + 1
                    }
                }
            }
            chunks.push(text.slice(start, end))
            start = end
        }
        return chunks
    }
}
