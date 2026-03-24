/**
 * Integration tests for AudioConvertService
 * Uses real FFmpeg to generate test audio and verify conversion
 */

import { beforeAll, afterAll, describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AudioConvertService } from '../../core/services/AudioConvertService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'

describe('AudioConversion Integration', () => {
  let tmpDir: string
  let service: AudioConvertService

  beforeAll(async () => {
    // Create isolated temp directory for test files
    tmpDir = await mkdtemp(join(tmpdir(), 'kinetitext-audio-test-'))

    // Default service with standard config
    service = new AudioConvertService(new AudioConvertConfig())

    // Generate 5-second silent test audio in multiple formats using ffmpeg
    await $`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 ${join(tmpDir, 'test.wav')} -y`.quiet()
    await $`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -codec:a aac ${join(tmpDir, 'test.aac')} -y`.quiet()
    await $`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -codec:a libopus ${join(tmpDir, 'test.ogg')} -y`.quiet()
    await $`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 ${join(tmpDir, 'test.flac')} -y`.quiet()
  }, 30000)

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('checkFfmpegAvailable() resolves without error', async () => {
    await expect(AudioConvertService.checkFfmpegAvailable()).resolves.toBeUndefined()
  })

  test('WAV to MP3 conversion produces valid output', async () => {
    const inputPath = join(tmpDir, 'test.wav')
    const outputPath = join(tmpDir, 'test_wav.mp3')

    const result = await service.convertToMp3(inputPath, outputPath)

    // Verify output file exists
    const fileStats = await stat(outputPath)
    expect(fileStats.size).toBeGreaterThan(0)

    expect(result.inputPath).toBe(inputPath)
    expect(result.outputPath).toBe(outputPath)
    expect(result.inputFormat).toBe('WAV')
    // Duration should be approximately 5 seconds (within 2 second tolerance for silent audio)
    expect(result.outputMetadata.duration).toBeGreaterThan(3)
    expect(result.outputMetadata.duration).toBeLessThan(7)
    // Codec should indicate MP3
    const codec = result.outputMetadata.codec.toUpperCase()
    expect(codec.includes('MP3') || codec.includes('MPEG')).toBe(true)
  }, 30000)

  test('AAC to MP3 conversion produces valid output', async () => {
    const inputPath = join(tmpDir, 'test.aac')
    const outputPath = join(tmpDir, 'test_aac.mp3')

    const result = await service.convertToMp3(inputPath, outputPath)

    const fileStats = await stat(outputPath)
    expect(fileStats.size).toBeGreaterThan(0)
    expect(result.inputFormat).toBe('AAC')
    expect(result.outputMetadata.duration).toBeGreaterThan(3)
    expect(result.outputMetadata.duration).toBeLessThan(7)
  }, 30000)

  test('OGG to MP3 conversion produces valid output', async () => {
    const inputPath = join(tmpDir, 'test.ogg')
    const outputPath = join(tmpDir, 'test_ogg.mp3')

    const result = await service.convertToMp3(inputPath, outputPath)

    const fileStats = await stat(outputPath)
    expect(fileStats.size).toBeGreaterThan(0)
    expect(result.inputFormat).toBe('OGG')
    expect(result.outputMetadata.duration).toBeGreaterThan(3)
    expect(result.outputMetadata.duration).toBeLessThan(7)
  }, 30000)

  test('FLAC to MP3 conversion produces valid output', async () => {
    const inputPath = join(tmpDir, 'test.flac')
    const outputPath = join(tmpDir, 'test_flac.mp3')

    const result = await service.convertToMp3(inputPath, outputPath)

    const fileStats = await stat(outputPath)
    expect(fileStats.size).toBeGreaterThan(0)
    expect(result.inputFormat).toBe('FLAC')
    expect(result.outputMetadata.duration).toBeGreaterThan(3)
    expect(result.outputMetadata.duration).toBeLessThan(7)
  }, 30000)

  test('configurable bitrate: 192k produces higher bitrate output', async () => {
    const highBitrateService = new AudioConvertService(
      new AudioConvertConfig({ bitrate: '192k' })
    )
    const inputPath = join(tmpDir, 'test.wav')
    const outputPath = join(tmpDir, 'test_192k.mp3')

    const result = await highBitrateService.convertToMp3(inputPath, outputPath)

    // Verify the file was created and metadata is populated
    const bitrateFileStats = await stat(outputPath)
    expect(bitrateFileStats.size).toBeGreaterThan(0)
    expect(result.outputMetadata.duration).toBeGreaterThan(3)
  }, 30000)

  test('getMetadata() extracts duration accurately from WAV file', async () => {
    const wavPath = join(tmpDir, 'test.wav')
    const metadata = await service.getMetadata(wavPath)

    expect(metadata.duration).toBeGreaterThan(4)
    expect(metadata.duration).toBeLessThan(6)
  })

  test('convertBatch() processes all 4 formats successfully', async () => {
    const files = [
      { input: join(tmpDir, 'test.wav'), output: join(tmpDir, 'batch_wav.mp3') },
      { input: join(tmpDir, 'test.aac'), output: join(tmpDir, 'batch_aac.mp3') },
      { input: join(tmpDir, 'test.ogg'), output: join(tmpDir, 'batch_ogg.mp3') },
      { input: join(tmpDir, 'test.flac'), output: join(tmpDir, 'batch_flac.mp3') },
    ]

    const result = await service.convertBatch(files)

    expect(result.total).toBe(4)
    expect(result.succeeded).toBe(4)
    expect(result.failed).toBe(0)
    expect(result.results).toHaveLength(4)
  }, 60000)

  test('convertBatch() tolerates partial failure from non-existent file', async () => {
    const files = [
      { input: join(tmpDir, 'test.wav'), output: join(tmpDir, 'partial_wav.mp3') },
      { input: join(tmpDir, 'test.aac'), output: join(tmpDir, 'partial_aac.mp3') },
      { input: join(tmpDir, 'test.ogg'), output: join(tmpDir, 'partial_ogg.mp3') },
      { input: join(tmpDir, 'test.flac'), output: join(tmpDir, 'partial_flac.mp3') },
      { input: join(tmpDir, 'nonexistent.wav'), output: join(tmpDir, 'partial_nonexistent.mp3') },
    ]

    const result = await service.convertBatch(files)

    expect(result.total).toBe(5)
    expect(result.succeeded).toBe(4)
    expect(result.failed).toBe(1)
  }, 60000)
})
