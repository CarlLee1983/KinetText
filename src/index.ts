import { CrawlerEngine } from './core/CrawlerEngine';
import { getAdapterForUrl } from './adapters';
import { TxtStorageAdapter } from './storage/TxtStorageAdapter';

async function main() {
    const targetUrl = process.argv[2];

    if (!targetUrl) {
        console.log('Usage: bun src/index.ts <URL>');
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
