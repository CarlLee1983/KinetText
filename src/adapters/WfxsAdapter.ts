import axios from 'axios';
import * as cheerio from 'cheerio';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';
import { ContentCleaner } from '../utils/ContentCleaner';

const client = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
});

export class WfxsAdapter implements NovelSiteAdapter {
    siteName = 'wfxs';

    matchUrl(url: string): boolean {
        return url.includes('wfxs.tw');
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        // If it's a chapter URL, try to get the book home page URL
        let bookUrl = url;
        if (url.match(/\/xiaoshuo\/\d+\/\d+\//)) {
            bookUrl = url.replace(/\/xiaoshuo\/(\d+)\/\d+\//, '/xiaoshuo/$1/');
        }

        const { data } = await client.get(bookUrl);
        const $ = cheerio.load(data);

        // Based on my debug_wfxs inspection
        // Note: The structure might be different on the novel home page vs list page
        const title = $('.info h1').text().trim() || $('meta[property="og:title"]').attr('content') || $('.tabstit em').text().trim();
        const author = $('.info p:contains("作者")').text().replace('作者：', '').trim() || $('meta[property="og:novel:author"]').attr('content');
        const description = $('.intro').text().trim() || $('meta[property="og:description"]').attr('content');

        return {
            title: title || 'Unknown',
            author: author || 'Unknown',
            siteId: 'wfxs',
            description: description || ''
        };
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        // If it's a chapter URL, the user wants us to follow "next" links.
        // However, it's much faster to use the list page if available.
        // But let's support both. If it's a list page /booklist/ID.html, parse all.
        // If it's a chapter page, follow next links until the end.

        if (url.includes('/booklist/')) {
            const { data } = await client.get(url);
            const $ = cheerio.load(data);
            const chapters: Chapter[] = [];
            $('#readerlists li a').each((i, el) => {
                const href = $(el).attr('href');
                const title = $(el).text().trim();
                if (href) {
                    chapters.push({
                        index: i + 1,
                        title,
                        sourceUrl: href.startsWith('http') ? href : `https://www.wfxs.tw${href}`
                    });
                }
            });
            return chapters;
        }

        // If it's a chapter page, we follow "next" links as requested
        const chapters: Chapter[] = [];
        let currentUrl = url;
        let index = 1;

        console.log(`[WfxsAdapter] Sequential discovery started from ${currentUrl}`);

        while (currentUrl) {
            try {
                const { data } = await client.get(currentUrl);
                const $ = cheerio.load(data);

                // Chapter title
                const rawTitle = $('.chapter-content h1').text();
                const pageTitle = $('title').text() || '';
                const title = rawTitle ? rawTitle.replace(/.*- /, '').trim() : (pageTitle.split('_')[0]?.trim() || `Chapter ${index}`);

                chapters.push({
                    index: index++,
                    title,
                    sourceUrl: currentUrl
                });

                // Find next link
                const nextHref = $('.foot-nav a:contains("下一章")').attr('href');
                if (nextHref && nextHref !== currentUrl && !nextHref.includes('booklist')) {
                    currentUrl = nextHref.startsWith('http') ? nextHref : `https://www.wfxs.tw${nextHref}`;

                    if (chapters.length > 5000) break; // Safety break

                    // Add a tiny delay to avoid being blocked during list generation
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    currentUrl = '';
                }
            } catch (e: any) {
                console.error(`[WfxsAdapter] Done or error at ${currentUrl}: ${e.message}`);
                break;
            }
        }

        return chapters;
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        const { data } = await client.get(chapterUrl);
        const $ = cheerio.load(data);

        // Remove scripts, styles, and ads
        $('script').remove();
        $('style').remove();
        $('.tts-control-bar').remove();

        // Extract chapter content - try multiple selectors
        let content = '';
        if ($('.chapter-content .content').length > 0) {
            content = $('.chapter-content .content').text().trim();
        } else if ($('.chapter-content').length > 0) {
            content = $('.chapter-content').text().trim();
        } else if ($('#content').length > 0) {
            content = $('#content').text().trim();
        } else {
            // Fallback: get all text from body, excluding headers and footers
            content = $('body').text().trim();
        }

        if (!content) return '';

        // Clean watermarks and noise
        return ContentCleaner.clean('wfxs', content);
    }
}
