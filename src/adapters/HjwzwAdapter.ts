import * as cheerio from 'cheerio';
import * as iconv from 'iconv-lite';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';
import { ContentCleaner } from '../utils/ContentCleaner';
import { assertNoAntiBotText, withAntiBotRetries } from './antiBot';
import { hostnameMatches } from './urlUtils';
import { AdapterHttpClient } from './httpClient';

export class HjwzwAdapter implements NovelSiteAdapter {
    siteName = 'hjwzw';
    resourceProfile = {
        maxConcurrency: 3,
        requestIntervalMs: 500,
        postSuccessDelayMs: 0
    };
    private client = new AdapterHttpClient({
        timeoutMs: 30000,
        requestIntervalMs: this.resourceProfile.requestIntervalMs,
        defaultHeaders: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        }
    });

    matchUrl(url: string): boolean {
        return hostnameMatches(url, ['tw.hjwzw.com']);
    }

    private getBookId(url: string): string {
        // e.g., https://tw.hjwzw.com/Book/35855 or https://tw.hjwzw.com/Book/Read/35855,20022572
        const match = url.match(/\/Book\/(?:Read\/)?(\d+)/i);
        return match && match[1] ? match[1] : '';
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        const bookId = this.getBookId(url);
        if (!bookId) {
            throw new Error(`[HjwzwAdapter] Could not extract book ID from URL: ${url}`);
        }

        const bookUrl = `https://tw.hjwzw.com/Book/${bookId}`;
        const { data } = await withAntiBotRetries(
            () => this.client.get<ArrayBuffer>(bookUrl, { responseType: 'arraybuffer' }),
            'hjwzw metadata'
        );
        const html = iconv.decode(Buffer.from(data), 'utf-8');
        assertNoAntiBotText(html, 'hjwzw metadata');
        const $ = cheerio.load(html);

        const title = $('h1').text().trim() || 'Unknown';

        let author = 'Unknown';
        let description = '';

        // The whole text might contain 【作 者】 and 【內容簡介】
        const fullText = $('body').text().replace(/\s+/g, ' ');

        const authorMatch = fullText.match(/【作\s*者】\s*(.*?)\s*【/);
        if (authorMatch && authorMatch[1]) {
            author = authorMatch[1].trim();
        }

        const descMatch = fullText.match(/【內容簡介】\s*(.*?)(\s*加入書架|\s*點擊閱讀|$)/);
        if (descMatch && descMatch[1]) {
            description = descMatch[1].trim();
        }

        return {
            title,
            author,
            siteId: 'hjwzw',
            sourceUrl: bookUrl,
            description
        };
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        const bookId = this.getBookId(url);
        if (!bookId) {
            throw new Error(`[HjwzwAdapter] Could not extract book ID from URL: ${url}`);
        }

        const chapterListUrl = `https://tw.hjwzw.com/Book/Chapter/${bookId}`;
        const { data } = await withAntiBotRetries(
            () => this.client.get<ArrayBuffer>(chapterListUrl, { responseType: 'arraybuffer' }),
            'hjwzw chapter list'
        );
        const html = iconv.decode(Buffer.from(data), 'utf-8');
        assertNoAntiBotText(html, 'hjwzw chapter list');
        const $ = cheerio.load(html);

        const chapters: Chapter[] = [];
        const seenUrls = new Set<string>();

        // table id tbchapterlist or just all td.css elements inside table
        $('#tbchapterlist a, .td a').each((i, el) => {
            const title = $(el).text().trim();
            const href = $(el).attr('href');
            if (href && href.includes('/Book/Read/')) {
                const fullUrl = href.startsWith('http') ? href : `https://tw.hjwzw.com${href}`;
                if (seenUrls.has(fullUrl)) {
                    return;
                }
                seenUrls.add(fullUrl);
                chapters.push({
                    index: chapters.length + 1,
                    title,
                    sourceUrl: fullUrl
                });
            }
        });

        // Some books might not have #tbchapterlist, fallback to all anchors containing Read
        if (chapters.length === 0) {
            $('a[href*="/Book/Read/"]').each((i, el) => {
                const title = $(el).text().trim();
                const href = $(el).attr('href');
                if (href && !href.includes(',0') && title) {
                    const fullUrl = href.startsWith('http') ? href : `https://tw.hjwzw.com${href}`;
                    if (seenUrls.has(fullUrl)) {
                        return;
                    }
                    seenUrls.add(fullUrl);
                    chapters.push({
                        index: chapters.length + 1,
                        title,
                        sourceUrl: fullUrl
                    });
                }
            });
        }

        return chapters;
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        const { data } = await withAntiBotRetries(
            () => this.client.get<ArrayBuffer>(chapterUrl, { responseType: 'arraybuffer' }),
            'hjwzw chapter content'
        );
        const html = iconv.decode(Buffer.from(data), 'utf-8');
        assertNoAntiBotText(html, 'hjwzw chapter content');
        const $ = cheerio.load(html);

        let targetHtml = '';
        let largestLength = 0;

        // Find the content div
        $('div[style*="font-size"]').each((i, el) => {
            const h = $(el).html() || '';
            if (h.length > largestLength) {
                largestLength = h.length;
                targetHtml = h;
            }
        });

        if (!targetHtml) {
            console.warn(`[HjwzwAdapter] Content container not found for ${chapterUrl}`);
            return '';
        }

        // 1. Remove the standard opening watermark:
        // e.g. 請記住本站域名: <b>黃金屋</b><p /> <a ...>title</a>&nbsp;[ChapterTitle]<p/>
        targetHtml = targetHtml.replace(/[\s\S]*?<a[^>]*>[^<]*<\/a>&nbsp;.*?<p\s*\/?>/i, '');

        // 2. Remove the custom end marker the user mentioned:
        // e.g. ——弘潤文德殿亂賦<br/><p />
        targetHtml = targetHtml.replace(/——[^<]*<br\s*\/?>[\s\S]*$/i, '');

        const contentText = cheerio.load(targetHtml)('body').text().trim();

        if (!contentText) {
            return '';
        }

        return ContentCleaner.clean('hjwzw', contentText);
    }
}
