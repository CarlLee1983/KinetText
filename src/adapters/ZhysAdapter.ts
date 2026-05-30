import * as cheerio from 'cheerio';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';
import { ContentCleaner } from '../utils/ContentCleaner';
import { assertNoAntiBotText, withAntiBotRetries } from './antiBot';
import { createDefaultAdapterHttpClient } from './httpClient';

const ZHYS_HOST_PATTERN = /(?:^|\.)zhys\.tw$/i;

export class ZhysAdapter implements NovelSiteAdapter {
    siteName = 'zhys';
    resourceProfile = {
        maxConcurrency: 3,
        requestIntervalMs: 500,
        postSuccessDelayMs: 0
    };
    private client = createDefaultAdapterHttpClient(this.resourceProfile.requestIntervalMs);

    matchUrl(url: string): boolean {
        try {
            const { hostname } = new URL(url);
            return ZHYS_HOST_PATTERN.test(hostname.toLowerCase());
        } catch {
            return false;
        }
    }

    private getOrigin(url: string): string {
        return new URL(url).origin;
    }

    private extractBookId(url: string): string {
        const match = url.match(/\/(?:book|read)\/(\d+)/);
        return match?.[1] ?? '';
    }

    private toBookUrl(url: string): string {
        const bookId = this.extractBookId(url);
        if (!bookId) {
            return url;
        }
        return `${this.getOrigin(url)}/book/${bookId}.html`;
    }

    private toAbsoluteUrl(url: string, href: string): string {
        return href.startsWith('http') ? href : new URL(href, url).href;
    }

    private parseBookTitle(rawTitle: string): string {
        const parts = rawTitle.split(' - ').map((part) => part.trim()).filter(Boolean);
        return parts[0] || 'Unknown';
    }

    private parseAuthor($: cheerio.CheerioAPI, rawTitle: string): string {
        const jsonLd = $('script[type="application/ld+json"]').first().text();
        if (jsonLd) {
            try {
                const data = JSON.parse(jsonLd) as { author?: { name?: string } };
                const name = data.author?.name?.trim();
                if (name) {
                    return name;
                }
            } catch {
                // Ignore malformed JSON-LD and fall back to title parsing.
            }
        }

        const metaAuthor = $('meta[name="author"]').attr('content')?.trim();
        if (metaAuthor && metaAuthor !== '免費小說') {
            return metaAuthor;
        }

        const parts = rawTitle.split(' - ').map((part) => part.trim()).filter(Boolean);
        return parts[1] || 'Unknown';
    }

    private async fetchHtml(url: string, context: string): Promise<string> {
        const { data } = await withAntiBotRetries(
            () => this.client.get<string>(url),
            context
        );
        assertNoAntiBotText(data, context);
        return data;
    }

    private dedupeParagraphs(paragraphs: string[]): string[] {
        for (let i = 1; i < paragraphs.length; i++) {
            if (paragraphs[i] !== paragraphs[0]) {
                continue;
            }

            const first = paragraphs.slice(0, i);
            const second = paragraphs.slice(i, i + first.length);
            if (second.length === first.length && second.every((paragraph, index) => paragraph === first[index])) {
                return first;
            }
        }

        return paragraphs;
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        const bookUrl = this.toBookUrl(url);
        const html = await this.fetchHtml(bookUrl, 'zhys metadata');
        const $ = cheerio.load(html);

        const rawTitle = $('meta[property="og:title"]').attr('content')
            || $('title').text().trim()
            || 'Unknown';
        const title = this.parseBookTitle(rawTitle);
        const author = this.parseAuthor($, rawTitle);
        const description = $('script[type="application/ld+json"]').first().text()
            ? (() => {
                try {
                    const data = JSON.parse($('script[type="application/ld+json"]').first().text()) as { description?: string };
                    return data.description?.trim() || '';
                } catch {
                    return '';
                }
            })()
            : '';

        return {
            title,
            author,
            siteId: 'zhys',
            sourceUrl: bookUrl,
            description: description || $('meta[property="og:description"]').attr('content')?.trim() || ''
        };
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        const bookUrl = this.toBookUrl(url);
        const bookId = this.extractBookId(bookUrl);
        if (!bookId) {
            return [];
        }

        const html = await this.fetchHtml(bookUrl, 'zhys chapter list');
        const $ = cheerio.load(html);
        const chapterMap = new Map<number, { title: string; sourceUrl: string }>();

        $(`a[href^="/read/${bookId}/"]`).each((_, element) => {
            const href = $(element).attr('href');
            const title = $(element).text().replace(/上次閱讀/g, '').trim();
            const chapterIdMatch = href?.match(/\/(\d+)\.html$/);
            if (!href || !title || !chapterIdMatch) {
                return;
            }

            const chapterId = Number(chapterIdMatch[1]);
            if (!chapterMap.has(chapterId)) {
                chapterMap.set(chapterId, {
                    title,
                    sourceUrl: this.toAbsoluteUrl(bookUrl, href)
                });
            }
        });

        return Array.from(chapterMap.entries())
            .sort(([leftId], [rightId]) => leftId - rightId)
            .map(([_, chapter], index) => ({
                index: index + 1,
                title: chapter.title,
                sourceUrl: chapter.sourceUrl
            }));
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        const html = await this.fetchHtml(chapterUrl, 'zhys chapter content');
        const $ = cheerio.load(html);

        $('script').remove();
        $('style').remove();

        const paragraphs = $('#article-content p')
            .map((_, element) => $(element).text().trim())
            .get()
            .filter(Boolean);

        if (paragraphs.length === 0) {
            return '';
        }

        const content = this.dedupeParagraphs(paragraphs).join('\n\n');
        return ContentCleaner.clean('zhys', content);
    }
}
