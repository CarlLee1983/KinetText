---
phase: 06-audio-convert-go
plan: 01
subsystem: audio
tags: [go, ffmpeg, ffmpeg-go, bun, subprocess, json-ipc, audio-convert]

requires: []

provides:
  - "kinetitext-go Go 專案骨架 (go.mod, Makefile, bin/kinetitext-audio)"
  - "github.com/u2takey/ffmpeg-go v0.5.0 集成，支援 MP3/AAC/WAV/OGG/FLAC"
  - "AudioConvertGoWrapper Bun 包裝層 (subprocess JSON IPC)"
  - "AudioConvertGoConfig Zod 配置架構"
  - "7 個集成測試驗證 WAV/AAC → MP3、錯誤回傳"

affects:
  - "06-audio-convert-go phase 02 (性能基準)"
  - "06-audio-convert-go phase 03 (集成測試)"
  - "07-duration-service (可複用 Go module 結構)"
  - "08-mp4-convert-go (可複用 FFmpeg binding)"

tech-stack:
  added:
    - "github.com/u2takey/ffmpeg-go v0.5.0 (Go FFmpeg fluent API)"
    - "github.com/u2takey/go-utils v0.3.1 (go-utils 依賴)"
    - "github.com/aws/aws-sdk-go v1.38.20 (ffmpeg-go 間接依賴)"
  patterns:
    - "Go subprocess JSON IPC: kinetitext-go 二進制通過 stdin/stdout 交換 JSON"
    - "Bun FileSink API: proc.stdin.write()/end() 非 WHATWG WritableStream"
    - "ffmpeg-go GlobalArgs(-loglevel, quiet): 抑制 FFmpeg stdout 輸出保持 JSON 純淨"

key-files:
  created:
    - "kinetitext-go/go.mod - Go module 定義"
    - "kinetitext-go/Makefile - build/test/clean 腳本"
    - "kinetitext-go/src/audio-convert/types.go - AudioConvertRequest/Response 類型"
    - "kinetitext-go/src/audio-convert/main.go - JSON I/O 入口點"
    - "kinetitext-go/src/audio-convert/converter.go - FFmpeg-go 轉換核心"
    - "kinetitext-go/src/audio-convert/converter_test.go - 11 個 Go 單元測試"
    - "src/core/services/AudioConvertGoWrapper.ts - Bun subprocess 包裝層"
    - "src/config/AudioConvertGoConfig.ts - Zod 配置架構"
    - "src/tests/integration/AudioConvertGo.test.ts - 7 個集成測試"
  modified: []

key-decisions:
  - "IPC 協議: subprocess JSON 而非 Bun FFI.cdef，穩定性更好、跨平台兼容"
  - "Go 側 -loglevel quiet: 抑制 ffmpeg-go 預設 stdout 輸出，保持 JSON 通信純淨"
  - "Bun stdin API: 使用 FileSink.write/end() 非 WHATWG getWriter()，Bun 1.3 API 差異"
  - "無狀態進程模型: 每次調用啟動新 Go 進程，無連接池，簡化 IPC"

patterns-established:
  - "Go JSON IPC Pattern: AudioConvertRequest/Response snake_case Go ↔ camelCase Bun 轉換"
  - "Bun subprocess stdin 寫入: proc.stdin.write(data); proc.stdin.end() (FileSink API)"
  - "kinetitext-go 目錄結構: src/<service-name>/ 含 main.go/types.go/converter.go/*_test.go"

requirements-completed: [AUDIOGO-01, AUDIOGO-02]

duration: 6min
completed: 2026-03-25
---

# Phase 6 Plan 01: Go 項目骨架 + FFmpeg Binding 集成 Summary

**kinetitext-go Go 專案骨架與 ffmpeg-go v0.5.0 集成完成，WAV/AAC → MP3 通過 Bun subprocess JSON IPC 轉換驗證通過**

## Performance

- **Duration:** 6 分鐘
- **Started:** 2026-03-25T15:44:41Z
- **Completed:** 2026-03-25T15:50:46Z
- **Tasks:** 3
- **Files modified:** 9 (created) / 0 (modified)

## Accomplishments

- 建立 kinetitext-go 獨立 Go 專案 (sibling to KinetiText)，完整 module 初始化、Makefile、目錄結構
- 集成 github.com/u2takey/ffmpeg-go v0.5.0，實現 5 格式支援 (MP3, AAC, WAV, OGG, FLAC)，11 個 Go 單元測試全通過
- 建立 AudioConvertGoWrapper Bun 包裝層，通過 subprocess JSON IPC 調用 Go 二進制，7 個集成測試全通過
- 全套 447 個測試通過 (新增 18 個)

## Task Commits

每個任務原子提交:

1. **Task 1: 建立 kinetitext-go 項目骨架** - `f8ff1a0` (feat) [kinetitext-go repo]
2. **Task 2: 集成 ffmpeg-go 庫** - `43326e0` (feat) [kinetitext-go repo]
   - **偏差修復** - `b55347c` (fix) [kinetitext-go repo] - ffmpeg stdout 污染問題
3. **Task 3: Bun FFI 層包裝** - `1516b40` (feat) [KinetiText repo]

## Files Created/Modified

### kinetitext-go (新 Go 專案)

- `/Users/carl/Dev/Carl/kinetitext-go/go.mod` - Go module 定義 (kinetitext-go, go 1.21)
- `/Users/carl/Dev/Carl/kinetitext-go/go.sum` - 依賴鎖定文件
- `/Users/carl/Dev/Carl/kinetitext-go/Makefile` - build/test/clean 腳本
- `/Users/carl/Dev/Carl/kinetitext-go/.gitignore` - 忽略 bin/ 等生成文件
- `/Users/carl/Dev/Carl/kinetitext-go/README.md` - 使用說明
- `/Users/carl/Dev/Carl/kinetitext-go/src/audio-convert/types.go` - AudioConvertRequest/Response 類型定義
- `/Users/carl/Dev/Carl/kinetitext-go/src/audio-convert/main.go` - JSON stdin/stdout 入口點
- `/Users/carl/Dev/Carl/kinetitext-go/src/audio-convert/converter.go` - ffmpeg-go 轉換核心邏輯
- `/Users/carl/Dev/Carl/kinetitext-go/src/audio-convert/converter_test.go` - 11 個單元測試

### KinetiText Bun 專案 (新增)

- `src/core/services/AudioConvertGoWrapper.ts` - Go 子進程包裝，JSON IPC
- `src/config/AudioConvertGoConfig.ts` - Zod 配置架構
- `src/tests/integration/AudioConvertGo.test.ts` - 7 個集成測試

## Decisions Made

1. **IPC 協議選擇**: 使用 subprocess JSON 而非 Bun FFI.cdef - FFI 需要 cgo C ABI 輸出，配置複雜；subprocess JSON 方案成熟穩定、跨 macOS/Linux/Windows
2. **進程模型**: 無狀態，每次調用啟動新 Go 進程 - 簡化實現，Bun 層用 p-limit 控制並行度
3. **Bun spawn stdin API**: `FileSink.write/end()` 不是 WHATWG WritableStream，`getWriter()` 不存在 (Bun 1.3 特有 API)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ffmpeg-go ErrorToStdOut() 污染 JSON stdout**
- **Found during:** Task 2 (集成 ffmpeg-go 庫)
- **Issue:** ffmpeg-go 預設使用 `.ErrorToStdOut()` 將 FFmpeg 的 verbose log 輸出到 stdout，與 JSON 回應混在一起導致 JSON parse 失敗
- **Fix:** 移除 `.ErrorToStdOut()`，改用 `.GlobalArgs("-loglevel", "quiet")` 抑制 FFmpeg log
- **Files modified:** `kinetitext-go/src/audio-convert/converter.go`
- **Verification:** 集成測試驗證 stdout 僅含純 JSON 回應
- **Committed in:** `b55347c` (修復提交)

**2. [Rule 1 - Bug] Bun subprocess stdin getWriter() API 不存在**
- **Found during:** Task 3 (建立 Bun FFI 層)
- **Issue:** 計畫使用 WHATWG WritableStream API `proc.stdin.getWriter()`，但 Bun 1.3 的 subprocess stdin 是 `FileSink` 類型，無 `getWriter()` 方法
- **Fix:** 改用 `proc.stdin.write(data)` 和 `proc.stdin.end()` (FileSink API)
- **Files modified:** `src/core/services/AudioConvertGoWrapper.ts`
- **Verification:** 7 個集成測試全部通過
- **Committed in:** `1516b40` (Task 3 提交)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** 兩個 bug 都是實作細節差異，不影響架構設計。修復後所有測試通過。

## Issues Encountered

- ffmpeg-go 依賴拉取了 aws-sdk-go 間接依賴 (38MB+)，是 ffmpeg-go 的 S3 功能依賴，不影響使用

## User Setup Required

None - 所有依賴通過 `go get` 和 `bun add` 自動安裝。需要系統已安裝 FFmpeg (`brew install ffmpeg`)。

## Next Phase Readiness

- Go 二進制 `kinetitext-go/bin/kinetitext-audio` 已完成，可接受 JSON 輸入執行轉換
- Bun `AudioConvertGoWrapper` 包裝層完整，可直接集成到現有 AudioConvertService 替換路徑
- Phase 6-02 可進行性能基準測試 (Bun AudioConvertService vs Go AudioConvertGoWrapper 速度對比)
- Phase 7 可複用 kinetitext-go 的 Go module 結構建立 DurationService

---

*Phase: 06-audio-convert-go*
*Completed: 2026-03-25*

## Self-Check: PASSED

- kinetitext-go/go.mod: FOUND
- kinetitext-audio binary: FOUND
- converter.go: FOUND
- AudioConvertGoWrapper.ts: FOUND
- AudioConvertGo.test.ts: FOUND
- SUMMARY.md: FOUND
- Commits f8ff1a0, 43326e0, b55347c (kinetitext-go): FOUND
- Commit 1516b40 (KinetiText): FOUND
