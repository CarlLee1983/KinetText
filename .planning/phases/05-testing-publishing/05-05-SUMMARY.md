---
phase: "05-testing-publishing"
plan: "05"
subsystem: "E2E Testing"
tags: [e2e, testing, mp4-conversion, full-pipeline, performance]
dependency_graph:
  requires: ["05-02"]
  provides: ["Phase 4 MP4 E2E 測試", "完整管道 E2E 測試", "性能基準報告"]
  affects: ["05-06", "05-07"]
tech_stack:
  added: []
  patterns: ["E2E Test with Bun:test", "FFmpeg lavfi fixture generation", "music-metadata validation"]
key_files:
  created:
    - src/tests/e2e/MP4Conversion.e2e.ts
    - src/tests/e2e/FullPipeline.e2e.ts
    - .planning/phases/05-testing-publishing/05-05-PERFORMANCE.md
  modified: []
decisions:
  - "使用靜音音頻 (FFmpeg lavfi anullsrc) 生成測試 fixtures 以確保快速、確定性的測試"
  - "E2E 測試使用 bun:test 原生 beforeAll/afterAll 管理臨時目錄生命週期"
  - "FullPipeline 測試跳過 Phase 2 WAV 轉換時直接使用 generateMP3 以加速測試"
metrics:
  duration: "4 分鐘"
  completed: "2026-03-24"
  tasks: 3
  files: 3
---

# Phase 05 Plan 05: Phase 4 E2E 測試與完整管道驗證摘要

**一句話摘要**: Phase 4 MP4 轉換與完整 Phase 1-4 管道的 E2E 測試，共 27 個測試全部通過，轉換效能遠超 30 秒基準（實測 <50ms/靜音檔）。

## 完成工作

### Task 1: Phase 4 E2E 測試 (MP4Conversion.e2e.ts)

建立 274 行的 MP4 轉換 E2E 測試，涵蓋：

- 情景 1：單一 MP3→M4A 轉換基本驗證（M4A 容器格式、非空檔案）
- 情景 2：元資料嵌入（英文 title/artist/album、中文 UTF-8 編碼、全部 7 個欄位）
- 情景 3：批量轉換 `convertBatch()`（3 個並行、部分失敗處理）
- 情景 4：性能基準（5 秒 MP3 < 30 秒、256kbps 檔案大小驗證）

**結果**: 13/13 測試通過（992ms）

### Task 2: 完整管道 E2E 測試 (FullPipeline.e2e.ts)

建立 487 行的完整 Phase 1-4 管道 E2E 測試，涵蓋：

- 情景 1：WAV→MP3→合併 MP3→M4A 完整工作流（3 個 WAV 輸入）
- 情景 2：多輸入格式（WAV 完整流程、直接 MP3 跳過 Phase 2）
- 情景 3：失敗恢復（各服務錯誤拋出驗證、convertBatch 部分失敗不中斷）
- 情景 4：完整性檢查（時長誤差 <5%、GroupingReport 結構、M4A duration>0）
- 情景 5：端到端服務整合（Phase 1-4 全部服務實例化與串聯）

**結果**: 14/14 測試通過（~1.6s）

### Task 3: 性能基準報告 (05-05-PERFORMANCE.md)

生成完整的性能基準報告，包含：
- Phase 4 每個轉換場景的實測時間（40-50ms）
- 完整管道各 Phase 性能佔比分析
- 生產環境估計（11 小時音頻 < 30 秒）
- 可擴展性評估（並行度配置）

## 測試覆蓋總計

| 測試檔案 | 測試數量 | 結果 |
|---------|---------|------|
| MP4Conversion.e2e.ts | 13 | 全部通過 ✅ |
| FullPipeline.e2e.ts | 14 | 全部通過 ✅ |
| **合計** | **27** | **27/27 ✅** |

## 決策

1. **Fixture 生成策略**: 使用 FFmpeg `lavfi anullsrc` 靜音音頻而非真實音頻，確保測試快速（<100ms/轉換）且確定性
2. **E2E 測試結構**: 遵循 `registerE2EHooks()` 模式（來自 setup.ts），每個 describe 塊共用 beforeAll 服務初始化
3. **AudioConvertService API**: 使用 `convertToMp3()` 方法（非 `convert()`），與服務實際介面對齊

## 偏差

**Rule 1 - Bug Fix: 修正 AudioConvertService 方法名稱**

- 找到：測試中使用 `audioConvertService.convert()`，但實際方法名為 `convertToMp3()`
- 修正：所有呼叫改為 `convertToMp3()`
- 影響檔案：src/tests/e2e/FullPipeline.e2e.ts（4 處修正）
- 自動修正（Rule 1）

## Known Stubs

無 — 所有測試均使用真實 FFmpeg 執行，無 mock 或 stub 資料流入測試驗證邏輯。

## Self-Check: PASSED

- [x] src/tests/e2e/MP4Conversion.e2e.ts 存在（274 行，>200 行要求）
- [x] src/tests/e2e/FullPipeline.e2e.ts 存在（487 行，>300 行要求）
- [x] .planning/phases/05-testing-publishing/05-05-PERFORMANCE.md 存在，含 "性能基準"
- [x] Git commits b7dbe7a, 68c5181, 7ef25d4 均存在
- [x] 27 個 E2E 測試全部通過（2.64 秒）
