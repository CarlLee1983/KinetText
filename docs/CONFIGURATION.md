# KinetiText 配置指南

本文檔說明所有可配置的選項、環境變數及其預設值。Bun 原生支援自動載入 `.env` 檔案，無需額外套件。

## 快速開始

**1. 複製 `.env.example` 到 `.env`（若有）**:
```bash
cp .env.example .env
```

**2. 編輯 `.env` 設置偏好值**:
```bash
# 使用任何文字編輯器
nano .env
# 或
code .env
```

**3. 執行應用程式時自動載入**:
```bash
bun run audiobook "小說名稱"
# .env 中的環境變數會自動套用
```

> **提示**: Bun 執行時會自動讀取專案根目錄的 `.env` 檔案，無需手動載入。

---

## 環境變數完整參考

### Phase 1: 重試機制

控制所有服務的自動重試行為。

| 變數名稱 | 預設值 | 範圍 | 說明 |
|---------|--------|------|------|
| `RETRY_MAX_ATTEMPTS` | 3 | 1-10 | 最大重試次數 |
| `RETRY_BASE_DELAY_MS` | 100 | 1-1000 | 初始延遲（毫秒） |
| `RETRY_MAX_DELAY_MS` | 10000 | 1000-60000 | 最大延遲（毫秒） |
| `RETRY_BACKOFF_MULTIPLIER` | 2 | 1.5-3 | 指數退避倍數 |
| `RETRY_JITTER_ENABLED` | true | true/false | 啟用隨機抖動 |

**延遲計算**:
```
延遲 = min(baseDelay × multiplier^attempt, maxDelay) + random(0, jitter)
```

**範例場景**:
- 預設（`RETRY_MAX_ATTEMPTS=3`）：約 0.1s → 0.2s → 0.4s 共 3 次重試
- 寬鬆（`RETRY_MAX_ATTEMPTS=5`，`RETRY_BASE_DELAY_MS=200`）：更多重試、更長間隔

```bash
# .env 範例
RETRY_MAX_ATTEMPTS=5
RETRY_BASE_DELAY_MS=200
RETRY_MAX_DELAY_MS=30000
RETRY_BACKOFF_MULTIPLIER=2
RETRY_JITTER_ENABLED=true
```

---

### Phase 2: 音頻轉換

控制 WAV/AAC/OGG/FLAC → MP3 的轉換行為。

| 變數名稱 | 預設值 | 範圍 | 說明 |
|---------|--------|------|------|
| `AUDIO_BITRATE` | 128k | 64k-320k | MP3 比特率 |
| `AUDIO_SAMPLE_RATE` | 44100 | 8000-48000 | 採樣率 (Hz) |
| `AUDIO_CHANNELS` | 2 | 1-2 | 聲道數（1=單聲道，2=立體聲） |
| `AUDIO_FORMAT` | mp3 | mp3 | 輸出格式 |
| `AUDIO_CONVERT_MAX_CONCURRENCY` | 2 | 1-8 | 並行轉換數 |

**比特率品質對比**:

| 比特率 | 品質 | 每分鐘大小 | 適用場景 |
|--------|------|-----------|---------|
| 64k | 低 | ~0.5 MB | 語音、節省空間 |
| 128k | 標準 | ~1.0 MB | 一般語音書 |
| 192k | 高 | ~1.5 MB | 高品質語音書 |
| 256k | 很高 | ~2.0 MB | 音樂 |
| 320k | 最高 | ~2.5 MB | 專業音樂 |

**並行度建議**:
- 1 vCPU：`AUDIO_CONVERT_MAX_CONCURRENCY=1`
- 4 vCPU：`AUDIO_CONVERT_MAX_CONCURRENCY=4`
- 8 vCPU：`AUDIO_CONVERT_MAX_CONCURRENCY=6`（建議留餘量）

```bash
# .env 範例（均衡設置）
AUDIO_BITRATE=192k
AUDIO_SAMPLE_RATE=44100
AUDIO_CHANNELS=2
AUDIO_CONVERT_MAX_CONCURRENCY=4
```

---

### Phase 3: 音頻合併

控制 MP3 合併分組行為。

| 變數名稱 | 預設值 | 範圍 | 說明 |
|---------|--------|------|------|
| `AUDIO_MERGE_TARGET_DURATION` | 39600 | 1800-86400 | 目標時長（秒） |
| `AUDIO_MERGE_TOLERANCE_PERCENT` | 10 | 1-50 | 容差百分比 |
| `AUDIO_MERGE_MAX_CONCURRENCY` | 2 | 1-8 | 並行讀取數 |

**時長參照**:

| 秒數 | 時長 | 適用場景 |
|------|------|---------|
| 3600 | 1 小時 | 短篇合集 |
| 7200 | 2 小時 | Podcast 集合 |
| 14400 | 4 小時 | 中篇有聲書 |
| 28800 | 8 小時 | 長篇有聲書（短） |
| 39600 | 11 小時 | 長篇有聲書（預設） |
| 86400 | 24 小時 | 超長合集 |

**容差說明**:
- 容差 10% 表示目標時長的 ±10% 範圍內均可接受
- 例如目標 39600 秒（11 小時），容差 10%：可接受 35640-43560 秒
- 較大容差 = 更靈活的分組；較小容差 = 更精確的時長控制

```bash
# .env 範例
AUDIO_MERGE_TARGET_DURATION=39600
AUDIO_MERGE_TOLERANCE_PERCENT=10
AUDIO_MERGE_MAX_CONCURRENCY=2
```

也可透過 CLI 參數覆蓋（優先於環境變數）：
```bash
bun run merge-mp3 --input=... --target=11h --tolerance=15
```

---

### Phase 4: MP4 轉換

控制 MP3 → M4A（AAC）轉換行為。

| 變數名稱 | 預設值 | 範圍 | 說明 |
|---------|--------|------|------|
| `MP4_BITRATE` | 256k | 96k-320k | AAC 比特率 |
| `MP4_FORMAT` | m4a | m4a | 輸出格式 |
| `MP4_MAX_CONCURRENCY` | 2 | 1-8 | 並行轉換數 |
| `MP4_INCLUDE_METADATA` | true | true/false | 嵌入元資料標籤 |

**AAC vs MP3 效率對比**:

| AAC 比特率 | 等效 MP3 品質 | 說明 |
|-----------|-------------|------|
| 96k | ~128k MP3 | 可接受品質，節省空間 |
| 192k | ~256k MP3 | 高品質，推薦語音書 |
| 256k | ~320k MP3 | 很高品質（預設） |
| 320k | >320k MP3 | 最高品質 |

```bash
# .env 範例（高品質）
MP4_BITRATE=256k
MP4_FORMAT=m4a
MP4_MAX_CONCURRENCY=2
MP4_INCLUDE_METADATA=true
```

---

## 完整 .env 範例

複製以下內容到 `.env` 並依需求修改：

```bash
# ================================================
# KinetiText 環境變數配置
# ================================================

# --- Phase 1: 重試機制 ---
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY_MS=100
RETRY_MAX_DELAY_MS=10000
RETRY_BACKOFF_MULTIPLIER=2
RETRY_JITTER_ENABLED=true

# --- Phase 2: 音頻轉換 ---
AUDIO_BITRATE=128k
AUDIO_SAMPLE_RATE=44100
AUDIO_CHANNELS=2
AUDIO_CONVERT_MAX_CONCURRENCY=2

# --- Phase 3: 音頻合併 ---
AUDIO_MERGE_TARGET_DURATION=39600
AUDIO_MERGE_TOLERANCE_PERCENT=10
AUDIO_MERGE_MAX_CONCURRENCY=2

# --- Phase 4: MP4 轉換 ---
MP4_BITRATE=256k
MP4_FORMAT=m4a
MP4_MAX_CONCURRENCY=2
MP4_INCLUDE_METADATA=true
```

---

## 運行時環境變數覆蓋

可在執行命令時直接覆蓋環境變數（優先於 `.env`）：

```bash
# 單次高品質轉換
AUDIO_BITRATE=256k bun run audiobook "小說名稱"

# 增加重試次數
RETRY_MAX_ATTEMPTS=5 bun run start "https://example.com/novel"

# 低並行度（穩定性優先）
AUDIO_CONVERT_MAX_CONCURRENCY=1 bun run audiobook "小說名稱"

# 自訂目標時長（8 小時）
AUDIO_MERGE_TARGET_DURATION=28800 bun run merge-mp3 --input=...
```

---

## 常見配置場景

### 1. 快速處理（低品質，速度優先）
```bash
AUDIO_BITRATE=64k
AUDIO_CONVERT_MAX_CONCURRENCY=8
AUDIO_MERGE_TOLERANCE_PERCENT=20
MP4_BITRATE=96k
MP4_MAX_CONCURRENCY=4
```

### 2. 標準品質（均衡，適合大多數用例）
```bash
AUDIO_BITRATE=128k
AUDIO_CONVERT_MAX_CONCURRENCY=4
AUDIO_MERGE_TARGET_DURATION=39600
AUDIO_MERGE_TOLERANCE_PERCENT=10
MP4_BITRATE=192k
MP4_MAX_CONCURRENCY=2
```

### 3. 高品質（品質優先，處理較慢）
```bash
AUDIO_BITRATE=256k
AUDIO_CONVERT_MAX_CONCURRENCY=2
AUDIO_MERGE_TOLERANCE_PERCENT=5
MP4_BITRATE=320k
MP4_MAX_CONCURRENCY=1
```

### 4. 穩定處理（高重試，低並行，適合不穩定網路）
```bash
RETRY_MAX_ATTEMPTS=7
RETRY_BASE_DELAY_MS=500
RETRY_MAX_DELAY_MS=60000
AUDIO_CONVERT_MAX_CONCURRENCY=1
AUDIO_MERGE_MAX_CONCURRENCY=1
MP4_MAX_CONCURRENCY=1
```

### 5. 音頻書 Podcast 集合（每集 2 小時）
```bash
AUDIO_BITRATE=128k
AUDIO_MERGE_TARGET_DURATION=7200
AUDIO_MERGE_TOLERANCE_PERCENT=15
MP4_BITRATE=192k
```

---

## 驗證配置

確認環境變數已正確載入：

```bash
# 乾跑模式查看配置
bun run audiobook "測試" --dry-run

# 查看日誌輸出中的配置值
bun run start --help
```

配置值會在日誌的初始化階段顯示。

---

## 重設為預設值

### 方法 1：刪除 .env 檔案
```bash
rm .env
```

### 方法 2：註解掉特定變數
```bash
# AUDIO_BITRATE=256k
AUDIO_BITRATE=128k  # 改回預設值
```

### 方法 3：使用空字串（部分變數）
```bash
RETRY_MAX_ATTEMPTS=
# 此時會使用程式碼中的預設值
```

---

## 配置優先級

環境變數的讀取優先順序（由高到低）：

1. **命令行直接設置**（`KEY=VALUE bun run ...`）
2. **`.env` 檔案**（專案根目錄）
3. **程式碼預設值**

---

> 詳細 API 說明請參閱 [API.md](API.md)。
> 常見問題解決請參閱 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。
