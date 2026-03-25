# KinetiText Go 整合架構評估

**評估日期**: 2026-03-25
**決策類型**: 技術架構 (跨里程碑)
**狀態**: 待批准

---

## 執行摘要

**決策**: 採用 **Bun + Go 混用架構** — Bun 負責業務邏輯，Go 負責高效能熱路徑

**預期收益**:
- AudioConvertService FFmpeg 轉換: **30-50% 性能提升** (進程開銷減少)
- DurationService 元數據讀取: **5-10 倍性能提升** (並發 I/O 優化)
- MP4ConversionService: **30-40% 性能提升** (複用 Phase 1 優化)
- **整體爬蟲系統**: **20-35% 性能提升** (音頻處理是主瓶頸)

**實施成本**: 18-23 天 (分 3 個階段)

**啟動時間**: Milestone 2 Phase 1

---

## 架構設計

### 目前架構 (Milestone 1)
```
Bun (TypeScript)
├── CrawlerEngine (並發爬取 5-16)
├── AudioConvertService (Bun.$ FFmpeg)
├── DurationService (music-metadata JS)
├── AudioMergeService (Bun.$ FFmpeg concat)
└── MP4ConversionService (Bun.$ FFmpeg)
```

### 目標架構 (Milestone 2)
```
Bun 主程序
├── CrawlerEngine (不變)
├── 協調層
│   ├── AudioConvertManager (委派給 Go)
│   ├── DurationManager (委派給 Go)
│   ├── AudioMergeManager (委派給 Go)
│   └── MP4ConversionManager (委派給 Go)
│
└── IPC 層 (Bun FFI)
    │
    └── Go 微服務 (kinetitext-go)
        ├── audio-convert (FFmpeg binding)
        ├── duration-service (metadata 並發讀取)
        ├── audio-merge (grouping + concat)
        └── mp4-convert (FFmpeg 轉碼)
```

### 跨語言邊界
```
JSON 通信標準 (TypeScript ↔ Go):

AudioConvertRequest:
  - inputPath: string
  - outputPath: string
  - bitrate: number (kbps)
  - sampleRate: number (Hz)

AudioConvertResponse:
  - success: boolean
  - duration: number (ms)
  - fileSize: number
  - error?: string

DurationRequest:
  - filePaths: string[]

DurationResponse:
  - durations: number[] (ms)
  - errors: {path: string, reason: string}[]
```

---

## 優先級與實施計畫

### 🥇 Phase 1: AudioConvertService (Week 1-2)
**工作量**: 8-11 天
**期望提升**: 30-50% (轉換速度)
**優先級**: ⭐⭐⭐⭐⭐ (最高收益)

**交付物**:
- [ ] Go 項目骨架 (kinetitext-go)
- [ ] FFmpeg Go binding 集成
- [ ] Bun FFI 封裝層
- [ ] 性能基準測試
- [ ] 集成測試 (5+ 音頻格式)

**成功標準**:
- 轉換速度比現有 Bun 實現快 30% 以上
- 進程啟動開銷從 ~100ms 降至 ~1ms
- 所有元數據正確讀取
- Bun 集成無阻塞

---

### 🥈 Phase 2: DurationService + AudioMergeService (Week 3)
**工作量**: 7-8 天
**期望提升**: 20-30% (整體爬蟲)
**優先級**: ⭐⭐⭐⭐ (高收益)

**交付物**:
- [ ] Go metadata 並發讀取層
- [ ] 分組算法優化 (內存效率)
- [ ] 集成測試 (100+ 文件)

**依賴**: Phase 1 FFmpeg binding 完成

---

### 🥉 Phase 3: MP4ConversionService (Week 4)
**工作量**: 3-4 天
**期望提升**: 30-40% (M4A 轉換)
**優先級**: ⭐⭐⭐⭐ (複用架構)

**交付物**:
- [ ] 元數據序列化層
- [ ] FFmpeg 命令構建
- [ ] 集成測試

**依賴**: Phase 1 FFmpeg binding

---

## 不建議改造的模塊

| 模塊 | 原因 | ROI |
|------|------|------|
| **ContentCleaner** | 規則體系複雜，但實際耗時小 (1-5% 總時間) | ⭐ 低 |
| **CrawlerEngine** | 需要重寫所有適配器，網絡是瓶頸 | ⭐ 非常低 |

**建議**: 暫不改造，優先級最低

---

## 實施中的關鍵決策

### 1. IPC 通信協議
**選項**:
- **A: Bun FFI** (直接調用 Go 動態庫) — 推薦
- **B: JSON-RPC over Unix Socket** (進程通信)
- **C: Child Process JSON** (每次啟動新進程)

**決策**: **方案 A (Bun FFI)** 優先，**方案 C** 作為備選

**理由**:
- FFI 無序列化開銷，最快
- Bun 官方支持 (0.7+)
- 大部分音頻操作屬於 I/O 密集，不需要常駐進程

---

### 2. Go 依賴選擇

#### FFmpeg 綁定
| 庫 | 語言 | 優點 | 缺點 |
|------|------|------|------|
| **ffmpeg-go** | Go | 簡潔 API，文檔好 | 略低級 |
| **ffmpeg-next** (Rust FFI) | Rust | 類型安全 | 複雜度高 |

**決策**: `github.com/u2takey/ffmpeg-go` (Go 原生)

#### 元數據庫
| 庫 | 語言 | 優點 | 缺點 |
|------|------|------|------|
| **go-flac** | Go | 純 Go 實現 | 僅支持 FLAC |
| **ffprobe** (subprocess) | — | 支持所有格式 | 需啟動進程 |

**決策**: `go-flac` 作為主，關鍵格式用 ffprobe 備選

---

### 3. 錯誤處理與重試

**策略**: Go 服務應該「傻瓜化」執行，錯誤由 Bun 層处理

```typescript
// Bun 層保留重試邏輯
async function convertAudioWithRetry(input) {
  return await retryService.execute(
    () => audioConvertManager.convert(input),
    { maxRetries: 3, backoff: exponential }
  )
}

// Go 層只報告成功/失敗
// type AudioConvertResponse { success, error }
```

---

### 4. 日誌記錄

**策略**:
- Go 層輸出結構化 JSON (stdout)
- Bun 層解析並通過 Pino 記錄

```json
// Go 輸出範例
{
  "level": "info",
  "timestamp": "2026-03-25T10:30:45Z",
  "service": "audio-convert",
  "event": "conversion_completed",
  "duration_ms": 2345,
  "input_file": "/path/to/input.wav",
  "output_file": "/path/to/output.mp3"
}
```

---

## 風險與緩解

| 風險 | 影響 | 可能性 | 緩解方案 |
|------|------|--------|---------|
| **Bun FFI 不穩定** | Go 服務崩潰 | 低 | 備選方案 C (subprocess) |
| **跨平台兼容性** | Windows 用戶無法使用 | 中 | 預編譯 Go 二進制，或用方案 C |
| **序列化性能瓶頸** | IPC 開銷高於預期 | 低 | 改用 MessagePack 或 Protocol Buffers |
| **Go 服務掛起** | 爬蟲停滯 | 低 | 實現健康檢查與自動重啟 |
| **元數據格式不一致** | 數據損失 | 低 | 嚴格的 TypeScript 類型檢查 |

---

## 測試策略

### 單元測試 (Bun 層)
```typescript
describe('AudioConvertManager', () => {
  it('should delegate to Go service correctly', () => {
    // Mock FFI 調用
  })

  it('should handle Go service errors gracefully', () => {
    // 驗證 fallback 邏輯
  })
})
```

### 集成測試
```typescript
describe('Full audio conversion pipeline', () => {
  it('should convert 5+ audio formats correctly', () => {
    // 實際調用 Go 服務
  })

  it('should maintain metadata integrity', () => {
    // 驗證轉換後的元數據
  })
})
```

### 性能基準
```bash
# 對比 Bun vs Go 實現
bun run bench:convert-bun   # 原始實現
bun run bench:convert-go    # Go 版本
# 期望: Go 快 30-50%
```

---

## 實施檢查清單

### 準備階段
- [ ] 創建 Go 項目骨架 (kinetitext-go)
- [ ] 選定 FFmpeg binding 和元數據庫
- [ ] 驗證 Bun FFI 在目標平台可用
- [ ] 制定 Rollback 策略 (保留原 Bun 實現)

### Phase 1 (AudioConvert)
- [ ] FFmpeg Go binding 集成測試通過
- [ ] Bun FFI 層完成並測試
- [ ] 性能基準達到 30-50% 提升
- [ ] 文檔和範例完成

### Phase 2 (Duration + Merge)
- [ ] Go 並發 I/O 層完成
- [ ] 分組算法優化驗證
- [ ] 集成測試通過 (100+ 文件)

### Phase 3 (MP4Convert)
- [ ] 元數據序列化完成
- [ ] 性能基準驗證

---

## 未來擴展空間

即使 Phase 1-3 完成，以下模塊可在 Milestone 3 考慮改造：

1. **ContentCleaner** — 如果爬蟲規模擴大 (10,000+ 章節)
2. **CrawlerEngine 子功能** — 如某些站點需要特殊的 HTML 解析優化

**原則**: 按實際性能瓶頸優先改造，不做預先優化

---

## 批准清單

- [ ] **Carl** (開發者) — 同意混用策略和優先級
- [ ] **性能驗證** — Phase 1 完成後，性能基準達到期望

---

## 相關文檔

- [ROADMAP.md](./ROADMAP.md) — Milestone 1 完整路線圖
- [PROJECT.md](./PROJECT.md) — 項目願景與原則
- Milestone 2 規劃（待創建）

---

**最後更新**: 2026-03-25
**下一步**: 確認此架構評估，啟動 Milestone 2 規劃
