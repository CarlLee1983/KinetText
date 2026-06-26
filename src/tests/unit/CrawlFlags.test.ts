import { test, expect } from 'bun:test'
import { parseCrawlFlags } from '../../cli/common'

test('parseCrawlFlags 解析三個爬取旗標', () => {
  const f = parseCrawlFlags(['url', '--crawl-retries=5', '--crawl-concurrency=8', '--crawl-delay=1500'])
  expect(f).toEqual({ retries: 5, concurrency: 8, delay: 1500 })
})

test('parseCrawlFlags 未給旗標回空物件（沿用預設）', () => {
  expect(parseCrawlFlags(['url'])).toEqual({})
})

test('parseCrawlFlags 忽略非數字值', () => {
  expect(parseCrawlFlags(['--crawl-retries=abc'])).toEqual({})
})

test('parseCrawlFlags --crawl-retries=0 拋出範圍錯誤', () => {
  expect(() => parseCrawlFlags(['--crawl-retries=0'])).toThrow(/crawl-retries/)
})

test('parseCrawlFlags --crawl-concurrency=0 拋出範圍錯誤', () => {
  expect(() => parseCrawlFlags(['--crawl-concurrency=0'])).toThrow(/crawl-concurrency/)
})
