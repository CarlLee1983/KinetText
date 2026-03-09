import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';
import { ContentCleaner } from '../utils/ContentCleaner';
import type { Browser } from 'puppeteer';

puppeteer.use(StealthPlugin());

export class TwkanAdapter implements NovelSiteAdapter {
    siteName = 'twkan';
    private browser: Browser | null = null;

    matchUrl(url: string): boolean {
        return url.includes('twkan.com');
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

    private getBaseUrl(url: string): string {
        const match = url.match(/(?:txt|book)\/(\d+)/);
        return match ? `https://twkan.com/book/${match[1]}.html` : url;
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        const bookUrl = this.getBaseUrl(url);
        const browser = await this.getBrowser();
        const page = await browser.newPage();

        try {
            await page.goto(bookUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000)); // wait for cloudflare challenge to settle if any
            let html = await page.content();

            // simple retry if still in cloudflare check
            if (html.includes('Just a moment')) {
                await new Promise(r => setTimeout(r, 5000));
                html = await page.content();
            }
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
            await page.close();
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
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));

            let html = await page.content();
            if (html.includes('Just a moment')) {
                await new Promise(r => setTimeout(r, 5000));
                html = await page.content();
            }

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
            await page.close();
        }
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        const browser = await this.getBrowser();
        const page = await browser.newPage();

        try {
            await page.goto(chapterUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));

            let html = await page.content();
            if (html.includes('Just a moment')) {
                await new Promise(r => setTimeout(r, 5000));
                html = await page.content();
            }
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
            await page.close();
        }
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}
