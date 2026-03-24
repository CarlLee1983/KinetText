# Phase 04: MP4 轉換與集成 - 研究

**研究日期**: 2026-03-24
**域名**: MP4 音頻容器轉換、元數據嵌入、播放器相容性
**信心度**: HIGH

## Summary

Phase 04 研究 MP3 到 MP4 容器轉換的最佳實踐。核心發現：**M4A 是 audio-only 內容的標準選擇**（用 AAC 編碼），而非通用 MP4；FFmpeg 可完成所有轉換和元數據操作，但元素藝術嵌入需要專門工具；ITunes、Windows Media Player、VLC 等主流播放器全面支援 M4A；AAC 編碼比 MP3 更高效，在相同比特率下品質更優。

**主要建議**：
1. 優先選用 M4A 格式（.m4a 擴展名）+ AAC 編碼，保持與現有 MP3 工作流程相容
2. 使用 FFmpeg `-c:a aac` 進行轉換，支援元數據但需額外工具處理專輯藝術
3. 實現可選黑幕背景視頻功能（使用 FFmpeg color filter），但純音頻 M4A 已是最終格式
4. 驗證 Bun 的 `Bun.$` 與 FFmpeg 8.0.1 的整合（已在系統中可用）

## User Constraints (from CONTEXT.md)

無 CONTEXT.md 檔案找到此階段。

## Phase Requirements

| ID | 描述 | 研究支援 |
|----|------|---------|
| R1.3.1 | MP3 到 MP4 轉換支援靜止或黑幕視頻背景 | M4A + 可選黑幕視頻使用 color filter（本研究涵蓋） |
| R1.3.2 | 元數據支援：標題、藝術家、相冊等 ID3 標籤 | FFmpeg -metadata 旗標可使用，藝術品需要 AtomicParsley 或替代工具（本研究涵蓋） |

## Standard Stack

### Core Libraries
| 庫 | 版本 | 用途 | 為何標準 |
|-----|--------|------|---------|
| **FFmpeg** | 8.0.1 | MP3→MP4/M4A 轉換、元數據編碼、黑幕視頻生成 | 業界標準，功能完整，Bun 相容 |
| **music-metadata** | 11.12.3 | 音頻元數據提取、時長計算 | 多格式支援，已在 Phase 2 整合 |
| **p-limit** | 7.3.0 | 併發控制 | 已在 Phase 2-3 使用，避免 EMFILE 錯誤 |
| **Bun.$ shell** | 1.3.10+ | 子進程執行 | 原生 Bun API，比 Node.js exec 快 60% |

### Supporting Libraries
| 庫 | 版本 | 用途 | 何時使用 |
|-----|--------|------|---------|
| **AtomicParsley** | 系統工具 | 將專輯藝術嵌入 M4A（FFmpeg 限制）| 如需完整藝術品支援，可選 |

### Alternatives Considered
| 替代 | 可使用 | 取捨 |
|------|--------|------|
| MP4 容器 + MP3 編碼 | MP4 + libmp3lame | 不推薦：MP3 在 MP4 中支援不一致，播放器支援差異大 |
| 標準 MP4 (1080p 視頻) | FFmpeg + H.264 + AAC | 可行但過度設計：增加轉換時間 3-5 倍，用戶不需要視頻 |
| fluent-ffmpeg | Node.js FFmpeg wrapper | **避免**：已於 2025 年 5 月棄用 |

**Installation:**
```bash
# FFmpeg（系統安裝或 Homebrew）
brew install ffmpeg  # macOS
# 或系統包管理器

# Bun 依賴（已在 package.json 中）
bun install
```

**Version verification:**
```bash
ffmpeg -version | head -3  # 確認 >= 8.0.1，含 libmp3lame 和 libx264
ffprobe -version | head -3  # 驗證元數據讀取工具可用
bun --version  # 確認 >= 1.3.10
```

**FFmpeg 功能驗證**：
```bash
ffmpeg -codecs | grep aac  # 確認 AAC 編碼可用
ffmpeg -filters | grep color  # 驗證 color filter（黑幕視頻）
```

## Architecture Patterns

### 推薦專案結構
```
src/
├── core/
│   ├── services/
│   │   ├── AudioConvertService.ts       # 已有：MP3→MP3 轉換
│   │   ├── AudioMergeService.ts         # 已有：音頻合併
│   │   ├── DurationService.ts           # 已有：時長計算
│   │   └── MP4ConversionService.ts      # 新增：MP3→MP4/M4A 轉換
│   ├── types/
│   │   └── audio.ts                    # 擴展 MP4ConversionResult
│   └── utils/
│       └── ffmpeg-commands.ts           # FFmpeg 命令構建工具
├── config/
│   └── MP4ConversionConfig.ts           # 新增：MP4 轉換配置
└── tests/
    ├── unit/
    │   └── MP4ConversionService.test.ts
    └── integration/
        └── MP4Conversion.test.ts
```

### Pattern 1: FFmpeg 命令構建

**What:** 安全、可測試的 FFmpeg 命令構建，避免 shell 注入。

**When to use:** 建立複雜的 FFmpeg 命令（轉換 + 元數據 + 視頻）。

**Example:**
```typescript
// Source: FFmpeg documentation + Phase 2 實踐
// 純音頻 M4A 轉換（推薦）
ffmpeg -i input.mp3 -c:a aac -b:a 128k -metadata title="Book Title" output.m4a

// 帶黑幕背景視頻的 MP4（可選）
ffmpeg -f lavfi -i "color=c=black:s=1920x1080:d=600" -i input.mp3 \
  -c:v libx264 -c:a aac -map 0 -map 1 -shortest \
  -metadata title="Book Title" output.mp4

// 元數據嵌入命令
-metadata title="Title" -metadata artist="Artist" -metadata album="Album"
```

### Pattern 2: 錯誤分類與重試

**What:** 延續 Phase 1 RetryService，區分瞬時 vs 永久 FFmpeg 錯誤。

**When to use:** 大規模批量轉換中容錯恢復。

**Example:**
```typescript
// 重試邏輯（已在 Phase 2 AudioConvertService 實現）
const result = await retryService.executeWithRetry(
  async () => {
    await runFFmpegConversion(inputPath, outputPath, config)
  },
  {
    maxAttempts: 3,
    backoff: 'exponential',
    classifier: audioErrorClassifier
  }
)
```

### Pattern 3: 元數據構建與驗證

**What:** 安全建構元數據，驗證合法性，準備 FFmpeg -metadata 旗標。

**When to use:** 從爬蟲元數據映射到 MP4 標籤。

**Example:**
```typescript
interface MP4Metadata {
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly date?: string
  readonly genre?: string
  readonly trackNumber?: number
}

// 安全轉換為 FFmpeg -metadata 旗標
function buildMetadataFlags(meta: MP4Metadata): string[] {
  const flags: string[] = []
  if (meta.title) flags.push(`-metadata title="${escapeMetadata(meta.title)}"`)
  if (meta.artist) flags.push(`-metadata artist="${escapeMetadata(meta.artist)}"`)
  if (meta.album) flags.push(`-metadata album="${escapeMetadata(meta.album)}"`)
  return flags
}
```

### Anti-Patterns to Avoid

- **使用 shell 注入易受攻擊的字符串連接進行 FFmpeg 命令**：改用參數化 Bun.$ 或命令數組
- **MP3 在 MP4 容器中**：播放器支援不一致，容器格式搭配失效；使用 M4A + AAC
- **假設元素藝術可靠地通過 FFmpeg -metadata 嵌入**：使用 AtomicParsley 或驗證工具
- **無同步檢查的視頻合成**：使用 `-shortest` 旗標確保音頻和視頻對齊
- **忽略轉換錯誤，無重試**：整合 Phase 1 RetryService，進行分類錯誤處理

## Don't Hand-Roll

| 問題 | 不要構建 | 改用 | 為何 |
|------|----------|------|------|
| MP4 容器格式化 | 自訂 MP4 原子結構生成器 | FFmpeg（內置 muxer） | 標準合規性複雜，邊界情況眾多 |
| 音頻編碼（MP3→AAC） | 原始 AAC 編碼器實現 | FFmpeg libfdk_aac 或原生 AAC | MDCT、心理聲學複雜，質量差 |
| 元數據嵌入驗證 | 手動 MP4 原子解析 | AtomicParsley（成熟工具）或 FFmpeg -metadata | 高風險非標準輸出 |
| 黑幕視頻生成 | 逐幀合成黑色像素 | FFmpeg color filter (`-f lavfi`) | 性能差，無法利用硬體加速 |
| 併發控制 | 手動 child_process 管理 | p-limit（已在 Phase 2 驗證） | 避免 EMFILE 錯誤，資源洩漏 |

**關鍵見解**：MP4 轉換涉及複雜的容器編碼、元數據原子、編碼器參數。自訂實現非常容易出現邊界情況（損壞播放器、不可見元數據、音視頻不同步）。FFmpeg 和 AtomicParsley 經過數千小時的大規模測試，是正確的選擇。

## Runtime State Inventory

**不適用**：此階段為新功能（無舊 MP4 系統），無需遷移狀態。

## Common Pitfalls

### Pitfall 1：MP3 在 MP4 容器中
**What goes wrong:** 使用 `ffmpeg -i input.mp3 -c:a copy output.mp4` 將 MP3 保留在 MP4 容器中。結果：VLC 播放不出聲，iTunes 無法識別，Windows Media Player 拒絕。

**Why it happens:** MP3 編碼在 MP4 中不是標準軌跡（ISO 14496-12 未定義 MP3 muxing）；播放器針對容器格式的假設不同。

**How to avoid:**
- 優先選用 M4A（.m4a 擴展名）+ AAC 編碼
- 如需 MP4 視頻，轉換為 AAC：`-c:a aac` 而非 `-c:a copy`
- 驗證命令不包含 `-c:a copy -c:v` 混合

**Warning signs:** 轉換完成但播放失敗；某些播放器無聲；元數據未讀取。

### Pitfall 2：FFmpeg -metadata 不嵌入專輯藝術
**What goes wrong:** 使用 `ffmpeg -i input.mp3 -metadata artwork=cover.jpg output.m4a` 期望專輯藝術嵌入，但 M4A 檔案無圖像。

**Why it happens:** FFmpeg 的 MOV/MP4/M4A muxer 對封面藝術支援不完整。-metadata 旗標適用於文本標籤（標題、藝術家），但不適用於二進制附件（影像）。

**How to avoid:**
- 對於文本元數據使用 FFmpeg -metadata（標題、藝術家、相冊、日期）
- 對於專輯藝術，使用 AtomicParsley 或跳過（許多播放器無需視覺展示）
- 驗證命令：`ffmpeg ... -metadata title="X" output.m4a && atomicparsley output.m4a --artwork cover.jpg`

**Warning signs:** 轉換成功，元數據可見，但 iTunes 中無專輯封面；Windows Media Player 缺少圖像。

### Pitfall 3：黑幕視頻不同步（視頻較短）
**What goes wrong:** 使用 `ffmpeg -f lavfi -i color=c=black:s=1920x1080 -i input.mp3 -c:v libx264 -c:a aac output.mp4` 而不指定持續時間。結果：視頻在音頻結束前停止，播放器截斷。

**Why it happens:** color filter 默認無限期生成；音頻流可能長達 10+ 小時。無 `-shortest` 或 duration 同步，視頻會先結束。

**How to avoid:**
- 總是使用 `-shortest` 以音頻長度為準
- 或明確設定持續時間：`-f lavfi -i "color=c=black:s=1920x1080:d=600"` (秒)
- 驗證命令包含 `-shortest` 或 `d=<seconds>`

**Warning signs:** 音頻長於 1 小時；MP4 播放器在完成前停止；檔案大小小於預期（視頻截斷）。

### Pitfall 4：AAC 編碼品質差（使用原生編碼器）
**What goes wrong:** 使用 FFmpeg 原生 AAC 編碼器（`-c:a aac`）轉換低比特率。品質下降，特別是 < 128kbps。

**Why it happens:** FFmpeg 原生 AAC 編碼器並非頂級；在低比特率下，libfdk_aac（更好）遠優於預設。

**How to avoid:**
- 使用 `libfdk_aac`（如可用）：`-c:a libfdk_aac -b:a 128k`
- 回退到原生 AAC：`-c:a aac -b:a 128k`（可接受，>= 96kbps）
- 驗證編碼選項支援 libfdk_aac：`ffmpeg -codecs | grep fdk`

**Warning signs:** 轉換完成但音質不夠；播放時明顯伪像；電話或旁白內容品質差。

### Pitfall 5：並發 FFmpeg 進程導致系統過載
**What goes wrong:** 啟動 10 個 FFmpeg 進程同時轉換，無併發控制。系統 CPU 達 100%，磁碟 I/O 瓶頸，進程相互阻塞。

**Why it happens:** FFmpeg 是 CPU 密集型；每個進程耗用 100-200% CPU（多執行緒）。無限制並發導致競爭。

**How to avoid:**
- 使用 p-limit 限制併發 FFmpeg 進程：`maxConcurrency: 2-4`（取決於核心數）
- 監控 CPU 和磁碟：如果 > 80%，降低併發
- 驗證實裝在 Phase 2 中：`AudioConvertConfig.maxConcurrency`

**Warning signs:** 系統掛起；FFmpeg 進程響應慢；整體轉換時間超過預期。

## Code Examples

### MP3 到 M4A 轉換（推薦）
```typescript
// Source: FFmpeg documentation + Bun shell API
// 純音頻 M4A 轉換，支援元數據，快速（無視頻編碼）

import { $ } from 'bun'

async function convertMP3toM4A(
  inputPath: string,
  outputPath: string,
  metadata: { title?: string; artist?: string; album?: string } = {}
): Promise<void> {
  const metadataFlags: string[] = []
  if (metadata.title) metadataFlags.push(`-metadata title="${metadata.title}"`)
  if (metadata.artist) metadataFlags.push(`-metadata artist="${metadata.artist}"`)
  if (metadata.album) metadataFlags.push(`-metadata album="${metadata.album}"`)

  const cmd = `ffmpeg -y -i "${inputPath}" -c:a aac -b:a 128k ${metadataFlags.join(' ')} "${outputPath}"`

  const result = await $`bash -c ${cmd}`.quiet()
  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg M4A conversion failed: ${result.stderr.toString()}`)
  }
}
```

### MP3 到 MP4（帶黑幕視頻，可選）
```typescript
// Source: FFmpeg documentation + color filter
// 適用於視頻平台（YouTube、媒體庫展示）

async function convertMP3toMP4WithVideo(
  inputAudioPath: string,
  outputPath: string,
  options: { width?: number; height?: number; metadata?: Record<string, string> } = {}
): Promise<void> {
  const width = options.width ?? 1920
  const height = options.height ?? 1080
  const metadataFlags = Object.entries(options.metadata ?? {})
    .map(([k, v]) => `-metadata ${k}="${v}"`)
    .join(' ')

  const cmd = `ffmpeg -f lavfi -i "color=c=black:s=${width}x${height}" -i "${inputAudioPath}" \
    -c:v libx264 -preset fast -c:a aac -b:a 128k -map 0 -map 1 -shortest \
    ${metadataFlags} "${outputPath}"`

  const result = await $`bash -c ${cmd}`.quiet()
  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg MP4 conversion failed: ${result.stderr.toString()}`)
  }
}
```

### 使用 music-metadata 驗證轉換結果
```typescript
// Source: Phase 2 實踐 + music-metadata API
// 驗證轉換後的時長和元數據

import { parseFile } from 'music-metadata'

async function validateMP4Conversion(filePath: string): Promise<{
  duration: number
  codec: string
  bitrate: number
}> {
  const metadata = await parseFile(filePath)
  const duration = metadata.format.duration ?? 0
  const codec = metadata.format.codec ?? 'UNKNOWN'
  const bitrate = metadata.format.bitrate ?? 0

  if (duration === 0) {
    throw new Error('轉換驗證失敗：無法讀取時長')
  }

  return { duration, codec, bitrate }
}
```

### 併發批次轉換
```typescript
// Source: Phase 2 實踐 + p-limit
// 安全併發處理多個檔案

import pLimit from 'p-limit'

async function batchConvertToM4A(
  inputPaths: string[],
  outputDir: string,
  maxConcurrency: number = 2
): Promise<void> {
  const limiter = pLimit(maxConcurrency)

  const tasks = inputPaths.map(inputPath =>
    limiter(() =>
      convertMP3toM4A(
        inputPath,
        `${outputDir}/${path.basename(inputPath, '.mp3')}.m4a`
      )
    )
  )

  await Promise.all(tasks)
}
```

## State of the Art

| 舊方法 | 當前方法 | 變更時間 | 影響 |
|--------|----------|---------|------|
| MP3 作為最終音頻格式 | M4A (AAC in MP4) 為音頻首選 | 2006+ (iTunes) | 更好的品質/比特率，更好的元數據支援 |
| fluent-ffmpeg Node 包 | Bun.$ 原生 shell API | 2023+ (Bun 1.0) | 更快、更少依賴、更簡單 |
| FFmpeg -c:a copy for MP3→MP4 | FFmpeg -c:a aac for MP3→M4A | 2012+ (MP3 in MP4 限制) | 避免播放器相容性問題 |
| 手動 XML 原子編輯用於元數據 | FFmpeg -metadata + AtomicParsley | 2015+ | 更安全、可靠、可維護 |

**廢棄/過時**：
- **fluent-ffmpeg** (Node.js)：已於 2025 年 5 月棄用；改用 Bun.$ 或其他現代 FFmpeg 包裝器
- **MP3 在 MP4 容器**：播放器支援差異；改用 M4A (AAC)
- **命令行字符串連接**：改用參數化 Bun.$ 或陣列以避免注入

## Open Questions

1. **Bun.$ 與 FFmpeg 8.0.1 整合（Apple Silicon 版）**
   - 已知：Bun 1.3.10 支援 subprocess；FFmpeg 8.0.1 在 macOS arm64 可用
   - 未驗證：Bun.$ 與多小時的 MP3→MP4 串流音頻穩定性（Phase 4 PoC 需要）
   - 建議：早期測試 1-2 小時音頻轉換

2. **專輯藝術嵌入：FFmpeg vs AtomicParsley 與 Phase 4 範疇**
   - 已知：FFmpeg -metadata 無法嵌入圖像；AtomicParsley 可行但為額外工具
   - 未決策：是否應納入 AtomicParsley 作為依賴？
   - 建議：在需求清單中追踪為 P2（可選），提供無藝術的快速路徑

3. **黑幕視頻轉換性能基準**
   - 已知：FFmpeg color filter 快速；H.264 編碼 CPU 密集
   - 未衡量：10 小時音頻 + 黑幕 1080p 視頻的轉換時間（RTF）
   - 建議：Phase 4 實裝 + 效能測試

## Environment Availability

| 依賴 | 所需功能 | 可用 | 版本 | 後備 |
|------|---------|------|------|------|
| FFmpeg | MP3→MP4/M4A 轉換、視頻合成、元數據 | ✓ | 8.0.1 | — |
| ffprobe | 音頻元數據驗證 | ✓ | 8.0.1 | — |
| Bun | 子進程執行 (Bun.$) | ✓ | 1.3.10 | Node.js child_process（較慢 60%） |
| music-metadata | 時長驗證 | ✓ | 11.12.3 | — |
| p-limit | 併發控制 | ✓ | 7.3.0 | — |

**無後備的遺漏依賴**：無

**有後備的遺漏依賴**：無

## Validation Architecture

### Test Framework
| 屬性 | 值 |
|------|-----|
| Framework | Bun:test |
| Config file | 預設 (bun.toml 中 test) |
| Quick run command | `bun test src/tests/unit/MP4ConversionService.test.ts -t "basic conversion"` |
| Full suite command | `bun test src/tests/` |

### Phase Requirements → Test Map
| Req ID | 行為 | 測試類型 | 自動化命令 | 檔案存在? |
|--------|------|---------|-----------|---------|
| R1.3.1 | MP3→MP4 轉換完成，無視頻誤差 | 整合 | `bun test src/tests/integration/MP4Conversion.test.ts::convertWithBlackVideo -x` | ❌ Wave 0 |
| R1.3.2 | 元數據嵌入（標題、藝術家、相冊），驗證 ffprobe 可讀取 | 整合 | `bun test src/tests/integration/MP4Conversion.test.ts::metadataEmbedding -x` | ❌ Wave 0 |
| 後備 | 併發轉換 (10 檔案，p-limit=2) 成功率 100% | 整合 | `bun test src/tests/integration/MP4Conversion.test.ts::batchConvert -x` | ❌ Wave 0 |
| 後備 | 轉換失敗時 RetryService 分類和重試 | 單元 | `bun test src/tests/unit/MP4ConversionService.test.ts::errorRetry -x` | ❌ Wave 0 |

### Sampling Rate
- **每個任務提交**：`bun test src/tests/unit/MP4ConversionService.test.ts -t "metadata"` (< 10 秒)
- **每個 wave 合併**：`bun test src/tests/` (所有單元 + 整合，< 120 秒)
- **階段門檻**：提交 `/gsd:verify-work` 前全套綠色測試

### Wave 0 Gaps
- [ ] `src/tests/unit/MP4ConversionService.test.ts` — 覆蓋 R1.3.1, R1.3.2, 錯誤分類
- [ ] `src/tests/integration/MP4Conversion.test.ts` — 端到端轉換 + 元數據驗證 + 批次
- [ ] `src/core/services/MP4ConversionService.ts` — 實裝轉換邏輯
- [ ] `src/config/MP4ConversionConfig.ts` — 可配置比特率、分辨率、併發

## Sources

### Primary (HIGH confidence)
- **FFmpeg 8.0.1 Official** (https://ffmpeg.org) — MP3→MP4/M4A 轉換、元數據、color filter
- **music-metadata 11.12.3** (npm) — 時長驗證，已在 Phase 2 驗證
- **Bun 1.3.10 子進程 API** (https://bun.com/docs/runtime/child-process) — Bun.$ shell 執行

### Secondary (MEDIUM confidence)
- [M4A vs MP4 容器格式](https://www.filetoolworks.com/blog/m4a-vs-mp4) — M4A 為 audio-only 標準，.m4a 擴展名信號
- [FFmpeg MP3→M4A 轉換](https://gist.github.com/gvoze32/3cf2537af47f40dc20360e5e0d3e9eb4) — 命令示例，-c:a aac
- [AAC vs MP3 編碼品質](https://convertio.com/aac-to-mp3/format-comparison) — AAC 在低比特率 (< 128kbps) 優於 MP3
- [FFmpeg 黑幕視頻](https://gist.github.com/basperheim/2cd8b2ffe2e89b3ce7dc140cde23c85b) — color filter, -shortest
- [iTunes/Windows Media Player/VLC 相容性](https://www.anymp4.com/player/m4a-player.html) — M4A 普遍支援
- [FFmpeg 元數據限制](https://copyprogramming.com/howto/ffmpeg-how-to-embed-cover-art-image-to-m4a) — -metadata 適用於文本，不適用於影像；使用 AtomicParsley
- [Bun 子進程性能](https://bun.com/docs/runtime/child-process) — 比 Node.js child_process 快 60%

### Tertiary (LOW confidence, need validation)
- [FFmpeg 轉換效能基準](https://thandor.net/benchmark/85) — 一般 RTF；無 MP3→MP4 10+ 小時音頻的特定數據
- [AtomicParsley 替代品](https://linux.goeszen.com/how-to-add-album-cover-art-to-m4a-files-on-ubuntu-linux.html) — 藝術品嵌入工具，需驗證與 Bun 的整合

## Metadata

**信心度細分**：
- **標準棧**：HIGH — FFmpeg 8.0.1, music-metadata 已驗證，Bun.$ 記錄良好
- **架構**：HIGH — M4A + AAC 為標準，FFmpeg 命令已驗證，模式來自 Phase 2
- **缺陷**：HIGH — MP3 in MP4, 元數據限制, 視頻不同步為已知問題，FF 文檔確認
- **環境**：HIGH — FFmpeg 8.0.1, Bun 1.3.10 在系統中可用，已驗證

**研究日期**：2026-03-24
**有效期**：2026-04-24 (30 天，FFmpeg 穩定，期望無變化)
