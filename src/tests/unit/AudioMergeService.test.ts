/**
 * Unit tests for AudioMergeService
 * Uses dependency injection for shell executor, duration service, and retry service
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { AudioMergeService } from '../../core/services/AudioMergeService'
import { DurationService } from '../../core/services/DurationService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import type { MergeShellExecutor } from '../../core/services/AudioMergeService'

/** Helper: create a success merge shell executor */
const makeSuccessMergeShell = (): { executor: MergeShellExecutor; calls: Array<{ listContent: string; outputPath: string }> } => {
  const calls: Array<{ listContent: string; outputPath: string }> = []
  const executor: MergeShellExecutor = async (listContent, outputPath) => {
    calls.push({ listContent, outputPath })
  }
  return { executor, calls }
}

/** Helper: create a failing merge shell executor */
const makeFailingMergeShell = (message: string): MergeShellExecutor => {
  return async (_listContent, _outputPath) => {
    throw new Error(message)
  }
}

/** Pre-computed file list with durations for grouping tests */
const makeFileList = (durations: number[]): Array<{ path: string; duration: number }> =>
  durations.map((d, i) => ({ path: `/test/file${i}.mp3`, duration: d }))

describe('AudioMergeService', () => {
  let config: AudioConvertConfig
  let successShell: ReturnType<typeof makeSuccessMergeShell>

  beforeEach(() => {
    config = new AudioConvertConfig({ maxConcurrency: 2, ffmpegTimeoutMs: 5000 })
    successShell = makeSuccessMergeShell()
  })

  describe('groupByDuration() - greedy sequential algorithm', () => {
    test('groups files into single group when total is within target', async () => {
      // 3 files of 3.5h each = 10.5h total, within 11h ±10% (9.9h - 12.1h)
      const files = makeFileList([12600, 12600, 12600])
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const groups = await service.groupByDuration(files, 39600, 10)
      expect(groups).toHaveLength(1)
      expect(groups[0].files).toHaveLength(3)
    })

    test('groups 3 files of 4h into [4h,4h] and [4h] because 3x4h=12h exceeds 11h*1.1=12.1h... actually within', async () => {
      // Per plan: 3 files each 4h (14400s)
      // Target 11h (39600), upper bound = 43560
      // First two: 28800 (8h) -- adding third: 43200 (12h) < 43560, so all 3 fit!
      // The plan example says [4h, 4h] + [4h] but that's because 12h IS within tolerance
      // Let's use 5h files (18000s) to get expected split behavior
      // 2x5h = 36000 (within), 3x5h = 54000 > 43560, so we get [5h, 5h] + [5h]
      const files = makeFileList([18000, 18000, 18000]) // 3 files of 5h each
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const groups = await service.groupByDuration(files, 39600, 10)
      // 18000+18000=36000 within tolerance, adding 3rd: 54000 > 43560, so split
      expect(groups).toHaveLength(2)
      expect(groups[0].files).toHaveLength(2)
      expect(groups[1].files).toHaveLength(1)
    })

    test('groups 6 files of 2h into expected batches', async () => {
      // 2h = 7200s each. Target 11h (39600), upper = 43560
      // 5 files = 36000 (within tolerance), 6th would be 43200 (within tolerance too!)
      // 6 * 7200 = 43200 < 43560, so all 6 fit in one group
      // Use 2.2h files (7920s): 5*7920=39600 exactly, 6th would push to 47520 > 43560
      const files = makeFileList([7920, 7920, 7920, 7920, 7920, 7920])
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const groups = await service.groupByDuration(files, 39600, 10)
      expect(groups).toHaveLength(2)
      expect(groups[0].files).toHaveLength(5)
      expect(groups[1].files).toHaveLength(1)
    })

    test('returns empty array for empty input', async () => {
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const groups = await service.groupByDuration([], 39600, 10)
      expect(groups).toHaveLength(0)
    })

    test('returns single group with single file when only one file provided', async () => {
      const files = makeFileList([3600])
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const groups = await service.groupByDuration(files, 39600, 10)
      expect(groups).toHaveLength(1)
      expect(groups[0].files).toHaveLength(1)
      expect(groups[0].files[0]).toBe('/test/file0.mp3')
    })

    test('single oversized file (exceeds upper bound alone) forms its own group', async () => {
      // File is 50h (180000s), way over 11h + 10% = 43560
      const files = makeFileList([180000])
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const groups = await service.groupByDuration(files, 39600, 10)
      expect(groups).toHaveLength(1)
      expect(groups[0].files).toHaveLength(1)
    })

    test('each group has correct estimatedDuration', async () => {
      const files = makeFileList([18000, 18000, 18000]) // 3 * 5h
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const groups = await service.groupByDuration(files, 39600, 10)
      expect(groups[0].estimatedDuration).toBe(36000) // 2 * 5h
      expect(groups[1].estimatedDuration).toBe(18000) // 1 * 5h
    })
  })

  describe('mergeFiles()', () => {
    test('invokes shell executor with correct outputPath', async () => {
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      await service.mergeFiles(['/test/a.mp3', '/test/b.mp3'], '/output/merged.mp3')
      expect(successShell.calls).toHaveLength(1)
      expect(successShell.calls[0].outputPath).toBe('/output/merged.mp3')
    })

    test('concat list contains file paths with correct format', async () => {
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      await service.mergeFiles(['/test/a.mp3', '/test/b.mp3'], '/output/merged.mp3')
      const listContent = successShell.calls[0].listContent
      expect(listContent).toContain("file '/test/a.mp3'")
      expect(listContent).toContain("file '/test/b.mp3'")
    })

    test('returns MergeResult with correct outputPath and fileCount', async () => {
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const result = await service.mergeFiles(['/test/a.mp3', '/test/b.mp3', '/test/c.mp3'], '/output/merged.mp3')
      expect(result.outputPath).toBe('/output/merged.mp3')
      expect(result.fileCount).toBe(3)
    })

    test('returns MergeResult with non-negative durationMs', async () => {
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const result = await service.mergeFiles(['/test/a.mp3'], '/output/merged.mp3')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    test('wraps shell call in RetryService (execute is called)', async () => {
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

      const service = new AudioMergeService(config, {
        retryService: mockRetryService as any,
        shellExecutor: successShell.executor,
      })
      await service.mergeFiles(['/test/a.mp3'], '/output/merged.mp3')
      expect(executeCallCount).toBe(1)
    })

    test('throws on failure (retry service reports failure)', async () => {
      const failingShell = makeFailingMergeShell('concat failed')
      const noRetryService = {
        execute: async <T>(operation: () => Promise<T>) => {
          try {
            await operation()
            return { success: true, data: undefined as T, totalAttempts: 1, totalTimeMs: 0 }
          } catch (err) {
            return { success: false, error: err as Error, totalAttempts: 1, totalTimeMs: 0 }
          }
        },
      }
      const service = new AudioMergeService(config, {
        retryService: noRetryService as any,
        shellExecutor: failingShell,
      })
      await expect(service.mergeFiles(['/test/a.mp3'], '/output/merged.mp3')).rejects.toThrow()
    })
  })

  describe('mergeGroup()', () => {
    test('outputs to correct path with padded group index', async () => {
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const group = { files: ['/test/a.mp3', '/test/b.mp3'], estimatedDuration: 7200 }
      const result = await service.mergeGroup(group, '/output', 0)
      expect(result.outputPath).toBe('/output/merged_001.mp3')
    })

    test('second group (index 1) outputs with _002 suffix', async () => {
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const group = { files: ['/test/c.mp3'], estimatedDuration: 3600 }
      const result = await service.mergeGroup(group, '/output', 1)
      expect(result.outputPath).toBe('/output/merged_002.mp3')
    })

    test('custom namePrefix is applied to output filename', async () => {
      const service = new AudioMergeService(config, {
        shellExecutor: successShell.executor,
      })
      const group = { files: ['/test/a.mp3'], estimatedDuration: 3600 }
      const result = await service.mergeGroup(group, '/output', 0, 'book_vol')
      expect(result.outputPath).toBe('/output/book_vol_001.mp3')
    })
  })

  describe('buildConcatList() - single quote escaping', () => {
    test('escapes single quotes in file paths', async () => {
      const callCapture: string[] = []
      const captureShell: MergeShellExecutor = async (listContent, _outputPath) => {
        callCapture.push(listContent)
      }
      const service = new AudioMergeService(config, {
        shellExecutor: captureShell,
      })
      // File path with single quote
      await service.mergeFiles(["/test/it's a file.mp3"], '/output/merged.mp3')
      // Verify that single quote is properly escaped in the concat list
      expect(callCapture[0]).toContain("'\\''")
    })
  })
})
