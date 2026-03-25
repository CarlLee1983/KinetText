# Milestone 2 需求規範: Bun + Go 混用優化 (v1.1)

**文檔版本**: 1.0
**建立日期**: 2026-03-25
**狀態**: 🚀 進行中

---

## 概覽

Milestone 2 是一個**架構優化里程碑**，通過將 CPU 密集操作遷移至 Go 來提升系統性能，同時保留 Bun 的業務邏輯層。

**核心目標**: 20-35% 整體性能提升 (主要來自音頻處理優化)

---

## 功能需求 (FR)

### FR1: AudioConvertService Go 遷移 ⭐⭐⭐⭐⭐
**描述**: 將 FFmpeg 音頻轉換邏輯從 Bun 移至 Go，減少進程啟動開銷

**驗收標準**:
- [ ] Go FFmpeg binding 集成完成 (ffmpeg-go)
- [ ] Bun FFI 層實現並測試通過
- [ ] 轉換速度相比 Bun 實現快 30% 以上
- [ ] 支援 WAV, AAC, OGG, FLAC → MP3 轉換
- [ ] 所有元數據正確讀取和傳遞
- [ ] 錯誤回傳至 Bun 層用於重試

**優先級**: ⭐⭐⭐⭐⭐
**工作量**: 8-11 天
**依賴**: 無

---

### FR2: DurationService Go 優化 ⭐⭐⭐⭐
**描述**: 實現 Go 側並發元數據讀取層，優化音頻時長計算效率

**驗收標準**:
- [ ] Go 側元數據並發讀取完成 (go-flac)
- [ ] 支援 MP3, FLAC, AAC, OGG 多格式
- [ ] 100+ 文件並發讀取時間降至 1-2 秒
- [ ] 內存效率提升 (相比 JS Promise.all)
- [ ] 錯誤處理和超時機制

**優先級**: ⭐⭐⭐⭐
**工作量**: 7-8 天
**依賴**: FR1 FFmpeg binding

---

### FR3: MP4ConversionService Go 遷移 ⭐⭐⭐⭐
**描述**: 複用 FR1 的 FFmpeg binding，遷移 MP4 (M4A) 轉換邏輯至 Go

**驗收標準**:
- [ ] MP3 → M4A 轉換遷移完成
- [ ] 支援元數據序列化 (title, artist, album)
- [ ] 轉換速度相比 Bun 實現快 30% 以上
- [ ] M4A 文件可在 VLC/iTunes 正常播放
- [ ] 元數據正確嵌入

**優先級**: ⭐⭐⭐⭐
**工作量**: 3-4 天
**依賴**: FR1 FFmpeg binding

---

### FR4: AudioMergeService 輔助優化 ⭐⭐⭐
**描述**: 在 FR2 的基礎上，優化分組和合併的協調邏輯

**驗收標準**:
- [ ] 分組算法遷移至 Go (內存效率)
- [ ] 合併邏輯保留在 Bun (協調簡單性)
- [ ] 分組報告格式標準化 (JSON)
- [ ] 100+ 文件分組時間顯著降低

**優先級**: ⭐⭐⭐
**工作量**: 含 FR2
**依賴**: FR2 完成

---

## 非功能需求 (NFR)

### NFR1: 性能指標
- **FFmpeg 轉換開銷**: 進程啟動 ~100ms → ~1ms (100 倍)
- **轉換總速度**: 當前基準 + 30-50% (AudioConvert), 20-30% (全系統)
- **元數據讀取**: 100 文件並發 5-10s → 1-2s
- **內存使用**: 大批次處理時相比 JS 降低 50%

**測試方法**:
```bash
bun run bench:convert-bun    # 原 Bun 實現
bun run bench:convert-go     # Go 版本
# 驗證: Go 快 30-50%
```

---

### NFR2: 跨平台兼容性
- **Linux**: ✅ 完全支援 (Bun FFI)
- **macOS**: ✅ 完全支援 (Bun FFI, Apple Silicon)
- **Windows**: ⚠️ 備選方案 (subprocess JSON)

---

### NFR3: 可靠性
- **進程生命週期**: Go 服務無狀態，每次調用新實例 (FFI) 或進程 (subprocess)
- **超時處理**: 所有操作設置超時 (AudioConvert: 5min, DurationRead: 30s)
- **錯誤恢復**: Bun 層 RetryService 保留，Go 層只報告成功/失敗

---

### NFR4: 可維護性
- **程式碼分離**: Bun (業務) ↔ Go (計算)，清晰邊界
- **文檔**: 每個 Go 模塊包含完整註解 + API 文檔
- **測試**: 單元測試 (Go) + 集成測試 (Bun→Go)，保持 80%+ 覆蓋率
- **版本相容性**: 保留原 Bun 實現，可 fallback

---

## 範圍確認

### ✅ 包含在內
- AudioConvertService 遷移至 Go
- DurationService 優化至 Go
- MP4ConversionService 遷移至 Go
- kinetitext-go 專案建立和部署
- 性能基準和驗證

### ❌ 不包含 (Milestone 3+)
- ContentCleaner 遷移 (低 ROI)
- CrawlerEngine 重寫 (太複雜)
- Web 儀表板 (新功能)
- 外掛系統 (新架構)

---

## 約束條件

### 技術約束
- **Bun 版本**: 1.0+ (FFI 支援)
- **Go 版本**: 1.20+ (FFmpeg binding 支援)
- **FFmpeg**: 系統安裝或 npm 版本 (保留相容)
- **不能修改**: Bun 側適配器介面 (向後相容)

### 時間約束
- **預計週期**: 4-5 週 (18-23 天實現)
- **Phase 2.1**: Week 1-2
- **Phase 2.2**: Week 3
- **Phase 2.3**: Week 4

### 資源約束
- **開發者**: 1 人 (Carl)
- **外部依賴**: FFmpeg, Go 標準庫, ffmpeg-go

---

## 決策記錄

### 已鎖定決策
- ✅ IPC 協議: Bun FFI 優先
- ✅ FFmpeg 綁定: ffmpeg-go
- ✅ 元數據庫: go-flac 主 + ffprobe 備選
- ✅ 不改造: ContentCleaner, CrawlerEngine

---

## 成功標準

✅ **Milestone 2 完成條件**:
- [ ] Phase 2.1, 2.2, 2.3 全部實現
- [ ] 性能基準達到預期 (20-35% 整體提升)
- [ ] 集成測試全部通過
- [ ] 文檔完整 (API, 配置, 故障排查)
- [ ] Code Review 通過
- [ ] Git 標籤建立 (v1.1)

---

**下一步**: 執行 `/gsd:plan-phase` 啟動 Phase 2.1 規劃
