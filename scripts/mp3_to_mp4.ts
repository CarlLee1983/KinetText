import { $ } from "bun";
import { parseArgs } from "util";
import path from "path";
import fs from "fs";
import { resolveExistingPathWithOutputFallback } from "../src/workflows/pathUtils";

// 解析命令列參數
const { positionals, values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        force: {
            type: "boolean",
            short: "f",
            default: false,
        },
    },
    allowPositionals: true,
});

const force = values.force;

if (positionals.length === 0) {
    console.error("使用方式: bun run to-mp4 <input_path_or_file> [output.mp4] [選項]");
    console.error("選項:");
    console.error("  -f, --force    強制覆蓋已存在的檔案");
    console.error("\n範例:");
    console.error("  bun run to-mp4 \"output/書名\"                 (轉換資料夾下所有 mp3，跳過已轉換者)");
    console.error("  bun run to-mp4 \"output/書名\" --force         (強制重新轉換所有檔案)");
    console.error("  bun run to-mp4 \"output/書名/章節.mp3\"");
    process.exit(1);
}

let inputPath = positionals[0] as string;
try {
    inputPath = resolveExistingPathWithOutputFallback(inputPath);
} catch (error) {
    console.error(error instanceof Error ? error.message : `找不到路徑: ${inputPath}`);
    process.exit(1);
}

const defaultCover = path.join(process.cwd(), "static", "default_cover.png");
if (!fs.existsSync(defaultCover)) {
    console.error(`找不到預設封面圖片: ${defaultCover}. 請確認 static/default_cover.png 是否存在。`);
    process.exit(1);
}

try {
    // 檢查是否安裝了 ffmpeg
    const check = await $`ffmpeg -version`.quiet();
    if (check.exitCode !== 0) {
        throw new Error('ffmpeg check failed');
    }
} catch {
    console.error("錯誤: 請確定系統已經安裝 'ffmpeg'");
    process.exit(1);
}

async function convertFile(inputMp3: string, outputMp4?: string, forceOverwrite: boolean = false) {
    if (!outputMp4) {
        const ext = path.extname(inputMp3);
        outputMp4 = inputMp3.slice(0, -ext.length) + ".mp4";
    }

    // 如果輸出的 mp4 已經存在，且沒有指定強制覆蓋，就跳過
    if (fs.existsSync(outputMp4) && !forceOverwrite) {
        console.log(`⏩ 跳過已存在的檔案: ${path.basename(outputMp4)}`);
        return true;
    }

    if (fs.existsSync(outputMp4) && forceOverwrite) {
        console.log(`♻️  強制覆蓋: ${path.basename(outputMp4)}`);
    }

    console.log(`🎬 正在轉換: ${path.basename(inputMp3)} -> ${path.basename(outputMp4)}`);

    try {
        const result = await $`ffmpeg -y -loop 1 -framerate 1 -i ${defaultCover} -i ${inputMp3} -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest ${outputMp4}`.quiet();

        if (result.exitCode === 0) {
            console.log(`✅ 轉換成功: ${path.basename(outputMp4)}`);
            return true;
        } else {
            console.error(`❌ 轉換失敗 (${path.basename(inputMp3)}), FFmpeg 退出碼: ${result.exitCode}`);
            return false;
        }
    } catch (error) {
        console.error(`❌ 執行 FFmpeg 時發生錯誤 (${path.basename(inputMp3)}):`, error);
        return false;
    }
}

const stats = fs.statSync(inputPath);

if (stats.isDirectory()) {
    console.log(`📂 偵測到資料夾，開始批次轉換: ${inputPath}${force ? " (強制模式)" : ""}`);
    const files = fs.readdirSync(inputPath)
        .filter(f => f.toLowerCase().endsWith(".mp3"))
        .sort(); // 依照檔名排序

    if (files.length === 0) {
        console.log("ℹ️ 資料夾內沒發現任何 .mp3 檔案。");
    } else {
        console.log(`🎵 發現 ${files.length} 個待轉換檔案`);
        let successCount = 0;
        let i = 0;
        for (const file of files) {
            const fullPath = path.join(inputPath, file);
            console.log(`[${++i}/${files.length}]`);
            const success = await convertFile(fullPath, undefined, force);
            if (success) successCount++;
        }
        console.log(`\n✨ 批次處理完成！成功: ${successCount} / 總計: ${files.length}`);
    }
} else {
    const success = await convertFile(inputPath, positionals[1] as string | undefined, force);
    if (success) {
        console.log("🎉 任務完成！");
    }
}
