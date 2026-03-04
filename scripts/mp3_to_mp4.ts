import { $ } from "bun";
import { parseArgs } from "util";
import path from "path";
import fs from "fs";

// 解析命令列參數
const { positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
});

if (positionals.length === 0) {
    console.error("使用方式: bun run to-mp4 <input.mp3> [output.mp4]");
    process.exit(1);
}

const inputMp3 = positionals[0] as string;
if (!fs.existsSync(inputMp3)) {
    console.error(`找不到輸入檔案: ${inputMp3}`);
    process.exit(1);
}

let outputMp4 = positionals[1];
if (!outputMp4) {
    const ext = path.extname(inputMp3);
    outputMp4 = inputMp3.slice(0, -ext.length) + ".mp4";
}

const defaultCover = path.join(process.cwd(), "static", "default_cover.png");
if (!fs.existsSync(defaultCover)) {
    console.error(`找不到預設封面圖片: ${defaultCover}. 請確認 static/default_cover.png 是否存在。`);
    process.exit(1);
}

console.log(`準備將 ${inputMp3} 轉換為 ${outputMp4}...`);
console.log(`使用封面圖片: ${defaultCover}`);

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

try {
    // 執行轉換命令
    // -loop 1: 重複播放影像
    // -c:v libx264 -tune stillimage: 特別為了靜態影像經過調整的 x264 編碼
    // -c:a aac -b:a 192k: 將音訊轉換為 aac
    // -pix_fmt yuv420p: 為了高相容性
    // -shortest: 遇到最短的串流 (這裡的音訊) 就停止轉換
    const result = await $`ffmpeg -loop 1 -framerate 1 -i ${defaultCover} -i ${inputMp3} -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest ${outputMp4}`;

    if (result.exitCode === 0) {
        console.log(`🎉 轉換成功！檔案已儲存至: ${outputMp4}`);
    } else {
        console.error(`轉換失敗，FFmpeg 退出碼: ${result.exitCode}`);
    }
} catch (error) {
    console.error("執行 FFmpeg 時發生錯誤:", error);
    process.exit(1);
}
