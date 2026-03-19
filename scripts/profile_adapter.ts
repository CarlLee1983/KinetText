import { getAdapterForUrl } from '../src/adapters';
import { formatCliError } from '../src/cli/common';
import { profileAdapter } from '../src/profiling/adapterProfile';

function printUsage() {
    console.log('Usage: bun run profile <URL> [--samples=3] [--json]');
    console.log('Description: Profiles adapter metadata, chapter list, and sampled chapter fetch times.');
    console.log('Examples:');
    console.log('  bun run profile "https://www.8novel.com/novelbooks/12345/"');
    console.log('  bun run profile "https://twkan.com/book/123.html" --samples=5 --json');
}

function parseArgs(args: string[]) {
    let help = false;
    let json = false;
    let samples = 3;
    const positional: string[] = [];

    for (const arg of args) {
        if (arg === '--help' || arg === '-h') {
            help = true;
            continue;
        }
        if (arg === '--json') {
            json = true;
            continue;
        }
        if (arg.startsWith('--samples=')) {
            const value = parseInt(arg.slice('--samples='.length), 10);
            if (!Number.isNaN(value) && value >= 0) {
                samples = value;
            }
            continue;
        }
        positional.push(arg);
    }

    return { help, json, samples, positional };
}

function formatDuration(ms: number): string {
    return `${ms.toFixed(1)}ms`;
}

async function main() {
    const { help, json, samples, positional } = parseArgs(process.argv.slice(2));
    const targetUrl = positional[0];

    if (help || !targetUrl) {
        printUsage();
        process.exit(help ? 0 : 1);
    }

    const adapter = getAdapterForUrl(targetUrl);
    if (!adapter) {
        throw new Error(`No adapter found for URL: ${targetUrl}`);
    }

    try {
        const result = await profileAdapter(adapter, targetUrl, samples);

        if (json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        console.log(`Adapter: ${result.adapter}`);
        console.log(`Source: ${result.sourceUrl}`);
        console.log(`Metadata: ${formatDuration(result.metadataMs)}`);
        console.log(`Chapter list: ${formatDuration(result.chapterListMs)}`);
        console.log(`Total: ${formatDuration(result.totalMs)}`);
        console.log(`Sampled chapters: ${result.sampledChapters}`);

        if (result.chapterSamples.length > 0) {
            console.log('');
            console.log('Chapter samples:');
            for (const sample of result.chapterSamples) {
                console.log(
                    `  #${sample.index} ${sample.title} | ${formatDuration(sample.elapsedMs)} | ${sample.contentLength} chars`
                );
            }
        }
    } finally {
        if (adapter.close) {
            await adapter.close();
        }
    }
}

main().catch((error) => {
    console.error(`[Error] ${formatCliError(error)}`);
    process.exit(1);
});
