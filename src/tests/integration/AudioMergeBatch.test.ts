/**
 * Integration tests for AudioMergeService.mergeBatch() pipeline
 * Uses real FFmpeg to generate and merge test MP3 files in batches
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { $ } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AudioMergeService } from '../../core/services/AudioMergeService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import type { GroupingReport } from '../../core/types/audio'

describe('AudioMerge Batch Pipeline (Integration)', () => {
  let inputDir: string
  let outputDir: string
  let filePaths: string[]
  const FILE_COUNT = 10
  const FILE_DURATION_SECONDS = 3 // 短暫靜音檔案以加快測試速度

  beforeAll(async () => {
    // 建立暫存目錄
    inputDir = await mkdtemp(join(tmpdir(), 'kinetitext-batch-input-'))
    outputDir = await mkdtemp(join(tmpdir(), 'kinetitext-batch-output-'))

    // 使用 FFmpeg 生成 FILE_COUNT 個靜音 MP3 檔案
    filePaths = []
    for (let i = 0; i < FILE_COUNT; i++) {
      const fileName = `test_${(i + 1).toString().padStart(3, '0')}.mp3`
      const filePath = join(inputDir, fileName)
      await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${FILE_DURATION_SECONDS} -q:a 9 ${filePath}`.quiet()
      filePaths.push(filePath)
    }
  }, 120000)

  afterAll(async () => {
    await rm(inputDir, { recursive: true, force: true })
    await rm(outputDir, { recursive: true, force: true })
  })

  // 測試配置說明:
  // 10 個檔案，每個 3s，目標 10s，容差 20%，上界 = 12s
  // 貪心演算法: [3+3+3=9s <= 12s, 加第4個: 12s <= 12s] → [3+3+3+3=12s]
  // 剩餘 6 個: [3+3+3=9s, 加第4個: 12s <= 12s] → [3+3+3+3=12s]
  // 剩餘 2 個: [3+3=6s] → 共 3 組

  test('mergeBatch produces correct report structure', async () => {
    const service = new AudioMergeService(new AudioConvertConfig())
    const report: GroupingReport = await service.mergeBatch(filePaths, join(outputDir, 'test1'), {
      targetSeconds: 10,
      tolerancePercent: 20,
      namePrefix: 'batch_test',
    })

    expect(report.totalInputFiles).toBe(FILE_COUNT)
    expect(report.totalGroups).toBeGreaterThan(0)
    expect(report.succeeded).toBe(report.totalGroups)
    expect(report.failed).toBe(0)
    expect(report.targetDurationSeconds).toBe(10)
    expect(report.tolerancePercent).toBe(20)
    // 驗證 ISO 8601 時間戳
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt)
  }, 60000)

  test('each group actualDuration within 1% of estimatedDuration', async () => {
    const service = new AudioMergeService(new AudioConvertConfig())
    const report = await service.mergeBatch(filePaths, join(outputDir, 'test2'), {
      targetSeconds: 10,
      tolerancePercent: 20,
    })

    for (const group of report.groups) {
      const diffPercent = Math.abs(group.actualDuration - group.estimatedDuration) / group.estimatedDuration * 100
      expect(diffPercent).toBeLessThan(1) // < 1% 誤差 (R1.2.3)
    }
  }, 60000)

  test('output files exist and have valid MP3 codec', async () => {
    const { parseFile } = await import('music-metadata')
    const service = new AudioMergeService(new AudioConvertConfig())
    const report = await service.mergeBatch(filePaths, join(outputDir, 'test3'), {
      targetSeconds: 10,
      tolerancePercent: 20,
    })

    for (const group of report.groups) {
      const file = Bun.file(group.outputPath)
      expect(await file.exists()).toBe(true)
      expect(file.size).toBeGreaterThan(0)

      const meta = await parseFile(group.outputPath)
      expect(meta.format.codec).toContain('MPEG')
    }
  }, 60000)

  test('empty input returns empty report', async () => {
    const service = new AudioMergeService(new AudioConvertConfig())
    const report = await service.mergeBatch([], join(outputDir, 'empty'), {})

    expect(report.totalInputFiles).toBe(0)
    expect(report.totalGroups).toBe(0)
    expect(report.succeeded).toBe(0)
    expect(report.failed).toBe(0)
    expect(report.groups).toEqual([])
  })

  test('GroupingReport contains per-group inputFiles lists', async () => {
    const service = new AudioMergeService(new AudioConvertConfig())
    const report = await service.mergeBatch(filePaths, join(outputDir, 'test5'), {
      targetSeconds: 10,
      tolerancePercent: 20,
    })

    // 所有輸入檔案都應該分配到某個群組
    const allInputFiles = report.groups.flatMap(g => [...g.inputFiles])
    expect(allInputFiles).toHaveLength(FILE_COUNT)
  }, 60000)

  test('GroupingReport.totalInputDurationSeconds matches sum of all files', async () => {
    const service = new AudioMergeService(new AudioConvertConfig())
    const report = await service.mergeBatch(filePaths, join(outputDir, 'test6'), {
      targetSeconds: 10,
      tolerancePercent: 20,
    })

    // 總時長應接近 FILE_COUNT * FILE_DURATION_SECONDS（允許些許誤差）
    const expectedTotal = FILE_COUNT * FILE_DURATION_SECONDS
    expect(report.totalInputDurationSeconds).toBeGreaterThan(expectedTotal * 0.95)
    expect(report.totalInputDurationSeconds).toBeLessThan(expectedTotal * 1.05)
  }, 60000)
})
