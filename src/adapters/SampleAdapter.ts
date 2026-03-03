import * as cheerio from 'cheerio';
import axios from 'axios';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';

export class SampleAdapter implements NovelSiteAdapter {
    siteName = 'SampleNovelSite';

    matchUrl(url: string): boolean {
        return url.includes('example-novel-site.com');
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        // Simulated fetching
        return {
            title: 'Sample Novel Title',
            author: 'Sample Author',
            description: 'This is a sample description.',
            siteId: 'sample',
        };
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        // Simulated fetching
        return [
            { index: 1, title: 'Chapter 1', sourceUrl: 'https://example-novel-site.com/chap1' },
            { index: 2, title: 'Chapter 2', sourceUrl: 'https://example-novel-site.com/chap2' },
        ];
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        // Simulated fetching
        return 'This is the sample content of the chapter.';
    }
}
