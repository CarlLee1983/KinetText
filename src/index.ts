import { CrawlerEngine } from './core/CrawlerEngine';
import { getAdapterForUrl } from './adapters';
import { TxtStorageAdapter } from './storage/TxtStorageAdapter';
import { formatCliError, parseCommonCliFlags } from './cli/common';

function printUsage() {
    console.log('Usage: bun run start <URL>');
    console.log('Options:');
    console.log('  --help, -h     Show help');
    console.log('  --dry-run      Fetch metadata/chapter list only (no chapter download)');
    console.log('  --ignore=<n,m> Ignore specific chapter indices (e.g., --ignore=180,241)');
    console.log('Examples:');
    console.log('  bun run start "https://www.8novel.com/novelbooks/12345/"');
    console.log('  bun run start "https://www.wfxs.tw/booklist/9999.html"');
}

async function main() {
    const { help, dryRun, ignoreChapters, positional } = parseCommonCliFlags(process.argv.slice(2));
    const targetUrl = positional[0];

    if (help) {
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

    await engine.run(targetUrl, { dryRun, ignoreChapters });
}

main().catch((error) => {
    console.error(`[Error] ${formatCliError(error)}`);
    process.exit(1);
});
