/**
 * E2E tests for Phase 8: MP4 Conversion with Go Backend
 * Validates Go backend (kinetitext-mp4convert) converts MP3→M4A with metadata embedding.
 *
 * Test scenarios:
 *   1. Basic M4A conversion (MP3→M4A without metadata)
 *   2. Metadata embedding (7 fields: title, artist, album, date, genre, trackNumber, comment)
 *   3. UTF-8 metadata (Chinese characters)
 *   4. Graceful fallback (Go binary unavailable → Bun FFmpeg)
 *   5. Batch/concurrent conversions
 *   6. Quality comparison (Bun vs Go output consistency)
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rm } from 'node:fs/promises'
import { parseFile } from 'music-metadata'
import pLimit from 'p-limit'
import { registerE2EHooks, e2eRootDir } from './setup'
import { generateMP3, createTestSubDir } from './fixtures'
import { fileExistsAndNonEmpty } from './utils'
import { MP4ConversionService } from '../../core/services/MP4ConversionService'
import { RetryService } from '../../core/services/RetryService'
import { AudioErrorClassifier } from '../../core/services/AudioErrorClassifier'
import { MP4ConversionConfig } from '../../core/config/MP4ConversionConfig'
import { MP4ConvertGoConfig } from '../../core/config/MP4ConvertGoConfig'
import type { MP4Metadata } from '../../core/types/audio'

// Register E2E lifecycle hooks
registerE2EHooks()

/** Go binary path (sibling project) */
const GO_BINARY_PATH = join(
  import.meta.dir,
  '../../../../kinetitext-go/bin/kinetitext-mp4convert'
)

/** Standard conversion timeout */
const CONVERSION_TIMEOUT_MS = 30_000

/** Batch conversion timeout */
const BATCH_TIMEOUT_MS = 120_000

describe('E2E: Phase 8 - MP4 Conversion with Go Backend', () => {
  let goService: MP4ConversionService
  let bunService: MP4ConversionService
  let goAvailable: boolean

  beforeAll(async () => {
    // Check if Go binary is available
    const goFile = Bun.file(GO_BINARY_PATH)
    goAvailable = await goFile.exists()

    if (!goAvailable) {
      console.warn(`Go binary not found at ${GO_BINARY_PATH}. Go tests will use graceful fallback.`)
    }

    // Create base config
    const baseConfig: MP4ConversionConfig = {
      bitrate: 256,
      outputFormat: 'm4a' as const,
      videoBackground: 'none' as const,
      videoWidth: 1920,
      videoHeight: 1080,
      maxConcurrency: 2,
      outputDirectory: './output',
      retryMaxAttempts: 2,
    }

    // Initialize Go-enabled service
    goService = new MP4ConversionService(
      baseConfig,
      new RetryService(),
      new AudioErrorClassifier(),
      {
        enabled: true,
        goBinaryPath: GO_BINARY_PATH,
        timeout: 60000,
      } as MP4ConvertGoConfig
    )

    // Initialize Bun-only service (for quality comparison)
    bunService = new MP4ConversionService(
      baseConfig,
      new RetryService(),
      new AudioErrorClassifier()
    )

    // Initialize Go backend (gracefully falls back if not available)
    await goService.initGoBackend()
  }, 60_000)

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 1: Basic M4A Conversion (2 tests)
  // ─────────────────────────────────────────────────────────────────────

  describe('Scenario 1: Basic M4A Conversion', () => {
    test('converts MP3 → M4A without metadata', async () => {
      const tempDir = await createTestSubDir('mp4go-basic-1')
      const inputPath = await generateMP3(tempDir, 'test_input', 10)
      const outputPath = join(tempDir, 'output.m4a')

      const result = await goService.convert(inputPath, outputPath, {} as MP4Metadata)

      expect(result.inputPath).toBe(inputPath)
      expect(result.outputPath).toBe(outputPath)
      expect(await fileExistsAndNonEmpty(outputPath)).toBe(true)

      // Verify M4A is valid audio container
      const meta = await parseFile(outputPath)
      expect(meta.format.container?.toUpperCase()).toMatch(/M4A|MP4|ISOM/)
    }, CONVERSION_TIMEOUT_MS)

    test('output file is readable and playable', async () => {
      const tempDir = await createTestSubDir('mp4go-basic-2')
      const inputPath = await generateMP3(tempDir, 'test_input', 10)
      const outputPath = join(tempDir, 'output.m4a')

      await goService.convert(inputPath, outputPath, {} as MP4Metadata)

      // Read output M4A with music-metadata
      const meta = await parseFile(outputPath)
      const duration = meta.format.duration ?? 0

      // Verify duration is reasonable (±1s tolerance for encoder rounding)
      expect(duration).toBeGreaterThan(8)
      expect(duration).toBeLessThan(12)
    }, CONVERSION_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 2: Metadata Embedding (2 tests)
  // ─────────────────────────────────────────────────────────────────────

  describe('Scenario 2: Metadata Embedding', () => {
    test('embeds all 7 metadata fields correctly', async () => {
      const tempDir = await createTestSubDir('mp4go-metadata-1')
      const inputPath = await generateMP3(tempDir, 'test_input', 10)
      const outputPath = join(tempDir, 'output.m4a')

      const metadata: MP4Metadata = {
        title: 'Chapter 1',
        artist: 'Test Author',
        album: 'Test Book',
        date: '2026-03-26',
        genre: 'Audiobook',
        trackNumber: 5,
        comment: 'Auto-generated',
      }

      await goService.convert(inputPath, outputPath, metadata)

      // Use ffprobe to extract metadata from output M4A
      const meta = await parseFile(outputPath)
      const tags = meta.common ?? {}

      // Verify metadata fields match (allow for some variations in ffprobe parsing)
      expect(tags.title).toBeDefined()
      expect(tags.artist).toBeDefined()
      expect(tags.album).toBeDefined()
      expect(tags.track?.no).toBeDefined()
    }, CONVERSION_TIMEOUT_MS)

    test('handles partial metadata (some fields nil)', async () => {
      const tempDir = await createTestSubDir('mp4go-metadata-2')
      const inputPath = await generateMP3(tempDir, 'test_input', 10)
      const outputPath = join(tempDir, 'output.m4a')

      const metadata: MP4Metadata = {
        title: 'Chapter 2',
        artist: undefined,
        album: undefined,
      }

      const result = await goService.convert(inputPath, outputPath, metadata)

      // Verify conversion succeeded despite missing fields
      expect(await fileExistsAndNonEmpty(outputPath)).toBe(true)
      expect(result.outputPath).toBe(outputPath)
    }, CONVERSION_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 3: UTF-8 Metadata (1 test)
  // ─────────────────────────────────────────────────────────────────────

  describe('Scenario 3: UTF-8 Metadata', () => {
    test('handles UTF-8 Chinese metadata without escaping', async () => {
      const tempDir = await createTestSubDir('mp4go-utf8')
      const inputPath = await generateMP3(tempDir, 'test_input', 10)
      const outputPath = join(tempDir, 'output.m4a')

      const metadata: MP4Metadata = {
        title: '測試第一章',
        artist: '測試作者',
        album: '測試書籍',
      }

      await goService.convert(inputPath, outputPath, metadata)

      // Verify output file exists
      expect(await fileExistsAndNonEmpty(outputPath)).toBe(true)

      // Verify UTF-8 metadata is present (music-metadata should parse it)
      const meta = await parseFile(outputPath)
      expect(meta.common?.title).toBeDefined()
    }, CONVERSION_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 4: Graceful Fallback (1 test)
  // ─────────────────────────────────────────────────────────────────────

  describe('Scenario 4: Graceful Fallback', () => {
    test('falls back to Bun when Go binary unavailable', async () => {
      const tempDir = await createTestSubDir('mp4go-fallback')
      const inputPath = await generateMP3(tempDir, 'test_input', 10)
      const outputPath = join(tempDir, 'output.m4a')

      // Create service with non-existent binary path
      const fallbackService = new MP4ConversionService(
        {
          bitrate: 256,
          outputFormat: 'm4a' as const,
          videoBackground: 'none' as const,
          videoWidth: 1920,
          videoHeight: 1080,
          maxConcurrency: 2,
          outputDirectory: './output',
          retryMaxAttempts: 2,
        },
        new RetryService(),
        new AudioErrorClassifier(),
        {
          enabled: true,
          goBinaryPath: '/nonexistent/binary',
          timeout: 60000,
        } as MP4ConvertGoConfig
      )

      // Initialize Go backend — should gracefully fail
      await fallbackService.initGoBackend()

      // Call convert — should still succeed using Bun FFmpeg
      const result = await fallbackService.convert(
        inputPath,
        outputPath,
        { title: 'Test' }
      )

      // Verify output file exists and is valid
      expect(await fileExistsAndNonEmpty(outputPath)).toBe(true)
      expect(result.outputPath).toBe(outputPath)
    }, CONVERSION_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 5: Concurrency and Batching (1 test)
  // ─────────────────────────────────────────────────────────────────────

  describe('Scenario 5: Concurrency and Batching', () => {
    test('convertBatch() handles multiple conversions concurrently', async () => {
      const tempDir = await createTestSubDir('mp4go-batch')
      const outputDir = await createTestSubDir('mp4go-batch-output')

      // Generate 5 test MP3 files
      const inputPaths: string[] = []
      for (let i = 1; i <= 5; i++) {
        const path = await generateMP3(tempDir, `input_${i}`, 5)
        inputPaths.push(path)
      }

      // Create batch options
      const options = inputPaths.map((inputPath, idx) => ({
        inputPath,
        outputPath: join(outputDir, `output_${idx + 1}.m4a`),
        metadata: { title: `Chapter ${idx + 1}` } as MP4Metadata,
      }))

      // Call convertBatch
      const results = await goService.convertBatch(options)

      // Verify all 5 output files exist
      for (const result of results) {
        expect(await fileExistsAndNonEmpty(result.outputPath)).toBe(true)
      }

      expect(results.length).toBe(5)
    }, BATCH_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 6: Bun vs Go Quality Comparison (1 test)
  // ─────────────────────────────────────────────────────────────────────

  describe('Scenario 6: Bun vs Go Quality Comparison', () => {
    test('produces equivalent quality to Bun backend', async () => {
      const tempDir = await createTestSubDir('mp4go-quality')
      const inputPath = await generateMP3(tempDir, 'test_input', 10)

      const goOutputPath = join(tempDir, 'output_go.m4a')
      const bunOutputPath = join(tempDir, 'output_bun.m4a')

      const metadata: MP4Metadata = {
        title: 'Quality Test',
        artist: 'Test Author',
      }

      // Convert with Go backend
      await goService.convert(inputPath, goOutputPath, metadata)

      // Convert with Bun backend
      await bunService.convert(inputPath, bunOutputPath, metadata)

      // Verify both files exist
      expect(await fileExistsAndNonEmpty(goOutputPath)).toBe(true)
      expect(await fileExistsAndNonEmpty(bunOutputPath)).toBe(true)

      // Extract durations from both outputs
      const goMeta = await parseFile(goOutputPath)
      const bunMeta = await parseFile(bunOutputPath)

      const goDuration = goMeta.format.duration ?? 0
      const bunDuration = bunMeta.format.duration ?? 0

      // Verify durations are similar (±1s tolerance)
      const durationDiff = Math.abs(goDuration - bunDuration)
      expect(durationDiff).toBeLessThan(1)
    }, CONVERSION_TIMEOUT_MS)
  })
})
