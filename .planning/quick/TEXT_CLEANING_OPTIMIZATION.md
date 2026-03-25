# KinetiText 文字清理邏輯優化

**日期**: 2026-03-25
**狀態**: ✅ 完成
**相關文件**:
- `src/utils/ContentCleaner.ts` (改進)
- `rules/content-cleaner.json` (擴展)
- `tests/contentCleaner.test.ts` (增強測試)

## 優化摘要

優化了 KinetiText 爬蟲的文字清理邏輯，提升浮水印和干擾文字的移除能力。

## 核心改進

### 1. **全局清理規則系統** 🌍
- 新增 `_global` 規則分類，應用於所有站點
- 所有站點現在自動受益於通用清理模式
- 包括：廣告、頁碼、導航鏈接、編輯註記等

### 2. **擴展的清理規則**

**新增全局浮水印** (自動應用):
```
- 上一章 / 下一章
- 目錄 / 返回目錄
- 書架 / 首頁
- 本章完 / 本章未完 / 未完待續
```

**新增全局正則模式**:
```
- >>章節報錯<<
- 關燈|護眼|字體選項
- AdSense 廣告代碼
- 舊式JS追蹤代碼
- 頁碼模式
```

### 3. **改進的 ContentCleaner 架構**
```typescript
// 優先級順序（新）:
1. 全局精確浮水印
2. 站點特定浮水印
3. 全局正則模式
4. 站點特定正則模式
5. 最後清理多餘換行和空格
```

**新增方法**:
- `addGlobalWatermark(watermark)` - 動態添加全局浮水印
- 改進的空白符清理 (最多2個連續換行)

### 4. **測試覆蓋提升**

從 2 個測試 → **8 個測試**，涵蓋:
- ✅ 全局浮水印移除
- ✅ 站點特定浮水印移除
- ✅ 正則模式匹配
- ✅ 多個浮水印移除
- ✅ 空白符清理
- ✅ 邊界情況 (空內容、僅浮水印等)

**測試結果**: 8/8 通過 ✅

## 技術細節

### ContentCleaner 的新邏輯

```typescript
clean(siteId, text) {
  // 1. 移除全局浮水印
  // 2. 移除站點浮水印
  // 3. 應用全局正則
  // 4. 應用站點正則
  // 5. 清理多餘空白
  // 6. 返回清理後的文本
}
```

### 規則文件結構

```json
{
  "watermarks": {
    "_global": [...],     // 所有站點都移除
    "8novel": [...],      // 只在該站點移除
    "wfxs": [...]
  },
  "noisePatterns": {
    "_global": [...],     // 所有站點都應用
    "8novel": [...]
  }
}
```

## 使用示例

```typescript
import { ContentCleaner } from './src/utils/ContentCleaner';

// 自動應用全局 + 站點特定規則
const cleaned = ContentCleaner.clean('hjwzw', rawContent);

// 動態添加浮水印（當偵測到新模式時）
ContentCleaner.addWatermark('hjwzw', '新的浮水印');
ContentCleaner.addGlobalWatermark('通用浮水印');
```

## 現有集成

ContentCleaner 已被以下適配器使用：
- ✅ HjwzwAdapter
- ✅ EightNovelAdapter
- ✅ WfxsAdapter
- ✅ XswAdapter
- ✅ CzbooksAdapter
- ✅ TwkanAdapter
- ✅ UukanshuAdapter

## 後續建議

1. **監控真實場景** - 收集實際抓取中的新浮水印模式
2. **添加站點特定規則** - 為新站點添加特定規則
3. **性能優化** - 考慮緩存編譯後的正則表達式 (已實現)
4. **規則版本管理** - 在 JSON 中添加版本号以追蹤規則更新
5. **調試工具** - 添加規則測試和驗證工具

## 驗收標準 ✅

- [x] 全局規則系統實現
- [x] 規則文件更新和驗證
- [x] ContentCleaner 改進
- [x] 測試覆蓋達到 8/8
- [x] 所有現有測試仍通過
- [x] 文檔完成

## 性能影響

- **CPU**: 最小化 (規則加載僅一次)
- **內存**: 輕微增加 (約 5-10KB 的額外規則)
- **速度**: 無影響 (相同的正則引擎)

---

**優化完成於**: 2026-03-25 16:30 UTC
