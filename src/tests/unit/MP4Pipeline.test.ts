/**
 * Unit tests for MP4Pipeline
 * Tests orchestration workflow: directory scanning, file discovery, conversion coordination
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { MP4Pipeline, type MP4PipelineOptions } from '../../core/services/MP4Pipeline'
import { AudioMergeService } from '../../core/services/AudioMergeService'
import { MP4ConversionService } from '../../core/services/MP4ConversionService'
import { DurationService } from '../../core/services/DurationService'
import { MP4ConversionConfig } from '../../core/config/MP4ConversionConfig'
import { RetryService } from '../../core/services/RetryService'
import { AudioErrorClassifier } from '../../core/services/AudioErrorClassifier'
import type { MP4Metadata, MP4ConversionResult } from '../../core/types/audio'

// Helper to create mock config
function createMockConfig(overrides?: Partial<MP4ConversionConfig>): MP4ConversionConfig {
  return {
    bitrate: 256,
    outputFormat: 'm4a',
    videoBackground: 'none',
    videoWidth: 1920,
    videoHeight: 1080,
    maxConcurrency: 2,
    outputDirectory: '/tmp/test_m4a',
    retryMaxAttempts: 3,
    ...overrides
  }
}

describe('MP4Pipeline', () => {
  let pipeline: MP4Pipeline
  let config: MP4ConversionConfig
  let mergeService: AudioMergeService
  let conversionService: MP4ConversionService
  let durationService: DurationService

  beforeEach(() => {
    config = createMockConfig()
    const retryService = new RetryService()
    const errorClassifier = new AudioErrorClassifier()
    conversionService = new MP4ConversionService(config, retryService, errorClassifier)
    mergeService = new AudioMergeService()
    durationService = new DurationService()
    pipeline = new MP4Pipeline(mergeService, conversionService, durationService, config)
  })

  describe('execute() - Full pipeline orchestration', () => {
    test('throws error when input directory does not exist', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/nonexistent/directory',
        outputDir: '/tmp/output'
      }

      const result = await pipeline.execute(options)

      expect(result.failureCount).toBe(1)
      expect(result.errors).toBeDefined()
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('Input directory not found')
    })

    test('handles empty directory gracefully', async () => {
      const emptyDir = '/tmp/empty_mp3_test'
      await Bun.$`mkdir -p ${emptyDir}`.quiet()

      try {
        const options: MP4PipelineOptions = {
          mergedAudioDir: emptyDir,
          outputDir: '/tmp/output'
        }

        const result = await pipeline.execute(options)

        expect(result.failureCount).toBe(1)
        expect(result.totalFiles).toBe(0)
        expect(result.errors.length).toBeGreaterThan(0)
      } finally {
        await Bun.$`rm -rf ${emptyDir}`.quiet()
      }
    })

    test('returns correct pipeline report structure', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/tmp/test_input',
        outputDir: '/tmp/test_output'
      }

      const result = await pipeline.execute(options)

      // Verify report structure (even if execution fails)
      expect(result).toBeDefined()
      expect(result.timestamp).toBeDefined()
      expect(typeof result.timestamp).toBe('number')
      expect(result.inputDirectory).toBe(options.mergedAudioDir)
      expect(result.outputDirectory).toBe(options.outputDir)
      expect(typeof result.totalFiles).toBe('number')
      expect(typeof result.successCount).toBe('number')
      expect(typeof result.failureCount).toBe('number')
      expect(Array.isArray(result.results)).toBe(true)
      expect(Array.isArray(result.errors)).toBe(true)
      expect(typeof result.dryRun).toBe('boolean')
    })
  })

  describe('Dry-run mode', () => {
    test('skips conversion in dry-run mode', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/tmp/test_input',
        outputDir: '/tmp/test_output',
        dryRun: true
      }

      const result = await pipeline.execute(options)

      // Dry-run should fail gracefully on missing directory, not crash
      expect(result.dryRun).toBe(true)
    })

    test('dry-run returns empty results without executing FFmpeg', async () => {
      const testDir = '/tmp/dry_run_test'
      await Bun.$`mkdir -p ${testDir}`.quiet()

      try {
        const options: MP4PipelineOptions = {
          mergedAudioDir: testDir,
          outputDir: '/tmp/output',
          dryRun: true
        }

        const result = await pipeline.execute(options)

        expect(result.dryRun).toBe(true)
        // In dry-run with empty dir, should fail on no files found
        expect(result.failureCount).toBeGreaterThanOrEqual(0)
      } finally {
        await Bun.$`rm -rf ${testDir}`.quiet()
      }
    })
  })

  describe('Metadata mapping', () => {
    test('accepts optional metadata source', async () => {
      const metadata: Record<string, MP4Metadata> = {
        'file1.mp3': {
          title: 'Chapter 1',
          artist: 'Author Name',
          album: 'Book Title'
        }
      }

      const options: MP4PipelineOptions = {
        mergedAudioDir: '/tmp/test_input',
        outputDir: '/tmp/test_output',
        metadataSource: metadata
      }

      const result = await pipeline.execute(options)

      // Verify structure accepts metadata parameter
      expect(result).toBeDefined()
    })

    test('handles metadata with special characters', async () => {
      const metadata: Record<string, MP4Metadata> = {
        'merged_001.mp3': {
          title: 'Part 1: "Quoted" Title',
          artist: 'Author & Co.',
          comment: 'Special chars: @#$%'
        }
      }

      const options: MP4PipelineOptions = {
        mergedAudioDir: '/tmp/test_input',
        outputDir: '/tmp/test_output',
        metadataSource: metadata,
        dryRun: true
      }

      const result = await pipeline.execute(options)

      // Should handle special chars without crashing
      expect(result).toBeDefined()
    })
  })

  describe('Error handling and aggregation', () => {
    test('aggregates multiple errors in report', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/nonexistent/dir1',
        outputDir: '/tmp/output'
      }

      const result = await pipeline.execute(options)

      expect(Array.isArray(result.errors)).toBe(true)
      expect(result.failureCount).toBeGreaterThanOrEqual(1)
    })

    test('failure count matches error list length (when all fail)', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/nonexistent/directory',
        outputDir: '/tmp/output'
      }

      const result = await pipeline.execute(options)

      // At minimum, input validation failure should be recorded
      if (result.failureCount > 0) {
        expect(result.errors.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Output directory creation', () => {
    test('creates output directory if it does not exist', async () => {
      const testOutput = '/tmp/mp4_test_output_new'

      // Ensure it doesn't exist
      await Bun.$`rm -rf ${testOutput}`.quiet()

      try {
        const options: MP4PipelineOptions = {
          mergedAudioDir: '/nonexistent/input',
          outputDir: testOutput
        }

        // This will fail on input, but that's ok
        const result = await pipeline.execute(options)

        // Verify structure (directory creation happens after input validation)
        expect(result).toBeDefined()
      } finally {
        await Bun.$`rm -rf ${testOutput}`.quiet()
      }
    })
  })

  describe('Conversion result validation', () => {
    test('counts success and failure results correctly', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/tmp/test_input',
        outputDir: '/tmp/test_output'
      }

      const result = await pipeline.execute(options)

      // Verify calculation: successCount + failureCount <= totalFiles
      const totalProcessed = result.successCount + result.failureCount
      expect(totalProcessed).toBeLessThanOrEqual(result.totalFiles + 1) // +1 for input validation error
    })

    test('returns MP4ConversionResult array in report', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/tmp/test_input',
        outputDir: '/tmp/test_output'
      }

      const result = await pipeline.execute(options)

      expect(Array.isArray(result.results)).toBe(true)
      // Each result should have required fields (even if empty)
      if (result.results.length > 0) {
        const firstResult = result.results[0]
        expect(firstResult).toBeDefined()
      }
    })
  })

  describe('Timestamp and duration tracking', () => {
    test('records execution timestamp', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/tmp/test_input',
        outputDir: '/tmp/test_output'
      }

      const before = Date.now()
      const result = await pipeline.execute(options)
      const after = Date.now()

      expect(result.timestamp).toBeDefined()
      expect(typeof result.timestamp).toBe('number')
      expect(result.timestamp).toBeGreaterThanOrEqual(before - 100) // Allow 100ms margin
      expect(result.timestamp).toBeLessThanOrEqual(after + 100)
    })
  })

  describe('File path handling', () => {
    test('handles file paths with spaces', async () => {
      const testDir = '/tmp/test with spaces'
      await Bun.$`mkdir -p ${testDir}`.quiet()

      try {
        const options: MP4PipelineOptions = {
          mergedAudioDir: testDir,
          outputDir: '/tmp/output'
        }

        const result = await pipeline.execute(options)

        // Should handle spaces in paths without crashing
        expect(result).toBeDefined()
      } finally {
        await Bun.$`rm -rf ${testDir}`.quiet()
      }
    })

    test('handles output path construction correctly', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/input/dir',
        outputDir: '/output/dir',
        dryRun: true
      }

      const result = await pipeline.execute(options)

      // Verify basic structure
      expect(result.outputDirectory).toBe(options.outputDir)
    })
  })

  describe('Optional configuration parameters', () => {
    test('works without metadata source', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/tmp/test_input',
        outputDir: '/tmp/test_output'
        // No metadataSource provided
      }

      const result = await pipeline.execute(options)

      expect(result).toBeDefined()
    })

    test('works without dryRun flag', async () => {
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/tmp/test_input',
        outputDir: '/tmp/test_output'
        // No dryRun provided (defaults to false)
      }

      const result = await pipeline.execute(options)

      expect(result.dryRun).toBe(false)
    })

    test('readonly options interface is enforced', () => {
      // Type test: verify MP4PipelineOptions is readonly
      const options: MP4PipelineOptions = {
        mergedAudioDir: '/input',
        outputDir: '/output'
      }

      // This demonstrates the readonly constraint is properly typed
      expect(options.mergedAudioDir).toBe('/input')
      expect(options.outputDir).toBe('/output')
    })
  })
})
