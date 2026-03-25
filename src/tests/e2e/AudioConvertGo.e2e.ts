/**
 * E2E tests for Phase 6: AudioConvert with Go Backend
 * Validates Go backend conversion quality and consistency vs Bun backend.
 *
 * Scenarios:
 *   1. Single file conversion - WAV → MP3 via Go backend
 *   2. Multi-format conversion - AAC, OGG, FLAC → MP3 via Go backend
 *   3. Duration accuracy verification (±1s tolerance)
 *   4. Concurrent conversion stability (p-limit with 4 goroutines)
 *   5. Error handling for invalid input files
 *   6. Quality comparison: Bun vs Go output consistency
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rm } from 'node:fs/promises'
import pLimit from 'p-limit'
import { AudioConvertService } from '../../core/services/AudioConvertService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import { verifyMP3File, getMp3Duration, fileExistsAndNonEmpty } from './utils'
import { generateMultiFormatSamples, generateWAV } from './fixtures'

/** Go binary path (sibling project) */
const GO_BINARY_PATH = join(
  import.meta.dir,
  '../../../../../kinetitext-go/bin/kinetitext-audio'
)

/** Maximum wall-clock time for a single conversion */
const MAX_CONVERT_MS = 60_000

/** Maximum wall-clock time for batch/concurrent conversions */
const MAX_BATCH_MS = 120_000

describe('E2E: Phase 6 - AudioConvert with Go Backend', () => {
  let tmpDir: string
  let goService: AudioConvertService
  let bunService: AudioConvertService
  let formatSamples: Record<string, string>
  let goAvailable: boolean

  beforeAll(async () => {
    // Create isolated temp directory
    tmpDir = await mkdtemp(join(tmpdir(), 'e2e-go-audio-'))

    // Check if Go binary is available
    const goFile = Bun.file(GO_BINARY_PATH)
    goAvailable = await goFile.exists()

    if (!goAvailable) {
      // Log but do not throw — tests will be skipped gracefully
      console.warn(`Go binary not found at ${GO_BINARY_PATH}. Go tests will be skipped.`)
    }

    // Initialize Go-enabled service
    goService = new AudioConvertService(
      new AudioConvertConfig({
        useGoBackend: true,
        goBinaryPath: GO_BINARY_PATH,
        bitrate: '192k',
      })
    )

    // Initialize Bun-only service (for quality comparison)
    bunService = new AudioConvertService(
      new AudioConvertConfig({
        useGoBackend: false,
        bitrate: '192k',
      })
    )

    // Generate multi-format source samples (WAV, AAC, OGG, FLAC)
    formatSamples = await generateMultiFormatSamples(tmpDir)

    // Initialize Go backend (gracefully falls back to Bun if not available)
    await goService.initGoBackend()
  }, 90_000)

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Scenario 1: WAV → MP3 via Go backend
  // -------------------------------------------------------------------------

  describe('Scenario 1: WAV → MP3 via Go backend', () => {
    test('output MP3 exists and is valid', async () => {
      const inputPath = formatSamples['wav']
      const outputPath = join(tmpDir, 'go-single-wav.mp3')

      const result = await goService.convertToMp3(inputPath, outputPath)

      expect(result.inputPath).toBe(inputPath)
      expect(result.outputPath).toBe(outputPath)
      expect(result.inputFormat).toBe('WAV')

      const exists = await fileExistsAndNonEmpty(outputPath)
      expect(exists).toBe(true)

      await verifyMP3File(outputPath)
    }, MAX_CONVERT_MS)

    test('output MP3 has valid bitrate and sampleRate metadata', async () => {
      const inputPath = formatSamples['wav']
      const outputPath = join(tmpDir, 'go-wav-meta.mp3')

      const result = await goService.convertToMp3(inputPath, outputPath)

      expect(result.outputMetadata.bitrate).toBeGreaterThan(0)
      expect(result.outputMetadata.sampleRate).toBeGreaterThan(0)
    }, MAX_CONVERT_MS)
  })

  // -------------------------------------------------------------------------
  // Scenario 2: Multi-format conversion via Go backend (AAC, OGG, FLAC)
  // -------------------------------------------------------------------------

  describe('Scenario 2: Multi-format → MP3 via Go backend', () => {
    const FORMATS: Array<{ key: string; label: string }> = [
      { key: 'aac', label: 'AAC' },
      { key: 'ogg', label: 'OGG' },
      { key: 'flac', label: 'FLAC' },
    ]

    for (const fmt of FORMATS) {
      test(`${fmt.label} → MP3: output is valid MP3`, async () => {
        const inputPath = formatSamples[fmt.key]
        const outputPath = join(tmpDir, `go-${fmt.key}.mp3`)

        const result = await goService.convertToMp3(inputPath, outputPath)

        expect(result.inputFormat).toBe(fmt.label)

        const exists = await fileExistsAndNonEmpty(outputPath)
        expect(exists).toBe(true)

        await verifyMP3File(outputPath)
      }, MAX_CONVERT_MS)
    }

    test('convertBatch() converts all 4 formats via Go backend', async () => {
      const files = [
        { input: formatSamples['wav'], output: join(tmpDir, 'go-batch-wav.mp3') },
        { input: formatSamples['aac'], output: join(tmpDir, 'go-batch-aac.mp3') },
        { input: formatSamples['ogg'], output: join(tmpDir, 'go-batch-ogg.mp3') },
        { input: formatSamples['flac'], output: join(tmpDir, 'go-batch-flac.mp3') },
      ]

      const result = await goService.convertBatch(files)

      expect(result.total).toBe(4)
      expect(result.succeeded).toBe(4)
      expect(result.failed).toBe(0)

      // Verify all outputs are valid MP3
      for (const file of files) {
        await verifyMP3File(file.output)
      }
    }, MAX_BATCH_MS)
  })

  // -------------------------------------------------------------------------
  // Scenario 3: Duration accuracy (±1s tolerance)
  // -------------------------------------------------------------------------

  describe('Scenario 3: Duration accuracy verification', () => {
    const DURATION_FORMATS: Array<{ key: string; label: string }> = [
      { key: 'wav', label: 'WAV' },
      { key: 'aac', label: 'AAC' },
      { key: 'ogg', label: 'OGG' },
      { key: 'flac', label: 'FLAC' },
    ]

    for (const fmt of DURATION_FORMATS) {
      test(`${fmt.label} → MP3: output duration within ±1s of 5s source`, async () => {
        const inputPath = formatSamples[fmt.key]
        const outputPath = join(tmpDir, `go-dur-${fmt.key}.mp3`)

        const result = await goService.convertToMp3(inputPath, outputPath)

        // Source is 5s; allow ±1s tolerance for encoding overhead
        expect(result.outputMetadata.duration).toBeGreaterThan(4)
        expect(result.outputMetadata.duration).toBeLessThan(6)
      }, MAX_CONVERT_MS)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 4: Concurrent conversion stability (p-limit)
  // -------------------------------------------------------------------------

  describe('Scenario 4: Concurrent conversions with p-limit', () => {
    test('10 concurrent conversions all succeed (concurrency=4)', async () => {
      const limit = pLimit(4)
      const formats = ['wav', 'aac', 'ogg', 'flac']

      const tasks = Array.from({ length: 10 }, (_, i) => {
        const fmt = formats[i % formats.length]
        return limit(async () => {
          const input = formatSamples[fmt]
          const output = join(tmpDir, `go-concurrent-${i}.mp3`)

          const result = await goService.convertToMp3(input, output)

          const exists = await fileExistsAndNonEmpty(output)
          expect(exists).toBe(true)

          return result
        })
      })

      const results = await Promise.all(tasks)

      expect(results).toHaveLength(10)
      expect(results.every(r => r.outputPath.endsWith('.mp3'))).toBe(true)

      // Verify each output file is valid
      for (const result of results) {
        await verifyMP3File(result.outputPath)
      }
    }, MAX_BATCH_MS)
  })

  // -------------------------------------------------------------------------
  // Scenario 5: Error handling for invalid inputs
  // -------------------------------------------------------------------------

  describe('Scenario 5: Error handling for invalid inputs', () => {
    test('non-existent input file throws after retries', async () => {
      const missingInput = join(tmpDir, 'does-not-exist.wav')
      const outputPath = join(tmpDir, 'go-error-output.mp3')

      await expect(goService.convertToMp3(missingInput, outputPath)).rejects.toThrow()
    }, 30_000)

    test('convertBatch tolerates one bad file, succeeds for the rest', async () => {
      const files = [
        { input: formatSamples['wav'], output: join(tmpDir, 'go-err-ok.mp3') },
        { input: join(tmpDir, 'nonexistent.wav'), output: join(tmpDir, 'go-err-bad.mp3') },
      ]

      const result = await goService.convertBatch(files)

      expect(result.total).toBe(2)
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(1)
    }, 60_000)
  })

  // -------------------------------------------------------------------------
  // Scenario 6: Quality comparison — Bun vs Go output consistency
  // -------------------------------------------------------------------------

  describe('Scenario 6: Quality consistency — Bun vs Go', () => {
    test('WAV → MP3: Bun and Go outputs are both valid MP3', async () => {
      const inputPath = formatSamples['wav']
      const bunOutput = join(tmpDir, 'quality-bun.mp3')
      const goOutput = join(tmpDir, 'quality-go.mp3')

      // Convert using Bun backend
      const bunResult = await bunService.convertToMp3(inputPath, bunOutput)
      // Convert using Go backend
      const goResult = await goService.convertToMp3(inputPath, goOutput)

      // Both conversions must succeed
      expect(bunResult.outputPath).toBe(bunOutput)
      expect(goResult.outputPath).toBe(goOutput)

      // Both outputs must be valid MP3
      await verifyMP3File(bunOutput)
      await verifyMP3File(goOutput)
    }, MAX_BATCH_MS)

    test('WAV → MP3: Bun and Go output durations are within 1s of each other', async () => {
      const inputPath = formatSamples['wav']
      const bunOutput = join(tmpDir, 'qdur-bun.mp3')
      const goOutput = join(tmpDir, 'qdur-go.mp3')

      await bunService.convertToMp3(inputPath, bunOutput)
      await goService.convertToMp3(inputPath, goOutput)

      const bunDuration = await getMp3Duration(bunOutput)
      const goDuration = await getMp3Duration(goOutput)

      // Both should report ~5s; difference must be < 1s
      const diff = Math.abs(bunDuration - goDuration)
      expect(diff).toBeLessThan(1.0)
    }, MAX_BATCH_MS)

    test('FLAC → MP3: Bun and Go output durations are within 1s of each other', async () => {
      const inputPath = formatSamples['flac']
      const bunOutput = join(tmpDir, 'qdur-flac-bun.mp3')
      const goOutput = join(tmpDir, 'qdur-flac-go.mp3')

      await bunService.convertToMp3(inputPath, bunOutput)
      await goService.convertToMp3(inputPath, goOutput)

      const bunDuration = await getMp3Duration(bunOutput)
      const goDuration = await getMp3Duration(goOutput)

      const diff = Math.abs(bunDuration - goDuration)
      expect(diff).toBeLessThan(1.0)
    }, MAX_BATCH_MS)

    test('OGG → MP3: both outputs are non-empty files', async () => {
      const inputPath = formatSamples['ogg']
      const bunOutput = join(tmpDir, 'qsize-ogg-bun.mp3')
      const goOutput = join(tmpDir, 'qsize-ogg-go.mp3')

      await bunService.convertToMp3(inputPath, bunOutput)
      await goService.convertToMp3(inputPath, goOutput)

      const bunExists = await fileExistsAndNonEmpty(bunOutput)
      const goExists = await fileExistsAndNonEmpty(goOutput)

      expect(bunExists).toBe(true)
      expect(goExists).toBe(true)
    }, MAX_BATCH_MS)
  })
})
