import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContentCleaner } from "../src/utils/ContentCleaner";

// Usage: bun run scripts/clean_novels.ts <directory> [suffix] [siteId]
const dirArg = Bun.argv[2];
const suffixArg = Bun.argv[3] || "首頁 電腦版 說全 熱門說";
const siteId = Bun.argv[4] || "czbooks";

if (!dirArg) {
    console.error("使用方式: bun run scripts/clean_novels.ts <directory> [suffix] [siteId]");
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
    console.log(`Using suffix: "${suffixArg}", siteId: "${siteId}"`);

    let processedCount = 0;

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const content = await readFile(filePath, "utf-8");

        let header = '';
        let body = content;

        // Check if it has the standard KinetiText header
        const parts = content.split('--------------------------------------------------');
        if (parts.length >= 2) {
            header = parts[0] + '--------------------------------------------------\n';
            body = parts.slice(1).join('--------------------------------------------------');
        }

        body = body.trim();

        // Apply basic fix for the pattern mentioned
        body = body.replace(/『PS:.*?』/ig, '');
        body = body.replace(/————以下正文————/g, '');
        body = body.replace(/【.*?】/g, '');

        if (siteId) {
            body = ContentCleaner.clean(siteId, body);
        }

        // Remove suffix
        if (body.endsWith(suffixArg)) {
            body = body.slice(0, -suffixArg.length).trim();
        }

        // Overwrite file
        await writeFile(filePath, header + body + "\n", "utf-8");
        processedCount++;
    }
    console.log(`Successfully processed ${processedCount} files.`);
}

run().catch(console.error);
