import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';
import { ContentCleaner } from '../utils/ContentCleaner';
import type { Browser } from 'puppeteer';
import { hostnameMatches } from './urlUtils';
import { assertNoAntiBotText, gotoWithAntiBotRetries } from './antiBot';

puppeteer.use(StealthPlugin());

export class TwkanAdapter implements NovelSiteAdapter {
    siteName = 'twkan';
    private browser: Browser | null = null;

    matchUrl(url: string): boolean {
        return hostnameMatches(url, ['twkan.com', 'www.twkan.com']);
    }

    private async getBrowser(): Promise<Browser> {
        if (!this.browser || !this.browser.isConnected()) {
            this.browser = await puppeteer.launch({
                headless: true, // Use headless mode
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage', // Prevent shared memory issues
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ]
            });
        }
        return this.browser;
    }

    private getBaseUrl(url: string): string {
        const match = url.match(/(?:txt|book)\/(\d+)/);
        return match ? `https://twkan.com/book/${match[1]}.html` : url;
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        const bookUrl = this.getBaseUrl(url);
        const browser = await this.getBrowser();
        const page = await browser.newPage();

        try {
            const html = await gotoWithAntiBotRetries(page, bookUrl, 'twkan metadata', [
                'meta[property="og:title"]',
                'title'
            ]);
            const $ = cheerio.load(html);

            const titleMatch = html.match(/articlename:\s*'([^']+)'/);
            let title = titleMatch ? titleMatch[1] : ($('meta[property="og:title"]').attr('content') || $('title').text().split(',')[0]);
            title = title ? title.trim() : 'Unknown';
            if (title === 'undefined' || !title) title = 'Unknown';

            const authorMatch = html.match(/author:\s*'([^']+)'/);
            let author = authorMatch ? authorMatch[1] : $('meta[property="og:novel:author"]').attr('content');
            author = author ? author.trim() : 'Unknown';
            if (author === 'undefined' || !author) author = 'Unknown';

            const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';

            return {
                title,
                author,
                siteId: 'twkan',
                sourceUrl: bookUrl,
                description
            };
        } finally {
            try {
                if (!page.isClosed()) {
                    await page.close();
                }
            } catch (e) {
                // Ignore errors during close
            }
        }
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        const articleMatch = url.match(/(?:txt|book)\/(\d+)/);
        const articleId = articleMatch ? articleMatch[1] : '';

        let targetUrl = this.getBaseUrl(url);
        if (articleId) {
            targetUrl = `https://twkan.com/ajax_novels/chapterlist/${articleId}.html`;
        }

        const browser = await this.getBrowser();
        const page = await browser.newPage();

        try {
            const html = await gotoWithAntiBotRetries(page, targetUrl, 'twkan chapter list', ['li a']);
            const $ = cheerio.load(html);

            const chapters: Chapter[] = [];
            $('li a').each((i, el) => {
                let href = $(el).attr('href');
                let title = $(el).text().trim();

                if (href) {
                    const fullUrl = href.startsWith('http') ? href : `https://twkan.com${href.startsWith('/') ? href : `/${href}`}`;
                    chapters.push({
                        index: i + 1,
                        title,
                        sourceUrl: fullUrl
                    });
                }
            });

            // unique chapters based on sourceUrl
            const uniqueChapters = chapters.filter((v, i, a) => a.findIndex(t => (t.sourceUrl === v.sourceUrl)) === i);

            uniqueChapters.forEach((ch, idx) => { ch.index = idx + 1; });

            return uniqueChapters;
        } finally {
            try {
                if (!page.isClosed()) {
                    await page.close();
                }
            } catch (e) {
                // Ignore errors during close
            }
        }
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        
        // Increase timeout for individual chapters
        page.setDefaultNavigationTimeout(60000);

        try {
            const html = await gotoWithAntiBotRetries(page, chapterUrl, 'twkan chapter content', [
                'div[id^="txtcontent"]',
                '#content',
                '#chaptercontent'
            ]);
            assertNoAntiBotText(html, 'twkan chapter content');
            const $ = cheerio.load(html);

            $('script').remove();
            $('style').remove();

            let content = '';
            const contentSelectors = ['div[id^="txtcontent"]', '#content', '#chaptercontent'];
            for (const sel of contentSelectors) {
                if ($(sel).length > 0) {
                    content = $(sel).text().trim();
                    if (content.length > 50) break;
                }
            }

            if (!content) return '';

            // Clean watermarks and noise specific to twkan
            content = content.replace(/本章未完.*/g, '');
            content = content.replace(/\(本章完\)/g, '');

            // Ensure the content starts from the third line (skip chapter title and empty line)
            const lines = content.split('\n');
            if (lines.length > 2) {
                content = lines.slice(2).join('\n');
            }

            return ContentCleaner.clean('twkan', content);
        } finally {
            try {
                if (!page.isClosed()) {
                    await page.close();
                }
            } catch (e) {
                // Ignore errors during close
            }
        }
    }

    async close(): Promise<void> {
        if (this.browser) {
            try {
                if (this.browser.isConnected()) {
                    await this.browser.close();
                }
            } catch (e) {
                // Ignore errors during close
            }
            this.browser = null;
        }
    }
}
