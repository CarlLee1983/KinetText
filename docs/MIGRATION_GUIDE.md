# AudioConvert Go 後端遷移指南

**目標讀者**: KinetiText 開發者、系統管理員、爬蟲配置工程師

**更新日期**: 2026-03-26
**版本**: v1.1 (Phase 6)

---

## 目錄

- [1. 概覽](#1-概覽)
- [2. 快速開始](#2-快速開始)
- [3. 配置選項](#3-配置選項)
- [4. 性能對比](#4-性能對比)
- [5. 故障排查](#5-故障排查)
- [6. 開發者指南](#6-開發者指南)
- [7. 常見問題 FAQ](#7-常見問題-faq)
- [8. 下一步計劃](#8-下一步計劃)

---

## 1. 概覽

KinetiText v1.1 引入了可選的 Go 後端，用於加速音頻轉換操作。

**關鍵特性**:
- **可選啟用**: 預設使用 Bun FFmpeg 後端，Go 後端需明確啟用
- **優雅降級**: Go 初始化失敗時自動回退 Bun 後端，無中斷
- **配置靈活**: 支持環境變數、配置文件、CLI 旗標三種啟用方式
- **格式覆蓋**: WAV、AAC、OGG、FLAC → MP3 全格式支持

**架構說明**:

```
啟用 Go 後端後的調用路徑:
Bun → AudioConvertGoWrapper → kinetitext-audio (Go) → FFmpeg → MP3

未啟用（預設）的調用路徑:
Bun → AudioConvertService → FFmpeg (Bun.$) → MP3
```

---

## 2. 快速開始

### 2.1 系統要求

| 組件 | 版本要求 | 說明 |
|------|---------|------|
| Bun | 1.0+ | KinetiText 運行時 |
| FFmpeg | 4.0+ | 音頻轉換（系統安裝） |
| Go | 1.20+ | 僅編譯 Go 後端時需要 |

確認系統依賴:

```bash
# 確認 FFmpeg 可用
ffmpeg -version

# 確認 Bun 版本
bun --version

# 確認 Go 版本（如需重新編譯）
go version
```

### 2.2 編譯 Go 後端

Go 後端位於獨立倉庫 `kinetitext-go`（與 KinetiText 並列）:

```bash
# 進入 Go 專案目錄
cd ../kinetitext-go

# 安裝 Go 依賴
go mod tidy

# 編譯二進制（輸出到 bin/ 目錄）
make build

# 或直接使用 go build
go build -o bin/kinetitext-audio ./src/audio-convert/

# 驗證編譯成功
ls -la bin/kinetitext-audio
# 預期: -rwxr-xr-x ... kinetitext-audio

# 測試二進制功能（應輸出 JSON 錯誤回應）
echo '{}' | ./bin/kinetitext-audio
# 預期: {"success":false,"error":"..."}
```

### 2.3 啟用 Go 後端

**方式 1: 環境變數（推薦用於生產環境）**

```bash
# 啟用 Go 後端（使用預設二進制路徑）
export KINETITEXT_USE_GO_AUDIO=true
bun run src/index.ts --crawl https://example.com

# 同時指定自定義二進制路徑
export KINETITEXT_USE_GO_AUDIO=true
export KINETITEXT_GO_AUDIO_BIN=/absolute/path/to/kinetitext-audio
bun run src/index.ts --crawl https://example.com
```

**方式 2: .env 配置文件**

在專案根目錄創建或編輯 `.env`:

```env
# 啟用 Go 後端
KINETITEXT_USE_GO_AUDIO=true

# 可選：自定義 Go 二進制路徑（預設自動推導）
# KINETITEXT_GO_AUDIO_BIN=../kinetitext-go/bin/kinetitext-audio

# 可選：Go 超時設置（毫秒，預設 60000）
# AUDIO_GO_TIMEOUT_MS=60000
```

Bun 會自動加載 `.env` 文件，無需額外配置。

**方式 3: CLI 旗標**

```bash
bun run src/index.ts --use-go-audio --crawl https://example.com
```

**方式 4: 代碼配置（在自定義腳本中）**

```typescript
import { AudioConvertService } from './src/core/services/AudioConvertService'
import { AudioConvertConfig } from './src/config/AudioConvertConfig'

const service = new AudioConvertService(
  new AudioConvertConfig({
    useGoBackend: true,
    goBinaryPath: '../kinetitext-go/bin/kinetitext-audio',
    bitrate: '192k',
    goTimeout: 60000,
  })
)

// 必須在使用前初始化 Go 後端
await service.initGoBackend()

// 開始轉換
const result = await service.convertToMp3('input.wav', 'output.mp3')
```

### 2.4 驗證 Go 後端工作

執行基準測試（比較 Bun vs Go 性能）:

```bash
bun run bench:convert
```

預期輸出:
```
📊 Benchmarking wav...
  ✅ bun: 120ms (avg of 3 runs)
  ✅ go: 114ms (avg of 3 runs)
📊 Benchmarking aac...
  ...
✅ Benchmark complete! Report saved to PERF_REPORT.md
```

執行 Go 後端 E2E 測試:

```bash
bun test ./src/tests/e2e/AudioConvertGo.e2e.ts --timeout=120000
# 預期: 17 tests passing
```

查看性能報告:

```bash
cat .planning/phases/06-audio-convert-go/PERF_REPORT.md
```

---

## 3. 配置選項

### 3.1 AudioConvertConfig Go 後端選項

| 選項 | 型別 | 預設 | 說明 |
|------|------|------|------|
| `useGoBackend` | `boolean` | `false` | 啟用 Go 後端 |
| `goBinaryPath` | `string?` | `undefined` | Go 二進制絕對路徑 |
| `goTimeout` | `number` | `60000` | Go 轉換超時（毫秒） |

**注意**: `goBinaryPath` 未設置時，`AudioConvertGoWrapper` 會使用相對於原始碼的預設路徑（`../../../../../kinetitext-go/bin/kinetitext-audio`）。建議在生產環境明確指定絕對路徑。

### 3.2 環境變數完整列表

| 環境變數 | 值示例 | 說明 |
|---------|--------|------|
| `KINETITEXT_USE_GO_AUDIO` | `true` / `false` | 啟用 Go 後端 |
| `KINETITEXT_GO_AUDIO_BIN` | `/path/to/binary` | Go 二進制路徑 |
| `AUDIO_GO_TIMEOUT_MS` | `60000` | Go 超時（毫秒） |
| `AUDIO_BITRATE` | `192k` | MP3 輸出位速率 |
| `AUDIO_MAX_CONCURRENCY` | `4` | 最大並行轉換數 |

### 3.3 CrawlerEngine 集成配置

在 `CrawlerEngine` 中使用 Go 後端:

```typescript
import CrawlerEngine from './src/core/CrawlerEngine'
import type { CrawlerConfig } from './src/core/CrawlerEngine'

const config: CrawlerConfig = {
  concurrency: 4,
  audio: {
    bitrate: '192k',
    maxConcurrency: 4,
    useGoBackend: true,
    goBinaryPath: '/absolute/path/to/kinetitext-audio',
    goTimeout: 60000,
  }
}

const engine = new CrawlerEngine(config)
```

### 3.4 完整 .env 配置示例

```env
# === Go 後端配置 ===
KINETITEXT_USE_GO_AUDIO=true
KINETITEXT_GO_AUDIO_BIN=/Users/username/Dev/Carl/kinetitext-go/bin/kinetitext-audio
AUDIO_GO_TIMEOUT_MS=60000

# === 音頻轉換配置 ===
AUDIO_BITRATE=192k
AUDIO_SAMPLE_RATE=44100
AUDIO_MAX_CONCURRENCY=4
AUDIO_FFMPEG_TIMEOUT_MS=120000

# === 爬蟲配置 ===
CRAWLER_CONCURRENCY=4
```

---

## 4. 性能對比

### 4.1 基準數據（5 秒靜音音頻）

**平台**: macOS 14.2, Apple Silicon M2

| 格式 | Bun 後端 | Go 後端 | 差異 |
|------|---------|--------|------|
| WAV → MP3 | 120ms | 114ms | Go 快 5% |
| AAC → MP3 | 74ms | 82ms | Go 慢 11% |
| OGG → MP3 | 77ms | 83ms | Go 慢 8% |
| FLAC → MP3 | 66ms | 109ms | Go 慢 65% |

**結論**: 短音頻文件測試中，Go 運行時啟動開銷（~50-80ms）主導結果，Go 後端略慢。

### 4.2 預期真實場景性能

對於長音頻文件（例如有聲書章節，30-60 分鐘）:

| 場景 | 預期 |
|------|------|
| Go 運行時啟動開銷 | ~80ms（可忽略） |
| FFmpeg 轉換時間 | 主要耗時（數十秒） |
| Go 後端預期提升 | 10-20% |

**原因**: Go 的 ffmpeg-go 綁定比 Bun `$\`ffmpeg...\`` 調用方式有更優的管道 I/O 和記憶體緩衝優化。

### 4.3 進程啟動開銷對比

| 方案 | 進程啟動開銷 | 說明 |
|------|------------|------|
| Bun FFmpeg（當前） | ~100-150ms | 直接啟動 FFmpeg 子進程 |
| Go 後端（無狀態） | ~50-80ms | Go 運行時啟動 + IPC |
| Go 後端（常駐模式，未來） | ~1ms | 長連接，無啟動開銷 |

---

## 5. 故障排查

### 5.1 "Go 二進制文件不存在" 錯誤

**症狀**:
```
Failed to init Go backend, falling back to Bun FFmpeg
Error: Go 二進制文件不存在: /path/to/kinetitext-audio
```

**注意**: 此錯誤會優雅降級至 Bun 後端，不會中斷服務。

**解決方案**:

```bash
# 1. 檢查二進制是否存在
ls -la ../kinetitext-go/bin/kinetitext-audio

# 2. 二進制不存在則重新編譯
cd ../kinetitext-go
make build

# 3. 驗證編譯成功
./bin/kinetitext-audio < /dev/null
# 應輸出: {"success":false,"error":"..."}

# 4. 確認路徑設置正確
echo $KINETITEXT_GO_AUDIO_BIN
```

### 5.2 "Go 二進制非零退出碼" 錯誤

**症狀**:
```
Go 二進制錯誤 (退出碼 1): ...
```

**診斷步驟**:

```bash
# 直接測試 Go 二進制
echo '{"input_file":"test.wav","output_file":"out.mp3","format":"mp3","bitrate":192}' | \
  ../kinetitext-go/bin/kinetitext-audio

# 查看錯誤詳情（Go 二進制錯誤輸出到 stderr）
echo '{"input_file":"test.wav","output_file":"out.mp3","format":"mp3","bitrate":192}' | \
  ../kinetitext-go/bin/kinetitext-audio 2>&1
```

**常見原因與解決**:

| 原因 | 症狀 | 解決 |
|------|------|------|
| FFmpeg 未安裝 | `exec: "ffmpeg": not found` | `brew install ffmpeg` |
| 輸入文件不存在 | `no such file or directory` | 確認輸入路徑 |
| 輸出目錄不存在 | `mkdir ...` 錯誤 | 提前創建輸出目錄 |
| 格式不支持 | `Invalid codec` | 確認 FFmpeg 版本支持 |

### 5.3 Go 後端性能未達預期

**症狀**: Go 後端轉換時間比 Bun 後端慢

**分析**:

```bash
# 運行基準測試查看詳情
bun run bench:convert

# 比較輸出結果
cat .planning/phases/06-audio-convert-go/PERF_REPORT.md
```

**可能原因**:
1. 測試音頻文件過短（< 60 秒），Go 啟動開銷主導
2. 系統 CPU 繁忙，影響 Go 進程調度
3. 磁盤 I/O 瓶頸

**優化方案**:
```typescript
// 增加並行度（適用於批量轉換）
const config = new AudioConvertConfig({
  useGoBackend: true,
  maxConcurrency: 8,  // 預設 4，可調高
})
```

### 5.4 回滾至 Bun 後端

若 Go 後端出現問題，可快速回滾:

```bash
# 方式 1: 清除環境變數
unset KINETITEXT_USE_GO_AUDIO

# 方式 2: 顯式禁用
export KINETITEXT_USE_GO_AUDIO=false
bun run src/index.ts

# 方式 3: 修改 .env
# 將 KINETITEXT_USE_GO_AUDIO=true 改為 KINETITEXT_USE_GO_AUDIO=false
```

回滾後所有功能保持不變，僅後端切換至 Bun FFmpeg。

### 5.5 使用 Go binary 進行詳細除錯

**直接測試轉換**:

```bash
# 準備測試文件（使用 FFmpeg 生成靜音音頻）
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 /tmp/test.wav

# 執行 Go 轉換並查看詳細輸出
echo '{
  "input_file": "/tmp/test.wav",
  "output_file": "/tmp/test-out.mp3",
  "format": "mp3",
  "bitrate": 192
}' | ../kinetitext-go/bin/kinetitext-audio

# 預期成功輸出:
# {"success":true,"output_file":"/tmp/test-out.mp3","duration":5.000}

# 驗證輸出文件
ls -la /tmp/test-out.mp3
```

---

## 6. 開發者指南

### 6.1 修改 Go 代碼後重新部署

```bash
# 進入 Go 專案目錄
cd ../kinetitext-go

# 修改代碼後清理並重新編譯
make clean && make build

# 運行 Go 單元測試
go test ./...

# 回到 KinetiText 目錄，運行集成測試
cd ../KinetiText
bun test ./src/tests/integration/AudioConvertGo.test.ts

# 運行完整 E2E 測試套件
bun test ./src/tests/e2e/AudioConvertGo.e2e.ts --timeout=120000
```

### 6.2 添加新的輸出格式支持

如需 Go 後端支持新的輸出格式（例如 M4A）:

**1. 修改 Go 端** (`kinetitext-go/src/audio-convert/converter.go`):

```go
// 在 ConvertAudio 函數中添加新格式處理
switch req.Format {
case "mp3":
    // 現有 MP3 處理
case "m4a":
    // 新增 M4A 處理
    return convertToM4A(req)
}
```

**2. 重新編譯並測試**:

```bash
cd ../kinetitext-go && make build
echo '{"input_file":"test.wav","output_file":"out.m4a","format":"m4a","bitrate":192}' | \
  ./bin/kinetitext-audio
```

**3. 修改 Bun 端**（如需驗證新格式輸出）:

在 `src/core/services/AudioConvertGoWrapper.ts` 的介面中更新支持的格式文檔。

### 6.3 除錯 Go 側問題

**方法 1: 標準 stderr 日誌**

Go 二進制的所有日誌都輸出到 stderr，不干擾 JSON stdout:

```bash
# 查看 Go 二進制的詳細日誌（stderr）
echo '{"input_file":"test.wav","output_file":"out.mp3","format":"mp3","bitrate":192}' | \
  ../kinetitext-go/bin/kinetitext-audio 2>&1 | cat
```

**方法 2: 添加臨時日誌（kinetitext-go/src/audio-convert/main.go）**:

```go
import (
    "fmt"
    "os"
)

func main() {
    // 讀取請求...

    // 添加調試日誌（輸出到 stderr，不影響 JSON 輸出）
    fmt.Fprintf(os.Stderr, "[DEBUG] Converting: %s -> %s\n", req.InputFile, req.OutputFile)

    resp, err := ConvertAudio(req)

    fmt.Fprintf(os.Stderr, "[DEBUG] Result: success=%v, error=%v\n", resp.Success, resp.Error)

    respond(*resp)
}
```

重新編譯後使用。

### 6.4 測試 Go 後端依賴注入

在單元測試中 mock Go 後端（避免依賴真實二進制）:

```typescript
import { AudioConvertService, type AudioConvertServiceDeps } from './AudioConvertService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import type { AudioConvertGoWrapper } from './AudioConvertGoWrapper'

// 創建 mock Go wrapper
const mockGoWrapper = {
  convert: async (req: any) => ({
    success: true,
    outputFile: req.outputFile,
    duration: 5.0,
  }),
  init: async (path: string) => {},
  isAvailable: async () => true,
  getBinaryPath: () => '/mock/path',
} as unknown as typeof AudioConvertGoWrapper

// 注入 mock
const service = new AudioConvertService(
  new AudioConvertConfig({ useGoBackend: true }),
  { goWrapper: mockGoWrapper }
)
```

### 6.5 性能分析工具

使用 Bun 內建性能計時:

```typescript
import { AudioConvertService } from './AudioConvertService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'

async function profileConversion(inputPath: string) {
  const goService = new AudioConvertService(
    new AudioConvertConfig({ useGoBackend: true, goBinaryPath: '...' })
  )
  await goService.initGoBackend()

  const start = performance.now()
  await goService.convertToMp3(inputPath, '/tmp/profile-out.mp3')
  const duration = performance.now() - start

  console.log(`Conversion took: ${duration.toFixed(2)}ms`)
}
```

---

## 7. 常見問題 FAQ

**Q: 啟用 Go 後端後，現有功能會受影響嗎？**

A: 不會。所有現有功能（爬蟲、合併、MP4 轉換等）保持不變。Go 後端僅影響音頻轉換（WAV/AAC/OGG/FLAC → MP3）這個特定步驟。

**Q: 可以混用 Bun 和 Go 後端嗎？**

A: 目前支持全局配置（所有轉換使用相同後端）。若需要逐文件控制，可創建兩個 `AudioConvertService` 實例：一個啟用 Go，一個使用 Bun。

**Q: Go 後端初始化失敗會中斷服務嗎？**

A: 不會。`initGoBackend()` 失敗時，系統自動降級至 Bun FFmpeg 後端，並記錄警告日誌。轉換操作繼續正常進行。

**Q: Go 後端支持哪些輸入格式？**

A: 支持所有 FFmpeg 可解碼的格式。主要測試格式：WAV、AAC、OGG、FLAC。輸出格式目前為 MP3。

**Q: 如果 Go 後端轉換失敗怎辦？**

A: `RetryService` 會自動重試，最多 4 次（含指數退避）。若全部失敗，返回錯誤給調用方。系統**不會**自動切換到 Bun 後端（這是有意設計：如果你顯式啟用了 Go 後端，轉換失敗可能需要你調查原因）。

**Q: 如何確認轉換使用的是 Go 還是 Bun 後端？**

A: 查看結構化日誌（Pino JSON）:

```bash
bun run src/index.ts --crawl ... 2>&1 | grep -E "(Go backend|Bun FFmpeg|audio-convert)"
```

Go 後端成功初始化時會輸出:
```json
{"level":30,"name":"audio-convert","msg":"Go backend initialized successfully","binaryPath":"..."}
```

**Q: Go 後端的 kinetitext-go 倉庫在哪裡？**

A: `kinetitext-go` 是與 `KinetiText` 並列的獨立倉庫，位於 `../kinetitext-go/`（相對於 KinetiText 根目錄）。

**Q: 可以在 CI/CD 中使用 Go 後端嗎？**

A: 可以。確保 CI 環境中:
1. 已安裝 Go 1.20+ 並編譯 `kinetitext-audio` 二進制
2. 設置環境變數 `KINETITEXT_GO_AUDIO_BIN` 指向二進制路徑
3. 或預先編譯二進制並提交到倉庫（需 .gitignore 豁免）

---

## 8. 下一步計劃

### Phase 7: DurationService Go 優化（計劃中）

**目標**: 5-10x 元數據讀取速度提升

**方案**:
- 使用 go-flac（純 Go FLAC 元數據讀取）
- 使用 ffprobe 作為後備（支持所有格式）
- 批量並發讀取（多文件同時讀取元數據）

**預期收益**:
- 當前: 音頻合併前需序列讀取所有文件時長
- 優化後: Go 並發讀取，速度 5-10x 提升
- 影響場景: 大型有聲書合併（100+ 章節）

### Phase 8: MP4ConversionService Go 優化（計劃中）

**目標**: 30-40% M4A 轉換速度提升

**方案**: 複用 Phase 6 的 FFmpeg binding 模式，添加 M4A/MP4 輸出格式支持

---

**最後更新**: 2026-03-26
**文檔狀態**: 與 v1.1 實現同步

**相關文檔**:
- `docs/ARCHITECTURE.md` — 完整架構說明
- `docs/CONFIGURATION.md` — 完整配置選項
- `docs/TROUBLESHOOTING.md` — 通用故障排查
- `docs/API.md` — 完整 API 參考
