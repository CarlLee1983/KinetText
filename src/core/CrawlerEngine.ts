import pLimit from 'p-limit';
import type { NovelSiteAdapter } from '../adapters/NovelSiteAdapter';
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { Chapter } from './types';

interface CrawlerRunOptions {
    dryRun?: boolean;
    ignoreChapters?: number[];
}

type ChapterStatus =
    | 'saved'
    | 'skipped_valid'
    | 'skipped_manual'
    | 'failed_short_content'
    | 'failed_error';

interface ChapterResult {
    index: number;
    title: string;
    sourceUrl: string;
    status: ChapterStatus;
    attempts: number;
    contentLength: number;
    reason?: string;
}

interface IntegrityReport {
    expectedCount: number;
    uniqueIndexCount: number;
    missingIndices: number[];
    duplicateIndices: number[];
    emptyOrInvalidIndices: number[];
}

export class CrawlerEngine {
    private adapter: NovelSiteAdapter;
    private storage: StorageAdapter;
    private concurrency: number;

    constructor(adapter: NovelSiteAdapter, storage: StorageAdapter, concurrency: number = 5) {
        this.adapter = adapter;
        this.storage = storage;
        this.concurrency = concurrency;
    }

    async run(url: string, options: CrawlerRunOptions = {}) {
        const dryRun = options.dryRun === true;
        const runStartedAt = Date.now();
        console.log(`[CrawlerEngine] Starting scrape for: ${url}`);

        // 1. Fetch metadata
        console.log(`[CrawlerEngine] Fetching book metadata...`);
        const metadata = await this.adapter.getBookMetadata(url);
        if (!dryRun) {
            await this.storage.saveBookMetadata(metadata);
            console.log(`[CrawlerEngine] Metadata saved: ${metadata.title} by ${metadata.author}`);
        } else {
            console.log(`[CrawlerEngine] Dry-run: metadata fetched (${metadata.title} by ${metadata.author})`);
        }

        // 1.5. Read previous run artifact for manual ignores
        let prevManualIgnores: number[] = [];
        if (this.storage.readRunArtifact) {
            const prevReport = await this.storage.readRunArtifact<{ manualIgnoreIndices?: number[] }>(metadata.title, 'run_report.json');
            if (prevReport?.manualIgnoreIndices) {
                prevManualIgnores = prevReport.manualIgnoreIndices;
            }
        }

        // Merge with CLI ignored chapters
        if (!options.ignoreChapters) options.ignoreChapters = [];
        const mergedIgnores = new Set([...options.ignoreChapters, ...prevManualIgnores]);
        options.ignoreChapters = Array.from(mergedIgnores);

        if (options.ignoreChapters.length > 0) {
            console.log(`[CrawlerEngine] Active manual ignores: ${options.ignoreChapters.length} chapters.`);
        }

        // 2. Fetch chapter list
        console.log(`[CrawlerEngine] Fetching chapter list...`);
        const chapters = await this.adapter.getChapterList(url);
        console.log(`[CrawlerEngine] Found ${chapters.length} chapters.`);

        if (dryRun) {
            console.log(`[CrawlerEngine] Dry-run: skipping chapter fetch and save.`);
            return;
        }

        // 3. Fetch chapters with concurrency control
        const limit = pLimit(this.concurrency);
        const chapterResults: ChapterResult[] = [];
        const failedChapters: ChapterResult[] = [];

        const promises = chapters.map((chapter) =>
            limit(async () => {
                const result: ChapterResult = {
                    index: chapter.index,
                    title: chapter.title,
                    sourceUrl: chapter.sourceUrl,
                    status: 'failed_error',
                    attempts: 0,
                    contentLength: 0
                };

                if (options.ignoreChapters?.includes(chapter.index)) {
                    console.log(`[CrawlerEngine] Manually ignoring chapter ${chapter.index}: ${chapter.title}`);
                    result.status = 'skipped_manual';
                    chapterResults.push(result);
                    return;
                }

                try {
                    // Check if chapter already exists and is valid
                    const exists = await this.storage.chapterExists(metadata.title, chapter);
                    if (exists) {
                        const isValid = await this.storage.isValidChapter(metadata.title, chapter);
                        if (isValid) {
                            console.log(`[CrawlerEngine] Skipping existing Valid chapter ${chapter.index}: ${chapter.title}`);
                            result.status = 'skipped_valid';
                            chapterResults.push(result);
                            return;
                        }
                        console.log(`[CrawlerEngine] Existing chapter ${chapter.index} is invalid, re-fetching...`);
                    }

                    let content = '';
                    let attempts = 0;
                    const maxRetries = 3;

                    while (attempts < maxRetries) {
                        attempts++;
                        result.attempts = attempts;
                        try {
                            console.log(`[CrawlerEngine] Fetching chapter ${chapter.index} (Attempt ${attempts}): ${chapter.title}`);
                            content = await this.adapter.getChapterContent(chapter.sourceUrl);
                            result.contentLength = content?.length || 0;

                            // Simple validation
                            if (content && content.trim().length > 50) {
                                break;
                            }
                            console.warn(`[CrawlerEngine] Content too short for chapter ${chapter.index} (Length: ${content?.length || 0})`);
                        } catch (error) {
                            console.error(`[CrawlerEngine] Failed to fetch chapter ${chapter.index} on attempt ${attempts}`, error);
                        }

                        if (attempts < maxRetries) {
                            const delay = 2000 * attempts + Math.random() * 1000;
                            await new Promise(res => setTimeout(res, delay));
                        }
                    }

                    if (!content || content.trim().length <= 50) {
                        console.error(`[CrawlerEngine] Failed to get valid content for chapter ${chapter.index} after ${maxRetries} attempts. Skipping save.`);
                        result.status = 'failed_short_content';
                        result.reason = `Content too short after ${maxRetries} attempts`;
                        chapterResults.push(result);
                        failedChapters.push(result);
                        return;
                    }

                    chapter.content = content;

                    // Process random delay to avoid rate-limiting between successful chapters
                    await new Promise(res => setTimeout(res, 500 + Math.random() * 1000));

                    await this.storage.saveChapter(metadata.title, chapter);
                    console.log(`[CrawlerEngine] Saved chapter ${chapter.index}: ${chapter.title}`);
                    result.status = 'saved';
                    result.contentLength = content.length;
                    chapterResults.push(result);
                } catch (error) {
                    console.error(`[CrawlerEngine] Unexpected error processing chapter ${chapter.index}: ${chapter.title}`, error);
                    result.status = 'failed_error';
                    result.reason = error instanceof Error ? error.message : String(error);
                    chapterResults.push(result);
                    failedChapters.push(result);
                }
            })
        );

        try {
            await Promise.all(promises);
            const integrity = await this.buildIntegrityReport(metadata.title, chapters);
            const finishedAt = Date.now();
            const reasonCounts = this.countFailureReasons(failedChapters);
            const runReport = {
                runStartedAt: new Date(runStartedAt).toISOString(),
                runFinishedAt: new Date(finishedAt).toISOString(),
                durationMs: finishedAt - runStartedAt,
                adapter: this.adapter.siteName,
                sourceUrl: url,
                book: {
                    title: metadata.title,
                    author: metadata.author,
                    chapterCount: chapters.length
                },
                summary: {
                    saved: chapterResults.filter((r) => r.status === 'saved').length,
                    skippedValid: chapterResults.filter((r) => r.status === 'skipped_valid').length,
                    skippedManual: chapterResults.filter((r) => r.status === 'skipped_manual').length,
                    failed: failedChapters.length
                },
                failuresTopReasons: Object.entries(reasonCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([reason, count]) => ({ reason, count })),
                manualIgnoreIndices: options.ignoreChapters,
                integrity,
                failedChaptersFile: failedChapters.length > 0 ? 'failed_chapters.json' : null
            };

            if (failedChapters.length > 0 && this.storage.saveRunArtifact) {
                await this.storage.saveRunArtifact(metadata.title, 'failed_chapters.json', failedChapters);
            }
            if (this.storage.saveRunArtifact) {
                await this.storage.saveRunArtifact(metadata.title, 'run_report.json', runReport);
            }

            console.log(`[CrawlerEngine] Run summary: saved=${runReport.summary.saved}, skipped=${runReport.summary.skippedValid}, skipped(manual)=${runReport.summary.skippedManual}, failed=${runReport.summary.failed}, duration=${runReport.durationMs}ms`);
            if (integrity.missingIndices.length > 0 || integrity.duplicateIndices.length > 0 || integrity.emptyOrInvalidIndices.length > 0) {
                console.warn(`[CrawlerEngine] Integrity warnings: missing=${integrity.missingIndices.length}, duplicate=${integrity.duplicateIndices.length}, emptyOrInvalid=${integrity.emptyOrInvalidIndices.length}`);
            }
            console.log(`[CrawlerEngine] Scraping finished for ${metadata.title}.`);
        } finally {
            if (this.adapter.close) {
                console.log(`[CrawlerEngine] Cleaning up adapter resources...`);
                await this.adapter.close();
            }
        }
    }

    private async buildIntegrityReport(bookTitle: string, chapters: Chapter[]): Promise<IntegrityReport> {
        const indices = chapters.map((c) => c.index).sort((a, b) => a - b);
        const indexCounts = new Map<number, number>();
        for (const idx of indices) {
            indexCounts.set(idx, (indexCounts.get(idx) || 0) + 1);
        }
        const duplicateIndices = [...indexCounts.entries()].filter(([, count]) => count > 1).map(([idx]) => idx);
        const minIndex = indices[0] || 1;
        const maxIndex = indices[indices.length - 1] || 0;
        const present = new Set(indices);
        const missingIndices: number[] = [];
        for (let i = minIndex; i <= maxIndex; i++) {
            if (!present.has(i)) missingIndices.push(i);
        }

        const emptyOrInvalidIndices: number[] = [];
        const validateLimit = pLimit(Math.max(1, Math.min(10, this.concurrency)));
        await Promise.all(
            chapters.map((chapter) =>
                validateLimit(async () => {
                    const exists = await this.storage.chapterExists(bookTitle, chapter);
                    if (!exists) {
                        emptyOrInvalidIndices.push(chapter.index);
                        return;
                    }
                    const valid = await this.storage.isValidChapter(bookTitle, chapter);
                    if (!valid) {
                        emptyOrInvalidIndices.push(chapter.index);
                    }
                })
            )
        );

        return {
            expectedCount: chapters.length,
            uniqueIndexCount: indexCounts.size,
            missingIndices,
            duplicateIndices,
            emptyOrInvalidIndices: [...new Set(emptyOrInvalidIndices)].sort((a, b) => a - b)
        };
    }

    private countFailureReasons(failures: ChapterResult[]): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const failure of failures) {
            const key = failure.reason || 'Unknown';
            counts[key] = (counts[key] || 0) + 1;
        }
        return counts;
    }
}
