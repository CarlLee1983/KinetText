import { test, expect } from 'bun:test'
import {
  parseYtPipelineArgs,
  buildCrawlStep,
  buildAudiobookStep,
  buildMergeStep,
  runStepsUntilFailure,
} from '../../core/services/ytPipeline'

test('parseYtPipelineArgs requires url', () => {
  expect(() => parseYtPipelineArgs([])).toThrow(/url/i)
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
