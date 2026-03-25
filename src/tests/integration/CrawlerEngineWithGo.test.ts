/**
 * 集成測試: CrawlerEngine 支持 Go 音頻後端配置
 * 驗證配置傳遞與向後相容性（不觸發真實爬取）
 */

import { describe, test, expect } from 'bun:test'
import { CrawlerEngine } from '../../core/CrawlerEngine'
import type { CrawlerConfig } from '../../core/CrawlerEngine'
import type { NovelSiteAdapter } from '../../adapters/NovelSiteAdapter'
import type { StorageAdapter } from '../../storage/StorageAdapter'

/** 最小化 mock adapter，不觸發真實 HTTP 請求 */
const makeMockAdapter = (): NovelSiteAdapter => ({
  siteName: 'mock-site',
  resourceProfile: undefined,
  getBookMetadata: async () => ({ title: 'Test Book', author: 'Test Author', sourceUrl: 'http://test', chapterCount: 0 }),
  getChapterList: async () => [],
  getChapterContent: async () => 'content',
  close: async () => {},
} as unknown as NovelSiteAdapter)

/** 最小化 mock storage */
const makeMockStorage = (): StorageAdapter => ({
  saveBookMetadata: async () => {},
  saveChapter: async () => {},
  chapterExists: async () => false,
  isValidChapter: async () => true,
} as unknown as StorageAdapter)

describe('CrawlerEngine Go 後端配置集成', () => {
  test('傳統 API (number concurrency) 向後相容', () => {
    const engine = new CrawlerEngine(makeMockAdapter(), makeMockStorage(), 3)
    expect((engine as any).concurrency).toBe(3)
    expect(engine.audioConfig).toBeDefined()
    expect(engine.audioConfig.useGoBackend).toBeUndefined()
  })

  test('新 CrawlerConfig API：傳遞音頻配置', () => {
    const config: CrawlerConfig = {
      concurrency: 4,
      audio: {
        useGoBackend: true,
        goBinaryPath: '/usr/local/bin/kinetitext-audio',
      },
    }
    const engine = new CrawlerEngine(makeMockAdapter(), makeMockStorage(), config)
    expect((engine as any).concurrency).toBe(4)
    expect(engine.audioConfig.useGoBackend).toBe(true)
    expect(engine.audioConfig.goBinaryPath).toBe('/usr/local/bin/kinetitext-audio')
  })

  test('預設值：useGoBackend 為 false（無環境變數）', () => {
    const originalEnv = process.env.KINETITEXT_USE_GO_AUDIO
    delete process.env.KINETITEXT_USE_GO_AUDIO

    const engine = new CrawlerEngine(makeMockAdapter(), makeMockStorage(), {})
    expect(engine.audioConfig.useGoBackend).toBe(false)

    if (originalEnv !== undefined) {
      process.env.KINETITEXT_USE_GO_AUDIO = originalEnv
    }
  })

  test('環境變數 KINETITEXT_USE_GO_AUDIO=true 被讀取', () => {
    const originalEnv = process.env.KINETITEXT_USE_GO_AUDIO
    process.env.KINETITEXT_USE_GO_AUDIO = 'true'

    const engine = new CrawlerEngine(makeMockAdapter(), makeMockStorage(), {})
    expect(engine.audioConfig.useGoBackend).toBe(true)

    if (originalEnv !== undefined) {
      process.env.KINETITEXT_USE_GO_AUDIO = originalEnv
    } else {
      delete process.env.KINETITEXT_USE_GO_AUDIO
    }
  })

  test('config.audio.useGoBackend 覆蓋環境變數', () => {
    const originalEnv = process.env.KINETITEXT_USE_GO_AUDIO
    process.env.KINETITEXT_USE_GO_AUDIO = 'true'

    // Explicitly set to false in config
    const engine = new CrawlerEngine(makeMockAdapter(), makeMockStorage(), {
      audio: { useGoBackend: false },
    })
    // Config overrides env (config.audio.useGoBackend ?? envValue)
    // Since useGoBackend is explicitly false, it should be false
    expect(engine.audioConfig.useGoBackend).toBe(false)

    if (originalEnv !== undefined) {
      process.env.KINETITEXT_USE_GO_AUDIO = originalEnv
    } else {
      delete process.env.KINETITEXT_USE_GO_AUDIO
    }
  })

  test('環境變數 KINETITEXT_GO_AUDIO_BIN 設定 goBinaryPath', () => {
    const originalEnv = process.env.KINETITEXT_GO_AUDIO_BIN
    process.env.KINETITEXT_GO_AUDIO_BIN = '/custom/bin/kinetitext-audio'

    const engine = new CrawlerEngine(makeMockAdapter(), makeMockStorage(), {})
    expect(engine.audioConfig.goBinaryPath).toBe('/custom/bin/kinetitext-audio')

    if (originalEnv !== undefined) {
      process.env.KINETITEXT_GO_AUDIO_BIN = originalEnv
    } else {
      delete process.env.KINETITEXT_GO_AUDIO_BIN
    }
  })

  test('傳統 API 預設 concurrency 為 5', () => {
    const engine = new CrawlerEngine(makeMockAdapter(), makeMockStorage())
    expect((engine as any).concurrency).toBe(5)
  })
})
