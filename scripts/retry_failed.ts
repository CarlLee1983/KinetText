import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import pLimit from 'p-limit';
import { getAdapterForUrl } from '../src/adapters';
import type { Chapter } from '../src/core/types';
import { TxtStorageAdapter } from '../src/storage/TxtStorageAdapter';
import { formatCliError, parseCommonCliFlags } from '../src/cli/common';

interface FailedChapterEntry {
    index: number;
    title: string;
    sourceUrl: string;
    reason?: string;
}

function printUsage() {
    console.log('Usage: bun run retry-failed <BookTitle> [--dry-run]');
    console.log('Options:');
    console.log('  --help, -h     Show help');
    console.log('  --dry-run      Print retry plan without fetching/saving');
}

async function main() {
    const { help, dryRun, positional } = parseCommonCliFlags(process.argv.slice(2));
    if (help) {
        printUsage();
        process.exit(0);
    }

    const bookTitle = positional[0];
    if (!bookTitle) {
        printUsage();
        process.exit(1);
    }

    const outputRoot = path.join(process.cwd(), 'output');
    const bookDir = path.join(outputRoot, bookTitle);
    const failedPath = path.join(bookDir, 'failed_chapters.json');
    const reportPath = path.join(bookDir, 'retry_report.json');

    const raw = await fs.readFile(failedPath, 'utf-8');
    const failed = JSON.parse(raw) as FailedChapterEntry[];

    if (failed.length === 0) {
        console.log('[Retry] No failed chapters to retry.');
        return;
    }

    if (dryRun) {
        console.log(`[Retry][Dry-run] Book: ${bookTitle}`);
        console.log(`[Retry][Dry-run] Failed chapters: ${failed.length}`);
        console.log(`[Retry][Dry-run] Sample: ${failed.slice(0, 10).map((c) => `${c.index}:${c.title}`).join(', ')}`);
        return;
    }

    const storage = new TxtStorageAdapter('./output');
    const limit = pLimit(3);
    const maxRetries = 3;
    const stillFailed: FailedChapterEntry[] = [];
    let recovered = 0;
    let retried = 0;
    const usedAdapters = new Set<{ close?: () => Promise<void> }>();

    await Promise.all(
        failed.map((entry) =>
            limit(async () => {
                retried++;
                const adapter = getAdapterForUrl(entry.sourceUrl);
                if (!adapter) {
                    stillFailed.push({ ...entry, reason: 'No adapter matched sourceUrl' });
                    return;
                }
                usedAdapters.add(adapter);

                let content = '';
                let ok = false;
                let lastError = '';
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        content = await adapter.getChapterContent(entry.sourceUrl);
                        if (content.trim().length > 50) {
                            ok = true;
                            break;
                        }
                        lastError = `Content too short: ${content.length}`;
                    } catch (error) {
                        lastError = error instanceof Error ? error.message : String(error);
                    }
                    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                }

                if (!ok) {
                    stillFailed.push({ ...entry, reason: lastError || entry.reason || 'Unknown error' });
                    return;
                }

                const chapter: Chapter = {
                    index: entry.index,
                    title: entry.title,
                    sourceUrl: entry.sourceUrl,
                    content
                };
                await storage.saveChapter(bookTitle, chapter);
                recovered++;
                console.log(`[Retry] Recovered chapter ${entry.index}: ${entry.title}`);
            })
        )
    );

    await fs.writeFile(failedPath, JSON.stringify(stillFailed, null, 2), 'utf-8');
    await fs.writeFile(
        reportPath,
        JSON.stringify(
            {
                bookTitle,
                retried,
                recovered,
                stillFailed: stillFailed.length,
                timestamp: new Date().toISOString()
            },
            null,
            2
        ),
        'utf-8'
    );

    for (const adapter of usedAdapters) {
        if (adapter.close) {
            await adapter.close();
        }
    }

    console.log(`[Retry] Done. retried=${retried}, recovered=${recovered}, stillFailed=${stillFailed.length}`);
    console.log(`[Retry] Updated: ${failedPath}`);
    console.log(`[Retry] Report: ${reportPath}`);
}

main().catch((error) => {
    console.error(`[Error] ${formatCliError(error)}`);
    process.exit(1);
});

