# KinetiText API 參考

本文檔涵蓋所有核心服務類的完整 API 說明，包含方法簽名、參數、回傳值與使用範例。

## 目錄

- [RetryService](#retryservice)
- [ErrorClassifier / AudioErrorClassifier](#errorclassifier--audioerrorclassifier)
- [AudioConvertService](#audioconvertservice)
- [AudioMergeService](#audiomergeservice)
- [DurationService](#durationservice)
- [MP4ConversionService](#mp4conversionservice)
- [MP4Pipeline](#mp4pipeline)
- [錯誤處理](#錯誤處理)
- [完整端到端範例](#完整端到端範例)

---

## RetryService

### 用途
自動重試失敗的操作，支援指數退避、隨機抖動、錯誤分類與結構化日誌記錄。

### 建構子

```typescript
constructor(
  config?: Partial<RetryConfig>,
  errorClassifier?: ErrorClassifier
)
```

**參數**:
- `config`: 可選重試配置（若未提供，則從環境變數讀取）
- `errorClassifier`: 可選錯誤分類器（依注入錯誤分類決定是否重試）

### 方法

#### execute\<T\>(operation, options?): Promise\<T\>

執行操作並在失敗時自動重試。

**參數**:
| 名稱 | 型別 | 必需 | 說明 |
|------|------|------|------|
| `operation` | `() => Promise<T>` | 是 | 要執行的異步函數 |
| `options` | `Partial<RetryConfig>` | 否 | 覆蓋預設重試配置 |

**回傳**: `Promise<T>` — 操作的結果；失敗時拋出 `Error`

**範例**:
```typescript
import { RetryService } from "./src/core/retry/RetryService"

const retryService = new RetryService()

// 基本用法
const result = await retryService.execute(
  () => fetch("https://example.com")
)

// 指定最大重試次數
const data = await retryService.execute(
  () => downloadChapter(url),
  { maxRetries: 5, baseDelayMs: 200 }
)
```

### RetryConfig 介面

```typescript
interface RetryConfig {
  maxRetries: number        // 最大重試次數 (預設: 3)
  baseDelayMs: number       // 初始延遲毫秒 (預設: 100)
  maxDelayMs: number        // 最大延遲毫秒 (預設: 10000)
  backoffMultiplier: number // 指數退避倍數 (預設: 2)
  jitterEnabled: boolean    // 啟用隨機抖動 (預設: true)
}
```

### 配置（環境變數）

| 變數名稱 | 預設值 | 範圍 | 說明 |
|---------|--------|------|------|
| `RETRY_MAX_ATTEMPTS` | 3 | 1-10 | 最大重試次數 |
| `RETRY_BASE_DELAY_MS` | 100 | 1-1000 | 初始延遲（毫秒） |
| `RETRY_MAX_DELAY_MS` | 10000 | 1000-60000 | 最大延遲（毫秒） |
| `RETRY_BACKOFF_MULTIPLIER` | 2 | 1.5-3 | 指數退避倍數 |
| `RETRY_JITTER_ENABLED` | true | true/false | 啟用隨機抖動 |

**延遲計算公式**: `min(baseDelay * (multiplier ^ attempt), maxDelay) + jitter`

---

## ErrorClassifier / AudioErrorClassifier

### 用途
將錯誤分類為「可重試」（瞬時錯誤）或「不可重試」（永久錯誤），決定重試策略。

### ErrorClassifier 方法

#### isTransient(error): boolean

**參數**: `error: Error`
**回傳**: `true` 若為瞬時錯誤（可重試），否則 `false`

#### classify(error): ErrorCategory

**參數**: `error: Error`
**回傳**: `'transient' | 'permanent' | 'unknown'`

### AudioErrorClassifier 方法

繼承 `ErrorClassifier`，針對音頻轉換錯誤進行特化分類。

```typescript
const audioErrorClassifier = new AudioErrorClassifier()
const retryService = new RetryService({}, audioErrorClassifier)
```

---

## AudioConvertService

### 用途
將音頻檔案轉換為 MP3 格式，支援 WAV, AAC, OGG, FLAC 等輸入格式。整合 RetryService 自動重試失敗轉換。

### 建構子

```typescript
constructor(retryService: RetryService)
```

### 方法

#### convert(inputPath, outputPath, config?): Promise\<AudioConvertResult\>

轉換單個音頻檔案。

**參數**:
| 名稱 | 型別 | 必需 | 說明 |
|------|------|------|------|
| `inputPath` | `string` | 是 | 輸入檔案路徑 |
| `outputPath` | `string` | 是 | 輸出 MP3 路徑 |
| `config` | `Partial<AudioConvertConfig>` | 否 | 轉換配置 |

**回傳**:
```typescript
interface AudioConvertResult {
  success: boolean
  outputPath: string
  inputFormat?: string
  duration?: number       // 秒
  fileSizeBytes?: number
  error?: string
}
```

**範例**:
```typescript
import { AudioConvertService } from "./src/audio/AudioConvertService"
import { RetryService } from "./src/core/retry/RetryService"

const retryService = new RetryService()
const audioConvertService = new AudioConvertService(retryService)

const result = await audioConvertService.convert(
  "input.wav",
  "output.mp3",
  { bitrate: "192k" }
)

if (result.success) {
  console.log(`轉換完成: ${result.outputPath}`)
  console.log(`時長: ${result.duration}秒`)
}
```

#### convertBatch(options): Promise\<AudioConvertResult[]\>

批量轉換多個音頻檔案。

**參數**:
```typescript
interface BatchConvertOptions {
  inputFiles: string[]                  // 輸入檔案陣列
  outputDir: string                     // 輸出目錄
  config?: Partial<AudioConvertConfig>  // 批量配置
}
```

**回傳**: `AudioConvertResult[]`

**範例**:
```typescript
const results = await audioConvertService.convertBatch({
  inputFiles: ["ch1.wav", "ch2.wav", "ch3.wav"],
  outputDir: "./output/mp3",
  config: { bitrate: "128k" }
})

const succeeded = results.filter(r => r.success).length
console.log(`成功: ${succeeded}/${results.length}`)
```

### AudioConvertConfig 介面

```typescript
interface AudioConvertConfig {
  bitrate: string       // 例如 "128k", "192k", "256k"
  sampleRate: number    // 例如 44100
  channels: number      // 1 或 2
  format: string        // 輸出格式 (預設 "mp3")
}
```

### 配置（環境變數）

| 變數名稱 | 預設值 | 範圍 | 說明 |
|---------|--------|------|------|
| `AUDIO_BITRATE` | 128k | 64k-320k | MP3 比特率 |
| `AUDIO_SAMPLE_RATE` | 44100 | 8000-48000 | 採樣率 (Hz) |
| `AUDIO_CHANNELS` | 2 | 1-2 | 聲道數 |
| `AUDIO_CONVERT_MAX_CONCURRENCY` | 2 | 1-8 | 並行轉換數 |

---

## AudioMergeService

### 用途
合併多個 MP3 檔案，支援按時長或按數量分組，自動計算時長並生成分組報告。

### 建構子

```typescript
constructor(durationService: DurationService)
```

### 方法

#### merge(files, outputPath): Promise\<MergeResult\>

合併多個 MP3 檔案為單個輸出。

**參數**:
| 名稱 | 型別 | 必需 | 說明 |
|------|------|------|------|
| `files` | `string[]` | 是 | 輸入檔案路徑陣列（按順序合併） |
| `outputPath` | `string` | 是 | 輸出 MP3 路徑 |

**回傳**:
```typescript
interface MergeResult {
  outputPaths: string[]
  totalDuration: number   // 秒
}
```

#### mergeBatch(options): Promise\<GroupingReport\>

根據配置分組並合併音頻檔案（主要 API）。

**參數**:
```typescript
interface MergeBatchOptions {
  files: string[]                          // 輸入檔案陣列
  targetDuration?: number                  // 目標時長（秒）
  outputDir: string                        // 輸出目錄
  groupingStrategy?: 'duration' | 'count' // 分組策略（預設 'count'）
  filesPerGroup?: number                   // count 策略時每組檔案數
  maxConcurrency?: number                  // 並行讀取數
}
```

**回傳**:
```typescript
interface GroupingReport {
  readonly groups: readonly GroupSummary[]
  readonly totalDuration: number
  readonly actualDuration: number
  readonly oversizedSingleFile?: {
    readonly filename: string
    readonly duration: number
  }
}

interface GroupSummary {
  readonly groupId: string
  readonly fileCount: number
  readonly estimatedDuration: number
  readonly actualDuration: number
  readonly mergeResult: {
    readonly outputPaths: string[]
    readonly totalDuration: number
  }
}
```

**範例**:
```typescript
import { AudioMergeService } from "./src/audio/AudioMergeService"
import { DurationService } from "./src/audio/DurationService"

const durationService = new DurationService()
const audioMergeService = new AudioMergeService(durationService)

// 按時長分組（11 小時）
const report = await audioMergeService.mergeBatch({
  files: mp3Files,
  targetDuration: 39600,   // 11 小時 = 39600 秒
  outputDir: "./merged",
  groupingStrategy: "duration"
})

console.log(`共 ${report.groups.length} 組`)
console.log(`總時長: ${report.totalDuration}秒`)
```

#### formatReport(report): string

將分組報告格式化為人類可讀的中文文本。

**參數**: `report: GroupingReport`
**回傳**: `string`

### 配置（環境變數）

| 變數名稱 | 預設值 | 範圍 | 說明 |
|---------|--------|------|------|
| `AUDIO_MERGE_TARGET_DURATION` | 39600 | 1800-86400 | 目標時長（秒） |
| `AUDIO_MERGE_TOLERANCE_PERCENT` | 10 | 1-50 | 容差百分比 |
| `AUDIO_MERGE_MAX_CONCURRENCY` | 2 | 1-8 | 並行合併數 |

---

## DurationService

### 用途
計算音頻檔案的精確時長（精度 < 1%），使用 music-metadata 函式庫支援多種格式。

### 建構子

```typescript
constructor()
```

### 方法

#### getDuration(filePath): Promise\<number\>

取得音頻檔案時長。

**參數**:
| 名稱 | 型別 | 必需 | 說明 |
|------|------|------|------|
| `filePath` | `string` | 是 | 音頻檔案路徑 |

**回傳**: `Promise<number>` — 時長（秒）；檔案無效時拋出 `Error`

**支援格式**: MP3, MP4, M4A, WAV, FLAC, OGG, AAC

**範例**:
```typescript
import { DurationService } from "./src/audio/DurationService"

const durationService = new DurationService()

const duration = await durationService.getDuration("chapter1.mp3")
const hours = Math.floor(duration / 3600)
const minutes = Math.floor((duration % 3600) / 60)
console.log(`時長: ${hours}小時${minutes}分`)
```

#### getDurations(filePaths): Promise\<Map\<string, number\>\>

批量取得多個檔案的時長。

**參數**: `filePaths: string[]`
**回傳**: `Promise<Map<string, number>>` — 路徑 → 時長（秒）的 Map

---

## MP4ConversionService

### 用途
將 MP3 轉換為 M4A（音頻 MP4 容器），使用 AAC 編碼，支援元資料嵌入與批量轉換。

### 建構子

```typescript
constructor(retryService: RetryService, config?: Partial<MP4ConversionConfig>)
```

### 方法

#### convert(inputPath, outputPath, metadata?): Promise\<MP4ConversionResult\>

轉換單個音頻檔案。

**參數**:
| 名稱 | 型別 | 必需 | 說明 |
|------|------|------|------|
| `inputPath` | `string` | 是 | 輸入 MP3 路徑 |
| `outputPath` | `string` | 是 | 輸出 M4A 路徑 |
| `metadata` | `AudioMetadata` | 否 | 嵌入元資料 |

**AudioMetadata 介面**:
```typescript
interface AudioMetadata {
  title?: string
  artist?: string
  album?: string
  date?: string
}
```

**回傳**:
```typescript
interface MP4ConversionResult {
  success: boolean
  outputPath: string
  duration?: number       // 秒
  fileSizeBytes?: number
  error?: string
}
```

**範例**:
```typescript
import { MP4ConversionService } from "./src/audio/MP4ConversionService"
import { RetryService } from "./src/core/retry/RetryService"

const retryService = new RetryService()
const mp4Service = new MP4ConversionService(retryService)

const result = await mp4Service.convert(
  "merged_001.mp3",
  "output_001.m4a",
  {
    title: "第一部分",
    artist: "作者名",
    album: "書籍名",
    date: "2024"
  }
)
```

#### convertBatch(options): Promise\<MP4ConversionResult[]\>

批量轉換多個音頻檔案。

**參數**:
```typescript
interface BatchMP4Options {
  inputFiles: string[]                     // 輸入 MP3 陣列
  outputDir: string                        // 輸出目錄
  metadata?: Record<string, AudioMetadata> // filename → metadata 對應
  config?: Partial<MP4ConversionConfig>
}
```

**回傳**: `MP4ConversionResult[]`

### MP4ConversionConfig 介面

```typescript
interface MP4ConversionConfig {
  bitrate: string       // AAC 比特率，例如 "256k" (96k-320k)
  outputFormat: string  // 輸出格式（預設 "m4a"）
  maxConcurrency: number // 並行轉換數 (1-8)
}
```

### 配置（環境變數）

| 變數名稱 | 預設值 | 範圍 | 說明 |
|---------|--------|------|------|
| `MP4_BITRATE` | 256k | 96k-320k | AAC 比特率 |
| `MP4_FORMAT` | m4a | m4a | 輸出格式 |
| `MP4_MAX_CONCURRENCY` | 2 | 1-8 | 並行轉換數 |
| `MP4_INCLUDE_METADATA` | true | true/false | 嵌入元資料 |

---

## MP4Pipeline

### 用途
協調完整的 MP3 → M4A 轉換工作流程，包含目錄掃描、批量轉換與報告生成。

### 建構子

```typescript
constructor(mp4ConversionService: MP4ConversionService)
```

### 方法

#### execute(options): Promise\<MP4PipelineReport\>

執行完整轉換管道。

**參數**:
```typescript
interface MP4PipelineOptions {
  inputDir: string                         // 輸入 MP3 目錄
  outputDir: string                        // 輸出 M4A 目錄
  metadata?: Record<string, AudioMetadata> // filename → metadata 元資料對應
  dryRun?: boolean                         // 預覽模式（不實際轉換）
}
```

**回傳**:
```typescript
interface MP4PipelineReport {
  timestamp: string
  inputDir: string
  outputDir: string
  fileCount: number
  successCount: number
  failureCount: number
  dryRun: boolean
  errors: Array<{
    filename: string
    error: string
  }>
}
```

**範例**:
```typescript
import { MP4Pipeline } from "./src/audio/MP4Pipeline"
import { MP4ConversionService } from "./src/audio/MP4ConversionService"
import { RetryService } from "./src/core/retry/RetryService"

const retryService = new RetryService()
const mp4Service = new MP4ConversionService(retryService)
const pipeline = new MP4Pipeline(mp4Service)

// 乾跑預覽
const dryReport = await pipeline.execute({
  inputDir: "./merged",
  outputDir: "./m4a",
  dryRun: true
})
console.log(`預計轉換 ${dryReport.fileCount} 個檔案`)

// 實際執行（含元資料）
const report = await pipeline.execute({
  inputDir: "./merged",
  outputDir: "./m4a",
  metadata: {
    "merged_001.mp3": { title: "第一部分", artist: "作者", album: "書名" },
    "merged_002.mp3": { title: "第二部分", artist: "作者", album: "書名" }
  }
})

console.log(`完成: ${report.successCount}/${report.fileCount}`)
if (report.errors.length > 0) {
  report.errors.forEach(e => console.error(`失敗: ${e.filename} - ${e.error}`))
}
```

---

## 錯誤處理

所有服務在操作失敗時都會拋出 `Error`，建議使用 try-catch 包裝。

### 錯誤類型

```typescript
// 一般操作錯誤
class ServiceError extends Error {
  constructor(message: string, cause?: Error) {
    super(message)
    this.cause = cause
  }
}

// 重試耗盡錯誤
class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(`重試 ${attempts} 次後仍失敗: ${lastError.message}`)
  }
}
```

### 捕捉範例

```typescript
try {
  const result = await audioConvertService.convert(inputPath, outputPath)
  if (!result.success) {
    console.warn(`轉換未成功: ${result.error}`)
  }
} catch (error) {
  if (error instanceof Error) {
    console.error(`服務錯誤: ${error.message}`)
    if (error.cause instanceof Error) {
      console.error(`原因: ${error.cause.message}`)
    }
  }
}
```

### 結果檢查模式

所有服務回傳的結果物件都包含 `success` 欄位，可在不使用 try-catch 的情況下檢查：

```typescript
const results = await audioConvertService.convertBatch(options)
const failures = results.filter(r => !r.success)
if (failures.length > 0) {
  failures.forEach(f => console.error(`失敗: ${f.error}`))
}
```

---

## 完整端到端範例

以下範例展示完整的音頻書製作流程：

```typescript
import { RetryService } from "./src/core/retry/RetryService"
import { AudioErrorClassifier } from "./src/audio/AudioErrorClassifier"
import { AudioConvertService } from "./src/audio/AudioConvertService"
import { DurationService } from "./src/audio/DurationService"
import { AudioMergeService } from "./src/audio/AudioMergeService"
import { MP4ConversionService } from "./src/audio/MP4ConversionService"
import { MP4Pipeline } from "./src/audio/MP4Pipeline"

async function processAudioBook(novelName: string) {
  // 1. 初始化服務
  const audioErrorClassifier = new AudioErrorClassifier()
  const retryService = new RetryService({
    maxRetries: 3,
    baseDelayMs: 100
  }, audioErrorClassifier)

  const durationService = new DurationService()
  const audioConvertService = new AudioConvertService(retryService)
  const audioMergeService = new AudioMergeService(durationService)
  const mp4ConversionService = new MP4ConversionService(retryService)
  const mp4Pipeline = new MP4Pipeline(mp4ConversionService)

  // 2. Phase 2: WAV → MP3 批量轉換
  const wavFiles = await glob(`output/${novelName}/wav/*.wav`)
  const convertResults = await audioConvertService.convertBatch({
    inputFiles: wavFiles,
    outputDir: `output/${novelName}/mp3`,
    config: { bitrate: "192k" }
  })
  console.log(`轉換完成: ${convertResults.filter(r => r.success).length}/${convertResults.length}`)

  // 3. Phase 3: MP3 → 按 11 小時分組合併
  const mp3Files = convertResults
    .filter(r => r.success)
    .map(r => r.outputPath)

  const mergeReport = await audioMergeService.mergeBatch({
    files: mp3Files,
    targetDuration: 39600,   // 11 小時
    outputDir: `output/${novelName}/merged`,
    groupingStrategy: "duration"
  })

  // 輸出中文報告
  console.log(audioMergeService.formatReport(mergeReport))

  // 4. Phase 4: 合併 MP3 → M4A（附元資料）
  const metadata: Record<string, { title: string; artist: string; album: string }> = {}
  mergeReport.groups.forEach((group, index) => {
    group.mergeResult.outputPaths.forEach(path => {
      const filename = path.split("/").pop()!
      metadata[filename] = {
        title: `第 ${index + 1} 部分`,
        artist: "作者名",
        album: novelName
      }
    })
  })

  const mp4Report = await mp4Pipeline.execute({
    inputDir: `output/${novelName}/merged`,
    outputDir: `output/${novelName}/m4a`,
    metadata
  })

  console.log(`M4A 轉換完成: ${mp4Report.successCount}/${mp4Report.fileCount}`)
  if (mp4Report.errors.length > 0) {
    mp4Report.errors.forEach(e => console.error(`失敗: ${e.filename}`))
  }
}

// 執行
processAudioBook("我的小說").catch(console.error)
```

---

## 版本資訊

| 版本 | 說明 |
|------|------|
| 1.0 | Phase 1: RetryService 核心 |
| 1.1 | Phase 2: AudioConvertService |
| 1.2 | Phase 3: AudioMergeService + DurationService |
| 1.3 | Phase 4: MP4ConversionService + MP4Pipeline |

> 詳細配置說明請參閱 [CONFIGURATION.md](CONFIGURATION.md)。
> 常見問題解決請參閱 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。
