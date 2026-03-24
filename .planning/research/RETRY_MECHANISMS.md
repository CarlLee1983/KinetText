# 爬蟲重試機制最佳實踐研究

**研究日期**: 2026-03-24
**研究者**: AI Research Agent
**優先結論**: 推薦使用 p-retry + 錯誤分類 + 結構化日誌

---

## Executive Summary

健壯的重試機制需要多層策略組合：

1. **指數退避 + Jitter** - 平滑分散重試
2. **智能錯誤分類** - 快速失敗永久錯誤
3. **可配置限制** - 上限次數和超時
4. **結構化日誌** - 監控和故障排查
5. **熔斷器模式** - 長期穩定性 (可選進階)

---

## 1. 指數退避策略

### 核心概念

```
延遲 = 基礎延遲 × (因子 ^ 嘗試次數) + 隨機抖動
```

### 參數建議

| 參數 | 建議值 | 說明 |
|------|--------|------|
| 基礎延遲 | 100-500ms | 第一次重試等待 |
| 因子 | 2-3 | 指數倍增 |
| 最大延遲 | 30-60s | 防止無限等待 |
| 最大重試次數 | 3-10 | 根據場景調整 |
| 隨機抖動 | ±10-30% | 防止「雷鳴羊群」|

### 隨機抖動的重要性

防止多個客戶端同時重試，避免在伺服器恢復時造成流量尖峰。

**範例時序**:
```
Request 1: 失敗
  等待: 100ms (基礎延遲)
  重試 1: 失敗
    等待: 200ms (100 × 2)
    重試 2: 失敗
      等待: 400ms (100 × 2²) + jitter (±40ms)
      重試 3: 成功 ✅
```

---

## 2. 錯誤分類系統

### ⚠️ 瞬時錯誤 (應該重試)

**HTTP 狀態碼**:
- `408` - 請求超時
- `429` - 請求過於頻繁 (速率限制)
- `500` - 伺服器內部錯誤
- `502` - 壞網關
- `503` - 服務不可用
- `504` - 網關超時

**網路錯誤**:
- `ERR_TIMEOUT` / `ETIMEDOUT` - 連接超時
- `ECONNREFUSED` - 連接被拒
- `ECONNRESET` - 連接重置
- `ERR_NETWORK_UNREACHABLE` - 網路不可達

**特性**: 暫時性，隨時間解決，重試可能成功

---

### ❌ 永久錯誤 (不應該重試)

**HTTP 狀態碼**:
- `400` - 壞請求 (參數錯誤)
- `401` - 未授權
- `403` - 禁止訪問
- `404` - 未找到
- `422` - 無法處理的實體

**應用錯誤**:
- `ENOTFOUND` - DNS 解析失敗
- 無效證書
- 認證失敗
- 格式錯誤

**特性**: 深層問題，重試浪費資源，應快速失敗

---

### 實現範例

```typescript
function isTransientError(error: Error | Response): boolean {
  // HTTP 響應狀態碼
  if (error instanceof Response) {
    const status = error.status
    const transientCodes = [408, 429, 500, 502, 503, 504]
    return transientCodes.includes(status)
  }

  // 網路錯誤
  const code = error.code || error.message
  const transientPatterns = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ERR_TIMEOUT',
    'ERR_NETWORK',
    'EAGAIN'  // 暫時性資源不可用
  ]

  return transientPatterns.some(pattern =>
    code.includes(pattern)
  )
}
```

---

## 3. 推薦的 Node.js 庫

### 🏆 p-retry (推薦)

**優勢**:
- ✅ Sindre Sorhus (創造者) 開發，質量保證
- ✅ `onFailedAttempt` 回調用於日誌記錄
- ✅ 詳細的嘗試元數據 (剩餘次數等)
- ✅ 支援自訂退避函數

**安裝**:
```bash
bun add p-retry
```

**基礎使用**:
```typescript
import pRetry from 'p-retry'

await pRetry(
  async () => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response
  },
  {
    retries: 3,
    minTimeout: 100,
    maxTimeout: 30000,
    factor: 2,
    onFailedAttempt(error) {
      console.warn(
        `[RETRY] 嘗試 ${error.attemptNumber}/${error.retriesLeft + 1}`,
        error.message
      )
    }
  }
)
```

### 🥈 async-retry (Vercel 維護)

**優勢**:
- ✅ Vercel 維護，生產級質量
- ✅ `bail` 函數用於動態決策
- ✅ 簡潔 API
- ✅ 預設最大重試: 10

**使用**:
```typescript
import retry from 'async-retry'

await retry(async bail => {
  try {
    return await riskyOperation()
  } catch (error) {
    if (error.status === 404) {
      bail(error)  // 永久錯誤，不重試
    }
    throw error
  }
}, {
  retries: 5,
  factor: 2
})
```

### 🥉 ts-retry (TypeScript 優先)

**優勢**:
- ✅ 強類型支援
- ✅ ESM 和 CommonJS
- ✅ 條件性重試

---

## 4. 最大重試限制與超時

### 場景建議

| 場景 | 最大重試 | 理由 |
|------|---------|------|
| 網路請求 | 3-5 | 平衡恢復力和延遲 |
| 速率限制 (429) | 2-3 | 尊重伺服器意圖 |
| 伺服器錯誤 (5xx) | 2-3 | 防止級聯失敗 |
| 資料庫操作 | 2-3 | 快速失敗以保證一致性 |
| 資料庫遷移 | 5+ | 允許更長恢復時間 |

### 超時配置

**單個請求超時**:
```typescript
// 單次請求的最大時間
const requestTimeoutMs = 10 * 1000  // 10 秒
```

**整體操作超時**:
```typescript
// 包括所有重試的總時間
const totalTimeoutMs = 60 * 1000  // 60 秒

// 建議: totalTimeout = requestTimeout + (retries × avgBackoff)
// 例: 10000 + (3 × 5000) = 25000ms
```

---

## 5. 結構化日誌記錄

### 推薦的日誌庫

| 庫 | 優勢 | 適用場景 |
|----|------|---------|
| **Pino** | JSON 默認，超快，低內存 | 高容量日誌 |
| **Winston** | 最靈活，多傳輸，廣泛採用 | 各種規模專案 |
| **Bunyan** | 結構化 JSON，除錯友好 | 中小型專案 |

### 推薦的日誌格式

```json
{
  "timestamp": "2026-03-24T10:30:45.123Z",
  "event": "fetch_retry",
  "url": "https://example.com/api/data",
  "attempt": 2,
  "maxAttempts": 3,
  "statusCode": 503,
  "error": "Service Unavailable",
  "nextRetryDelayMs": 400,
  "elapsedMs": 125,
  "context": {
    "userId": "user-123",
    "requestId": "req-abc-456",
    "source": "crawler"
  }
}
```

### 實現範例

```typescript
import pino from 'pino'

const logger = pino()

async function robustFetch(url: string) {
  return pRetry(
    async (attempt) => {
      const startTime = Date.now()

      try {
        const response = await fetch(url, { timeout: 10000 })

        if (!response.ok && !isTransientError(response)) {
          throw new pRetry.AbortError(`HTTP ${response.status}`)
        }

        logger.info({
          event: 'fetch_success',
          url,
          attempt,
          elapsedMs: Date.now() - startTime,
          status: response.status
        })

        return response
      } catch (error) {
        if (error instanceof pRetry.AbortError) {
          throw error
        }

        logger.warn({
          event: 'fetch_retry',
          url,
          attempt,
          error: error.message,
          elapsedMs: Date.now() - startTime
        })

        throw error
      }
    },
    {
      retries: 3,
      minTimeout: 100,
      maxTimeout: 30000,
      factor: 2
    }
  )
}
```

---

## 6. 熔斷器模式 (進階)

### 何時使用

- **重試**: 處理瞬時故障
- **熔斷器**: 處理持久故障，防止級聯失敗

**結合使用**: 優先重試，如果失敗率持續超過閾值，熔斷器阻止請求

### 熔斷器狀態

```
CLOSED (正常)
  ↓ 失敗率超過閾值
OPEN (阻止請求)
  ↓ 超時後測試恢復
HALF-OPEN (測試)
  ↓ 成功/失敗
CLOSED or OPEN
```

### 配置建議

| 參數 | 建議值 |
|------|--------|
| 失敗閾值 | 50% 失敗率 |
| 成功閾值 | 連續 2 次成功 |
| 測試超時 | 30-60 秒 |
| 樣本大小 | 最後 10 個請求 |

---

## 7. 速率限制與禮貌爬蟲

### robots.txt 遵守

```
User-agent: *
Crawl-delay: 5           # 最小 5 秒間隔
Request-rate: 10/1h      # 最多 10 次/小時
Disallow: /admin/        # 禁止路徑
```

### 實現範例

```typescript
interface RateLimitConfig {
  delayBetweenRequestsMs: 1000  // 最小延遲
  concurrent: 5                  // 最大並發
  respectRobotsDelay: true      // 遵守 robots.txt
}

async function respectCrawlDelay(domain: string): Promise<number> {
  try {
    const response = await fetch(`${domain}/robots.txt`)
    const text = await response.text()
    const match = text.match(/Crawl-delay:\s*(\d+)/)
    return match ? parseInt(match[1]) * 1000 : 1000
  } catch {
    return 1000  // 預設 1 秒
  }
}
```

### User-Agent 最佳實踐

```typescript
const userAgent = 'KinetiText/1.0 (+https://example.com/bot; contact@example.com)'
// 格式: BotName/Version (+ContactURL; EmailAddress)
```

---

## 8. 推薦配置清單

- [ ] **基礎延遲**: 100-500ms
- [ ] **指數因子**: 2-3
- [ ] **最大延遲**: 30-60 秒
- [ ] **最大重試次數**: 3-5
- [ ] **錯誤分類**: 瞬時 vs 永久
- [ ] **單個請求超時**: 10-30 秒
- [ ] **整體操作超時**: 設定明確限制
- [ ] **結構化日誌**: JSON 格式，包含時間戳和上下文
- [ ] **監控指標**: 重試率、失敗率、恢復時間
- [ ] **速率限制**: 遵守 robots.txt
- [ ] **User-Agent**: 穩定、可識別、包含聯絡信息

---

## 9. 完整實現範例

### 最小實現

```typescript
import pRetry from 'p-retry'

async function fetchWithRetry(url: string): Promise<Response> {
  return pRetry(
    () => fetch(url, { timeout: 10000 }),
    {
      retries: 3,
      minTimeout: 100,
      maxTimeout: 30000,
      factor: 2,
      onFailedAttempt(error) {
        console.log(`[RETRY] ${url} 嘗試 ${error.attemptNumber}`)
      }
    }
  )
}
```

### 生產級實現

```typescript
import pRetry from 'p-retry'
import pino from 'pino'

const logger = pino()

function isTransientError(error: Error | Response): boolean {
  if (error instanceof Response) {
    return [408, 429, 500, 502, 503, 504].includes(error.status)
  }
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].some(
    pattern => error.message.includes(pattern)
  )
}

async function robustFetch(
  url: string,
  options = { maxRetries: 3, timeoutMs: 10000 }
) {
  const startTime = Date.now()

  return pRetry(
    async (attemptNumber) => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(
          () => controller.abort(),
          options.timeoutMs
        )

        const response = await fetch(url, {
          signal: controller.signal
        })

        clearTimeout(timeout)

        if (!response.ok && !isTransientError(response)) {
          throw new pRetry.AbortError(
            `HTTP ${response.status}: ${response.statusText}`
          )
        }

        logger.info({
          event: 'fetch_success',
          url,
          attempt: attemptNumber,
          elapsed: Date.now() - startTime,
          status: response.status
        })

        return response
      } catch (error) {
        logger.warn({
          event: 'fetch_retry',
          url,
          attempt: attemptNumber,
          error: error.message,
          elapsed: Date.now() - startTime
        })

        throw error
      }
    },
    {
      retries: options.maxRetries,
      minTimeout: 100,
      maxTimeout: 30000,
      factor: 2,
      randomizationFactor: 0.1
    }
  )
}
```

---

## 10. 進一步閱讀

- [熔斷器模式 - Microsoft Learn](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Crawlee 官方文檔](https://crawlee.dev/js/api/playwright-crawler)
- [Node.js 日誌最佳實踐 - AppSignal](https://blog.appsignal.com/2021/09/01/best-practices-for-logging-in-nodejs.html)

---

**報告簽署**: AI Research Agent
**更新日期**: 2026-03-24
