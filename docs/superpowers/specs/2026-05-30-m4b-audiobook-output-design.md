# M4B 有聲書輸出 — 設計

**日期**：2026-05-30
**狀態**：設計已確認，待寫實作計畫

## 背景與動機

目前聽書流程是把 TTS 產生的音訊轉成「黑畫面 MP4」上傳 YouTube 當播放器
（`ffmpeg-commands.ts` 的 `buildMP4WithVideoCommand` 即為此存在）。該 hack 浪費
CPU/儲存/上傳，且 YouTube 沒有有聲書式的章節導覽與進度記憶。

改用 **M4B 有聲書格式**（AAC 音訊 + 章節標記 + 選配封面），即 Audible / Apple Books
用的格式，丟進 Apple Books（iOS）或 Smart AudioBook Player / Voice（Android）就能
跳章、記憶播放位置、倍速、睡眠定時、離線聽。

## 目標

從 `output/<書>/audio/` 的逐章 MP3 **直接**產生含章節標記的 M4B，按時長分卷。
新增為獨立動作並設為 pipeline 預設；舊的 merge / convert / MP4 路徑保留可單獨使用。

## 已確認決策

| 決策 | 選擇 | 理由 |
|------|------|------|
| 章節粒度 | 逐章標記，從 `audio/` 取音 | 有聲書 App 內可看到完整章節清單、隨時跳章；體驗最佳 |
| 分卷 | 按時長分卷（沿用約 11 小時/卷） | 檔案大小可控、好傳手機；App 多能把同書多卷視為一部作品 |
| 書籍資訊 | 自動推導 + 選配封面 | output/ 目前無 metadata.json 與封面圖；以資料夾名推導，cover 存在才嵌 |
| 流程整合 | 新增動作 + 設為 pipeline 預設 | 不破壞既有 merge/convert/MP4 與其測試 |

## 資料流

```
output/<書>/audio/NNNN - 第N章標題.mp3   （逐章，已依檔名排序）
        │  ① 讀每章時長 (DurationService.getDuration, music-metadata)
        │  ② 依目標時長分卷 (AudioMergeService.groupByDuration，沿用貪婪演算法)
        ▼
  每卷 = 一組有序章節
        │  ③ 由各章累計時長算章節起訖 → 產 FFMETADATA（含章節標題）
        │  ④ ffmpeg concat 各章 + 嵌 FFMETADATA + 書籍 metadata + 選配封面 → 重編碼 AAC
        ▼
output/<書>/m4b/<書>_vol01.m4b … vol0N.m4b   （每卷內逐章可跳）
```

## 元件（高內聚、可獨立測試）

1. **`src/core/utils/m4b-metadata.ts`**（純函式）
   - `parseChapterTitle(filename)`：`0001 - 第一章林四九.mp3` → `第一章林四九`
     （去 `NNNN - ` 前綴與副檔名；無法解析時回退為原檔名去副檔名）。
   - `buildFFMetadata(chapters, book)`：輸入 `{ title, duration }[]` 與書籍欄位，
     以 `TIMEBASE=1/1000` 由累計時長算出每章 `START`/`END`，輸出 `;FFMETADATA1`
     檔頭（title/artist/album）+ 多個 `[CHAPTER]` 區塊。值需跳脫換行等特殊字元。

2. **`src/core/utils/ffmpeg-commands.ts`** 新增 `buildM4BCommand(...)`
   - 回傳參數陣列（非 shell 字串）：concat list 輸入 + FFMETADATA 輸入
     （`-map_metadata`）+ 選配 cover 輸入（`-disposition:v attached_pic`），
     `-c:a aac -b:a <bitrate>k -movflags +faststart`。延用現有 `escapeMetadata`。
   - bitrate 驗證沿用 96–320 範圍。

3. **`src/core/services/M4BBuilderService.ts`**
   - 協調：列出 `audio/*.mp3`（排序）→ 讀時長 → `groupByDuration` 分卷 →
     逐卷寫暫存 concat list + FFMETADATA → 執行 `buildM4BCommand` →
     驗證輸出存在且非空 → 清理暫存。
   - shell executor 可注入（仿 `AudioMergeService` 的 `MergeShellExecutor`）以利測試。
   - 以 `RetryService` 包裝暫時性 ffmpeg 錯誤；逐卷失敗各自記錄，不中斷其餘卷。

4. **`scripts/build_m4b.ts`**（CLI）
   - 參數：`--title=<書名>`（推導 in/out）或 `--input=`/`--output=`；
     `--target=<秒>`（每卷目標時長，預設 39600）；`--bitrate=<kbps>`（預設 256）；
     `--dry-run`。輸出中文報告（仿 `mp3_to_mp4.ts` 的 `formatReport`）。
   - `package.json` 新增 `"build-m4b": "bun run scripts/build_m4b.ts"`。

5. **TUI**
   - `src/tui/actions/m4b.ts`：選書 → 選 bitrate / 每卷時長 → 呼叫 `build-m4b`。
   - `src/tui/index.ts` 主選單新增「🎧 生成 M4B 有聲書」。
   - `src/tui/runner.ts` 新增 `buildM4bArgs`。
   - `src/tui/paths.ts` 新增 `m4bDir(title)`。

6. **`src/tui/actions/pipeline.ts`**
   - 將 merge → convert 兩步替換為單一「生成 M4B」步：
     爬取 → TTS(all) → M4B → 備份。

7. **`src/tui/books.ts` / status**
   - 新增輕量 `m4b` 欄位（掃 `m4b/` 卷數）於狀態檢視顯示。

## 書籍資訊與封面

- `album` = 資料夾名（書名）；`artist` 預設 `KinetiText TTS`；`track` = 卷號；
  卷檔層級 `title` = `<書名> 第N卷`；章節層級 `title` 由 `parseChapterTitle` 取得。
- 若 `output/<書>/cover.jpg` 或 `cover.png` 存在則自動嵌封面，否則略過。不額外抓取。

## 錯誤處理

- 沿用 `RetryService` 重試暫時性 ffmpeg 錯誤。
- 逐卷失敗各自記錄並計入報告失敗數，不中斷其餘卷。
- 空 `audio/`、找不到書、找不到輸入目錄 → 明確中文錯誤訊息。
- `--dry-run`：列出分卷數、每卷章數與預估時長，不執行 ffmpeg。

## 測試（unit 為主）

- `parseChapterTitle`：標準檔名、無 `第N章`、含特殊字元、無 `NNNN - ` 前綴等邊界。
- `buildFFMetadata`：累計起訖正確、TIMEBASE、章節標題跳脫、書籍欄位。
- `buildM4BCommand`：參數陣列（有/無封面、bitrate 邊界與越界拋錯）。
- `M4BBuilderService`：注入假 shell executor，驗分卷數、每卷呼叫一次、失敗隔離。

## 不做（YAGNI）

- 不抓線上封面、不新增 metadata.json schema（以資料夾名推導）。
- 不修改 merge / convert / MP4 既有程式碼與測試。
- 不做整本單檔（已選分卷）。
- 章節起訖以 music-metadata 浮點時長累計（導覽足夠精準），不另跑 ffprobe 校正。
