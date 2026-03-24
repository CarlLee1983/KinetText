/**
 * E2E tests for Phase 2: Audio Conversion (AudioConvertService)
 * Validates WAV/AAC/OGG/FLAC → MP3 conversion with real FFmpeg.
 *
 * Scenarios:
 *   1. Single file conversion (WAV → MP3)
 *   2. Multi-format conversion (AAC, OGG, FLAC → MP3)
 *   3. Retry logic on failure (invalid input triggers retry then fails)
 *   4. Performance benchmark (conversion time within acceptable bounds)
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { $ } from 'bun'
import { AudioConvertService } from '../../core/services/AudioConvertService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import type { ConversionError } from '../../core/types/audio'
import { verifyMP3File, getMp3Duration, fileExistsAndNonEmpty } from './utils'
import { generateMultiFormatSamples } from './fixtures'

/** Maximum allowed wall-clock time for a single 5s WAV→MP3 conversion */
const MAX_SINGLE_CONVERSION_MS = 30_000

describe('E2E: Phase 2 - Audio Conversion', () => {
  let tmpDir: string
  let service: AudioConvertService
  let formatSamples: Record<string, string>

  beforeAll(async () => {
    // Create isolated temp directory for this suite
    tmpDir = await mkdtemp(join(tmpdir(), 'e2e-convert-'))

    // Build all source samples (WAV, AAC, OGG, FLAC)
    formatSamples = await generateMultiFormatSamples(tmpDir)

    // Service with default config (128k, 44100 Hz, maxConcurrency 4)
    service = new AudioConvertService(new AudioConvertConfig())
  }, 60_000)

  afterAll(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(tmpDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Scenario 1: Single file conversion
  // -------------------------------------------------------------------------

  describe('Scenario 1: Single file conversion (WAV → MP3)', () => {
    test('output MP3 exists and has valid MPEG codec', async () => {
      const inputPath = formatSamples['wav']
      const outputPath = join(tmpDir, 'single_wav.mp3')

      const result = await service.convertToMp3(inputPath, outputPath)

      // Structural checks
      expect(result.inputPath).toBe(inputPath)
      expect(result.outputPath).toBe(outputPath)
      expect(result.inputFormat).toBe('WAV')

      // File-system check
      const exists = await fileExistsAndNonEmpty(outputPath)
      expect(exists).toBe(true)

      // Codec check via music-metadata
      await verifyMP3File(outputPath)
    }, MAX_SINGLE_CONVERSION_MS)

    test('output MP3 duration is within 1s of 5s source', async () => {
      const inputPath = formatSamples['wav']
      const outputPath = join(tmpDir, 'single_wav_dur.mp3')

      const result = await service.convertToMp3(inputPath, outputPath)

      // Duration should be approximately 5 seconds (±1s tolerance for lavfi silence)
      expect(result.outputMetadata.duration).toBeGreaterThan(4)
      expect(result.outputMetadata.duration).toBeLessThan(6)
    }, MAX_SINGLE_CONVERSION_MS)

    test('output metadata contains bitrate and sampleRate', async () => {
      const inputPath = formatSamples['wav']
      const outputPath = join(tmpDir, 'single_wav_meta.mp3')

      const result = await service.convertToMp3(inputPath, outputPath)

      expect(result.outputMetadata.bitrate).toBeGreaterThan(0)
      expect(result.outputMetadata.sampleRate).toBeGreaterThan(0)
    }, MAX_SINGLE_CONVERSION_MS)
  })

  // -------------------------------------------------------------------------
  // Scenario 2: Multi-format conversion
  // -------------------------------------------------------------------------

  describe('Scenario 2: Multi-format conversion (AAC, OGG, FLAC → MP3)', () => {
    const FORMATS: Array<{ key: string; ext: string; label: string }> = [
      { key: 'aac', ext: 'aac', label: 'AAC' },
      { key: 'ogg', ext: 'ogg', label: 'OGG' },
      { key: 'flac', ext: 'flac', label: 'FLAC' },
    ]

    for (const fmt of FORMATS) {
      test(`${fmt.label} → MP3: output is valid and readable`, async () => {
        const inputPath = formatSamples[fmt.key]
        const outputPath = join(tmpDir, `convert_${fmt.ext}.mp3`)

        const result = await service.convertToMp3(inputPath, outputPath)

        expect(result.inputFormat).toBe(fmt.label)
        await verifyMP3File(outputPath)
        expect(result.outputMetadata.duration).toBeGreaterThan(3)
        expect(result.outputMetadata.duration).toBeLessThan(7)
      }, MAX_SINGLE_CONVERSION_MS)
    }

    test('convertBatch() converts all 4 formats in one call', async () => {
      const files = [
        { input: formatSamples['wav'], output: join(tmpDir, 'batch_wav.mp3') },
        { input: formatSamples['aac'], output: join(tmpDir, 'batch_aac.mp3') },
        { input: formatSamples['ogg'], output: join(tmpDir, 'batch_ogg.mp3') },
        { input: formatSamples['flac'], output: join(tmpDir, 'batch_flac.mp3') },
      ]

      const result = await service.convertBatch(files)

      expect(result.total).toBe(4)
      expect(result.succeeded).toBe(4)
      expect(result.failed).toBe(0)

      // Verify every output is a valid MP3
      for (const file of files) {
        await verifyMP3File(file.output)
      }
    }, 90_000)
  })

  // -------------------------------------------------------------------------
  // Scenario 3: Retry on failure
  // -------------------------------------------------------------------------

  describe('Scenario 3: Retry logic on conversion failure', () => {
    test('non-existent input causes convertToMp3 to throw after retries', async () => {
      const missing = join(tmpDir, 'does_not_exist.wav')
      const output = join(tmpDir, 'retry_fail.mp3')

      await expect(service.convertToMp3(missing, output)).rejects.toThrow()
    }, 30_000)

    test('convertBatch() tolerates one bad file and succeeds for the rest', async () => {
      const files = [
        { input: formatSamples['wav'], output: join(tmpDir, 'partial_ok.mp3') },
        { input: join(tmpDir, 'nonexistent.wav'), output: join(tmpDir, 'partial_bad.mp3') },
      ]

      const result = await service.convertBatch(files)

      expect(result.total).toBe(2)
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(1)

      // Error result should carry the input path
      const errResult = result.results.find(
        (r): r is ConversionError => 'error' in r
      )
      expect(errResult?.inputPath).toBe(files[1].input)
    }, 60_000)
  })

  // -------------------------------------------------------------------------
  // Scenario 4: Performance benchmark
  // -------------------------------------------------------------------------

  describe('Scenario 4: Performance benchmark', () => {
    test('single WAV→MP3 completes within 30 seconds', async () => {
      const inputPath = formatSamples['wav']
      const outputPath = join(tmpDir, 'perf_wav.mp3')

      const start = Date.now()
      await service.convertToMp3(inputPath, outputPath)
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(MAX_SINGLE_CONVERSION_MS)
    }, MAX_SINGLE_CONVERSION_MS)

    test('convertBatch of 4 files completes within 90 seconds', async () => {
      const files = [
        { input: formatSamples['wav'], output: join(tmpDir, 'perf_batch_wav.mp3') },
        { input: formatSamples['aac'], output: join(tmpDir, 'perf_batch_aac.mp3') },
        { input: formatSamples['ogg'], output: join(tmpDir, 'perf_batch_ogg.mp3') },
        { input: formatSamples['flac'], output: join(tmpDir, 'perf_batch_flac.mp3') },
      ]

      const start = Date.now()
      const result = await service.convertBatch(files)
      const elapsed = Date.now() - start

      expect(result.succeeded).toBe(4)
      expect(elapsed).toBeLessThan(90_000)
    }, 90_000)

    test('getMetadata() extracts accurate duration from generated WAV', async () => {
      const wavPath = formatSamples['wav']
      const duration = await getMp3Duration(wavPath)

      // Generated with -t 5; music-metadata should report approximately 5s
      expect(duration).toBeGreaterThan(4)
      expect(duration).toBeLessThan(6)
    })
  })
})
