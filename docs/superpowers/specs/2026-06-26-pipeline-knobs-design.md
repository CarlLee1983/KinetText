# Pipeline 旋鈕參數化 — 設計

> **歷史設計紀錄（2026-06-26）**
>
> 本文件記錄當時的設計決策；相關 CLI 旗標與自動補抓已實作，因此文中的「待實作」狀態已過時。請改閱 [現行路線圖](../../../.planning/ROADMAP.md)。

- 日期：2026-06-26
- 狀態：待實作
- 目標：把爬取重試/併發/延遲開放成 CLI 旗標、把合併容差透出，並讓 `yt-pipeline` 爬完自動補抓失敗章節，使整條 pipeline 完全可腳本化。

## 1. 目標與範圍

讓三件目前無法腳本化或未透出的事可調：

1. **爬取重試/併發/延遲** — 目前硬編碼於 `CrawlerEngine.ts:178`（`maxRetries=3`）、`:199`（退避 `2000×attempts+亂數`）、`index.ts`（併發 5）。
2. **合併單檔時長容差** — merge-mp3 已支援 `--tolerance`，但 `yt-pipeline` 未透出（用預設 10%）。
3. **爬完自動補抓** — `yt-pipeline` 爬完若有失敗章節，自動跑一輪 `retry-failed` 再進 TTS。

**範圍外（YAGNI）：**
- 不做環境變數設定（純 CLI 旗標；env 之後要再加不難）。
- 不調 jitter 上限（很少需要）。
- 不做多輪補抓（固定一輪）。

**設定機制決策：** CLI 旗標為主，串進 `CrawlerConfig`，**現值當預設**——不傳旗標則行為與現狀完全相同（零破壞）。

## 2. CrawlerEngine 設定擴充

`CrawlerConfig`（定義於 `src/core/CrawlerEngine.ts:26`，並由 `src/tests/integration/CrawlerEngineWithGo.test.ts` 匯入）新增兩個可選欄位：

```ts
interface CrawlerConfig {
  concurrency?: number          // 既有
  maxRetries?: number           // 新增，預設 3
  retryBaseDelayMs?: number     // 新增，預設 2000
  // ...既有欄位
}
```

`CrawlerEngine`：
- 建構子讀取 `maxRetries`（預設 3）、`retryBaseDelayMs`（預設 2000）存為私有欄位。
- 章節抓取迴圈（約 `:178`）的 `const maxRetries = 3` 改用 `this.maxRetries`。
- 退避（約 `:199`）`2000 * attempts + Math.random() * 1000` 改為 `this.retryBaseDelayMs * attempts + Math.random() * 1000`。
- `concurrency` 已是建構子參數，維持。

零破壞：未指定時行為與現狀一致。

## 3. CLI 接線

### 3.1 `start`（`src/index.ts`）

新增三旗標，解析後傳入 `CrawlerEngine` 的 config：

| 旗標 | 預設 | 對應 |
|---|---|---|
| `--crawl-retries=<n>` | 3 | `maxRetries` |
| `--crawl-concurrency=<n>` | 5 | `concurrency`（取代寫死的 5） |
| `--crawl-delay=<ms>` | 2000 | `retryBaseDelayMs` |

旗標解析抽成純函式（如 `parseCrawlFlags(args): { retries?, concurrency?, delay? }`）以便單元測試；非數字或缺省則回 undefined（沿用預設）。

### 3.2 `yt-pipeline`

**`parseYtPipelineArgs`** 新增欄位：

| 旗標 | 預設 | 欄位 |
|---|---|---|
| `--crawl-retries=<n>` | undefined（→start 用 3） | `crawlRetries?` |
| `--crawl-concurrency=<n>` | undefined（→start 用 5） | `crawlConcurrency?` |
| `--crawl-delay=<ms>` | undefined（→start 用 2000） | `crawlDelay?` |
| `--tolerance=<%>` | undefined（→merge 用 10） | `tolerance?` |
| `--no-retry-failed` | （未給）= 補抓開啟 | `retryFailed: boolean`（預設 true） |

**`buildCrawlStep(url, opts?)`** 擴充：在 `['start', url]` 後，依 opts 有值才附加 `--crawl-retries=`、`--crawl-concurrency=`、`--crawl-delay=`。未給則不加旗標。

**`buildMergeStep(bookDir, mergedDir, target, tolerance?)`** 擴充：tolerance 有值才附加 `--tolerance=<%>`。

## 4. 爬完自動補抓（retry-failed）

`yt-pipeline` 在 ①爬取成功、`pickNewBook` 判定書名後、進 ②TTS 之前插入「補抓關卡」：

- 讀 `output/<書名>/failed_chapters.json`（不存在或解析失敗 → 視為空清單、跳過，不報錯）。
- 純函式 `shouldRetryFailed(failedList: unknown[], retryFailedEnabled: boolean): boolean` — 啟用且清單非空才回 true。
- 若需補抓：以子程序跑 `retry-failed <書名>`（一輪）。**不論結果都繼續往下**（補抓是盡力而為，不應卡死 pipeline）；補完印出剩餘失敗數。
- `--no-retry-failed` → `retryFailed=false` → 整個關卡跳過。

## 5. 測試（bun:test）

- **CrawlerEngine**：注入 `maxRetries=1`、自訂 `retryBaseDelayMs`，用 mock adapter 強制抓取失敗，驗證實際重試次數 = 設定值、退避用設定基數。
- **parseYtPipelineArgs**：三爬取旗標 + `--tolerance` 解析與預設；`--no-retry-failed` 反向布林（未給 = true，給了 = false）。
- **buildCrawlStep**：有/無 opts 的旗標映射（「不傳則不加旗標」）。
- **buildMergeStep**：tolerance 有/無時的旗標附加。
- **shouldRetryFailed**：空清單→false、停用→false、有失敗且啟用→true。
- **parseCrawlFlags（start）**：數字解析、缺省回 undefined。

## 6. 檔案落點

- 改：`src/core/CrawlerEngine.ts`（CrawlerConfig 型別 + 重試迴圈）、`src/index.ts`、`src/core/services/ytPipeline.ts`、`scripts/yt_pipeline.ts`
- 測試：擴充 `src/tests/unit/ytPipeline.test.ts`；新增/擴充 CrawlerEngine 與 start 旗標測試。
- 文件：`README.md`、`AGENTS.md` 補新旗標說明。

## 7. 相依與順序

獨立於既有 yt-pipeline，純疊加。建議實作順序：CrawlerEngine config → start 接線 → yt-pipeline 旗標/步驟 → 補抓關卡 → 文件。
