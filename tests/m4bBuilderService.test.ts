import { afterEach, describe, expect, test } from 'bun:test'
import * as fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { M4BBuilderService } from '../src/core/services/M4BBuilderService'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

async function makeAudioDir(names: string[]): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kineti-m4b-'))
  tempDirs.push(root)
  const audio = path.join(root, 'audio')
  await fsp.mkdir(audio, { recursive: true })
  for (const n of names) await fsp.writeFile(path.join(audio, n), 'x')
  return audio
}

describe('M4BBuilderService.listChapters', () => {
  test('lists .mp3 sorted by chapter index with parsed titles', async () => {
    const audio = await makeAudioDir(['0002 - 第二章.mp3', '0001 - 第一章.mp3', 'note.txt'])
    const svc = new M4BBuilderService()
    const chapters = await svc.listChapters(audio)
    expect(chapters.map((c) => c.index)).toEqual([1, 2])
    expect(chapters.map((c) => c.title)).toEqual(['第一章', '第二章'])
    expect(chapters[0].path.endsWith('0001 - 第一章.mp3')).toBe(true)
  })

  test('returns empty array for missing dir', async () => {
    const svc = new M4BBuilderService()
    expect(await svc.listChapters('/no/such/dir')).toEqual([])
  })
})

import { DurationService } from '../src/core/services/DurationService'
import { RetryService } from '../src/core/services/RetryService'
import { RetryConfig } from '../src/config/RetryConfig'
import { AudioErrorClassifier } from '../src/core/services/AudioErrorClassifier'

/** 注入固定時長：每章 perFileSec 秒 */
function fixedDurationService(perFileSec: number): DurationService {
  return new DurationService({ metadataReader: async () => perFileSec })
}

describe('M4BBuilderService.build', () => {
  test('groups chapters into volumes by target duration and calls executor per volume', async () => {
    const audio = await makeAudioDir([
      '0001 - 一.mp3', '0002 - 二.mp3', '0003 - 三.mp3', '0004 - 四.mp3', '0005 - 五.mp3',
    ])
    const outputDir = path.join(path.dirname(audio), 'm4b')
    const calls: string[][] = []
    const svc = new M4BBuilderService({
      durationService: fixedDurationService(4),
      shellExecutor: async (args) => {
        calls.push(args)
        await fsp.writeFile(args[args.length - 1], 'fake-m4b') // 產出檔讓存在檢查通過
      },
    })

    // target 10s、容差 ±10% → 上界 11s → 每卷最多 2 章(8s)，第 3 章超界另起 → 3 卷(2,2,1)
    const report = await svc.build({
      audioDir: audio, outputDir, bookTitle: '測試書', targetSeconds: 10, bitrate: 128,
    })

    expect(report.totalChapters).toBe(5)
    expect(report.totalVolumes).toBe(3)
    expect(report.successCount).toBe(3)
    expect(report.failureCount).toBe(0)
    expect(calls.length).toBe(3)
    expect(report.volumes[0].outputPath.endsWith('測試書_vol01.m4b')).toBe(true)
    expect(report.volumes[2].outputPath.endsWith('測試書_vol03.m4b')).toBe(true)
  })

  test('dry-run produces report without calling executor', async () => {
    const audio = await makeAudioDir(['0001 - 一.mp3', '0002 - 二.mp3'])
    const outputDir = path.join(path.dirname(audio), 'm4b')
    let called = 0
    const svc = new M4BBuilderService({
      durationService: fixedDurationService(4),
      shellExecutor: async () => { called++ },
    })
    const report = await svc.build({
      audioDir: audio, outputDir, bookTitle: '測試書', targetSeconds: 10, dryRun: true,
    })
    expect(called).toBe(0)
    expect(report.dryRun).toBe(true)
    expect(report.totalVolumes).toBe(1)
    expect(report.successCount).toBe(0)
  })

  test('isolates per-volume failure without aborting others', async () => {
    const audio = await makeAudioDir([
      '0001 - 一.mp3', '0002 - 二.mp3', '0003 - 三.mp3', '0004 - 四.mp3',
    ])
    const outputDir = path.join(path.dirname(audio), 'm4b')
    let n = 0
    const svc = new M4BBuilderService({
      durationService: fixedDurationService(4),
      retryService: new RetryService(new RetryConfig({ maxRetries: 0 }), new AudioErrorClassifier()),
      shellExecutor: async (args) => {
        n++
        if (n === 1) throw new Error('boom')
        await fsp.writeFile(args[args.length - 1], 'ok')
      },
    })
    const report = await svc.build({
      audioDir: audio, outputDir, bookTitle: '測試書', targetSeconds: 10,
    })
    expect(report.totalVolumes).toBe(2)
    expect(report.successCount).toBe(1)
    expect(report.failureCount).toBe(1)
    expect(report.errors.length).toBe(1)
  })
})
