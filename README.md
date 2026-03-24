# KinetiText

KinetiText 是一個基於 Bun & TypeScript 開發的模組化小說爬蟲系統。它支援高性能併發爬取、智慧浮水印清除、語音書（TTS）生成以及多點雲端備份。

## 🚀 快速開始

### 1. 安裝環境
確保您的系統已安裝 [Bun](https://bun.sh)。

```bash
bun install
```

### 2. 開始爬取小說
目前支援 8novel / wfxs / xsw / czbooks / hjwzw / twkan / uukanshu（依 URL 自動選擇 Adapter）。

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
bun run start <URL> --dry-run
```

執行完成後會額外輸出：
- `run_report.json`: 結構化執行報告（成功/失敗/耗時/完整性檢查）。
- `failed_chapters.json`: 抓取失敗章節清單（若有失敗時），可用於後續補抓。

目前 crawler 已內建：
- 站點級資源配置（不同 adapter 可限制自己的併發與請求間隔）。
- anti-bot / challenge 頁偵測與重試。
- Puppeteer page pool 與 axios session/cookie 重用，以降低長篇抓取成本。

### 1.5. ⏱ Adapter 效能分析 (Profile)
快速量測單一站點 adapter 的 metadata、章節列表，以及抽樣章節抓取耗時。

```bash
bun run profile "https://www.8novel.com/novelbooks/12345/"
bun run profile "https://twkan.com/book/123.html" --samples=5
bun run profile "https://twkan.com/book/123.html" --samples=5 --json
```

參數說明：
- `--samples=N`: 抽樣抓取的章節數量，預設為 `3`。
- `--json`: 以 JSON 輸出 profiling 結果，方便後續分析或存檔。

### 2. 🧹 智慧內容清理 (Noise Cleanup)
用於清除已存檔小說中的網站浮水印、廣告文字或干擾項。

```bash
# 自動識別所有書籍的來源並進行清理 (推薦)
bun run clean

# 指令語法: bun run clean [siteId] [小說名稱]
bun run clean 8novel "小說名稱"
bun run clean --dry-run
```

### 2.5. 🔁 失敗章節補抓 (Retry Failed)
依據 `output/<書名>/failed_chapters.json` 重試抓取失敗章節，成功後會覆寫章節檔，並更新失敗清單。

```bash
bun run retry-failed "小說名稱"
bun run retry-failed "小說名稱" --dry-run
```

### 3. ✂️ 批次標題結尾清理 (File Cleanup)
專門用於大量移除文件開頭重複的「標題」以及特定的「網頁導覽尾綴」。適合處理爬取後格式不整齊的 txt 文件。

```bash
# 指令語法: bun run clean-files <資料夾路徑> [自定義尾綴]
bun run clean-files "output/小說名稱/txt" "自定義結尾文字"
bun run clean-files "output/小說名稱/txt" --dry-run
```

### 4. 🎧 生成語音書 (Audiobook)
使用 Microsoft Edge TTS 技術將小說轉為 MP3 章節音檔。

```bash
# 基本用法 (預設為前 50 章，不合併)
bun run audiobook "小說名稱"

# 進階用法：指定範圍、語速、音量、併發數以及「是否合併」
# 語法: bun run audiobook <書名> [範圍] [語速] [音量] [併發數] [是否合併]
bun run audiobook "小說名稱" 1-100 +0% +50% 5 true
bun run audiobook "小說名稱" 1-50 +0% +0% 3 false --dry-run
```
*   **範圍**: `all` (全部), `1-100` (區間), `2,4,10` (特定章節)。
*   **語速**: 如 `+20%`, `-10%`。
*   **音量**: 如 `+50%`, `-20%`。
*   **併發數**: 建議設定在 `5-10` 之間。
*   **是否合併**: 填入 `true` 則會將該次生成的章節合併為單個 MP3。

### 5. 🎵 批次合併 MP3 (Merge MP3)
將大量的小說章節 MP3 檔案按指定數量進行分批合併。例如：每 20 章合併為一個大檔案。

```bash
# 基本用法 (預設每 20 個檔案合併為一檔，合併輸出至小說主目錄)
bun run merge-mp3 "output/小說名稱"

# 進階用法
# 語法: bun run merge-mp3 <目錄> [--size <數量>] [--start <索引>] [--end <索引>] [--force]
bun run merge-mp3 "output/小說名稱" --size 50 --force
bun run merge-mp3 "output/小說名稱" --start 21 --end 100
bun run merge-mp3 "output/小說名稱" --size 50 --dry-run
```
*   **--size**: 指定每幾個檔案合併一次。
*   **--start**: 開始的檔案索引 (預設: 1，即第一個檔案)。
*   **--end**: 結束的檔案索引 (預設: 全部)。
*   **--force**: 強制重新合併，即使輸出檔案已存在。

### 6. 🎬 MP3 轉 MP4 (Video Conversion)
將生成的 MP3 語音書結合封面圖片 (`static/default_cover.png`) 轉換為 MP4 影片，方便上傳至影音平台。

```bash
# 轉換整本書的資料夾 (所有 mp3)
bun run to-mp4 "output/小說名稱"

# 轉換特定的 mp3 檔案
bun run to-mp4 "output/小說名稱/chapter1.mp3"

# 進階用法：調整音量與強制覆蓋
# 語法: bun run to-mp4 <輸入路徑> [輸出名稱] [-v <音量>] [-f]
bun run to-mp4 "output/小說名稱" -v 1.5           # 所有 mp3 音量放大 1.5 倍
bun run to-mp4 "output/小說名稱/chapter1.mp3" -v 5dB   # 單一檔案音量增加 5dB
bun run to-mp4 "output/小說名稱" --force               # 強制重新轉換所有檔案
bun run to-mp4 "output/小說名稱" --dry-run             # 僅預覽轉換計畫
```
> [!NOTE]
> 此功能需要系統預先安裝 `ffmpeg`。

### 7. ☁️ 雲端備份 (Cloud Backup)
使用 `rclone` 將 `output/` 目錄同步至雲端（如 Google Drive, OneDrive 等）。

```bash
bun run backup
bun run backup --dry-run
```
> [!NOTE]
> 需先完成 `rclone config` 設定。備份目的地需在 `scripts/backup.ts` 中配置。

### 8. ✅ 測試 (Tests)

```bash
bun run test
bun run profile --help
```

> [!NOTE]
> CI 會在 `push(master)` 與 `pull_request` 自動執行 `bun test` 與 `bun run start --help` smoke check（見 `.github/workflows/test.yml`）。

---

## 📂 目錄結構

- `src/core/`: 核心引擎與類型定義。
- `src/adapters/`: 站點適配器。
- `src/profiling/`: adapter profiling 與效能量測工具。
- `src/utils/`: 工具類（含 `ContentCleaner.ts` 浮水印邏輯）。
- `src/storage/`: 存檔邏輯。
- `src/workflows/`: 跨腳本共用流程工具（路徑解析、章節檔案列舉、清理輔助）。
- `src/cli/`: 共用 CLI 旗標與錯誤格式工具。
- `rules/`: 外部化清理規則（`content-cleaner.json`）。
- `output/`: 爬取結果與語音生成存放處。
- `scripts/`: 所有的工具指令腳本。
- `tests/`: Bun 測試（workflow helpers 與清理邏輯）。

---

## 🛠 開發者手冊

### 如何增加新的浮水印過濾？
請修改 `rules/content-cleaner.json`。

- `watermarks`: 字串替換規則
- `noisePatterns`: 正則規則（`pattern` + `flags`）

`src/utils/ContentCleaner.ts` 會在執行時載入此規則檔（若讀取失敗會 fallback 到內建預設規則）。

### 如何支援新站點？
1. 實作 `src/adapters/NovelSiteAdapter.ts` 介面。
2. 在 `src/adapters/index.ts` 中註冊新的 Adapter。

若站點有特殊資源需求，建議同時設定：
- `resourceProfile.maxConcurrency`
- `resourceProfile.requestIntervalMs`
- `resourceProfile.postSuccessDelayMs`

---

## 🎧 媒體處理功能 (Phase 2-4)

### Phase 2: MP3 轉換

#### 功能概述
- 支援多格式轉換：WAV, AAC, OGG, FLAC → MP3
- 可配置比特率（預設 128kbps，支援 64k-320k）
- 自動重試失敗的轉換（指數退避）
- 結構化日誌記錄（Pino）

#### 使用範例
```bash
# 生成語音書 MP3
bun run audiobook "小說名稱" 1-50

# 指定比特率（高品質）
AUDIO_BITRATE=192k bun run audiobook "小說名稱"
```

#### 配置選項
| 環境變數 | 預設值 | 說明 |
|---------|--------|------|
| `AUDIO_BITRATE` | 128k | MP3 比特率 (64k-320k) |
| `AUDIO_SAMPLE_RATE` | 44100 | 採樣率 (Hz) |
| `AUDIO_CHANNELS` | 2 | 聲道數 |
| `AUDIO_CONVERT_MAX_CONCURRENCY` | 2 | 並行轉換數 |

---

### Phase 3: 音頻合併與分組

#### 功能概述
- 自動合併多個 MP3 檔案
- 根據目標時長分組（預設 11 小時）
- 時長計算精度 < 1% 誤差
- 支援乾跑預覽（dry-run）
- 中文分組結果報告

#### 使用範例
```bash
# 按時長分組合併（推薦：音頻書）
bun run merge-mp3 \
  --input=/path/to/mp3 \
  --output=/path/to/merged \
  --target=39600 \
  --mode=duration

# 預覽分組結果（不實際執行）
bun run merge-mp3 --input=/path/to/mp3 --dry-run

# 輸出人類可讀報告
bun run merge-mp3 --input=/path/to/mp3 --report=human
```

#### 配置選項
| 環境變數 / 參數 | 預設值 | 說明 |
|----------------|--------|------|
| `--target` | 39600 | 目標時長（秒，或 11h / 660m 格式） |
| `--tolerance` | 10 | 容差百分比 |
| `--mode` | count | `count`（按數量）或 `duration`（按時長） |
| `--report` | - | 報告格式：`json` 或 `human` |
| `--dry-run` | - | 預覽模式，不實際執行 |
| `AUDIO_MERGE_TARGET_DURATION` | 39600 | 環境變數：目標時長（秒） |
| `AUDIO_MERGE_TOLERANCE_PERCENT` | 10 | 環境變數：容差百分比 |

---

### Phase 4: MP4（M4A）轉換

#### 功能概述
- 將 MP3 轉換為 M4A（AAC 音頻 MP4 容器）
- 支援元資料嵌入（title, artist, album）
- AAC 編碼，比 MP3 更高效
- 批量轉換支援

#### 使用範例
```bash
# 批量轉換 MP3 → M4A
bun run to-mp4 \
  --input=/path/to/merged_mp3 \
  --output=/path/to/m4a \
  --metadata=/path/to/metadata.json \
  --dry-run

# 高品質轉換
MP4_BITRATE=320k bun run to-mp4 --input=... --output=...
```

#### 元資料 JSON 格式
```json
{
  "merged_001.mp3": {
    "title": "第一部分",
    "artist": "作者名",
    "album": "書籍名"
  },
  "merged_002.mp3": {
    "title": "第二部分",
    "artist": "作者名",
    "album": "書籍名"
  }
}
```

#### 配置選項
| 環境變數 | 預設值 | 說明 |
|---------|--------|------|
| `MP4_BITRATE` | 256k | AAC 比特率 (96k-320k) |
| `MP4_FORMAT` | m4a | 輸出格式 |
| `MP4_MAX_CONCURRENCY` | 2 | 並行轉換數 |
| `MP4_INCLUDE_METADATA` | true | 嵌入元資料 |

---

## 🔄 完整工作流程：從小說到音頻書

```bash
# 步驟 1: 爬取小說
bun run start "https://www.8novel.com/novelbooks/12345/"

# 步驟 2: 生成 MP3 章節（使用 Edge TTS）
bun run audiobook "小說名稱" 1-200

# 步驟 3: 按 11 小時分組合併
bun run merge-mp3 \
  --input=output/小說名稱/mp3 \
  --output=output/小說名稱/merged \
  --target=39600 \
  --mode=duration

# 步驟 4: 轉換為 M4A（附元資料）
bun run to-mp4 \
  --input=output/小說名稱/merged \
  --output=output/小說名稱/m4a \
  --metadata=output/小說名稱/metadata.json

# 步驟 5: 上傳到雲端
bun run backup
```

---

## 🔧 完整指令列表

| 指令 | 功能 | Phase |
|------|------|-------|
| `bun run start <URL>` | 爬取小說 | 核心 |
| `bun run profile <URL>` | 效能分析 | 核心 |
| `bun run clean` | 清理浮水印 | 核心 |
| `bun run retry-failed <書名>` | 重試失敗章節 | Phase 1 |
| `bun run clean-files <目錄>` | 批次清理檔案 | 核心 |
| `bun run audiobook <書名>` | 生成 MP3 語音書 | Phase 2 |
| `bun run merge-mp3 --input=<目錄>` | 合併 MP3（按數量） | Phase 3 |
| `bun run merge-mp3 --input=<目錄> --mode=duration` | 合併 MP3（按時長） | Phase 3 |
| `bun run to-mp4 --input=<目錄>` | 轉換為 M4A | Phase 4 |
| `bun run backup` | 雲端備份 | 核心 |
| `bun run test` | 執行測試 | 開發 |

---

## 📚 完整文檔導覽

- [API 參考](docs/API.md) - 所有服務類的完整 API 說明
- [配置指南](docs/CONFIGURATION.md) - 環境變數與配置選項
- [故障排查](docs/TROUBLESHOOTING.md) - 常見問題與解決方案

## 📦 需求

- [Bun](https://bun.sh) >= 1.0
- [FFmpeg](https://ffmpeg.org) (Phase 2-4 需要)
- Node.js 相容環境（Bun 支援）

### 安裝 FFmpeg
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows
choco install ffmpeg
```
