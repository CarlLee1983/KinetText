export interface CommonCliFlags {
    help: boolean;
    dryRun: boolean;
    ignoreChapters: number[];
    positional: string[];
}

export function parseCommonCliFlags(args: string[]): CommonCliFlags {
    const positional: string[] = [];
    let help = false;
    let dryRun = false;
    let ignoreChapters: number[] = [];

    for (const arg of args) {
        if (arg === '--help' || arg === '-h') {
            help = true;
            continue;
        }
        if (arg === '--dry-run') {
            dryRun = true;
            continue;
        }
        if (arg.startsWith('--ignore=')) {
            const list = arg.substring('--ignore='.length);
            ignoreChapters = list.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            continue;
        }
        positional.push(arg);
    }

    return { help, dryRun, ignoreChapters, positional };
}

export function formatCliError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

export interface CrawlFlags {
    retries?: number;
    concurrency?: number;
    delay?: number;
}

/**
 * 解析爬取相關 CLI 旗標：--crawl-retries / --crawl-concurrency / --crawl-delay。
 * 非數字或缺省則該欄不設（呼叫端沿用預設）。
 */
export function parseCrawlFlags(args: string[]): CrawlFlags {
    const out: CrawlFlags = {};
    for (const arg of args) {
        const m = arg.match(/^--crawl-(retries|concurrency|delay)=(.+)$/);
        if (!m) continue;
        const n = parseInt(m[2], 10);
        if (isNaN(n)) continue;
        if (m[1] === 'retries') out.retries = n;
        else if (m[1] === 'concurrency') out.concurrency = n;
        else out.delay = n;
    }

    // Validate ranges
    if (out.retries !== undefined && out.retries < 1) {
        throw new Error('--crawl-retries 必須 >= 1');
    }
    if (out.concurrency !== undefined && out.concurrency < 1) {
        throw new Error('--crawl-concurrency 必須 >= 1');
    }
    if (out.delay !== undefined && out.delay < 0) {
        throw new Error('--crawl-delay 必須 >= 0');
    }

    return out;
}
