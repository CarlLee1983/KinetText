import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContentCleaner } from "../src/utils/ContentCleaner";
import { formatCliError, parseCommonCliFlags } from "../src/cli/common";
import { splitKinetiTextDocument } from "../src/workflows/cleaning";

// Usage: bun run scripts/clean_novels.ts <directory> [suffix] [siteId]
const { help, dryRun, positional } = parseCommonCliFlags(Bun.argv.slice(2));
const dirArg = positional[0];
const suffixArg = positional[1] || "首頁 電腦版 說全 熱門說";
const siteId = positional[2] || "czbooks";

if (help) {
    console.log("使用方式: bun run clean-files <directory> [suffix] [siteId] [--dry-run]");
    console.log("範例: bun run clean-files \"output/撈屍人/txt\" --dry-run");
    process.exit(0);
}

if (!dirArg) {
    console.error("使用方式: bun run clean-files <directory> [suffix] [siteId]");
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

        const { header, body: originalBody } = splitKinetiTextDocument(content);
        let body = originalBody;

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
        if (!dryRun) {
            await writeFile(filePath, header + body + "\n", "utf-8");
        } else {
            console.log(`[Dry-run] Would clean ${file}`);
        }
        processedCount++;
    }
    console.log(`Successfully processed ${processedCount} files.`);
}

run().catch((error) => {
    console.error(`[Error] ${formatCliError(error)}`);
    process.exit(1);
});
