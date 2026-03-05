import { CrawlerEngine } from './core/CrawlerEngine';
import { getAdapterForUrl } from './adapters';
import { TxtStorageAdapter } from './storage/TxtStorageAdapter';

function printUsage() {
    console.log('Usage: bun run start <URL>');
    console.log('Examples:');
    console.log('  bun run start "https://www.8novel.com/novelbooks/12345/"');
    console.log('  bun run start "https://www.wfxs.tw/booklist/9999.html"');
}

async function main() {
    const targetUrl = process.argv[2];
    const isHelp = targetUrl === '--help' || targetUrl === '-h';

    if (isHelp) {
        printUsage();
        process.exit(0);
    }

    if (!targetUrl) {
        printUsage();
        process.exit(1);
    }

    const adapter = getAdapterForUrl(targetUrl);

    if (!adapter) {
        console.error(`No adapter found for URL: ${targetUrl}`);
        process.exit(1);
    }

    const storage = new TxtStorageAdapter('./output');
    const engine = new CrawlerEngine(adapter, storage, 5);

    await engine.run(targetUrl);
}

main().catch(console.error);
