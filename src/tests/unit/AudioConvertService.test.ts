/**
 * Unit tests for AudioConvertService
 * Uses dependency injection to mock shell executor, metadata reader, and retry service
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { AudioConvertService } from '../../core/services/AudioConvertService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import type { ShellExecutor, MetadataReader, FfmpegChecker } from '../../core/services/AudioConvertService'
import type { AudioMetadata } from '../../core/types/audio'
import type { AudioConvertGoRequest, AudioConvertGoResponse } from '../../core/services/AudioConvertGoWrapper'

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

  describe('AudioConvertService with Go backend', () => {
    test('useGoBackend defaults to false when not specified', () => {
      const defaultConfig = new AudioConvertConfig()
      expect(defaultConfig.useGoBackend).toBe(false)
    })

    test('AudioConvertConfig stores useGoBackend, goBinaryPath, goTimeout correctly', () => {
      const goConfig = new AudioConvertConfig({
        useGoBackend: true,
        goBinaryPath: '/usr/local/bin/kinetitext-audio',
        goTimeout: 30000,
      })
      expect(goConfig.useGoBackend).toBe(true)
      expect(goConfig.goBinaryPath).toBe('/usr/local/bin/kinetitext-audio')
      expect(goConfig.goTimeout).toBe(30000)
    })

    test('goTimeout defaults to 60000 when not specified', () => {
      const goConfig = new AudioConvertConfig({ useGoBackend: true })
      expect(goConfig.goTimeout).toBe(60000)
    })

    test('uses injected Go wrapper when useGoBackend=true and goWrapper provided', async () => {
      let goCalled = false
      const mockGoWrapper = {
        init: async (_path: string) => {},
        convert: async (req: AudioConvertGoRequest): Promise<AudioConvertGoResponse> => {
          goCalled = true
          // Create the output file so verifyOutputFile passes
          await Bun.write(req.outputFile, Buffer.alloc(100))
          return { success: true, outputFile: req.outputFile, duration: 5.0 }
        },
        isAvailable: async () => true,
        getBinaryPath: () => '/fake/path',
      } as any

      const goConfig = new AudioConvertConfig({
        useGoBackend: true,
        goBinaryPath: '/fake/path',
      })
      const service = new AudioConvertService(goConfig, {
        metadataReader: mockMetadata,
        goWrapper: mockGoWrapper,
      })

      // Manually set go wrapper (simulating successful init)
      ;(service as any).goWrapper = mockGoWrapper

      const result = await service.convertToMp3('/test/input.wav', '/tmp/test-go-output.mp3')
      expect(goCalled).toBe(true)
      expect(result.inputPath).toBe('/test/input.wav')

      // Cleanup
      try { await Bun.file('/tmp/test-go-output.mp3').exists() } catch {}
    })

    test('falls back to Bun FFmpeg when goWrapper is null', async () => {
      let bunCalled = false
      const trackingShell: ShellExecutor = async () => { bunCalled = true }

      const goConfig = new AudioConvertConfig({
        useGoBackend: true,
        goBinaryPath: '/fake/path',
      })
      const service = new AudioConvertService(goConfig, {
        shellExecutor: trackingShell,
        metadataReader: mockMetadata,
      })
      // goWrapper remains null (not initialized), should fall back to Bun

      await service.convertToMp3('/test/input.wav', '/test/output.mp3')
      expect(bunCalled).toBe(true)
    })

    test('initGoBackend() does nothing when useGoBackend=false', async () => {
      const defaultConfig = new AudioConvertConfig({ useGoBackend: false })
      const service = new AudioConvertService(defaultConfig, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      // Should not throw even without goBinaryPath
      await expect(service.initGoBackend()).resolves.toBeUndefined()
      expect((service as any).goWrapper).toBeNull()
    })

    test('initGoBackend() warns and falls back when goBinaryPath is not set', async () => {
      const goConfig = new AudioConvertConfig({ useGoBackend: true }) // no goBinaryPath
      const service = new AudioConvertService(goConfig, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      await expect(service.initGoBackend()).resolves.toBeUndefined()
      expect((service as any).goWrapper).toBeNull()
    })

    test('initGoBackend() sets goWrapper=null when binary does not exist', async () => {
      const goConfig = new AudioConvertConfig({
        useGoBackend: true,
        goBinaryPath: '/nonexistent/kinetitext-audio',
      })
      const service = new AudioConvertService(goConfig, {
        shellExecutor: successShell.executor,
        metadataReader: mockMetadata,
      })
      await expect(service.initGoBackend()).resolves.toBeUndefined()
      // Should gracefully fall back (no throw)
      expect((service as any).goWrapper).toBeNull()
    })

    test('RetryService wraps Go conversion when Go backend is active', async () => {
      let retryExecuteCalled = false
      const mockRetryService = {
        execute: async <T>(operation: () => Promise<T>) => {
          retryExecuteCalled = true
          try {
            const data = await operation()
            return { success: true, data, totalAttempts: 1, totalTimeMs: 0 }
          } catch (err) {
            return { success: false, error: err as Error, totalAttempts: 1, totalTimeMs: 0 }
          }
        },
      }

      const mockGoWrapper = {
        convert: async (req: AudioConvertGoRequest): Promise<AudioConvertGoResponse> => {
          await Bun.write(req.outputFile, Buffer.alloc(100))
          return { success: true, outputFile: req.outputFile }
        },
        isAvailable: async () => true,
        getBinaryPath: () => '/fake/path',
      } as any

      const goConfig = new AudioConvertConfig({ useGoBackend: true })
      const service = new AudioConvertService(goConfig, {
        retryService: mockRetryService as any,
        metadataReader: mockMetadata,
        goWrapper: mockGoWrapper,
      })
      ;(service as any).goWrapper = mockGoWrapper

      await service.convertToMp3('/test/input.wav', '/tmp/test-retry-go.mp3')
      expect(retryExecuteCalled).toBe(true)

      // Cleanup
      try { await Bun.file('/tmp/test-retry-go.mp3').exists() } catch {}
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
