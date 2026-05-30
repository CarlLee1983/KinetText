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
