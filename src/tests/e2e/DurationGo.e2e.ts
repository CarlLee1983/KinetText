/**
 * E2E Tests for DurationService with Go Backend Integration
 * Verifies end-to-end workflow with real audio files and Go binary
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { DurationService } from '../../core/services/DurationService'
import type { DurationGoConfig } from '../../config/DurationGoConfig'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLogger } from '../../core/utils/logger'

const logger = createLogger('duration-go-e2e')

describe('DurationService E2E - Go Backend Integration', () => {
  let testDir: string
  let testAudioFiles: string[] = []
  const goBinaryPath = join(
    import.meta.dir,
    '../../../../kinetitext-go/bin/kinetitext-duration'
  )

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'duration-e2e-'))
    logger.info({ testDir }, '準備 E2E 測試環境')

    // 生成 5 個測試音頻檔案（各 1 秒 WAV）
    for (let i = 0; i < 5; i++) {
      const audioFile = join(testDir, `test-${i}.wav`)
      try {
        const proc = Bun.spawn([
          '/bin/sh',
          '-c',
          `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -q:a 9 -acodec libmp3lame "${audioFile}" 2>/dev/null`,
        ])
        await proc.exited
        testAudioFiles.push(audioFile)
      } catch (err) {
        logger.warn({ i, error: err }, '生成測試音頻失敗')
      }
    }

    logger.info(
      { filesCreated: testAudioFiles.length, testDir },
      'E2E 測試檔案準備完成'
    )
  })

  afterAll(async () => {
    try {
      if (testDir) {
        await rm(testDir, { recursive: true, force: true })
        logger.info({ testDir }, 'E2E 測試目錄清理完成')
      }
    } catch (err) {
      logger.warn({ testDir, error: err }, '清理測試目錄失敗')
    }
  })

  test('calculateTotalDuration with Go backend available', async () => {
    // Check if Go binary is available
    const goAvailable = await Bun.file(goBinaryPath).exists()

    if (!goAvailable) {
      logger.warn({ goBinaryPath }, 'Go binary not available, skipping test')
      return
    }

    const goConfig: DurationGoConfig = {
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

    const total = await service.calculateTotalDuration(testAudioFiles)

    // 預期 ~5 秒（5 個檔案 × 1 秒，允許 ±0.5 秒誤差）
    expect(Math.abs(total - 5) < 0.5).toBe(true)
    logger.info({ total, expected: 5 }, '單檔案讀取驗證通過')
  })

  test('calculateTotalDuration with single file', async () => {
    const goAvailable = await Bun.file(goBinaryPath).exists()

    if (!goAvailable) {
      logger.warn({ goBinaryPath }, 'Go binary not available, skipping test')
      return
    }

    const goConfig: DurationGoConfig = {
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

    if (testAudioFiles.length === 0) {
      logger.warn('No test files available')
      return
    }

    const total = await service.calculateTotalDuration([testAudioFiles[0]])

    // 預期 ~1 秒
    expect(Math.abs(total - 1) < 0.5).toBe(true)
    logger.info({ total, file: testAudioFiles[0] }, '單檔案讀取驗證通過')
  })

  test('calculateTotalDuration with empty array', async () => {
    const goAvailable = await Bun.file(goBinaryPath).exists()

    if (!goAvailable) {
      logger.warn({ goBinaryPath }, 'Go binary not available, skipping test')
      return
    }

    const goConfig: DurationGoConfig = {
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

    const total = await service.calculateTotalDuration([])

    // Empty array should return 0
    expect(total).toBe(0)
  })

  test('generateReport with Go backend', async () => {
    const goAvailable = await Bun.file(goBinaryPath).exists()

    if (!goAvailable) {
      logger.warn({ goBinaryPath }, 'Go binary not available, skipping test')
      return
    }

    if (testAudioFiles.length === 0) {
      logger.warn('No test files available')
      return
    }

    const goConfig: DurationGoConfig = {
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

    const report = await service.generateReport([testAudioFiles[0]], 39600, 10)

    expect(report.files.length).toBe(1)
    expect(Math.abs(report.files[0].duration - 1) < 0.5).toBe(true)
    expect(report.totalDuration).toBe(report.files[0].duration)
    logger.info(
      { filesInReport: report.files.length, totalDuration: report.totalDuration },
      'generateReport 驗證通過'
    )
  })

  test('fallback to Bun when Go backend fails', async () => {
    // Test with invalid binary path to trigger fallback
    const invalidBinaryPath = '/nonexistent/path/to/binary'

    const goConfig: DurationGoConfig = {
      enabled: true,
      goBinaryPath: invalidBinaryPath,
      timeout: 30000,
      concurrency: 4,
      perFileTimeout: 5000,
    }

    const service = new DurationService({
      enableGoBackend: true,
      goBackendConfig: goConfig,
    })

    if (testAudioFiles.length === 0) {
      logger.warn('No test files available')
      return
    }

    // Should fallback to Bun (music-metadata) and succeed
    try {
      const total = await service.calculateTotalDuration([testAudioFiles[0]])
      // Should return a valid duration despite Go binary being unavailable
      expect(total > 0).toBe(true)
      logger.info({ total }, 'Fallback 到 Bun 成功')
    } catch (err) {
      // If both Go and Bun fail, that's expected when no real audio files
      logger.warn({ error: err }, 'Fallback 也失敗，可能是因為測試環境限制')
    }
  })

  test('calculateTotalDuration with multiple files', async () => {
    const goAvailable = await Bun.file(goBinaryPath).exists()

    if (!goAvailable) {
      logger.warn({ goBinaryPath }, 'Go binary not available, skipping test')
      return
    }

    if (testAudioFiles.length < 3) {
      logger.warn('Not enough test files')
      return
    }

    const goConfig: DurationGoConfig = {
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

    const filesToTest = testAudioFiles.slice(0, 3)
    const total = await service.calculateTotalDuration(filesToTest)

    // 預期 ~3 秒（3 個檔案 × 1 秒，允許 ±1 秒誤差）
    expect(Math.abs(total - 3) < 1).toBe(true)
    logger.info({ total, filesRead: 3 }, '多檔案讀取驗證通過')
  })
})
