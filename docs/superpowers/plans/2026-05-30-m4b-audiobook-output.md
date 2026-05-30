# M4B 有聲書輸出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 從 `output/<書>/audio/` 的逐章 MP3 直接產生含逐章標記、按時長分卷的 M4B 有聲書，並新增 TUI 動作與 CLI、設為 pipeline 預設。

**Architecture:** 純函式（章節標題解析 + FFMETADATA 產生）→ ffmpeg 參數陣列建構子 → `M4BBuilderService`（沿用 `DurationService` 讀時長、`AudioMergeService.groupByDuration` 分卷、`RetryService` 重試、可注入 shell executor）→ CLI script → TUI 動作 / pipeline 整合。不動既有 merge/convert/MP4。

**Tech Stack:** Bun + TypeScript、ffmpeg（concat demuxer + FFMETADATA）、music-metadata、bun:test。

---

## 檔案結構

| 動作 | 路徑 | 責任 |
|------|------|------|
| Create | `src/core/utils/m4b-metadata.ts` | `parseChapterTitle`、`buildFFMetadata`（純函式） |
| Modify | `src/core/utils/ffmpeg-commands.ts` | 新增 `buildM4BCommand` |
| Create | `src/core/services/M4BBuilderService.ts` | 列章節 → 分卷 → 逐卷產 M4B；型別亦定義於此 |
| Create | `scripts/build_m4b.ts` | CLI 入口 + 中文報告 |
| Modify | `package.json` | 新增 `build-m4b` script |
| Modify | `src/tui/paths.ts` | 新增 `m4bDir` |
| Modify | `src/tui/runner.ts` | 新增 `buildM4bArgs` |
| Create | `src/tui/actions/m4b.ts` | TUI 互動動作 |
| Modify | `src/tui/index.ts` | 主選單加「🎧 生成 M4B 有聲書」 |
| Modify | `src/tui/actions/pipeline.ts` | merge+convert 兩步換成單一 M4B 步 |
| Modify | `src/tui/books.ts` | `BookStatus` 加 `m4b` 欄位 |
| Modify | `src/tui/status.ts` | 總覽/展開顯示 M4B 卷數 |
| Create | `tests/m4bMetadata.test.ts` | Task 1 測試 |
| Create | `tests/ffmpegCommands.test.ts` | Task 2 測試 |
| Create | `tests/m4bBuilderService.test.ts` | Task 3–4 測試 |
| Modify | `tests/tui/runner.test.ts` | `buildM4bArgs` 測試 |
| Modify | `tests/tui/books.test.ts` | `m4b` 欄位測試 |

---

## Task 1: 章節標題解析與 FFMETADATA 產生（純函式）

**Files:**
- Create: `src/core/utils/m4b-metadata.ts`
- Test: `tests/m4bMetadata.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/m4bMetadata.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { parseChapterTitle, buildFFMetadata } from '../src/core/utils/m4b-metadata'

describe('parseChapterTitle', () => {
  test('strips NNNN - prefix and extension', () => {
    expect(parseChapterTitle('0001 - 第一章林四九.mp3')).toBe('第一章林四九')
  })
  test('falls back to filename without extension when no prefix', () => {
    expect(parseChapterTitle('前言.mp3')).toBe('前言')
  })
  test('handles 5-digit index', () => {
    expect(parseChapterTitle('10234 - 終章.mp3')).toBe('終章')
  })
})

describe('buildFFMetadata', () => {
  test('emits header and chapter blocks with cumulative timebase 1/1000', () => {
    const out = buildFFMetadata(
      [
        { title: '第一章', durationSec: 1.5 },
        { title: '第二章', durationSec: 2 },
      ],
      { album: '某書', artist: 'KinetiText TTS', title: '某書 第1卷' },
    )
    expect(out.startsWith(';FFMETADATA1\n')).toBe(true)
    expect(out).toContain('album=某書')
    expect(out).toContain('artist=KinetiText TTS')
    expect(out).toContain('title=某書 第1卷')
    expect(out).toContain('[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=第一章')
    expect(out).toContain('[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=3500\ntitle=第二章')
  })
  test('escapes special characters = ; # and backslash', () => {
    const out = buildFFMetadata([{ title: 'a=b;c#d\\e', durationSec: 1 }], { album: 'x' })
    expect(out).toContain('title=a\\=b\\;c\\#d\\\\e')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test tests/m4bMetadata.test.ts`
Expected: FAIL（找不到模組 `../src/core/utils/m4b-metadata`）

- [ ] **Step 3: 寫最小實作**

建立 `src/core/utils/m4b-metadata.ts`：

```ts
/**
 * M4B 有聲書 metadata 純函式
 * 章節標題解析 + FFMETADATA 文字產生（供 ffmpeg -i ffmetadata 使用）
 */

/** 單一章節輸入：標題與時長（秒） */
export interface M4BChapterInput {
  readonly title: string
  readonly durationSec: number
}

/** 卷層級書籍資訊 */
export interface M4BBookInfo {
  /** 專輯＝書名 */
  readonly album: string
  /** 作者 */
  readonly artist?: string
  /** 卷層級標題，如「某書 第1卷」 */
  readonly title?: string
}

/**
 * 由音檔檔名取出章節標題
 * 去除 "NNNN - " 前綴與副檔名；無前綴時回傳去副檔名的檔名
 */
export function parseChapterTitle(filename: string): string {
  const noExt = filename.replace(/\.[^.]+$/, '')
  const stripped = noExt.replace(/^\d{1,5} - /, '')
  return stripped
}

/** FFMETADATA 規格：= ; # \ 與換行需以反斜線跳脫 */
function escapeFFMeta(value: string): string {
  return value.replace(/([=;#\\\n])/g, '\\$1')
}

/**
 * 產生 FFMETADATA1 文字：檔頭（album/artist/title）+ 每章 [CHAPTER] 區塊
 * 章節起訖由各章時長累計，TIMEBASE=1/1000（毫秒）
 */
export function buildFFMetadata(
  chapters: ReadonlyArray<M4BChapterInput>,
  book: M4BBookInfo,
): string {
  const lines: string[] = [';FFMETADATA1']
  lines.push(`album=${escapeFFMeta(book.album)}`)
  if (book.artist) lines.push(`artist=${escapeFFMeta(book.artist)}`)
  if (book.title) lines.push(`title=${escapeFFMeta(book.title)}`)

  let cursorMs = 0
  for (const ch of chapters) {
    const startMs = cursorMs
    const endMs = cursorMs + Math.round(ch.durationSec * 1000)
    lines.push('[CHAPTER]')
    lines.push('TIMEBASE=1/1000')
    lines.push(`START=${startMs}`)
    lines.push(`END=${endMs}`)
    lines.push(`title=${escapeFFMeta(ch.title)}`)
    cursorMs = endMs
  }

  return lines.join('\n') + '\n'
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test tests/m4bMetadata.test.ts`
Expected: PASS（5 個 test）

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/m4b-metadata.ts tests/m4bMetadata.test.ts
git commit -m "feat: [m4b] 章節標題解析與 FFMETADATA 產生純函式"
```

---

## Task 2: `buildM4BCommand` ffmpeg 參數建構子

**Files:**
- Modify: `src/core/utils/ffmpeg-commands.ts`（檔尾新增 export 函式）
- Test: `tests/ffmpegCommands.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/ffmpegCommands.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { buildM4BCommand } from '../src/core/utils/ffmpeg-commands'

describe('buildM4BCommand', () => {
  test('builds concat + ffmetadata args without cover', () => {
    const args = buildM4BCommand('/tmp/list.txt', '/tmp/meta.txt', '/out/vol01.m4b', 256)
    expect(args).toEqual([
      '-y',
      '-f', 'concat', '-safe', '0', '-i', '/tmp/list.txt',
      '-i', '/tmp/meta.txt',
      '-map_metadata', '1',
      '-map', '0:a',
      '-c:a', 'aac', '-b:a', '256k',
      '-movflags', '+faststart',
      '/out/vol01.m4b',
    ])
  })

  test('adds cover as attached_pic when coverPath given', () => {
    const args = buildM4BCommand('/tmp/list.txt', '/tmp/meta.txt', '/out/vol01.m4b', 192, '/c/cover.jpg')
    expect(args).toEqual([
      '-y',
      '-f', 'concat', '-safe', '0', '-i', '/tmp/list.txt',
      '-i', '/tmp/meta.txt',
      '-i', '/c/cover.jpg',
      '-map_metadata', '1',
      '-map', '0:a',
      '-map', '2:v', '-disposition:v:0', 'attached_pic', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '/out/vol01.m4b',
    ])
  })

  test('throws on out-of-range bitrate', () => {
    expect(() => buildM4BCommand('/l', '/m', '/o.m4b', 64)).toThrow(/Invalid bitrate/)
    expect(() => buildM4BCommand('/l', '/m', '/o.m4b', 400)).toThrow(/Invalid bitrate/)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test tests/ffmpegCommands.test.ts`
Expected: FAIL（`buildM4BCommand` 未匯出）

- [ ] **Step 3: 寫最小實作**

於 `src/core/utils/ffmpeg-commands.ts` 檔尾新增：

```ts
/**
 * 建構 M4B 有聲書 ffmpeg 參數陣列
 * concat demuxer 串接各章音檔 + 嵌入 FFMETADATA（章節）+ 選配封面，重編碼 AAC
 *
 * @param concatListPath ffmpeg concat list 檔路徑（內含 file '...' 各行）
 * @param ffmetadataPath FFMETADATA 檔路徑
 * @param outputPath 輸出 .m4b 路徑
 * @param bitrate AAC 位元率 kbps（96–320）
 * @param coverPath 選配封面圖路徑（jpg/png）
 * @returns ffmpeg 參數字串陣列（非 shell 字串）
 */
export function buildM4BCommand(
  concatListPath: string,
  ffmetadataPath: string,
  outputPath: string,
  bitrate: number,
  coverPath?: string,
): string[] {
  if (bitrate < 96 || bitrate > 320) {
    throw new Error(`Invalid bitrate: ${bitrate} kbps (must be 96-320)`)
  }

  const args: string[] = [
    '-y',
    '-f', 'concat', '-safe', '0', '-i', concatListPath,
    '-i', ffmetadataPath,
  ]

  if (coverPath) {
    args.push('-i', coverPath)
  }

  args.push('-map_metadata', '1', '-map', '0:a')

  if (coverPath) {
    args.push('-map', '2:v', '-disposition:v:0', 'attached_pic', '-c:v', 'copy')
  }

  args.push('-c:a', 'aac', '-b:a', `${bitrate}k`, '-movflags', '+faststart', outputPath)

  return args
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test tests/ffmpegCommands.test.ts`
Expected: PASS（3 個 test）

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/ffmpeg-commands.ts tests/ffmpegCommands.test.ts
git commit -m "feat: [m4b] 新增 buildM4BCommand ffmpeg 參數建構子"
```

---

## Task 3: `M4BBuilderService` — 列章節

**Files:**
- Create: `src/core/services/M4BBuilderService.ts`
- Test: `tests/m4bBuilderService.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/m4bBuilderService.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test tests/m4bBuilderService.test.ts`
Expected: FAIL（找不到 `M4BBuilderService`）

- [ ] **Step 3: 寫最小實作**

建立 `src/core/services/M4BBuilderService.ts`：

```ts
/**
 * M4B 有聲書建構服務
 * 列章節 → 依時長分卷 → 逐卷 concat + 嵌章節 → ffmpeg 重編碼 AAC
 */

import { $ } from 'bun'
import path from 'node:path'
import { readdir, writeFile, unlink, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { DurationService } from './DurationService'
import { AudioMergeService } from './AudioMergeService'
import { RetryService } from './RetryService'
import { AudioErrorClassifier } from './AudioErrorClassifier'
import { buildM4BCommand } from '../utils/ffmpeg-commands'
import { buildFFMetadata, parseChapterTitle, type M4BChapterInput } from '../utils/m4b-metadata'
import { createLogger } from '../utils/logger'

/** 單一章節（已排序） */
export interface M4BChapter {
  readonly path: string
  readonly index: number
  readonly title: string
}

/** 注入式 shell executor（測試可攔截，不跑真 ffmpeg） */
export type M4BShellExecutor = (args: string[]) => Promise<void>

/** build() 選項 */
export interface M4BBuildOptions {
  readonly audioDir: string
  readonly outputDir: string
  readonly bookTitle: string
  readonly targetSeconds?: number
  readonly bitrate?: number
  readonly artist?: string
  readonly coverPath?: string
  readonly dryRun?: boolean
}

/** 單卷結果 */
export interface M4BVolumeResult {
  readonly volumeIndex: number
  readonly outputPath: string
  readonly chapterCount: number
  readonly estimatedDuration: number
  readonly error?: string
}

/** 整體報告 */
export interface M4BBuildReport {
  readonly bookTitle: string
  readonly audioDir: string
  readonly outputDir: string
  readonly totalChapters: number
  readonly totalVolumes: number
  readonly successCount: number
  readonly failureCount: number
  readonly volumes: ReadonlyArray<M4BVolumeResult>
  readonly dryRun: boolean
  readonly errors: ReadonlyArray<string>
}

export interface M4BBuilderServiceDeps {
  durationService?: DurationService
  mergeService?: AudioMergeService
  retryService?: RetryService
  shellExecutor?: M4BShellExecutor
}

const defaultShellExecutor: M4BShellExecutor = async (args) => {
  const result = await $`ffmpeg ${args}`.quiet()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().slice(0, 200)
    throw new Error(`FFmpeg M4B failed (exit ${result.exitCode}): ${stderr}`)
  }
}

export class M4BBuilderService {
  private readonly durationService: DurationService
  private readonly mergeService: AudioMergeService
  private readonly retryService: RetryService
  private readonly shellExecutor: M4BShellExecutor
  private readonly logger = createLogger('m4b-builder')

  constructor(deps: M4BBuilderServiceDeps = {}) {
    this.durationService = deps.durationService ?? new DurationService()
    this.mergeService = deps.mergeService ?? new AudioMergeService()
    this.retryService = deps.retryService ?? new RetryService(undefined, new AudioErrorClassifier())
    this.shellExecutor = deps.shellExecutor ?? defaultShellExecutor
  }

  /** 列出 audioDir 內的 .mp3 章節，依章節號排序 */
  async listChapters(audioDir: string): Promise<M4BChapter[]> {
    let entries: string[]
    try {
      entries = await readdir(audioDir)
    } catch {
      return []
    }
    const chapters: M4BChapter[] = []
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.mp3')) continue
      const m = name.match(/^(\d{1,5}) - /)
      const index = m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
      chapters.push({ path: path.join(audioDir, name), index, title: parseChapterTitle(name) })
    }
    return chapters.sort((a, b) => a.index - b.index)
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test tests/m4bBuilderService.test.ts`
Expected: PASS（2 個 test）

- [ ] **Step 5: Commit**

```bash
git add src/core/services/M4BBuilderService.ts tests/m4bBuilderService.test.ts
git commit -m "feat: [m4b] M4BBuilderService 列章節"
```

---

## Task 4: `M4BBuilderService.build` — 分卷 + 逐卷產 M4B

**Files:**
- Modify: `src/core/services/M4BBuilderService.ts`（加 private `buildConcatList`、private `buildVolume`、public `build`）
- Test: `tests/m4bBuilderService.test.ts`（新增測試）

- [ ] **Step 1: 寫失敗測試**

於 `tests/m4bBuilderService.test.ts` 檔尾新增：

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test tests/m4bBuilderService.test.ts`
Expected: FAIL（`build` 未定義）

- [ ] **Step 3: 寫最小實作**

於 `M4BBuilderService` class 內（`listChapters` 之後）新增方法：

```ts
  /** 產生 ffmpeg concat list 內容（單引號跳脫，絕對路徑） */
  private buildConcatList(filePaths: ReadonlyArray<string>): string {
    return filePaths
      .map((fp) => `file '${path.resolve(fp).replace(/'/g, "'\\''")}'`)
      .join('\n')
  }

  /** 建單一卷：寫暫存 concat list + ffmetadata → 執行 ffmpeg → 驗證輸出 */
  private async buildVolume(
    chapters: ReadonlyArray<M4BChapter>,
    durations: ReadonlyMap<string, number>,
    outputPath: string,
    volumeTitle: string,
    book: { album: string; artist?: string },
    bitrate: number,
    coverPath?: string,
  ): Promise<void> {
    const safe = volumeTitle.replace(/[^\w]+/g, '_')
    const listPath = path.join(tmpdir(), `kineti_m4b_list_${process.pid}_${safe}.txt`)
    const metaPath = path.join(tmpdir(), `kineti_m4b_meta_${process.pid}_${safe}.txt`)
    try {
      const chapterInputs: M4BChapterInput[] = chapters.map((c) => ({
        title: c.title,
        durationSec: durations.get(c.path) ?? 0,
      }))
      await writeFile(listPath, this.buildConcatList(chapters.map((c) => c.path)), 'utf-8')
      await writeFile(
        metaPath,
        buildFFMetadata(chapterInputs, { album: book.album, artist: book.artist, title: volumeTitle }),
        'utf-8',
      )

      const args = buildM4BCommand(listPath, metaPath, outputPath, bitrate, coverPath)
      const r = await this.retryService.execute(
        () => this.shellExecutor(args),
        `m4b:${path.basename(outputPath)}`,
      )
      if (!r.success) throw r.error ?? new Error(`M4B build failed: ${outputPath}`)

      const info = await stat(outputPath)
      if (info.size === 0) throw new Error(`Output file is empty: ${outputPath}`)
    } finally {
      await unlink(listPath).catch(() => {})
      await unlink(metaPath).catch(() => {})
    }
  }

  /** 主流程：列章 → 讀時長 → 分卷 → 逐卷產 M4B → 報告 */
  async build(options: M4BBuildOptions): Promise<M4BBuildReport> {
    const targetSeconds = options.targetSeconds ?? 39600
    const bitrate = options.bitrate ?? 256
    const dryRun = options.dryRun ?? false
    const errors: string[] = []

    const chapters = await this.listChapters(options.audioDir)
    if (chapters.length === 0) {
      throw new Error(`audio/ 內找不到任何章節 mp3：${options.audioDir}`)
    }

    // 讀每章時長
    const durations = new Map<string, number>()
    for (const c of chapters) {
      durations.set(c.path, await this.durationService.getDuration(c.path))
    }

    // 分卷（沿用貪婪演算法）
    const groups = await this.mergeService.groupByDuration(
      chapters.map((c) => ({ path: c.path, duration: durations.get(c.path) ?? 0 })),
      targetSeconds,
    )

    // 將分卷結果對回 M4BChapter（依路徑）
    const byPath = new Map(chapters.map((c) => [c.path, c]))
    const volumeChapters = groups.map((g) => g.files.map((f) => byPath.get(f)!).filter(Boolean))

    if (dryRun) {
      const volumes: M4BVolumeResult[] = groups.map((g, i) => ({
        volumeIndex: i + 1,
        outputPath: path.join(options.outputDir, `${options.bookTitle}_vol${String(i + 1).padStart(2, '0')}.m4b`),
        chapterCount: g.files.length,
        estimatedDuration: g.estimatedDuration,
      }))
      return {
        bookTitle: options.bookTitle, audioDir: options.audioDir, outputDir: options.outputDir,
        totalChapters: chapters.length, totalVolumes: groups.length,
        successCount: 0, failureCount: 0, volumes, dryRun: true, errors: [],
      }
    }

    await mkdir(options.outputDir, { recursive: true })

    const volumes: M4BVolumeResult[] = []
    let successCount = 0
    let failureCount = 0
    for (let i = 0; i < volumeChapters.length; i++) {
      const chs = volumeChapters[i]
      const volNo = i + 1
      const outputPath = path.join(
        options.outputDir,
        `${options.bookTitle}_vol${String(volNo).padStart(2, '0')}.m4b`,
      )
      const volumeTitle = `${options.bookTitle} 第${volNo}卷`
      try {
        await this.buildVolume(
          chs, durations, outputPath, volumeTitle,
          { album: options.bookTitle, artist: options.artist ?? 'KinetiText TTS' },
          bitrate, options.coverPath,
        )
        volumes.push({ volumeIndex: volNo, outputPath, chapterCount: chs.length, estimatedDuration: groups[i].estimatedDuration })
        successCount++
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        this.logger.error({ volNo, error: msg }, '卷建構失敗')
        errors.push(`第${volNo}卷: ${msg}`)
        volumes.push({ volumeIndex: volNo, outputPath, chapterCount: chs.length, estimatedDuration: groups[i].estimatedDuration, error: msg })
        failureCount++
      }
    }

    return {
      bookTitle: options.bookTitle, audioDir: options.audioDir, outputDir: options.outputDir,
      totalChapters: chapters.length, totalVolumes: groups.length,
      successCount, failureCount, volumes, dryRun: false, errors,
    }
  }
```

註：檔頭已 import `RetryService`/`AudioErrorClassifier`，本步無需改 import。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test tests/m4bBuilderService.test.ts`
Expected: PASS（共 5 個 test：含 Task 3 的 2 個）

- [ ] **Step 5: Commit**

```bash
git add src/core/services/M4BBuilderService.ts tests/m4bBuilderService.test.ts
git commit -m "feat: [m4b] M4BBuilderService 分卷與逐卷 M4B 建構"
```

---

## Task 5: CLI script `scripts/build_m4b.ts` + package.json

**Files:**
- Create: `scripts/build_m4b.ts`
- Modify: `package.json`（`scripts` 區塊新增 `build-m4b`）

- [ ] **Step 1: 新增 package.json script**

於 `package.json` 的 `"scripts"` 區塊，在 `"to-mp4": "bun run scripts/mp3_to_mp4.ts",` 那行之後新增一行：

```json
    "build-m4b": "bun run scripts/build_m4b.ts",
```

- [ ] **Step 2: 建立 CLI**

建立 `scripts/build_m4b.ts`：

```ts
#!/usr/bin/env bun
/**
 * CLI：從 audio/ 逐章 MP3 產生分卷 M4B 有聲書
 */

import path from 'node:path'
import { stat } from 'node:fs/promises'
import { M4BBuilderService } from '../src/core/services/M4BBuilderService'
import type { M4BBuildReport } from '../src/core/services/M4BBuilderService'

interface CliArgs {
  title?: string
  input?: string
  output?: string
  target: number
  bitrate: number
  artist?: string
  dryRun: boolean
}

function parseArgs(): CliArgs {
  const raw = process.argv.slice(2)
  const parsed: Record<string, string | boolean> = {}
  for (const arg of raw) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.substring(2).split('=')
      parsed[k] = v ?? true
    }
  }
  return {
    title: parsed.title as string | undefined,
    input: parsed.input as string | undefined,
    output: parsed.output as string | undefined,
    target: parsed.target ? parseInt(parsed.target as string, 10) : 39600,
    bitrate: parsed.bitrate ? parseInt(parsed.bitrate as string, 10) : 256,
    artist: parsed.artist as string | undefined,
    dryRun: parsed['dry-run'] === true || parsed['dry-run'] === 'true',
  }
}

/** 若 output/<書>/cover.jpg|png 存在則回傳路徑 */
async function findCover(bookDir: string): Promise<string | undefined> {
  for (const name of ['cover.jpg', 'cover.png']) {
    const p = path.join(bookDir, name)
    try {
      await stat(p)
      return p
    } catch { /* 無此檔 */ }
  }
  return undefined
}

function formatReport(r: M4BBuildReport): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════',
    'M4B 有聲書建構報告',
    '═══════════════════════════════════════════════',
    `書名: ${r.bookTitle}`,
    `輸入: ${r.audioDir}`,
    `輸出: ${r.outputDir}`,
    `章節數: ${r.totalChapters}`,
    `卷數: ${r.totalVolumes}`,
    `成功: ${r.successCount}　失敗: ${r.failureCount}`,
    `乾運行: ${r.dryRun ? '是' : '否'}`,
    '',
  ]
  for (const v of r.volumes) {
    const status = v.error ? '❌' : (r.dryRun ? '•' : '✅')
    const dur = `${(v.estimatedDuration / 3600).toFixed(1)}h`
    const err = v.error ? ` — ${v.error}` : ''
    lines.push(`  ${status} 第${v.volumeIndex}卷　${v.chapterCount} 章　~${dur}　${path.basename(v.outputPath)}${err}`)
  }
  lines.push('')
  lines.push('═══════════════════════════════════════════════', '')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = parseArgs()
  let audioDir = args.input
  let outputDir = args.output
  let coverPath: string | undefined

  if (args.title) {
    const bookDir = path.join(process.cwd(), 'output', args.title)
    audioDir = audioDir ?? path.join(bookDir, 'audio')
    outputDir = outputDir ?? path.join(bookDir, 'm4b')
    coverPath = await findCover(bookDir)
  }

  if (!audioDir || !outputDir) {
    console.error('Usage: bun run build-m4b --title=<書名> [--target=秒] [--bitrate=kbps] [--artist=名] [--dry-run]')
    console.error('   或: bun run build-m4b --input=<audioDir> --output=<m4bDir> [...]')
    process.exit(1)
  }

  const svc = new M4BBuilderService()
  const bookTitle = args.title ?? path.basename(path.dirname(outputDir))
  try {
    const report = await svc.build({
      audioDir, outputDir, bookTitle,
      targetSeconds: args.target, bitrate: args.bitrate,
      artist: args.artist, coverPath, dryRun: args.dryRun,
    })
    console.log(formatReport(report))
    process.exit(report.failureCount > 0 ? 1 : 0)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`\n錯誤: ${msg}\n`)
    process.exit(1)
  }
}

main()
```

- [ ] **Step 3: 手動煙霧測試（dry-run，不需 ffmpeg）**

Run: `bun run build-m4b --title=<某有 audio 的書> --target=39600 --dry-run`
Expected: 印出「M4B 有聲書建構報告」，列出分卷與每卷章數、預估時長，乾運行=是；exit 0。
（若該書 audio/ 為空會印中文錯誤並 exit 1。）

- [ ] **Step 4: Commit**

```bash
git add scripts/build_m4b.ts package.json
git commit -m "feat: [m4b] 新增 build-m4b CLI 與 package script"
```

---

## Task 6: TUI 路徑與 runner 參數

**Files:**
- Modify: `src/tui/paths.ts`（新增 `m4bDir`）
- Modify: `src/tui/runner.ts`（新增 `buildM4bArgs`）
- Test: `tests/tui/runner.test.ts`（新增測試）

- [ ] **Step 1: 寫失敗測試**

於 `tests/tui/runner.test.ts`：確認頂部 import 含 `buildM4bArgs`（若既有 import 是具名匯入清單，補上 `buildM4bArgs`）；檔尾新增：

```ts
import { buildM4bArgs } from '../../src/tui/runner'

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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test tests/tui/runner.test.ts`
Expected: FAIL（`buildM4bArgs` 未匯出）

- [ ] **Step 3: 實作 m4bDir 與 buildM4bArgs**

於 `src/tui/paths.ts` 在 `m4aDir` 那行之後新增：

```ts
export const m4bDir = (title: string): string => path.join(bookDir(title), 'm4b')
```

於 `src/tui/runner.ts` 在 `buildConvertArgs` 函式之後新增：

```ts
export interface M4bInput {
  title: string
  target: string
  bitrate?: string
}

export function buildM4bArgs(i: M4bInput): string[] {
  const args = ['build-m4b', `--title=${i.title}`, `--target=${i.target}`]
  if (i.bitrate) args.push(`--bitrate=${i.bitrate}`)
  return args
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test tests/tui/runner.test.ts`
Expected: PASS（含原有 + 新增 2 個）

- [ ] **Step 5: Commit**

```bash
git add src/tui/paths.ts src/tui/runner.ts tests/tui/runner.test.ts
git commit -m "feat: [m4b] TUI m4bDir 與 buildM4bArgs"
```

---

## Task 7: TUI 動作 `m4b.ts` 與主選單

**Files:**
- Create: `src/tui/actions/m4b.ts`
- Modify: `src/tui/index.ts`（import + 選單項 + switch）

- [ ] **Step 1: 建立動作**

建立 `src/tui/actions/m4b.ts`：

```ts
import { select, text, isCancel, cancel } from '@clack/prompts'
import { scanAllBooks } from '../books'
import { buildM4bArgs, runScript } from '../runner'
import { OUTPUT_ROOT } from '../paths'

export async function m4bAction(presetTitle?: string): Promise<void> {
  let title = presetTitle
  if (!title) {
    const books = await scanAllBooks(OUTPUT_ROOT)
    if (books.length === 0) {
      console.log('\n（尚無書籍）\n')
      return
    }
    const picked = await select({
      message: '選擇要生成 M4B 的書籍',
      options: books.map((b) => ({ value: b.title, label: `${b.title}（TTS ${b.tts.done} 章）` })),
    })
    if (isCancel(picked)) return cancel('已取消')
    title = String(picked)
  }

  const bitrate = await text({ message: 'AAC bitrate（96–320）', initialValue: '256' })
  if (isCancel(bitrate)) return cancel('已取消')

  const hours = await text({ message: '每卷目標時長（小時）', initialValue: '11' })
  if (isCancel(hours)) return cancel('已取消')
  const target = String(Math.round(parseFloat(String(hours)) * 3600))

  const code = await runScript(buildM4bArgs({ title, target, bitrate: String(bitrate) }))
  if (code !== 0) console.error(`\n❌ M4B 生成失敗 (exit ${code})`)
}
```

- [ ] **Step 2: 接進主選單**

於 `src/tui/index.ts`：

import 區（其他 action import 之後）加：
```ts
import { m4bAction } from './actions/m4b'
```

選單 `options` 陣列，在 `{ value: 'convert', label: '🎬 轉檔 M4A' },` 之後加：
```ts
        { value: 'm4b', label: '🎧 生成 M4B 有聲書' },
```

`switch` 區，在 `case 'convert': await convertAction(); break` 之後加：
```ts
        case 'm4b': await m4bAction(); break
```

- [ ] **Step 3: 煙霧測試（手動，立即取消即可）**

Run: 啟動 `bun run menu`，確認主選單出現「🎧 生成 M4B 有聲書」，選它能列出書籍、可取消返回。
Expected: 選單顯示新項目且不報錯。

- [ ] **Step 4: Commit**

```bash
git add src/tui/actions/m4b.ts src/tui/index.ts
git commit -m "feat: [m4b] TUI 新增 生成 M4B 有聲書 動作"
```

---

## Task 8: pipeline 改用 M4B

**Files:**
- Modify: `src/tui/actions/pipeline.ts`（import、confirm 訊息、steps 陣列、移除未用變數）

- [ ] **Step 1: 改 import**

於 `src/tui/actions/pipeline.ts` 頂部，把 runner import 改為（移除 `buildMergeArgs, buildConvertArgs`，加 `buildM4bArgs`）：

```ts
import {
  buildCrawlArgs,
  buildAudiobookArgs,
  buildM4bArgs,
  buildBackupArgs,
  runScript,
} from '../runner'
import { OUTPUT_ROOT, bookDir } from '../paths'
```

（移除 `mergedDir, m4aDir, metadataJsonPath` 與 `import * as fs` —— 見 Step 3 一併處理未用項。）

- [ ] **Step 2: 改 confirm 與 steps**

把 confirm 訊息那行改為：
```ts
  const go = await confirm({ message: '將依序執行：爬取 → TTS(all) → 生成 M4B → 備份。開始？', initialValue: true })
```

把 `steps` 陣列改為：
```ts
  const steps: Step[] = [
    { label: '② TTS', args: buildAudiobookArgs({ title: t, selection: 'all', rate: '+0%', volume: '+0%', concurrency: '3', merge: false }) },
    { label: '③ 生成 M4B', args: buildM4bArgs({ title: t, target: '39600', bitrate: '256' }) },
    { label: '④ 備份', args: buildBackupArgs() },
  ]
```

- [ ] **Step 3: 移除未使用變數**

刪除 `picked` 之後、`steps` 之前那段建立 `metadata`（含 `try/await fs.access/catch`）的區塊——M4B 路徑不需要它。確認檔內不再引用 `fs`、`mergedDir`、`m4aDir`、`metadataJsonPath`、`bookDir`；若 `bookDir` 確實不再使用，連同 paths import 一併移除（保留 `OUTPUT_ROOT`，因 `scanAllBooks(OUTPUT_ROOT)` 仍用）。

- [ ] **Step 4: 驗證型別與既有測試**

Run: `bun test tests/tui/`
Expected: PASS（pipeline 無專屬單元測試；確認未破壞 runner/books/status 測試）

並手動確認無 TypeScript 未用匯入錯誤：`bun build src/tui/actions/pipeline.ts --target=bun > /dev/null && echo OK`
Expected: 印出 `OK`。

- [ ] **Step 5: Commit**

```bash
git add src/tui/actions/pipeline.ts
git commit -m "refactor: [m4b] pipeline 改用 M4B 取代 合併+轉檔"
```

---

## Task 9: 狀態檢視顯示 M4B 卷數

**Files:**
- Modify: `src/tui/books.ts`（`BookStatus` 加 `m4b`、`scanBook` 掃描、`computeOverall`）
- Modify: `src/tui/status.ts`（總覽/展開顯示）
- Test: `tests/tui/books.test.ts`（新增測試）

- [ ] **Step 1: 寫失敗測試**

於 `tests/tui/books.test.ts`：沿用該檔既有 import 與 temp dir 樣式（若缺 `fsp`/`os`/`path`/`scanBook` 則補齊 import），新增：

```ts
test('counts m4b volumes', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kineti-books-'))
  tempDirs.push(root)
  const m4b = path.join(root, '某書', 'm4b')
  await fsp.mkdir(m4b, { recursive: true })
  await fsp.writeFile(path.join(m4b, '某書_vol01.m4b'), 'x')
  await fsp.writeFile(path.join(m4b, '某書_vol02.m4b'), 'x')
  const status = await scanBook(root, '某書')
  expect(status.m4b.count).toBe(2)
})
```

註：若該測試檔的 temp 清理變數不叫 `tempDirs`，改用該檔既有的清理機制。

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test tests/tui/books.test.ts`
Expected: FAIL（`status.m4b` 為 undefined / 型別錯誤）

- [ ] **Step 3: 實作 m4b 欄位**

於 `src/tui/books.ts`：

`BookStatus` interface 在 `convert: { m4a: number; mp4: number }` 那行之後加：
```ts
  m4b: { count: number }
```

`scanBook` 內，在 `const mp4 = await countFiles(path.join(dir, 'mp4'), '.mp4')` 之後加：
```ts
  const m4bCount = await countFiles(path.join(dir, 'm4b'), '.m4b')
```

`partial` 物件在 `convert: { m4a, mp4 },` 之後加：
```ts
    m4b: { count: m4bCount },
```

`computeOverall` 把 `complete` 判定那行改為（加入 M4B、移除對 merged 的硬性要求，因 M4B 不經 merged/）：
```ts
  if ((b.convert.m4a > 0 || b.convert.mp4 > 0 || b.m4b.count > 0) && b.tts.total > 0 && b.tts.missing.length === 0) return 'complete'
```

- [ ] **Step 4: status 顯示**

於 `src/tui/status.ts`：

`renderOverview` 內把 `conv` 那兩行改為一併計入 M4B：
```ts
    const conv = b.convert.m4a + b.convert.mp4 + b.m4b.count > 0
      ? `${b.convert.m4a + b.convert.mp4 + b.m4b.count} ✓` : '—'
```

`renderExpanded` 內，在「轉檔」那行 `console.log(\`├ 轉檔 ...\`)` 之後加：
```ts
  console.log(`├ M4B     ${b.m4b.count} 卷`)
```

- [ ] **Step 5: 跑測試確認通過**

Run: `bun test tests/tui/books.test.ts`
Expected: PASS（含新增 m4b 測試）

- [ ] **Step 6: Commit**

```bash
git add src/tui/books.ts src/tui/status.ts tests/tui/books.test.ts
git commit -m "feat: [m4b] 狀態檢視顯示 M4B 卷數"
```

---

## Task 10: 全套驗證與文件

**Files:**
- Modify: `README.md`（指令表加一列；控制台說明加 M4B）

- [ ] **Step 1: 跑全測試**

Run: `bun test`
Expected: 全綠（含新增 m4bMetadata / ffmpegCommands / m4bBuilderService / runner / books 測試）

- [ ] **Step 2: 端到端煙霧測試（需 ffmpeg；挑一本有 audio/ 的書）**

Run: `bun run build-m4b --title=<某有 audio 的書> --target=39600 --bitrate=256`
Expected: `output/<書>/m4b/` 產出 `*_vol01.m4b …`；用 ffprobe 確認章節：
```bash
ffprobe -i "output/<書>/m4b/<書>_vol01.m4b" -show_chapters -v quiet -print_format json | head -40
```
應看到多個 chapter（tags.title 為各章標題）。

- [ ] **Step 3: 更新 README**

於 `README.md`「🔧 完整指令列表」表，在 `to-mp4` 那列之後加：
```markdown
| `bun run build-m4b --title=<書名>` | 生成 M4B 有聲書（含章節，按時長分卷） | Phase 4 |
```
於「🎛 互動式控制台（推薦）」清單加一行：
```markdown
- 🎧 生成 M4B 有聲書：逐章標記、按時長分卷，丟進 Apple Books / 手機有聲書 App 即可跳章、記憶進度
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: [m4b] README 補充 M4B 指令與控制台說明"
```

---

## 完成準則

- `bun test` 全綠。
- `bun run build-m4b --title=<書>` 產出分卷 `.m4b`，ffprobe 可見逐章 chapter。
- TUI 主選單有「🎧 生成 M4B 有聲書」，狀態檢視顯示卷數。
- pipeline 走 爬取 → TTS → M4B → 備份。
- 既有 merge/convert/MP4 程式碼與測試未被破壞。
