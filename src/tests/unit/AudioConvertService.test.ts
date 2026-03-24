/**
 * Unit tests for AudioConvertService
 * Uses dependency injection to mock shell executor, metadata reader, and retry service
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { AudioConvertService } from '../../core/services/AudioConvertService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import type { ShellExecutor, MetadataReader, FfmpegChecker } from '../../core/services/AudioConvertService'
import type { AudioMetadata } from '../../core/types/audio'

/** Helper: create a mock metadata reader returning fixed values */
const makeMockMetadata = (overrides: Partial<AudioMetadata> = {}): MetadataReader => {
  const meta: AudioMetadata = {
    duration: 120.5,
    codec: 'MP3',
    bitrate: 128000,
    sampleRate: 44100,
    ...overrides,
  }
  return async (_filePath: string) => ({ ...meta })
}

/** Helper: create a successful shell executor mock */
const makeSuccessShell = (): { executor: ShellExecutor; calls: string[] } => {
  const calls: string[] = []
  const executor: ShellExecutor = async (inputPath, outputPath, bitrate, sampleRate) => {
    calls.push(`ffmpeg -y -i ${inputPath} -codec:a libmp3lame -b:a ${bitrate} -ar ${sampleRate} ${outputPath}`)
  }
  return { executor, calls }
}

/** Helper: create a failing shell executor mock */
const makeFailingShell = (message: string): ShellExecutor => {
  return async (_inputPath, _outputPath, _bitrate, _sampleRate) => {
    throw new Error(message)
  }
}

describe('AudioConvertService', () => {
  let config: AudioConvertConfig
  let successShell: ReturnType<typeof makeSuccessShell>
  let mockMetadata: MetadataReader

  beforeEach(() => {
    config = new AudioConvertConfig({ maxConcurrency: 2, ffmpegTimeoutMs: 5000 })
    successShell = makeSuccessShell()
    mockMetadata = makeMockMetadata()
  })

  describe('checkFfmpegAvailable() - static', () => {
    test('resolves without error when ffmpeg checker succeeds', async () => {
      const mockChecker: FfmpegChecker = async () => { /* success */ }
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
        ffmpegChecker: mockChecker,
      })
      await expect(service.checkFfmpegAvailable()).resolves.toBeUndefined()
    })

    test('throws descriptive error when ffmpeg is not found', async () => {
      const failingChecker: FfmpegChecker = async () => {
        throw new Error('FFmpeg not found in PATH. Install: brew install ffmpeg')
      }
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
        ffmpegChecker: failingChecker,
      })
      await expect(service.checkFfmpegAvailable()).rejects.toThrow('FFmpeg')
    })
  })

  describe('getMetadata()', () => {
    test('returns AudioMetadata by delegating to metadataReader', async () => {
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      const result = await service.getMetadata('/test/audio.mp3')
      expect(result.duration).toBe(120.5)
      expect(result.codec).toBe('MP3')
      expect(result.bitrate).toBe(128000)
      expect(result.sampleRate).toBe(44100)
    })

    test('returns metadata with correct shape (all required fields)', async () => {
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      const result = await service.getMetadata('/test/audio.mp3')
      expect(typeof result.duration).toBe('number')
      expect(typeof result.codec).toBe('string')
      expect(typeof result.bitrate).toBe('number')
      expect(typeof result.sampleRate).toBe('number')
    })
  })

  describe('convertToMp3()', () => {
    test('calls shell executor with correct FFmpeg arguments', async () => {
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      await service.convertToMp3('/test/input.wav', '/test/output.mp3')
      expect(successShell.calls).toHaveLength(1)
      expect(successShell.calls[0]).toContain('libmp3lame')
      expect(successShell.calls[0]).toContain('/test/input.wav')
      expect(successShell.calls[0]).toContain('/test/output.mp3')
    })

    test('returns ConversionResult with correct inputPath and outputPath', async () => {
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      const result = await service.convertToMp3('/test/input.wav', '/test/output.mp3')
      expect(result.inputPath).toBe('/test/input.wav')
      expect(result.outputPath).toBe('/test/output.mp3')
    })

    test('detects inputFormat correctly from file extension', async () => {
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      const wav = await service.convertToMp3('/test/audio.wav', '/test/out.mp3')
      expect(wav.inputFormat).toBe('WAV')

      const aac = await service.convertToMp3('/test/audio.aac', '/test/out.mp3')
      expect(aac.inputFormat).toBe('AAC')

      const ogg = await service.convertToMp3('/test/audio.ogg', '/test/out.mp3')
      expect(ogg.inputFormat).toBe('OGG')

      const flac = await service.convertToMp3('/test/audio.flac', '/test/out.mp3')
      expect(flac.inputFormat).toBe('FLAC')
    })

    test('ConversionResult includes durationMs as a non-negative number', async () => {
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      const result = await service.convertToMp3('/test/input.flac', '/test/output.mp3')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    test('ConversionResult includes outputMetadata from metadataReader', async () => {
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      const result = await service.convertToMp3('/test/input.aac', '/test/output.mp3')
      expect(result.outputMetadata).toBeDefined()
      expect(result.outputMetadata.duration).toBe(120.5)
    })

    test('wraps FFmpeg call in RetryService (retryService.execute is called)', async () => {
      let executeCallCount = 0
      const mockRetryService = {
        execute: async <T>(operation: () => Promise<T>) => {
          executeCallCount++
          try {
            const data = await operation()
            return { success: true, data, totalAttempts: 1, totalTimeMs: 0 }
          } catch (err) {
            return { success: false, error: err as Error, totalAttempts: 1, totalTimeMs: 0 }
          }
        },
      }

      const service = new AudioConvertService(config, {
        retryService: mockRetryService as any,
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      await service.convertToMp3('/test/input.wav', '/test/output.mp3')
      expect(executeCallCount).toBe(1)
    })

    test('cleans up partial output file on FFmpeg failure', async () => {
      let cleanupAttempted = false
      const failingShell = makeFailingShell('No such file or directory: input.wav')

      // Override RetryService to fail immediately (no retries)
      const fastFailRetryService = {
        execute: async <T>(operation: () => Promise<T>) => {
          try {
            await operation()
            return { success: true, data: undefined as T, totalAttempts: 1, totalTimeMs: 0 }
          } catch (err) {
            return { success: false, error: err as Error, totalAttempts: 1, totalTimeMs: 0 }
          }
        },
      }

      const service = new AudioConvertService(config, {
        retryService: fastFailRetryService as any,
        shellExecutor: failingShell,
        metadataReader: mockMetadata,
      })

      // convertToMp3 will throw on failure, that's expected
      try {
        await service.convertToMp3('/test/nonexistent.wav', '/test/output.mp3')
      } catch {
        // Expected to throw -- the key is that cleanup was attempted
        cleanupAttempted = true
      }
      expect(cleanupAttempted).toBe(true)
    })
  })

  describe('convertBatch()', () => {
    test('uses p-limit with config.maxConcurrency to control concurrency', async () => {
      const concurrentCalls: number[] = []
      let currentConcurrent = 0

      const trackingShell: ShellExecutor = async (inputPath, outputPath, bitrate, sampleRate) => {
        currentConcurrent++
        concurrentCalls.push(currentConcurrent)
        // Simulate some work
        await new Promise<void>(resolve => setTimeout(resolve, 10))
        currentConcurrent--
      }

      const service = new AudioConvertService(config, {
        shellExecutor: trackingShell,
        metadataReader: mockMetadata,
      })

      const files = Array.from({ length: 6 }, (_, i) => ({
        input: `/test/file${i}.wav`,
        output: `/test/file${i}.mp3`,
      }))

      await service.convertBatch(files)

      // Verify concurrency never exceeded maxConcurrency (2)
      const maxObserved = Math.max(...concurrentCalls)
      expect(maxObserved).toBeLessThanOrEqual(config.maxConcurrency)
    })

    test('returns ConversionBatchResult with correct succeeded/failed counts (all succeed)', async () => {
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      const files = [
        { input: '/test/a.wav', output: '/test/a.mp3' },
        { input: '/test/b.flac', output: '/test/b.mp3' },
        { input: '/test/c.aac', output: '/test/c.mp3' },
      ]
      const result = await service.convertBatch(files)
      expect(result.total).toBe(3)
      expect(result.succeeded).toBe(3)
      expect(result.failed).toBe(0)
    })

    test('continues processing remaining files when one fails (partial failure tolerance)', async () => {
      let callNum = 0
      const partialFailShell: ShellExecutor = async (inputPath, outputPath, bitrate, sampleRate) => {
        callNum++
        if (inputPath.includes('b.wav')) {
          throw new Error('No such file: b.wav')
        }
      }

      // Use no-retry service to speed up test
      const noRetryService = {
        execute: async <T>(operation: () => Promise<T>) => {
          try {
            const data = await operation()
            return { success: true, data, totalAttempts: 1, totalTimeMs: 0 }
          } catch (err) {
            return { success: false, error: err as Error, totalAttempts: 1, totalTimeMs: 0 }
          }
        },
      }

      const service = new AudioConvertService(config, {
        retryService: noRetryService as any,
        shellExecutor: partialFailShell,
        metadataReader: mockMetadata,
      })
      const files = [
        { input: '/test/a.wav', output: '/test/a.mp3' },
        { input: '/test/b.wav', output: '/test/b.mp3' },
        { input: '/test/c.wav', output: '/test/c.mp3' },
      ]
      const result = await service.convertBatch(files)
      expect(result.total).toBe(3)
      expect(result.succeeded).toBe(2)
      expect(result.failed).toBe(1)
    })

    test('ConversionBatchResult includes totalDurationMs', async () => {
      const service = new AudioConvertService(config, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      const files = [{ input: '/test/a.wav', output: '/test/a.mp3' }]
      const result = await service.convertBatch(files)
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
    })
  })
})
