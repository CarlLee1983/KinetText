import { test, expect } from 'bun:test'
import {
  parseYtPipelineArgs,
  buildCrawlStep,
  buildAudiobookStep,
  buildMergeStep,
  runStepsUntilFailure,
  pickNewBook,
  buildPartMp4Plans,
  shouldRetryFailed,
} from '../../src/core/services/ytPipeline'

test('parseYtPipelineArgs requires url', () => {
  expect(() => parseYtPipelineArgs([])).toThrow(/url/i)
})

test('parseYtPipelineArgs throws on invalid bitrate (out of 96-320 range)', () => {
  expect(() => parseYtPipelineArgs(['https://x/1', '--bitrate=999'])).toThrow(/96.*320|位元率|bitrate/i)
})

test('parseYtPipelineArgs throws on --crawl-retries=0', () => {
  expect(() => parseYtPipelineArgs(['https://x/1', '--crawl-retries=0'])).toThrow(/crawl-retries/)
})

test('parseYtPipelineArgs applies defaults and overrides', () => {
  const o = parseYtPipelineArgs(['https://x.tw/b/1.html', '--target=4h', '--bitrate=192'])
  expect(o.url).toBe('https://x.tw/b/1.html')
  expect(o.target).toBe('4h')
  expect(o.bitrate).toBe(192)
  expect(o.rate).toBe('+0%')
  expect(o.concurrency).toBe('3')
  expect(o.resume).toBe(true)
  expect(o.font).toContain('PingFang')
})

test('buildCrawlStep / buildAudiobookStep / buildMergeStep map args', () => {
  expect(buildCrawlStep('https://x/1')).toEqual(['start', 'https://x/1'])

  const o = parseYtPipelineArgs(['https://x/1'])
  expect(buildAudiobookStep('我的書', o)).toEqual([
    'audiobook', '我的書', 'all', '+0%', '+0%', '3', 'false',
  ])
  expect(buildMergeStep('output/我的書', 'output/我的書/merged', '6h')).toEqual([
    'merge-mp3', 'output/我的書', '--mode=duration', '--target=6h', '--output=output/我的書/merged',
  ])
})

test('runStepsUntilFailure stops at first non-zero step', async () => {
  const calls: string[] = []
  const run = async (args: string[]) => {
    calls.push(args[0]!)
    return args[0] === 'b' ? 1 : 0
  }
  const res = await runStepsUntilFailure(
    [
      { label: 'A', args: ['a'] },
      { label: 'B', args: ['b'] },
      { label: 'C', args: ['c'] },
    ],
    run
  )
  expect(res.ok).toBe(false)
  expect(res.failedLabel).toBe('B')
  expect(calls).toEqual(['a', 'b']) // C 不應執行
})

test('pickNewBook returns the single newly created dir', () => {
  expect(pickNewBook(['a', 'b'], ['a', 'b', 'c'])).toBe('c')
})

test('pickNewBook honors title override', () => {
  expect(pickNewBook(['a'], ['a', 'b', 'c'], 'b')).toBe('b')
})

test('pickNewBook throws when ambiguous and no override', () => {
  expect(() => pickNewBook(['a'], ['a', 'b', 'c'])).toThrow(/--title/)
})

test('buildPartMp4Plans maps merged mp3 to cover+mp4 with part labels', () => {
  const plans = buildPartMp4Plans(
    ['/o/書/merged/書_part2.mp3', '/o/書/merged/書_part1.mp3'],
    '/o/書/mp4/.covers',
    '/o/書/mp4'
  )
  expect(plans.length).toBe(2)
  // 依檔名排序後 part1 在前
  expect(plans[0].partLabel).toBe('part1')
  expect(plans[0].mp3Path).toBe('/o/書/merged/書_part1.mp3')
  expect(plans[0].coverPath).toBe('/o/書/mp4/.covers/part1.jpg')
  expect(plans[0].mp4Path).toBe('/o/書/mp4/書_part1.mp4')
  expect(plans[1].partLabel).toBe('part2')
})

test('parseYtPipelineArgs 解析爬取旗標 + tolerance + no-retry-failed', () => {
  const o = parseYtPipelineArgs([
    'https://x/1',
    '--crawl-retries=5',
    '--crawl-concurrency=8',
    '--crawl-delay=1500',
    '--tolerance=20',
    '--no-retry-failed',
  ])
  expect(o.crawlRetries).toBe(5)
  expect(o.crawlConcurrency).toBe(8)
  expect(o.crawlDelay).toBe(1500)
  expect(o.tolerance).toBe(20)
  expect(o.retryFailed).toBe(false)
})

test('parseYtPipelineArgs 預設：爬取旗標 undefined、補抓開啟', () => {
  const o = parseYtPipelineArgs(['https://x/1'])
  expect(o.crawlRetries).toBeUndefined()
  expect(o.crawlConcurrency).toBeUndefined()
  expect(o.crawlDelay).toBeUndefined()
  expect(o.tolerance).toBeUndefined()
  expect(o.retryFailed).toBe(true)
})

test('buildCrawlStep 附加爬取旗標（有 opts）', () => {
  expect(buildCrawlStep('https://x/1', { crawlRetries: 5, crawlConcurrency: 8, crawlDelay: 1500 })).toEqual([
    'start', 'https://x/1', '--crawl-retries=5', '--crawl-concurrency=8', '--crawl-delay=1500',
  ])
})

test('buildCrawlStep 無 opts 維持向後相容', () => {
  expect(buildCrawlStep('https://x/1')).toEqual(['start', 'https://x/1'])
})

test('buildMergeStep 附加 tolerance（有值才加）', () => {
  expect(buildMergeStep('output/書', 'output/書/merged', '6h', 20)).toEqual([
    'merge-mp3', 'output/書', '--mode=duration', '--target=6h', '--output=output/書/merged', '--tolerance=20',
  ])
  expect(buildMergeStep('output/書', 'output/書/merged', '6h')).toEqual([
    'merge-mp3', 'output/書', '--mode=duration', '--target=6h', '--output=output/書/merged',
  ])
})

test('shouldRetryFailed：啟用且非空才補', () => {
  expect(shouldRetryFailed([{ index: 1 }], true)).toBe(true)
  expect(shouldRetryFailed([], true)).toBe(false)
  expect(shouldRetryFailed([{ index: 1 }], false)).toBe(false)
})
