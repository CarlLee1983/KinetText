import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';
import { ContentCleaner } from '../utils/ContentCleaner';
import type { Browser, Page } from 'puppeteer';
import { hostnameMatches } from './urlUtils';
import { assertNoAntiBotText, gotoWithAntiBotRetries, PuppeteerPagePool } from './antiBot';

puppeteer.use(StealthPlugin());

export class UukanshuAdapter implements NovelSiteAdapter {
    siteName = 'uukanshu';
    resourceProfile = {
        maxConcurrency: 2,
        requestIntervalMs: 900,
        postSuccessDelayMs: 0
    };
    private browser: Browser | null = null;
    private pagePool: PuppeteerPagePool | null = null;

    matchUrl(url: string): boolean {
        return hostnameMatches(url, ['uukanshu.cc', 'www.uukanshu.cc']);
    }

    private async getBrowser(): Promise<Browser> {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true,
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
        const match = url.match(/(https?:\/\/(?:www\.)?uukanshu\.cc\/book\/\d+)/);
        return match ? (match[1] || url) : url;
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        const bookUrl = this.getBaseUrl(url);
        return this.withPage(async (page) => {
            const html = await gotoWithAntiBotRetries(page, bookUrl, 'uukanshu metadata', [
                '.booktitle h1',
                'meta[property="og:title"]'
            ]);
            const $ = cheerio.load(html);

            const title = $('.booktitle h1').text().trim() || $('h1.booktitle').text().trim() || $('h1').text().trim() || $('meta[property="og:title"]').attr('content') || 'Unknown';
            const author = $('.booktag a').first().text().trim() || $('meta[property="og:novel:author"]').attr('content') || 'Unknown';
            const description = $('.bookintro').text().trim() || $('meta[property="og:description"]').attr('content') || 'Unknown';

            return {
                title,
                author,
                siteId: 'uukanshu',
                sourceUrl: bookUrl,
                description
            };
        });
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        const bookUrl = this.getBaseUrl(url);
        return this.withPage(async (page) => {
            const html = await gotoWithAntiBotRetries(page, bookUrl, 'uukanshu chapter list', [
                '.booklist dl dd a',
                '.chapterlist a',
                '.book-chapter-list a'
            ]);
            const $ = cheerio.load(html);

            const chapters: Chapter[] = [];
            $('.booklist dl dd a, dl dd a, .chapterlist a, .book-chapter-list a').each((i, el) => {
                const href = $(el).attr('href');
                const title = $(el).text().trim();

                if (href) {
                    const fullUrl = new URL(href, 'https://uukanshu.cc').href;
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
            await gotoWithAntiBotRetries(page, chapterUrl, 'uukanshu chapter content', [
                '.book.read',
                '.content',
                '#content',
                'article'
            ]);

            try {
                // Wait for the actual content element to appear (bypasses Cloudflare challenge load time)
                await page.waitForSelector('.book.read, .content, #content, article', { timeout: 20000 });
            } catch (e) {
                console.warn(`[UukanshuAdapter] Timeout waiting for content text in ${chapterUrl}`);
            }

            const rawText = await page.evaluate(() => {
                // @ts-ignore
                document.querySelectorAll('ol.breadcrumb, .breadcrumb, h1, .booktitle, script, style').forEach(e => e.remove());
                // @ts-ignore
                const el = document.querySelector('.book.read, .content, #content, article');
                // @ts-ignore
                return el ? el.innerText : document.body.innerText;
            });

            if (!rawText) return '';

            assertNoAntiBotText(rawText, 'uukanshu chapter content');

            let lines = rawText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
            // Clean up navigation text
            lines = lines.filter((l: string) => {
                if (l === '關燈 字體- 字體+') return false;
                if (l.match(/^上一章.*下一章$/)) return false;
                if (l.includes('投票推薦 加入書籤 小說報錯')) return false;
                if (l === '首頁') return false;

                // Also skip potential novel titles at the top if they are right before chapter titles
                return true;
            });

            // Rejoin lines
            let content = lines.join('\n');

            // Generic cleanups
            content = content.replace(/投票推薦 加入書籤 小說報錯/g, '');
            content = content.replace(/請記住本書首發域名：.*/g, '');
            content = content.replace(/最新網址：.*/g, '');
            content = content.replace(/UU看書/g, ''); // maybe remove site names

            return ContentCleaner.clean('uukanshu', content);
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
