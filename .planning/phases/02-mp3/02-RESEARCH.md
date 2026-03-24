# Phase 2: MP3 轉換管道 - Research

**Researched:** 2026-03-24
**Domain:** 音頻格式轉換、FFmpeg 整合、Bun 子進程 API
**Confidence:** HIGH

---

## Summary

Phase 2 的核心技術挑戰是：**將 ad-hoc 的 scripts/ 腳本邏輯提升為可測試、可重用的模組化服務**。專案中已有 `scripts/merge_mp3.ts` 和 `scripts/mp3_to_mp4.ts` 兩個使用 `Bun.$` 調用系統 FFmpeg 的工作腳本，但它們是 CLI 腳本而非可組合的服務。Phase 2 的目標是把這些模式提煉為 `src/core/services/AudioConverter.ts` 等可引入、可測試的類別，並整合 Phase 1 的 `RetryService`。

關鍵發現：系統 FFmpeg 8.0.1 已安裝並包含所有必要的編解碼器（libmp3lame, aac, flac, vorbis）。`Bun.$` 是最適合的 FFmpeg 調用方式，比引入 `ffmpeg-simplified` 套件更簡潔、依賴更少，且與現有腳本模式一致。`music-metadata` 11.12.3 用於元數據提取，版本確認為最新。

**Primary recommendation:** 使用 `Bun.$` 直接調用系統 FFmpeg（與現有腳本一致），搭配 `music-metadata` 提取元數據，封裝為可注入 `RetryService` 的 `AudioConvertService` 類別。

---

<user_constraints>
## User Constraints (from CONTEXT.md)

CONTEXT.md 未存在於此 Phase，以下約束來自 STATE.md 已決定事項：

### Locked Decisions
- **Runtime**: Bun 專用，禁止 Node.js / npm / yarn / pnpm
- **FFmpeg 方案**: 系統安裝的 FFmpeg（已確認可用，版本 8.0.1）
- **元數據庫**: `music-metadata`（多格式支援，流式處理）
- **重試庫**: Phase 1 的 `RetryService` + `ErrorClassifier`（已完成，位於 `src/core/services/`）
- **日誌庫**: `pino`（已安裝於 package.json）
- **FFmpeg 調用方式**: `Bun.$`（與現有 scripts/ 模式一致，已驗證有效）
- **禁止**: fluent-ffmpeg（已棄用）、dotenv（Bun 原生支援 .env）

### Claude's Discretion
- AudioConvertService 的具體介面設計
- AudioConvertConfig 的預設值（比特率、採樣率等）
- 並行轉換的 concurrency limit 設定
- 測試夾具的音頻樣本選擇策略

### Deferred Ideas (OUT OF SCOPE)
- Phase 3：音頻合併與分組（雖然 R1.2.2 在需求中，但按 ROADMAP 順序屬 Phase 3）
- Phase 4：MP4 轉換
- 音頻正規化和音量調整（P2 優先級）
- 熔斷器模式（超出 Phase 2 範圍）
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| R1.2.1 | 支援常見輸入格式 (WAV, AAC, OGG, FLAC) 轉換為 MP3；可配置輸出比特率（預設 128kbps）；轉換過程不阻塞其他操作 | FFmpeg 8.0.1 確認支援所有格式；`Bun.$` 非同步調用天然非阻塞；`AudioConvertConfig` 提供比特率配置 |
| R1.2.2 | 計算多個 MP3 總時長；支援可配置目標時長（預設 11 小時）；自動分組使每組接近目標（±10%）；保持順序無縫 | `music-metadata` parseFile 提供準確時長；分組演算法（貪心策略）；FFmpeg concat demuxer 確保無縫連接 |
| R1.2.3 | 提取 MP3 元數據計算總時長；容差檢查（實際 vs 目標）；生成時長報告和分組摘要 | `music-metadata` API 提供 duration 秒數；DurationReport 結構設計；合併後 ffprobe 驗證 |
</phase_requirements>

---

## 1. Executive Summary — 核心技術挑戰

Phase 2 面臨的技術挑戰並非「如何呼叫 FFmpeg」（已有可行模式），而是：

1. **模式提升**：從 CLI 腳本 (`scripts/`) 提煉為可測試服務 (`src/core/services/`)
2. **錯誤語意轉換**：將 FFmpeg 的 exit code / stderr 映射為 `ErrorClassifier` 可理解的 `ErrorCategory`
3. **Phase 1 整合**：讓轉換操作成為 `RetryService.execute()` 的 `AsyncOperation<T>`
4. **不可變配置**：遵循專案的 `RetryConfig` 模式設計 `AudioConvertConfig`
5. **測試策略**：避免在 CI 環境中依賴真實音頻文件

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FFmpeg (system) | 8.0.1 | 音頻格式轉換、合併 | 已安裝，含所有必要 codec（libmp3lame, aac, flac, vorbis） |
| music-metadata | 11.12.3 | 時長提取、元數據解析 | 多格式支援，流式處理，無原生依賴 |
| Bun.$ | built-in | FFmpeg 子進程調用 | 已在 scripts/ 中驗證，Bun 原生 API |
| p-limit | 7.3.0 (已安裝) | 並行轉換 concurrency 控制 | 專案已使用，與 CrawlerEngine 模式一致 |
| pino | 10.3.1 (已安裝) | 結構化日誌 | Phase 1 已整合，統一日誌系統 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| RetryService | Phase 1 | 轉換失敗重試 | 包裝每個 FFmpeg 調用 |
| ErrorClassifier | Phase 1 | 錯誤分類 | 判斷 FFmpeg 錯誤是否可重試 |
| BackoffCalculator | Phase 1 | 退避計算 | 通過 RetryConfig 配置 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bun.$ | ffmpeg-simplified | ffmpeg-simplified 功能更豐富但多一層依賴；Bun.$ 已在 scripts/ 驗證，依賴更少 |
| Bun.$ | fluent-ffmpeg | fluent-ffmpeg 已棄用（2025/05），禁止使用 |
| music-metadata | ffprobe subprocess | ffprobe 無需額外依賴但需要解析 JSON 輸出；music-metadata 更簡潔準確 |

**Installation:**
```bash
bun add music-metadata
# p-limit, pino 已安裝
# FFmpeg 系統已安裝 (8.0.1)
# music-metadata 是唯一新增依賴
```

**Version verification:** (已確認)
```
music-metadata: 11.12.3 (2026-03-24 查詢)
ffmpeg-simplified: 2.1.1 (不使用，僅作參考)
```

---

## 2. FFmpeg Integration — 如何在 Bun 中調用 FFmpeg

### 現有模式（已驗證有效）

專案 `scripts/merge_mp3.ts` 和 `scripts/mp3_to_mp4.ts` 均使用 `Bun.$` 調用系統 FFmpeg。這是專案的標準模式：

```typescript
// Source: scripts/mp3_to_mp4.ts (現有驗證模式)
import { $ } from "bun"

// 格式轉換（WAV/OGG/FLAC/AAC → MP3）
const result = await $`ffmpeg -y -i ${inputPath} -codec:a libmp3lame -b:a 128k ${outputPath}`.quiet()
if (result.exitCode !== 0) {
  throw new Error(`FFmpeg failed with exit code ${result.exitCode}`)
}

// FFmpeg 可用性檢查
await $`ffmpeg -version`.quiet()
```

### 多格式輸入支援

系統 FFmpeg 8.0.1 已確認支援所有必要 codec：
- **libmp3lame** — MP3 編碼（輸出）
- **aac** — AAC 解碼（輸入）
- **flac** — FLAC 解碼（輸入）
- **vorbis** — OGG Vorbis 解碼（輸入）
- WAV — FFmpeg 原生支援（無需額外 codec）

### FFmpeg 比特率配置

```bash
# 標準 MP3 比特率選項
-b:a 64k    # 低質量（語音可接受）
-b:a 128k   # 預設（平衡質量與大小）
-b:a 192k   # 高質量
-b:a 320k   # 最高質量
```

### AudioConvertConfig 設計模式

遵循 `RetryConfig` 的不可變配置模式：

```typescript
// 參考 src/config/RetryConfig.ts 的模式
export class AudioConvertConfig {
  readonly bitrate: string              // 預設 '128k'
  readonly sampleRate: number           // 預設 44100
  readonly outputFormat: 'mp3'          // Phase 2 固定為 mp3
  readonly maxConcurrency: number       // 預設 3（與 CrawlerEngine 一致）
  readonly ffmpegTimeoutMs: number      // 預設 300000 (5 分鐘/檔案)

  static fromEnvironment(): AudioConvertConfig {
    // 讀取 AUDIO_BITRATE, AUDIO_SAMPLE_RATE, AUDIO_MAX_CONCURRENCY 等環境變數
  }
}
```

### Architecture Patterns

#### 推薦目錄結構
```
src/
├── core/
│   ├── services/
│   │   ├── RetryService.ts          # Phase 1 (existing)
│   │   ├── ErrorClassifier.ts       # Phase 1 (existing)
│   │   ├── BackoffCalculator.ts     # Phase 1 (existing)
│   │   └── AudioConvertService.ts   # Phase 2 (new)
│   ├── types/
│   │   ├── errors.ts                # Phase 1 (existing)
│   │   ├── retry.ts                 # Phase 1 (existing)
│   │   └── audio.ts                 # Phase 2 (new) — 轉換結果類型
│   └── utils/
│       └── logger.ts                # Phase 1 (existing) — 擴展 audio logger
├── config/
│   ├── RetryConfig.ts               # Phase 1 (existing)
│   ├── defaults.ts                  # Phase 1 (existing) — 增加 AUDIO 預設值
│   └── AudioConvertConfig.ts        # Phase 2 (new)
└── tests/
    ├── unit/
    │   └── AudioConvertService.test.ts  # Phase 2 (new)
    └── integration/
        └── AudioConversion.test.ts      # Phase 2 (new)
```

---

## 3. Audio Metadata — 如何提取時長與格式資訊

### music-metadata API

```typescript
// Source: music-metadata npm documentation
import { parseFile } from 'music-metadata'

const metadata = await parseFile('audio.mp3')

// 時長（秒數，浮點數）
const durationSeconds: number = metadata.format.duration ?? 0

// 格式資訊
const codec: string = metadata.format.codec ?? 'unknown'  // 'MP3', 'FLAC', 'AAC', etc.
const bitrate: number = metadata.format.bitrate ?? 0       // bits/second
const sampleRate: number = metadata.format.sampleRate ?? 0 // Hz

// 常見元數據
const title: string = metadata.common.title ?? ''
const artist: string = metadata.common.artist ?? ''
```

### 流式處理（大文件優化）

```typescript
// Source: music-metadata 官方文檔
import { parseStream } from 'music-metadata'
import { createReadStream } from 'node:fs'

const stream = createReadStream('large_file.flac')
const metadata = await parseStream(stream, { mimeType: 'audio/flac' })
// 自動關閉 stream
```

### 精度注意事項

music-metadata 從 ID3 / container header 讀取時長，精度依賴標頭中的時長記錄：
- **MP3**: ID3 headers 可能有輕微誤差（< 0.1%），VBR 編碼需要 Xing/VBRI header
- **FLAC / WAV**: 精度最高（從容器規格中直接讀取）
- **AAC / OGG**: 精度高（stts/duration box）

R1.2.3 要求「誤差 < 1%」可由 music-metadata 滿足。

---

## 4. Error Handling — 如何整合 Phase 1 重試邏輯

### FFmpeg 錯誤語意

FFmpeg 的錯誤類型映射到 `ErrorCategory`：

| FFmpeg 錯誤 | ErrorCategory | 可重試 |
|-------------|---------------|--------|
| exit code != 0，stderr 含 "No such file" | PERMANENT | 否 |
| exit code != 0，stderr 含 "Invalid data" | PERMANENT | 否（格式問題） |
| exit code != 0，stderr 含 "Cannot allocate memory" | TRANSIENT | 是 |
| exit code != 0，stderr 含 "broken pipe" | TRANSIENT | 是 |
| Timeout（超過 ffmpegTimeoutMs） | TRANSIENT | 是 |
| exit code = 0 | SUCCESS | — |

### 整合模式

Phase 1 `RetryService` 接受任意 `AsyncOperation<T>`：

```typescript
// Source: src/core/services/RetryService.ts
type AsyncOperation<T> = () => Promise<T>

// Phase 2 整合方式
const retryService = new RetryService(retryConfig)
const result = await retryService.execute(
  () => audioConvertService.convertFile(inputPath, outputPath),
  `convert:${path.basename(inputPath)}`
)

if (!result.success) {
  logger.error({ err: result.error }, 'Conversion failed after retries')
}
```

### 擴展 ErrorClassifier 支援 FFmpeg 錯誤

需要新增 FFmpeg-specific 錯誤碼到 `ErrorClassifier`，或建立 `AudioErrorClassifier` 子類別：

```typescript
// 新增錯誤模式到 ErrorClassifier 的 permanentNetworkErrors / transientNetworkErrors
// 或獨立的 AudioErrorClassifier
const audioTransientErrors = ['CANNOT ALLOCATE', 'BROKEN PIPE', 'TIMEOUT']
const audioPermanentErrors = ['NO SUCH FILE', 'INVALID DATA', 'UNSUPPORTED CODEC']
```

---

## 5. Performance & Concurrency — 並行轉換

### 現有模式

`generate_audiobook.ts` 使用 `p-limit` 控制 TTS 並行（預設 3），這是專案標準：

```typescript
// Source: scripts/generate_audiobook.ts
import pLimit from 'p-limit'
const limit = pLimit(concurrency)  // 預設 3
```

### Phase 2 並行策略

```typescript
// AudioConvertService.convertBatch() 推薦設計
import pLimit from 'p-limit'

async convertBatch(
  files: string[],
  outputDir: string,
  config: AudioConvertConfig
): Promise<ConversionBatchResult> {
  const limit = pLimit(config.maxConcurrency)  // 預設 3

  const tasks = files.map(inputPath =>
    limit(() => this.convertWithRetry(inputPath, outputDir))
  )

  const results = await Promise.allSettled(tasks)
  // 匯總結果，不讓單一失敗中斷整個批次
}
```

### 性能基準預期

- FFmpeg 音頻格式轉換速度：**20-50x 實時**（CPU-bound，非 IO-bound）
- 1 小時音頻 → MP3：約 2-5 秒
- 10 GB 的 FLAC → MP3 批次：約 10-30 分鐘（取決於 CPU core 數）
- 並行 3 個：相當於 3x 加速（IO 不是瓶頸，CPU 是）

**非功能需求**：R1.2.2 要求「合併 10 小時以上的音頻應在 5 分鐘內完成」。FFmpeg concat demuxer（`-c copy`）不需重新編碼，速度取決於 IO，通常 10 小時合併 < 1 分鐘。

---

## 6. Testing Strategy — 關鍵測試案例

### 現有測試基礎設施

```
bun test                        # 運行所有測試
src/tests/unit/                 # 單元測試
src/tests/integration/          # 集成測試
```

Phase 1 共 156 個測試，使用 `bun:test` 框架。

### 測試策略：避免真實音頻依賴

**關鍵挑戰**：集成測試需要真實音頻文件，但 CI 環境可能不適合存儲大型測試夾具。

推薦分層策略：

```typescript
// 1. 單元測試 — Mock Bun.$ 和 parseFile
import { mock } from 'bun:test'

mock.module('music-metadata', () => ({
  parseFile: mock(() => Promise.resolve({
    format: { duration: 3661.5, codec: 'MP3', bitrate: 128000, sampleRate: 44100 }
  }))
}))

// 2. 整合測試 — 使用 ffmpeg 生成測試音頻（不依賴預先存在的文件）
// 在測試 setup 中生成 5 秒靜音 WAV
await $`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 /tmp/test_audio.wav`.quiet()
```

### 關鍵測試案例

| 測試 | 類型 | 優先級 |
|------|------|--------|
| WAV → MP3 轉換（比特率正確） | 整合 | P0 |
| AAC → MP3 轉換 | 整合 | P0 |
| OGG → MP3 轉換 | 整合 | P0 |
| FLAC → MP3 轉換 | 整合 | P0 |
| 不支援格式的永久錯誤 | 單元 | P0 |
| 暫時錯誤觸發重試 | 單元 | P0 |
| parseFile 時長準確度（與已知時長比較） | 整合 | P0 |
| 並行 3 個轉換（concurrency limit） | 整合 | P1 |
| AudioConvertConfig 從環境變數載入 | 單元 | P1 |
| 批次轉換部分失敗不中斷整體 | 整合 | P1 |

### Wave 0 測試準備

需在實現前建立：
- [ ] `src/tests/unit/AudioConvertService.test.ts` — 覆蓋 R1.2.1
- [ ] `src/tests/integration/AudioConversion.test.ts` — 覆蓋 R1.2.1 多格式
- [ ] `src/tests/unit/AudioConvertConfig.test.ts` — 配置驗證
- [ ] `src/core/types/audio.ts` — 類型定義（`ConversionResult`, `ConversionBatchResult`）

---

## 7. Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | 無單獨配置（bun test 自動發現） |
| Quick run command | `bun test src/tests/unit/Audio` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| R1.2.1 | WAV/AAC/OGG/FLAC → MP3 轉換 | integration | `bun test src/tests/integration/AudioConversion.test.ts` | ❌ Wave 0 |
| R1.2.1 | 可配置比特率（預設 128k） | unit | `bun test src/tests/unit/AudioConvertConfig.test.ts` | ❌ Wave 0 |
| R1.2.1 | 轉換失敗重試整合 | unit | `bun test src/tests/unit/AudioConvertService.test.ts` | ❌ Wave 0 |
| R1.2.2 | 分組演算法（貪心，目標時長 ±10%） | unit | `bun test src/tests/unit/AudioGrouper.test.ts` | ❌ Wave 0 |
| R1.2.3 | 時長提取準確度（< 1% 誤差） | integration | `bun test src/tests/integration/AudioDuration.test.ts` | ❌ Wave 0 |

**注意**：R1.2.2 和 R1.2.3（分組與合併）按 ROADMAP 屬 Phase 3，但 REQUIREMENTS.md 將其列為 1.2.x。Phase 2 應聚焦 R1.2.1（轉換），R1.2.2/R1.2.3 在 Phase 3 完成。本 RESEARCH.md 同時提供兩者的研究供規劃參考。

### Sampling Rate
- **Per task commit:** `bun test src/tests/unit/Audio`
- **Per wave merge:** `bun test`
- **Phase gate:** 全套測試綠燈後進行驗收

### Wave 0 Gaps
- [ ] `src/tests/unit/AudioConvertService.test.ts` — 覆蓋 R1.2.1 單元邏輯
- [ ] `src/tests/unit/AudioConvertConfig.test.ts` — 覆蓋配置驗證
- [ ] `src/tests/integration/AudioConversion.test.ts` — 覆蓋多格式轉換
- [ ] `src/core/types/audio.ts` — ConversionResult, AudioMetadata 類型定義

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 音頻格式轉換 | 自定義 codec | Bun.$ + ffmpeg | FFmpeg 處理數百種格式邊際案例 |
| 時長提取 | 自解析 ID3 headers | music-metadata | VBR MP3, 容器格式各有差異，手工解析易出錯 |
| 子進程管理 | 自定義 spawn 包裝 | Bun.$ | Bun 原生 API，已在專案中使用 |
| 並行控制 | 自定義 semaphore | p-limit | 已安裝，專案標準 |
| 重試邏輯 | 自定義 try-catch loop | RetryService (Phase 1) | 已測試，支援指數退避和錯誤分類 |

**Key insight:** 音頻格式轉換的邊際案例（VBR 頭、不完整文件、特殊 container）不適合手工實現。FFmpeg 是業界標準，`Bun.$` 使調用簡潔。

---

## Common Pitfalls

### Pitfall 1: FFmpeg 找不到問題
**What goes wrong:** `Bun.$` 調用 `ffmpeg` 失敗，因為 PATH 環境在某些執行環境中不同。
**Why it happens:** Bun 子進程繼承的 PATH 可能與 shell 不同。
**How to avoid:** 在服務初始化時執行 `await $\`ffmpeg -version\`.quiet()` 作為健康檢查，並提供清楚的錯誤訊息。
**Warning signs:** `which ffmpeg` 成功但服務失敗。

### Pitfall 2: music-metadata 版本 ESM Only
**What goes wrong:** `import { parseFile } from 'music-metadata'` 在某些 Bun 版本中可能需要特定的 import 方式。
**Why it happens:** music-metadata v8+ 是純 ESM，無 CommonJS 導出。
**How to avoid:** 使用 `import` 而非 `require`，package.json 已設 `"type": "module"`，此專案應無問題。
**Warning signs:** 收到 "ERR_REQUIRE_ESM" 或模塊解析錯誤。

### Pitfall 3: FFmpeg concat list 路徑含特殊字符
**What goes wrong:** 文件名含有中文、空格或特殊符號時，concat list 文件格式錯誤導致 FFmpeg 失敗。
**Why it happens:** FFmpeg concat demuxer 要求正確 escape 的路徑。
**How to avoid:** 使用 `file '${path.resolve(filePath).replace(/'/g, "'\\''")}'` 格式，或使用絕對路徑。參考現有 `scripts/merge_mp3.ts` 的正確模式（第 162 行）。
**Warning signs:** 含中文文件名的合併失敗，純英文成功。

### Pitfall 4: 並行轉換 CPU 飽和
**What goes wrong:** 設定過高的 concurrency 導致 CPU 飽和，實際吞吐量下降。
**Why it happens:** FFmpeg 轉換是 CPU-bound，過多並行進程互相競爭。
**How to avoid:** 預設 concurrency = 3，可通過 `AUDIO_MAX_CONCURRENCY` 環境變數覆蓋。對於低核心數機器建議 1-2。
**Warning signs:** 轉換速度隨並行數增加不成比例。

### Pitfall 5: 暫時文件未清理
**What goes wrong:** 轉換失敗時留下部分輸出文件，下次執行時被誤認為成功。
**Why it happens:** FFmpeg 失敗後輸出文件可能已建立但不完整。
**How to avoid:** 在 catch block 中刪除輸出文件（參考現有 merge_mp3.ts 的 finally 清理模式）。使用 `-y` 強制覆蓋旗標。

---

## Code Examples

### AudioConvertService 核心設計

```typescript
// src/core/services/AudioConvertService.ts
import { $ } from 'bun'
import { parseFile } from 'music-metadata'
import path from 'node:path'
import { RetryService } from './RetryService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import { ConversionResult, AudioMetadata } from '../types/audio'

export class AudioConvertService {
  private readonly retryService: RetryService
  private readonly config: AudioConvertConfig

  constructor(config: AudioConvertConfig = new AudioConvertConfig(), retryService?: RetryService) {
    this.config = config
    this.retryService = retryService ?? new RetryService()
  }

  async convertToMp3(inputPath: string, outputPath: string): Promise<ConversionResult> {
    return this.retryService.execute(
      () => this.runFfmpegConversion(inputPath, outputPath),
      `convert:${path.basename(inputPath)}`
    )
  }

  private async runFfmpegConversion(inputPath: string, outputPath: string): Promise<void> {
    const result = await $`ffmpeg -y -i ${inputPath} -codec:a libmp3lame -b:a ${this.config.bitrate} -ar ${this.config.sampleRate} ${outputPath}`.quiet()

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      throw new Error(`FFmpeg failed (exit ${result.exitCode}): ${stderr.slice(0, 200)}`)
    }
  }

  async getMetadata(filePath: string): Promise<AudioMetadata> {
    const metadata = await parseFile(filePath)
    return {
      duration: metadata.format.duration ?? 0,
      codec: metadata.format.codec ?? 'unknown',
      bitrate: metadata.format.bitrate ?? 0,
      sampleRate: metadata.format.sampleRate ?? 0,
    }
  }
}
```

### AudioConvertConfig 設計

```typescript
// src/config/AudioConvertConfig.ts
export class AudioConvertConfig {
  readonly bitrate: string
  readonly sampleRate: number
  readonly maxConcurrency: number
  readonly ffmpegTimeoutMs: number

  constructor(overrides: Partial<AudioConvertConfigOptions> = {}) {
    this.bitrate = overrides.bitrate ?? DEFAULT_AUDIO_CONFIG.bitrate
    this.sampleRate = overrides.sampleRate ?? DEFAULT_AUDIO_CONFIG.sampleRate
    this.maxConcurrency = overrides.maxConcurrency ?? DEFAULT_AUDIO_CONFIG.maxConcurrency
    this.ffmpegTimeoutMs = overrides.ffmpegTimeoutMs ?? DEFAULT_AUDIO_CONFIG.ffmpegTimeoutMs
  }

  static fromEnvironment(): AudioConvertConfig {
    return new AudioConvertConfig({
      bitrate: process.env.AUDIO_BITRATE ?? DEFAULT_AUDIO_CONFIG.bitrate,
      sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE ?? '44100', 10),
      maxConcurrency: parseInt(process.env.AUDIO_MAX_CONCURRENCY ?? '3', 10),
      ffmpegTimeoutMs: parseInt(process.env.AUDIO_FFMPEG_TIMEOUT_MS ?? '300000', 10),
    })
  }
}

export const DEFAULT_AUDIO_CONFIG = {
  bitrate: '128k',
  sampleRate: 44100,
  maxConcurrency: 3,
  ffmpegTimeoutMs: 300000, // 5 分鐘
} as const
```

### FFmpeg 健康檢查

```typescript
// 服務啟動時的健康檢查（對應 Pitfall 1）
static async checkFfmpegAvailable(): Promise<void> {
  try {
    await $`ffmpeg -version`.quiet()
  } catch {
    throw new Error(
      'FFmpeg not found in PATH. Please install FFmpeg: brew install ffmpeg'
    )
  }
}
```

### 測試夾具生成（不依賴預先存在的音頻）

```typescript
// src/tests/integration/AudioConversion.test.ts
import { beforeAll, afterAll, test, expect } from 'bun:test'
import { $ } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'kinetitext-test-'))
  // 用 FFmpeg 生成 5 秒靜音 WAV（不依賴預先存在的音頻文件）
  await $`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 ${join(tmpDir, 'test.wav')}`.quiet()
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

test('converts WAV to MP3', async () => {
  const service = new AudioConvertService()
  const inputPath = join(tmpDir, 'test.wav')
  const outputPath = join(tmpDir, 'test.mp3')

  const result = await service.convertToMp3(inputPath, outputPath)
  expect(result.success).toBe(true)

  const metadata = await service.getMetadata(outputPath)
  expect(metadata.codec).toContain('MP3')
  expect(metadata.duration).toBeCloseTo(5, 0)
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| fluent-ffmpeg | Bun.$ / ffmpeg-simplified | 2025/05 (deprecated) | 禁止使用 fluent-ffmpeg |
| Node.js child_process | Bun.$ | Bun 1.0 (2023) | 更簡潔的 API，TypeScript 友好 |
| music-metadata v7 (CJS) | music-metadata v8+ (ESM) | 2023 | 純 ESM，需要 import 語法 |

**Deprecated/outdated:**
- **fluent-ffmpeg**: GitHub issue #1324 確認棄用（2025/05），禁止用於新項目
- **dotenv**: Bun 原生支援 `.env`，無需引入 dotenv 包

---

## Open Questions

1. **R1.2.2 Phase 歸屬**
   - What we know: REQUIREMENTS.md 將 R1.2.2（自動音頻合併）和 R1.2.3（時長計算）列為 1.2.x 需求，但 ROADMAP.md 明確將「音頻合併與分組」歸為 Phase 3
   - What's unclear: Phase 2 應否包含 R1.2.2/R1.2.3？
   - Recommendation: Phase 2 聚焦 R1.2.1（格式轉換），在 `AudioConvertService` 中包含 `getMetadata()` 方法（R1.2.3 前置工作），合併邏輯留給 Phase 3

2. **ErrorClassifier 擴展 vs 子類別**
   - What we know: Phase 1 的 `ErrorClassifier` 針對 HTTP/網路錯誤分類，FFmpeg 錯誤需要不同的分類邏輯
   - What's unclear: 是擴展現有類別（增加 FFmpeg 錯誤模式）還是建立 `AudioErrorClassifier`？
   - Recommendation: 建立 `AudioErrorClassifier` 繼承 `ErrorClassifier`，覆蓋 `classify()` 方法以添加 FFmpeg-specific 邏輯，保持 Phase 1 類別不變

3. **測試樣本音頻策略**
   - What we know: 可用 `ffmpeg -f lavfi -i anullsrc` 生成靜音測試音頻，無需預先存在的文件
   - What's unclear: 是否需要包含真實音頻格式的測試？（靜音 WAV 轉 MP3 是否足夠驗證格式相容性）
   - Recommendation: 靜音測試文件足夠驗證格式轉換管道；如需驗證 AAC/OGG/FLAC 解碼，也可用 ffmpeg 生成：`ffmpeg -f lavfi -i anullsrc -t 5 test.aac`

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| FFmpeg | 音頻格式轉換、合併 | ✓ | 8.0.1 (libmp3lame, aac, flac, vorbis 均已啟用) | — |
| Bun | 運行時、Bun.$ API | ✓ | 1.3.10 | — |
| music-metadata | 時長/元數據提取 | ✗ (未安裝) | — (最新: 11.12.3) | ffprobe（需解析 JSON） |
| p-limit | 並行控制 | ✓ | 7.3.0 (已安裝) | — |
| pino | 結構化日誌 | ✓ | 10.3.1 (已安裝) | — |

**Missing dependencies with no fallback:**
- music-metadata (需要 `bun add music-metadata`，Wave 0 任務)

**Missing dependencies with fallback:**
- 無（FFmpeg 8.0.1 已包含所有必要 codec）

---

## Project Constraints (from CLAUDE.md)

- **Bun 專用**: `bun install`, `bun test`, `bun run`。禁止 npm/yarn/pnpm。
- **Bun 內建 API**: I/O 使用 `Bun.file()`，Shell 使用 `Bun.$`，不使用 `dotenv`
- **不可變性**: 所有配置物件使用 `readonly` 屬性，不直接修改物件
- **函式大小**: < 50 行，檔案 < 800 行
- **測試**: TDD 方式，單元測試先寫，覆蓋率 ≥ 80%
- **無 console.log**: 使用 pino logger
- **禁止硬編碼值**: 所有可配置值放入 `AudioConvertConfig` 和 `.env`
- **Commit format**: `feat: [audio] 實現 MP3 轉換服務` 格式

---

## Sources

### Primary (HIGH confidence)
- 專案現有代碼 `scripts/merge_mp3.ts`, `scripts/mp3_to_mp4.ts` — Bun.$ FFmpeg 調用模式（已驗證有效）
- 專案現有代碼 `src/core/services/RetryService.ts` — Phase 1 整合介面
- `npm view music-metadata` — 版本 11.12.3，2026-03-24 確認
- `npm view ffmpeg-simplified` — 版本 2.1.1，2026-03-24 確認
- `ffmpeg -version` — 系統版本 8.0.1，libmp3lame/aac/flac/vorbis 均可用
- `ffmpeg -encoders` — 確認所有必要 codec 支援

### Secondary (MEDIUM confidence)
- GitHub: ragaeeb/ffmpeg-simplified — 確認 Bun ≥ 1.0 支援，使用系統 FFmpeg，提供 `formatMedia()`, `mergeSlices()` API
- npm music-metadata README — ESM only, 支援 MP3/MP4/FLAC/WAV/Ogg

### Tertiary (LOW confidence)
- 無

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm 版本已確認，系統 FFmpeg 已驗證
- Architecture: HIGH — 基於現有 scripts/ 模式，與 Phase 1 介面已知
- Pitfalls: HIGH — 來自現有代碼審計（merge_mp3.ts 第 162 行顯示路徑 escape 解決方案）

**Research date:** 2026-03-24
**Valid until:** 2026-04-24（music-metadata 和 ffmpeg-simplified 版本；FFmpeg 系統安裝不會變更）
