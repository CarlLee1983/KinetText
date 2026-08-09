# YT Pipeline Implementation Plan

> **歷史實作計畫（2026-06-26）**
>
> 此計畫已對應到完成的 YT pipeline 功能；未勾選的步驟保留作為當時執行脈絡，並非目前待辦。請改閱 [現行路線圖](../../../.planning/ROADMAP.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供一支 `bun run yt-pipeline <url>` 指令，從小說網址一路產出可上傳 YouTube 的 MP4（爬文 → TTS mp3 → 時長合併 → 自動封面 + MP4）。

**Architecture:** orchestrator 腳本以子程序複用既有 `start` / `audiobook` / `merge-mp3` 三步，失敗即停；第四步在程序內逐段用新增的 `CoverGenerator` 生成「書名 + partN」靜態封面，再以既有 `buildMP4WithImageCommand` 出 H.264+AAC MP4。只新增程式，不改既有三步腳本的行為。

**Tech Stack:** Bun + TypeScript、ffmpeg（lavfi color + drawtext + libx264 + aac）、bun:test。

## Global Constraints

- 執行環境僅 Bun，禁用 Node.js / npm / npx；I/O 優先 `Bun.file()`，shell 用 `Bun.$`，子程序用 `Bun.spawn`。
- ffmpeg 參數一律以「字串陣列」傳入（非 shell 字串），避免注入；文字跳脫沿用既有模式。
- 既有腳本 `scripts/start`(`src/index.ts`) / `scripts/generate_audiobook.ts` / `scripts/merge_mp3.ts` 行為不得更動。
- 輸出落點：封面 `output/<書名>/mp4/.covers/`，MP4 `output/<書名>/mp4/`。
- 預設字型 `/System/Library/Fonts/PingFang.ttc`（CJK），可 `--font=` 覆蓋。
- 影片解析度 1920×1080，AAC 預設 256k，時長分段預設 `--target=6h`。
- commit 訊息格式：`<type>: [ <scope> ] <subject>`。

---

### Task 1: 封面 ffmpeg 參數 builder（純函式）

**Files:**
- Modify: `src/core/utils/ffmpeg-commands.ts`（在檔尾新增 `escapeDrawtext` 與 `buildCoverImageCommand`）
- Test: `src/tests/unit/CoverImageCommand.test.ts`

**Interfaces:**
- Produces:
  - `escapeDrawtext(value: string): string`
  - `buildCoverImageCommand(opts: { title: string; partLabel: string; outPath: string; font: string; width?: number; height?: number; bg?: string }): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/unit/CoverImageCommand.test.ts
import { test, expect } from 'bun:test'
import { buildCoverImageCommand, escapeDrawtext } from '../../core/utils/ffmpeg-commands'

test('escapeDrawtext escapes drawtext special chars', () => {
  expect(escapeDrawtext('A:B\\C%D')).toBe('A\\:B\\\\C\\%D')
})

test('buildCoverImageCommand produces lavfi color + two drawtext + single frame', () => {
  const cmd = buildCoverImageCommand({
    title: '我就守個島',
    partLabel: 'part1',
    outPath: '/out/cover.jpg',
    font: '/System/Library/Fonts/PingFang.ttc',
  })
  const joined = cmd.join(' ')
  // 預設解析度
  expect(joined).toContain('color=c=#1a1a2e:s=1920x1080')
  // 兩段 drawtext，含字型與文字
  expect(joined).toContain('fontfile=/System/Library/Fonts/PingFang.ttc')
  expect(joined).toContain('text=我就守個島')
  expect(joined).toContain('text=part1')
  // 單張輸出 + 輸出路徑在最後
  expect(cmd).toContain('-frames:v')
  expect(cmd[cmd.length - 1]).toBe('/out/cover.jpg')
  // 必須是陣列、首位為 -y
  expect(cmd[0]).toBe('-y')
})

test('buildCoverImageCommand escapes colon in title', () => {
  const cmd = buildCoverImageCommand({
    title: '番外:終章',
    partLabel: 'part2',
    outPath: '/out/c.jpg',
    font: '/f.ttc',
  })
  expect(cmd.join(' ')).toContain('text=番外\\:終章')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/unit/CoverImageCommand.test.ts`
Expected: FAIL（`buildCoverImageCommand` / `escapeDrawtext` is not exported / not a function）

- [ ] **Step 3: Write minimal implementation**

在 `src/core/utils/ffmpeg-commands.ts` 檔尾新增：

```ts
/**
 * 跳脫 drawtext filter 的特殊字元（: \ % 反斜線），避免破壞 filter 語法。
 * 注意：drawtext 在 filter 字串內以 ':' 分隔選項，故文字內的 ':' 必須跳脫。
 */
export function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
}

/**
 * 建構靜態封面 ffmpeg 參數陣列：純色底 + 書名（大字）+ partN（小字），輸出單張 jpg。
 */
export function buildCoverImageCommand(opts: {
  title: string
  partLabel: string
  outPath: string
  font: string
  width?: number
  height?: number
  bg?: string
}): string[] {
  const width = opts.width ?? 1920
  const height = opts.height ?? 1080
  const bg = opts.bg ?? '#1a1a2e'
  const titleSize = Math.round(height / 12)
  const partSize = Math.round(height / 24)
  const escTitle = escapeDrawtext(opts.title)
  const escPart = escapeDrawtext(opts.partLabel)
  const font = opts.font

  const titleDraw =
    `drawtext=fontfile=${font}:text=${escTitle}:fontcolor=white:fontsize=${titleSize}` +
    `:x=(w-text_w)/2:y=(h/2)-${titleSize}`
  const partDraw =
    `drawtext=fontfile=${font}:text=${escPart}:fontcolor=#b0b0c0:fontsize=${partSize}` +
    `:x=(w-text_w)/2:y=(h/2)+${Math.round(titleSize / 2)}`

  return [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${bg}:s=${width}x${height}`,
    '-vf', `${titleDraw},${partDraw}`,
    '-frames:v', '1',
    opts.outPath,
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/unit/CoverImageCommand.test.ts`
Expected: PASS（3 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/ffmpeg-commands.ts src/tests/unit/CoverImageCommand.test.ts
git commit -m "feat: [core] 新增封面圖 ffmpeg 參數 builder"
```

---

### Task 2: CoverGenerator 服務

**Files:**
- Create: `src/core/services/CoverGenerator.ts`
- Test: `src/tests/unit/CoverGenerator.test.ts`

**Interfaces:**
- Consumes: `buildCoverImageCommand`（Task 1）
- Produces:
  - `class CoverGenerator { generateCover(opts: CoverOptions): Promise<string> }`
  - `interface CoverOptions { title: string; partLabel: string; outPath: string; font: string }`
  - `generateCover` 回傳實際產生的封面路徑（`opts.outPath`）；字型檔不存在則 throw。

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/unit/CoverGenerator.test.ts
import { test, expect } from 'bun:test'
import { CoverGenerator } from '../../core/services/CoverGenerator'

test('generateCover throws when font file is missing', async () => {
  const gen = new CoverGenerator()
  await expect(
    gen.generateCover({
      title: 'X',
      partLabel: 'part1',
      outPath: '/tmp/none.jpg',
      font: '/no/such/font.ttc',
    })
  ).rejects.toThrow(/字型/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/unit/CoverGenerator.test.ts`
Expected: FAIL（Cannot find module `CoverGenerator`）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/services/CoverGenerator.ts
import { $ } from 'bun'
import { buildCoverImageCommand } from '../utils/ffmpeg-commands'
import { getLogger } from '../utils/logger'

const logger = getLogger('CoverGenerator')

export interface CoverOptions {
  title: string
  partLabel: string
  outPath: string
  font: string
}

/**
 * 以 ffmpeg 生成靜態封面 jpg（純色底 + 書名 + partN）。
 */
export class CoverGenerator {
  async generateCover(opts: CoverOptions): Promise<string> {
    const fontFile = Bun.file(opts.font)
    if (!(await fontFile.exists())) {
      throw new Error(`字型檔不存在: ${opts.font}（可用 --font= 指定其他字型）`)
    }

    const args = buildCoverImageCommand({
      title: opts.title,
      partLabel: opts.partLabel,
      outPath: opts.outPath,
      font: opts.font,
    })

    logger.info({ out: opts.outPath, part: opts.partLabel }, '生成封面')
    const result = await $`ffmpeg ${args}`.quiet().nothrow()
    if (result.exitCode !== 0) {
      throw new Error(`封面生成失敗 (ffmpeg exit ${result.exitCode}): ${result.stderr.toString().slice(-400)}`)
    }
    return opts.outPath
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/unit/CoverGenerator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/services/CoverGenerator.ts src/tests/unit/CoverGenerator.test.ts
git commit -m "feat: [core] 新增 CoverGenerator 封面生成服務"
```

---

### Task 3: orchestrator 純邏輯（參數解析 + 步驟 args + 失敗即停）

**Files:**
- Create: `src/core/services/ytPipeline.ts`（純邏輯，無 I/O，可單元測試）
- Test: `src/tests/unit/ytPipeline.test.ts`

**Interfaces:**
- Produces:
  - `interface YtPipelineOptions { url: string; target: string; bitrate: number; rate: string; volume: string; concurrency: string; font: string; resume: boolean; dryRun: boolean; title?: string }`
  - `parseYtPipelineArgs(argv: string[]): YtPipelineOptions`（缺 url 拋錯；數值/旗標有預設）
  - `buildCrawlStep(url: string): string[]` → `['start', url]`
  - `buildAudiobookStep(title: string, o: YtPipelineOptions): string[]`
  - `buildMergeStep(bookDir: string, mergedDir: string, target: string): string[]`
  - `type StepRunner = (args: string[]) => Promise<number>`
  - `runStepsUntilFailure(steps: { label: string; args: string[] }[], run: StepRunner): Promise<{ ok: boolean; failedLabel?: string }>`（任一步非 0 即停，回傳失敗 label）

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/unit/ytPipeline.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/unit/ytPipeline.test.ts`
Expected: FAIL（Cannot find module `ytPipeline`）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/services/ytPipeline.ts
export interface YtPipelineOptions {
  url: string
  target: string
  bitrate: number
  rate: string
  volume: string
  concurrency: string
  font: string
  resume: boolean
  dryRun: boolean
  title?: string
}

const DEFAULT_FONT = '/System/Library/Fonts/PingFang.ttc'

export function parseYtPipelineArgs(argv: string[]): YtPipelineOptions {
  const flags: Record<string, string | boolean> = {}
  let url = ''
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=')
      flags[k] = v ?? true
    } else if (!url) {
      url = arg
    }
  }
  if (!url) {
    throw new Error('缺少必要參數: <url>。用法: bun run yt-pipeline <url> [--target=6h ...]')
  }
  return {
    url,
    target: (flags.target as string) ?? '6h',
    bitrate: flags.bitrate ? parseInt(flags.bitrate as string, 10) : 256,
    rate: (flags.rate as string) ?? '+0%',
    volume: (flags.volume as string) ?? '+0%',
    concurrency: (flags.concurrency as string) ?? '3',
    font: (flags.font as string) ?? DEFAULT_FONT,
    resume: flags.resume === undefined ? true : flags.resume !== 'false',
    dryRun: flags['dry-run'] === true || flags['dry-run'] === 'true',
    title: flags.title as string | undefined,
  }
}

export function buildCrawlStep(url: string): string[] {
  return ['start', url]
}

export function buildAudiobookStep(title: string, o: YtPipelineOptions): string[] {
  return ['audiobook', title, 'all', o.rate, o.volume, o.concurrency, 'false']
}

export function buildMergeStep(bookDir: string, mergedDir: string, target: string): string[] {
  return ['merge-mp3', bookDir, '--mode=duration', `--target=${target}`, `--output=${mergedDir}`]
}

export type StepRunner = (args: string[]) => Promise<number>

export async function runStepsUntilFailure(
  steps: { label: string; args: string[] }[],
  run: StepRunner
): Promise<{ ok: boolean; failedLabel?: string }> {
  for (const step of steps) {
    const code = await run(step.args)
    if (code !== 0) {
      return { ok: false, failedLabel: step.label }
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/unit/ytPipeline.test.ts`
Expected: PASS（4 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/core/services/ytPipeline.ts src/tests/unit/ytPipeline.test.ts
git commit -m "feat: [core] 新增 yt-pipeline 純邏輯（參數/步驟/失敗即停）"
```

---

### Task 4: 新書目錄偵測 + 逐段 MP4 生成（純邏輯）

**Files:**
- Modify: `src/core/services/ytPipeline.ts`（新增 `pickNewBook` 與 `buildPartMp4Plan`）
- Test: `src/tests/unit/ytPipeline.test.ts`（追加）

**Interfaces:**
- Consumes: Task 3 的型別
- Produces:
  - `pickNewBook(before: string[], after: string[], titleOverride?: string): string`（回傳新書名；override 優先；否則取 after\before 唯一新項；無法判定則拋錯）
  - `interface PartMp4Plan { mp3Path: string; coverPath: string; mp4Path: string; partLabel: string }`
  - `buildPartMp4Plans(mergedMp3Files: string[], coversDir: string, mp4Dir: string): PartMp4Plan[]`（依排序產生 part1..N 的計畫；`mp4Path` 由 mp3 檔名換副檔名 `.mp4`）

- [ ] **Step 1: Write the failing test**

```ts
// 追加到 src/tests/unit/ytPipeline.test.ts
import { pickNewBook, buildPartMp4Plans } from '../../core/services/ytPipeline'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/unit/ytPipeline.test.ts`
Expected: FAIL（`pickNewBook` / `buildPartMp4Plans` is not exported）

- [ ] **Step 3: Write minimal implementation**

在 `src/core/services/ytPipeline.ts` 追加：

```ts
export function pickNewBook(before: string[], after: string[], titleOverride?: string): string {
  if (titleOverride) return titleOverride
  const beforeSet = new Set(before)
  const created = after.filter((b) => !beforeSet.has(b))
  if (created.length === 1) return created[0]!
  throw new Error(
    created.length === 0
      ? '爬取後找不到新書目錄，無法判定書名。請用 --title=<書名> 指定（重跑時常見）。'
      : `爬取後出現多個新目錄（${created.join(', ')}），請用 --title=<書名> 指定。`
  )
}

export interface PartMp4Plan {
  mp3Path: string
  coverPath: string
  mp4Path: string
  partLabel: string
}

export function buildPartMp4Plans(
  mergedMp3Files: string[],
  coversDir: string,
  mp4Dir: string
): PartMp4Plan[] {
  const sorted = [...mergedMp3Files].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )
  return sorted.map((mp3Path, i) => {
    const partLabel = `part${i + 1}`
    const base = mp3Path.split('/').pop()!.replace(/\.mp3$/i, '')
    return {
      mp3Path,
      coverPath: `${coversDir}/${partLabel}.jpg`,
      mp4Path: `${mp4Dir}/${base}.mp4`,
      partLabel,
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/unit/ytPipeline.test.ts`
Expected: PASS（全部，含先前 4 個）

- [ ] **Step 5: Commit**

```bash
git add src/core/services/ytPipeline.ts src/tests/unit/ytPipeline.test.ts
git commit -m "feat: [core] yt-pipeline 新增新書偵測與逐段 MP4 計畫"
```

---

### Task 5: CLI orchestrator 腳本 + package.json + 文件

**Files:**
- Create: `scripts/yt_pipeline.ts`
- Modify: `package.json`（scripts 區塊新增 `yt-pipeline`）
- Modify: `README.md`（新增 yt-pipeline 段落）
- Modify: `AGENTS.md`（在架構/腳本說明補一行）

**Interfaces:**
- Consumes: Task 1–4 的所有匯出、既有 `buildMP4WithImageCommand`、`scanAllBooks`（`src/tui/books.ts`）、`CoverGenerator`

- [ ] **Step 1: 撰寫 CLI orchestrator**

```ts
// scripts/yt_pipeline.ts
#!/usr/bin/env bun
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { $ } from 'bun'
import {
  parseYtPipelineArgs,
  buildCrawlStep,
  buildAudiobookStep,
  buildMergeStep,
  runStepsUntilFailure,
  pickNewBook,
  buildPartMp4Plans,
} from '../src/core/services/ytPipeline'
import { CoverGenerator } from '../src/core/services/CoverGenerator'
import { buildMP4WithImageCommand } from '../src/core/utils/ffmpeg-commands'

const HELP = `用法: bun run yt-pipeline <url> [選項]

選項:
  --target=<6h>        時長分段上限（秒/11h/660m）
  --bitrate=<256>      AAC 位元率 kbps
  --rate=<+0%>         TTS 語速
  --volume=<+0%>       TTS 音量
  --concurrency=<3>    TTS 併發
  --font=<path>        封面字型（預設 PingFang）
  --title=<書名>       指定書名（重跑接續時用）
  --resume             已存在產物跳過（預設開）
  --dry-run            只印計畫，不執行
  -h, --help           顯示說明`

const OUTPUT_ROOT = path.join(import.meta.dir, '..', 'output')

async function listBookDirs(): Promise<string[]> {
  try {
    const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function runScript(args: string[]): Promise<number> {
  const proc = Bun.spawn(['bun', 'run', ...args], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return await proc.exited
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(HELP)
    process.exit(argv.length === 0 ? 1 : 0)
  }

  const o = parseYtPipelineArgs(argv)

  if (o.dryRun) {
    console.log('[Dry-run] 將執行:')
    console.log('  ①', buildCrawlStep(o.url).join(' '))
    console.log('  ② audiobook <書名> all', o.rate, o.volume, o.concurrency, 'false')
    console.log('  ③ merge-mp3 output/<書名> --mode=duration --target=' + o.target)
    console.log('  ④ 逐段生成封面 + ffmpeg 出 mp4（bitrate ' + o.bitrate + '）')
    process.exit(0)
  }

  // ① 爬取（記錄前後書目錄差異以判定書名）
  const before = await listBookDirs()
  console.log('\n========== ① 爬取 ==========\n')
  let code = await runScript(buildCrawlStep(o.url))
  if (code !== 0) return failAt('① 爬取', code)

  const after = await listBookDirs()
  let title: string
  try {
    title = pickNewBook(before, after, o.title)
  } catch (e) {
    console.error('\n❌ ' + (e instanceof Error ? e.message : String(e)))
    process.exit(1)
  }
  console.log(`\n📖 書名: ${title}`)

  const bookDir = path.join('output', title)
  const mergedDir = path.join('output', title, 'merged')
  const mp4Dir = path.join(OUTPUT_ROOT, title, 'mp4')
  const coversDir = path.join(mp4Dir, '.covers')

  // ② TTS、③ 時長合併（複用既有腳本，失敗即停）
  const steps = [
    { label: '② TTS', args: buildAudiobookStep(title, o) },
    { label: '③ 時長合併', args: buildMergeStep(bookDir, mergedDir, o.target) },
  ]
  for (const step of steps) {
    console.log(`\n========== ${step.label} ==========\n`)
    code = await runScript(step.args)
    if (code !== 0) return failAt(step.label, code)
  }

  // ④ 逐段封面 + MP4
  console.log('\n========== ④ 封面 + MP4 ==========\n')
  await mkdir(coversDir, { recursive: true })
  await ensureFfmpeg()

  const mergedAbs = path.join(OUTPUT_ROOT, title, 'merged')
  const mergedFiles = (await readdir(mergedAbs))
    .filter((f) => f.toLowerCase().endsWith('.mp3'))
    .map((f) => path.join(mergedAbs, f))
  if (mergedFiles.length === 0) {
    console.error(`\n❌ ${mergedAbs} 內沒有合併後的 mp3，Pipeline 中止。`)
    process.exit(1)
  }

  const plans = buildPartMp4Plans(mergedFiles, coversDir, mp4Dir)
  const cover = new CoverGenerator()
  let failures = 0
  for (const plan of plans) {
    if (o.resume && (await Bun.file(plan.mp4Path).exists())) {
      console.log(`⏩ 跳過已存在: ${path.basename(plan.mp4Path)}`)
      continue
    }
    try {
      await cover.generateCover({
        title,
        partLabel: plan.partLabel,
        outPath: plan.coverPath,
        font: o.font,
      })
      const args = buildMP4WithImageCommand(
        plan.coverPath,
        plan.mp3Path,
        plan.mp4Path,
        o.bitrate,
        1920,
        1080,
        { title: `${title} ${plan.partLabel}`, album: title }
      )
      console.log(`🎬 ${plan.partLabel} → ${path.basename(plan.mp4Path)}`)
      const res = await $`ffmpeg ${args}`.nothrow()
      if (res.exitCode !== 0) {
        failures++
        console.error(`❌ ${plan.partLabel} ffmpeg exit ${res.exitCode}`)
      } else {
        console.log(`✅ ${path.basename(plan.mp4Path)}`)
      }
    } catch (e) {
      failures++
      console.error(`❌ ${plan.partLabel}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (failures > 0) {
    console.error(`\n❌ ④ 有 ${failures} 段失敗。修正後重跑同指令即可接續。`)
    process.exit(1)
  }
  console.log(`\n✅ Pipeline 全部完成！MP4 位於 output/${title}/mp4/\n`)
}

function failAt(label: string, code: number): never {
  console.error(`\n❌ Pipeline 停在「${label}」(exit ${code})。`)
  console.error('修正後重跑同指令（加 --title=<書名> 可從爬取後接續）。')
  process.exit(1)
}

async function ensureFfmpeg(): Promise<void> {
  try {
    await $`ffmpeg -version`.quiet()
  } catch {
    console.error('❌ 找不到 ffmpeg，請先安裝（brew install ffmpeg）。')
    process.exit(1)
  }
}

main()
```

- [ ] **Step 2: 在 package.json scripts 區塊新增 yt-pipeline**

於 `"to-youtube": ...` 之後新增一行：

```json
    "yt-pipeline": "bun run scripts/yt_pipeline.ts",
```

- [ ] **Step 3: 驗證 help 與 dry-run**

Run:
```bash
bun run yt-pipeline --help
bun run yt-pipeline "https://twp.zhys.tw/book/777167.html" --dry-run
```
Expected：第一條印出用法 exit 0；第二條印出 ①②③④ 計畫 exit 0（不爬取、不跑 ffmpeg）。

- [ ] **Step 4: 跑全測試套件確認無回歸**

Run: `bun test`
Expected: PASS（含本計畫新增的 CoverImageCommand / CoverGenerator / ytPipeline 測試）

- [ ] **Step 5: 更新 README.md 與 AGENTS.md**

於 `README.md` 新增段落（放在既有 to-youtube / 轉檔說明附近）：

```markdown
### 一鍵端到端：yt-pipeline

從小說網址一路產出可上傳 YouTube 的 MP4（爬文 → TTS → 時長合併 → 自動封面 + MP4）：

\`\`\`bash
bun run yt-pipeline "https://twp.zhys.tw/book/777167.html"
# 可調：--target=6h --bitrate=256 --rate=+0% --concurrency=3 --font=<字型> --title=<書名>
# --dry-run 只印計畫；--resume（預設開）已存在產物自動跳過，可重跑接續
\`\`\`

產物落點：`output/<書名>/mp4/*.mp4`（封面為純色底 + 書名 + partN）。
```

於 `AGENTS.md` 的腳本/架構說明補一行：

```markdown
- **YT Pipeline (`scripts/yt_pipeline.ts`)**: 一鍵串接 爬取→TTS→時長合併→封面+MP4，產出 YouTube-ready mp4。CLI: `bun run yt-pipeline <url>`。
```

- [ ] **Step 6: Commit**

```bash
git add scripts/yt_pipeline.ts package.json README.md AGENTS.md
git commit -m "feat: [core] 新增 yt-pipeline 一鍵端到端 CLI（爬文→mp3→合併→YouTube MP4）"
```

---

## Self-Review

**Spec coverage:**
- 進入點 `bun run yt-pipeline <url>` → Task 5。
- ①②③ 複用既有 scripts → Task 3（step builders）+ Task 5（runScript 子程序）。
- ④ 自動封面（書名+partN）→ Task 1（builder）+ Task 2（service）+ Task 4（計畫）+ Task 5（整合）。
- 失敗即停 → Task 3 `runStepsUntilFailure` + Task 5 `failAt`。
- 重跑接續 → Task 5 `--resume` 跳過 + `--title` 接續；①②③ 既有腳本本身增量。
- dry-run → Task 3 解析 + Task 5 分支。
- 可調參數 target/bitrate/rate/volume/concurrency/font → Task 3 解析、Task 5 套用。
- 缺 ffmpeg / 缺字型 / 找不到新書 / merged 空 → Task 2 + Task 5 錯誤處理。
- 測試 → 每個 Task 的 bun:test。
- package.json script、README、AGENTS → Task 5。

**Placeholder scan:** 無 TBD/TODO；每個 code step 均含完整程式。

**Type consistency:** `YtPipelineOptions` 欄位於 Task 3 定義、Task 4/5 一致使用；`buildMP4WithImageCommand(imagePath, audioPath, outputPath, bitrate, width, height, metadata)` 簽名與既有 `src/core/utils/ffmpeg-commands.ts` 一致；`PartMp4Plan` 欄位 Task 4 定義、Task 5 取用一致。
