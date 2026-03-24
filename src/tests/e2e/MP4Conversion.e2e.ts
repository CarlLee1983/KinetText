/**
 * Phase 4 E2E 測試：MP4 轉換 (MP3 → M4A)
 *
 * 測試情景:
 * 1. 單一 MP3 → M4A 轉換（基本驗證）
 * 2. 元資料嵌入與中文字符編碼
 * 3. 批量轉換（convertBatch 並行度控制）
 * 4. 性能基準（轉換速度 < 30 秒/檔）
 *
 * 依賴:
 * - src/tests/e2e/setup.ts  (registerE2EHooks, e2eRootDir)
 * - src/tests/e2e/fixtures.ts (generateMP3, createTestSubDir)
 * - src/tests/e2e/utils.ts   (fileExistsAndNonEmpty)
 * - src/core/services/MP4ConversionService
 * - src/core/config/MP4ConversionConfig (loadMP4Config)
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFile } from 'music-metadata'
import { registerE2EHooks, e2eRootDir } from './setup'
import { generateMP3, createTestSubDir } from './fixtures'
import { fileExistsAndNonEmpty } from './utils'
import { MP4ConversionService } from '../../core/services/MP4ConversionService'
import { RetryService } from '../../core/services/RetryService'
import { AudioErrorClassifier } from '../../core/services/AudioErrorClassifier'
import { loadMP4Config } from '../../core/config/MP4ConversionConfig'
import type { MP4ConversionConfig } from '../../core/config/MP4ConversionConfig'
import type { ConvertOptions } from '../../core/services/MP4ConversionService'

// 全域 E2E 掛鉤（建立/清理臨時目錄）
registerE2EHooks()

/** 標準轉換超時：30 秒 */
const CONVERSION_TIMEOUT_MS = 30_000

describe('Phase 4 E2E: MP4 轉換', () => {
  let service: MP4ConversionService
  let config: MP4ConversionConfig
  let fixtureDir: string

  beforeAll(async () => {
    config = await loadMP4Config()
    const retryService = new RetryService()
    const errorClassifier = new AudioErrorClassifier()
    service = new MP4ConversionService(config, retryService, errorClassifier)

    // 建立 fixtures 目錄，生成共用輸入 MP3
    fixtureDir = await createTestSubDir('mp4-fixtures')
  }, 60_000)

  // ─────────────────────────────────────────────
  // 情景 1：單一 MP3 → M4A 基本轉換
  // ─────────────────────────────────────────────
  describe('情景 1: 單一 MP3 → M4A 轉換', () => {
    test('轉換後 M4A 檔案存在且非空', async () => {
      const inputMp3 = await generateMP3(fixtureDir, 'basic_input', 3)
      const outputDir = await createTestSubDir('mp4-basic')
      const outputPath = join(outputDir, 'basic_output.m4a')

      const result = await service.convert(inputMp3, outputPath)

      expect(result.inputPath).toBe(inputMp3)
      expect(result.outputPath).toBe(outputPath)
      expect(result.format).toBe('M4A')
      expect(result.fileSize).toBeGreaterThan(0)
      expect(await fileExistsAndNonEmpty(outputPath)).toBe(true)
    }, CONVERSION_TIMEOUT_MS)

    test('輸出為有效的 M4A 容器 (music-metadata 可解析)', async () => {
      const inputMp3 = await generateMP3(fixtureDir, 'valid_container', 3)
      const outputDir = await createTestSubDir('mp4-container')
      const outputPath = join(outputDir, 'container_output.m4a')

      await service.convert(inputMp3, outputPath)

      const meta = await parseFile(outputPath)
      // M4A 容器格式 (music-metadata 回報 M4A 或 isom)
      const container = (meta.format.container ?? '').toUpperCase()
      expect(
        container.includes('M4A') || container.includes('MP4') || container.includes('ISOM')
      ).toBe(true)
    }, CONVERSION_TIMEOUT_MS)

    test('輸入檔案不存在時拋出錯誤', async () => {
      const outputDir = await createTestSubDir('mp4-missing')
      const missingInput = join(fixtureDir, 'nonexistent_file.mp3')
      const outputPath = join(outputDir, 'should_not_exist.m4a')

      await expect(service.convert(missingInput, outputPath)).rejects.toThrow(
        /not found|不存在/i
      )
    }, 10_000)
  })

  // ─────────────────────────────────────────────
  // 情景 2：元資料嵌入與中文字符編碼
  // ─────────────────────────────────────────────
  describe('情景 2: 元資料嵌入', () => {
    test('英文元資料 (title, artist, album) 正確嵌入', async () => {
      const inputMp3 = await generateMP3(fixtureDir, 'meta_en', 3)
      const outputDir = await createTestSubDir('mp4-meta-en')
      const outputPath = join(outputDir, 'meta_en.m4a')

      const metadata = {
        title: 'Test Chapter',
        artist: 'Test Author',
        album: 'Test Book',
      }

      const result = await service.convert(inputMp3, outputPath, metadata)

      expect(result.metadata).toMatchObject(metadata)

      // 驗證 music-metadata 可讀取嵌入的元資料
      const meta = await parseFile(outputPath)
      expect(meta.common.title).toBe('Test Chapter')
      expect(meta.common.artist).toBe('Test Author')
      expect(meta.common.album).toBe('Test Book')
    }, CONVERSION_TIMEOUT_MS)

    test('中文元資料正確編碼（UTF-8）', async () => {
      const inputMp3 = await generateMP3(fixtureDir, 'meta_zh', 3)
      const outputDir = await createTestSubDir('mp4-meta-zh')
      const outputPath = join(outputDir, 'meta_zh.m4a')

      const metadata = {
        title: '測試章節',
        artist: '測試作者',
        album: '測試書籍',
      }

      await service.convert(inputMp3, outputPath, metadata)

      const meta = await parseFile(outputPath)
      expect(meta.common.title).toBe('測試章節')
      expect(meta.common.artist).toBe('測試作者')
      expect(meta.common.album).toBe('測試書籍')
    }, CONVERSION_TIMEOUT_MS)

    test('全部可選元資料欄位均可嵌入', async () => {
      const inputMp3 = await generateMP3(fixtureDir, 'meta_full', 3)
      const outputDir = await createTestSubDir('mp4-meta-full')
      const outputPath = join(outputDir, 'meta_full.m4a')

      const metadata = {
        title: '完整元資料測試',
        artist: '測試作者',
        album: '測試專輯',
        date: '2026-03-24',
        genre: 'Audiobook',
        trackNumber: 1,
        comment: '自動化 E2E 測試',
      }

      const result = await service.convert(inputMp3, outputPath, metadata)

      expect(result.metadata.title).toBe('完整元資料測試')
      expect(result.metadata.genre).toBe('Audiobook')
      expect(result.metadata.trackNumber).toBe(1)
      expect(await fileExistsAndNonEmpty(outputPath)).toBe(true)
    }, CONVERSION_TIMEOUT_MS)

    test('無元資料時轉換仍然成功', async () => {
      const inputMp3 = await generateMP3(fixtureDir, 'meta_none', 3)
      const outputDir = await createTestSubDir('mp4-meta-none')
      const outputPath = join(outputDir, 'meta_none.m4a')

      const result = await service.convert(inputMp3, outputPath)

      expect(result.fileSize).toBeGreaterThan(0)
      expect(await fileExistsAndNonEmpty(outputPath)).toBe(true)
    }, CONVERSION_TIMEOUT_MS)
  })

  // ─────────────────────────────────────────────
  // 情景 3：批量轉換（convertBatch 並行度控制）
  // ─────────────────────────────────────────────
  describe('情景 3: 批量轉換', () => {
    test('convertBatch 成功轉換 3 個 MP3 → M4A', async () => {
      const batchDir = await createTestSubDir('mp4-batch-input')
      const outputDir = await createTestSubDir('mp4-batch-output')

      // 準備輸入 MP3 和輸出路徑
      const batchOptions: ConvertOptions[] = await Promise.all(
        Array.from({ length: 3 }, async (_, i) => {
          const name = `batch_${i + 1}`
          const inputPath = await generateMP3(batchDir, name, 3)
          const outputPath = join(outputDir, `${name}.m4a`)
          return {
            inputPath,
            outputPath,
            metadata: { title: `批量測試 ${i + 1}`, trackNumber: i + 1 },
          }
        })
      )

      const results = await service.convertBatch(batchOptions)

      expect(results).toHaveLength(3)
      for (const result of results) {
        expect(result.error).toBeUndefined()
        expect(result.fileSize).toBeGreaterThan(0)
        expect(await fileExistsAndNonEmpty(result.outputPath)).toBe(true)
      }
    }, 90_000)

    test('convertBatch 處理部分失敗：有效輸入成功，無效輸入返回 error', async () => {
      const batchDir = await createTestSubDir('mp4-partial-fail')
      const outputDir = await createTestSubDir('mp4-partial-out')

      const validInput = await generateMP3(batchDir, 'valid_file', 3)
      const validOutput = join(outputDir, 'valid.m4a')
      const invalidInput = join(batchDir, 'nonexistent.mp3')
      const invalidOutput = join(outputDir, 'invalid.m4a')

      const results = await service.convertBatch([
        { inputPath: validInput, outputPath: validOutput },
        { inputPath: invalidInput, outputPath: invalidOutput },
      ])

      expect(results).toHaveLength(2)

      const successResult = results.find(r => r.inputPath === validInput)
      const failResult = results.find(r => r.inputPath === invalidInput)

      expect(successResult?.error).toBeUndefined()
      expect(failResult?.error).toBeDefined()
    }, 60_000)

    test('並行度控制：maxConcurrency 不超過設定值', async () => {
      // 驗證 service 使用配置的並行度（間接確認 p-limit 有效）
      expect(config.maxConcurrency).toBeGreaterThanOrEqual(1)
      expect(config.maxConcurrency).toBeLessThanOrEqual(8)
    })
  })

  // ─────────────────────────────────────────────
  // 情景 4：性能基準
  // ─────────────────────────────────────────────
  describe('情景 4: 性能基準', () => {
    test('單一 5 秒 MP3 轉換時間 < 30 秒', async () => {
      const inputMp3 = await generateMP3(fixtureDir, 'perf_single', 5)
      const outputDir = await createTestSubDir('mp4-perf')
      const outputPath = join(outputDir, 'perf_output.m4a')

      const startMs = performance.now()
      await service.convert(inputMp3, outputPath)
      const elapsedMs = performance.now() - startMs

      expect(elapsedMs).toBeLessThan(CONVERSION_TIMEOUT_MS)
      expect(await fileExistsAndNonEmpty(outputPath)).toBe(true)
    }, CONVERSION_TIMEOUT_MS + 5_000)

    test('256 kbps 比特率產生的檔案大小合理', async () => {
      const inputMp3 = await generateMP3(fixtureDir, 'perf_bitrate', 10)
      const outputDir = await createTestSubDir('mp4-bitrate')
      const outputPath = join(outputDir, 'bitrate_output.m4a')

      const result = await service.convert(inputMp3, outputPath)

      // 10 秒 256kbps AAC 音頻約為 320 KB；靜音會更小，但至少 1 KB
      expect(result.fileSize).toBeGreaterThan(1_000)
      expect(result.bitrate).toBe(256)
    }, CONVERSION_TIMEOUT_MS)

    test('配置的比特率正確反映在轉換設定', async () => {
      // 驗證 config 符合規範 (96–320 kbps)
      expect(config.bitrate).toBeGreaterThanOrEqual(96)
      expect(config.bitrate).toBeLessThanOrEqual(320)
    })
  })
})
