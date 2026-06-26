import { test, expect, describe } from 'bun:test'
import {
  buildAudiobookArgs,
  buildMergeArgs,
  buildConvertArgs,
  buildCrawlArgs,
  buildBackupArgs,
  buildRetryArgs,
  buildM4bArgs,
} from '../../src/tui/runner'

test('buildAudiobookArgs 位置參數順序正確', () => {
  expect(
    buildAudiobookArgs({ title: '749局祕聞', selection: 'all', rate: '+0%', volume: '+50%', concurrency: '5', merge: true }),
  ).toEqual(['audiobook', '749局祕聞', 'all', '+0%', '+50%', '5', 'true'])
})

test('buildAudiobookArgs 本地目錄模式', () => {
  expect(
    buildAudiobookArgs({
      inputDir: '/tmp/chapters',
      outputDir: '/tmp/mp3',
      selection: '1-5',
      rate: '+0%',
      volume: '+0%',
      concurrency: '3',
      merge: false,
    }),
  ).toEqual(['audiobook', '--input=/tmp/chapters', '--output=/tmp/mp3', '1-5', '+0%', '+0%', '3', 'false'])
})

test('buildMergeArgs count 模式用 --size', () => {
  expect(buildMergeArgs({ inputDir: 'output/書', mode: 'count', value: '100' })).toEqual([
    'merge-mp3', 'output/書', '--size=100',
  ])
})

test('buildMergeArgs duration 模式用 --mode --target', () => {
  expect(buildMergeArgs({ inputDir: 'output/書', mode: 'duration', value: '39600' })).toEqual([
    'merge-mp3', 'output/書', '--mode=duration', '--target=39600',
  ])
})

test('buildConvertArgs 帶 input/output，metadata 選填', () => {
  expect(buildConvertArgs({ inputDir: 'a', outputDir: 'b' })).toEqual([
    'to-mp4', '--input=a', '--output=b',
  ])
  expect(buildConvertArgs({ inputDir: 'a', outputDir: 'b', metadata: 'm.json' })).toEqual([
    'to-mp4', '--input=a', '--output=b', '--metadata=m.json',
  ])
})

test('buildCrawlArgs / buildBackupArgs / buildRetryArgs', () => {
  expect(buildCrawlArgs('https://x.com')).toEqual(['start', 'https://x.com'])
  expect(buildBackupArgs()).toEqual(['backup'])
  expect(buildRetryArgs('書')).toEqual(['retry-failed', '書'])
})

describe('buildM4bArgs', () => {
  test('builds title-based args with target and bitrate', () => {
    expect(buildM4bArgs({ title: '某書', target: '39600', bitrate: '256' }))
      .toEqual(['build-m4b', '--title=某書', '--target=39600', '--bitrate=256'])
  })
  test('omits bitrate when not given', () => {
    expect(buildM4bArgs({ title: '某書', target: '39600' }))
      .toEqual(['build-m4b', '--title=某書', '--target=39600'])
  })
})
