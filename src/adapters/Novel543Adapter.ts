import * as cheerio from 'cheerio';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';
import { ContentCleaner } from '../utils/ContentCleaner';
import { assertNoAntiBotText, withAntiBotRetries } from './antiBot';
import { createDefaultAdapterHttpClient } from './httpClient';
import { hostnameMatches } from './urlUtils';

const NOVEL543_HOSTS = [
    'novel543.com',
    'www.novel543.com',
    'look.thisiscm.com',
    'read.timotxt.com',
];

const CANONICAL_ORIGIN = 'https://www.novel543.com';

interface ChapterFileParts {
    sid: string;
    chapter: number;
    subpage: number;
}

export class Novel543Adapter implements NovelSiteAdapter {
    siteName = 'novel543';
    resourceProfile = {
        maxConcurrency: 4,
        requestIntervalMs: 400,
        postSuccessDelayMs: 0,
    };
    private client = createDefaultAdapterHttpClient(this.resourceProfile.requestIntervalMs);

    matchUrl(url: string): boolean {
        return hostnameMatches(url, NOVEL543_HOSTS);
    }

    extractBookId(url: string): string {
        const match = url.match(/\/(\d{10})(?:\/|$)/);
        return match?.[1] ?? '';
    }

    toCanonicalUrl(url: string): string {
        const parsed = new URL(url);
        return `${CANONICAL_ORIGIN}${parsed.pathname}${parsed.search}`;
    }

    toBookUrl(url: string): string {
        const bookId = this.extractBookId(url);
        if (!bookId) {
            return this.toCanonicalUrl(url);
        }
        return `${CANONICAL_ORIGIN}/${bookId}/`;
    }

    toChapterListUrl(url: string): string {
        const bookId = this.extractBookId(url);
        if (!bookId) {
            throw new Error(`Could not extract book id from URL: ${url}`);
        }
        return `${CANONICAL_ORIGIN}/${bookId}/dir`;
    }

    parseChapterFile(pathname: string): ChapterFileParts | null {
        const filename = pathname.split('/').pop() ?? '';
        const match = filename.match(/^(\d+)_(\d+)(?:_(\d+))?\.html$/);
        if (!match) {
            return null;
        }

        return {
            sid: match[1] ?? '',
            chapter: Number.parseInt(match[2] ?? '0', 10),
            subpage: Number.parseInt(match[3] ?? '1', 10),
        };
    }

    isChapterListEntry(pathname: string): boolean {
        const parts = this.parseChapterFile(pathname);
        return parts !== null && parts.subpage === 1 && !pathname.match(/\/\d+_\d+_\d+\.html$/);
    }

    isContinuationUrl(currentUrl: string, nextUrl: string): boolean {
        const current = this.parseChapterFile(new URL(currentUrl).pathname);
        const next = this.parseChapterFile(new URL(nextUrl, CANONICAL_ORIGIN).pathname);
        if (!current || !next) {
            return false;
        }

        return current.sid === next.sid
            && current.chapter === next.chapter
            && next.subpage > 1;
    }

    extractNextUrl(html: string): string | null {
        const match = html.match(/var\s+nextUrl\s*=\s*'([^']+)'/);
        if (!match?.[1]) {
            return null;
        }
        return match[1];
    }

    extractPageContent(html: string): string {
        const $ = cheerio.load(html);
        const paragraphs: string[] = [];

        $('.content p').each((_, el) => {
            const text = $(el).text().trim();
            if (!text || text.includes('溫馨提示')) {
                return;
            }
            paragraphs.push(text);
        });

        return paragraphs.join('\n\n');
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        const bookUrl = this.toBookUrl(url);
        const { data } = await withAntiBotRetries(
            () => this.client.get<string>(bookUrl),
            'novel543 metadata',
        );
        assertNoAntiBotText(data, 'novel543 metadata');
        const $ = cheerio.load(data);

        const title = $('meta[name="og:novel:book_name"]').attr('content')
            || $('h1.title').text().trim()
            || $('title').text().replace(/\(.*\).*$/u, '').trim()
            || 'Unknown';
        const author = $('meta[name="og:novel:author"]').attr('content')
            || $('.author').first().text().trim()
            || 'Unknown';
        const description = $('.intro').text().trim()
            || $('meta[name="description"]').attr('content')
            || '';
        const coverUrl = $('meta[name="og:image"]').attr('content');

        return {
            title,
            author,
            siteId: 'novel543',
            sourceUrl: bookUrl,
            description,
            coverUrl,
        };
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        const listUrl = this.toChapterListUrl(url);
        const { data } = await withAntiBotRetries(
            () => this.client.get<string>(listUrl),
            'novel543 chapter list',
        );
        assertNoAntiBotText(data, 'novel543 chapter list');
        const $ = cheerio.load(data);

        const chapters: Chapter[] = [];
        const seenUrls = new Set<string>();

        $(`a[href*="/${this.extractBookId(url)}/"]`).each((_, el) => {
            const href = $(el).attr('href');
            const title = $(el).text().trim();
            if (!href || !title) {
                return;
            }

            const fullUrl = href.startsWith('http')
                ? href
                : `${CANONICAL_ORIGIN}${href.startsWith('/') ? href : `/${href}`}`;
            const pathname = new URL(fullUrl).pathname;

            if (!this.isChapterListEntry(pathname) || seenUrls.has(fullUrl)) {
                return;
            }

            seenUrls.add(fullUrl);
            chapters.push({
                index: 0,
                title,
                sourceUrl: fullUrl,
            });
        });

        chapters.sort((a, b) => {
            const aParts = this.parseChapterFile(new URL(a.sourceUrl).pathname);
            const bParts = this.parseChapterFile(new URL(b.sourceUrl).pathname);
            return (aParts?.chapter ?? 0) - (bParts?.chapter ?? 0);
        });

        return chapters.map((chapter, index) => ({
            ...chapter,
            index: index + 1,
        }));
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        let currentUrl = this.toCanonicalUrl(chapterUrl);
        const parts: string[] = [];

        while (currentUrl) {
            const { data } = await withAntiBotRetries(
                () => this.client.get<string>(currentUrl),
                'novel543 chapter content',
            );
            assertNoAntiBotText(data, 'novel543 chapter content');

            const pageContent = this.extractPageContent(data);
            if (pageContent) {
                parts.push(pageContent);
            }

            const nextPath = this.extractNextUrl(data);
            if (!nextPath) {
                break;
            }

            const nextUrl = nextPath.startsWith('http')
                ? nextPath
                : `${CANONICAL_ORIGIN}${nextPath.startsWith('/') ? nextPath : `/${nextPath}`}`;

            if (!this.isContinuationUrl(currentUrl, nextUrl)) {
                break;
            }

            currentUrl = nextUrl;
        }

        return ContentCleaner.clean('novel543', parts.join('\n\n'));
    }
}
