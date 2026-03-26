---
phase: 08-mp4conversionservice-go
plan: 01
subsystem: mp4-conversion
tags: [go, mp4-conversion, metadata, json-ipc, bun-go-hybrid, integration-tests]

requires:
  - phase: 06-audio-convert-go
    provides: "FFmpeg-go binding v0.5.0 in kinetitext-go/go.mod, AudioConvertGoWrapper JSON IPC pattern"

provides:
  - "MP4 conversion Go module (src/mp4-convert) with types.go, converter.go, main.go, converter_test.go"
  - "kinetitext-mp4convert binary compiled and tested"
  - "MP4ConvertGoWrapper Bun subprocess JSON IPC layer (mirrors AudioConvertGoWrapper)"
  - "MP4ConvertGoConfig Zod-based configuration schema"
  - "MP4ConversionService upgraded with Go backend delegation and graceful fallback"
  - "Integration test suite: 11 passing tests covering JSON IPC, metadata embedding, fallback logic"
  - "JSON IPC contract validated: 7 metadata fields serialize correctly (title, artist, album, date, genre, trackNumber, comment)"

affects:
  - "MP4ConversionService can now optionally delegate to Go backend with zero service interruption"
  - "Phase 8-02 will add performance benchmarking and CLI integration"

tech-stack:
  added:
    - "Go: mp4-convert module using ffmpeg-go v0.5.0"
  patterns:
    - "JSON subprocess IPC (stdin/stdout) with snake_case conversion Bun ↔ Go"
    - "Graceful degradation: Go failure → automatic Bun FFmpeg fallback"
    - "Lazy initialization: initGoBackend() explicit call, not constructor async"
    - "Metadata serialization: struct fields vs JSON with proper null handling"

key-files:
  created:
    - "kinetitext-go/src/mp4-convert/types.go - MP4ConvertRequest, MP4MetadataGo, MP4ConvertResponse (30 lines)"
    - "kinetitext-go/src/mp4-convert/converter.go - ConvertMP4(), buildM4AKwArgs(), buildMetadataArgs() (86 lines)"
    - "kinetitext-go/src/mp4-convert/main.go - JSON stdin/stdout entry point (28 lines)"
    - "kinetitext-go/src/mp4-convert/converter_test.go - 10 unit tests (130 lines)"
    - "kinetitext-go/Makefile - Added build-mp4convert target"
    - "kinetitext-go/go.mod - Added github.com/u2takey/ffmpeg-go v0.5.0"
    - "kinetitext-go/bin/kinetitext-mp4convert - Compiled Go binary"
    - "src/config/MP4ConvertGoConfig.ts - Configuration schema (32 lines)"
    - "src/core/services/MP4ConvertGoWrapper.ts - Bun JSON subprocess wrapper (186 lines)"
    - "src/tests/integration/MP4ConvertGo.test.ts - Integration tests (275 lines, 11 tests)"
  modified:
    - "src/core/services/MP4ConversionService.ts - Added Go backend support, initGoBackend(), convertWithGo(), convertToBun()"

key-decisions:
  - "New kinetitext-mp4convert binary (NOT extending kinetitext-audio) for separation of concerns"
  - "Subprocess JSON IPC (proved reliable in Phase 6-7) over Bun FFI.cdef"
  - "Metadata passed via MP4MetadataGo struct (type-safe, matches TypeScript interface)"
  - "Graceful fallback on Go failure: logged warning, automatic Bun path (zero service interruption)"
  - "No concurrency changes: Bun layer handles p-limit, Go handles single conversion"

---

# Phase 8 Plan 01: MP4 Go 轉換服務實現 Summary

**一句話總結**: 創建 Go MP4 轉換模塊(mp4-convert)，實現 Bun 層 JSON 子進程包裝，並集成至 MP4ConversionService，包含 11 個集成測試驗證完整工作流。

## 執行摘要

| 指標 | 數值 |
|------|------|
| 完成任務 | 5/5 |
| Go 單元測試 | 10/10 通過 |
| Bun 集成測試 | 11/11 通過 |
| 執行時間 | 4 分 41 秒 |
| 新增代碼行數 | ~1,200 行 (Go + TypeScript) |
| 提交數 | 3 次 |

## 任務完成情況

### Task 1: 建立 Go MP4 轉換模塊

**提交**: `b2177d9`

建立 `kinetitext-go/src/mp4-convert/` 模塊，包含：

**types.go** (30 行)
- `MP4ConvertRequest`: InputFile, OutputFile, Bitrate, Metadata(optional)
- `MP4MetadataGo`: Title, Artist, Album, Date, Genre, TrackNumber, Comment (全部 omitempty)
- `MP4ConvertResponse`: Success, OutputFile, Error

**converter.go** (86 行)
- `ConvertMP4(ctx, req)`: 主轉換函數，使用 ffmpeg-go 執行 MP3→M4A
- `buildM4AKwArgs(bitrate)`: 構建 AAC 編碼選項（c:a, b:a, movflags）
- `buildMetadataArgs(metadata)`: 構建 -metadata 參數陣列，支援 7 個欄位
- UTF-8 原生支援（無需像 Bun 一樣的特殊轉義）

**main.go** (28 行)
- 讀取 JSON 標準輸入，調用 ConvertMP4()，輸出 JSON 標準輸出

### Task 2: 編譯二進制及單元測試

**提交**: `b2177d9` (同上)

**converter_test.go** (130 行)
- 10 個單元測試：M4A 參數構建、元數據序列化、UTF-8 中文、錯誤處理
- 全部通過，無依賴外部二進制

**Makefile 更新**
- 新增 `build-mp4convert` 目標
- 新增至 `.PHONY` 聲明

**二進制編譯**
- `go mod tidy`: 依賴已解決 (ffmpeg-go v0.5.0)
- `make build-mp4convert`: 編譯成功，3.2MB 二進制
- JSON IPC 驗證: `echo '{}' | kinetitext-mp4convert` → `{"success":false,"error":"..."}`

### Task 3: 實現 Bun 包裝層

**提交**: `72d3584`

**MP4ConvertGoConfig.ts** (32 行)
- Zod schema: enabled, goBinaryPath, timeout(1s-5m, 預設60s)
- 環境變數支援: MP4_GO_ENABLED, MP4_GO_BINARY_PATH, MP4_GO_TIMEOUT_MS
- createMP4ConvertGoConfig() 工廠函數

**MP4ConvertGoWrapper.ts** (186 行)
- 靜態類，管理 kinetitext-mp4convert 子進程
- `convertMP4(req)`: 轉換 camelCase Bun 請求 → snake_case Go → 反序列化
- 元數據字段映射: trackNumber ↔ track_number，移除 undefined 欄位
- `isAvailable()`: 驗證二進制存在
- 完整錯誤日誌（stderr、exit code、JSON 解析失敗）

### Task 4: 集成至 MP4ConversionService

**提交**: `72d3584`

**constructor 變更**
- 新增可選 `goBackendConfig?: MP4ConvertGoConfig` 參數
- 新增 `goWrapper` 和 `goBackendInitialized` 私有欄位

**async initGoBackend(): Promise<void>**
- 檢查 enabled 標誌（disabled 時直接返回）
- 驗證二進制存在，優雅降級至 Bun（無異常）
- 設定二進制路徑（若提供）
- 完整日誌：初始化成功 / 二進制不可用 / 初始化失敗

**convert() 方法重構**
- 優先嘗試 Go 路徑（若 initialized）
- 捕捉異常，記錄警告，自動降級
- 回退至 convertToBun()

**private async convertWithGo()**
- 調用 `goWrapper.convertMP4()`
- 驗證響應成功及輸出文件
- 返回 MP4ConversionResult

**private async convertToBun() (重命名)**
- 原 convert() 邏輯，保留 RetryService 和 FFmpeg 命令構建

### Task 5: 集成測試套件

**提交**: `e909f40`

**MP4ConvertGo.test.ts** (275 行，11 個測試)

**Wrapper 測試** (7 個)
- ✅ `Go 二進制存在且可用` — isAvailable() 驗證
- ✅ `MP3 → M4A 基本轉換成功` — 輸出存在、非零大小
- ✅ `MP3 → M4A 帶元數據轉換成功` — 7 個欄位序列化、ffprobe 驗證
- ✅ `MP3 → M4A 中文元數據轉換成功` — UTF-8 測試 (測試標題、測試作者、測試書籍)
- ✅ `缺少輸入文件回傳錯誤 JSON` — 無異常，response.success=false
- ✅ `空 inputFile 回傳錯誤` — 驗證驗證層
- ✅ `getBinaryPath() 回傳正確路徑` — 路徑管理

**Service 集成測試** (4 個)
- ✅ `MP4ConversionService 可以禁用 Go 後端` — 無 goBackendConfig 時正常工作
- ✅ `Go 後端無法使用時回退至 Bun` — 無效路徑 → initGoBackend() 優雅降級 → convert() 使用 Bun FFmpeg
- ✅ `MP4ConversionService 可以使用 Go 後端進行轉換` — 完整工作流驗證
- ✅ `MP4ConversionService 轉換時支援元數據` — metadata 傳遞驗證

**執行結果**
```
11 pass, 0 fail, 23 expect() calls
執行時間: 500ms
```

## 技術成就

### JSON IPC 契約驗證

**Bun → Go (stdin)**
```json
{
  "input_file": "/path/input.mp3",
  "output_file": "/path/output.m4a",
  "bitrate": 256,
  "metadata": {
    "title": "Chapter 1",
    "artist": "Author",
    "album": "Book",
    "date": "2026-03-26",
    "genre": "Audiobook",
    "track_number": 1,
    "comment": "Optional"
  }
}
```

**Go → Bun (stdout)**
```json
{
  "success": true,
  "output_file": "/path/output.m4a"
}
```

**錯誤回應**
```json
{
  "success": false,
  "error": "FFmpeg 轉換錯誤: ..."
}
```

### 元數據支援

7 個欄位完整支援（與 Phase 6 AudioConvertService 一致）:
- title, artist, album, date, genre, trackNumber (序列化為 track), comment
- UTF-8 原生支援（中文元數據通過完整驗證）
- 可選欄位（omitempty JSON tag）

### 優雅降級機制

**流程**:
1. initGoBackend() 驗證二進制 → 不存在時設置 goWrapper=undefined，無異常拋出
2. convert() 檢查 initialized && goWrapper → 若缺失跳過 Go 路徑
3. convertWithGo() 失敗（I/O 錯誤、JSON 解析等）→ 捕捉異常，記錄警告，返回控制
4. convertToBun() 作為後備路徑，使用 Bun$ FFmpeg 和 RetryService

**零服務中斷**: Go 後端完全不可用時，服務無異常，自動使用 Bun

## 偏差記錄

**Rule 1 - Fix**: 修正 Go convertMP4 簽名

**Issue**: 初始設計使用 `OutputArgs()` API（ffmpeg-go 不支援）
**Fix**: 改用 `GlobalArgs()` 逐個添加 -metadata 參數
**Commit**: b2177d9

## 性能基準（預期）

基於 Phase 6 數據推算：
- 短音頻 (5s): Go ~110-130ms（進程啟動開銷 ~50-80ms 主導）
- 長音頻 (30-60min): Go 預期 10-20% 提升（啟動開銷佔比 <0.1%）
- 實際驗證延至 Phase 8-02

## 向 Phase 8-02 遞交的建議

1. **性能基準測試**: 5s 和 30s 音頻對比 Bun vs Go，類似 Phase 6 PERF_REPORT.md
2. **CLI 集成**: 在 MP4Pipeline 或 scripts/ 中支援 --use-go-mp4 旗標
3. **文檔**: MIGRATION_GUIDE.md 第 3 個使用案例（MP4 Go 遷移）
4. **CrawlerEngine 支援**: 可選配置項支援 MP4 Go 後端（類似 AudioConvertService）

## 自我檢查

### 文件存在性確認

**Go 模塊**
- FOUND: `kinetitext-go/src/mp4-convert/types.go`
- FOUND: `kinetitext-go/src/mp4-convert/converter.go`
- FOUND: `kinetitext-go/src/mp4-convert/main.go`
- FOUND: `kinetitext-go/src/mp4-convert/converter_test.go`
- FOUND: `kinetitext-go/bin/kinetitext-mp4convert` (3.2MB executable)

**Bun 層**
- FOUND: `src/config/MP4ConvertGoConfig.ts`
- FOUND: `src/core/services/MP4ConvertGoWrapper.ts`
- FOUND: `src/core/services/MP4ConversionService.ts` (modified)

**測試**
- FOUND: `src/tests/integration/MP4ConvertGo.test.ts`

### 測試結果確認

**Go 單元測試**
```
10 tests, 10 PASS, 0 FAIL
- TestBuildM4AKwArgs_DefaultBitrate ✅
- TestBuildM4AKwArgs_CustomBitrate ✅
- TestBuildM4AKwArgs_NegativeBitrate ✅
- TestBuildMetadataArgs_EmptyMetadata ✅
- TestBuildMetadataArgs_SingleField ✅
- TestBuildMetadataArgs_AllFields ✅
- TestBuildMetadataArgs_UTF8 ✅
- TestConvertMP4_InvalidInputFile ✅
- TestConvertMP4_EmptyInputFile ✅
- TestConvertMP4_EmptyOutputFile ✅
```

**Bun 集成測試**
```
11 tests, 11 PASS, 0 FAIL, 23 expects
- Go 二進制存在且可用 ✅
- MP3 → M4A 基本轉換成功 ✅
- MP3 → M4A 帶元數據轉換成功 ✅
- MP3 → M4A 中文元數據轉換成功 ✅
- 缺少輸入文件回傳錯誤 JSON ✅
- 空 inputFile 回傳錯誤 ✅
- getBinaryPath() 回傳正確路徑 ✅
- MP4ConversionService 可以禁用 Go 後端 ✅
- Go 後端無法使用時回退至 Bun ✅
- MP4ConversionService 可以使用 Go 後端進行轉換 ✅
- MP4ConversionService 轉換時支援元數據 ✅
```

### 提交確認

- FOUND: `b2177d9` — feat(08-01): Go MP4 轉換模塊
- FOUND: `72d3584` — feat(08-01): Bun 層包裝與 MP4ConversionService 集成
- FOUND: `e909f40` — feat(08-01): 集成測試套件

## 關鍵成功指標

✅ **所有必須品已交付**:
1. Go 二進制 kinetitext-mp4convert 編譯成功
2. MP4ConvertGoWrapper 實現 JSON IPC
3. MP4ConvertGoConfig Zod 配置
4. MP4ConversionService 支援 Go 委派 + 優雅降級
5. 11 個集成測試全部通過

✅ **JSON IPC 契約驗證**: 7 個元數據欄位序列化正確，UTF-8 支援驗證

✅ **零迴歸**: 現有 MP4 測試仍通過（未修改核心邏輯，僅添加委派層）

✅ **向後相容**: MP4ConversionService 舊初始化方式仍有效（goBackendConfig 可選）

## 相關文件

- 全 Go 代碼: `/Users/carl/Dev/Carl/kinetitext-go/src/mp4-convert/`
- Bun 集成: `/Users/carl/Dev/Carl/KinetiText/src/core/services/MP4ConvertGoWrapper.ts`
- 配置: `/Users/carl/Dev/Carl/KinetiText/src/config/MP4ConvertGoConfig.ts`
- 修改服務: `/Users/carl/Dev/Carl/KinetiText/src/core/services/MP4ConversionService.ts`
- 測試: `/Users/carl/Dev/Carl/KinetiText/src/tests/integration/MP4ConvertGo.test.ts`

---

## Self-Check: PASSED

所有文件存在，所有測試通過，提交均已驗證。Phase 8 Plan 01 完全完成。
