# Pipeline 旋鈕參數化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把爬取重試/併發/退避延遲開放成 CLI 旗標、把合併容差透出，並讓 `yt-pipeline` 爬完自動補抓失敗章節，使整條 pipeline 完全可腳本化。

**Architecture:** `CrawlerConfig` 新增 `maxRetries`/`retryBaseDelayMs` 兩欄並取代寫死值；`start` 與 `yt-pipeline` 各加爬取旗標（旗標解析抽成純函式好測），`yt-pipeline` 另加 `--tolerance` 透傳與爬後 `retry-failed` 補抓關卡。純疊加、未傳旗標時行為與現狀完全相同。

**Tech Stack:** Bun + TypeScript、bun:test。

## Global Constraints

- 執行環境僅 Bun，禁用 Node.js/npm/npx；測試用 `bun test`。
- **零破壞**：未傳任何新旗標時，行為與現狀逐位元相同（爬取 retries=3、退避基數 2000ms、併發 5、合併容差 10%、補抓開啟）。
- 設定機制：CLI 旗標為主，串進 `CrawlerConfig`，現值當預設。不做環境變數。
- 旗標解析抽成純函式以便單元測試。
- 不更動既有腳本對外行為（只擴充參數）。
- commit 訊息格式：`<type>: [ <scope> ] <subject>`。

---

### Task 1: CrawlerEngine 重試/延遲設定化

**Files:**
- Modify: `src/core/CrawlerEngine.ts`（`CrawlerConfig` 介面 26-30、建構子 74-94、重試迴圈 177-207）
- Test: `src/tests/unit/CrawlerEngineRetryConfig.test.ts`

**Interfaces:**
- Produces:
  - `CrawlerConfig` 新增可選欄位 `maxRetries?: number`、`retryBaseDelayMs?: number`
  - `CrawlerEngine` 建構子讀取上述欄位（預設 3 / 2000），章節抓取迴圈改用之

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/unit/CrawlerEngineRetryConfig.test.ts
import { test, expect } from 'bun:test'
import { CrawlerEngine } from '../../core/CrawlerEngine'
import type { NovelSiteAdapter } from '../../adapters/NovelSiteAdapter'
import type { StorageAdapter } from '../../storage/StorageAdapter'

const failingAdapter = (onFetch: () => void): NovelSiteAdapter =>
  ({
    siteName: 'mock',
    resourceProfile: undefined,
    getBookMetadata: async () => ({ title: 'T', author: 'A', sourceUrl: 'http://t', chapterCount: 1 }),
    getChapterList: async () => [{ index: 1, title: 'C1', sourceUrl: 'http://t/1' }],
    getChapterContent: async () => {
      onFetch()
      return 'x' // 太短 → 觸發失敗/重試路徑
    },
    close: async () => {},
  } as unknown as NovelSiteAdapter)

const mockStorage = (): StorageAdapter =>
  ({
    saveBookMetadata: async () => {},
    saveChapter: async () => {},
    chapterExists: async () => false,
    isValidChapter: async () => true,
  } as unknown as StorageAdapter)

test('建構子：config 設定 maxRetries 與 retryBaseDelayMs', () => {
  const engine = new CrawlerEngine(failingAdapter(() => {}), mockStorage(), {
    maxRetries: 5,
    retryBaseDelayMs: 500,
  })
  expect((engine as any).maxRetries).toBe(5)
  expect((engine as any).retryBaseDelayMs).toBe(500)
})

test('建構子：未指定時用預設 3 / 2000（config 與 legacy 皆是）', () => {
  const cfgEngine = new CrawlerEngine(failingAdapter(() => {}), mockStorage(), {})
  expect((cfgEngine as any).maxRetries).toBe(3)
  expect((cfgEngine as any).retryBaseDelayMs).toBe(2000)

  const legacyEngine = new CrawlerEngine(failingAdapter(() => {}), mockStorage(), 4)
  expect((legacyEngine as any).maxRetries).toBe(3)
  expect((legacyEngine as any).retryBaseDelayMs).toBe(2000)
})

test('章節抓取迴圈使用設定的 maxRetries（maxRetries=1 → 只抓一次）', async () => {
  let calls = 0
  const engine = new CrawlerEngine(failingAdapter(() => { calls++ }), mockStorage(), {
    maxRetries: 1,
    retryBaseDelayMs: 0,
  })
  await engine.run('http://t')
  expect(calls).toBe(1) // 若仍寫死 3，這裡會是 3
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/unit/CrawlerEngineRetryConfig.test.ts`
Expected: FAIL（`(engine as any).maxRetries` 為 undefined；行為測試 calls=3 不等於 1）

- [ ] **Step 3: Write minimal implementation**

3a. 在 `src/core/CrawlerEngine.ts` 的 `CrawlerConfig` 介面（約 26-30 行）新增兩欄：

```ts
export interface CrawlerConfig {
    /** Crawl concurrency limit (default: 5) */
    concurrency?: number
    /** Max fetch attempts per chapter (default: 3) */
    maxRetries?: number
    /** Base backoff delay in ms, multiplied by attempt number (default: 2000) */
    retryBaseDelayMs?: number
    /** Audio conversion configuration */
    audio?: CrawlerAudioConfig
}
```

3b. 在 `private concurrency: number;` 附近新增兩個私有欄位：

```ts
    private concurrency: number;
    private maxRetries: number;
    private retryBaseDelayMs: number;
```

3c. 在建構子內設定（先給預設，再於 config 分支覆蓋）。把現有建構子 body 改成：

```ts
        this.adapter = adapter;
        this.storage = storage;
        this.maxRetries = 3;
        this.retryBaseDelayMs = 2000;

        if (typeof concurrencyOrConfig === 'number') {
            // Legacy API: CrawlerEngine(adapter, storage, 5)
            this.concurrency = concurrencyOrConfig;
            this.audioConfig = {};
        } else {
            // New API: CrawlerEngine(adapter, storage, { concurrency: 5, audio: {...} })
            const useGoFromEnv = process.env.KINETITEXT_USE_GO_AUDIO === 'true';
            this.concurrency = concurrencyOrConfig.concurrency ?? 5;
            this.maxRetries = concurrencyOrConfig.maxRetries ?? 3;
            this.retryBaseDelayMs = concurrencyOrConfig.retryBaseDelayMs ?? 2000;
            this.audioConfig = {
                useGoBackend: (concurrencyOrConfig.audio?.useGoBackend ?? useGoFromEnv),
                goBinaryPath: concurrencyOrConfig.audio?.goBinaryPath
                    ?? process.env.KINETITEXT_GO_AUDIO_BIN,
            };
        }
```

3d. 在重試迴圈（約 177-200 行）把寫死值改成欄位。將：

```ts
                    let attempts = 0;
                    const maxRetries = 3;
```

改為：

```ts
                    let attempts = 0;
                    const maxRetries = this.maxRetries;
```

並把退避那行：

```ts
                            const delay = 2000 * attempts + Math.random() * 1000;
```

改為：

```ts
                            const delay = this.retryBaseDelayMs * attempts + Math.random() * 1000;
```

（迴圈內其餘對 `maxRetries` 的引用維持不變，因為 local `maxRetries` 仍存在。）

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/unit/CrawlerEngineRetryConfig.test.ts`
Expected: PASS（3 個測試）

- [ ] **Step 5: Run full suite (no regressions)**

Run: `bun test`
Expected: PASS（既有 CrawlerEngineWithGo 測試不受影響）

- [ ] **Step 6: Commit**

```bash
git add src/core/CrawlerEngine.ts src/tests/unit/CrawlerEngineRetryConfig.test.ts
git commit -m "feat: [core] CrawlerEngine 重試次數與退避延遲可設定"
```

---

### Task 2: start CLI 爬取旗標

**Files:**
- Modify: `src/cli/common.ts`（新增 `parseCrawlFlags` 與 `CrawlFlags`）
- Modify: `src/index.ts`（解析旗標並傳入引擎、更新 usage）
- Test: `src/tests/unit/CrawlFlags.test.ts`

**Interfaces:**
- Consumes: `CrawlerConfig`（Task 1 的 `maxRetries`/`retryBaseDelayMs`）
- Produces:
  - `interface CrawlFlags { retries?: number; concurrency?: number; delay?: number }`
  - `parseCrawlFlags(args: string[]): CrawlFlags`

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/unit/CrawlFlags.test.ts
import { test, expect } from 'bun:test'
import { parseCrawlFlags } from '../../cli/common'

test('parseCrawlFlags 解析三個爬取旗標', () => {
  const f = parseCrawlFlags(['url', '--crawl-retries=5', '--crawl-concurrency=8', '--crawl-delay=1500'])
  expect(f).toEqual({ retries: 5, concurrency: 8, delay: 1500 })
})

test('parseCrawlFlags 未給旗標回空物件（沿用預設）', () => {
  expect(parseCrawlFlags(['url'])).toEqual({})
})

test('parseCrawlFlags 忽略非數字值', () => {
  expect(parseCrawlFlags(['--crawl-retries=abc'])).toEqual({})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/unit/CrawlFlags.test.ts`
Expected: FAIL（`parseCrawlFlags` is not exported）

- [ ] **Step 3: Write minimal implementation**

3a. 在 `src/cli/common.ts` 檔尾新增：

```ts
export interface CrawlFlags {
  retries?: number
  concurrency?: number
  delay?: number
}

/**
 * 解析爬取相關 CLI 旗標：--crawl-retries / --crawl-concurrency / --crawl-delay。
 * 非數字或缺省則該欄不設（呼叫端沿用預設）。
 */
export function parseCrawlFlags(args: string[]): CrawlFlags {
  const out: CrawlFlags = {}
  for (const arg of args) {
    const m = arg.match(/^--crawl-(retries|concurrency|delay)=(.+)$/)
    if (!m) continue
    const n = parseInt(m[2], 10)
    if (isNaN(n)) continue
    if (m[1] === 'retries') out.retries = n
    else if (m[1] === 'concurrency') out.concurrency = n
    else out.delay = n
  }
  return out
}
```

3b. 在 `src/index.ts` 匯入並使用。把 import 行改為：

```ts
import { formatCliError, parseCommonCliFlags, parseCrawlFlags } from './cli/common';
```

在 `const useGoAudio = args.includes('--use-go-audio');` 之後新增：

```ts
    const crawl = parseCrawlFlags(args);
```

把引擎建構改為：

```ts
    const engine = new CrawlerEngine(adapter, storage, {
        concurrency: crawl.concurrency ?? 5,
        maxRetries: crawl.retries ?? 3,
        retryBaseDelayMs: crawl.delay ?? 2000,
        audio: { useGoBackend: useGoAudio },
    });
```

3c. 在 `printUsage()` 的選項清單（`--use-go-audio` 那行之後）新增說明：

```ts
    console.log('  --crawl-retries=<n>     每章最大嘗試次數 (預設 3)');
    console.log('  --crawl-concurrency=<n> 爬取併發 (預設 5)');
    console.log('  --crawl-delay=<ms>      退避延遲基數 ms (預設 2000)');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/unit/CrawlFlags.test.ts`
Expected: PASS（3 個測試）

- [ ] **Step 5: Smoke + full suite**

Run: `bun run start --help`
Expected: usage 列出三個新 `--crawl-*` 旗標，exit 0。

Run: `bun test`
Expected: PASS（無回歸）。

- [ ] **Step 6: Commit**

```bash
git add src/cli/common.ts src/index.ts src/tests/unit/CrawlFlags.test.ts
git commit -m "feat: [core] start 新增 --crawl-retries/concurrency/delay 旗標"
```

---

### Task 3: ytPipeline 純邏輯擴充（旗標 + 步驟 + 補抓判定）

**Files:**
- Modify: `src/core/services/ytPipeline.ts`
- Test: `src/tests/unit/ytPipeline.test.ts`（追加）

**Interfaces:**
- Consumes: 既有 `YtPipelineOptions`、`buildCrawlStep`、`buildMergeStep`
- Produces:
  - `YtPipelineOptions` 新增 `crawlRetries?: number`、`crawlConcurrency?: number`、`crawlDelay?: number`、`tolerance?: number`、`retryFailed: boolean`
  - `interface CrawlStepOptions { crawlRetries?: number; crawlConcurrency?: number; crawlDelay?: number }`
  - `buildCrawlStep(url: string, opts?: CrawlStepOptions): string[]`（向後相容：無 opts 時仍回 `['start', url]`）
  - `buildMergeStep(bookDir: string, mergedDir: string, target: string, tolerance?: number): string[]`（向後相容：無 tolerance 時不附加）
  - `shouldRetryFailed(failedList: unknown[], retryFailedEnabled: boolean): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// 追加到 src/tests/unit/ytPipeline.test.ts
import { shouldRetryFailed } from '../../core/services/ytPipeline'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/unit/ytPipeline.test.ts`
Expected: FAIL（`shouldRetryFailed` 未匯出；`o.crawlRetries` undefined；`buildCrawlStep` 只接一參數）

- [ ] **Step 3: Write minimal implementation**

3a. `YtPipelineOptions` 介面新增欄位（在 `title?: string` 後）：

```ts
  title?: string
  crawlRetries?: number
  crawlConcurrency?: number
  crawlDelay?: number
  tolerance?: number
  retryFailed: boolean
}
```

3b. 在 `parseYtPipelineArgs` 內，於 `const bitrate = ...` 之後新增一個小工具與解析；把 `return { ... }` 物件補上新欄位：

```ts
  const parseOptInt = (v: unknown): number | undefined => {
    if (typeof v !== 'string') return undefined
    const n = parseInt(v, 10)
    return isNaN(n) ? undefined : n
  }
  return {
    url,
    target: (flags.target as string) ?? '6h',
    bitrate,
    rate: (flags.rate as string) ?? '+0%',
    volume: (flags.volume as string) ?? '+0%',
    concurrency: (flags.concurrency as string) ?? '3',
    font: (flags.font as string) ?? DEFAULT_FONT,
    resume: flags.resume === undefined ? true : flags.resume !== 'false',
    dryRun: flags['dry-run'] === true || flags['dry-run'] === 'true',
    title: flags.title as string | undefined,
    crawlRetries: parseOptInt(flags['crawl-retries']),
    crawlConcurrency: parseOptInt(flags['crawl-concurrency']),
    crawlDelay: parseOptInt(flags['crawl-delay']),
    tolerance: parseOptInt(flags['tolerance']),
    retryFailed: flags['no-retry-failed'] ? false : true,
  }
```

3c. 取代 `buildCrawlStep`：

```ts
export interface CrawlStepOptions {
  crawlRetries?: number
  crawlConcurrency?: number
  crawlDelay?: number
}

export function buildCrawlStep(url: string, opts?: CrawlStepOptions): string[] {
  const args = ['start', url]
  if (opts?.crawlRetries !== undefined) args.push(`--crawl-retries=${opts.crawlRetries}`)
  if (opts?.crawlConcurrency !== undefined) args.push(`--crawl-concurrency=${opts.crawlConcurrency}`)
  if (opts?.crawlDelay !== undefined) args.push(`--crawl-delay=${opts.crawlDelay}`)
  return args
}
```

3d. 取代 `buildMergeStep`：

```ts
export function buildMergeStep(
  bookDir: string,
  mergedDir: string,
  target: string,
  tolerance?: number
): string[] {
  const args = ['merge-mp3', bookDir, '--mode=duration', `--target=${target}`, `--output=${mergedDir}`]
  if (tolerance !== undefined) args.push(`--tolerance=${tolerance}`)
  return args
}
```

3e. 在檔尾新增 `shouldRetryFailed`：

```ts
/**
 * 判定是否需要補抓失敗章節：啟用且失敗清單非空才補。
 */
export function shouldRetryFailed(failedList: unknown[], retryFailedEnabled: boolean): boolean {
  return retryFailedEnabled && Array.isArray(failedList) && failedList.length > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/unit/ytPipeline.test.ts`
Expected: PASS（含既有測試，全部通過）

- [ ] **Step 5: Commit**

```bash
git add src/core/services/ytPipeline.ts src/tests/unit/ytPipeline.test.ts
git commit -m "feat: [core] yt-pipeline 純邏輯加爬取旗標/容差/補抓判定"
```

---

### Task 4: yt-pipeline orchestrator 接線 + 補抓關卡 + 文件

**Files:**
- Modify: `scripts/yt_pipeline.ts`
- Modify: `README.md`、`AGENTS.md`

**Interfaces:**
- Consumes: Task 3 的 `buildCrawlStep(url, opts)`、`buildMergeStep(..., tolerance)`、`shouldRetryFailed`、`YtPipelineOptions` 新欄位

- [ ] **Step 1: 接線爬取旗標、容差、補抓關卡，更新 HELP/dry-run**

1a. 匯入 `shouldRetryFailed`：把 import 區塊（5-12 行）改為：

```ts
import {
  parseYtPipelineArgs,
  buildCrawlStep,
  buildAudiobookStep,
  buildMergeStep,
  pickNewBook,
  buildPartMp4Plans,
  shouldRetryFailed,
} from '../src/core/services/ytPipeline'
```

1b. HELP 字串（16-28 行）在 `--title` 行之前插入新旗標說明：

```ts
  --crawl-retries=<n>  爬取每章最大嘗試次數（預設 3）
  --crawl-concurrency=<n> 爬取併發（預設 5）
  --crawl-delay=<ms>   爬取退避延遲基數 ms（預設 2000）
  --tolerance=<%>      合併時長容差（預設 10）
  --no-retry-failed    爬完不自動補抓失敗章節（預設會補）
```

1c. dry-run 區塊（59-66 行）把 ① 與 ③ 兩行改為帶旗標、並加一行補抓說明：

```ts
  if (o.dryRun) {
    const crawlOpts = { crawlRetries: o.crawlRetries, crawlConcurrency: o.crawlConcurrency, crawlDelay: o.crawlDelay }
    console.log('[Dry-run] 將執行:')
    console.log('  ①', buildCrawlStep(o.url, crawlOpts).join(' '))
    console.log(`  ↳ 補抓失敗章節: ${o.retryFailed ? '開啟' : '關閉'}`)
    console.log('  ② audiobook <書名> all', o.rate, o.volume, o.concurrency, 'false')
    console.log('  ③', buildMergeStep('output/<書名>', 'output/<書名>/merged', o.target, o.tolerance).join(' '))
    console.log('  ④ 逐段生成封面 + ffmpeg 出 mp4（bitrate ' + o.bitrate + '）')
    process.exit(0)
  }
```

1d. 實際爬取呼叫（71 行）改為帶 opts：

```ts
  let code = await runScript(buildCrawlStep(o.url, {
    crawlRetries: o.crawlRetries,
    crawlConcurrency: o.crawlConcurrency,
    crawlDelay: o.crawlDelay,
  }))
```

1e. 在 `console.log(\`\n📖 書名: ${title}\`)`（82 行）之後、`const bookDir = ...`（84 行）之前，插入補抓關卡：

```ts
  // 補抓關卡：爬完若有失敗章節且未關閉，跑一輪 retry-failed（盡力而為，不卡 pipeline）
  const failed = await readFailedChapters(title)
  if (shouldRetryFailed(failed, o.retryFailed)) {
    console.log(`\n========== 🔁 補抓失敗章節（${failed.length} 章）==========\n`)
    await runScript(['retry-failed', title])
    const remaining = await readFailedChapters(title)
    console.log(`\n🔁 補抓完成，剩餘失敗 ${remaining.length} 章。\n`)
  }
```

1f. 合併步驟（92 行）改為帶 tolerance：

```ts
    { label: '③ 時長合併', args: buildMergeStep(bookDir, mergedDir, o.target, o.tolerance) },
```

1g. 在 `ensureFfmpeg` 函式之後（172 行附近）新增 `readFailedChapters` 輔助函式：

```ts
async function readFailedChapters(title: string): Promise<unknown[]> {
  try {
    const f = Bun.file(path.join(OUTPUT_ROOT, title, 'failed_chapters.json'))
    if (!(await f.exists())) return []
    const json = await f.json()
    return Array.isArray(json) ? json : []
  } catch {
    return []
  }
}
```

- [ ] **Step 2: 驗證 help 與 dry-run**

Run:
```bash
bun run yt-pipeline --help
bun run yt-pipeline "https://twp.zhys.tw/book/777167.html" --dry-run --crawl-retries=5 --tolerance=20 --no-retry-failed
```
Expected：
- `--help` 列出所有新旗標，exit 0。
- dry-run 的 ① 行顯示 `start <url> --crawl-retries=5`，補抓行顯示「關閉」，③ 行顯示 `--tolerance=20`，exit 0。

- [ ] **Step 3: 全測試套件**

Run: `bun test`
Expected: PASS（無回歸）。

- [ ] **Step 4: 更新 README.md 與 AGENTS.md**

於 `README.md` 既有 yt-pipeline 段落的參數列補上新旗標：

```markdown
# 爬取可調：--crawl-retries=3 --crawl-concurrency=5 --crawl-delay=2000
# 合併容差：--tolerance=10
# 爬完自動補抓失敗章節（預設開）；--no-retry-failed 可關閉
```

於 `AGENTS.md` 的 YT Pipeline 說明那行後補一句：

```markdown
  支援爬取重試/併發/延遲旗標（`--crawl-retries/concurrency/delay`）、合併容差（`--tolerance`）與爬後自動補抓（`--no-retry-failed` 關閉）。
```

- [ ] **Step 5: Commit**

```bash
git add scripts/yt_pipeline.ts README.md AGENTS.md
git commit -m "feat: [core] yt-pipeline 接線爬取旗標/容差並自動補抓失敗章節"
```

---

## Self-Review

**Spec coverage:**
- §2 CrawlerEngine `maxRetries`/`retryBaseDelayMs` + 取代寫死值 → Task 1。
- §3.1 start 三旗標（解析抽純函式）→ Task 2。
- §3.2 yt-pipeline 旗標/步驟（crawl 旗標、tolerance、no-retry-failed）→ Task 3 + Task 4 接線。
- §4 補抓關卡（`shouldRetryFailed` + readFailedChapters + retry-failed 子程序，盡力而為）→ Task 3（純函式）+ Task 4（接線）。
- §5 測試：CrawlerEngine 注入/行為、parseYtPipelineArgs、buildCrawlStep、buildMergeStep、shouldRetryFailed、parseCrawlFlags → 各 Task 的 bun:test。
- §6 檔案落點 → 與各 Task Files 一致。
- 文件 README/AGENTS → Task 4。

**Placeholder scan:** 無 TBD/TODO；每個 code step 均含完整程式。

**Type consistency:** `CrawlerConfig.maxRetries/retryBaseDelayMs`（Task 1）↔ start 建構 config（Task 2）一致；`CrawlStepOptions`/`buildCrawlStep(url,opts)`（Task 3）↔ orchestrator 呼叫（Task 4）一致；`buildMergeStep(bookDir,mergedDir,target,tolerance?)` 簽名 Task 3 定義、Task 4 取用一致；`shouldRetryFailed(failedList, enabled)` Task 3 定義、Task 4 取用一致；`YtPipelineOptions.retryFailed` 為必填布林（預設 true），orchestrator 直接讀取。
