export interface CommonCliFlags {
    help: boolean;
    dryRun: boolean;
    positional: string[];
}

export function parseCommonCliFlags(args: string[]): CommonCliFlags {
    const positional: string[] = [];
    let help = false;
    let dryRun = false;

    for (const arg of args) {
        if (arg === '--help' || arg === '-h') {
            help = true;
            continue;
        }
        if (arg === '--dry-run') {
            dryRun = true;
            continue;
        }
        positional.push(arg);
    }

    return { help, dryRun, positional };
}

export function formatCliError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

