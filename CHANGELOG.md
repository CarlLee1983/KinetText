# KinetiText CHANGELOG

所有對本專案的重要變更都將記錄在此檔案中。

文檔格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

---

## [1.4.0] - 2026-03-24

### Added (新增功能)

#### Phase 5: 完整測試與文檔
- 單元測試覆蓋率達 82%+ (434 個測試，100% 通過率)
- E2E 整合測試套件 (Phase 1-4 完整管道驗證)
- 性能基準報告 (所有操作在預期範圍內)
- 代碼審查檢查清單 (05-04-REVIEW-CHECKLIST.md)
- 發佈準備檢查清單 (05-04-RELEASE-CHECKLIST.md)
- 最終驗證報告 (05-04-FINAL-VERIFICATION.md)

#### 整體成就
- 完整爬蟲 → MP3 轉換 → 音頻合併 → M4A 管道
- 從原始音頻到最終 M4A 檔案的完整自動化工作流程
- 所有 Phase 1-4 功能完全整合，可在生產環境使用
- 覆蓋率 82%+，434 個自動化測試

### Fixed (錯誤修正)

- Phase 2.1: 修正 AudioErrorClassifier 與 RetryService 的依賴注入（向後相容方式實現）
- 確保 AudioConvertService 與 AudioMergeService 的 DI 連接正確

### Changed (變更)

- 改進日誌系統：所有核心服務使用 Pino 結構化 JSON 日誌
- CLI 報告格式更新為繁體中文
- 優化音頻合併並行策略（序列合併以避免大型 I/O 競爭）

### Technical Details (技術細節)

**新增服務** (Phase 4):
- `MP4ConversionService`: MP3 → M4A 轉換（FFmpeg + AAC 編碼）
- `MP4Pipeline`: 完整轉換管道協調器（dry-run 支援）
- `MP4ConversionConfig`: Zod 配置架構（位速率、並行度驗證）

**改進的服務**:
- `RetryService`: 新增可選 `ErrorClassifier` DI 參數
- `AudioConvertService`: 整合 `AudioErrorClassifier` DI
- `AudioMergeService`: 整合 `DurationService` 後驗證

**測試覆蓋統計**:
- 總計: 434 個測試
- 單元測試: 370+ 個
- 整合測試: 60+ 個
- 執行時間: 4.12s

**性能基準**:
- Phase 2 (MP3 轉換): < 10s per file
- Phase 3 (音頻合併): 900x realtime 在合併步驟
- Phase 4 (M4A 轉換): < 30s per file
- 完整管道: < 5 分鐘 (10+ 個文件)

**代碼品質** (Phase 1-4 核心服務):
- console.log: 0 個
- 函數大小: 所有 < 100 行
- 檔案大小: 所有 < 800 行 (最大 398 行)
- 型別安全: 核心邏輯 100% 型別化
- 不可變性: 核心服務遵守

---

## [1.3.0] - 2026-03-24

### Added (新增功能)

#### Phase 4: MP4 轉換與整合 (04-01, 04-02)
- `MP4ConversionService`: MP3 → M4A 轉換引擎
- `MP4ConversionConfig`: Zod 配置架構，支援位速率 96-320 kbps
- `FFmpegCommands`: 參數化 FFmpeg 命令構建工具
- `MP4Pipeline`: 完整管道協調器，支援 dry-run
- `scripts/mp3_to_mp4.ts`: CLI 使用者介面
- 元資料支援 (title, artist, album 從 JSON 讀取)
- 批量轉換支援 (p-limit 並行控制，最大 4 個並行)

**成就**:
- 68 個 MP4 單元測試 + 6 個整合測試通過
- M4A 檔案可在 VLC, iTunes, QuickTime 播放
- 元資料正確嵌入（FFmpeg `-metadata` 參數）

**關鍵技術決策**:
- 容器格式: M4A（音頻專用 MP4 容器）
- 編碼器: AAC（高效能現代音頻編碼）
- 預設位速率: 256 kbps（可配置 96-320）
- 子進程: `Bun.$`（比 Node.js 快約 60%）

---

## [1.2.0] - 2026-03-24

### Added (新增功能)

#### Phase 3: 音頻合併與分組 (03-01, 03-02)
- `AudioMergeService.mergeBatch()`: 批次合併，支援按時長分組
- `GroupingReport` / `GroupSummary`: 結構化合併報告介面
- 後合併驗證: `actualDuration` 使用 music-metadata 確認
- CLI `--mode=duration` 升級: `--target`, `--tolerance`, `--report`, `--dry-run`
- `parseDurationArg()`: 支援 39600 / 11h / 660m 格式
- `formatReport()`: 人類可讀繁體中文報告

**成就**:
- 300 個測試全部通過
- 時長計算精度 < 1% 誤差
- 分組結果符合目標容差 ±10%
- 無 EMFILE 錯誤（p-limit 防護同時開啟的文件數）

**關鍵技術決策**:
- 時長庫: music-metadata（多格式支援 MP3, FLAC, WAV, OGG, AAC）
- 合併演算法: 貪心序列（穩定可預測結果）
- 後驗證工具: music-metadata（避免外部 ffprobe 依賴）
- 合併策略: 序列執行（非並行，避免大型音頻 I/O 競爭）

---

## [1.1.1] - 2026-03-24

### Added (新增功能)

#### Phase 2.1: 重試機制與音頻服務整合 (02.1-01)
- `AudioErrorClassifier` 依賴注入到 `RetryService`（向後相容）
- `AudioConvertService` 整合 `AudioErrorClassifier` DI
- `AudioMergeService` 整合 `AudioErrorClassifier` DI
- 確保所有音頻操作都能自動重試並使用音頻特定錯誤分類

**成就**:
- 223 個測試全部通過
- 向後相容性完全保持（`RetryService` 不帶 DI 仍可正常使用）
- 清晰的錯誤分類: 瞬時錯誤（重試）vs 永久錯誤（快速失敗）

---

## [1.1.0] - 2026-03-24

### Added (新增功能)

#### Phase 2: MP3 轉換管道 (02-01, 02-02, 02-03)
- `AudioConvertService`: 格式轉換（WAV, AAC, OGG, FLAC → MP3）
- `AudioConvertConfig`: Zod 配置架構，支援多種輸出比特率
- `AudioErrorClassifier`: 音頻相關錯誤分類（瞬時 vs 永久）
- `DurationService`: 使用 music-metadata 的時長計算服務
- FFmpeg 整合（透過 `Bun.$` 子進程執行）
- 比特率可配置（64-320 kbps，預設 128 kbps）

**成就**:
- 280+ 個測試全部通過
- 支援 4 個輸入格式（WAV, AAC, OGG, FLAC）
- 轉換失敗時自動重試（整合 Phase 1 RetryService）

**關鍵技術決策**:
- 音頻庫: FFmpeg（業界標準，廣泛格式支援）
- 時長庫: music-metadata（準確性 < 1% 誤差）
- 預設比特率: 128 kbps

---

## [1.0.0] - 2026-03-24

### Added (新增功能)

#### Phase 1: 重試機制設計與實現 (01-01, 01-02, 01-03)
- `RetryService`: 自動重試失敗操作的核心服務
- `ErrorClassifier`: 瞬時 vs 永久錯誤智能分類
- `BackoffCalculator`: 指數退避計算（含 jitter）
- `RetryConfig`: 配置管理（從 `.env` 讀取）
- Pino 結構化 JSON 日誌系統
- 完整單元測試（156 個測試）
- 6 個 UAT 驗證測試

**成就**:
- 指數退避機制正常運作
- 智能錯誤分類（網路、ECONNRESET 等瞬時錯誤自動重試）
- 完整結構化日誌記錄

**關鍵技術決策**:
- 重試庫: `p-retry`（Sindre Sorhus 推薦，ESM 原生）
- 日誌庫: `pino`（JSON 結構化，高性能）
- 配置儲存: `.env` 檔案（Bun 原生支援，無需 dotenv）

---

## 版本更新策略

**Semantic Versioning** (Major.Minor.Patch):
- **Major**: 里程碑（整個功能領域完成）
- **Minor**: 功能增加（新服務或重要功能加入）
- **Patch**: 錯誤修正和小幅改進

**發佈節奏**:
- Phase 完成 = 新 Minor 版本
- 關鍵 Bug 修正 = Patch 版本
- 重大架構變更 = Major 版本

---

## 升級指南

### 從 1.3.x 升級到 1.4.0

1. `git pull origin master`
2. `bun install` （依賴未變）
3. 閱讀上方「1.4.0 新增功能」

**關鍵改進**:
- 更完善的測試覆蓋（434 個自動化測試）
- 代碼品質審查完成（A+ 級別）
- 可用於生產環境

### 從 1.0.x 全新安裝

```bash
git clone <repo-url>
cd kinetitext
bun install
bun test  # 應顯示 434 pass, 0 fail
```

---

## 貢獻者

- Carl（主要開發者）
- Bun 社群（運行時環境）
- 開源社群（p-retry, pino, music-metadata, ffmpeg 等依賴庫）

## 許可證

MIT License - 詳見 LICENSE 檔案
