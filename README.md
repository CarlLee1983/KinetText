# KinetiText

KinetiText 是一個基於 Bun & TypeScript 開發的模組化小說爬蟲系統。它支援高性能併發爬取、智慧浮水印清除、語音書（TTS）生成以及多點雲端備份。

## 🚀 快速開始

### 1. 安裝環境
確保您的系統已安裝 [Bun](https://bun.sh)。

```bash
bun install
```

### 2. 開始爬取小說
目前支援 8novel / wfxs / xsw / czbooks（依 URL 自動選擇 Adapter）。

```bash
bun run start "https://www.8novel.com/novelbooks/12345/"
bun run start --help
```

---

## 🛠 全指令功能說明

本專案提供了一系列的工具腳本，協助您從小說爬取到影音製作的完整流程。

### 1. 🕷 小說爬取 (Crawler)
核心爬取引擎，負責下載章節內容並存為純文字檔。

```bash
bun run start <URL>
bun run start --help
```

### 2. 🧹 智慧內容清理 (Noise Cleanup)
用於清除已存檔小說中的網站浮水印、廣告文字或干擾項。

```bash
# 自動識別所有書籍的來源並進行清理 (推薦)
bun run clean

# 指令語法: bun run clean [siteId] [小說名稱]
bun run clean 8novel "小說名稱"
```

### 3. ✂️ 批次標題結尾清理 (File Cleanup)
專門用於大量移除文件開頭重複的「標題」以及特定的「網頁導覽尾綴」。適合處理爬取後格式不整齊的 txt 文件。

```bash
# 指令語法: bun run clean-files <資料夾路徑> [自定義尾綴]
bun run clean-files "output/小說名稱/txt" "自定義結尾文字"
```

### 4. 🎧 生成語音書 (Audiobook)
使用 Microsoft Edge TTS 技術將小說轉為 MP3 章節音檔。

```bash
# 基本用法 (預設為前 50 章，不合併)
bun run audiobook "小說名稱"

# 進階用法：指定範圍、語速、併發數以及「是否合併」
# 語法: bun run audiobook <書名> [範圍] [語速] [併發數] [是否合併]
bun run audiobook "小說名稱" 1-100 +0% 5 true
```
*   **範圍**: `all` (全部), `1-100` (區間), `2,4,10` (特定章節)。
*   **語速**: 如 `+20%`, `-10%`。
*   **併發數**: 建議設定在 `5-10` 之間。
*   **是否合併**: 填入 `true` 則會將該次生成的章節合併為單個 MP3。

### 5. 🎵 批次合併 MP3 (Merge MP3)
將大量的小說章節 MP3 檔案按指定數量進行分批合併。例如：每 20 章合併為一個大檔案。

```bash
# 基本用法 (預設每 20 個檔案合併為一檔)
bun run merge-mp3 "output/小說名稱/audio"

# 進階用法
# 語法: bun run merge-mp3 <目錄> --size <數量> [--force]
bun run merge-mp3 "output/小說名稱/audio" --size 50 --force
```
*   **--size**: 指定每幾個檔案合併一次。
*   **--force**: 強制重新合併，即使輸出檔案已存在。

### 6. 🎬 MP3 轉 MP4 (Video Conversion)
將生成的 MP3 語音書結合封面圖片 (`static/default_cover.png`) 轉換為 MP4 影片，方便上傳至影音平台。

```bash
# 轉換整本書的資料夾 (所有 mp3)
bun run to-mp4 "output/小說名稱"

# 轉換特定的 mp3 檔案
bun run to-mp4 "output/小說名稱/chapter1.mp3"
```
> [!NOTE]
> 此功能需要系統預先安裝 `ffmpeg`。

### 7. ☁️ 雲端備份 (Cloud Backup)
使用 `rclone` 將 `output/` 目錄同步至雲端（如 Google Drive, OneDrive 等）。

```bash
bun run backup
```
> [!NOTE]
> 需先完成 `rclone config` 設定。備份目的地需在 `scripts/backup.ts` 中配置。

### 8. ✅ 測試 (Tests)

```bash
bun run test
```

> [!NOTE]
> CI 會在 `push(master)` 與 `pull_request` 自動執行 `bun test` 與 `bun run start --help` smoke check（見 `.github/workflows/test.yml`）。

---

## 📂 目錄結構

- `src/core/`: 核心引擎與類型定義。
- `src/adapters/`: 站點適配器。
- `src/utils/`: 工具類（含 `ContentCleaner.ts` 浮水印邏輯）。
- `src/storage/`: 存檔邏輯。
- `src/workflows/`: 跨腳本共用流程工具（路徑解析、章節檔案列舉、清理輔助）。
- `output/`: 爬取結果與語音生成存放處。
- `scripts/`: 所有的工具指令腳本。
- `tests/`: Bun 測試（workflow helpers 與清理邏輯）。

---

## 🛠 開發者手冊

### 如何增加新的浮水印過濾？
請直接修改 `src/utils/ContentCleaner.ts` 中的 `watermarks` 或 `noiseRegexes` 配置。

### 如何支援新站點？
1. 實作 `src/adapters/NovelSiteAdapter.ts` 介面。
2. 在 `src/index.ts` 中註冊新的 Adapter。
