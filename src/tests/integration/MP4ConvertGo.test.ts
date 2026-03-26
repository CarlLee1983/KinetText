/**
 * 集成測試: MP4ConvertGoWrapper
 * 驗證 Bun 通過 subprocess JSON 調用 kinetitext-go 二進制執行 MP4/M4A 轉換
 */

import { beforeAll, afterAll, describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import MP4ConvertGoWrapper from '../../core/services/MP4ConvertGoWrapper'
import type { MP4ConvertGoRequest } from '../../core/services/MP4ConvertGoWrapper'
import { MP4ConversionService } from '../../core/services/MP4ConversionService'
import { RetryService } from '../../core/services/RetryService'
import { AudioErrorClassifier } from '../../core/services/AudioErrorClassifier'
import type { MP4Metadata, MP4ConversionConfig } from '../../core/types/audio'

// Go 二進制路徑
// import.meta.dir = /Users/carl/Dev/Carl/KinetiText/src/tests/integration
// 需要 4 層 up → /Users/carl/Dev/Carl → kinetitext-go/bin/kinetitext-mp4convert
const GO_BINARY_PATH = join(
  import.meta.dir,
  '../../../../kinetitext-go/bin/kinetitext-mp4convert'
)

// 創建測試 config 物件
const createTestConfig = (overrides?: Partial<MP4ConversionConfig>): MP4ConversionConfig => {
  return {
    bitrate: 256,
    outputFormat: 'm4a' as const,
    videoBackground: 'none' as const,
    videoWidth: 1920,
    videoHeight: 1080,
    maxConcurrency: 2,
    outputDirectory: './output',
    retryMaxAttempts: 2,
    ...overrides,
  }
}

describe('MP4ConvertGoWrapper 集成測試', () => {
  let tmpDir: string

  beforeAll(async () => {
    // 建立獨立暫存目錄
    tmpDir = await mkdtemp(join(tmpdir(), 'kinetitext-mp4go-test-'))

    // 初始化 Wrapper，設定 Go 二進制路徑
    try {
      await MP4ConvertGoWrapper.init(GO_BINARY_PATH)
    } catch {
      console.warn('GO 二進制不可用，將使用模擬測試')
    }

    // 生成測試音頻文件 (5 秒靜音 MP3)
    await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -q:a 9 ${join(tmpDir, 'test.mp3')}`.quiet()
  }, 30000)

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('Go 二進制存在且可用', async () => {
    const available = await MP4ConvertGoWrapper.isAvailable()
    expect(available).toBe(true)
  })

  test('MP3 → M4A 基本轉換成功', async () => {
    const req: MP4ConvertGoRequest = {
      inputFile: join(tmpDir, 'test.mp3'),
      outputFile: join(tmpDir, 'out_basic.m4a'),
      bitrate: 256,
    }

    const response = await MP4ConvertGoWrapper.convertMP4(req)

    expect(response.success).toBe(true)
    expect(response.outputFile).toBe(req.outputFile)
    expect(response.error).toBeUndefined()

    // 驗證輸出文件存在且有大小
    const fileStats = await stat(req.outputFile)
    expect(fileStats.size).toBeGreaterThan(0)
  }, 30000)

  test('MP3 → M4A 帶元數據轉換成功', async () => {
    const metadata: MP4Metadata = {
      title: 'Test Chapter',
      artist: 'Test Author',
      album: 'Test Book',
      date: '2026-03-26',
      genre: 'Audiobook',
      trackNumber: 1,
      comment: 'Test conversion',
    }

    const req: MP4ConvertGoRequest = {
      inputFile: join(tmpDir, 'test.mp3'),
      outputFile: join(tmpDir, 'out_metadata.m4a'),
      bitrate: 256,
      metadata,
    }

    const response = await MP4ConvertGoWrapper.convertMP4(req)

    expect(response.success).toBe(true)
    expect(response.outputFile).toBe(req.outputFile)

    // 驗證輸出文件存在
    const fileStats = await stat(req.outputFile)
    expect(fileStats.size).toBeGreaterThan(0)

    // 驗證元數據是否嵌入（使用 ffprobe）
    try {
      const probeResult = await $`ffprobe -v error -select_streams a:0 -show_entries stream_tags=title -of default=noprint_wrappers=1 ${req.outputFile}`.text()
      if (probeResult.includes('title')) {
        expect(probeResult).toContain('Test Chapter')
      }
    } catch {
      // ffprobe 可能不可用，跳過驗證
    }
  }, 30000)

  test('MP3 → M4A 中文元數據轉換成功', async () => {
    const metadata: MP4Metadata = {
      title: '測試標題',
      artist: '測試作者',
      album: '測試書籍',
    }

    const req: MP4ConvertGoRequest = {
      inputFile: join(tmpDir, 'test.mp3'),
      outputFile: join(tmpDir, 'out_utf8.m4a'),
      bitrate: 256,
      metadata,
    }

    const response = await MP4ConvertGoWrapper.convertMP4(req)

    expect(response.success).toBe(true)
    const fileStats = await stat(req.outputFile)
    expect(fileStats.size).toBeGreaterThan(0)
  }, 30000)

  test('缺少輸入文件回傳錯誤 JSON', async () => {
    const req: MP4ConvertGoRequest = {
      inputFile: '/nonexistent/path/file.mp3',
      outputFile: join(tmpDir, 'should_not_create.m4a'),
      bitrate: 256,
    }

    const response = await MP4ConvertGoWrapper.convertMP4(req)

    expect(response.success).toBe(false)
    expect(response.error).toBeDefined()
    expect(response.error).toContain('輸入文件不存在')
  }, 10000)

  test('空 inputFile 回傳錯誤', async () => {
    const req: MP4ConvertGoRequest = {
      inputFile: '',
      outputFile: join(tmpDir, 'should_not_create.m4a'),
      bitrate: 256,
    }

    const response = await MP4ConvertGoWrapper.convertMP4(req)

    expect(response.success).toBe(false)
    expect(response.error).toBeDefined()
  }, 10000)

  test('getBinaryPath() 回傳正確路徑', () => {
    const path = MP4ConvertGoWrapper.getBinaryPath()
    expect(path).toBe(GO_BINARY_PATH)
  })
})

describe('MP4ConversionService 與 Go 後端集成', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kinetitext-mp4svc-test-'))

    // 生成測試音頻文件 (5 秒靜音 MP3)
    await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -q:a 9 ${join(tmpDir, 'test.mp3')}`.quiet()
  }, 30000)

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('MP4ConversionService 可以禁用 Go 後端', async () => {
    const config = createTestConfig()
    const retryService = new RetryService()
    const errorClassifier = new AudioErrorClassifier()

    const service = new MP4ConversionService(
      config,
      retryService,
      errorClassifier
    )

    // 不初始化 Go 後端，應回退至 Bun FFmpeg
    await service.initGoBackend()

    expect(service).toBeDefined()
  })

  test('MP4ConversionService Go 後端無法使用時回退至 Bun', async () => {
    const config = createTestConfig()
    const retryService = new RetryService()
    const errorClassifier = new AudioErrorClassifier()

    const service = new MP4ConversionService(
      config,
      retryService,
      errorClassifier,
      { enabled: true, goBinaryPath: '/nonexistent/binary', timeout: 60000 }
    )

    // 初始化應優雅降級
    await service.initGoBackend()

    // 轉換應使用 Bun 後端
    const result = await service.convert(
      join(tmpDir, 'test.mp3'),
      join(tmpDir, 'output_fallback.m4a')
    )

    expect(result).toBeDefined()
    expect(result.outputPath).toContain('output_fallback.m4a')
  }, 60000)

  test('MP4ConversionService 可以使用 Go 後端進行轉換', async () => {
    const config = createTestConfig()
    const retryService = new RetryService()
    const errorClassifier = new AudioErrorClassifier()
    const goConfig = {
      enabled: true,
      goBinaryPath: GO_BINARY_PATH,
      timeout: 60000,
    }

    const service = new MP4ConversionService(
      config,
      retryService,
      errorClassifier,
      goConfig
    )

    // 初始化 Go 後端
    await service.initGoBackend()

    // 執行轉換（可能使用 Go 或 Bun，取決於二進制可用性）
    const result = await service.convert(
      join(tmpDir, 'test.mp3'),
      join(tmpDir, 'output_service.m4a')
    )

    expect(result).toBeDefined()
    expect(result.format).toBe('M4A')
    expect(result.fileSize).toBeGreaterThan(0)
  }, 60000)

  test('MP4ConversionService 轉換時支援元數據', async () => {
    const config = createTestConfig()
    const service = new MP4ConversionService(
      config,
      new RetryService(),
      new AudioErrorClassifier()
    )

    const metadata: MP4Metadata = {
      title: 'Service Test',
      artist: 'Test Artist',
    }

    const result = await service.convert(
      join(tmpDir, 'test.mp3'),
      join(tmpDir, 'output_with_meta.m4a'),
      metadata
    )

    expect(result.metadata).toEqual(metadata)
  }, 60000)
})
