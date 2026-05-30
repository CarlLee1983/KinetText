import { test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { parseChapterIndex, scanBook, scanAllBooks } from '../../src/tui/books'

let root = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-books-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function makeFiles(dir: string, names: string[]) {
  await fs.mkdir(dir, { recursive: true })
  for (const n of names) await fs.writeFile(path.join(dir, n), 'x')
}

test('parseChapterIndex 解析 4 位數字前綴', () => {
  expect(parseChapterIndex('0001 - 第一章.txt')).toBe(1)
  expect(parseChapterIndex('0042 - 標題.mp3')).toBe(42)
  expect(parseChapterIndex('metadata.txt')).toBeNull()
  expect(parseChapterIndex('亂七八糟.mp3')).toBeNull()
})

test('scanBook 計算各階段數量與缺號', async () => {
  const title = '測試書'
  await makeFiles(path.join(root, title, 'txt'), [
    '0001 - a.txt', '0002 - b.txt', '0003 - c.txt',
  ])
  await makeFiles(path.join(root, title, 'audio'), [
    '0001 - a.mp3', '0003 - c.mp3', // 缺 0002
  ])
  await makeFiles(path.join(root, title, 'merged'), ['測試書_001-003_merged.mp3'])
  await makeFiles(path.join(root, title, 'm4a'), [])
  await fs.writeFile(path.join(root, title, 'metadata.txt'), 'meta')

  const b = await scanBook(root, title)
  expect(b.title).toBe(title)
  expect(b.tts.total).toBe(3)
  expect(b.tts.done).toBe(2)
  expect(b.tts.missing).toEqual([2])
  expect(b.merge.count).toBe(1)
  expect(b.convert.m4a).toBe(0)
  expect(b.metadata).toBe(true)
  expect(b.overall).toBe('merge') // 已合併、未轉檔
})

test('scanBook 解析 failed_chapters.json 與 run_report', async () => {
  const title = 'F書'
  await makeFiles(path.join(root, title, 'txt'), ['0001 - a.txt'])
  await fs.writeFile(
    path.join(root, title, 'run_report.json'),
    JSON.stringify({ book: { chapterCount: 10 }, summary: { saved: 8, failed: 2 }, runFinishedAt: '2026-05-29T04:50:38.561Z' }),
  )
  await fs.writeFile(
    path.join(root, title, 'failed_chapters.json'),
    JSON.stringify([{ index: 5, title: '第五章', sourceUrl: 'https://e.com/5', reason: 'timeout' }]),
  )

  const b = await scanBook(root, title)
  expect(b.crawl.saved).toBe(8)
  expect(b.crawl.total).toBe(10)
  expect(b.crawl.failed).toBe(2)
  expect(b.crawl.reportDate).toBe('2026-05-29')
  expect(b.failedChapters).toHaveLength(1)
  expect(b.failedChapters[0].index).toBe(5)
})

test('scanAllBooks 列出所有書並排序', async () => {
  await makeFiles(path.join(root, 'B書', 'txt'), ['0001 - a.txt'])
  await makeFiles(path.join(root, 'A書', 'txt'), ['0001 - a.txt'])
  const all = await scanAllBooks(root)
  expect(all.map((b) => b.title)).toEqual(['A書', 'B書'])
})

test('scanAllBooks output 不存在時回傳空陣列', async () => {
  const all = await scanAllBooks(path.join(root, '不存在'))
  expect(all).toEqual([])
})

test('computeOverall 涵蓋各階段狀態', async () => {
  await fs.mkdir(path.join(root, '空書'), { recursive: true })
  expect((await scanBook(root, '空書')).overall).toBe('created')

  await makeFiles(path.join(root, 'C書', 'txt'), ['0001 - a.txt'])
  expect((await scanBook(root, 'C書')).overall).toBe('crawl')

  await makeFiles(path.join(root, 'T書', 'txt'), ['0001 - a.txt', '0002 - b.txt'])
  await makeFiles(path.join(root, 'T書', 'audio'), ['0001 - a.mp3'])
  expect((await scanBook(root, 'T書')).overall).toBe('tts')

  await makeFiles(path.join(root, 'X書', 'txt'), ['0001 - a.txt'])
  await makeFiles(path.join(root, 'X書', 'audio'), ['0001 - a.mp3'])
  await makeFiles(path.join(root, 'X書', 'merged'), ['X書_001-001_merged.mp3'])
  await makeFiles(path.join(root, 'X書', 'm4a'), ['X書_001-001_merged.m4a'])
  expect((await scanBook(root, 'X書')).overall).toBe('complete')
})

test('parseChapterIndex 不誤判非章節數字檔名', () => {
  expect(parseChapterIndex('2024年度.txt')).toBeNull()
  expect(parseChapterIndex('0.mp3')).toBeNull()
})

test('counts m4b volumes', async () => {
  await makeFiles(path.join(root, '某書', 'm4b'), ['某書_vol01.m4b', '某書_vol02.m4b'])
  const status = await scanBook(root, '某書')
  expect(status.m4b.count).toBe(2)
})
