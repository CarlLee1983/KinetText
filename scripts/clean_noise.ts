import { ContentCleaner } from '../src/utils/ContentCleaner';
import { getSiteIdFromMetadata } from '../src/workflows/cleaning';
import { Glob } from "bun";
import * as path from 'path';

async function main() {
    // 獲取參數: bun run clean [siteId_or_fallback] [bookTitle]
    let siteIdArg = Bun.argv[2];
    const targetBook = Bun.argv[3];

    const outputDir = path.resolve(import.meta.dir, '..', 'output');

    // 如果有指定書籍，則只搜尋該目錄
    const searchPattern = targetBook
        ? `${targetBook}/**/*.txt`
        : "**/*.txt";

    const glob = new Glob(searchPattern);
    let totalFiles = 0;
    let cleanedFiles = 0;

    console.log(`--- 開始執行清理 ---`);
    console.log(`目錄: ${outputDir}`);

    // 快取各個書本目錄的 siteId，避免重複讀取 metadata.txt
    const siteIdCache: Record<string, string | null> = {};

    for await (const file of glob.scan(outputDir)) {
        // 跳過 metadata 檔案
        if (file.endsWith('metadata.txt')) continue;

        const filePath = path.join(outputDir, file);

        // 取得該檔案所在的書本根目錄
        const relativePathParts = file.split(path.sep);
        const bookFolderName = relativePathParts[0] || '';
        const bookDirPath = path.join(outputDir, bookFolderName);

        // 決定使用哪個 siteId
        let currentSiteId = siteIdArg;

        if (!currentSiteId) {
            if (siteIdCache[bookFolderName] === undefined) {
                siteIdCache[bookFolderName] = await getSiteIdFromMetadata(bookDirPath);
            }
            currentSiteId = siteIdCache[bookFolderName] || '8novel'; // 預設 8novel
        }

        const fileHandle = Bun.file(filePath);

        try {
            const content = await fileHandle.text();
            const cleaned = ContentCleaner.clean(currentSiteId, content);

            totalFiles++;

            if (content !== cleaned) {
                await Bun.write(filePath, cleaned);
                console.log(`[已清理][來源:${currentSiteId}] ${file}`);
                cleanedFiles++;
            }
        } catch (error) {
            console.error(`處理檔案失敗 ${file}:`, error);
        }
    }

    console.log(`-------------------`);
    console.log(`清理完成！`);
    console.log(`掃描檔案數: ${totalFiles}`);
    console.log(`實際修正數: ${cleanedFiles}`);
}

main().catch(console.error);
