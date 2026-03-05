import { $ } from "bun";
import { parseArgs } from "util";
import path from "path";
import fs from "fs";
import { resolveExistingPathWithOutputFallback } from "../src/workflows/pathUtils";

// 解析命令列參數
const { positionals, values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
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
        }
    },
    allowPositionals: true,
});

if (positionals.length === 0) {
    console.error("使用方式: bun run merge-mp3 <input_directory> [選項]");
    console.error("選項:");
    console.error("  -s, --size <n>    每 n 個檔案合併為一個 (預設: 20)");
    console.error("  -o, --output <dir> 指定輸出資料夾 (預設: 與輸入資料夾相同)");
    console.error("  -f, --force      強制覆蓋已存在的合併檔");
    console.error("\n範例:");
    console.error("  bun run merge-mp3 \"output/撈屍人/audio\" --size 50");
    process.exit(1);
}

let inputDir = positionals[0] as string;
const batchSize = parseInt(values.size as string, 10);
const force = values.force;

if (isNaN(batchSize) || batchSize <= 0) {
    console.error("錯誤: --size 必須是正整數");
    process.exit(1);
}

try {
    inputDir = resolveExistingPathWithOutputFallback(inputDir);
} catch (error) {
    console.error(error instanceof Error ? error.message : `找不到路徑: ${inputDir}`);
    process.exit(1);
}

if (!fs.statSync(inputDir).isDirectory()) {
    console.error(`錯誤: ${inputDir} 不是一個資料夾`);
    process.exit(1);
}

const outputDir = (values.output as string) || inputDir;
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// 取得所有 mp3 檔案並排序
const files = fs.readdirSync(inputDir)
    .filter(f => f.toLowerCase().endsWith(".mp3"))
    .filter(f => !f.includes("_merged_")) // 避免重複合併已合併的檔案
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

if (files.length === 0) {
    console.log("ℹ️ 資料夾內沒發現任何待合併的 .mp3 檔案。");
    process.exit(0);
}

console.log(`🎵 發現 ${files.length} 個 mp3 檔案，將每 ${batchSize} 個合併為一檔...`);

// 檢查 ffmpeg
try {
    await $`ffmpeg -version`.quiet();
} catch {
    console.error("錯誤: 請確定系統已經安裝 'ffmpeg'");
    process.exit(1);
}

const bookName = path.basename(path.dirname(inputDir)) || "book";

// 分批處理
for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(files.length / batchSize);

    // 取得這一批的範圍標籤 (例如 001-020)
    const startNum = i + 1;
    const endNum = Math.min(i + batch.length, files.length);
    const outputName = `${bookName}_${startNum.toString().padStart(3, '0')}-${endNum.toString().padStart(3, '0')}_merged.mp3`;
    const outputPath = path.join(outputDir, outputName);

    if (fs.existsSync(outputPath) && !force) {
        console.log(`[${batchIndex}/${totalBatches}] ⏩ 跳過已存在的合併檔: ${outputName}`);
        continue;
    }

    console.log(`[${batchIndex}/${totalBatches}] 🔄 正在合併 ${batch.length} 個檔案 -> ${outputName}...`);

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
