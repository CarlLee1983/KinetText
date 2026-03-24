import { $ } from "bun";
import { parseArgs } from "util";
import path from "path";
import fs from "fs";
import { resolveExistingPathWithOutputFallback } from "../src/workflows/pathUtils";

/**
 * 解析時長參數：接受秒數（39600）、小時（11h）或分鐘（660m）。
 * @throws Error 如果格式無法識別
 */
function parseDurationArg(value: string): number {
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  const hoursMatch = trimmed.match(/^(\d+)h$/i)
  if (hoursMatch) return parseInt(hoursMatch[1], 10) * 3600
  const minsMatch = trimmed.match(/^(\d+)m$/i)
  if (minsMatch) return parseInt(minsMatch[1], 10) * 60
  throw new Error(`無法解析時長: ${value}，請使用秒數、'11h' 或 '660m' 格式`)
}

// 解析命令列參數
const { positionals, values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        help: {
            type: "boolean",
            short: "h",
            default: false,
        },
        size: {
            type: "string",
            short: "s",
            default: "20",
        },
        output: {
            type: "string",
            short: "o",
        },
        force: {
            type: "boolean",
            short: "f",
            default: false,
        },
        dryRun: {
            type: "boolean",
            default: false,
        },
        start: {
            type: "string",
        },
        end: {
            type: "string",
        },
        mode: {
            type: "string",
            default: "count",
        },
        target: {
            type: "string",
            default: "39600",
        },
        tolerance: {
            type: "string",
            default: "10",
        },
        report: {
            type: "string",
        },
    },
    allowPositionals: true,
});

if (values.help) {
    console.log("使用方式: bun run merge-mp3 <input_directory> [選項]");
    console.log("選項:");
    console.log("  -h, --help                 顯示說明");
    console.log("  -s, --size <n>             每 n 個檔案合併為一個 (預設: 20) [--mode=count 用]");
    console.log("  -o, --output <dir>         指定輸出資料夾 (預設: 與輸入資料夾相同)");
    console.log("  -f, --force                強制覆蓋已存在的合併檔");
    console.log("  --start <n>                開始的檔案索引 (預設: 1，即第一個檔案)");
    console.log("  --end <n>                  結束的檔案索引 (預設: 最後一個檔案)");
    console.log("  --dry-run                  僅顯示計畫，不執行 ffmpeg");
    console.log("  --mode <count|duration>    分組模式 (預設: count)");
    console.log("  --target <duration>        目標時長，支援秒數/11h/660m (預設: 39600) [--mode=duration 用]");
    console.log("  --tolerance <n>            容差百分比 0-100 (預設: 10) [--mode=duration 用]");
    console.log("  --report <path>            輸出 JSON 報告到指定路徑 [--mode=duration 用]");
    process.exit(0);
}

if (positionals.length === 0) {
    console.error("使用方式: bun run merge-mp3 <book_directory> [選項]");
    console.error("選項:");
    console.error("  -s, --size <n>    每 n 個檔案合併為一個 (預設: 20)");
    console.error("  -o, --output <dir> 指定輸出資料夾 (預設: 與書籍資料夾相同)");
    console.error("  -f, --force      強制覆蓋已存在的合併檔");
    console.error("  --start <n>      開始的檔案索引 (預設: 1)");
    console.error("  --end <n>        結束的檔案索引 (預設: 最後一個檔案)");
    console.error("\n範例:");
    console.error("  bun run merge-mp3 \"output/撈屍人\" --size 50");
    console.error("  bun run merge-mp3 \"output/撈屍人\" --start 21 --end 100");
    process.exit(1);
}

let baseDir = positionals[0] as string;
const batchSize = parseInt(values.size as string, 10);
const force = values.force;
const dryRun = values.dryRun;
const startIdx = values.start ? parseInt(values.start as string, 10) : 1;
const endIdx = values.end ? parseInt(values.end as string, 10) : undefined;
const mode = values.mode as string;

if (mode !== 'count' && mode !== 'duration') {
    console.error(`錯誤: --mode 必須是 'count' 或 'duration'，收到: '${mode}'`);
    process.exit(1);
}

if (mode === 'count' && (isNaN(batchSize) || batchSize <= 0)) {
    console.error("錯誤: --size 必須是正整數");
    process.exit(1);
}

try {
    baseDir = resolveExistingPathWithOutputFallback(baseDir);
} catch (error) {
    console.error(error instanceof Error ? error.message : `找不到路徑: ${baseDir}`);
    process.exit(1);
}

const inputDir = path.join(baseDir, 'audio');

if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    console.error(`錯誤: 找不到音檔資料夾 ${inputDir}，請確認是否已生成音檔`);
    process.exit(1);
}

const outputDir = (values.output as string) || baseDir;
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// 取得所有 mp3 檔案並排序
let files = fs.readdirSync(inputDir)
    .filter(f => f.toLowerCase().endsWith(".mp3"))
    .filter(f => !f.includes("_merged_")) // 避免重複合併已合併的檔案
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const startIndex = Math.max(0, startIdx - 1);
const endIndex = endIdx !== undefined ? Math.min(files.length, endIdx) : files.length;
files = files.slice(startIndex, endIndex);

if (files.length === 0) {
    console.log("ℹ️ 資料夾內沒發現任何待合併的 .mp3 檔案。");
    process.exit(0);
}

// === 時長分組模式 (--mode=duration) ===
if (mode === 'duration') {
    const { AudioMergeService } = await import('../src/core/services/AudioMergeService');
    const { AudioConvertConfig } = await import('../src/config/AudioConvertConfig');

    let targetSeconds: number;
    try {
        targetSeconds = parseDurationArg(values.target as string);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    const tolerancePercent = parseInt(values.tolerance as string, 10);
    if (isNaN(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100) {
        console.error("錯誤: --tolerance 必須是 0-100 之間的整數");
        process.exit(1);
    }

    const filePaths = files.map(f => path.resolve(inputDir, f));
    const service = new AudioMergeService(AudioConvertConfig.fromEnvironment());

    console.log(`🎵 時長分組模式: ${files.length} 個檔案, 目標 ${values.target}, 容差 ±${tolerancePercent}%`);

    if (dryRun) {
        // Dry-run: 顯示分組預覽，不執行合併
        const { DurationService } = await import('../src/core/services/DurationService');
        const ds = new DurationService();
        const filesWithDurations = await Promise.all(
            filePaths.map(async fp => ({
                path: fp,
                duration: await ds.getDuration(fp),
            }))
        );
        const groups = await service.groupByDuration(filesWithDurations, targetSeconds, tolerancePercent);
        console.log(`[Dry-run] 將產生 ${groups.length} 組:`);
        for (let i = 0; i < groups.length; i++) {
            console.log(`  Group ${i + 1}: ${groups[i].files.length} 個檔案, 估計 ${ds.formatDuration(groups[i].estimatedDuration)}`);
        }
        process.exit(0);
    }

    const report = await service.mergeBatch(filePaths, outputDir, {
        targetSeconds,
        tolerancePercent,
        namePrefix: bookName,
    });

    // 輸出人類可讀摘要
    console.log('\n' + service.formatReport(report));

    // 若指定 --report 旗標，輸出 JSON 報告
    if (values.report) {
        const reportPath = path.resolve(values.report as string);
        await Bun.write(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📊 JSON 報告已寫入: ${reportPath}`);
    }

    console.log("\n✨ 時長分組合併已完成！");
    process.exit(0);
}

const bookName = path.basename(baseDir) || "book";

// === 計數分組模式 (--mode=count，預設) ===
console.log(`🎵 發現 ${files.length} 個 mp3 檔案，將每 ${batchSize} 個合併為一檔...`);

// 檢查 ffmpeg
if (!dryRun) {
    try {
        await $`ffmpeg -version`.quiet();
    } catch {
        console.error("錯誤: 請確定系統已經安裝 'ffmpeg'");
        process.exit(1);
    }
}

// 分批處理
for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(files.length / batchSize);

    // 取得這一批的範圍標籤 (例如 001-020)
    // 需要加上 startIndex 以反映完整清單的真實檔案索引，而非擷取後的區間。
    const startNum = startIndex + i + 1;
    const endNum = startIndex + i + batch.length;
    const outputName = `${bookName}_${startNum.toString().padStart(3, '0')}-${endNum.toString().padStart(3, '0')}_merged.mp3`;
    const outputPath = path.join(outputDir, outputName);

    if (fs.existsSync(outputPath) && !force) {
        console.log(`[${batchIndex}/${totalBatches}] ⏩ 跳過已存在的合併檔: ${outputName}`);
        continue;
    }

    console.log(`[${batchIndex}/${totalBatches}] 🔄 正在合併 ${batch.length} 個檔案 -> ${outputName}...`);

    if (dryRun) {
        console.log(`[${batchIndex}/${totalBatches}] [Dry-run] Would merge ${batch.length} files into ${outputPath}`);
        continue;
    }

    // 建立 ffmpeg concat 列表檔案
    const listFile = path.join(process.cwd(), "tmp", `concat_list_${Date.now()}.txt`);
    if (!fs.existsSync(path.dirname(listFile))) {
        fs.mkdirSync(path.dirname(listFile), { recursive: true });
    }

    const listContent = batch.map(f => `file '${path.resolve(inputDir, f)}'`).join('\n');
    fs.writeFileSync(listFile, listContent);

    try {
        // 使用 ffmpeg concat demuxer 進行無損合併 (不重新編碼，速度極快)
        const result = await $`ffmpeg -y -f concat -safe 0 -i ${listFile} -c copy ${outputPath}`.quiet();

        if (result.exitCode === 0) {
            console.log(`✅ 成功產出: ${outputName}`);
        } else {
            console.error(`❌ 合併失敗: ${outputName}, FFmpeg 退出碼: ${result.exitCode}`);
        }
    } catch (error) {
        console.error(`❌ 處理 ${outputName} 時發生錯誤:`, error);
    } finally {
        if (fs.existsSync(listFile)) {
            fs.unlinkSync(listFile);
        }
    }
}

console.log("\n✨ 所有合併任務已完成！");
