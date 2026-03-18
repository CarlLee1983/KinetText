import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';
import { ContentCleaner } from '../utils/ContentCleaner';
import type { Browser, Page } from 'puppeteer';
import { hostnameMatches } from './urlUtils';
import { gotoWithAntiBotRetries, PuppeteerPagePool } from './antiBot';

puppeteer.use(StealthPlugin());

export class CzbooksAdapter implements NovelSiteAdapter {
    siteName = 'czbooks';
    resourceProfile = {
        maxConcurrency: 2,
        requestIntervalMs: 900,
        postSuccessDelayMs: 0
    };
    private browser: Browser | null = null;
    private pagePool: PuppeteerPagePool | null = null;

    matchUrl(url: string): boolean {
        return hostnameMatches(url, ['czbooks.net', 'm.czbooks.net', 'www.czbooks.net']);
    }

    private async getBrowser(): Promise<Browser> {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true, // Use headless mode
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }
        return this.browser;
    }

    private getPagePool(): PuppeteerPagePool {
        if (!this.pagePool) {
            this.pagePool = new PuppeteerPagePool(() => this.getBrowser(), this.resourceProfile.maxConcurrency);
        }
        return this.pagePool;
    }

    private async withPage<T>(task: (page: Page) => Promise<T>): Promise<T> {
        const page = await this.getPagePool().acquire();
        page.setDefaultNavigationTimeout(60000);

        try {
            return await task(page);
        } finally {
            await this.getPagePool().release(page);
        }
    }

    private getBaseUrl(url: string): string {
        const match = url.match(/(https?:\/\/(?:m\.)?czbooks\.net\/n\/[a-zA-Z0-9]+)/);
        return match ? (match[1] || url) : url;
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        const bookUrl = this.getBaseUrl(url);
        return this.withPage(async (page) => {
            const html = await gotoWithAntiBotRetries(page, bookUrl, 'czbooks metadata', [
                'span.title',
                '.novel-detail-header h1',
                'h1.title'
            ]);
            const $ = cheerio.load(html);

            const title = $('span.title').text().trim() || $('.novel-detail-header h1').text().trim() || $('h1.title').text().trim() || 'Unknown';
            const authorText = $('span.author').text().trim() || $('a[href*="/author/"]').text().trim() || $('.novel-detail-header .author').text().trim();
            const author = authorText.replace('作者:', '').replace('作者：', '').trim() || 'Unknown';
            const description = $('.description').text().trim() || $('.novel-detail-item .description').text().trim();

            return {
                title,
                author,
                siteId: 'czbooks',
                sourceUrl: bookUrl,
                description: description || ''
            };
        });
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        const bookUrl = this.getBaseUrl(url);
        return this.withPage(async (page) => {
            const html = await gotoWithAntiBotRetries(page, bookUrl, 'czbooks chapter list', [
                '#chapter-list a',
                '.chapter-list a',
                'ul.chapter-list li a'
            ]);
            const $ = cheerio.load(html);

            const chapters: Chapter[] = [];
            $('#chapter-list a, .chapter-list a, ul.chapter-list li a').each((i, el) => {
                const href = $(el).attr('href');
                const title = $(el).text().trim();

                if (href) {
                    const fullUrl = href.startsWith('//') ? `https:${href}` : (href.startsWith('http') ? href : `https://czbooks.net${href}`);
                    chapters.push({
                        index: i + 1,
                        title,
                        sourceUrl: fullUrl
                    });
                }
            });

            return chapters;
        });
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        return this.withPage(async (page) => {
            const html = await gotoWithAntiBotRetries(page, chapterUrl, 'czbooks chapter content', [
                '.content',
                '#content',
                '.chapter-content'
            ]);

            // Wait for content container to appear, with a short timeout to handle variations
            try {
                await page.waitForSelector('.content, #content, .chapter-content', { timeout: 5000 });
            } catch (e) {
                console.warn(`[CzbooksAdapter] Selector timeout for ${chapterUrl}`);
            }
            const $ = cheerio.load(html);

            // Remove scripts, styles, and ads
            $('script').remove();
            $('style').remove();

            let content = '';
            if ($('.content').length > 0) {
                content = $('.content').text().trim();
            } else if ($('#content').length > 0) {
                content = $('#content').text().trim();
            } else if ($('.chapter-content').length > 0) {
                content = $('.chapter-content').text().trim();
            }

            if (!content) return '';

            // Clean watermarks and noise specific to czbooks
            content = content.replace(/本章未完.*/g, '');
            content = content.replace(/\(本章完\)/g, '');
            content = content.replace(/<.*?>/g, ''); // just in case

            return ContentCleaner.clean('czbooks', content);
        });
    }

    async close(): Promise<void> {
        if (this.browser) {
            if (this.browser.isConnected()) {
                await this.browser.close();
            }
            this.browser = null;
        }
        this.pagePool?.reset();
        this.pagePool = null;
    }
}
