import pLimit from 'p-limit';
import { NovelSiteAdapter } from '../adapters/NovelSiteAdapter';
import { StorageAdapter } from '../storage/StorageAdapter';

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
                    // Check if chapter already exists
                    if (await this.storage.chapterExists(metadata.title, chapter)) {
                        console.log(`[CrawlerEngine] Skipping existing chapter ${chapter.index}: ${chapter.title}`);
                        return;
                    }

                    console.log(`[CrawlerEngine] Fetching chapter ${chapter.index}: ${chapter.title}`);
                    const content = await this.adapter.getChapterContent(chapter.sourceUrl);
                    chapter.content = content;

                    // Process random delay to avoid rate-limiting
                    await new Promise(res => setTimeout(res, 500 + Math.random() * 1000));

                    await this.storage.saveChapter(metadata.title, chapter);
                    console.log(`[CrawlerEngine] Saved chapter ${chapter.index}: ${chapter.title}`);
                } catch (error) {
                    console.error(`[CrawlerEngine] Failed to fetch chapter ${chapter.index}: ${chapter.title}`, error);
                }
            })
        );

        await Promise.all(promises);
        console.log(`[CrawlerEngine] Scraping finished for ${metadata.title}.`);
    }
}
