import { describe, expect, test } from 'bun:test';
import { CrawlerEngine } from '../src/core/CrawlerEngine';
import type { NovelSiteAdapter } from '../src/adapters/NovelSiteAdapter';
import type { StorageAdapter } from '../src/storage/StorageAdapter';
import type { Book, Chapter } from '../src/core/types';

class FakeAdapter implements NovelSiteAdapter {
    siteName = 'fake';
    resourceProfile = {
        maxConcurrency: 1,
        requestIntervalMs: 0,
        postSuccessDelayMs: 0
    };

    matchUrl(): boolean {
        return true;
    }

    async getBookMetadata(): Promise<Omit<Book, 'chapters'>> {
        return {
            title: 'Fake Book',
            author: 'Tester',
            description: '',
            siteId: 'fake'
        };
    }

    async getChapterList(): Promise<Chapter[]> {
        return [
            { index: 1, title: 'One', sourceUrl: 'https://example.com/1' },
            { index: 2, title: 'Two', sourceUrl: 'https://example.com/2' }
        ];
    }

    async getChapterContent(url: string): Promise<string> {
        return `content for ${url}`.padEnd(80, '.');
    }
}

describe('CrawlerEngine resource usage', () => {
    test('does not rescan every chapter for integrity after run completes', async () => {
        const counters = {
            chapterExists: 0,
            isValidChapter: 0
        };

        const storage: StorageAdapter = {
            async saveBookMetadata() {},
            async saveChapter() {},
            async chapterExists() {
                counters.chapterExists++;
                return false;
            },
            async isValidChapter() {
                counters.isValidChapter++;
                return false;
            },
            async saveRunArtifact() {},
            async readRunArtifact() {
                return null;
            }
        };

        const engine = new CrawlerEngine(new FakeAdapter(), storage, 5);
        await engine.run('https://example.com/book');

        expect(counters.chapterExists).toBe(2);
        expect(counters.isValidChapter).toBe(0);
    });
});
