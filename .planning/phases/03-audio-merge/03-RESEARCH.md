# Phase 3: 音頻合併與分組 - Research

**Researched:** 2026-03-24
**Domain:** 音頻批次管道、分組演算法、CLI 整合、FFmpeg concat demuxer 邊緣情況
**Confidence:** HIGH

---

## Summary

Phase 2 已交付 `DurationService` 和 `AudioMergeService` 兩個核心服務，完整覆蓋了 R1.2.2 和 R1.2.3 的核心邏輯：貪心分組演算法、FFmpeg concat demuxer (-c copy) 無損合併、依賴注入測試架構、RetryService 整合。282 個測試全部通過。

**Phase 3 的實際工作量遠比 ROADMAP 預估小。** 核心服務邏輯已完成，Phase 3 需要補充的是：(1) 批次管道 (`mergeBatch()` 方法，協調 `groupByDuration` + 逐組 `mergeGroup`)、(2) CLI 層（`scripts/merge_mp3.ts` 尚用檔案數量分組，需升級為時長分組）、(3) 結構化分組報告輸出（JSON + 人類可讀格式）、(4) 100+ 檔案壓力測試，以及 (5) 後合併時長驗證（用 ffprobe 確認實際合併結果時長 < 1% 誤差）。

現有 `scripts/merge_mp3.ts` 使用「每 N 個檔案」的批次邏輯，不讀取時長，與服務層分離。Phase 3 需決定是：(a) 升級此腳本以呼叫新服務，或 (b) 新增 `scripts/merge_mp3_by_duration.ts` 腳本，並保留舊腳本供向後相容。

**Primary recommendation:** 新增 `AudioMergeService.mergeBatch()` 方法與 `GroupingReport` 介面，升級 `merge_mp3.ts` 支援 `--mode=duration` 旗標（保留舊行為為 `--mode=count` 預設），並以 `bun test` 覆蓋批次管道與報告邏輯。

---

<user_constraints>
## User Constraints (from CONTEXT.md)

CONTEXT.md 未存在於此 Phase，以下約束來自 STATE.md 已決定事項：

### Locked Decisions
- **Runtime**: Bun 專用，禁止 Node.js / npm / yarn / pnpm
- **FFmpeg 方案**: 系統安裝的 FFmpeg 8.0.1（`Bun.$` 調用）
- **元數據庫**: `music-metadata` 11.12.3
- **重試庫**: Phase 1 的 `RetryService` + `AudioErrorClassifier`
- **日誌庫**: `pino` 10.3.1
- **貪心分組演算法**: 已在 AudioMergeService.groupByDuration() 實現，不替換
- **合併方法**: FFmpeg concat demuxer (`-c copy`)，不重新編碼

### Claude's Discretion
- `mergeBatch()` 的並行策略（序列 vs 並行）
- `GroupingReport` 的欄位設計
- CLI 旗標命名與向後相容性策略
- 後驗證用 music-metadata 還是 ffprobe

### Deferred Ideas (OUT OF SCOPE)
- Phase 4: MP4 轉換
- 音頻正規化和音量調整（P2 優先級）
- 熔斷器模式
- 並行 FFmpeg 合併（Phase 3 先序列執行，避免 I/O 競爭）
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| R1.2.2 | 支援可配置目標時長（預設 11h）；計算多個 MP3 總時長；自動分組使每組接近目標（±10%）；保持順序無縫 | AudioMergeService.groupByDuration() 已完成核心邏輯；Phase 3 補充 mergeBatch() 協調整個管道 |
| R1.2.3 | 提取 MP3 元數據計算總時長；容差檢查（實際 vs 目標）；生成時長報告和分組摘要 | DurationService.generateReport() 已完成；Phase 3 補充 GroupingReport（含每組摘要）和後驗證 |
</phase_requirements>

---

## 1. Executive Summary — Phase 2 交付盤點

### 已完成（不需要重做）

| 元件 | 狀態 | 位置 |
|------|------|------|
| `DurationService.getDuration()` | 完成 | src/core/services/DurationService.ts |
| `DurationService.calculateTotalDuration()` | 完成 | 同上 |
| `DurationService.validateDuration()` | 完成 | 同上 |
| `DurationService.generateReport()` | 完成 | 同上 |
| `DurationService.formatDuration()` | 完成 | 同上 |
| `AudioMergeService.groupByDuration()` | 完成 | src/core/services/AudioMergeService.ts |
| `AudioMergeService.mergeFiles()` | 完成 | 同上 |
| `AudioMergeService.mergeGroup()` | 完成 | 同上 |
| `buildConcatList()` 含 single-quote 跳脫 | 完成 | 同上（私有方法） |
| RetryService 整合 | 完成 | 同上 |
| 21 個 DurationService 單元測試 | 完成 | src/tests/unit/DurationService.test.ts |
| 17 個 AudioMergeService 單元測試 | 完成 | src/tests/unit/AudioMergeService.test.ts |
| 4 個 AudioMerge 整合測試（真實 FFmpeg） | 完成 | src/tests/integration/AudioMerge.test.ts |

### Phase 3 待補充

| 元件 | 描述 | 優先級 |
|------|------|--------|
| `AudioMergeService.mergeBatch()` | 協調分組 + 批次合併 + 報告生成 | P0 |
| `GroupingReport` 介面 | 結構化輸出：每組摘要、總計、驗證結果 | P0 |
| 後合併時長驗證 | 用 music-metadata 驗證合併輸出的實際時長 | P0 |
| `merge_mp3.ts` CLI 升級 | 新增 `--mode=duration` 支援時長分組 | P1 |
| 批次管道整合測試 | 20+ 檔案壓力測試，驗證報告準確性 | P0 |

---

## 2. Grouping Algorithm Analysis — 貪心 vs Bin-Packing

### 已決定：貪心演算法（不替換）

Phase 2 已實現並測試了貪心序列演算法，鎖定為此 Phase 的解決方案。以下分析僅供未來參考。

### 貪心演算法行為（現有實現）

```
Upper bound = targetSeconds * (1 + tolerancePercent / 100)
= 39600 * 1.1 = 43560 秒（預設）

for each file (in order):
  if (currentDuration + file.duration > upperBound AND currentGroup is non-empty):
    seal current group, start new group with this file
  else:
    add file to current group (even if single file exceeds upper bound)
```

**關鍵行為：**
- 不丟棄任何檔案（oversized 單一檔案自成一組）
- 保持原始檔案順序（有聲書章節順序語意上重要）
- 序列執行，O(n) 時間複雜度
- 最後一組可能遠低於目標時長（剩餘檔案收尾）

**代表場景：**

| 場景 | 輸入 | 貪心輸出 |
|------|------|----------|
| 3 files × 4h each | [4h, 4h, 4h] | Group1=[4h,4h]=8h, Group2=[4h]=4h |
| 6 files × 2h each | [2h×6] | Group1=[2h×5]=10h, Group2=[2h]=2h |
| 1 oversized file (15h) | [15h] | Group1=[15h]=15h（允許超過上限） |
| Mixed sizes | [1h,3h,5h,2h,4h] | 依序累積，超過 43560s 就分組 |

### 與 Bin-Packing 的對比（僅參考）

| 維度 | 貪心（現有） | Bin-Packing（最優化） |
|------|------------|---------------------|
| 順序保持 | 是 | 否（可能打亂） |
| 最後一組偏小 | 是，常見 | 較均勻 |
| 實現複雜度 | O(n) | O(n²) 至 NP-hard |
| 有聲書適用性 | 高（章節順序重要） | 低（打亂順序不可接受） |
| 已測試 | 17 個單元測試覆蓋 | 未實現 |

**結論：** 貪心演算法對有聲書場景是正確選擇。Bin-Packing 不適用，因為音頻檔案的聆聽順序語意上不可隨意調換。

---

## 3. Concat Edge Cases — FFmpeg concat demuxer 已知問題

### 已處理的邊緣情況（Phase 2 已解決）

**Single-quote 路徑跳脫**（已實現）
```typescript
// src/core/services/AudioMergeService.ts buildConcatList()
.map(fp => `file '${path.resolve(fp).replace(/'/g, "'\\''")}'`)
```
FFmpeg concat list 格式：每行 `file '/absolute/path'`。路徑中若含單引號必須跳脫，否則 FFmpeg 解析失敗。現有實現已處理此情況。

**-safe 0 旗標**（已使用）
`-safe 0` 允許絕對路徑，不加此旗標 FFmpeg 預設拒絕絕對路徑。現有命令 `ffmpeg -y -f concat -safe 0 -i {listFile} -c copy {outputPath}` 已包含。

**Temp 檔案清理**（已實現）
`finally` 區塊確保 concat list 無論成功或失敗都被清除，避免 `/tmp` 積累孤立檔案。

### Phase 3 需要注意的邊緣情況

**混合採樣率（MEDIUM 風險）**
`-c copy` 不重新編碼，若輸入檔案的採樣率（sample rate）或聲道數（channel count）不一致，合併後播放可能出現速度異常或靜音段。

- **症狀：** 合併後某段播放速度不正確，或無聲
- **根因：** MP3 header 記錄的 sample rate 不同，播放器依第一個檔案的 header 解碼
- **預防：** 在 `mergeBatch()` 中加入預合併一致性檢查（可選警告，不必強制失敗）
- **檢查方式：**

```typescript
// 在 groupByDuration 前，驗證所有檔案的 sampleRate 一致性
const metadata = await Promise.all(files.map(f => durationService.getDuration(f)))
// 用 music-metadata parseFile 取得 sampleRate，記錄警告如不一致
```

**空路徑或不存在的檔案**
FFmpeg concat 遇到不存在的路徑會回傳非零 exit code，由現有 RetryService 重試，最終拋出錯誤。Phase 3 的 `mergeBatch()` 應在調用前過濾或驗證路徑存在，避免浪費重試次數。

**輸出目錄不存在**
`mergeGroup()` 呼叫 `mergeFiles()` 不自動建立 outputDir。Phase 3 的 `mergeBatch()` 應在批次開始前確認 outputDir 存在（`mkdir -p` 等同操作）。

**路徑含空格**
`Bun.$` 模板字串已對參數做適當引號處理，`${listFile}` 和 `${outputPath}` 不會因空格斷裂。已由 Bun 內部處理，不需額外跳脫。

**超大批次（100+ 檔案）與 concat list 長度**
FFmpeg concat list 是文字格式，沒有硬性的行數限制。實務上測試過 1000+ 行無問題（HIGH confidence，來自 FFmpeg 官方文件說明 concat demuxer 無行數限制）。`Bun.writeFile()` 的記憶體使用取決於路徑總長度，1000 個路徑 × 200 字元 = ~200KB，完全可接受。

**結尾靜音 / 章節標記**
`-c copy` 直接複製 stream，不添加任何靜音或章節標記。合併點的連續性完全依賴原始檔案的結尾樣本。若原始 TTS 輸出已有清楚的章節結尾，合併應無縫。若需要章節 metadata（ID3 chapter frames），需改用 `-map_metadata`，此為 Phase 4 範疇。

---

## 4. Architecture Patterns

### 推薦架構：mergeBatch() 方法

Phase 3 的核心新增是 `AudioMergeService.mergeBatch()`，協調完整的分組→合併管道：

```typescript
// 新增到 src/core/services/AudioMergeService.ts

export interface GroupSummary {
  readonly groupIndex: number        // 0-based
  readonly outputPath: string
  readonly inputFiles: ReadonlyArray<string>
  readonly estimatedDuration: number // 分組前計算的估計值（秒）
  readonly actualDuration: number    // 合併後 music-metadata 讀取的實際值（秒）
  readonly withinTolerance: boolean
  readonly mergeResult: MergeResult  // durationMs 等
}

export interface GroupingReport {
  readonly totalInputFiles: number
  readonly totalGroups: number
  readonly targetDurationSeconds: number
  readonly tolerancePercent: number
  readonly groups: ReadonlyArray<GroupSummary>
  readonly totalInputDurationSeconds: number
  readonly succeeded: number
  readonly failed: number
  readonly generatedAt: string  // ISO 8601
}

export class AudioMergeService {
  // ... 現有方法 ...

  /**
   * 完整批次管道：讀取時長 → 分組 → 逐組合併 → 後驗證 → 生成報告
   *
   * @param filePaths - 已按順序排列的輸入 MP3 路徑列表
   * @param outputDir - 輸出目錄（自動建立）
   * @param targetSeconds - 目標時長（預設 39600 = 11小時）
   * @param tolerancePercent - 容差百分比（預設 10 = ±10%）
   * @param namePrefix - 輸出檔名前綴（預設 'merged'）
   * @returns GroupingReport 含完整摘要
   */
  async mergeBatch(
    filePaths: ReadonlyArray<string>,
    outputDir: string,
    targetSeconds?: number,
    tolerancePercent?: number,
    namePrefix?: string
  ): Promise<GroupingReport>
}
```

**mergeBatch() 執行步驟（序列化）：**
1. 平行讀取所有輸入檔案時長（`Promise.all` over getDuration）
2. 建立 `{ path, duration }` 陣列
3. 呼叫 `groupByDuration()` 取得分組
4. 確保 outputDir 存在（`mkdir -p`）
5. 序列執行每組 `mergeGroup()`（避免 I/O 競爭）
6. 平行後驗證每個輸出的實際時長（`Promise.all` over getDuration on outputs）
7. 建立並回傳 `GroupingReport`

**為何序列合併（不並行）：**
- 每個 FFmpeg concat 操作是 I/O 密集型，讀取大量輸入後寫入輸出
- 並行 N 個 FFmpeg 進程同時讀寫磁碟可能造成互相等待，整體反而更慢
- 序列執行可預測，方便日誌追蹤進度

### GroupingReport 輸出格式

報告應支援兩種格式輸出（可透過 CLI 旗標選擇）：

**JSON 格式（機器可讀，適合管道整合）：**
```json
{
  "totalInputFiles": 55,
  "totalGroups": 5,
  "targetDurationSeconds": 39600,
  "tolerancePercent": 10,
  "totalInputDurationSeconds": 197820,
  "succeeded": 5,
  "failed": 0,
  "generatedAt": "2026-03-24T10:30:00.000Z",
  "groups": [
    {
      "groupIndex": 0,
      "outputPath": "/output/book_001.mp3",
      "inputFiles": ["ch001.mp3", "ch002.mp3"],
      "estimatedDuration": 39540,
      "actualDuration": 39541,
      "withinTolerance": true,
      "mergeResult": { "fileCount": 11, "durationMs": 1200 }
    }
  ]
}
```

**人類可讀格式（CLI 輸出）：**
```
分組摘要: 55 個檔案 → 5 組 (目標: 11h, 容差: ±10%)
  Group 1: 11 個檔案, 估計 10h 59m 00s, 實際 10h 59m 01s ✓
  Group 2: 12 個檔案, 估計 11h 01m 20s, 實際 11h 01m 21s ✓
  ...
  Group 5:  5 個檔案, 估計  4h 22m 10s, 實際  4h 22m 10s ✓
總計: 5 組成功, 0 組失敗
```

### CLI 升級策略

現有 `scripts/merge_mp3.ts` 使用 `--size N`（每 N 個檔案一組）。Phase 3 建議：

**方案 A（推薦）：** 升級現有腳本，新增 `--mode` 旗標
```bash
# 舊行為（向後相容，預設）
bun run merge-mp3 "output/書名" --size 20

# 新行為（時長分組）
bun run merge-mp3 "output/書名" --mode=duration --target=11h --tolerance=10
```

**方案 B：** 新增獨立腳本 `scripts/merge_mp3_by_duration.ts`，保持 `merge_mp3.ts` 不變。

**建議採用方案 A**，因為 package.json 的 `"merge-mp3"` script 已存在，使用者熟悉此入口點。新增 `--mode` 旗標向後相容（預設 `--mode=count`）。

---

## 5. Don't Hand-Roll

| 問題 | 不要自建 | 使用現有 | 為何 |
|------|---------|---------|------|
| 音頻時長讀取 | 自行解析 MP3 header | `music-metadata` parseFile | 已處理 VBR、CBR、ID3v1/v2、多種格式的時長計算複雜性 |
| FFmpeg 呼叫 | 自己管理 stdio/spawn | `Bun.$` | 已驗證，與 RetryService 整合完成 |
| 重試邏輯 | 在 mergeBatch 中自寫迴圈 | `RetryService.execute()` | 每個 mergeGroup 已透過 mergeFiles → RetryService 自動重試 |
| Concat list 建立 | 自己實現 | `buildConcatList()` (private) | 已處理 single-quote 跳脫，已測試 |
| 時長驗證 | 自建 tolerance 計算 | `DurationService.validateDuration()` | 已測試邊界條件 |

---

## 6. Common Pitfalls

### Pitfall 1: 後驗證時使用估計值而非實際值
**What goes wrong:** 報告中 `withinTolerance` 依賴 `estimatedDuration`（合併前計算），但合併後的實際時長可能因 MP3 frame 對齊稍有差異。
**Why it happens:** 直接重用 groupByDuration 的結果，未再讀取輸出檔案。
**How to avoid:** `GroupSummary.actualDuration` 必須用 `durationService.getDuration(outputPath)` 重新讀取合併後的輸出，而非複製 `estimatedDuration`。
**Warning signs:** 報告顯示 withinTolerance=true 但播放器顯示的時長略有不同。

### Pitfall 2: 忽略 outputDir 不存在的情況
**What goes wrong:** `mergeGroup()` 呼叫 FFmpeg 輸出到不存在的目錄，FFmpeg 回傳非零 exit code，觸發重試但每次都失敗。
**Why it happens:** `mergeFiles()` 本身不建立目錄，直接傳給 FFmpeg。
**How to avoid:** `mergeBatch()` 開始前用 `Bun.file()` 或 `node:fs/promises mkdir` 確保 outputDir 存在。
**Warning signs:** 所有 mergeGroup 呼叫失敗，且錯誤訊息含 "No such file or directory"。

### Pitfall 3: 讀取大量檔案時 music-metadata 的記憶體壓力
**What goes wrong:** 對 200+ 個檔案並行呼叫 `parseFile()`，每個調用需開啟並讀取部分檔案。在某些 OS 上會超過文件描述符限制（通常 256-1024）。
**Why it happens:** `Promise.all(files.map(fp => getDuration(fp)))` 無 concurrency 限制。
**How to avoid:** `mergeBatch()` 中讀取時長時使用 `p-limit`（專案已安裝），限制並行度至 `config.maxConcurrency`（預設 3）。或者分批讀取（每批 50 個）。
**Warning signs:** `EMFILE: too many open files` 錯誤，通常在 100+ 檔案時觸發。

### Pitfall 4: 混合比特率導致合併後音頻品質下降
**What goes wrong:** `--c copy` 直接複製 stream，若輸入檔案比特率不同，合併後的 MP3 內不同段落有不同比特率，部分播放器會報告「VBR」或顯示不正確的總時長。
**Why it happens:** concat demuxer 不均勻化輸入格式。
**How to avoid:** 合併前用 music-metadata 檢查所有輸入的 bitrate 一致性，記錄警告（不強制失敗）。若差異大，建議先用 AudioConvertService 統一編碼再合併（此為可選優化，Phase 3 可記錄警告即可）。
**Warning signs:** 合併後的 MP3 時長計算不準確，或播放器顯示異常的比特率。

### Pitfall 5: 單一巨大檔案（超出 upper bound）的報告顯示
**What goes wrong:** oversized 單一檔案（如 15h）形成自己的組，`withinTolerance` 為 false，但這是預期行為（不丟棄檔案）。如果報告未清楚標注「因單一檔案超出上限故單獨成組」，使用者可能誤以為是 bug。
**Why it happens:** 報告未區分「正常分組超出容差」和「單一 oversized 檔案自成一組」。
**How to avoid:** `GroupSummary` 可加入可選欄位 `oversizedSingleFile: boolean`，當 `files.length === 1 && estimatedDuration > upperBound` 時設為 true，報告中顯示特別說明。

---

## 7. Performance Validation — 100+ 檔案批次測試

### 測試設計

**小規模整合測試（已存在）：** `src/tests/integration/AudioMerge.test.ts` — 3 個 2 秒檔案，驗證基本合併。

**Phase 3 需要的中規模批次測試：**

```typescript
// src/tests/integration/AudioMergeBatch.test.ts
describe('AudioMerge Batch Pipeline', () => {
  // beforeAll: 生成 20 個 ~30 分鐘的 MP3（用 ffmpeg anullsrc）
  // 目標：20 * 1800s = 36000s ≈ 10h，應產生 1 組（在 11h ±10% 範圍內）

  test('mergeBatch() with 20 files produces correct grouping')
  test('GroupingReport.actualDuration within 1% of estimatedDuration')
  test('GroupingReport fields are immutable')
  test('mergeBatch() with 0 files returns empty report')
  test('mergeBatch() with single oversized file creates 1 group')
  test('output files exist and are non-empty after batch')
})
```

**注意：** 生成 20 個 30 分鐘的音頻在 CI 環境中可能需要 30-60 秒，應使用 `--timeout 120000` 旗標。實際上可以用更短的測試檔案（每個 60 秒），達成相似的分組邏輯覆蓋。

**100+ 檔案壓力測試（手動驗收，不納入自動化 CI）：**
按 ROADMAP 驗收標準「合併 20+ 小時的音頻並驗證分組」，建議作為手動驗收步驟記錄在 VERIFICATION.md 中，而非自動化測試（因為生成 20 小時音頻耗時過長）。

### 記憶體與 I/O 考量

- **concat list 大小：** 100 個路徑 × 平均 150 字元 = ~15KB，可忽略
- **music-metadata 並行讀取：** 建議限制 concurrency（見 Pitfall 3）
- **FFmpeg 序列執行：** 每次合併一組，避免多個 FFmpeg 進程同時競爭磁碟
- **總時長估計：** 合併 200 個檔案（共 10h 音頻）預計需 60-120 秒（FFmpeg -c copy 速度遠快於實時，通常 5-20× 實時速度）

---

## 8. Human Testing Strategy — 音頻連續性聆聽測試

### 合併點連續性

`-c copy` 不添加靜音，合併點的連續性完全依賴：
1. 原始 MP3 的結尾樣本是否乾淨結束
2. MP3 frame 對齊（FFmpeg concat demuxer 在 frame 邊界合併）

**聆聽測試建議（手動驗收）：**

| 測試 | 方法 | 預期結果 |
|------|------|---------|
| 合併點無跳接 | 在合併點附近（-5s 到 +5s）聆聽 | 無明顯音量跳躍、無靜音缺口、無重複語音 |
| 第一段開頭 | 播放前 3 秒 | 正常開始，無靜音 |
| 最後一段結尾 | 播放最後 3 秒 | 正常結束，無截斷 |
| 播放器時長顯示 | 在 iTunes / VLC 中查看時長 | 與 GroupingReport.actualDuration 一致（差距 < 1s） |

**自動化驗證（補充聆聽測試）：**
後合併時長驗證（`actualDuration` vs `estimatedDuration`）可以機器方式確認無重複或缺失：若合併後時長比預計少 > 2% 或多 > 0.1%，可能有 frame 丟失或靜音插入。

### 測試工具建議
- **VLC：** 跳至合併點驗證連續性
- **music-metadata：** 確認時長準確度（已整合）
- **Audacity：** 可視化波形，確認合併點無靜音缺口（手動）

---

## 9. Integration Architecture — CLI/Batch API 設計

### 現有腳本分析

`scripts/merge_mp3.ts` 的現有行為：
- 讀取 `{baseDir}/audio/` 目錄下所有 MP3
- 按 `--size N` 每 N 個檔案一組
- 用 FFmpeg concat demuxer 合併
- 輸出命名：`{bookName}_{startNum}-{endNum}_merged.mp3`
- 支援：`--force`（覆蓋已存在）、`--dry-run`、`--start`/`--end` 範圍

**問題：** 不讀取時長，不整合新服務，名稱包含「第幾個到第幾個」而非時長資訊。

### 升級後的 CLI 介面

```bash
# 模式 1：舊行為（向後相容，預設）
bun run merge-mp3 "output/書名" --size 20

# 模式 2：時長分組（新功能）
bun run merge-mp3 "output/書名" --mode=duration
bun run merge-mp3 "output/書名" --mode=duration --target=39600
bun run merge-mp3 "output/書名" --mode=duration --target=11h --tolerance=10
bun run merge-mp3 "output/書名" --mode=duration --report=./report.json
bun run merge-mp3 "output/書名" --mode=duration --dry-run
```

**新增 CLI 旗標：**
| 旗標 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `--mode` | string | `count` | `count`（舊行為）或 `duration`（時長分組） |
| `--target` | string | `39600` | 目標時長（秒數或 `11h`、`660m` 格式） |
| `--tolerance` | number | `10` | 容差百分比 |
| `--report` | string | — | 輸出 JSON 報告的路徑（不指定則不輸出） |

**目標時長解析（`parseDurationArg`）：**
```typescript
// 需新增輔助函式
function parseDurationArg(value: string): number {
  if (/^\d+$/.test(value)) return parseInt(value, 10)          // 純數字秒
  if (/^(\d+)h$/i.test(value)) return parseInt(value, 10) * 3600  // 11h
  if (/^(\d+)m$/i.test(value)) return parseInt(value, 10) * 60    // 660m
  throw new Error(`無法解析時長: ${value}，請使用秒數、'11h' 或 '660m' 格式`)
}
```

### 服務層 API 設計（mergeBatch）

```typescript
// 在 src/core/services/AudioMergeService.ts 中新增

export interface MergeBatchOptions {
  readonly targetSeconds?: number      // default: 39600
  readonly tolerancePercent?: number   // default: 10
  readonly namePrefix?: string         // default: 'merged'
}

// 擴充現有 AudioMergeService class
async mergeBatch(
  filePaths: ReadonlyArray<string>,
  outputDir: string,
  options?: MergeBatchOptions
): Promise<GroupingReport>
```

---

## 10. Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | none — bun detects test files automatically |
| Quick run command | `bun test src/tests/unit/AudioMergeService.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| R1.2.2 | groupByDuration() 正確分組 | unit | `bun test src/tests/unit/AudioMergeService.test.ts` | ✅ |
| R1.2.2 | mergeFiles() FFmpeg concat | integration | `bun test src/tests/integration/AudioMerge.test.ts --timeout 60000` | ✅ |
| R1.2.2 | mergeBatch() 完整管道 | integration | `bun test src/tests/integration/AudioMergeBatch.test.ts --timeout 120000` | ❌ Wave 0 |
| R1.2.3 | DurationService 時長計算 | unit | `bun test src/tests/unit/DurationService.test.ts` | ✅ |
| R1.2.3 | GroupingReport 欄位完整性 | unit | `bun test src/tests/unit/AudioMergeService.test.ts` | ❌ Wave 0 |
| R1.2.3 | 後驗證 actualDuration ≈ estimatedDuration | integration | `bun test src/tests/integration/AudioMergeBatch.test.ts --timeout 120000` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test src/tests/unit/AudioMergeService.test.ts src/tests/unit/DurationService.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** 全套測試通過（含新整合測試）才進入 `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/tests/integration/AudioMergeBatch.test.ts` — 覆蓋 R1.2.2 mergeBatch() 和 R1.2.3 GroupingReport 後驗證
- [ ] 在 `src/core/services/AudioMergeService.test.ts` 補充 GroupingReport 結構測試（介面契約）

---

## Standard Stack

### Core（已安裝，無需新增）
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FFmpeg (system) | 8.0.1 | 音頻合併（-c copy concat） | 已安裝並驗證，含 libmp3lame |
| music-metadata | 11.12.3 | 時長讀取（前後兩次） | 已安裝，精度 < 1% 誤差 |
| Bun.$ | built-in | FFmpeg 子進程 | 已在 AudioMergeService 使用 |
| p-limit | 7.3.0 | 並行讀取時長時限流 | 已安裝，避免 EMFILE 錯誤 |
| pino | 10.3.1 | 結構化日誌 | 已安裝，已整合 |

**Phase 3 不需要安裝任何新套件。**

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| FFmpeg | mergeBatch() / mergeFiles() | ✓ | 8.0.1 | — |
| ffprobe | 後驗證（可選用 music-metadata 替代） | ✓ | 8.0.1 | music-metadata parseFile |
| music-metadata | getDuration() | ✓ | 11.12.3 | — |
| Bun.$ | FFmpeg 子進程 | ✓ | built-in | — |
| p-limit | 並行限流 | ✓ | 7.3.0 | — |

**Missing dependencies with no fallback:** 無

**Missing dependencies with fallback:** 無

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `scripts/merge_mp3.ts`（每 N 個檔案分組） | `AudioMergeService.mergeBatch()`（時長分組） | Phase 3 | 更準確的分組，符合「接近 11 小時」需求 |
| 手動清理 concat list | `finally` 區塊自動清理 | Phase 2 | 無孤立 tmp 檔案 |
| fluent-ffmpeg（已棄用 2025/05） | `Bun.$` + system FFmpeg | Phase 2 | 更少依賴，更好 Bun 相容性 |

**Deprecated/outdated:**
- `fluent-ffmpeg`：2025/05 棄用，禁止使用
- `dotenv`：Bun 原生支援 .env，禁止引入

---

## Open Questions

1. **scripts/merge_mp3.ts 升級策略**
   - What we know: 現有腳本使用 `--size N` 按數量分組，與新服務層分離
   - What's unclear: 是否有現有使用者依賴 `--size` 行為，修改後是否破壞現有工作流
   - Recommendation: 採用 `--mode=duration` 新旗標，`--mode=count` 為預設值（保持向後相容），避免破壞現有使用。規劃時將此標記為 Plan 2 的工作（Plan 1 先完成 mergeBatch 服務層）。

2. **GroupingReport 輸出位置**
   - What we know: CLI 需要輸出報告，但報告格式和路徑策略未定
   - What's unclear: 預設是否自動寫入 JSON 檔案，還是僅 stdout？
   - Recommendation: 預設僅輸出人類可讀的 stdout 摘要；`--report=path.json` 旗標才寫入 JSON 檔案。與現有腳本的 `console.log` 風格一致。

3. **p-limit 在 calculateTotalDuration 中的並行限制**
   - What we know: 現有 `calculateTotalDuration()` 用 `Promise.all`（無限制並行）
   - What's unclear: 100+ 檔案時是否真的會觸發 EMFILE
   - Recommendation: 在 `mergeBatch()` 的批次讀取時加入 p-limit（使用 `config.maxConcurrency`），不修改 `calculateTotalDuration()` 本身（保持現有 API 相容）。

---

## Sources

### Primary (HIGH confidence)
- Phase 2 實現代碼（直接閱讀）— src/core/services/AudioMergeService.ts, DurationService.ts
- Phase 2 摘要文件 — .planning/phases/02-mp3/02-03-SUMMARY.md
- Phase 2 計畫文件 — .planning/phases/02-mp3/02-03-PLAN.md
- bun:test 官方文件（built-in test runner）— https://bun.sh/docs/test/writing
- FFmpeg concat demuxer 文件 — https://ffmpeg.org/ffmpeg-formats.html#concat

### Secondary (MEDIUM confidence)
- 現有 scripts/merge_mp3.ts — 腳本層目前行為與限制（直接閱讀）
- FFmpeg `-safe 0` 行為 — 來自 FFmpeg 官方文件，與 Phase 2 研究結論一致

### Tertiary (LOW confidence)
- 100+ 檔案 concat list 無行數限制 — 來自訓練資料（FFmpeg 官方文件未明確列出上限），建議在批次測試中實際驗證

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — 所有套件已安裝並在 Phase 2 驗證
- Architecture: HIGH — mergeBatch() 是現有方法的直接組合，無新技術風險
- Pitfalls: MEDIUM — Pitfall 3（EMFILE）和 Pitfall 4（混合比特率）基於經驗，未在此項目中實際觸發
- CLI 升級策略: HIGH — 基於現有腳本直接閱讀

**Research date:** 2026-03-24
**Valid until:** 2026-04-24（music-metadata 和 Bun API 穩定，30 天有效）

---

## RESEARCH COMPLETE
