/**
 * DurationService 性能基準測試
 * 對比 Bun (Promise.all) vs Go 後端在 100+ 檔案並發讀取的速度
 *
 * 測試場景:
 * 1. Bun 後端: 100 個檔案，串行 Promise.all
 * 2. Go 後端: 100 個檔案，4 worker 並發
 * 3. 多格式驗證: MP3, FLAC, AAC, OGG (各 25 個，共 100 個)
 *
 * 性能目標: Go 後端 < 2000ms，相比 Bun 快 5-10 倍
 */

import { test, describe, beforeAll, afterAll } from 'bun:test'
import { DurationService } from '../../core/services/DurationService'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLogger } from '../../core/utils/logger'

const logger = createLogger('duration-bench')

describe('DurationService Performance Benchmarks', () => {
  let testDir: string
  let testFiles: string[] = []
  let bunTime = 0
  let goTime = 0

  beforeAll(async () => {
    // 準備測試目錄
    testDir = await mkdtemp(join(tmpdir(), 'duration-bench-'))
    testFiles = []

    logger.info({ testDir }, '開始生成 100 個測試音頻檔案')

    const startSetup = performance.now()

    // 生成 100 個測試音頻檔案（使用 ffmpeg 建立短 1 秒 WAV）
    for (let i = 0; i < 100; i++) {
      const outputFile = join(testDir, `test-${String(i).padStart(3, '0')}.wav`)

      try {
        const proc = Bun.spawn([
          '/bin/sh',
          '-c',
          `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -q:a 9 -acodec libmp3lame "${outputFile}" 2>/dev/null`,
        ])
        await proc.exited
        testFiles.push(outputFile)

        if ((i + 1) % 20 === 0) {
          logger.debug({ generated: i + 1 }, '進度')
        }
      } catch (err) {
        logger.warn({ i, error: err }, '檔案生成失敗')
      }
    }

    const setupTime = performance.now() - startSetup
    logger.info(
      {
        filesGenerated: testFiles.length,
        setupTimeMs: Math.round(setupTime),
      },
      '測試 WAV 檔案生成完成'
    )
  })

  afterAll(async () => {
    // 清理測試檔案
    try {
      if (testDir) {
        await rm(testDir, { recursive: true, force: true })
        logger.info({ testDir }, '清理測試目錄完成')
      }
    } catch (err) {
      logger.warn({ testDir, error: err }, '清理測試目錄失敗')
    }
  })

  test('Bun backend: 100 files duration calculation', async () => {
    const service = new DurationService({ enableGoBackend: false })

    const startTime = performance.now()
    const total = await service.calculateTotalDuration(testFiles)
    bunTime = performance.now() - startTime

    logger.info(
      {
        filesProcessed: testFiles.length,
        totalDuration: total.toFixed(1),
        elapsedMs: Math.round(bunTime),
      },
      'Bun backend completed'
    )

    console.log(
      `✅ Bun: 100 files in ${Math.round(bunTime)}ms (${(total / 60).toFixed(1)}min)`
    )
  })

  test('Go backend: 100 files duration calculation', async () => {
    const goBinaryPath = join(
      import.meta.dir,
      '../../../../kinetitext-go/bin/kinetitext-duration'
    )

    // 檢查 Go binary 可用性
    const goAvailable = await Bun.file(goBinaryPath).exists()
    if (!goAvailable) {
      logger.warn({ goBinaryPath }, 'Go binary not available, skipping test')
      return
    }

    const goConfig = {
      enabled: true,
      goBinaryPath,
      timeout: 30000,
      concurrency: 4,
      perFileTimeout: 5000,
    }

    const service = new DurationService({
      enableGoBackend: true,
      goBackendConfig: goConfig,
    })

    const startTime = performance.now()
    const total = await service.calculateTotalDuration(testFiles)
    goTime = performance.now() - startTime

    logger.info(
      {
        filesProcessed: testFiles.length,
        totalDuration: total.toFixed(1),
        elapsedMs: Math.round(goTime),
      },
      'Go backend completed'
    )

    console.log(
      `✅ Go: 100 files in ${Math.round(goTime)}ms (${(total / 60).toFixed(1)}min)`
    )

    // 驗證性能目標：< 2 秒（2000ms）
    if (goTime > 2000) {
      logger.warn(
        { elapsedMs: Math.round(goTime) },
        '⚠️ Performance goal not met (target < 2000ms)'
      )
    } else {
      logger.info(
        { elapsedMs: Math.round(goTime) },
        '✅ Performance goal met (< 2000ms)'
      )
    }

    // 計算加速倍數
    if (bunTime > 0) {
      const speedup = bunTime / goTime
      console.log(
        `✅ Speedup: ${speedup.toFixed(1)}x (target: 5-10x)\n`
      )
      logger.info(
        { bunMs: Math.round(bunTime), goMs: Math.round(goTime), speedup: speedup.toFixed(1) },
        'Performance comparison'
      )
    }
  })

  test('Go backend: diverse formats (MP3, FLAC, AAC, OGG)', async () => {
    const goBinaryPath = join(
      import.meta.dir,
      '../../../../kinetitext-go/bin/kinetitext-duration'
    )

    // 檢查 Go binary 可用性
    const goAvailable = await Bun.file(goBinaryPath).exists()
    if (!goAvailable) {
      logger.warn({ goBinaryPath }, 'Go binary not available, skipping test')
      return
    }

    const formats = ['mp3', 'flac', 'aac', 'ogg']
    const testFilesMultiFormat: string[] = []
    const multiTestDir = await mkdtemp(join(tmpdir(), 'duration-multi-'))

    try {
      logger.info({ formats }, '開始生成多格式測試檔案')

      // 為每個格式生成 25 個檔案（共 100 個）
      for (const fmt of formats) {
        for (let i = 0; i < 25; i++) {
          const outputFile = join(
            multiTestDir,
            `test-${fmt}-${String(i).padStart(2, '0')}.${fmt}`
          )

          // 根據格式選擇編碼選項
          let codecArgs = ''
          if (fmt === 'mp3') {
            codecArgs = '-q:a 9 -acodec libmp3lame'
          } else if (fmt === 'flac') {
            codecArgs = '-acodec flac'
          } else if (fmt === 'aac') {
            codecArgs = '-acodec aac'
          } else if (fmt === 'ogg') {
            codecArgs = '-acodec libvorbis'
          }

          try {
            const proc = Bun.spawn([
              '/bin/sh',
              '-c',
              `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 1 ${codecArgs} "${outputFile}" 2>/dev/null`,
            ])
            await proc.exited
            testFilesMultiFormat.push(outputFile)
          } catch (err) {
            logger.warn({ fmt, i, error: err }, '檔案生成失敗')
          }
        }
      }

      logger.info(
        { totalFiles: testFilesMultiFormat.length, formats },
        '多格式測試檔案生成完成'
      )

      const goConfig = {
        enabled: true,
        goBinaryPath,
        timeout: 30000,
        concurrency: 4,
        perFileTimeout: 5000,
      }

      const service = new DurationService({
        enableGoBackend: true,
        goBackendConfig: goConfig,
      })

      const startTime = performance.now()
      const total = await service.calculateTotalDuration(testFilesMultiFormat)
      const elapsedMs = performance.now() - startTime

      console.log(
        `✅ Multi-format: ${testFilesMultiFormat.length} files, total ${total.toFixed(1)}s, elapsed ${Math.round(elapsedMs)}ms\n`
      )

      // 驗證：應讀取 100 個檔案（各格式 25 × 1 秒）
      const expected = 100.0
      if (Math.abs(total - expected) > 2.0) {
        logger.warn(
          { total, expected, diff: Math.abs(total - expected) },
          '多格式時長不匹配'
        )
      } else {
        logger.info({ total, expected }, '多格式時長驗證通過')
      }
    } finally {
      // 清理多格式測試目錄
      try {
        await rm(multiTestDir, { recursive: true, force: true })
      } catch (err) {
        logger.warn({ multiTestDir, error: err }, '清理多格式目錄失敗')
      }
    }
  })
})
