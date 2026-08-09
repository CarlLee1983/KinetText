import { test, expect } from 'bun:test'
import { CrawlerEngine } from '../../src/core/CrawlerEngine'
import type { NovelSiteAdapter } from '../../src/adapters/NovelSiteAdapter'
import type { StorageAdapter } from '../../src/storage/StorageAdapter'

const failingAdapter = (onFetch: () => void): NovelSiteAdapter =>
  ({
    siteName: 'mock',
    resourceProfile: undefined,
    getBookMetadata: async () => ({ title: 'T', author: 'A', sourceUrl: 'http://t', chapterCount: 1 }),
    getChapterList: async () => [{ index: 1, title: 'C1', sourceUrl: 'http://t/1' }],
    getChapterContent: async () => {
      onFetch()
      return 'x' // 太短 → 觸發失敗/重試路徑
    },
    close: async () => {},
  } as unknown as NovelSiteAdapter)

const mockStorage = (): StorageAdapter =>
  ({
    saveBookMetadata: async () => {},
    saveChapter: async () => {},
    chapterExists: async () => false,
    isValidChapter: async () => true,
  } as unknown as StorageAdapter)

test('建構子：config 設定 maxRetries 與 retryBaseDelayMs', () => {
  const engine = new CrawlerEngine(failingAdapter(() => {}), mockStorage(), {
    maxRetries: 5,
    retryBaseDelayMs: 500,
  })
  expect((engine as any).maxRetries).toBe(5)
  expect((engine as any).retryBaseDelayMs).toBe(500)
})

test('建構子：未指定時用預設 3 / 2000（config 與 legacy 皆是）', () => {
  const cfgEngine = new CrawlerEngine(failingAdapter(() => {}), mockStorage(), {})
  expect((cfgEngine as any).maxRetries).toBe(3)
  expect((cfgEngine as any).retryBaseDelayMs).toBe(2000)

  const legacyEngine = new CrawlerEngine(failingAdapter(() => {}), mockStorage(), 4)
  expect((legacyEngine as any).maxRetries).toBe(3)
  expect((legacyEngine as any).retryBaseDelayMs).toBe(2000)
})

test('章節抓取迴圈使用設定的 maxRetries（maxRetries=1 → 只抓一次）', async () => {
  let calls = 0
  const engine = new CrawlerEngine(failingAdapter(() => { calls++ }), mockStorage(), {
    maxRetries: 1,
    retryBaseDelayMs: 0,
  })
  await engine.run('http://t')
  expect(calls).toBe(1) // 若仍寫死 3，這裡會是 3
})
