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

