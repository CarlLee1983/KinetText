# Phase 1: 重試機制設計與實現 - 詳細計畫

**計畫編號**: P1
**日期**: 2026-03-24
**預計工作量**: 3-4 天
**開發者**: Carl (Solo)
**狀態**: 待執行

---

## 📋 計畫概覽

### 目標
實現一個生產級的重試系統，支援可配置的限制和智能退避，為爬蟲系統提供可靠的故障恢復機制。

### 交付物
1. **重試服務核心模組** (`src/core/services/RetryService.ts`)
2. **錯誤分類器** (`src/core/services/ErrorClassifier.ts`)
3. **配置管理** (`src/config/RetryConfig.ts` + `.env`)
4. **結構化日誌整合** (Pino 配置)
5. **單元測試** (80%+ 覆蓋率)
6. **集成測試** (重試場景驗證)

### 依賴關係
- 無上游依賴 (獨立)
- 被後續 Phase 2-4 依賴

---

## 🏗️ 架構設計

### 核心組件

```
RetryService (公開介面)
  ├── ErrorClassifier (錯誤分類)
  ├── BackoffCalculator (退避計算)
  ├── RetryConfig (配置管理)
  └── RetryLogger (日誌記錄)
```

### 設計原則
1. **不可變性**: 所有配置和狀態不可變
2. **依賴注入**: 易於測試和擴展
3. **類型安全**: 完整的 TypeScript 類型定義
4. **可配置**: 環境變數 + 配置檔支援
5. **可觀測**: 結構化日誌記錄

### 錯誤分類矩陣

| 錯誤類型 | HTTP 狀態 | 網路錯誤 | 應用錯誤 | 是否重試 |
|---------|---------|---------|---------|---------|
| 瞬時 | 408, 429, 5xx | TIMEOUT, ECONNREFUSED | - | ✅ |
| 永久 | 4xx (非 429) | ENOTFOUND, CERT_ERROR | InvalidURL | ❌ |

---

## 📦 文件結構與命名規範

### 新增文件清單

```
src/
├── core/
│   ├── services/
│   │   ├── RetryService.ts          (重試服務主類)
│   │   ├── ErrorClassifier.ts       (錯誤分類)
│   │   ├── BackoffCalculator.ts     (退避計算)
│   │   └── index.ts                 (服務導出)
│   ├── types/
│   │   ├── retry.ts                 (重試相關類型)
│   │   └── errors.ts                (錯誤定義)
│   └── utils/
│       └── logger.ts                (日誌配置)
│
├── config/
│   ├── RetryConfig.ts               (重試配置類)
│   ├── env.ts                       (環境變數驗證)
│   └── defaults.ts                  (預設值定義)
│
└── tests/
    ├── unit/
    │   ├── RetryService.test.ts      (重試服務單元測試)
    │   ├── ErrorClassifier.test.ts   (錯誤分類器測試)
    │   └── BackoffCalculator.test.ts (退避計算測試)
    └── integration/
        └── RetryIntegration.test.ts  (整合測試)

.env.example (環境變數模板)
```

---

## 🔧 技術棧確定

| 組件 | 選擇 | 理由 |
|------|------|------|
| **重試庫** | `p-retry` | 官方推薦，回調支援，自訂退避 |
| **日誌庫** | `pino` | JSON 結構化，高效能，Bun 原生支援 |
| **配置** | 環境變數 + 類 | Bun 原生 `.env` 支援，類型安全 |
| **測試** | `bun test` | 內建，無額外依賴 |

### NPM 依賴

```json
{
  "dependencies": {
    "p-retry": "^6.2.0",
    "pino": "^8.17.0"
  }
}
```

---

## 📝 任務分解

### Task 0: 類型定義與介面設計

**檔案**:
- `src/core/types/retry.ts`
- `src/core/types/errors.ts`

**目標**: 定義所有重試相關的類型和介面，為後續任務奠定基礎。

**行動**:

1. **定義重試配置介面**:
   ```typescript
   // src/core/types/retry.ts
   export interface RetryConfig {
     maxRetries: number              // 最大重試次數 (3-10)
     initialDelayMs: number          // 初始延遲 (ms)
     maxDelayMs: number              // 最大延遲 (ms)
     backoffFactor: number           // 指數因子 (2-3)
     jitterFactor: number            // 隨機抖動因子 (0.1-0.3)
     timeoutMs: number               // 單次操作超時 (ms)
     operationTimeoutMs?: number     // 整體操作超時 (可選)
   }

   export interface RetryAttempt {
     attemptNumber: number
     retriesLeft: number
     elapsedMs: number
     error: Error
     nextDelayMs: number
   }

   export interface RetryResult<T> {
     success: boolean
     data?: T
     error?: Error
     totalAttempts: number
     totalTimeMs: number
   }
   ```

2. **定義錯誤分類類型**:
   ```typescript
   // src/core/types/errors.ts
   export enum ErrorCategory {
     TRANSIENT = 'TRANSIENT',     // 可重試
     PERMANENT = 'PERMANENT',     // 不可重試
     UNKNOWN = 'UNKNOWN'          // 未知，謹慎處理
   }

   export interface ErrorClassification {
     category: ErrorCategory
     reason: string
     suggestedAction: 'RETRY' | 'FAIL' | 'BACKOFF'
   }
   ```

3. **定義自訂錯誤類別**:
   - `RetryExhaustedError` - 重試次數已耗盡
   - `PermanentError` - 永久錯誤，無法重試
   - `OperationTimeoutError` - 整體操作超時

**驗證**:
- 文件存在且包含所有定義的類型
- 所有 interface 都導出
- 無 TypeScript 編譯錯誤

**完成條件**:
- 4 個 interface，3 個 enum，3 個 custom error 類別已定義
- 所有類型有詳細的 JSDoc 註解

---

### Task 1: 錯誤分類器實現

**檔案**:
- `src/core/services/ErrorClassifier.ts`

**目標**: 實現智能錯誤分類邏輯，區分瞬時和永久錯誤。

**行動**:

1. **實現 ErrorClassifier 類**:
   ```typescript
   // src/core/services/ErrorClassifier.ts

   export class ErrorClassifier {
     private transientStatusCodes = [408, 429, 500, 502, 503, 504]
     private permanentStatusCodes = [400, 401, 403, 404, 422]
     private transientNetworkErrors = [
       'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ERR_TIMEOUT',
       'ERR_NETWORK', 'EAGAIN', 'EHOSTUNREACH'
     ]
     private permanentNetworkErrors = [
       'ENOTFOUND', 'ENOENT', 'ERR_CERT_', 'EBADF'
     ]

     classify(error: Error | Response): ErrorClassification {
       // 檢查 HTTP 響應狀態
       if (error instanceof Response) {
         return this.classifyHttpError(error.status)
       }

       // 檢查網路錯誤
       return this.classifyNetworkError(error)
     }

     private classifyHttpError(status: number): ErrorClassification {
       if (this.transientStatusCodes.includes(status)) {
         return {
           category: ErrorCategory.TRANSIENT,
           reason: `HTTP ${status} 是暫時性錯誤`,
           suggestedAction: 'RETRY'
         }
       }

       if (this.permanentStatusCodes.includes(status)) {
         return {
           category: ErrorCategory.PERMANENT,
           reason: `HTTP ${status} 是永久性錯誤`,
           suggestedAction: 'FAIL'
         }
       }

       return {
         category: ErrorCategory.UNKNOWN,
         reason: `HTTP ${status} 狀態碼未知`,
         suggestedAction: 'BACKOFF'
       }
     }

     private classifyNetworkError(error: Error): ErrorClassification {
       const message = error.message || ''
       const code = (error as any).code || ''

       const errorStr = `${message} ${code}`.toUpperCase()

       // 檢查瞬時網路錯誤
       for (const pattern of this.transientNetworkErrors) {
         if (errorStr.includes(pattern)) {
           return {
             category: ErrorCategory.TRANSIENT,
             reason: `網路錯誤 ${pattern} 是暫時性的`,
             suggestedAction: 'RETRY'
           }
         }
       }

       // 檢查永久網路錯誤
       for (const pattern of this.permanentNetworkErrors) {
         if (errorStr.includes(pattern)) {
           return {
             category: ErrorCategory.PERMANENT,
             reason: `網路錯誤 ${pattern} 是永久性的`,
             suggestedAction: 'FAIL'
           }
         }
       }

       return {
         category: ErrorCategory.UNKNOWN,
         reason: `未知的網路錯誤: ${message}`,
         suggestedAction: 'BACKOFF'
       }
     }
   }
   ```

2. **實現單元測試** (TDD 方式，測試優先):
   - 測試 HTTP 瞬時錯誤分類
   - 測試 HTTP 永久錯誤分類
   - 測試網路瞬時錯誤分類
   - 測試網路永久錯誤分類
   - 測試未知錯誤的處理

**驗證命令**:
```bash
bun test -- src/tests/unit/ErrorClassifier.test.ts
```

**完成條件**:
- `classify()` 方法正確分類 10+ 種錯誤類型
- 100% 的 HTTP 狀態碼覆蓋
- 網路錯誤覆蓋 8+ 種常見錯誤
- 單元測試通過率 100%

---

### Task 2: 退避計算器實現

**檔案**:
- `src/core/services/BackoffCalculator.ts`

**目標**: 實現指數退避計算，支援自訂參數和隨機抖動。

**行動**:

1. **實現 BackoffCalculator 類**:
   ```typescript
   // src/core/services/BackoffCalculator.ts

   export class BackoffCalculator {
     constructor(
       private initialDelayMs: number,
       private maxDelayMs: number,
       private backoffFactor: number,
       private jitterFactor: number
     ) {}

     /**
      * 計算給定嘗試次數的延遲時間
      * 公式: delay = initialDelay × (factor ^ attempt) + jitter
      */
     calculate(attemptNumber: number): number {
       // 計算基礎延遲: initialDelay × (factor ^ attemptNumber)
       const baseDelay = this.initialDelayMs *
         Math.pow(this.backoffFactor, attemptNumber - 1)

       // 限制最大延遲
       const cappedDelay = Math.min(baseDelay, this.maxDelayMs)

       // 添加隨機抖動: ±(delay × jitterFactor)
       const jitterRange = cappedDelay * this.jitterFactor
       const jitter = (Math.random() * 2 - 1) * jitterRange

       return Math.max(0, Math.round(cappedDelay + jitter))
     }

     /**
      * 返回延遲時間的字符串表示 (用於日誌)
      */
     formatDelay(delayMs: number): string {
       if (delayMs < 1000) {
         return `${delayMs}ms`
       }
       return `${(delayMs / 1000).toFixed(2)}s`
     }
   }
   ```

2. **驗證計算邏輯**:
   - 第 1 次: initialDelay (e.g., 100ms)
   - 第 2 次: initialDelay × 2 (e.g., 200ms)
   - 第 3 次: initialDelay × 4 (e.g., 400ms)
   - 不超過 maxDelay
   - 隨機抖動在 ±jitterFactor 範圍內

3. **單元測試** (TDD):
   - 測試基礎延遲計算
   - 測試指數增長
   - 測試最大延遲上限
   - 測試隨機抖動範圍
   - 測試邊界情況 (attempt 0, 負數)

**驗證命令**:
```bash
bun test -- src/tests/unit/BackoffCalculator.test.ts
```

**完成條件**:
- 指數退避計算精確度 99%+
- 隨機抖動在預期範圍內
- 所有邊界情況處理正確
- 單元測試通過率 100%

---

### Task 3: 配置管理實現

**檔案**:
- `src/config/RetryConfig.ts`
- `src/config/defaults.ts`
- `src/config/env.ts`
- `.env` 和 `.env.example`

**目標**: 實現配置管理，支援環境變數和預設值。

**行動**:

1. **定義預設配置**:
   ```typescript
   // src/config/defaults.ts

   export const DEFAULT_RETRY_CONFIG = {
     maxRetries: 3,
     initialDelayMs: 100,
     maxDelayMs: 30000,        // 30 秒
     backoffFactor: 2,
     jitterFactor: 0.1,        // ±10%
     timeoutMs: 10000,         // 單個請求 10 秒
     operationTimeoutMs: 60000 // 整體操作 60 秒
   } as const
   ```

2. **實現配置類**:
   ```typescript
   // src/config/RetryConfig.ts

   export class RetryConfig {
     readonly maxRetries: number
     readonly initialDelayMs: number
     readonly maxDelayMs: number
     readonly backoffFactor: number
     readonly jitterFactor: number
     readonly timeoutMs: number
     readonly operationTimeoutMs: number

     constructor(overrides: Partial<RetryConfigOptions> = {}) {
       this.maxRetries = this.validateRetries(
         overrides.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries
       )
       this.initialDelayMs = Math.max(0, overrides.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs)
       this.maxDelayMs = Math.max(0, overrides.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs)
       this.backoffFactor = Math.max(1, overrides.backoffFactor ?? DEFAULT_RETRY_CONFIG.backoffFactor)
       this.jitterFactor = Math.max(0, Math.min(1, overrides.jitterFactor ?? DEFAULT_RETRY_CONFIG.jitterFactor))
       this.timeoutMs = Math.max(0, overrides.timeoutMs ?? DEFAULT_RETRY_CONFIG.timeoutMs)
       this.operationTimeoutMs = Math.max(0, overrides.operationTimeoutMs ?? DEFAULT_RETRY_CONFIG.operationTimeoutMs)
     }

     private validateRetries(count: number): number {
       if (!Number.isInteger(count) || count < 0 || count > 100) {
         throw new Error(
           `Invalid maxRetries: ${count}. Must be integer between 0 and 100.`
         )
       }
       return count
     }

     /**
      * 從環境變數加載配置
      */
     static fromEnvironment(): RetryConfig {
       return new RetryConfig({
         maxRetries: parseInt(process.env.RETRY_MAX_RETRIES || '3', 10),
         initialDelayMs: parseInt(process.env.RETRY_INITIAL_DELAY_MS || '100', 10),
         maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS || '30000', 10),
         backoffFactor: parseFloat(process.env.RETRY_BACKOFF_FACTOR || '2'),
         jitterFactor: parseFloat(process.env.RETRY_JITTER_FACTOR || '0.1'),
         timeoutMs: parseInt(process.env.RETRY_TIMEOUT_MS || '10000', 10),
         operationTimeoutMs: parseInt(process.env.RETRY_OPERATION_TIMEOUT_MS || '60000', 10)
       })
     }
   }
   ```

3. **環境變數驗證**:
   ```typescript
   // src/config/env.ts

   export function validateRetryEnv(): void {
     const required = [
       'RETRY_MAX_RETRIES',
       'RETRY_INITIAL_DELAY_MS'
     ]

     // 所有變數都是可選的，Bun 原生支援 .env
     // 此檔案僅用於驗證格式
   }
   ```

4. **建立 `.env.example`**:
   ```env
   # Retry Service Configuration
   RETRY_MAX_RETRIES=3
   RETRY_INITIAL_DELAY_MS=100
   RETRY_MAX_DELAY_MS=30000
   RETRY_BACKOFF_FACTOR=2
   RETRY_JITTER_FACTOR=0.1
   RETRY_TIMEOUT_MS=10000
   RETRY_OPERATION_TIMEOUT_MS=60000

   # Logger Configuration
   LOG_LEVEL=info
   LOG_FORMAT=json
   ```

5. **單元測試** (TDD):
   - 測試預設配置加載
   - 測試環境變數覆蓋
   - 測試配置驗證
   - 測試無效值拒絕

**驗證命令**:
```bash
bun test -- src/tests/unit/RetryConfig.test.ts
```

**完成條件**:
- 可配置重試上限 (3-10 次)
- 環境變數支援
- 預設值合理
- 配置驗證完整
- 單元測試通過率 100%

---

### Task 4: 日誌配置實現

**檔案**:
- `src/core/utils/logger.ts`

**目標**: 實現結構化日誌配置，使用 Pino 記錄重試過程。

**行動**:

1. **安裝 Pino**:
   ```bash
   bun add pino
   ```

2. **實現日誌配置**:
   ```typescript
   // src/core/utils/logger.ts

   import pino from 'pino'

   export const createLogger = (name: string, options?: pino.LoggerOptions) => {
     const logLevel = process.env.LOG_LEVEL || 'info'

     return pino({
       level: logLevel,
       name,
       transport: {
         target: 'pino-pretty',
         options: {
           colorize: true,
           singleLine: false,
           translateTime: 'SYS:standard',
           ignore: 'pid,hostname'
         }
       },
       ...options
     })
   }

   export const retryLogger = createLogger('retry-service')
   ```

3. **日誌事件定義**:
   - `retry_attempt_start` - 開始嘗試
   - `retry_attempt_success` - 嘗試成功
   - `retry_attempt_failed` - 嘗試失敗
   - `retry_will_retry` - 將重試
   - `retry_exhausted` - 重試耗盡
   - `retry_permanent_error` - 永久錯誤

4. **日誌結構範例**:
   ```json
   {
     "level": 30,
     "time": "2026-03-24T10:30:45.123Z",
     "name": "retry-service",
     "event": "retry_attempt_start",
     "attemptNumber": 1,
     "maxAttempts": 3,
     "operationId": "fetch-chapter-123",
     "msg": "Starting retry attempt 1/3"
   }
   ```

**驗證**:
- 日誌輸出格式正確
- 包含所有必要的上下文信息
- 支援不同的日誌級別

**完成條件**:
- Pino 正確配置
- 支援 JSON 和可讀格式輸出
- 所有重試事件都被記錄

---

### Task 5: RetryService 核心實現

**檔案**:
- `src/core/services/RetryService.ts`

**目標**: 實現主重試服務，整合所有組件。

**行動**:

1. **實現 RetryService 類**:
   ```typescript
   // src/core/services/RetryService.ts

   import pRetry from 'p-retry'
   import { retryLogger } from '../utils/logger'
   import { ErrorClassifier } from './ErrorClassifier'
   import { BackoffCalculator } from './BackoffCalculator'
   import { RetryConfig } from '../../config/RetryConfig'

   export class RetryService {
     private config: RetryConfig
     private classifier: ErrorClassifier
     private backoffCalculator: BackoffCalculator
     private logger = retryLogger

     constructor(config: RetryConfig = new RetryConfig()) {
       this.config = config
       this.classifier = new ErrorClassifier()
       this.backoffCalculator = new BackoffCalculator(
         config.initialDelayMs,
         config.maxDelayMs,
         config.backoffFactor,
         config.jitterFactor
       )
     }

     /**
      * 執行帶重試的操作
      */
     async execute<T>(
       operation: () => Promise<T>,
       operationId: string = 'unknown'
     ): Promise<T> {
       const startTime = Date.now()
       let lastError: Error | null = null

       try {
         return await pRetry(
           async (attemptNumber: number) => {
             try {
               this.logger.info({
                 event: 'retry_attempt_start',
                 attemptNumber,
                 maxAttempts: this.config.maxRetries + 1,
                 operationId,
                 elapsed: Date.now() - startTime
               })

               const result = await this.executeWithTimeout(
                 operation,
                 this.config.timeoutMs
               )

               this.logger.info({
                 event: 'retry_attempt_success',
                 attemptNumber,
                 operationId,
                 elapsed: Date.now() - startTime
               })

               return result
             } catch (error) {
               lastError = error as Error
               const classification = this.classifier.classify(error)

               if (classification.category === 'PERMANENT') {
                 this.logger.error({
                   event: 'retry_permanent_error',
                   attemptNumber,
                   operationId,
                   error: error.message,
                   classification: classification.reason,
                   elapsed: Date.now() - startTime
                 })

                 throw new pRetry.AbortError(
                   `[Permanent Error] ${classification.reason}`
                 )
               }

               // 計算下次延遲
               const nextDelay = this.backoffCalculator.calculate(attemptNumber)

               this.logger.warn({
                 event: 'retry_will_retry',
                 attemptNumber,
                 maxAttempts: this.config.maxRetries + 1,
                 operationId,
                 error: error.message,
                 nextDelayMs: nextDelay,
                 elapsed: Date.now() - startTime
               })

               throw error
             }
           },
           {
             retries: this.config.maxRetries,
             minTimeout: this.config.initialDelayMs,
             maxTimeout: this.config.maxDelayMs,
             factor: this.config.backoffFactor,
             randomizationFactor: this.config.jitterFactor
           }
         )
       } catch (error) {
         const totalTime = Date.now() - startTime

         this.logger.error({
           event: 'retry_exhausted',
           maxAttempts: this.config.maxRetries + 1,
           operationId,
           error: error.message,
           totalTime
         })

         throw error
       }
     }

     /**
      * 執行帶超時的操作
      */
     private async executeWithTimeout<T>(
       operation: () => Promise<T>,
       timeoutMs: number
     ): Promise<T> {
       return Promise.race([
         operation(),
         new Promise<T>((_, reject) =>
           setTimeout(
             () => reject(new Error(`Operation timeout after ${timeoutMs}ms`)),
             timeoutMs
           )
         )
       ])
     }
   }
   ```

2. **導出服務**:
   ```typescript
   // src/core/services/index.ts

   export { RetryService } from './RetryService'
   export { ErrorClassifier } from './ErrorClassifier'
   export { BackoffCalculator } from './BackoffCalculator'
   ```

3. **單元測試** (TDD):
   - 測試成功執行 (第 1 次)
   - 測試失敗後成功 (重試恢復)
   - 測試永久錯誤快速失敗
   - 測試重試次數限制
   - 測試超時處理
   - 測試日誌記錄

**驗證命令**:
```bash
bun test -- src/tests/unit/RetryService.test.ts
```

**完成條件**:
- 所有重試場景正確
- 錯誤分類功能正常
- 日誌記錄詳細
- 單元測試 100% 通過

---

### Task 6: CrawlerEngine 集成

**檔案**:
- `src/core/CrawlerEngine.ts` (修改)

**目標**: 將重試服務集成到現有爬蟲引擎中。

**行動**:

1. **修改 CrawlerEngine 導入**:
   ```typescript
   import { RetryService } from './services'
   import { RetryConfig } from '../config/RetryConfig'
   ```

2. **在 CrawlerEngine 初始化重試服務**:
   ```typescript
   export class CrawlerEngine {
     private retryService: RetryService

     constructor(adapter: NovelSiteAdapter, storage: StorageAdapter, concurrency: number = 5) {
       this.adapter = adapter
       this.storage = storage
       this.concurrency = concurrency
       this.retryService = new RetryService(RetryConfig.fromEnvironment())
     }
   ```

3. **在 getBookMetadata 和 getChapterContent 包裝重試**:
   ```typescript
   // 在現有爬蟲邏輯中
   const content = await this.retryService.execute(
     () => this.adapter.getChapterContent(chapter.sourceUrl),
     `fetch-chapter-${chapter.index}`
   )
   ```

4. **驗證集成**:
   - 記錄舊的爬蟲日誌位置
   - 將 console.log 替換為 logger
   - 確保重試邏輯透明地應用

**完成條件**:
- CrawlerEngine 成功使用 RetryService
- 爬蟲日誌包含重試信息
- 無性能迴歸

---

### Task 7: 集成測試

**檔案**:
- `src/tests/integration/RetryIntegration.test.ts`

**目標**: 測試重試服務在真實場景中的行為。

**行動**:

1. **模擬伺服器環境**:
   ```typescript
   // 使用內部測試伺服器或 mock
   import { mock, spyOn } from 'bun:test'

   // 模擬會失敗 2 次後成功的 HTTP 請求
   let attempts = 0
   const operation = async () => {
     attempts++
     if (attempts < 3) {
       throw new Error('Service Unavailable 503')
     }
     return { success: true }
   }
   ```

2. **測試場景**:
   - **場景 1**: 瞬時錯誤後恢復 (503 → 200)
   - **場景 2**: 速率限制後恢復 (429 → 200)
   - **場景 3**: 永久錯誤立即失敗 (404)
   - **場景 4**: 網路超時後恢復
   - **場景 5**: 重試次數耗盡
   - **場景 6**: 操作超時

3. **驗證日誌輸出**:
   - 檢查日誌中的重試信息
   - 驗證嘗試次數
   - 檢查延遲時間

**驗證命令**:
```bash
bun test -- src/tests/integration/RetryIntegration.test.ts
```

**完成條件**:
- 所有 6 個場景都通過
- 日誌輸出符合預期
- 性能指標在可接受範圍內

---

### Task 8: 測試覆蓋率驗證

**目標**: 確保達到 80%+ 的測試覆蓋率。

**行動**:

1. **生成覆蓋率報告**:
   ```bash
   bun test --coverage
   ```

2. **檢查覆蓋率**:
   - `RetryService.ts`: 90%+
   - `ErrorClassifier.ts`: 95%+
   - `BackoffCalculator.ts`: 95%+
   - `RetryConfig.ts`: 85%+

3. **若覆蓋率不足**:
   - 識別未覆蓋的代碼路徑
   - 添加相應的測試用例
   - 重新運行驗證

4. **最終覆蓋率檢查清單**:
   - [ ] 所有公開方法都有測試
   - [ ] 所有錯誤路徑都被覆蓋
   - [ ] 邊界情況都被測試
   - [ ] 日誌記錄被驗證

**完成條件**:
- 整體覆蓋率 ≥ 80%
- 關鍵路徑 100% 覆蓋

---

### Task 9: 文檔與示例

**檔案**:
- `RETRY_SERVICE_README.md` (新增)
- `src/tests/examples/retry-service-usage.ts` (示例)

**目標**: 編寫清晰的使用文檔和示例代碼。

**行動**:

1. **編寫使用文檔**:
   ```markdown
   # Retry Service 使用指南

   ## 快速開始

   ```typescript
   import { RetryService } from '@/core/services'

   const retryService = new RetryService()

   const result = await retryService.execute(
     async () => {
       const response = await fetch(url)
       if (!response.ok) throw new Error(`HTTP ${response.status}`)
       return response.json()
     },
     'fetch-data'
   )
   ```

   ## 配置

   ...環境變數配置說明

   ## 錯誤分類

   ...錯誤類型和行為說明

   ## 日誌

   ...日誌格式和級別說明
   ```

2. **編寫示例代碼**:
   - 基本重試示例
   - 自訂配置示例
   - 與爬蟲集成示例

3. **API 文檔**:
   - JSDoc 註解所有公開方法
   - 參數和返回值類型清晰
   - 包含使用示例

**完成條件**:
- 文檔完整且清晰
- 示例代碼可直接運行
- API 文檔包含所有必要信息

---

## 🧪 測試策略

### 測試結構
```
src/tests/
├── unit/
│   ├── ErrorClassifier.test.ts
│   ├── BackoffCalculator.test.ts
│   ├── RetryConfig.test.ts
│   ├── RetryService.test.ts
│   └── logger.test.ts
└── integration/
    └── RetryIntegration.test.ts
```

### TDD 方式
1. **RED**: 編寫測試，驗證失敗
2. **GREEN**: 實現最小代碼使測試通過
3. **REFACTOR**: 優化代碼，保持測試通過

### 覆蓋率目標
| 模組 | 目標 | 優先級 |
|------|------|--------|
| ErrorClassifier | 95%+ | P0 |
| BackoffCalculator | 95%+ | P0 |
| RetryService | 90%+ | P0 |
| RetryConfig | 85%+ | P1 |
| **整體** | **80%+** | **P0** |

### 測試場景清單

#### ErrorClassifier
- [x] HTTP 瞬時錯誤 (408, 429, 5xx)
- [x] HTTP 永久錯誤 (4xx 非 429)
- [x] 網路瞬時錯誤 (TIMEOUT, ECONNREFUSED)
- [x] 網路永久錯誤 (ENOTFOUND, EBADF)
- [x] 未知錯誤

#### BackoffCalculator
- [x] 第 1 次延遲 = initialDelay
- [x] 第 2 次延遲 = initialDelay × factor
- [x] 第 3 次延遲 = initialDelay × factor²
- [x] 不超過 maxDelay
- [x] 隨機抖動在範圍內

#### RetryService
- [x] 首次成功無重試
- [x] 失敗後重試成功
- [x] 永久錯誤立即失敗
- [x] 重試次數限制
- [x] 單個操作超時
- [x] 整體操作超時
- [x] 日誌記錄正確

#### RetryConfig
- [x] 預設值加載
- [x] 環境變數覆蓋
- [x] 配置驗證
- [x] 無效值拒絕

---

## ✅ 驗收標準

### 功能驗收
- [ ] 重試可配置 (3-10 次)
- [ ] 指數退避運作正常
- [ ] 錯誤分類準確 (>95%)
- [ ] 永久錯誤快速失敗
- [ ] 日誌記錄詳細且結構化

### 代碼質量
- [ ] 不可變性原則應用正確
- [ ] TypeScript 無編譯錯誤
- [ ] ESLint 檢查通過
- [ ] 無 console.log (除日誌)
- [ ] 函式 < 50 行

### 測試驗收
- [ ] 單元測試 100% 通過
- [ ] 集成測試 100% 通過
- [ ] 覆蓋率 ≥ 80%
- [ ] 所有邊界情況都測試

### 文檔驗收
- [ ] 使用文檔完整
- [ ] API 文檔清晰
- [ ] 示例代碼可運行
- [ ] README 更新

---

## 📅 時間表

| Task | 預計時間 | 優先級 |
|------|---------|--------|
| Task 0: 類型定義 | 1 小時 | P0 |
| Task 1: ErrorClassifier | 2 小時 | P0 |
| Task 2: BackoffCalculator | 2 小時 | P0 |
| Task 3: 配置管理 | 2 小時 | P0 |
| Task 4: 日誌配置 | 1.5 小時 | P1 |
| Task 5: RetryService | 2.5 小時 | P0 |
| Task 6: CrawlerEngine 集成 | 1.5 小時 | P0 |
| Task 7: 集成測試 | 2 小時 | P0 |
| Task 8: 覆蓋率驗證 | 1 小時 | P0 |
| Task 9: 文檔 | 1 小時 | P1 |
| **總計** | **16-17 小時** | |

**預計日期**: 3-4 天 (包括代碼審查和迭代)

---

## 🚀 執行順序

### Wave 1: 基礎設施 (Day 1, 4-5 小時)
1. Task 0: 類型定義
2. Task 3: 配置管理
3. Task 4: 日誌配置

### Wave 2: 核心邏輯 (Day 1-2, 6-7 小時)
1. Task 1: ErrorClassifier
2. Task 2: BackoffCalculator
3. Task 5: RetryService

### Wave 3: 集成與驗證 (Day 2-3, 4-5 小時)
1. Task 6: CrawlerEngine 集成
2. Task 7: 集成測試
3. Task 8: 覆蓋率驗證

### Wave 4: 文檔與發佈 (Day 3-4, 1-2 小時)
1. Task 9: 文檔
2. 代碼審查
3. 提交到 Git

---

## 🔍 驗證檢查清單

在宣布 Phase 1 完成前，進行最終驗證：

### 代碼審查
- [ ] 遵循 CLAUDE.md 編碼標準
- [ ] 不可變性原則應用正確
- [ ] 無硬編碼值
- [ ] 無 console.log
- [ ] 函式大小適當

### 測試驗證
- [ ] 所有測試通過
- [ ] 覆蓋率 ≥ 80%
- [ ] 邊界情況都測試

### Git 提交
- [ ] 提交訊息清晰
- [ ] Conventional Commits 格式
- [ ] 提交原子化

### 文檔驗證
- [ ] README 更新
- [ ] API 文檔完整
- [ ] 示例代碼工作正常

---

## 📖 參考資源

### 已有研究
- `.planning/research/RETRY_MECHANISMS.md` - 重試最佳實踐
- `.planning/REQUIREMENTS.md` - 功能需求

### 外部文檔
- [p-retry NPM 文檔](https://www.npmjs.com/package/p-retry)
- [Pino 日誌庫文檔](https://getpino.io/)
- [Bun 文檔 - 測試](https://bun.sh/docs/test/overview)

---

## 📝 附錄: 常見問題

### Q1: 為什麼選擇 p-retry？
A: Sindre Sorhus (Node.js 知名貢獻者) 維護，API 清晰，支援自訂退避函數和回調。

### Q2: 如何在不同環境中調整重試策略？
A: 通過環境變數 (`.env`) 配置，開發環境可設置較少重試次數，生產環境可增加。

### Q3: 永久錯誤如何定義？
A: HTTP 4xx (非 429)、DNS 解析失敗、證書錯誤等，詳見 ErrorClassifier 實現。

### Q4: 日誌性能有影響嗎？
A: Pino 是高效的 JSON 日誌庫，性能影響 < 5%。生產環境可調整日誌級別。

### Q5: 如何與現有爬蟲系統集成？
A: 在 CrawlerEngine 初始化 RetryService，在 HTTP 請求外包裝 `retryService.execute()`。

---

**計畫版本**: 1.0
**最後更新**: 2026-03-24
**準備狀態**: ✅ 待執行
