# KinetiText 架構文檔

**版本**: v1.1 (Milestone 2)
**最後更新**: 2026-03-26
**維護者**: Carl

---

## 目錄

- [第 1 章: 系統概覽](#第-1-章-系統概覽)
- [第 2 章: 核心模組設計](#第-2-章-核心模組設計)
- [第 3 章: 音頻處理管線 (Milestone 1)](#第-3-章-音頻處理管線-milestone-1)
- [第 4 章: 重試機制設計](#第-4-章-重試機制設計)
- [第 5 章: 測試策略](#第-5-章-測試策略)
- [第 6 章: Bun-Go 混用優化架構 (Milestone 2)](#第-6-章-bun-go-混用優化架構-milestone-2)

---

## 第 1 章: 系統概覽

KinetiText 是一個模組化且可擴展的網路爬蟲系統，專注於小說與書籍內容抓取，並支援音頻書（TTS）生成。

### 1.1 設計原則

- **模組化設計**: 核心引擎、適配器（Adapter）、儲存層（Storage）三層分離
- **高並發安全**: p-limit 控制並發度，避免目標網站過載
- **彈性擴展**: 新增網站只需實現 `NovelSiteAdapter` 介面
- **不可變性**: 所有配置物件使用 readonly 屬性，禁止直接修改狀態
- **分層架構**: Bun 業務邏輯層 + Go 高效能數據處理層

### 1.2 技術棧

| 層次 | 技術 | 用途 |
|------|------|------|
| 運行時 | Bun 1.3+ | 主要業務邏輯、爬蟲協調 |
| 語言 | TypeScript | 型別安全、可維護性 |
| 爬蟲 | axios + cheerio | HTTP 請求、HTML 解析 |
| 並發 | p-limit | 並發數量控制 |
| 編碼 | iconv-lite | 繁體中文/Big5 支持 |
| 音頻 | FFmpeg + music-metadata | 格式轉換、元數據讀取 |
| Go 層 | ffmpeg-go | 高效能 FFmpeg binding |
| 日誌 | pino | 結構化 JSON 日誌 |
| 重試 | p-retry | 瞬時錯誤指數退避 |

---

## 第 2 章: 核心模組設計

### 2.1 目錄結構

```
src/
├── core/
│   ├── CrawlerEngine.ts          - 主爬蟲引擎（協調調度）
│   ├── services/
│   │   ├── AudioConvertService.ts   - 音頻轉換服務（支持 Go 後端）
│   │   ├── AudioConvertGoWrapper.ts - Go 子進程 IPC 包裝層
│   │   ├── AudioMergeService.ts     - 音頻合併服務
│   │   ├── DurationService.ts       - 音頻時長提取服務
│   │   ├── RetryService.ts          - 重試與指數退避服務
│   │   ├── ErrorClassifier.ts       - 錯誤分類（瞬時 vs 永久）
│   │   └── AudioErrorClassifier.ts  - 音頻特化錯誤分類
│   ├── types/
│   │   └── audio.ts              - 音頻相關型別定義
│   └── utils/
│       └── logger.ts             - Pino 日誌工廠
├── adapters/                     - 網站特化 Adapter 實現
├── config/
│   ├── AudioConvertConfig.ts     - 音頻轉換配置（含 Go 後端選項）
│   ├── AudioConvertGoConfig.ts   - Go 後端特化配置
│   ├── RetryConfig.ts            - 重試策略配置
│   └── defaults.ts               - 預設值常數
├── storage/                      - 儲存適配器
└── tests/
    ├── unit/                     - 單元測試
    ├── integration/              - 集成測試
    └── e2e/                      - E2E 端對端測試
```

### 2.2 CrawlerEngine 主引擎

```
CrawlerEngine
├── fetchMetadata()     - 獲取小說元數據（標題、作者、章節列表）
├── fetchChapterList()  - 獲取章節 URL 列表
├── downloadChapters()  - 並發下載章節內容（p-limit）
├── processAudio()      - 協調音頻轉換管線
└── CrawlerConfig API   - 支持 number | CrawlerConfig 向後相容
```

---

## 第 3 章: 音頻處理管線 (Milestone 1)

### 3.1 完整音頻流程

```
原始音頻文件（WAV/AAC/OGG/FLAC）
        │
        ▼
AudioConvertService.convertToMp3()
  ├─ RetryService（指數退避，最多 4 次）
  ├─ AudioErrorClassifier（瞬時 vs 永久錯誤分類）
  └─ [Bun 後端] FFmpeg subprocess → MP3
     [Go 後端]  AudioConvertGoWrapper → kinetitext-audio → FFmpeg → MP3
        │
        ▼
DurationService.getDuration()
  └─ music-metadata parseFile → 時長（秒）
        │
        ▼
AudioMergeService.mergeBatch()
  ├─ 按目標時長分組（e.g. 11 小時）
  ├─ p-limit 並行讀取時長
  └─ FFmpeg concat → 合併 MP3
        │
        ▼
MP4ConversionService.convert()
  └─ FFmpeg → M4A/MP4（帶封面、元數據）
```

### 3.2 音頻類型支持

| 輸入格式 | 說明 | FFmpeg 解碼器 |
|---------|------|--------------|
| WAV | 無損 PCM | pcm_s16le |
| AAC | 有損壓縮 | aac |
| OGG | 有損（Vorbis） | libvorbis |
| FLAC | 無損壓縮 | flac |
| MP3 | 有損壓縮 | libmp3lame |

---

## 第 4 章: 重試機制設計

### 4.1 RetryService 架構

```
RetryService
├── execute(fn, operationId)
│   ├─ 最多 N 次嘗試（預設 4 次）
│   ├─ 指數退避（初始 100ms，乘數 2.0）
│   ├─ 加入隨機抖動（防雷鳴群效應）
│   └─ Pino 結構化日誌（每次嘗試、成功、失敗）
│
├── ErrorClassifier（可注入）
│   ├─ isTransient(error) → boolean
│   └─ isPermanent(error) → boolean
│
└── BackoffCalculator
    └─ calculateDelay(attempt) → ms（指數退避 + jitter）
```

### 4.2 錯誤分類策略

| 錯誤類型 | 分類 | 行為 |
|---------|------|------|
| ENOENT（文件不存在） | 瞬時 | 重試（文件可能延遲寫入） |
| EAGAIN（資源暫時不可用） | 瞬時 | 重試 |
| Network timeout | 瞬時 | 重試 |
| FFmpeg exit 254 | 瞬時（可能） | 重試 |
| EINVAL（無效輸入） | 永久 | 快速失敗 |
| 格式不支持 | 永久 | 快速失敗 |

---

## 第 5 章: 測試策略

### 5.1 測試層次

| 層次 | 框架 | 覆蓋範圍 | 數量 |
|------|------|---------|------|
| 單元測試 | bun:test | 函數、類、配置 | 374+ |
| 集成測試 | bun:test + FFmpeg | 服務集成、Go IPC | 63+ |
| E2E 測試 | bun:test + FFmpeg | 完整音頻轉換流程 | 59+ |

### 5.2 E2E 測試覆蓋

- Phase 2: `AudioConversion.e2e.ts` — WAV/AAC/OGG/FLAC → MP3
- Phase 3: `AudioMerging.e2e.ts` — 批次合併、時長分組
- Phase 4: `MP4Conversion.e2e.ts` — M4A/MP4 轉換
- Phase 5: `FullPipeline.e2e.ts` — 完整管道 E2E
- Phase 6: `AudioConvertGo.e2e.ts` — Go 後端 E2E

---

## 第 6 章: Bun-Go 混用優化架構 (Milestone 2)

### 6.1 總體設計目標

Milestone 2 通過將 CPU 密集的音頻處理操作遷移至 Go，實現整體性能優化，同時保留 Bun 的簡潔業務邏輯。

**核心原則**:
- **分層設計**: Bun 業務邏輯 + Go 高效數據處理
- **鬆耦合**: 通過 JSON IPC 接口隔離兩層
- **可選遷移**: 通過配置標誌 `useGoBackend` 支持漸進遷移
- **優雅降級**: Go 初始化失敗時自動回退 Bun FFmpeg

### 6.2 Bun-Go 邊界定義

```
┌─────────────────────────────────────────────────────────┐
│                    Bun Layer (KinetiText)                 │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  CrawlerEngine                                       │ │
│  │  AudioConvertService (業務協調)                       │ │
│  │  AudioMergeService                                   │ │
│  │  MP4ConversionService                                │ │
│  │  RetryService + ErrorClassifier                      │ │
│  └─────────────────────────────────────────────────────┘ │
│                         │                                 │
│                         │ JSON 請求/回應                   │
│                         ▼                                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  AudioConvertGoWrapper (IPC + 錯誤處理)               │ │
│  │  - stdin JSON 輸入                                   │ │
│  │  - stdout JSON 輸出                                  │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          │
                          │ Bun.spawn subprocess
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Go Layer (kinetitext-go)                 │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  kinetitext-audio 二進制                              │ │
│  │  - JSON stdin 讀取                                   │ │
│  │  - ffmpeg-go 呼叫                                    │ │
│  │  - JSON stdout 輸出                                  │ │
│  └─────────────────────────────────────────────────────┘ │
│                         │                                 │
│                         │ exec() 系統調用                  │
│                         ▼                                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  FFmpeg (系統工具)                                    │ │
│  │  - 音頻格式轉換                                       │ │
│  │  - 管線 I/O 優化                                     │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 6.3 IPC 協議設計

**選擇**: JSON subprocess（而非 Bun FFI.cdef 直接 C binding）

**理由**:
1. **跨平台**: macOS/Linux/Windows 無需特殊編譯配置
2. **穩定性**: 避免 cgo 二進制的不穩定性
3. **除錯性**: JSON 可視化，易於問題排查
4. **隔離性**: 進程隔離，Go panic 不影響 Bun

**JSON 契約**:

請求格式（Bun → Go）:
```json
{
  "input_file": "/path/to/input.wav",
  "output_file": "/path/to/output.mp3",
  "format": "mp3",
  "bitrate": 192
}
```

成功回應格式（Go → Bun）:
```json
{
  "success": true,
  "output_file": "/path/to/output.mp3",
  "duration": 123.45
}
```

錯誤回應格式（Go → Bun）:
```json
{
  "success": false,
  "error": "描述性錯誤信息"
}
```

**支援格式**: `mp3` / `aac` / `ogg` / `flac` / `wav`
**位速率範圍**: 128 - 320 kbps

### 6.4 配置切換機制

**AudioConvertConfig 新增 Go 後端選項**:

```typescript
const config = new AudioConvertConfig({
  useGoBackend: true,                              // 啟用 Go 後端
  goBinaryPath: '../kinetitext-go/bin/kinetitext-audio', // Go 二進制路徑
  goTimeout: 60000,                                // 60 秒超時
  bitrate: '192k',                                 // 192kbps
})
```

**環境變數支持**:

| 環境變數 | 說明 | 預設 |
|---------|------|------|
| `KINETITEXT_USE_GO_AUDIO` | 啟用 Go 後端 | `false` |
| `KINETITEXT_GO_AUDIO_BIN` | Go 二進制路徑 | 自動推導 |
| `AUDIO_GO_TIMEOUT_MS` | Go 超時毫秒數 | `60000` |

**CLI 旗標**:
```bash
bun run src/index.ts --use-go-audio --crawl https://example.com
```

### 6.5 Go 後端初始化流程

```
AudioConvertService.initGoBackend()
        │
        ├─ config.useGoBackend === false?
        │     └─ 直接返回（使用 Bun 後端）
        │
        ├─ config.goBinaryPath 未設定?
        │     └─ 警告日誌 + 使用 Bun 後端
        │
        ├─ Bun.file(binaryPath).exists() === false?
        │     └─ 拋出錯誤 → initGoBackend() catch → 使用 Bun 後端
        │
        └─ 初始化成功
              └─ this.goWrapper = AudioConvertGoWrapper
```

**優雅降級策略**:
- Go 初始化失敗 → 自動降級 Bun FFmpeg，不拋出異常
- Go 轉換失敗 → RetryService 重試，仍使用 Go 後端
- 完全失敗 → 返回錯誤給調用方

### 6.6 錯誤處理與重試策略

**三層錯誤處理**:

```
外層: RetryService.execute()
  ├─ 最多 4 次重試（含指數退避）
  ├─ AudioErrorClassifier 判定錯誤類型
  └─ 永久錯誤（如格式不支持）快速失敗

中層: convertWithGo() 私有方法
  ├─ 呼叫 AudioConvertGoWrapper.convert()
  ├─ 檢驗 response.success === false → 拋出 Error
  └─ 驗證輸出文件存在 → 未創建則拋出 Error

底層: Go 子進程
  ├─ ffmpeg-go 呼叫 FFmpeg
  ├─ FFmpeg 錯誤 → JSON error response
  └─ 進程崩潰 → 非零退出碼 → JSON error response
```

**錯誤分類**:

| 錯誤 | 分類 | 行為 |
|------|------|------|
| Go 二進制不存在 | 初始化失敗 | 降級 Bun（不重試） |
| Go 進程崩潰（非零退出） | 瞬時 | RetryService 重試 |
| FFmpeg 格式不支持 | 永久 | 快速失敗 |
| 文件不存在 | 瞬時 | RetryService 重試 |
| 輸出文件未創建 | 瞬時 | RetryService 重試 |

### 6.7 進程管理模式

**當前實現: 無狀態進程模式**

每次轉換調用啟動新的 Go 子進程:

```
優點:
  - 簡單實現，無連接池維護
  - 進程隔離，Go panic 不影響 Bun
  - 自然支持 fork-exec 並發模型

缺點:
  - Go 運行時啟動開銷 (~50-80ms)
  - 短音頻文件場景下性能略低於直接 Bun FFmpeg

適用場景:
  - 長音頻文件（30-60 分鐘），啟動開銷佔比 < 0.1%
  - 批量轉換（10+ 文件）
```

**未來考量: 常駐進程模式（Phase 7+）**

```
Go HTTP 或 Unix socket 服務端:
  - 消除每次調用的 Go 運行時啟動開銷
  - 長連接復用，零額外 IPC 開銷
  - 需要心跳檢測與進程監控
```

### 6.8 性能基準數據

**測試環境**: macOS 14.2, Apple Silicon M2, 5 秒靜音音頻

| 格式 | Bun 平均 | Go 平均 | 差異 |
|------|---------|--------|------|
| WAV | 120ms | 114ms | Go 快 5% |
| AAC | 74ms | 82ms | Go 慢 10.8% |
| OGG | 77ms | 83ms | Go 慢 7.8% |
| FLAC | 66ms | 109ms | Go 慢 65.2% |

**分析**: 短音頻（5 秒）測試中，Go 運行時啟動開銷（~50-80ms）主導結果。
對於長音頻（30-60 分鐘），預期 Go 後端提升 10-20%（啟動開銷佔比 < 0.1%）。

詳細分析見: `.planning/phases/06-audio-convert-go/PERF_REPORT.md`

### 6.9 測試策略 (Phase 6)

**E2E 測試覆蓋** (`src/tests/e2e/AudioConvertGo.e2e.ts`):

| 場景 | 測試數 | 說明 |
|------|--------|------|
| WAV → MP3 | 2 | 基本轉換驗證 |
| 多格式轉換 | 4 | AAC/OGG/FLAC + 批次 |
| 時長準確性 | 4 | ±1s 容差驗證 |
| 並發穩定性 | 1 | 10 任務, concurrency=4 |
| 錯誤處理 | 2 | 無效輸入、批次容錯 |
| Bun vs Go 品質 | 4 | 一致性對比驗證 |
| **總計** | **17** | 全部通過 |

**集成測試** (`src/tests/integration/`):

- `AudioConvertGo.test.ts` — Go 包裝層 IPC 7 個測試
- `CrawlerEngineWithGo.test.ts` — CrawlerEngine Go 配置 7 個測試

### 6.10 架構決策記錄 (ADR)

| 決策 | 選項 | 選擇 | 理由 |
|------|------|------|------|
| IPC 協議 | JSON subprocess vs FFI.cdef | JSON subprocess | 跨平台穩定性、除錯性 |
| 進程管理 | 無狀態 vs 常駐 | 無狀態 | 簡化實現、隔離性 |
| FFmpeg binding | ffmpeg-go vs ffmpeg-next | ffmpeg-go | API 簡潔、文檔完善 |
| 元數據庫 | go-flac vs ffprobe | go-flac | 純 Go 實現（Phase 7） |
| 降級策略 | 強制 Go vs 優雅降級 | 優雅降級 | 生產可靠性優先 |
| 初始化時機 | 建構子 vs 懶初始化 | 懶初始化 | 避免建構子 async 問題 |

### 6.11 遷移路徑規劃

```
Phase 6: AudioConvertService (當前)
  ├─ 目標: 音頻格式轉換 Go 後端可選
  ├─ 狀態: 完成 ✅
  └─ 成果: AudioConvertGoWrapper + JSON IPC 架構

Phase 7: DurationService (計劃)
  ├─ 目標: 5-10x 元數據讀取速度
  ├─ 方案: go-flac + ffprobe (pure Go)
  └─ 依賴: Phase 6 Go 後端基礎設施複用

Phase 8: MP4ConversionService (計劃)
  ├─ 目標: 30-40% M4A 轉換速度提升
  ├─ 方案: 複用 Phase 6 FFmpeg binding 模式
  └─ 預計: 3-4 天開發
```

---

## 附錄

### A. 相關文檔

- `docs/MIGRATION_GUIDE.md` — Go 後端啟用與遷移指南
- `docs/CONFIGURATION.md` — 完整配置選項說明
- `docs/TROUBLESHOOTING.md` — 故障排查指南
- `docs/API.md` — 完整 API 參考
- `.planning/phases/06-audio-convert-go/PERF_REPORT.md` — 性能基準測試報告

### B. 項目倉庫結構

```
/Users/carl/Dev/Carl/
├── KinetiText/          - 主倉庫（Bun + TypeScript）
└── kinetitext-go/       - Go 倉庫（FFmpeg binding）
    └── bin/
        └── kinetitext-audio  - 編譯後的 Go 二進制
```

### C. 開發環境要求

- Bun 1.0+
- FFmpeg 4.0+（系統安裝）
- Go 1.20+（僅 Go 後端開發需要）
