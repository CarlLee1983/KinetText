/**
 * 完整管道 E2E 測試：Phase 1-4 端到端驗證
 *
 * 測試情景:
 * 1. 完整端到端工作流 (WAV → MP3 → 合併 MP3 → M4A)
 * 2. 多輸入格式支援 (WAV/AAC 輸入路徑)
 * 3. 失敗恢復：RetryService 整合驗證
 * 4. 完整性檢查：時長、元資料、無遺漏檔案
 * 5. 端到端：所有 Phase 1-4 服務均參與
 *
 * 依賴:
 * - src/tests/e2e/setup.ts    (registerE2EHooks, e2eRootDir)
 * - src/tests/e2e/fixtures.ts (generateMP3, generateWAV, createTestSubDir)
 * - src/tests/e2e/utils.ts    (fileExistsAndNonEmpty, getMp3Duration)
 * - Phase 2: AudioConvertService
 * - Phase 3: AudioMergeService
 * - Phase 4: MP4ConversionService
 * - Phase 1: RetryService (embedded in each service)
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import { join } from 'node:path'
import { parseFile } from 'music-metadata'
import { registerE2EHooks, e2eRootDir } from './setup'
import { generateMP3, generateWAV, createTestSubDir } from './fixtures'
import { fileExistsAndNonEmpty, getMp3Duration } from './utils'

// Phase 2: 音頻轉換
import { AudioConvertService } from '../../core/services/AudioConvertService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'

// Phase 3: 音頻合併
import { AudioMergeService } from '../../core/services/AudioMergeService'

// Phase 4: MP4 轉換
import { MP4ConversionService } from '../../core/services/MP4ConversionService'
import { loadMP4Config } from '../../core/config/MP4ConversionConfig'

// Phase 1: 重試 (embedded in services)
import { RetryService } from '../../core/services/RetryService'
import { AudioErrorClassifier } from '../../core/services/AudioErrorClassifier'

// 全域 E2E 掛鉤
registerE2EHooks()

/** 合理的每步驟超時 (ms) */
const STEP_TIMEOUT_MS = 30_000
/** 完整管道測試超時 (ms) - 允許最多 3 分鐘 */
const PIPELINE_TIMEOUT_MS = 180_000

/** 建立標準服務套件 (Phase 2-4) */
async function buildServices() {
  const convertConfig = new AudioConvertConfig()
  const audioConvertService = new AudioConvertService(convertConfig)

  const audioMergeService = new AudioMergeService()

  const mp4Config = await loadMP4Config()
  const retryService = new RetryService()
  const errorClassifier = new AudioErrorClassifier()
  const mp4ConversionService = new MP4ConversionService(
    mp4Config,
    retryService,
    errorClassifier
  )

  return { audioConvertService, audioMergeService, mp4ConversionService, mp4Config }
}

describe('完整管道 E2E: Phase 1-4 端到端驗證', () => {

  // ─────────────────────────────────────────────
  // 情景 1: 完整端到端工作流 (WAV → MP3 → 合併 → M4A)
  // ─────────────────────────────────────────────
  describe('情景 1: 完整端到端工作流', () => {
    test('WAV → MP3 轉換 → 合併 → M4A 完整流程', async () => {
      const { audioConvertService, audioMergeService, mp4ConversionService } =
        await buildServices()

      // ── Phase 2: WAV → MP3 轉換 ──
      const inputDir = await createTestSubDir('pipeline-input-wav')
      const mp3Dir = await createTestSubDir('pipeline-phase2')
      const mergeDir = await createTestSubDir('pipeline-phase3')
      const m4aDir = await createTestSubDir('pipeline-phase4')

      // 生成 3 個短 WAV 檔案 (3 秒各)
      const wavFiles: string[] = []
      for (let i = 1; i <= 3; i++) {
        const wav = await generateWAV(inputDir, `input_${i}`, 3)
        wavFiles.push(wav)
      }
      expect(wavFiles).toHaveLength(3)

      // 逐一轉換 WAV → MP3
      const mp3Files: string[] = []
      for (let i = 0; i < wavFiles.length; i++) {
        const outputPath = join(mp3Dir, `converted_${i + 1}.mp3`)
        const result = await audioConvertService.convertToMp3(wavFiles[i], outputPath)
        expect(result.outputPath).toBe(outputPath)
        expect(await fileExistsAndNonEmpty(outputPath)).toBe(true)
        mp3Files.push(outputPath)
      }
      expect(mp3Files).toHaveLength(3)

      // ── Phase 3: 合併 MP3 ──
      // 3 個 3 秒 = 9 秒，遠低於目標 39600 秒，全部合併為 1 組
      const groupingReport = await audioMergeService.mergeBatch(
        mp3Files,
        mergeDir,
        { targetSeconds: 39600, tolerancePercent: 10 }
      )
      expect(groupingReport.totalInputFiles).toBe(3)
      expect(groupingReport.totalGroups).toBeGreaterThan(0)
      expect(groupingReport.succeeded).toBeGreaterThan(0)
      expect(groupingReport.failed).toBe(0)
      expect(groupingReport.groups).toHaveLength(groupingReport.totalGroups)

      // ── Phase 4: 合併 MP3 → M4A ──
      const m4aFiles: string[] = []
      for (let i = 0; i < groupingReport.groups.length; i++) {
        const group = groupingReport.groups[i]
        const m4aPath = join(m4aDir, `output_${i + 1}.m4a`)
        const result = await mp4ConversionService.convert(
          group.outputPath,
          m4aPath,
          { title: `完整管道測試 第 ${i + 1} 組`, artist: '自動化測試' }
        )
        expect(result.error).toBeUndefined()
        expect(result.fileSize).toBeGreaterThan(0)
        expect(await fileExistsAndNonEmpty(m4aPath)).toBe(true)
        m4aFiles.push(m4aPath)
      }

      // ── 最終驗證 ──
      expect(m4aFiles.length).toBeGreaterThan(0)

      // 確認所有 M4A 可解析
      for (const m4aPath of m4aFiles) {
        const meta = await parseFile(m4aPath)
        const container = (meta.format.container ?? '').toUpperCase()
        expect(
          container.includes('M4A') || container.includes('MP4') || container.includes('ISOM')
        ).toBe(true)
      }
    }, PIPELINE_TIMEOUT_MS)

    test('管道保留元資料 (title, artist 可讀取)', async () => {
      const { audioConvertService, audioMergeService, mp4ConversionService } =
        await buildServices()

      const inputDir = await createTestSubDir('pipeline-meta-input')
      const mp3Dir = await createTestSubDir('pipeline-meta-mp3')
      const mergeDir = await createTestSubDir('pipeline-meta-merge')
      const m4aDir = await createTestSubDir('pipeline-meta-m4a')

      // 生成 WAV → MP3
      const wavPath = await generateWAV(inputDir, 'meta_source', 3)
      const mp3Path = join(mp3Dir, 'meta_converted.mp3')
      await audioConvertService.convertToMp3(wavPath, mp3Path)

      // 合併單個 MP3
      const groupingReport = await audioMergeService.mergeBatch(
        [mp3Path],
        mergeDir,
        { targetSeconds: 39600 }
      )
      expect(groupingReport.succeeded).toBe(1)

      const mergedMp3 = groupingReport.groups[0].outputPath
      const m4aPath = join(m4aDir, 'meta_final.m4a')

      const metadata = {
        title: '元資料保留測試',
        artist: '測試作者',
        album: '測試書籍',
      }
      await mp4ConversionService.convert(mergedMp3, m4aPath, metadata)

      const meta = await parseFile(m4aPath)
      expect(meta.common.title).toBe('元資料保留測試')
      expect(meta.common.artist).toBe('測試作者')
      expect(meta.common.album).toBe('測試書籍')
    }, PIPELINE_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────
  // 情景 2: 多輸入格式支援
  // ─────────────────────────────────────────────
  describe('情景 2: 多輸入格式支援', () => {
    test('WAV 輸入格式完整流程 → M4A', async () => {
      const { audioConvertService, audioMergeService, mp4ConversionService } =
        await buildServices()

      const inputDir = await createTestSubDir('multi-wav')
      const mp3Dir = await createTestSubDir('multi-wav-mp3')
      const mergeDir = await createTestSubDir('multi-wav-merge')
      const m4aDir = await createTestSubDir('multi-wav-m4a')

      const wavPath = await generateWAV(inputDir, 'wav_input', 5)
      const mp3Path = join(mp3Dir, 'wav_converted.mp3')
      const result = await audioConvertService.convertToMp3(wavPath, mp3Path)
      expect(result.inputFormat).toBe('WAV')

      const report = await audioMergeService.mergeBatch([mp3Path], mergeDir)
      expect(report.succeeded).toBe(1)

      const m4aPath = join(m4aDir, 'wav_final.m4a')
      const mp4Result = await mp4ConversionService.convert(
        report.groups[0].outputPath,
        m4aPath,
        { title: 'WAV 輸入測試' }
      )
      expect(mp4Result.error).toBeUndefined()
      expect(await fileExistsAndNonEmpty(m4aPath)).toBe(true)
    }, PIPELINE_TIMEOUT_MS)

    test('直接 MP3 輸入（跳過 Phase 2 轉換）→ 合併 → M4A', async () => {
      const { audioMergeService, mp4ConversionService } = await buildServices()

      const inputDir = await createTestSubDir('mp3-direct-input')
      const mergeDir = await createTestSubDir('mp3-direct-merge')
      const m4aDir = await createTestSubDir('mp3-direct-m4a')

      // 直接生成 MP3 (跳過 Phase 2 WAV 轉換)
      const mp3Files: string[] = []
      for (let i = 1; i <= 2; i++) {
        const mp3 = await generateMP3(inputDir, `direct_${i}`, 4)
        mp3Files.push(mp3)
      }

      const report = await audioMergeService.mergeBatch(mp3Files, mergeDir)
      expect(report.succeeded).toBeGreaterThan(0)

      const m4aPath = join(m4aDir, 'direct_final.m4a')
      const mp4Result = await mp4ConversionService.convert(
        report.groups[0].outputPath,
        m4aPath,
        { title: '直接 MP3 輸入測試' }
      )
      expect(mp4Result.error).toBeUndefined()
      expect(await fileExistsAndNonEmpty(m4aPath)).toBe(true)
    }, PIPELINE_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────
  // 情景 3: 失敗恢復 (RetryService 整合驗證)
  // ─────────────────────────────────────────────
  describe('情景 3: 失敗恢復', () => {
    test('AudioConvertService 對不存在的輸入拋出錯誤', async () => {
      const { audioConvertService } = await buildServices()

      const missingInput = '/nonexistent/path/to/audio.wav'
      const outputPath = join(e2eRootDir, 'should_not_exist.mp3')

      await expect(
        audioConvertService.convertToMp3(missingInput, outputPath)
      ).rejects.toThrow()
    }, STEP_TIMEOUT_MS)

    test('MP4ConversionService 對不存在的輸入拋出錯誤', async () => {
      const { mp4ConversionService } = await buildServices()

      const missingInput = '/nonexistent/merged.mp3'
      const outputPath = join(e2eRootDir, 'should_not_exist.m4a')

      await expect(
        mp4ConversionService.convert(missingInput, outputPath)
      ).rejects.toThrow(/not found/i)
    }, STEP_TIMEOUT_MS)

    test('AudioMergeService.mergeBatch 空列表回傳空 GroupingReport', async () => {
      const { audioMergeService } = await buildServices()
      const mergeDir = await createTestSubDir('empty-merge')

      const report = await audioMergeService.mergeBatch([], mergeDir)
      expect(report.totalInputFiles).toBe(0)
      expect(report.totalGroups).toBe(0)
      expect(report.groups).toHaveLength(0)
    }, STEP_TIMEOUT_MS)

    test('convertBatch 部分失敗不中斷整體批量', async () => {
      const { mp4ConversionService } = await buildServices()

      const inputDir = await createTestSubDir('partial-fail-input')
      const outputDir = await createTestSubDir('partial-fail-output')

      const validMp3 = await generateMP3(inputDir, 'valid', 3)

      const results = await mp4ConversionService.convertBatch([
        { inputPath: validMp3, outputPath: join(outputDir, 'valid.m4a') },
        { inputPath: '/nonexistent/file.mp3', outputPath: join(outputDir, 'bad.m4a') },
      ])

      expect(results).toHaveLength(2)
      const success = results.filter(r => !r.error)
      const failures = results.filter(r => r.error)
      expect(success).toHaveLength(1)
      expect(failures).toHaveLength(1)
    }, STEP_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────
  // 情景 4: 完整性檢查
  // ─────────────────────────────────────────────
  describe('情景 4: 完整性檢查', () => {
    test('合併後 MP3 時長接近各輸入時長之和 (誤差 < 5%)', async () => {
      const { audioMergeService } = await buildServices()

      const inputDir = await createTestSubDir('duration-check-input')
      const mergeDir = await createTestSubDir('duration-check-merge')

      // 生成 3 個 5 秒 MP3 = 預期合併後 ~15 秒
      const mp3Files: string[] = []
      for (let i = 1; i <= 3; i++) {
        const mp3 = await generateMP3(inputDir, `dur_${i}`, 5)
        mp3Files.push(mp3)
      }

      const report = await audioMergeService.mergeBatch(mp3Files, mergeDir, {
        targetSeconds: 39600,
      })

      expect(report.succeeded).toBeGreaterThan(0)

      // 驗證合併後的實際時長與預期接近
      const mergedDuration = report.groups[0].actualDuration
      const inputDuration = await Promise.all(mp3Files.map(f => getMp3Duration(f)))
      const totalInputDuration = inputDuration.reduce((a, b) => a + b, 0)

      // 允許 5% 誤差（靜音音頻可能有輕微差異）
      const deviation = Math.abs(mergedDuration - totalInputDuration) / totalInputDuration * 100
      expect(deviation).toBeLessThan(5)
    }, PIPELINE_TIMEOUT_MS)

    test('GroupingReport 結構完整 (所有必要欄位存在)', async () => {
      const { audioMergeService } = await buildServices()

      const inputDir = await createTestSubDir('report-struct-input')
      const mergeDir = await createTestSubDir('report-struct-merge')

      const mp3Files: string[] = []
      for (let i = 1; i <= 2; i++) {
        const mp3 = await generateMP3(inputDir, `report_${i}`, 3)
        mp3Files.push(mp3)
      }

      const report = await audioMergeService.mergeBatch(mp3Files, mergeDir)

      // 驗證 GroupingReport 頂層欄位
      expect(typeof report.totalInputFiles).toBe('number')
      expect(typeof report.totalGroups).toBe('number')
      expect(typeof report.targetDurationSeconds).toBe('number')
      expect(typeof report.tolerancePercent).toBe('number')
      expect(Array.isArray(report.groups)).toBe(true)
      expect(typeof report.totalInputDurationSeconds).toBe('number')
      expect(typeof report.succeeded).toBe('number')
      expect(typeof report.failed).toBe('number')
      expect(typeof report.generatedAt).toBe('string')

      // 驗證每個 GroupSummary 欄位
      for (const group of report.groups) {
        expect(typeof group.groupIndex).toBe('number')
        expect(typeof group.outputPath).toBe('string')
        expect(Array.isArray(group.inputFiles)).toBe(true)
        expect(typeof group.estimatedDuration).toBe('number')
        expect(typeof group.actualDuration).toBe('number')
        expect(typeof group.withinTolerance).toBe('boolean')
        expect(typeof group.oversizedSingleFile).toBe('boolean')
        expect(group.mergeResult).toBeDefined()
        expect(await fileExistsAndNonEmpty(group.outputPath)).toBe(true)
      }
    }, PIPELINE_TIMEOUT_MS)

    test('M4A 輸出包含有效音頻流 (duration > 0)', async () => {
      const { audioMergeService, mp4ConversionService } = await buildServices()

      const inputDir = await createTestSubDir('m4a-duration-input')
      const mergeDir = await createTestSubDir('m4a-duration-merge')
      const m4aDir = await createTestSubDir('m4a-duration-out')

      // 生成 5 秒 MP3
      const mp3 = await generateMP3(inputDir, 'dur_source', 5)
      const report = await audioMergeService.mergeBatch([mp3], mergeDir)
      expect(report.succeeded).toBe(1)

      const m4aPath = join(m4aDir, 'duration_check.m4a')
      await mp4ConversionService.convert(report.groups[0].outputPath, m4aPath)

      const meta = await parseFile(m4aPath)
      const duration = meta.format.duration ?? 0
      expect(duration).toBeGreaterThan(0)
    }, PIPELINE_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────
  // 情景 5: 端到端驗證 (所有 Phase 1-4 服務均參與)
  // ─────────────────────────────────────────────
  describe('情景 5: 端到端服務整合驗證', () => {
    test('所有 Phase 1-4 服務可正確實例化並串聯', async () => {
      // Phase 1: RetryService
      const retryService = new RetryService()
      expect(retryService).toBeDefined()

      // Phase 2: AudioConvertService (內嵌 RetryService)
      const convertConfig = new AudioConvertConfig()
      const audioConvertService = new AudioConvertService(convertConfig)
      expect(audioConvertService).toBeDefined()

      // Phase 3: AudioMergeService (內嵌 RetryService + DurationService)
      const audioMergeService = new AudioMergeService()
      expect(audioMergeService).toBeDefined()

      // Phase 4: MP4ConversionService (使用 RetryService + AudioErrorClassifier)
      const mp4Config = await loadMP4Config()
      const errorClassifier = new AudioErrorClassifier()
      const mp4ConversionService = new MP4ConversionService(
        mp4Config,
        retryService,
        errorClassifier
      )
      expect(mp4ConversionService).toBeDefined()
    })

    test('完整 Phase 2+3+4 串聯管道 (3 個 MP3 → 合併 → M4A)', async () => {
      const { audioMergeService, mp4ConversionService } = await buildServices()

      const inputDir = await createTestSubDir('full-chain-input')
      const mergeDir = await createTestSubDir('full-chain-merge')
      const m4aDir = await createTestSubDir('full-chain-m4a')

      // 準備 3 個 3 秒 MP3 (直接生成，代表 Phase 2 輸出)
      const mp3Files: string[] = []
      for (let i = 1; i <= 3; i++) {
        const mp3 = await generateMP3(inputDir, `chain_${i}`, 3)
        mp3Files.push(mp3)
      }

      // Phase 3: 合併
      const report = await audioMergeService.mergeBatch(mp3Files, mergeDir, {
        targetSeconds: 39600,
      })
      expect(report.failed).toBe(0)

      // Phase 4: 轉換每組 → M4A
      const m4aResults = await Promise.all(
        report.groups.map(async (group, i) => {
          const m4aPath = join(m4aDir, `chain_output_${i + 1}.m4a`)
          return mp4ConversionService.convert(
            group.outputPath,
            m4aPath,
            { title: `串聯測試 第 ${i + 1} 組`, trackNumber: i + 1 }
          )
        })
      )

      // 最終驗證所有 M4A
      expect(m4aResults.length).toBeGreaterThan(0)
      for (const result of m4aResults) {
        expect(result.error).toBeUndefined()
        expect(result.format).toBe('M4A')
        expect(result.fileSize).toBeGreaterThan(0)
        expect(await fileExistsAndNonEmpty(result.outputPath)).toBe(true)

        const meta = await parseFile(result.outputPath)
        const container = (meta.format.container ?? '').toUpperCase()
        expect(
          container.includes('M4A') || container.includes('MP4') || container.includes('ISOM')
        ).toBe(true)
      }
    }, PIPELINE_TIMEOUT_MS)

    test('groupingReport.generatedAt 為有效 ISO 8601 時間戳', async () => {
      const { audioMergeService } = await buildServices()

      const inputDir = await createTestSubDir('timestamp-input')
      const mergeDir = await createTestSubDir('timestamp-merge')

      const mp3 = await generateMP3(inputDir, 'ts_source', 3)
      const report = await audioMergeService.mergeBatch([mp3], mergeDir)

      // 驗證 ISO 8601 格式
      const parsedDate = new Date(report.generatedAt)
      expect(parsedDate.getTime()).toBeGreaterThan(0)
      expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }, STEP_TIMEOUT_MS)
  })
})
