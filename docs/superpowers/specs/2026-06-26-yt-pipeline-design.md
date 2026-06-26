# YT Pipeline — 端到端設計（爬文 → mp3 → 合併 → YouTube MP4）

- 日期：2026-06-26
- 狀態：待實作
- 目標：提供一支可一鍵運作、可重跑接續的指令，從小說網址一路產出可上傳 YouTube 的 MP4 檔。

## 1. 目標與範圍

新增 `bun run yt-pipeline <url>`，串接既有環節，從爬取走到 YouTube-ready MP4。

**範圍內：**
- 一支 orchestrator 腳本串接 4 步（爬取 → TTS → 時長合併 → 封面+MP4）。
- 自動生成靜態封面（純色底 + 書名大字 + partN 小字）。
- 失敗即停、可重跑接續、dry-run、可調參數。
- 產出一支或多支 MP4（H.264 + AAC，1920×1080），落在 `output/<書名>/mp4/`。

**範圍外（YAGNI）：**
- 不透過 YouTube Data API 自動上傳（只產檔，使用者手動上傳）。
- 封面不帶實際章節範圍文字，只帶 partN。
- 不改動既有 `start` / `audiobook` / `merge-mp3` 腳本的行為。

## 2. 資料流與目錄結構

每本書目錄結構（既有慣例）：

```
output/<書名>/txt/      ← ① 爬取章節（start）
output/<書名>/audio/    ← ② 逐章 mp3（audiobook）
output/<書名>/merged/   ← ③ 時長合併後的 mp3 分段（merge-mp3）
output/<書名>/mp4/       ← ④ 最終 YouTube MP4（本 pipeline 新增的最後一步）
```

Pipeline 步驟：

| 步驟 | 動作 | 複用 | 輸出 |
|---|---|---|---|
| ① 爬取 | `start <url>` | 既有 script | `output/<書名>/txt/` |
| ② TTS | `audiobook <書名> all +0% +0% 3 false` | 既有 script | `output/<書名>/audio/*.mp3` |
| ③ 時長合併 | `merge-mp3 output/<書名> --mode=duration --target=6h --output=output/<書名>/merged` | 既有 script | `output/<書名>/merged/*.mp3` |
| ④ 封面+MP4 | 逐段：生成封面 → ffmpeg 出 mp4 | 新寫 orchestrator + CoverGenerator | `output/<書名>/mp4/*.mp4` |

**書名取得**：爬取後資料夾名可能被 sanitize，orchestrator 在 ① 完成後掃描 `output/` 找出最新（或唯一）新建書目錄作為後續步驟的 `<書名>`，避免靠手打書名。沿用 `src/tui/books.ts` 的掃描邏輯（純函式）。

## 3. 元件設計

### 3.1 `scripts/yt_pipeline.ts`（orchestrator，新檔）

職責：解析參數 → 依序以子程序執行 ①②③ → 第④步在程序內逐段生成封面並呼叫 ffmpeg → 報告。

- 子程序執行沿用 `src/tui/runner.ts` 的 `runScript()` 模式（`Bun.spawn(['bun','run',...])`、stdio inherit、回傳 exit code）。
- **失敗即停**：任一步 exit code ≠ 0 → 印出「停在第 N 步」與可手動接續的指令 → 非 0 結束。
- **參數**（皆有預設）：
  - `<url>`（必填，positional）
  - `--target=6h`（③ 時長分段上限）
  - `--bitrate=256`（④ AAC 位元率）
  - `--rate=+0%` `--volume=+0%` `--concurrency=3`（② TTS）
  - `--font=<path>`（④ 封面字型，預設 `/System/Library/Fonts/PingFang.ttc`）
  - `--resume`（預設 true：已存在產物跳過）
  - `--dry-run`（印計畫，不執行 ffmpeg / 子程序）
  - `--help` / `-h`
- **重跑接續**：①②③ 既有腳本本身對已存在產物為增量/跳過；④ 在輸出 mp4 已存在且 `--resume` 時跳過該段。

### 3.2 `src/core/services/CoverGenerator.ts`（新檔）

職責：用 ffmpeg `lavfi color` + `drawtext` 生成靜態封面 jpg。

- API：`generateCover(opts: { title: string; partLabel: string; outPath: string; font: string; width?: number; height?: number }): Promise<void>`
- 內部呼叫純函式 builder（見 3.3）取得 ffmpeg 參數陣列，再以 `Bun.$` 執行。
- 字型檔不存在 → 拋出描述性錯誤（讓 orchestrator 印出並停止）。

### 3.3 封面 ffmpeg 參數 builder（新增於 `src/core/utils/ffmpeg-commands.ts`）

純函式 `buildCoverImageCommand(opts): string[]`，回傳 ffmpeg 參數陣列（非 shell 字串）：

- `lavfi color=c=<bg>:s=<w>x<h>` 純色底。
- `drawtext` 兩段文字：書名（大字、置中偏上）、partN（小字、置中偏下）。
- 文字以 `JSON.stringify` 風格跳脫（沿用既有 `escapeMetadata` 模式），避免 shell injection 與特殊字元問題。
- `-frames:v 1` 輸出單張 jpg。
- 純函式 → 可單元測試（驗證參數陣列內容），不需實際跑 ffmpeg。

### 3.4 第④步 MP4 生成

orchestrator 逐段：
1. 讀 `output/<書名>/merged/*.mp3`（排序）。
2. 對每段以 `CoverGenerator` 生成封面（書名 + `partN`）。
3. 呼叫既有 `buildMP4WithImageCommand(coverPath, mp3Path, mp4OutPath, bitrate, 1920, 1080, metadata)` 取得 ffmpeg 參數，以 `Bun.$` 執行。
4. mp4 已存在且 `--resume` → 跳過。

封面暫存於 `output/<書名>/mp4/.covers/`（或 `tmp/`），完成後可保留供除錯。

## 4. 錯誤處理

- 每步描述性錯誤；失敗即停並給出可接續指令。
- 缺 `ffmpeg`：在 ④ 開始前檢查 `ffmpeg -version`，缺則明確報錯。
- 缺字型檔：`CoverGenerator` 拋錯。
- ① 後找不到新書目錄 → 中止並提示。
- ③ 後 `merged/` 為空 → 中止並提示。

## 5. 測試（bun:test）

- `buildCoverImageCommand`：純函式，驗證參數陣列含預期 `lavfi`、`drawtext`、跳脫、解析度、輸出路徑。
- orchestrator 步驟 args 組裝：驗證各步傳給子程序的參數正確（target/bitrate/rate 等映射）。
- 「失敗即停」邏輯：模擬某步回傳非 0，驗證後續步驟不執行。
- 實際 ffmpeg / 網路 / 子程序以 dry-run 或注入式 runner mock 隔離，不在單元測試打外部。

## 6. package.json

新增 script：

```json
"yt-pipeline": "bun run scripts/yt_pipeline.ts"
```

## 7. 未決 / 後續可擴充

- 之後若要封面帶實際章節範圍，可從 ③ 的 `--report` JSON 讀 part→章節對應。
- 之後若要自動上傳，再加 YouTube Data API 步驟（需 OAuth）。
