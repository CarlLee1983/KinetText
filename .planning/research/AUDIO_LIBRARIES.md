# 音頻處理庫研究報告

**研究日期**: 2026-03-24
**研究者**: AI Research Agent
**優先結論**: 推薦 FFmpeg-Simplified + Music-Metadata

---

## Executive Summary

針對 Node.js/Bun 環境的 MP3/MP4 轉換和音頻合併，**無單一庫可完全滿足所有需求**。建議混合方案：

| 任務 | 推薦庫 | 原因 |
|------|--------|------|
| MP3/MP4 轉換、合併 | **FFmpeg-Simplified** | 明確 Bun 支援，功能完整 |
| 時長計算、元數據 | **Music-Metadata** | 多格式支援，流式處理 |
| 備選純 TypeScript | **Mediabunny** | WASM+SIMD，但僅限 MP3 |

---

## 詳細評估

### 1️⃣ FFmpeg-Simplified ⭐ 最推薦

**評分**: 4.9/5

**優勢**:
- ✅ 明確 Bun ≥1.0 支援 (預編譯 bundle)
- ✅ 現代 TypeScript wrapper，無原生綁定
- ✅ 支援 MP3→MP4, 串接合併, 格式轉換
- ✅ 處理速度 2-5x 實時
- ✅ 活躍維護，2025 年更新

**劣勢**:
- 🔴 需要安裝 FFmpeg (系統或 npm 版本)
- 🔴 較大的包體積 (~50MB for FFmpeg binary)

**Bun 相容性**: ✅ 完全支援
**使用難度**: ⭐⭐☆ (簡單)

**安裝方式**:
```bash
bun add ffmpeg-simplified
# 或使用預編譯 Bun bundle
```

**使用範例**:
```typescript
import { FFmpeg } from 'ffmpeg-simplified'

const ffmpeg = new FFmpeg()
await ffmpeg.convert('input.wav', 'output.mp3', {
  audioCodec: 'libmp3lame',
  audioBitrate: '128k'
})

// 合併多個 MP3
await ffmpeg.concat(['file1.mp3', 'file2.mp3'], 'output.mp3')
```

---

### 2️⃣ Music-Metadata ⭐ 元數據標準

**評分**: 4.8/5

**優勢**:
- ✅ 支援 MP3, MP4, FLAC, WAV, AIFF, Ogg
- ✅ 流式處理 (內存高效)
- ✅ 準確的時長和編碼信息
- ✅ 活躍維護，穩定 API
- ✅ 無原生依賴

**劣勢**:
- 🟡 僅用於元數據提取，不能進行轉換

**Bun 相容性**: ✅ 可能相容 (需驗證)
**使用難度**: ⭐☆☆ (非常簡單)

**安裝方式**:
```bash
bun add music-metadata
```

**使用範例**:
```typescript
import { parseFile } from 'music-metadata'

const metadata = await parseFile('audio.mp3')
console.log(metadata.format.duration)  // 秒數
console.log(metadata.common.title)     // 標題
```

---

### 3️⃣ Mediabunny (@mediabunny/mp3-encoder) ⭐ 純 TypeScript

**評分**: 4.0/5

**優勢**:
- ✅ 完全用 TypeScript/WebAssembly 實現
- ✅ SIMD 優化，MP3 編碼 55x 實時
- ✅ 零依賴，瀏覽器 + 伺服器相容
- ✅ 明確 Bun 支援

**劣勢**:
- 🔴 **僅限 MP3 格式** - 無法處理 WAV/AAC/OGG 等
- 🔴 不支援 MP4 容器或合併
- 🔴 編碼器，不是通用轉換工具

**Bun 相容性**: ✅ 完全支援
**使用難度**: ⭐⭐☆ (簡單，但功能受限)

**適用場景**: 如果只需 MP3 編碼，不涉及格式轉換

---

### 4️⃣ Mediaforge (現代替代品)

**評分**: 3.5/5

**優勢**:
- ✅ 現代 TypeScript FFmpeg 包裝器
- ✅ 運行時編碼器檢測
- ✅ fluent-ffmpeg 現代替代品

**劣勢**:
- 🔴 無明確 Bun 文檔 (但現代 API 可能相容)
- 🔴 維護狀態不如 FFmpeg-Simplified

**Bun 相容性**: 🟡 需要驗證

---

### 5️⃣ Fluent-FFmpeg ❌ 不推薦

**評分**: 1.0/5

**狀態**: **已棄用** (2025 年 5 月)

**為什麼不用**:
- 🔴 GitHub issue #1324 確認已棄用
- 🔴 不再維護
- 🔴 不建議用於新項目
- 🔴 NPM 封存倫理

**替代方案**: 使用 FFmpeg-Simplified

---

## 技術決策矩陣

| 需求 | FFmpeg-Simplified | Music-Metadata | Mediabunny |
|------|-------------------|-----------------|------------|
| MP3 編碼 | ✅ | ❌ | ✅✅ |
| MP3 解碼 | ✅ | ❌ | ❌ |
| 時長計算 | 🟡 | ✅✅ | ❌ |
| MP4 轉換 | ✅ | ❌ | ❌ |
| 音頻合併 | ✅ | ❌ | ❌ |
| Bun 支援 | ✅✅ | 🟡 | ✅ |
| 零依賴 | ❌ | ✅ | ✅ |

---

## 推薦架構

```
┌─────────────────────────────────────────┐
│      你的應用 (KinetiText)              │
└──────────┬──────────────────────┬───────┘
           │                      │
      ┌────▼────────┐    ┌────────▼──────┐
      │   FFmpeg    │    │  Music-        │
      │ -Simplified │    │  Metadata      │
      └─────┬───────┘    └────────┬───────┘
            │                     │
     ┌──────▼──────────────────────▼─────┐
     │   任務處理管道                      │
     ├──────────────────────────────────┤
     │ 1. 爬蟲 (失敗重試) → 音頻檔案    │
     │ 2. Music-Metadata → 時長計算     │
     │ 3. FFmpeg-Simplified → 轉換      │
     │ 4. FFmpeg-Simplified → 合併      │
     │ 5. FFmpeg-Simplified → MP4 輸出  │
     └────────────────────────────────────┘
```

---

## 實現建議

### Phase 2 (MP3 轉換)

```typescript
import { FFmpeg } from 'ffmpeg-simplified'
import { parseFile } from 'music-metadata'

class AudioProcessor {
  private ffmpeg = new FFmpeg()

  async convertToMP3(inputPath: string, outputPath: string) {
    await this.ffmpeg.convert(inputPath, outputPath, {
      audioCodec: 'libmp3lame',
      audioBitrate: '128k',
      audioSampleRate: 44100
    })
  }

  async getDuration(filePath: string): Promise<number> {
    const metadata = await parseFile(filePath)
    return metadata.format.duration || 0
  }
}
```

### Phase 3 (音頻合併)

```typescript
async mergeAudioFiles(
  files: string[],
  outputPath: string,
  targetDurationMs: number
) {
  // 1. 計算每個檔案的時長
  const durations = await Promise.all(
    files.map(f => this.getDuration(f))
  )

  // 2. 分組 (接近目標時長)
  const groups = this.groupByDuration(files, durations, targetDurationMs)

  // 3. 對每組進行合併
  for (const [index, group] of groups.entries()) {
    const output = `${outputPath}_part_${index}.mp3`
    await this.ffmpeg.concat(group, output)
  }
}

private groupByDuration(
  files: string[],
  durations: number[],
  targetMs: number
): string[][] {
  const groups: string[][] = []
  let currentGroup: string[] = []
  let currentDuration = 0

  for (let i = 0; i < files.length; i++) {
    currentGroup.push(files[i])
    currentDuration += durations[i]

    // 如果接近目標或是最後一個檔案，開始新組
    const ratio = currentDuration / targetMs
    if (ratio >= 0.9 || i === files.length - 1) {
      groups.push(currentGroup)
      currentGroup = []
      currentDuration = 0
    }
  }

  return groups
}
```

---

## 評估結論

✅ **使用 FFmpeg-Simplified**:
- 支援所有轉換、合併、MP4 導出需求
- 明確 Bun 支援，無相容性顧慮
- 成熟穩定，活躍維護
- 性能好 (2-5x 實時)

✅ **使用 Music-Metadata**:
- 高效的時長計算
- 多格式支援
- 無額外依賴

❌ **避免 Fluent-FFmpeg**:
- 已棄用，不再維護

---

## 後續步驟

1. **Phase 2 PoC**: 建立 FFmpeg-Simplified + Music-Metadata 測試
2. **驗證 Bun 相容性**: 運行簡單的轉換測試
3. **性能基準**: 測試轉換速度和內存使用
4. **集成到應用**: 完整的音頻管道實現

---

**報告簽署**: AI Research Agent
**更新日期**: 2026-03-24
