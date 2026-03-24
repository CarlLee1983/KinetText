/**
 * E2E tests for Phase 3: Audio Merging (AudioMergeService.mergeBatch)
 * Validates batch grouping, duration accuracy, report structure, and performance.
 *
 * Scenarios:
 *   1. Batch merge (10+ MP3 files → GroupingReport)
 *   2. Duration calculation and post-merge validation (< 1% deviation)
 *   3. Grouping result validation (count, per-group durations)
 *   4. Performance benchmark (10 files within 5 minutes)
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AudioMergeService } from '../../core/services/AudioMergeService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import type { GroupingReport } from '../../core/types/audio'
import { verifyMP3File, getMp3Duration, assertDurationWithinPercent } from './utils'
import { getSample10MP3s, createTestSubDir } from './fixtures'

/** Maximum wall-clock time for the entire mergeBatch of 10 files */
const MAX_BATCH_TIME_MS = 5 * 60_000 // 5 minutes

/**
 * Test configuration:
 * - 10 files × 3s each = 30s total
 * - targetSeconds = 10s, tolerancePercent = 20 → upperBound = 12s
 * - Greedy grouping: groups of 4×3=12s until last partial group
 * - Expected: 2–3 groups
 */
const TARGET_SECONDS = 10
const TOLERANCE_PERCENT = 20

describe('E2E: Phase 3 - Audio Merging', () => {
  let service: AudioMergeService
  let mp3Files: string[]
  let suiteOutputRoot: string

  beforeAll(async () => {
    suiteOutputRoot = await mkdtemp(join(tmpdir(), 'e2e-merge-'))
    service = new AudioMergeService(new AudioConvertConfig())
    mp3Files = await getSample10MP3s('merge-input')
  }, 120_000)

  afterAll(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(suiteOutputRoot, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Scenario 1: Batch merge
  // -------------------------------------------------------------------------

  describe('Scenario 1: Batch merge (10 MP3 files → GroupingReport)', () => {
    let report: GroupingReport

    beforeAll(async () => {
      const outputDir = join(suiteOutputRoot, 'batch1')
      report = await service.mergeBatch(mp3Files, outputDir, {
        targetSeconds: TARGET_SECONDS,
        tolerancePercent: TOLERANCE_PERCENT,
        namePrefix: 'merged',
      })
    }, MAX_BATCH_TIME_MS)

    test('report has correct totalInputFiles count', () => {
      expect(report.totalInputFiles).toBe(10)
    })

    test('report has at least 1 group', () => {
      expect(report.totalGroups).toBeGreaterThanOrEqual(1)
    })

    test('succeeded + failed equals totalGroups', () => {
      expect(report.succeeded + report.failed).toBe(report.totalGroups)
    })

    test('all groups merged successfully', () => {
      expect(report.failed).toBe(0)
      expect(report.succeeded).toBe(report.totalGroups)
    })

    test('report carries target duration and tolerance', () => {
      expect(report.targetDurationSeconds).toBe(TARGET_SECONDS)
      expect(report.tolerancePercent).toBe(TOLERANCE_PERCENT)
    })

    test('generatedAt is a valid ISO 8601 timestamp', () => {
      expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt)
    })

    test('each group output MP3 is a valid MP3 file', async () => {
      for (const group of report.groups) {
        await verifyMP3File(group.outputPath)
      }
    }, 30_000)

    test('all 10 input files are distributed across groups', () => {
      const allFiles = report.groups.flatMap(g => [...g.inputFiles])
      expect(allFiles).toHaveLength(10)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 2: Duration calculation and post-merge validation
  // -------------------------------------------------------------------------

  describe('Scenario 2: Duration calculation and post-merge validation', () => {
    let report: GroupingReport

    beforeAll(async () => {
      const outputDir = join(suiteOutputRoot, 'duration')
      report = await service.mergeBatch(mp3Files, outputDir, {
        targetSeconds: TARGET_SECONDS,
        tolerancePercent: TOLERANCE_PERCENT,
      })
    }, MAX_BATCH_TIME_MS)

    test('each group actualDuration is within 1% of estimatedDuration', () => {
      for (const group of report.groups) {
        assertDurationWithinPercent(group.actualDuration, group.estimatedDuration, 1)
      }
    })

    test('each group actualDuration is re-read from the merged file', async () => {
      for (const group of report.groups) {
        const measured = await getMp3Duration(group.outputPath)
        // actualDuration in report should match direct file measurement within 1%
        assertDurationWithinPercent(group.actualDuration, measured, 1)
      }
    }, 30_000)

    test('totalInputDurationSeconds matches sum of group estimatedDurations', () => {
      const sumEstimated = report.groups.reduce(
        (acc, g) => acc + g.estimatedDuration, 0
      )
      // Allow ±2% due to floating-point accumulation
      const deviation = Math.abs(report.totalInputDurationSeconds - sumEstimated) / sumEstimated * 100
      expect(deviation).toBeLessThan(2)
    })

    test('totalInputDurationSeconds is close to 10 × 3s = 30s', () => {
      // 10 files × 3s each
      expect(report.totalInputDurationSeconds).toBeGreaterThan(28)
      expect(report.totalInputDurationSeconds).toBeLessThan(32)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 3: Grouping result validation
  // -------------------------------------------------------------------------

  describe('Scenario 3: Grouping result validation', () => {
    let report: GroupingReport

    beforeAll(async () => {
      const outputDir = join(suiteOutputRoot, 'grouping')
      report = await service.mergeBatch(mp3Files, outputDir, {
        targetSeconds: TARGET_SECONDS,
        tolerancePercent: TOLERANCE_PERCENT,
      })
    }, MAX_BATCH_TIME_MS)

    test('each group has at least 1 file', () => {
      for (const group of report.groups) {
        expect(group.inputFiles.length).toBeGreaterThanOrEqual(1)
      }
    })

    test('group indices are sequential starting from 0', () => {
      report.groups.forEach((group, idx) => {
        expect(group.groupIndex).toBe(idx)
      })
    })

    test('each group mergeResult references the same outputPath', () => {
      for (const group of report.groups) {
        expect(group.mergeResult.outputPath).toBe(group.outputPath)
      }
    })

    test('each group mergeResult.fileCount equals inputFiles.length', () => {
      for (const group of report.groups) {
        expect(group.mergeResult.fileCount).toBe(group.inputFiles.length)
      }
    })

    test('each group estimatedDuration does not exceed upper tolerance bound or is oversized', () => {
      const upperBound = TARGET_SECONDS * (1 + TOLERANCE_PERCENT / 100)
      for (const group of report.groups) {
        if (!group.oversizedSingleFile) {
          // Non-oversized groups must stay within the upper bound
          expect(group.estimatedDuration).toBeLessThanOrEqual(upperBound + 0.01)
        }
      }
    })

    test('empty input returns empty report', async () => {
      const outputDir = join(suiteOutputRoot, 'empty')
      const emptyReport = await service.mergeBatch([], outputDir, {})

      expect(emptyReport.totalInputFiles).toBe(0)
      expect(emptyReport.totalGroups).toBe(0)
      expect(emptyReport.groups).toEqual([])
      expect(emptyReport.succeeded).toBe(0)
      expect(emptyReport.failed).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 4: Performance benchmark
  // -------------------------------------------------------------------------

  describe('Scenario 4: Performance benchmark', () => {
    test('mergeBatch of 10 files completes within 5 minutes', async () => {
      const outputDir = join(suiteOutputRoot, 'perf')
      const start = Date.now()

      const report = await service.mergeBatch(mp3Files, outputDir, {
        targetSeconds: TARGET_SECONDS,
        tolerancePercent: TOLERANCE_PERCENT,
      })

      const elapsed = Date.now() - start

      expect(report.succeeded).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(MAX_BATCH_TIME_MS)
    }, MAX_BATCH_TIME_MS)

    test('each group merge durationMs is recorded', async () => {
      const outputDir = join(suiteOutputRoot, 'perf2')
      const report = await service.mergeBatch(mp3Files, outputDir, {
        targetSeconds: TARGET_SECONDS,
        tolerancePercent: TOLERANCE_PERCENT,
      })

      for (const group of report.groups) {
        expect(group.mergeResult.durationMs).toBeGreaterThan(0)
      }
    }, MAX_BATCH_TIME_MS)
  })
})
