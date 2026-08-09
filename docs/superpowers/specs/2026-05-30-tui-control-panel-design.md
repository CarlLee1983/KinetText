# TUI 控制台設計 (Control Panel)

> **歷史設計紀錄（2026-05-30）**
>
> 本文件記錄當時的設計決策；TUI 已實作，因此文中的「待實作」狀態已過時。請改閱 [現行路線圖](../../../.planning/ROADMAP.md)。

- **日期**: 2026-05-30
- **狀態**: 設計已確認，待實作
- **作者**: carl + Claude

## 背景與問題

KinetiText 目前有 12 個 `bun run` 指令，痛點：

1. **背參數累**：`audiobook "書名" 1-200 +0% +50% 5 true` 全是位置參數；`merge-mp3` / `to-mp4` 一堆 `--input= --output= --target= --mode=` flag。
2. **手動接 pipeline 累**：爬取 → TTS → 合併 → 轉檔 → 備份 共 5 步前後相依，路徑要手動接。
3. **缺視覺化管理**：看不到有哪些書、各書進度到哪、哪些章節失敗。

使用情境：**單人、坐在 Mac (M4) 終端機前操作**。因此選 **TUI**（而非 HTML GUI），零額外服務、`bun` 直接跑。

## 方案決定

採用 **選單式互動 CLI**（@clack/prompts），搭配**詳細狀態檢視**。

否決方案：
- 全螢幕儀表板 (Ink/React)：對單人終端機過度設計、工時高、需改 script 串流進度。
- 純 Bun 內建 prompt：無方向鍵選單，無法達成「不打字選書」。

## 核心原則

> TUI 只負責「問問題 → 組參數 → spawn 現有 script → 即時顯示輸出」。
> 所有爬取/TTS/合併/轉檔邏輯**留在現有 script，一行不改**。

新指令以子程序方式呼叫現有 script，重用全部既有邏輯，零重構風險。未來新增指令只需在選單多一項。

## 架構與檔案結構

新增 `src/tui/` 模組，新增 package.json 指令 `"menu": "bun run src/tui/index.ts"`。

```
src/tui/
├── index.ts        # 入口：主迴圈，顯示主選單、分派動作
├── books.ts        # 掃描 output/ → 每本書各階段狀態（狀態檢視資料層，純函式）
├── status.ts       # 詳細狀態檢視畫面（總覽表 + 單書展開）
├── runner.ts       # 組 argv → spawn 現有 script → 即時串流 stdout/stderr
└── actions/
    ├── crawl.ts        # 爬取（問 URL）→ start
    ├── audiobook.ts    # TTS（選書、章節範圍、音色、速度、並行、是否合併）
    ├── merge.ts        # 合併（選書、模式 size/duration、目標值）
    ├── convert.ts      # 轉檔（選書、bitrate、格式）
    ├── backup.ts       # 備份
    └── pipeline.ts     # 一鍵全跑（爬取→TTS→合併→轉檔→備份，路徑自動接）
```

- **依賴**：新增 `@clack/prompts`（方向鍵選單、輸入、確認、spinner；Bun 下可用、體積小）。其餘用 Bun 內建。
- **檔案大小**：每個 action 約 50~120 行，符合「小檔案、單一職責」原則。

### 對應現有 script

| TUI action | 呼叫的 script | package.json 指令 |
|---|---|---|
| crawl | `src/index.ts` | `start` |
| audiobook | `scripts/generate_audiobook.ts` | `audiobook` |
| merge | `scripts/merge_mp3.ts` | `merge-mp3` |
| convert | `scripts/mp3_to_mp4.ts` | `to-mp4` |
| backup | `scripts/backup.ts` | `backup` |
| 重試失敗 | `scripts/retry_failed.ts` | `retry-failed` |

## 狀態檢視（詳細）

### 資料來源：`output/<書名>/`

| 目錄/檔案 | 階段 | 算出 |
|---|---|---|
| `txt/` + `run_report.json` + `failed_chapters.json` | 爬取 | 已爬 N 章 / 失敗 M 章 |
| `audio/` | TTS | mp3 數 vs txt 數 → 進度 %、缺號 |
| `merged/` | 合併 | 合併檔數 |
| `m4a/` `mp4/` | 轉檔 | 轉檔數 |
| `metadata.*` | 元資料 | 有/無 |

### `failed_chapters.json` 結構（來自 `scripts/retry_failed.ts`）

```json
[
  { "index": 12, "title": "第十二章 範例", "sourceUrl": "https://example.com/ch/12", "reason": "timeout" }
]
```
（`reason` 為選填；以上為合成範例值）

### 第 1 層 — 總覽表

```
書名            爬取        TTS         合併    轉檔    狀態
───────────────────────────────────────────────────────────
749局祕聞       716/716 ✓   716/716 ✓   9 檔    9 ✓     ✅ 完成
神秘復甦        320/340 ⚠    280/320     —       —       🔄 TTS 中
某某小說        0/—         —           —       —       ⏸  僅建立
```

- 每階段：`已完成/總數` + 圖示（✓ 完成、⚠ 有失敗、🔄 進行中、— 未開始）。
- 最右「狀態」欄自動判斷整本書走到哪。
- 顏色：綠=完成、黃=有失敗、灰=未開始。

### 第 2 層 — 單書展開（總覽選一本 Enter）

```
📖 749局祕聞
├ 爬取    716/716 章   失敗 0   (run_report.json: 2026-05-29)
├ TTS     716 個 mp3   缺 0 章
├ 合併    9 個 merged 檔   總時長 ~99h
├ 轉檔    9 個 m4a   (bitrate 256k)
├ 元資料  ✓ metadata.txt
└ ⚠ 失敗章節 (0):  無

[操作] 接續跑 TTS │ 重試失敗章節 │ 合併 │ 轉檔 │ 返回
```

- **「缺幾章」用比對算**：`txt/` 章節號 vs `audio/` mp3 章節號，列出實際缺號（不只看數字差）。
- **失敗章節**讀 `failed_chapters.json`，列章節號 + 原因。
- **展開底下直接給操作鈕**：看到缺什麼當場接著補，不用退回主選單。

## 互動式參數（殺掉「背參數」）

以 `audiobook` 為例（全部有預設，Enter 過）：

```
選書        → 從 output/ 自動列出 [749局祕聞] [神秘復甦] ...（方向鍵選）
章節範圍    → 文字輸入，預設 "all"（提示：5 / 10-20 / 2,4,10）
音色速度    → 預設 +0%
音量        → 預設 +0%
並行數      → 預設 3
跑完合併？  → 是/否，預設否
```
→ 組成 `audiobook "749局祕聞" all +0% +0% 3 false` → spawn → 即時串流。

- **選書一律從 `output/` 掃出來用選的**，不打字記書名。
- **路徑型參數（merge/convert 的 `--input`/`--output`）全自動帶**，由選的書推導，使用者不碰路徑。

## 一鍵 Pipeline

選「🚀 一鍵全跑」→ 問一次必要輸入（URL 或選現有書、章節範圍）→ 依序 `爬取→TTS→合併→轉檔→備份`，每步輸出自動接下一步路徑。任一步失敗即停，顯示停在哪步 + 如何手動接續。

## 錯誤處理

- script 回傳非 0 → 捕捉、紅字顯示哪一步失敗 + 原始錯誤摘要，回主選單不崩潰。
- 找不到書/目錄 → 友善提示，不丟 stack trace。
- Ctrl+C → 乾淨中止，提示「子程序可能仍在背景執行」。

## 測試（bun:test）

- **`books.ts` 狀態掃描（最重要）**：暫存目錄建假 `output/` 結構，驗證各階段數字、缺號比對、`failed_chapters.json` 解析正確。純函式，最值得測。
- **`runner.ts` 參數組裝**：給定使用者輸入，驗證組出的 argv 正確（特別是 audiobook 位置參數順序、merge/convert flag）。
- **互動 UI 層（clack）**：不寫自動測試，手動驗收。

## 範圍界線 (YAGNI)

- 不做即時常駐儀表板（B 方案）。
- 不做 HTML/web。
- 不重構現有 script。
- 不做多書並行排程；一次跑一個動作。

## 驗收標準

1. `bun run menu` 進入主選單，方向鍵可選所有動作。
2. 跑 `audiobook` / `merge` / `convert` 全程不需打任何路徑或記任何 flag。
3. 「檢視狀態」總覽表正確反映現有 `output/749局祕聞` 各階段。
4. 單書展開能列出缺號與失敗章節，並能一鍵接續。
5. 一鍵 pipeline 能從爬取跑到備份，中途失敗有明確提示。
6. `books.ts` 與 `runner.ts` 有 bun:test 覆蓋且通過。
7. 現有 12 個 `bun run` 指令行為完全不變。
