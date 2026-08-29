# TUI 控制台 Implementation Plan

> **歷史實作計畫（2026-05-30）**
>
> 此計畫已對應到完成的 TUI 功能；未勾選的步驟保留作為當時執行脈絡，並非目前待辦。請改閱 [現行路線圖](../../../.planning/ROADMAP.md)。


**Goal:** 為 KinetiText 新增一個 `bun run menu` 互動式 TUI 控制台，讓使用者不必背指令參數、自動接續 pipeline、並提供詳細的書籍進度檢視。

**Architecture:** 新增 `src/tui/` 模組。TUI 只負責「互動問答 → 組 argv → 用子程序呼叫現有 `bun run <script>` → 即時串流輸出」。所有爬取/TTS/合併/轉檔邏輯留在現有 script，一行不改。狀態檢視透過純函式掃描 `output/` 目錄推導各階段進度。

**Tech Stack:** Bun + TypeScript、`@clack/prompts`（互動選單）、`music-metadata`（既有依賴，估算時長）、`bun:test`（測試）。

**Spec:** `docs/history/specs/2026-05-30-tui-control-panel-design.md`

---

## File Structure

```
src/tui/
├── index.ts        # 入口：主迴圈、主選單、分派、頂層 try/catch
├── paths.ts        # output/ 路徑推導 helper（runtime 用）
├── books.ts        # 純函式：掃描 output/ → BookStatus[]（狀態檢視資料層）
├── runner.ts       # argv 組裝（純函式）+ runScript（spawn 子程序）
├── status.ts       # 狀態檢視畫面：總覽表 + 單書展開 + 子操作
└── actions/
    ├── crawl.ts        # 問 URL → start
    ├── audiobook.ts    # 選書/範圍/語速/音量/並行/合併 → audiobook
    ├── merge.ts        # 選書/模式/目標值 → merge-mp3
    ├── convert.ts      # 選書/bitrate → to-mp4
    ├── backup.ts       # → backup
    └── pipeline.ts     # 一鍵全跑
tests/tui/
├── books.test.ts
├── runner.test.ts
└── status.test.ts
```

---

## Task 1: 安裝依賴與新增 menu 指令

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安裝 @clack/prompts**

Run:
```bash
bun add @clack/prompts
```
Expected: `package.json` 的 `dependencies` 多出 `@clack/prompts`，`bun.lockb` 更新。

- [ ] **Step 2: 在 package.json scripts 新增 menu 指令**

在 `package.json` 的 `"scripts"` 區塊，於 `"start"` 之後加入一行：

```json
    "menu": "bun run src/tui/index.ts",
```

- [ ] **Step 3: 驗證指令存在（尚未實作會報找不到檔案，正常）**

Run:
```bash
bun run menu 2>&1 | head -3
```
Expected: 出現找不到 `src/tui/index.ts` 的錯誤（檔案還沒建）。代表 npm script 已註冊成功。

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: [tui] 新增 @clack/prompts 依賴與 menu 指令"
```

---

## Task 2: paths.ts 路徑 helper

**Files:**
- Create: `src/tui/paths.ts`

- [ ] **Step 1: 建立 paths.ts**

```typescript
import path from 'node:path'

/** output/ 根目錄（執行時相對於專案根） */
export const OUTPUT_ROOT = path.join(process.cwd(), 'output')

export const bookDir = (title: string): string => path.join(OUTPUT_ROOT, title)
export const txtDir = (title: string): string => path.join(bookDir(title), 'txt')
export const audioDir = (title: string): string => path.join(bookDir(title), 'audio')
export const mergedDir = (title: string): string => path.join(bookDir(title), 'merged')
export const m4aDir = (title: string): string => path.join(bookDir(title), 'm4a')
export const metadataJsonPath = (title: string): string => path.join(bookDir(title), 'metadata.json')
```

- [ ] **Step 2: 型別檢查通過**

Run:
```bash
bun build src/tui/paths.ts --target=bun > /dev/null && echo OK
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/tui/paths.ts
git commit -m "feat: [tui] 新增 output 路徑 helper"
```

---

## Task 3: books.ts 狀態掃描資料層（核心，TDD）

這是狀態檢視的心臟，純函式、最值得測。

**Files:**
- Create: `src/tui/books.ts`
- Test: `tests/tui/books.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/tui/books.test.ts`：

```typescript
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run:
```bash
bun test tests/tui/books.test.ts
```
Expected: FAIL，`Cannot find module '../../src/tui/books'`。

- [ ] **Step 3: 實作 books.ts**

```typescript
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
  metadata: boolean
  failedChapters: FailedChapter[]
  overall: Overall
}

/** 從 "0001 - 標題.ext" 取出章節號；非章節檔回傳 null */
export function parseChapterIndex(filename: string): number | null {
  const m = filename.match(/^(\d{1,5})\b/)
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
  if (b.convert.m4a > 0 || b.convert.mp4 > 0) return 'complete'
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
```

- [ ] **Step 4: 執行測試確認通過**

Run:
```bash
bun test tests/tui/books.test.ts
```
Expected: PASS，5 個測試全綠。

- [ ] **Step 5: 用真實資料 smoke test**

Run:
```bash
bun -e "import('./src/tui/books').then(async m => console.log(JSON.stringify((await m.scanAllBooks('./output')).map(b => ({t:b.title, tts:b.tts.done+'/'+b.tts.total, merge:b.merge.count, overall:b.overall})), null, 2)))"
```
Expected: 印出 `749局祕聞` 的真實統計（tts 約 715/715、merge 9、overall 視 m4a 而定）。

- [ ] **Step 6: Commit**

```bash
git add src/tui/books.ts tests/tui/books.test.ts
git commit -m "feat: [tui] 新增 books 狀態掃描資料層 + 測試"
```

---

## Task 4: runner.ts argv 組裝與子程序執行（TDD）

**Files:**
- Create: `src/tui/runner.ts`
- Test: `tests/tui/runner.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/tui/runner.test.ts`：

```typescript
import { test, expect } from 'bun:test'
import {
  buildAudiobookArgs,
  buildMergeArgs,
  buildConvertArgs,
  buildCrawlArgs,
  buildBackupArgs,
  buildRetryArgs,
} from '../../src/tui/runner'

test('buildAudiobookArgs 位置參數順序正確', () => {
  expect(
    buildAudiobookArgs({ title: '749局祕聞', selection: 'all', rate: '+0%', volume: '+50%', concurrency: '5', merge: true }),
  ).toEqual(['audiobook', '749局祕聞', 'all', '+0%', '+50%', '5', 'true'])
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run:
```bash
bun test tests/tui/runner.test.ts
```
Expected: FAIL，找不到模組。

- [ ] **Step 3: 實作 runner.ts**

```typescript
export interface AudiobookInput {
  title: string
  selection: string
  rate: string
  volume: string
  concurrency: string
  merge: boolean
}

export function buildAudiobookArgs(i: AudiobookInput): string[] {
  return ['audiobook', i.title, i.selection, i.rate, i.volume, i.concurrency, String(i.merge)]
}

export interface MergeInput {
  inputDir: string
  mode: 'count' | 'duration'
  value: string
}

export function buildMergeArgs(i: MergeInput): string[] {
  if (i.mode === 'duration') {
    return ['merge-mp3', i.inputDir, '--mode=duration', `--target=${i.value}`]
  }
  return ['merge-mp3', i.inputDir, `--size=${i.value}`]
}

export interface ConvertInput {
  inputDir: string
  outputDir: string
  metadata?: string
}

export function buildConvertArgs(i: ConvertInput): string[] {
  const args = ['to-mp4', `--input=${i.inputDir}`, `--output=${i.outputDir}`]
  if (i.metadata) args.push(`--metadata=${i.metadata}`)
  return args
}

export function buildCrawlArgs(url: string): string[] {
  return ['start', url]
}

export function buildBackupArgs(): string[] {
  return ['backup']
}

export function buildRetryArgs(title: string): string[] {
  return ['retry-failed', title]
}

/**
 * 以子程序執行 `bun run <args>`，stdio 直接繼承（即時串流）。
 * @param env 額外環境變數（例如 MP4_BITRATE）
 * @returns 子程序 exit code（0 = 成功）
 */
export async function runScript(args: string[], env?: Record<string, string>): Promise<number> {
  const proc = Bun.spawn(['bun', 'run', ...args], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  })
  return await proc.exited
}
```

- [ ] **Step 4: 執行測試確認通過**

Run:
```bash
bun test tests/tui/runner.test.ts
```
Expected: PASS，5 個測試全綠。

- [ ] **Step 5: Commit**

```bash
git add src/tui/runner.ts tests/tui/runner.test.ts
git commit -m "feat: [tui] 新增 runner argv 組裝與子程序執行 + 測試"
```

---

## Task 5: status.ts 狀態檢視畫面

含可測的純格式函式，其餘為互動渲染（手動驗收）。

**Files:**
- Create: `src/tui/status.ts`
- Test: `tests/tui/status.test.ts`

> 注意：`status.ts` 會 import Task 6 才建立的 `actions/*`。本 Task 先寫好 status.ts 與其純函式測試，但 `tests/tui/status.test.ts` 的執行驗證（Step 4）改到 Task 7 Step 3 統一跑（屆時 actions 已存在）。本 Task 的 Step 內只驗證型別與純函式邏輯。

- [ ] **Step 1: 寫格式函式測試**

建立 `tests/tui/status.test.ts`：

```typescript
import { test, expect } from 'bun:test'
import { formatStageCell, overallLabel } from '../../src/tui/status'

test('formatStageCell 完成顯示 ✓', () => {
  expect(formatStageCell(716, 716)).toBe('716/716 ✓')
})

test('formatStageCell 部分完成不加勾', () => {
  expect(formatStageCell(280, 320)).toBe('280/320')
})

test('formatStageCell 未開始顯示破折號', () => {
  expect(formatStageCell(0, 0)).toBe('—')
})

test('overallLabel 對應中文狀態', () => {
  expect(overallLabel('complete')).toContain('完成')
  expect(overallLabel('tts')).toContain('TTS')
  expect(overallLabel('created')).toContain('建立')
})
```

- [ ] **Step 2: 實作 status.ts**

```typescript
import { select, isCancel } from '@clack/prompts'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parseFile } from 'music-metadata'
import { scanAllBooks, type BookStatus, type Overall } from './books'
import { OUTPUT_ROOT, mergedDir } from './paths'
import { audiobookAction } from './actions/audiobook'
import { mergeAction } from './actions/merge'
import { convertAction } from './actions/convert'
import { runScript, buildRetryArgs } from './runner'

export function formatStageCell(done: number, total: number): string {
  if (total === 0 && done === 0) return '—'
  if (done >= total && total > 0) return `${done}/${total} ✓`
  return `${done}/${total}`
}

export function overallLabel(o: Overall): string {
  switch (o) {
    case 'complete': return '✅ 完成'
    case 'merge': return '🔗 待轉檔'
    case 'tts': return '🔄 TTS 中'
    case 'crawl': return '🕷 已爬取'
    case 'created': return '⏸ 僅建立'
  }
}

/** 估算 merged 目錄總時長（秒）；失敗回 null（best-effort） */
async function mergedDurationSec(title: string): Promise<number | null> {
  try {
    const dir = mergedDir(title)
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.mp3'))
    let total = 0
    for (const f of files) {
      const meta = await parseFile(path.join(dir, f))
      total += meta.format.duration ?? 0
    }
    return total
  } catch {
    return null
  }
}

function renderOverview(books: BookStatus[]): void {
  console.log('')
  console.log('書名'.padEnd(20) + '爬取'.padEnd(14) + 'TTS'.padEnd(14) + '合併'.padEnd(8) + '轉檔'.padEnd(8) + '狀態')
  console.log('─'.repeat(72))
  for (const b of books) {
    const crawl = formatStageCell(b.crawl.saved, b.crawl.total ?? 0) + (b.crawl.failed > 0 ? ' ⚠' : '')
    const tts = formatStageCell(b.tts.done, b.tts.total)
    const merge = b.merge.count > 0 ? `${b.merge.count} 檔` : '—'
    const conv = b.convert.m4a + b.convert.mp4 > 0 ? `${b.convert.m4a + b.convert.mp4} ✓` : '—'
    console.log(
      b.title.padEnd(18) + crawl.padEnd(14) + tts.padEnd(14) + merge.padEnd(8) + conv.padEnd(8) + overallLabel(b.overall),
    )
  }
  console.log('')
}

async function renderExpanded(b: BookStatus): Promise<void> {
  const dur = await mergedDurationSec(b.title)
  const durStr = dur ? ` 總時長 ~${(dur / 3600).toFixed(1)}h` : ''
  console.log('')
  console.log(`📖 ${b.title}`)
  console.log(`├ 爬取    ${b.crawl.saved}/${b.crawl.total ?? '—'} 章   失敗 ${b.crawl.failed}   (${b.crawl.reportDate ?? '無報告'})`)
  console.log(`├ TTS     ${b.tts.done} 個 mp3   缺 ${b.tts.missing.length} 章` +
    (b.tts.missing.length > 0 ? `：${b.tts.missing.slice(0, 20).join(', ')}${b.tts.missing.length > 20 ? ' …' : ''}` : ''))
  console.log(`├ 合併    ${b.merge.count} 個 merged 檔${durStr}`)
  console.log(`├ 轉檔    ${b.convert.m4a} 個 m4a / ${b.convert.mp4} 個 mp4`)
  console.log(`├ 元資料  ${b.metadata ? '✓' : '✗'}`)
  const failHead = b.failedChapters.length > 0
    ? b.failedChapters.slice(0, 10).map((c) => `${c.index}(${c.reason ?? '?'})`).join(', ')
    : '無'
  console.log(`└ ⚠ 失敗章節 (${b.failedChapters.length})：${failHead}`)
  console.log('')
}

/** 主入口：總覽 → 選書展開 → 子操作 */
export async function showStatus(): Promise<void> {
  const books = await scanAllBooks(OUTPUT_ROOT)
  if (books.length === 0) {
    console.log('\n（output/ 下尚無任何書籍）\n')
    return
  }
  renderOverview(books)

  const pick = await select({
    message: '展開哪一本？',
    options: [...books.map((b) => ({ value: b.title, label: b.title })), { value: '__back', label: '← 返回主選單' }],
  })
  if (isCancel(pick) || pick === '__back') return

  const book = books.find((b) => b.title === pick)!
  await renderExpanded(book)

  const op = await select({
    message: '操作',
    options: [
      { value: 'tts', label: '接續跑 TTS（補缺章）' },
      { value: 'retry', label: '重試失敗章節' },
      { value: 'merge', label: '合併' },
      { value: 'convert', label: '轉檔' },
      { value: 'back', label: '← 返回' },
    ],
  })
  if (isCancel(op) || op === 'back') return

  switch (op) {
    case 'tts': await audiobookAction(book.title); break
    case 'retry': {
      const code = await runScript(buildRetryArgs(book.title))
      if (code !== 0) console.error(`\n❌ 重試失敗 (exit ${code})`)
      break
    }
    case 'merge': await mergeAction(book.title); break
    case 'convert': await convertAction(book.title); break
  }
}
```

> 註：`audiobookAction` / `mergeAction` / `convertAction` 都接受選填 `presetTitle` 參數（Task 6 定義），有帶就跳過選書步驟。

- [ ] **Step 3: 型別檢查（actions 尚未建立，預期報缺 actions 模組 → 待 Task 6 後再驗）**

Run:
```bash
bun build src/tui/status.ts --target=bun > /dev/null 2>&1; echo "exit=$?"
```
Expected: 非 0（因 import 尚未建立的 `./actions/*`）。這是預期的；Task 7 Step 3 會在 actions 建立後統一驗證。

- [ ] **Step 4: Commit**

```bash
git add src/tui/status.ts tests/tui/status.test.ts
git commit -m "feat: [tui] 新增狀態檢視畫面（總覽表 + 單書展開）+ 格式測試"
```

---

## Task 6: actions/*.ts 互動動作

每個檔案小而專一。互動層手動驗收，但實作完整不留空白。

**Files:**
- Create: `src/tui/actions/crawl.ts`
- Create: `src/tui/actions/audiobook.ts`
- Create: `src/tui/actions/merge.ts`
- Create: `src/tui/actions/convert.ts`
- Create: `src/tui/actions/backup.ts`
- Create: `src/tui/actions/pipeline.ts`

- [ ] **Step 1: 建立 crawl.ts**

```typescript
import { text, isCancel, cancel } from '@clack/prompts'
import { buildCrawlArgs, runScript } from '../runner'

export async function crawlAction(): Promise<void> {
  const url = await text({
    message: '小說網址 URL',
    placeholder: 'https://twp.zhys.tw/book/777167.html',
    validate: (v) => (v && v.startsWith('http') ? undefined : '請輸入有效的 http(s) 網址'),
  })
  if (isCancel(url)) {
    cancel('已取消')
    return
  }
  const code = await runScript(buildCrawlArgs(String(url)))
  if (code !== 0) console.error(`\n❌ 爬取失敗 (exit ${code})`)
}
```

- [ ] **Step 2: 建立 audiobook.ts（支援 presetTitle 跳過選書）**

```typescript
import { select, text, confirm, isCancel, cancel } from '@clack/prompts'
import { scanAllBooks } from '../books'
import { buildAudiobookArgs, runScript } from '../runner'
import { OUTPUT_ROOT } from '../paths'

async function pickBook(message: string): Promise<string | null> {
  const books = await scanAllBooks(OUTPUT_ROOT)
  if (books.length === 0) {
    console.log('\n（尚無書籍，請先爬取）\n')
    return null
  }
  const title = await select({
    message,
    options: books.map((b) => ({ value: b.title, label: `${b.title}（txt ${b.crawl.saved} 章 / 缺 ${b.tts.missing.length}）` })),
  })
  if (isCancel(title)) {
    cancel('已取消')
    return null
  }
  return String(title)
}

export async function audiobookAction(presetTitle?: string): Promise<void> {
  const title = presetTitle ?? (await pickBook('選擇要生成語音的書籍'))
  if (!title) return

  const selection = await text({ message: '章節範圍', placeholder: '5 / 10-20 / 2,4,10', initialValue: 'all' })
  if (isCancel(selection)) return cancel('已取消')
  const rate = await text({ message: '語速（如 +20% / -10%）', initialValue: '+0%' })
  if (isCancel(rate)) return cancel('已取消')
  const volume = await text({ message: '音量（如 +50%）', initialValue: '+0%' })
  if (isCancel(volume)) return cancel('已取消')
  const concurrency = await text({ message: '並行數', initialValue: '3' })
  if (isCancel(concurrency)) return cancel('已取消')
  const merge = await confirm({ message: '跑完後合併？', initialValue: false })
  if (isCancel(merge)) return cancel('已取消')

  const code = await runScript(
    buildAudiobookArgs({
      title,
      selection: String(selection),
      rate: String(rate),
      volume: String(volume),
      concurrency: String(concurrency),
      merge: Boolean(merge),
    }),
  )
  if (code !== 0) console.error(`\n❌ TTS 失敗 (exit ${code})`)
}
```

- [ ] **Step 3: 建立 merge.ts**

```typescript
import { select, text, isCancel, cancel } from '@clack/prompts'
import { scanAllBooks } from '../books'
import { buildMergeArgs, runScript } from '../runner'
import { OUTPUT_ROOT, bookDir } from '../paths'

export async function mergeAction(presetTitle?: string): Promise<void> {
  let title = presetTitle
  if (!title) {
    const books = await scanAllBooks(OUTPUT_ROOT)
    if (books.length === 0) {
      console.log('\n（尚無書籍）\n')
      return
    }
    const picked = await select({ message: '選擇要合併的書籍', options: books.map((b) => ({ value: b.title, label: b.title })) })
    if (isCancel(picked)) return cancel('已取消')
    title = String(picked)
  }

  const mode = await select({
    message: '合併模式',
    options: [
      { value: 'duration', label: '按時長（適合上傳長度限制）' },
      { value: 'count', label: '按數量（每 N 章一檔）' },
    ],
  })
  if (isCancel(mode)) return cancel('已取消')

  let value: string
  if (mode === 'duration') {
    const t = await text({ message: '目標時長（秒，預設 11h=39600）', initialValue: '39600' })
    if (isCancel(t)) return cancel('已取消')
    value = String(t)
  } else {
    const s = await text({ message: '每檔章節數', initialValue: '100' })
    if (isCancel(s)) return cancel('已取消')
    value = String(s)
  }

  const code = await runScript(buildMergeArgs({ inputDir: bookDir(title), mode: mode as 'count' | 'duration', value }))
  if (code !== 0) console.error(`\n❌ 合併失敗 (exit ${code})`)
}
```

- [ ] **Step 4: 建立 convert.ts**

```typescript
import { select, text, isCancel, cancel } from '@clack/prompts'
import * as fs from 'node:fs/promises'
import { scanAllBooks } from '../books'
import { buildConvertArgs, runScript } from '../runner'
import { OUTPUT_ROOT, mergedDir, m4aDir, metadataJsonPath } from '../paths'

export async function convertAction(presetTitle?: string): Promise<void> {
  let title = presetTitle
  if (!title) {
    const books = await scanAllBooks(OUTPUT_ROOT)
    if (books.length === 0) {
      console.log('\n（尚無書籍）\n')
      return
    }
    const picked = await select({ message: '選擇要轉檔的書籍', options: books.map((b) => ({ value: b.title, label: `${b.title}（merged ${b.merge.count} 檔）` })) })
    if (isCancel(picked)) return cancel('已取消')
    title = String(picked)
  }

  const bitrate = await text({ message: 'AAC bitrate（96k–320k）', initialValue: '256k' })
  if (isCancel(bitrate)) return cancel('已取消')

  let metadata: string | undefined
  try {
    await fs.access(metadataJsonPath(title))
    metadata = metadataJsonPath(title)
  } catch {
    metadata = undefined
  }

  const code = await runScript(
    buildConvertArgs({ inputDir: mergedDir(title), outputDir: m4aDir(title), metadata }),
    { MP4_BITRATE: String(bitrate) },
  )
  if (code !== 0) console.error(`\n❌ 轉檔失敗 (exit ${code})`)
}
```

- [ ] **Step 5: 建立 backup.ts**

```typescript
import { confirm, isCancel, cancel } from '@clack/prompts'
import { buildBackupArgs, runScript } from '../runner'

export async function backupAction(): Promise<void> {
  const ok = await confirm({ message: '開始雲端備份？', initialValue: true })
  if (isCancel(ok) || !ok) {
    cancel('已取消')
    return
  }
  const code = await runScript(buildBackupArgs())
  if (code !== 0) console.error(`\n❌ 備份失敗 (exit ${code})`)
}
```

- [ ] **Step 6: 建立 pipeline.ts**

```typescript
import { text, confirm, isCancel, cancel } from '@clack/prompts'
import {
  buildCrawlArgs,
  buildAudiobookArgs,
  buildMergeArgs,
  buildConvertArgs,
  buildBackupArgs,
  runScript,
} from '../runner'

interface Step {
  label: string
  args: string[]
  env?: Record<string, string>
}

export async function pipelineAction(): Promise<void> {
  const url = await text({
    message: '小說網址 URL（會從爬取一路跑到備份）',
    placeholder: 'https://twp.zhys.tw/book/777167.html',
    validate: (v) => (v && v.startsWith('http') ? undefined : '請輸入有效的 http(s) 網址'),
  })
  if (isCancel(url)) return cancel('已取消')

  const title = await text({ message: '書名（須與爬取後的資料夾名一致）' })
  if (isCancel(title)) return cancel('已取消')

  const go = await confirm({ message: `將依序執行：爬取 → TTS(all) → 合併 → 轉檔 → 備份。開始？`, initialValue: true })
  if (isCancel(go) || !go) return cancel('已取消')

  const t = String(title)
  const steps: Step[] = [
    { label: '① 爬取', args: buildCrawlArgs(String(url)) },
    { label: '② TTS', args: buildAudiobookArgs({ title: t, selection: 'all', rate: '+0%', volume: '+0%', concurrency: '3', merge: false }) },
    { label: '③ 合併', args: buildMergeArgs({ inputDir: `output/${t}`, mode: 'duration', value: '39600' }) },
    { label: '④ 轉檔', args: buildConvertArgs({ inputDir: `output/${t}/merged`, outputDir: `output/${t}/m4a` }) },
    { label: '⑤ 備份', args: buildBackupArgs() },
  ]

  for (const step of steps) {
    console.log(`\n========== ${step.label} ==========\n`)
    const code = await runScript(step.args, step.env)
    if (code !== 0) {
      console.error(`\n❌ Pipeline 停在「${step.label}」(exit ${code})。`)
      console.error(`修正後可重開 bun run menu 從該步手動接續。`)
      return
    }
  }
  console.log('\n✅ Pipeline 全部完成！\n')
}
```

- [ ] **Step 7: 型別檢查全部 action**

Run:
```bash
bun build src/tui/actions/crawl.ts src/tui/actions/audiobook.ts src/tui/actions/merge.ts src/tui/actions/convert.ts src/tui/actions/backup.ts src/tui/actions/pipeline.ts --target=bun > /dev/null && echo OK
```
Expected: `OK`（無型別錯誤）

- [ ] **Step 8: Commit**

```bash
git add src/tui/actions
git commit -m "feat: [tui] 新增六個互動動作（爬取/TTS/合併/轉檔/備份/pipeline）"
```

---

## Task 7: index.ts 主入口與主迴圈

**Files:**
- Create: `src/tui/index.ts`

- [ ] **Step 1: 建立 index.ts**

```typescript
import { intro, outro, select, isCancel } from '@clack/prompts'
import { showStatus } from './status'
import { crawlAction } from './actions/crawl'
import { audiobookAction } from './actions/audiobook'
import { mergeAction } from './actions/merge'
import { convertAction } from './actions/convert'
import { backupAction } from './actions/backup'
import { pipelineAction } from './actions/pipeline'

async function main(): Promise<void> {
  intro('📚 KinetiText 控制台')

  while (true) {
    const action = await select({
      message: '選擇動作',
      options: [
        { value: 'status', label: '📊 檢視狀態' },
        { value: 'crawl', label: '🕷  爬取小說' },
        { value: 'audiobook', label: '🎙  生成語音書 (TTS)' },
        { value: 'merge', label: '🔗 合併 MP3' },
        { value: 'convert', label: '🎬 轉檔 M4A' },
        { value: 'backup', label: '☁  雲端備份' },
        { value: 'pipeline', label: '🚀 一鍵全跑' },
        { value: 'exit', label: '🚪 離開' },
      ],
    })

    if (isCancel(action) || action === 'exit') {
      outro('掰掰 👋')
      break
    }

    try {
      switch (action) {
        case 'status': await showStatus(); break
        case 'crawl': await crawlAction(); break
        case 'audiobook': await audiobookAction(); break
        case 'merge': await mergeAction(); break
        case 'convert': await convertAction(); break
        case 'backup': await backupAction(); break
        case 'pipeline': await pipelineAction(); break
      }
    } catch (e) {
      console.error(`\n❌ 發生錯誤：${e instanceof Error ? e.message : String(e)}\n`)
    }
  }
}

main()
```

- [ ] **Step 2: 型別檢查整個 tui 模組**

Run:
```bash
bun build src/tui/index.ts --target=bun > /dev/null && echo OK
```
Expected: `OK`

- [ ] **Step 3: 跑全部 tui 測試（此時 actions 已存在，status.test 可正常解析）**

Run:
```bash
bun test tests/tui/
```
Expected: 三個測試檔（books / runner / status）全綠。

- [ ] **Step 4: 手動驗收主選單**

Run:
```bash
bun run menu
```
驗收清單（手動操作）：
- 出現 `📚 KinetiText 控制台` 與 8 項主選單，方向鍵可移動。
- 進「📊 檢視狀態」→ 看到 `749局祕聞` 總覽列，數字與真實一致。
- 展開 `749局祕聞` → 看到爬取/TTS/合併/轉檔/失敗章節分行。
- 進「🎙 生成語音書」→ 能用方向鍵選書，不需打書名；各參數有預設值；可 Ctrl+C 取消而不崩潰。
- 選「🚪 離開」→ 乾淨結束。

- [ ] **Step 5: Commit**

```bash
git add src/tui/index.ts
git commit -m "feat: [tui] 新增主入口與主選單迴圈"
```

---

## Task 8: 文件與最終驗收

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: README 加入 TUI 章節**

在 README.md「🔧 完整指令列表」表格上方，新增一段：

````markdown
## 🎛 互動式控制台（推薦）

不想記指令參數？直接開控制台，全程用方向鍵選：

```bash
bun run menu
```

- 📊 檢視狀態：一眼看完所有書的爬取/TTS/合併/轉檔進度與缺章
- 🎙 生成語音書：選書、選範圍，不必打路徑或記 flag
- 🚀 一鍵全跑：爬取 → TTS → 合併 → 轉檔 → 備份 自動接續

底層仍呼叫下方各指令，兩種用法可混用。
````

並在「🔧 完整指令列表」表格頂端加一列：

```markdown
| `bun run menu` | 互動式控制台 | TUI |
```

- [ ] **Step 2: AGENTS.md 補一行架構說明**

在 AGENTS.md「🏗️ Architecture Overview」清單末尾加入：

```markdown
- **TUI (`src/tui/`)**: 互動式控制台（`bun run menu`）。只負責互動問答 → 組參數 → 子程序呼叫現有 script，不含任何爬取/轉檔邏輯。狀態檢視由 `books.ts` 純函式掃描 `output/` 推導。
```

- [ ] **Step 3: 全測試 + 確認既有指令未受影響**

Run:
```bash
bun test
```
Expected: 全部測試通過（含既有 488+ 測試與新增 tui 測試），既有指令行為不變。

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: [tui] README/AGENTS 補充控制台用法與架構說明"
```

---

## 驗收標準對照（來自 spec）

| # | 驗收標準 | 對應 Task |
|---|---|---|
| 1 | `bun run menu` 進主選單、方向鍵可選 | Task 7 |
| 2 | audiobook/merge/convert 不需打路徑或記 flag | Task 6 |
| 3 | 狀態總覽表正確反映 `output/749局祕聞` | Task 3, 5 |
| 4 | 單書展開列出缺號與失敗章節、可一鍵接續 | Task 3, 5 |
| 5 | 一鍵 pipeline 爬取→備份、失敗有提示 | Task 6 |
| 6 | books.ts 與 runner.ts 有 bun:test 覆蓋 | Task 3, 4 |
| 7 | 現有 12 個指令行為不變 | Task 8 Step 3 |
