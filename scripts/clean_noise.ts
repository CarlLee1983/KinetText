import * as fs from 'fs/promises';
import * as path from 'path';

const OUTPUT_DIR = path.join(import.meta.dir, '..', 'output');
const noiseRegex = /[8８⒏⑻⑧][\s]*[nｎＮ][\s]*[oｏＯσο][\s]*[vｖＶ][\s]*[eｅＥЁ][\s]*[lｌＬ┗└][\s]*[.．·。][\s]*[cｃＣС][\s]*[oｏＯοо][\s]*[mｍＭｍ]/ig;

async function cleanFile(filePath: string) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const cleanedContent = content.replace(noiseRegex, '');
        
        if (content !== cleanedContent) {
            await fs.writeFile(filePath, cleanedContent, 'utf-8');
            console.log(`Cleaned: ${filePath}`);
            return 1;
        }
        return 0;
    } catch (error) {
        console.error(`Error processing file ${filePath}:`, error);
        return 0;
    }
}

async function traverseDirectory(dir: string): Promise<number> {
    let cleanedCount = 0;
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                cleanedCount += await traverseDirectory(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.txt')) {
                cleanedCount += await cleanFile(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error traversing directory ${dir}:`, error);
    }
    return cleanedCount;
}

async function main() {
    console.log(`Starting noise cleanup in ${OUTPUT_DIR}...`);
    const totalCleaned = await traverseDirectory(OUTPUT_DIR);
    console.log(`Cleanup complete. Total files cleaned: ${totalCleaned}`);
}

main().catch(console.error);
