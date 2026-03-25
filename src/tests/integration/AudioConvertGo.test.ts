/**
 * 集成測試: AudioConvertGoWrapper
 * 驗證 Bun 通過 subprocess JSON 調用 kinetitext-go 二進制執行音頻轉換
 */

import { beforeAll, afterAll, describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  AudioConvertGoWrapper,
  type AudioConvertGoRequest,
} from '../../core/services/AudioConvertGoWrapper'

// Go 二進制路徑
// import.meta.dir = /Users/carl/Dev/Carl/KinetiText/src/tests/integration
// 需要 4 層 up → /Users/carl/Dev/Carl → kinetitext-go/bin/kinetitext-audio
const GO_BINARY_PATH = join(
  import.meta.dir,
  '../../../../kinetitext-go/bin/kinetitext-audio'
)

describe('AudioConvertGoWrapper 集成測試', () => {
  let tmpDir: string

  beforeAll(async () => {
    // 建立獨立暫存目錄
    tmpDir = await mkdtemp(join(tmpdir(), 'kinetitext-go-test-'))

    // 初始化 Wrapper，設定 Go 二進制路徑
    await AudioConvertGoWrapper.init(GO_BINARY_PATH)

    // 生成測試音頻文件 (5 秒靜音 WAV)
    await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 5 ${join(tmpDir, 'test.wav')}`.quiet()
    // 生成 AAC 測試文件
    await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -codec:a aac ${join(tmpDir, 'test.aac')}`.quiet()
  }, 30000)

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('Go 二進制存在且可用', async () => {
    const available = await AudioConvertGoWrapper.isAvailable()
    expect(available).toBe(true)
  })

  test('WAV → MP3 轉換成功', async () => {
    const req: AudioConvertGoRequest = {
      inputFile: join(tmpDir, 'test.wav'),
      outputFile: join(tmpDir, 'out_wav.mp3'),
      format: 'mp3',
      bitrate: 192,
    }

    const response = await AudioConvertGoWrapper.convert(req)

    expect(response.success).toBe(true)
    expect(response.outputFile).toBe(req.outputFile)
    expect(response.error).toBeUndefined()

    // 驗證輸出文件存在且有大小
    const fileStats = await stat(req.outputFile)
    expect(fileStats.size).toBeGreaterThan(0)
  }, 30000)

  test('AAC → MP3 轉換成功', async () => {
    const req: AudioConvertGoRequest = {
      inputFile: join(tmpDir, 'test.aac'),
      outputFile: join(tmpDir, 'out_aac.mp3'),
      format: 'mp3',
      bitrate: 192,
    }

    const response = await AudioConvertGoWrapper.convert(req)

    expect(response.success).toBe(true)
    expect(response.outputFile).toBe(req.outputFile)

    const fileStats = await stat(req.outputFile)
    expect(fileStats.size).toBeGreaterThan(0)
  }, 30000)

  test('缺少輸入文件回傳錯誤 JSON', async () => {
    const req: AudioConvertGoRequest = {
      inputFile: '/nonexistent/path/file.wav',
      outputFile: join(tmpDir, 'should_not_create.mp3'),
      format: 'mp3',
    }

    const response = await AudioConvertGoWrapper.convert(req)

    expect(response.success).toBe(false)
    expect(response.error).toBeDefined()
    expect(response.error).toContain('輸入文件不存在')
  }, 10000)

  test('空 input_file 回傳錯誤 JSON', async () => {
    const req: AudioConvertGoRequest = {
      inputFile: '',
      outputFile: join(tmpDir, 'should_not_create.mp3'),
      format: 'mp3',
    }

    const response = await AudioConvertGoWrapper.convert(req)

    expect(response.success).toBe(false)
    expect(response.error).toBeDefined()
  }, 10000)

  test('WAV → WAV 轉換 (passthrough)', async () => {
    const req: AudioConvertGoRequest = {
      inputFile: join(tmpDir, 'test.wav'),
      outputFile: join(tmpDir, 'out_copy.wav'),
      format: 'wav',
    }

    const response = await AudioConvertGoWrapper.convert(req)

    expect(response.success).toBe(true)
    const fileStats = await stat(req.outputFile)
    expect(fileStats.size).toBeGreaterThan(0)
  }, 30000)

  test('getBinaryPath() 回傳正確路徑', () => {
    const path = AudioConvertGoWrapper.getBinaryPath()
    expect(path).toBe(GO_BINARY_PATH)
  })
})
