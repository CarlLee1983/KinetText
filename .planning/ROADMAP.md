# Milestone 2 路線圖: Bun + Go 混用優化 (v1.1)

**規劃日期**: 2026-03-25
**里程碑名稱**: Bun + Go 混用優化
**預計週期**: 4-5 週 (18-23 天實現)
**狀態**: 🚀 規劃完成，準備執行

---

## 整體結構

```
Milestone 2: Bun + Go 混用優化
  ├─ Phase 6: AudioConvertService (Go 遷移) [Week 1-2]
  ├─ Phase 7: DurationService (元數據優化) [Week 3]
  └─ Phase 8: MP4ConversionService (Go 遷移) [Week 4]
```

**Phase 編號說明**: 從 Phase 6 開始（Phase 1-5 屬於 Milestone 1）

---

## Phase 6: AudioConvertService Go 遷移

**目標**: 實現 Go 側 FFmpeg 音頻轉換服務，通過 Bun FFI 調用，實現 30-50% 性能提升

**交付物**:
- [ ] kinetitext-go 項目骨架 (src/audio-convert 模塊)
- [ ] FFmpeg Go binding (github.com/u2takey/ffmpeg-go)
- [ ] Bun FFI 層實現 (src/services/AudioConvertGoWrapper.ts)
- [ ] Bun ↔ Go JSON 通信標準化
- [ ] 性能基準測試 (對比 Bun 版本)
- [ ] 集成測試 (5+ 音頻格式)
- [ ] 文檔 (API, 配置, 故障排查)

**依賴**: 無 (獨立開始)

**預計工作量**: 8-11 天

**驗收標準**:
- [ ] FFmpeg 轉換速度快 30% 以上
- [ ] 進程啟動開銷從 ~100ms 降至 ~1ms
- [ ] 所有測試通過 (100%)
- [ ] 支援 5+ 音頻格式轉換
- [ ] 錯誤正確回傳至 Bun 層

**關鍵決策**:
- FFmpeg 綁定: ffmpeg-go (簡潔, 文檔好)
- IPC 協議: Bun FFI (無序列化開銷)
- 進程模型: 無狀態，按需建立

**驗證計畫**:
- [x] Phase 6-01-PLAN: Go 項目設置 + FFmpeg binding 集成 ✅ (2026-03-25, 6min)
- [ ] Phase 6-02-PLAN: Bun FFI 層 + 基準測試
- [ ] Phase 6-03-PLAN: 集成測試 + 文檔

---

## Phase 7: DurationService 優化

**目標**: 實現 Go 側並發元數據讀取層，優化音頻時長計算，支援 100+ 文件並發讀取

**依賴**: Phase 6 (FFmpeg binding 完成)

**交付物**:
- [ ] Go metadata 並發讀取層 (src/duration-service 模塊)
- [ ] go-flac 集成 (FLAC 元數據)
- [ ] ffprobe 備選方案 (其他格式)
- [ ] Bun DurationManager 層 (委派給 Go)
- [ ] 並發限制和超時機制
- [ ] 集成測試 (100+ 文件)
- [ ] 文檔

**預計工作量**: 7-8 天

**驗收標準**:
- [ ] 100 文件並發讀取 < 2 秒
- [ ] 相比 Bun 版本快 5-10 倍
- [ ] 內存效率提升 50%
- [ ] 所有格式支援 (MP3, FLAC, AAC, OGG)
- [ ] 超時和錯誤處理完善

**關鍵決策**:
- 主庫: go-flac (純 Go 實現)
- 備選: ffprobe (系統命令)
- 並發數: 配置化 (預設 4)

**驗證計畫**:
- [ ] Phase 7-01-PLAN: Go metadata 層 + go-flac 集成
- [ ] Phase 7-02-PLAN: 並發控制 + Bun 層集成 + 基準測試

---

## Phase 8: MP4ConversionService Go 遷移

**目標**: 複用 Phase 6 的 FFmpeg binding，遷移 MP4 (M4A) 轉換至 Go，實現 30-40% 提升

**依賴**: Phase 6 FFmpeg binding 完成

**交付物**:
- [ ] Go MP4 轉換模塊 (src/mp4-convert 模塊)
- [ ] 元數據序列化層 (title, artist, album)
- [ ] Bun MP4Manager 層 (委派給 Go)
- [ ] 集成測試
- [ ] 文檔

**預計工作量**: 3-4 天

**驗收標準**:
- [ ] MP3 → M4A 轉換速度快 30% 以上
- [ ] M4A 文件在 VLC/iTunes 正常播放
- [ ] 元數據正確嵌入
- [ ] 所有測試通過

**關鍵決策**:
- 複用 Phase 6 FFmpeg binding (不重複)
- 元數據用 JSON 序列化

**驗證計畫**:
- [ ] Phase 8-01-PLAN: MP4 轉換服務 + 元數據處理
- [ ] Phase 8-02-PLAN: 集成測試 + 性能驗證

---

## 時間表總結

| 階段 | 工作量 | 開始周 | 完成周 | 狀態 |
|------|--------|--------|--------|------|
| Phase 6 | 8-11天 | W1 | W2 | ⏳ 待執行 |
| Phase 7 | 7-8天 | W3 | W3 | ⏳ 待執行 |
| Phase 8 | 3-4天 | W4 | W4 | ⏳ 待執行 |
| **總計** | **18-23天** | | **4-5 週** | |

---

## 資源與假設

### 資源
- **開發者**: 1 人 (Carl)
- **環境**: Bun 1.0+, Go 1.20+, macOS/Linux
- **外部工具**: FFmpeg (系統安裝或 npm 版本)

### 假設
- FFmpeg 在目標系統中可用
- Bun FFI 穩定可靠 (備選 subprocess JSON)
- Go toolchain 已安裝
- 沒有其他高優先級中斷工作

---

## 風險與緩解

| 風險 | 可能性 | 影響 | 缺解 |
|------|--------|------|------|
| **Bun FFI 不穩定** | 低 | 高 | 備選方案 C (subprocess JSON) |
| **跨平台兼容性** | 中 | 中 | Windows: 預編譯二進制或 subprocess |
| **序列化性能瓶頸** | 低 | 中 | 改用 MessagePack 或 Protocol Buffers |
| **Go 服務掛起** | 低 | 高 | 實現健康檢查與自動重啟 |
| **元數據不一致** | 低 | 中 | 嚴格的 TypeScript 類型檢查 |

---

## 執行檢查清單

### 準備階段 (Week 0)
- [ ] 創建 kinetitext-go 項目骨架
- [ ] 驗證 Bun FFI 在目標平台可用
- [ ] 選定 FFmpeg binding 版本
- [ ] 制定 Rollback 策略

### Phase 6 (Week 1-2)
- [ ] Go FFmpeg binding 完成
- [ ] Bun FFI 層完成
- [ ] 性能基準達到預期 (30-50%)
- [ ] 文檔完成

### Phase 7 (Week 3)
- [ ] Go metadata 層完成
- [ ] 100+ 文件並發測試通過
- [ ] Bun 層集成完成

### Phase 8 (Week 4)
- [ ] MP4 轉換完成
- [ ] 性能基準驗證
- [ ] 最終集成測試

---

## 下一步

1. **啟動 Phase 6 規劃**: 執行 `/gsd:plan-phase 6` 進行詳細設計
2. **創建 kinetitext-go**: Go 項目骨架準備
3. **建立測試框架**: 性能基準和集成測試設置
4. **順序執行**: Phase 6 → Phase 7 → Phase 8

---

**文檔簽核**:
- [ ] Carl (開發者)
- [ ] Architecture Review (已完成 ✅)

**更新歷史**:
- 2026-03-25: 初始版本，Milestone 2 路線圖規劃完成
