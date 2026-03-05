import pLimit from 'p-limit';
import type { NovelSiteAdapter } from '../adapters/NovelSiteAdapter';
import type { StorageAdapter } from '../storage/StorageAdapter';

export class CrawlerEngine {
    private adapter: NovelSiteAdapter;
    private storage: StorageAdapter;
    private concurrency: number;

    constructor(adapter: NovelSiteAdapter, storage: StorageAdapter, concurrency: number = 5) {
        this.adapter = adapter;
        this.storage = storage;
        this.concurrency = concurrency;
    }

    async run(url: string) {
        console.log(`[CrawlerEngine] Starting scrape for: ${url}`);

        // 1. Fetch metadata
        console.log(`[CrawlerEngine] Fetching book metadata...`);
        const metadata = await this.adapter.getBookMetadata(url);
        await this.storage.saveBookMetadata(metadata);
        console.log(`[CrawlerEngine] Metadata saved: ${metadata.title} by ${metadata.author}`);

        // 2. Fetch chapter list
        console.log(`[CrawlerEngine] Fetching chapter list...`);
        const chapters = await this.adapter.getChapterList(url);
        console.log(`[CrawlerEngine] Found ${chapters.length} chapters.`);

        // 3. Fetch chapters with concurrency control
        const limit = pLimit(this.concurrency);

        const promises = chapters.map((chapter) =>
            limit(async () => {
                try {
                    // Check if chapter already exists and is valid
                    const exists = await this.storage.chapterExists(metadata.title, chapter);
                    if (exists) {
                        const isValid = await this.storage.isValidChapter(metadata.title, chapter);
                        if (isValid) {
                            console.log(`[CrawlerEngine] Skipping existing Valid chapter ${chapter.index}: ${chapter.title}`);
                            return;
                        }
                        console.log(`[CrawlerEngine] Existing chapter ${chapter.index} is invalid, re-fetching...`);
                    }

                    let content = '';
                    let attempts = 0;
                    const maxRetries = 3;

                    while (attempts < maxRetries) {
                        attempts++;
                        try {
                            console.log(`[CrawlerEngine] Fetching chapter ${chapter.index} (Attempt ${attempts}): ${chapter.title}`);
                            content = await this.adapter.getChapterContent(chapter.sourceUrl);

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
                        return;
                    }

                    chapter.content = content;

                    // Process random delay to avoid rate-limiting between successful chapters
                    await new Promise(res => setTimeout(res, 500 + Math.random() * 1000));

                    await this.storage.saveChapter(metadata.title, chapter);
                    console.log(`[CrawlerEngine] Saved chapter ${chapter.index}: ${chapter.title}`);
                } catch (error) {
                    console.error(`[CrawlerEngine] Unexpected error processing chapter ${chapter.index}: ${chapter.title}`, error);
                }
            })
        );

        try {
            await Promise.all(promises);
            console.log(`[CrawlerEngine] Scraping finished for ${metadata.title}.`);
        } finally {
            if (this.adapter.close) {
                console.log(`[CrawlerEngine] Cleaning up adapter resources...`);
                await this.adapter.close();
            }
        }
    }
}
