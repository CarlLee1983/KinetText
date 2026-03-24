# 里程碑 1 路線圖: 爬蟲增強 & 媒體處理

**規劃日期**: 2026-03-24
**里程碑名稱**: 爬蟲增強 & 媒體處理
**預計週期**: 4-6 週 (solo development, flexible)

---

## 整體結構

```
Milestone 1: 爬蟲增強 & 媒體處理
  ├─ Phase 1: 重試機制設計與實現
  ├─ Phase 2: MP3 轉換管道
  ├─ Phase 3: 音頻合併與分組
  ├─ Phase 4: MP4 轉換與集成
  └─ Phase 5: 測試與發佈
```

---

## Phase 1: 重試機制設計與實現

**目標**: 完成可靠的重試系統，支援可配置限制和智能退避

**交付物**:
- [ ] 重試配置模式 (環境變數 + 配置檔)
- [ ] 核心重試邏輯 (指數退避 + 錯誤分類)
- [ ] 日誌記錄和監控
- [ ] 單元測試 (80%+ 覆蓋率)

**依賴關係**: 無 (獨立)

**預計工作量**: 3-4 天

**驗收標準**:
- [ ] 可配置重試上限 (3-10 次) 和退避基數
- [ ] 識別和跳過永久錯誤 (404, 403)
- [ ] 詳細日誌記錄每次嘗試
- [ ] 單元測試驗證所有場景

**關鍵決策**:
- 重試配置儲存位置: `.env` 或 `config.json`?
- 是否實現熔斷器 (Phase 1 中或延遲到 P1)?

---

## Phase 2: MP3 轉換管道

**目標**: 實現音頻格式轉換系統，支援多個輸入格式。整合 Phase 1 重試邏輯，包含時長計算與音頻合併服務。

**依賴**: Phase 1 (日誌和配置系統可重用)

**Requirements:** [R1.2.1, R1.2.2, R1.2.3]

**Plans:** 3 plans

Plans:
- [x] 02-01-PLAN.md — 基礎建設：音頻類型定義、AudioConvertConfig、AudioErrorClassifier ✅
- [x] 02-02-PLAN.md — AudioConvertService 核心轉換引擎與多格式整合測試 ✅
- [x] 02-03-PLAN.md — DurationService 時長計算與 AudioMergeService 合併服務 ✅

**交付物**:
- [ ] FFmpeg 集成 (透過 `Bun.$` 子進程)
- [ ] 音頻轉換函式 (輸入格式 → MP3)
- [ ] 轉換配置 (比特率、採樣率等)
- [ ] 錯誤處理和重試（整合 Phase 1）
- [ ] 時長計算與驗證
- [ ] 音頻合併與分組
- [ ] 集成測試 (5+ 個不同格式)

**預計工作量**: 3-4 天

**驗收標準**:
- [ ] 支援 WAV, AAC, OGG, FLAC → MP3 轉換
- [ ] 輸出檔案大小和品質符合預期
- [ ] 轉換失敗時回退到 Phase 1 重試邏輯
- [ ] 轉換完成時間記錄在日誌中
- [ ] 時長計算誤差 < 1%
- [ ] 分組結果接近目標時長 (容差 ±10%)

**關鍵決策**:
- FFmpeg 調用方式: `Bun.$` (已決定，與現有 scripts/ 一致)
- 預設比特率: 128kbps (已決定)
- 元數據庫: music-metadata (已決定)

**驗證計畫**:
- [ ] 使用樣本音頻檔案測試轉換
- [ ] 驗證輸出品質 (播放測試)
- [ ] 性能基準 (時間、CPU 使用率)

---

## Phase 3: 音頻合併與分組

**目標**: 補充批次合併管道 (mergeBatch)、CLI 時長分組模式、結構化報告輸出，以及後合併時長驗證。核心服務邏輯 (DurationService, AudioMergeService) 已在 Phase 2 完成。

**依賴**: Phase 2 (DurationService, AudioMergeService, RetryService)

**Requirements:** [R1.2.2, R1.2.3]

**Plans:** 2 plans

Plans:
- [x] 03-01-PLAN.md — mergeBatch() 批次管道 + GroupingReport 介面 + 後驗證 + 整合測試 ✅
- [ ] 03-02-PLAN.md — CLI --mode=duration 升級 + formatReport() 人類可讀報告 (Task 1 完成，等待驗證)

**交付物**:
- [ ] mergeBatch() 方法（協調分組→合併→驗證→報告）
- [ ] GroupSummary / GroupingReport 介面
- [ ] 後合併時長驗證（actualDuration via music-metadata）
- [ ] CLI --mode=duration 旗標（保留 --mode=count 向後相容）
- [ ] JSON 與人類可讀格式報告輸出
- [ ] 批次整合測試 (10+ 檔案)

**預計工作量**: 1-2 天

**驗收標準**:
- [ ] mergeBatch() 產生完整 GroupingReport（含 actualDuration 後驗證）
- [ ] 後驗證確認 actualDuration 與 estimatedDuration 誤差 < 1%
- [ ] CLI --mode=duration 使用 mergeBatch 管道
- [ ] CLI --mode=count 行為完全不變
- [ ] --report 旗標輸出 JSON GroupingReport
- [ ] p-limit 防止 100+ 檔案的 EMFILE 錯誤
- [ ] 所有資料結構為 readonly（不可變）

**關鍵決策**:
- 時長計算庫: music-metadata（已決定，Phase 2）
- 合併演算法: 貪心序列（已決定，Phase 2）
- 後驗證方式: music-metadata（非 ffprobe）
- CLI 策略: --mode 旗標升級現有腳本（非新腳本）

**驗證計畫**:
- [ ] 合併 10+ 個檔案並驗證 GroupingReport 完整性
- [ ] 後合併 actualDuration 與 estimatedDuration 對比
- [ ] CLI --dry-run 顯示分組預覽
- [ ] 全套回歸測試通過

---

## Phase 4: MP4 轉換與集成

**目標**: 將合併的 MP3 轉換為 M4A（音頻專用 MP4 容器，AAC 編碼），支援元數據嵌入。整合 Phase 1-3 形成完整音頻管道，提供用戶友善的 CLI 介面。

**依賴**: Phase 3 (MP3 檔案可用)

**Requirements:** [R1.3.1, R1.3.2]

**Plans:** 2 plans

Plans:
- [ ] 04-01-PLAN.md — 核心服務層：MP4ConversionService、MP4ConversionConfig、FFmpeg 命令構建、單元測試
- [ ] 04-02-PLAN.md — 管道整合與 CLI：MP4Pipeline 編排、scripts/mp3_to_mp4.ts 命令行、集成測試與驗證

**交付物**:
- [ ] MP4ConversionService (MP3 → M4A 轉換，支援 AAC 編碼、可配置比特率)
- [ ] MP4ConversionConfig (配置架構、環境變數、Zod 驗證)
- [ ] FFmpeg 命令構建工具 (參數化命令、元數據轉義、安全性)
- [ ] MP4Pipeline (編排：發現→轉換→驗證，支援 dry-run 預覽)
- [ ] CLI scripts/mp3_to_mp4.ts (--input, --output, --metadata, --dry-run 旗標)
- [ ] 中文人類可讀報告輸出 (每個檔案結果、錯誤摘要)
- [ ] 單元測試 (200+ 行，>80% 覆蓋)
- [ ] 集成測試 (用真實 FFmpeg 驗證 M4A 可播性、元數據)

**預計工作量**: 3-4 天 (2 個 Wave，04-01 → 04-02)

**驗收標準**:
- [ ] M4A 檔案可在 VLC、iTunes、Windows Media Player 播放
- [ ] 元數據正確嵌入 (title, artist, album)，能被 music-metadata / ffprobe 讀取
- [ ] 檔案大小合理 (256 kbps AAC ≈ 192 kbps MP3 品質)
- [ ] 完整的爬蟲 → 重試 → 轉換 → 合併 → MP4 工作流程可運行
- [ ] CLI --dry-run 顯示預覽，不執行 FFmpeg
- [ ] 併發轉換 (p-limit) 防止系統過載
- [ ] 所有錯誤分類並可重試（透過 Phase 1 RetryService）

**關鍵決策** (from RESEARCH.md):
- 容器格式: M4A (.m4a 擴展名) 而非通用 MP4，audio-only 內容標準
- 編碼器: AAC (`-c:a aac`)，比 MP3 更高效，低比特率下品質更好
- 比特率: 256 kbps AAC (預設，可配置 96-320 kbps)
- 元數據: FFmpeg `-metadata` 旗標 (文本欄位)，藝術品可選 (AtomicParsley P2)
- 視頻背景: 可選黑幕視頻 (使用 FFmpeg color filter，-shortest 同步)
- 並行轉換: p-limit 2-4 workers (取決於核心數)
- 子進程: Bun.$ (相比 Node.js child_process 快 60%)

**API 決策**:
```typescript
// Phase 04-01
class MP4ConversionService {
  async convert(inputPath, outputPath, metadata?): Promise<MP4ConversionResult>
  async convertBatch(options): Promise<MP4ConversionResult[]>
}

// Phase 04-02
class MP4Pipeline {
  async execute(options: MP4PipelineOptions): Promise<MP4PipelineReport>
}

// CLI
scripts/mp3_to_mp4.ts --input=/path --output=/path [--metadata=/path] [--dry-run]
```

**驗證計畫**:
- [ ] Phase 04-01: 單元測試全部通過，config 驗證工作，FFmpeg 命令轉義檢查
- [ ] Phase 04-02: 集成測試用真實 FFmpeg 創建 M4A，music-metadata 驗證可播性
- [ ] E2E 檢查點: 手動驗證生成的 M4A 可在 VLC/iTunes 播放，元數據可見
- [ ] Phase 04-02 完成後，完整管道 (Phase 1-4) 可透過 CLI 運行

---

## Phase 5: 測試、文檔與發佈

**目標**: 確保所有功能穩定可靠，編寫文檔並準備發佈

**依賴**: Phase 1-4 (所有功能完成)

**交付物**:
- [x] 完整的單元測試套件 (80%+ 覆蓋率) — 374+ 測試 (05-01 ✅)
- [x] 端到端測試 — Phase 2-3 E2E 完成 (05-02 ✅, 32 tests)
- [ ] 性能基準和最佳化報告
- [ ] 使用者文檔 (配置指南、API 文檔)
- [ ] 故障排查指南
- [ ] 發佈準備 (版本控制、標籤)

**預計工作量**: 2-3 天

**驗收標準**:
- [ ] 所有自動化測試通過 (單元 + 集成)
- [ ] 代碼覆蓋率 ≥ 80%
- [ ] 性能基準符合預期 (轉換時間、內存使用)
- [ ] 文檔清晰並包含範例

**發佈檢查清單**:
- [ ] 代碼審查完成
- [ ] 所有問題/TODO 解決或記錄
- [ ] 版本號更新
- [ ] 變更日誌編寫
- [ ] Git tag 建立

---

## 時間表總結

| 階段 | 工作量 | 開始周 | 完成周 | 狀態 |
|------|--------|--------|--------|------|
| Phase 1 | 3-4天 | W1 | W1 | ✅ 完成 |
| Phase 2 | 3-4天 | W1-W2 | W2 | ✅ 完成 |
| Phase 3 | 1-2天 | W3 | W3 | 規劃完成 |
| Phase 4 | 3-4天 | W3-W4 | W4 | 🎯 規劃完成 |
| Phase 5 | 2-3天 | W4-W5 | W5 | 進行中 (05-01✅, 05-02✅) |
| **總計** | **15-20天** | | **4-6 週** | |

---

## 資源與假設

### 資源
- **開發者**: 1 人 (Carl)
- **環境**: Bun runtime, Bun testing
- **外部工具**: FFmpeg (系統安裝或 npm 版本)

### 假設
- FFmpeg 在目標系統中可用
- Bun 子進程 API 穩定可靠
- 沒有其他高優先級中斷工作
- 可以靈活調整完成日期

---

## 風險與緩解

| 風險 | 可能性 | 影響 | 緩解 |
|------|--------|------|------|
| FFmpeg 集成困難 | 中 | 高 | Phase 2 優先進行 PoC，早期發現問題 |
| 音頻時長計算不準 | 低 | 中 | 多格式驗證，對比多個庫 |
| 轉換性能不足 | 低 | 中 | 早期性能基準，評估並行化選項 |
| Bun 相容性問題 | 低 | 高 | 保持與 Node.js 的相容備選方案 |

---

## 下一步

1. **Path 批准**: 確認路線圖和時間表 ✅
2. **開始 Phase 1**: 執行 `/gsd:plan-phase 1` 進行詳細設計 ✅
3. **Phase 1 實現**: 重試機制核心開發 ✅
4. **迭代推進**: 按順序完成後續階段，每個階段結束進行驗證
5. **Phase 4 啟動**: 執行 `/gsd:execute-phase 04` 進行 MP4 轉換實現

---

**文檔簽核**:
- [ ] Carl (開發者)
- [ ] (Code Review, 如需要)

**更新歷史**:
- 2026-03-24: 初始版本，路線圖規劃完成
- 2026-03-24: Phase 2 規劃完成，3 個計畫分 3 個 wave
- 2026-03-24: Phase 3 規劃完成，2 個計畫分 2 個 wave
- 2026-03-24: Phase 4 規劃完成，2 個計畫分 2 個 wave
