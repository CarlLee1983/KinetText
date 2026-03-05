import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Usage: bun run scripts/clean_novels.ts <directory> [suffix]
const dirArg = Bun.argv[2];
const suffixArg = Bun.argv[3] || "首頁 電腦版 說全 熱門說";

if (!dirArg) {
    console.error("使用方式: bun run scripts/clean_novels.ts <directory> [suffix]");
    console.error("範例: bun run scripts/clean_novels.ts \"output/撈屍人/txt\"");
    process.exit(1);
}

async function run() {
    const dirPath = path.resolve(process.cwd(), dirArg as string);

    // Check if path exists
    try {
        const stats = await import("node:fs/promises").then(m => m.stat(dirPath));
        if (!stats.isDirectory()) {
            console.error(`錯誤: ${dirArg} 不是一個資料夾`);
            process.exit(1);
        }
    } catch (e) {
        console.error(`錯誤: 找不到路徑 ${dirArg}`);
        process.exit(1);
    }

    const files = (await readdir(dirPath)).filter(f => f.endsWith(".txt"));
    console.log(`Found ${files.length} files in ${dirPath}`);
    console.log(`Using suffix: "${suffixArg}"`);

    let processedCount = 0;

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const content = await readFile(filePath, "utf-8");
        const lines = content.split(/\r?\n/);

        if (lines.length >= 4) {
            const title = lines[0]?.trim() ?? "";
            let body = lines[3] ?? "";

            // Remove prefix: title + space or just title
            if (body.startsWith(title + " ")) {
                body = body.slice(title.length + 1);
            } else if (body.startsWith(title)) {
                body = body.slice(title.length);
            }

            // Remove suffix
            body = body.trim();
            if (body.endsWith(suffixArg)) {
                body = body.slice(0, -suffixArg.length).trim();
            }

            // Overwrite file with ONLY the cleaned body
            await writeFile(filePath, body, "utf-8");
            processedCount++;
        }
    }
    console.log(`Successfully processed ${processedCount} files.`);
}

run().catch(console.error);
