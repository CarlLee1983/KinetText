import { CrawlerEngine } from './core/CrawlerEngine';
import { getAdapterForUrl } from './adapters';
import { TxtStorageAdapter } from './storage/TxtStorageAdapter';
import { formatCliError, parseCommonCliFlags } from './cli/common';

function printUsage() {
    console.log('Usage: bun run start <URL>');
    console.log('Options:');
    console.log('  --help, -h        Show help');
    console.log('  --dry-run         Fetch metadata/chapter list only (no chapter download)');
    console.log('  --ignore=<n,m>    Ignore specific chapter indices (e.g., --ignore=180,241)');
    console.log('  --use-go-audio    Enable Go backend for audio conversion');
    console.log('Examples:');
    console.log('  bun run start "https://www.8novel.com/novelbooks/12345/"');
    console.log('  bun run start "https://www.wfxs.tw/booklist/9999.html"');
    console.log('  bun run start "https://www.8novel.com/..." --use-go-audio');
}

async function main() {
    const args = process.argv.slice(2);
    const { help, dryRun, ignoreChapters, positional } = parseCommonCliFlags(args);
    const targetUrl = positional[0];
    const useGoAudio = args.includes('--use-go-audio');

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
    const engine = new CrawlerEngine(adapter, storage, {
        concurrency: 5,
        audio: { useGoBackend: useGoAudio },
    });

    await engine.run(targetUrl, { dryRun, ignoreChapters });

    process.exit(0);
}

main().catch((error) => {
    console.error(`[Error] ${formatCliError(error)}`);
    process.exit(1);
});
