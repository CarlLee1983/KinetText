# KinetiText

KinetiText 是一個基於 Bun & TypeScript 開發的模組化小說爬蟲系統。它支援高性能併發爬取、智慧浮水印清除、語音書（TTS）生成以及多點雲端備份。

## 🚀 快速開始

### 1. 安裝環境
確保您的系統已安裝 [Bun](https://bun.sh)。

```bash
bun install
```

### 2. 開始爬取小說
目前預設支援 8novel 站點。

```bash
bun run start
# 接著依照提示輸入小說 URL 即可
```

---

## 🛠 指令語法說明

### 🧹 內容清理 (Noise Cleanup)
用於清除已存檔小說中的網站浮水印、廣告文字或干擾項。

```bash
# 自動識別所有書籍的來源並進行清理 (推薦)
bun run clean

# 強制指定站點規則處理所有書籍
bun run clean 8novel

# 指定特定站點規則處理特定書籍
bun run clean 8novel "小說名稱"
```
> [!TIP]
> 腳本會優先讀取書籍目錄下 `metadata.txt` 中的 `Source` 欄位來決定清理規則。

### 🎧 生成語音書 (Audiobook)
使用 Microsoft Edge TTS 技術將小說轉為 MP3。

```bash
# 基本用法 (預設不合併，僅生成章節音檔)
bun run audiobook "小說名稱"

# 進階用法：指定範圍、語速、併發數以及「是否合併」
# 語法: bun run audiobook <書名> [範圍] [語速] [併發數] [是否合併]
bun run audiobook "小說名稱" 1-100 +0% 5 true
```
*   **範圍**: `all` (全部), `5` (前5章), `10-20` (區間), `2,4,10` (特定章節)。
*   **語速**: 如 `+20%`, `-10%`。
*   **是否合併**: 填入 `true` 才會執行合併。
*   **分段合併**: 如果您指定了範圍（如 `1-100`）並開啟合併，檔名會自動加上後綴，例如 `小說名稱_1-100.mp3`。

### ☁️ 雲端備份 (Cloud Backup)
使用 `rclone` 將 `output/` 目錄同步至遠端儲存。

```bash
bun run backup
```
> [!NOTE]
> 需先在系統中完成 `rclone config` 設定。備份點位可在 `scripts/backup.ts` 中調整。

---

## 📂 目錄結構

- `src/core/`: 核心引擎與類型定義。
- `src/adapters/`: 站點適配器（如 `EightNovelAdapter.ts`）。
- `src/utils/`: 工具類（如 `ContentCleaner.ts` 負責浮水印邏輯）。
- `src/storage/`: 存檔邏輯（純文字儲存）。
- `output/`: 爬取結果存放處。
  - `[小說名]/metadata.txt`: 書籍元數據（含來源站點資訊）。
  - `[小說名]/txt/`: 各章節原始文字檔。
  - `[小說名]/audio/`: 生成的章節音檔。
  - `[小說名]/[小說名].mp3`: 合併後的完整語音書。

---

## 🛠 開發者手冊

### 如何增加新的浮水印過濾？
請直接修改 `src/utils/ContentCleaner.ts` 中的 `watermarks` 或 `noiseRegexes` 對應站點的配置資訊。

### 如何支援新站點？
1. 實作 `src/adapters/NovelSiteAdapter.ts` 介面。
2. 在 `src/index.ts` 中註冊新的 Adapter。
