# 專案結構與責任邊界

本文件定義 KinetiText 目前的目錄責任、可執行入口與衍生檔規則。整理專案時應先維持這些邊界；跨目錄搬移或合併流程前，必須先以測試證明行為等價。

## 執行入口

`package.json` 是所有受支援指令的唯一入口清單。

| 類別 | 入口 | 責任 |
| --- | --- | --- |
| 爬取 | `src/index.ts` | 組合 adapter、`CrawlerEngine` 與文字儲存，執行小說爬取。 |
| 互動控制台 | `src/tui/index.ts` | 蒐集使用者選項並呼叫既有指令；不實作爬取或轉檔邏輯。 |
| 指令腳本 | `scripts/*.ts` | 解析 CLI 參數、組合服務、呈現結果；可重用邏輯應留在 `src/`。 |

新增指令時，請在 `package.json` 註冊，並同步更新 README 的指令列表。

## 原始碼目錄

| 位置 | 責任 |
| --- | --- |
| `src/core/` | 爬取引擎、跨媒體流程服務、領域型別與核心工具。 |
| `src/adapters/` | 網站特定的爬取規則與 HTTP 輔助；每個 adapter 實作 `NovelSiteAdapter` 並在 `index.ts` 註冊。 |
| `src/storage/` | 持久化格式；實作 `StorageAdapter`。 |
| `src/tts/` | 文字轉語音 provider。 |
| `src/tui/` | 互動式控制台與其動作層。 |
| `src/workflows/` | 被多個指令使用、但不屬於特定服務的工作流程輔助。 |
| `src/cli/` | 共用 CLI 旗標解析與一致的錯誤呈現。 |
| `src/config/` | 設定預設值、環境讀取與服務設定型別。 |
| `src/utils/` | 無領域歸屬的通用工具；不要在此新增站點或媒體流程邏輯。 |

## 腳本與服務的分界

`scripts/` 可以協調使用者輸入和輸出，但不應成為第二套可重用業務實作。若邏輯需要被另一支指令或 TUI 動作使用，應先萃取至對應的 `src/` 模組，並在最低適當層級補上測試。

目前下列流程有相近職責但尚未證明可合併，整理時不得僅因名稱或功能相似而搬移：

- `scripts/retry_failed.ts` 與 `CrawlerEngine` 都會抓取、重試並儲存章節，但重試設定、報告格式與手動補抓語意不同。
- `scripts/yt_pipeline.ts` 與 `MP4Pipeline` 都會產生影音輸出，但前者包含分段、封面與續跑行為。
- `scripts/generate_audiobook.ts` 的 TTS 工作與 `AudioConvertService` 的音訊格式轉換是不同階段。

## 測試佈局

目前測試分成兩個已存在的區域，皆由 `bun test` 執行：

| 位置 | 主要範圍 |
| --- | --- |
| `tests/` | adapter、crawler、workflow、內容清理、TUI 與 M4B 輔助。 |
| `tests/unit/` | 媒體與設定服務的單元測試。 |
| `tests/integration/` | 服務、Go 後端與媒體流程整合測試。 |
| `tests/e2e/` | 需 FFmpeg 的端對端媒體流程測試；Go 路徑另需可選的 sibling binary。 |

所有測試一律放在 `tests/`。新增或修改測試時，將媒體服務測試依上述分層放置；其他測試應放在最接近既有測試範圍的位置。目錄搬移必須獨立成一個可驗證變更，不與行為修改混在一起。

## 文件與衍生檔

- Markdown 是可編輯的文件來源：`README.md`、`AGENTS.md` 與 `docs/*.md`。
- `docs/*.html` 與 `docs/.nojekyll` 由 `bun run build:docs` 產生並提交；修改其對應 Markdown 或文件導覽後，必須重建並檢查差異。
- `docs/adr/` 是手寫架構決策紀錄；`docs/history/` 保存歷史設計與計畫（superpowers 工具已棄用），兩者不會自動加入文件網站導覽。
- `graft/` 是本機可再生的程式碼索引，已被 Git 忽略；修改程式後執行 Graft freshness check，不應手動維護其產物。
- `output/`、暫存檔與本機設定屬執行產物，不納入版本控制。

## 整理順序

1. 先以本文件確認模組的所有權與現有行為。
2. 針對單一候選邊界補齊或確認測試，建立等價行為的證據。
3. 在獨立變更中搬移或合併，保留受支援的 CLI 入口。
4. 執行 `bun test`、`bun run build:docs`，並檢查最終差異與 Graft freshness。
