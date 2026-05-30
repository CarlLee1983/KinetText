import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface FailedChapter {
  index: number
  title: string
  sourceUrl: string
  reason?: string
}

export type Overall = 'created' | 'crawl' | 'tts' | 'merge' | 'complete'

export interface BookStatus {
  title: string
  crawl: { saved: number; total: number | null; failed: number; reportDate: string | null }
  tts: { done: number; total: number; missing: number[] }
  merge: { count: number }
  convert: { m4a: number; mp4: number }
  m4b: { count: number }
  metadata: boolean
  failedChapters: FailedChapter[]
  overall: Overall
}

/** 從 "0001 - 標題.ext" 取出章節號；非章節檔回傳 null */
export function parseChapterIndex(filename: string): number | null {
  const m = filename.match(/^(\d{1,5}) - /)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isNaN(n) ? null : n
}

async function listIndices(dir: string, ext: string): Promise<number[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const out: number[] = []
  for (const name of entries) {
    if (!name.endsWith(ext)) continue
    const idx = parseChapterIndex(name)
    if (idx !== null) out.push(idx)
  }
  return out.sort((a, b) => a - b)
}

async function countFiles(dir: string, ext: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir)
    return entries.filter((n) => n.endsWith(ext)).length
  } catch {
    return 0
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8')) as T
  } catch {
    return null
  }
}

function computeOverall(b: Omit<BookStatus, 'overall'>): Overall {
  if (b.crawl.saved === 0 && b.tts.done === 0 && b.tts.total === 0) return 'created'
  if ((b.convert.m4a > 0 || b.convert.mp4 > 0 || b.m4b.count > 0) && b.tts.total > 0 && b.tts.missing.length === 0) return 'complete'
  if (b.merge.count > 0) return 'merge'
  if (b.tts.done > 0) return 'tts'
  return 'crawl'
}

export async function scanBook(outputRoot: string, title: string): Promise<BookStatus> {
  const dir = path.join(outputRoot, title)

  const txtIdx = await listIndices(path.join(dir, 'txt'), '.txt')
  const audioIdx = await listIndices(path.join(dir, 'audio'), '.mp3')
  const audioSet = new Set(audioIdx)
  const missing = txtIdx.filter((i) => !audioSet.has(i))

  const mergeCount = await countFiles(path.join(dir, 'merged'), '.mp3')
  const m4a = await countFiles(path.join(dir, 'm4a'), '.m4a')
  const mp4 = await countFiles(path.join(dir, 'mp4'), '.mp4')
  const m4bCount = await countFiles(path.join(dir, 'm4b'), '.m4b')

  const metadata =
    (await fileExists(path.join(dir, 'metadata.txt'))) ||
    (await fileExists(path.join(dir, 'metadata.json')))

  interface RunReport {
    book?: { chapterCount?: number }
    summary?: { saved?: number; failed?: number }
    runFinishedAt?: string
  }
  const report = await readJson<RunReport>(path.join(dir, 'run_report.json'))
  const failedChapters = (await readJson<FailedChapter[]>(path.join(dir, 'failed_chapters.json'))) ?? []

  const reportDate = report?.runFinishedAt ? report.runFinishedAt.slice(0, 10) : null
  const saved = report?.summary?.saved ?? txtIdx.length
  const total = report?.book?.chapterCount ?? (txtIdx.length > 0 ? txtIdx.length : null)
  const failed = report?.summary?.failed ?? failedChapters.length

  const partial: Omit<BookStatus, 'overall'> = {
    title,
    crawl: { saved, total, failed, reportDate },
    tts: { done: audioIdx.length, total: txtIdx.length, missing },
    merge: { count: mergeCount },
    convert: { m4a, mp4 },
    m4b: { count: m4bCount },
    metadata,
    failedChapters,
  }
  return { ...partial, overall: computeOverall(partial) }
}

export async function scanAllBooks(outputRoot: string): Promise<BookStatus[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(outputRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const titles = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const out: BookStatus[] = []
  for (const t of titles) out.push(await scanBook(outputRoot, t))
  return out
}
