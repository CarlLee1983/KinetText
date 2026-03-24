# KinetiText 故障排查指南

本指南涵蓋常見問題及解決方案，依功能模組分類。

## 目錄

1. [安裝與環境](#1-安裝與環境)
2. [重試與錯誤](#2-重試與錯誤)
3. [音頻轉換（Phase 2）](#3-音頻轉換phase-2)
4. [音頻合併（Phase 3）](#4-音頻合併phase-3)
5. [MP4 轉換（Phase 4）](#5-mp4-轉換phase-4)
6. [性能問題](#6-性能問題)
7. [日誌記錄與除錯](#7-日誌記錄與除錯)
8. [聯絡支援](#8-聯絡支援)

---

## 1. 安裝與環境

### Q: "command not found: bun"

**原因**: Bun 未安裝或不在系統 PATH 中。

```bash
# 安裝 Bun
curl -fsSL https://bun.sh/install | bash

# 驗證安裝
bun --version

# 若仍找不到，手動加入 PATH
export PATH="$HOME/.bun/bin:$PATH"
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc  # zsh
```

---

### Q: "FFmpeg not found" 或 "ffmpeg: command not found"

**原因**: 系統未安裝 FFmpeg，或不在 PATH 中。Phase 2-4 所有音頻處理功能都需要 FFmpeg。

```bash
# macOS（使用 Homebrew）
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install ffmpeg

# CentOS/RHEL
sudo yum install ffmpeg

# Windows（使用 Chocolatey）
choco install ffmpeg

# Windows（使用 winget）
winget install ffmpeg

# 驗證安裝
ffmpeg -version
ffprobe -version
```

---

### Q: "module not found" 或 "Cannot find module"

**原因**: 缺少依賴包或 `node_modules` 損壞。

```bash
# 重新安裝依賴
bun install

# 若失敗，清理後重試
rm -rf node_modules bun.lockb
bun install

# 確認特定套件已安裝
bun pm ls | grep music-metadata
```

---

### Q: "error: TypeScript type errors"

**原因**: 型別定義不匹配，可能是版本問題。

```bash
# 確認 Bun 版本（需 >= 1.0）
bun --version

# 更新 Bun
bun upgrade

# 重新安裝並執行
bun install && bun run test
```

---

## 2. 重試與錯誤

### Q: 爬蟲反覆失敗，回報 "ERR_CONNECTION_RESET" 或 "timeout"

**原因**: 網站防爬蟲機制、網路不穩、或請求過於頻繁。

```bash
# 增加重試次數
RETRY_MAX_ATTEMPTS=7 bun run start "URL"

# 增加重試延遲（降低請求頻率）
RETRY_BASE_DELAY_MS=500 bun run start "URL"

# 同時增加次數與延遲
RETRY_MAX_ATTEMPTS=5 RETRY_BASE_DELAY_MS=1000 bun run start "URL"

# 查看重試日誌
bun run start "URL" 2>&1 | grep -i "retry\|attempt"
```

---

### Q: "Retries exhausted after N attempts"

**原因**: 所有重試次數用盡仍未成功，通常是網路或目標網站問題。

```bash
# 1. 先確認網路連線
ping google.com

# 2. 確認目標網站可訪問
curl -I "https://example.com"

# 3. 查看最後一次錯誤詳情
bun run start "URL" 2>&1 | tail -50

# 4. 失敗後補抓
bun run retry-failed "小說名稱"

# 5. 手動重試特定章節（乾跑確認）
bun run retry-failed "小說名稱" --dry-run
```

---

### Q: "Error: Failed with exit code 1" 或 "non-zero exit"

**原因**: 子程序（FFmpeg 或其他工具）返回錯誤碼。

```bash
# 查看詳細錯誤
bun run audiobook "小說名稱" 2>&1 | grep -A 10 "exit code"

# 確認 FFmpeg 能正常執行
ffmpeg -i test.wav test.mp3

# 確認輸入檔案存在且有效
ls -la output/小說名稱/wav/
file output/小說名稱/wav/chapter_001.wav
```

---

## 3. 音頻轉換（Phase 2）

### Q: "轉換超時" 或 "operation timed out"

**原因**: 輸入檔案過大、系統負載高，或並行數過多導致資源爭搶。

```bash
# 減少並行轉換數
AUDIO_CONVERT_MAX_CONCURRENCY=1 bun run audiobook "小說名稱"

# 增加重試上限
RETRY_MAX_DELAY_MS=60000 bun run audiobook "小說名稱"

# 分批處理（例如每次 50 章）
bun run audiobook "小說名稱" 1-50
bun run audiobook "小說名稱" 51-100
```

---

### Q: "輸出 MP3 損壞" 或 "output file is corrupt"

**原因**: FFmpeg 編碼過程中斷，或磁碟空間不足。

```bash
# 1. 驗證輸出是否有效
ffprobe output.mp3

# 2. 確認磁碟空間（MP3 約 1 MB/分鐘）
df -h

# 3. 使用不同比特率重試
AUDIO_BITRATE=192k bun run audiobook "小說名稱"

# 4. 清理損壞的輸出後重試
rm output/小說名稱/mp3/chapter_*.mp3
bun run audiobook "小說名稱"
```

---

### Q: "Unsupported audio format" 或 "Invalid audio format"

**原因**: 輸入格式 FFmpeg 不支援，或格式識別失敗。

```bash
# 查看 FFmpeg 支援的編碼
ffmpeg -codecs | grep audio | head -30

# 確認輸入格式
file input.xyz
ffprobe input.xyz

# 先轉換為 WAV 再處理
ffmpeg -i input.xyz -c:a pcm_s16le -f wav output.wav
```

---

### Q: "音頻比 TTS 生成短很多" 或 "時長異常"

**原因**: TTS 生成的音頻有靜音填充，或部分章節轉換失敗。

```bash
# 確認每個 MP3 的時長
for f in output/小說名稱/mp3/*.mp3; do
  echo "$f: $(ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$f")秒"
done

# 查看轉換結果中的失敗項目
bun run audiobook "小說名稱" 2>&1 | grep "failed\|error"
```

---

## 4. 音頻合併（Phase 3）

### Q: "時長計算不準確" 或 "duration mismatch"

**原因**: 音頻有特殊標記（gapless playback、ID3 tag 不一致）或編碼問題。

```bash
# 查看音頻元資料
ffprobe -v quiet -print_format json -show_format chapter1.mp3 | jq .format.duration

# 重新編碼以移除特殊標記（可提升計算精度）
ffmpeg -i input.mp3 -c:a libmp3lame -b:a 128k cleaned.mp3
ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 cleaned.mp3
```

---

### Q: "無法達到目標時長分組" 或 "grouping failed"

**原因**: 容差設置過嚴、或單個檔案時長已超過目標時長。

```bash
# 增加容差百分比
bun run merge-mp3 --input=... --mode=duration --tolerance=30

# 減少目標時長（若單一章節就很長）
bun run merge-mp3 --input=... --target=28800  # 8 小時

# 先預覽分組結果
bun run merge-mp3 --input=... --dry-run --report=human

# 查看最大單一檔案時長
for f in output/小說名稱/mp3/*.mp3; do
  dur=$(ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$f")
  echo "$dur $f"
done | sort -rn | head -5
```

---

### Q: "Out of memory" 或 "JavaScript heap out of memory"

**原因**: 並行讀取過多大型檔案，記憶體不足。

```bash
# 降低並行讀取數
AUDIO_MERGE_MAX_CONCURRENCY=1 bun run merge-mp3 --input=...

# 分批處理（例如每次處理 100 個檔案）
ls output/小說名稱/mp3/*.mp3 | head -100 > batch1.txt
bun run merge-mp3 --input-list=batch1.txt --output=merged/batch1/

ls output/小說名稱/mp3/*.mp3 | tail -100 > batch2.txt
bun run merge-mp3 --input-list=batch2.txt --output=merged/batch2/
```

---

### Q: "合併後音頻有雜音或靜音"

**原因**: 輸入檔案採樣率不一致，或編碼格式混用。

```bash
# 確認所有輸入的採樣率一致
for f in output/小說名稱/mp3/*.mp3; do
  ffprobe -v quiet -show_entries stream=sample_rate -of default=noprint_wrappers=1:nokey=1 "$f"
done | sort | uniq -c

# 若採樣率不一致，重新統一編碼
AUDIO_SAMPLE_RATE=44100 bun run audiobook "小說名稱"
```

---

## 5. MP4 轉換（Phase 4）

### Q: "M4A 檔案無法在 iPhone/iPad 上播放"

**原因**: AAC 編碼設定問題，或元資料格式不符合 Apple 規範。

```bash
# 驗證 M4A 格式
ffprobe output.m4a

# 確認 AAC 比特率設置合理（建議 128k-256k）
MP4_BITRATE=192k bun run to-mp4 --input=... --output=...

# 確認元資料格式正確
cat metadata.json | python3 -m json.tool

# 重新轉換（不含元資料）以確認基本格式
MP4_INCLUDE_METADATA=false bun run to-mp4 --input=merged.mp3 --output=test.m4a
ffprobe test.m4a
```

---

### Q: "元資料未嵌入" 或 "metadata not embedded"

**原因**: metadata.json 格式錯誤，或檔案名稱對應不正確。

```bash
# 1. 驗證 JSON 格式
cat metadata.json | python3 -m json.tool  # 或 jq . metadata.json

# 2. 確認鍵名（key）與 MP3 檔案名稱完全匹配（含副檔名）
cat metadata.json | python3 -c "import json,sys; print(list(json.load(sys.stdin).keys()))"
ls output/小說名稱/merged/

# 3. 驗證元資料已嵌入輸出
ffprobe -v quiet -print_format json -show_format output.m4a | python3 -m json.tool | grep -A 10 '"tags"'
```

---

### Q: "轉換後 M4A 檔案大小異常"

**原因**: 比特率設置錯誤，或輸入 MP3 時長計算問題。

```bash
# 預估大小
# M4A 大小（MB） ≈ 時長（分鐘）× 比特率（kbps）/ 8 / 1024 × 60
# 例：60 分鐘 × 256kbps / 8 / 1024 × 60 ≈ 117 MB

# 確認輸出比特率
ffprobe -v error -select_streams a:0 \
  -show_entries stream=bit_rate \
  -of default=noprint_wrappers=1:nokey=1 \
  output.m4a

# 嘗試不同比特率
MP4_BITRATE=256k bun run to-mp4 --input=merged.mp3 --output=output_256k.m4a
MP4_BITRATE=192k bun run to-mp4 --input=merged.mp3 --output=output_192k.m4a
```

---

### Q: "批量轉換中部分檔案失敗"

**原因**: 個別輸入檔案問題、磁碟空間不足、或並行衝突。

```bash
# 使用乾跑查看哪些會失敗
bun run to-mp4 --input=... --output=... --dry-run

# 降低並行數（減少衝突）
MP4_MAX_CONCURRENCY=1 bun run to-mp4 --input=... --output=...

# 查看失敗詳情
bun run to-mp4 --input=... --output=... 2>&1 | grep -A 5 "error\|failed"
```

---

## 6. 性能問題

### Q: "轉換速度很慢"

**原因**: 並行數太低、比特率設置過高、或 CPU 資源不足。

```bash
# 查看 CPU 核心數
nproc  # Linux
sysctl -n hw.physicalcpu  # macOS

# 提升並行度（建議為核心數的 1-1.5 倍）
AUDIO_CONVERT_MAX_CONCURRENCY=6 bun run audiobook "小說名稱"

# 降低比特率（更快但品質略低）
AUDIO_BITRATE=128k bun run audiobook "小說名稱"

# 監控 FFmpeg 使用率
# macOS: 開啟 Activity Monitor
# Linux:
top -p $(pgrep ffmpeg | tr '\n' ',')
```

---

### Q: "記憶體使用量過高"

**原因**: 並行數過高導致多個 FFmpeg 程序同時占用大量記憶體。

```bash
# 監控記憶體使用
# macOS: Activity Monitor 或 vm_stat
# Linux:
watch -n 1 free -m

# 降低並行度
AUDIO_CONVERT_MAX_CONCURRENCY=1 bun run audiobook "小說名稱"
AUDIO_MERGE_MAX_CONCURRENCY=1 bun run merge-mp3 --input=...
MP4_MAX_CONCURRENCY=1 bun run to-mp4 --input=... --output=...
```

---

### Q: "磁碟空間不足"

**原因**: 輸出檔案過多，或中間產物未清理。

```bash
# 查看磁碟使用
df -h

# 查看 output 目錄大小
du -sh output/
du -sh output/小說名稱/*/

# 預估需要的空間
# MP3 128k: ~1 MB/分鐘
# MP3 192k: ~1.5 MB/分鐘
# M4A 256k: ~2 MB/分鐘
# 合併後通常比個別章節總和略小（無標頭重複）

# 清理中間產物（保留最終結果）
rm -rf output/小說名稱/wav/    # 刪除原始 WAV（若已轉換為 MP3）
# 謹慎：確認 MP3 正確再刪除 WAV
```

---

## 7. 日誌記錄與除錯

### 啟用詳細日誌

```bash
# 查看所有日誌輸出（含 Pino 結構化日誌）
bun run audiobook "小說名稱" 2>&1

# 篩選特定日誌等級
bun run audiobook "小說名稱" 2>&1 | grep '"level":50'  # 錯誤
bun run audiobook "小說名稱" 2>&1 | grep '"level":40'  # 警告

# 使用 pino-pretty 格式化輸出（若已安裝）
bun run audiobook "小說名稱" 2>&1 | bunx pino-pretty
```

---

### 偵錯常用命令

```bash
# 確認 FFmpeg 版本
ffmpeg -version | head -3

# 確認 Bun 版本
bun --version

# 確認已安裝套件
bun pm ls

# 執行測試確認基本功能
bun test

# 查看特定測試詳情
bun test --verbose

# 列出測試目錄
ls src/tests/
```

---

### 常見日誌訊息對照

| 日誌訊息 | 含義 | 建議行動 |
|---------|------|---------|
| `"retry attempt N"` | 第 N 次重試 | 正常，等待完成 |
| `"operation succeeded after N retries"` | 重試後成功 | 可考慮調整延遲配置 |
| `"retries exhausted"` | 重試耗盡 | 查看原因，手動處理 |
| `"ffmpeg process exited with code 1"` | FFmpeg 失敗 | 確認輸入檔案有效 |
| `"duration calculated"` | 時長計算完成 | 正常 |
| `"group N completed"` | 第 N 組合並完成 | 正常 |

---

## 8. 聯絡支援

若問題未在本指南中解決，請提供以下資訊：

**必要資訊**:
1. 完整錯誤訊息（含 stack trace）
2. Bun 版本：`bun --version`
3. FFmpeg 版本：`ffmpeg -version | head -1`
4. 作業系統與版本
5. 重現步驟（最小化範例）

**選擇性資訊**:
6. 輸入檔案的基本資訊（大小、格式）
7. 使用的環境變數設置
8. 完整日誌輸出

**提交問題**:
- 在 GitHub Repository 開啟 Issue
- 包含上述所有必要資訊

---

> 詳細 API 說明請參閱 [API.md](API.md)。
> 配置選項說明請參閱 [CONFIGURATION.md](CONFIGURATION.md)。
