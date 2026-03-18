import axios from 'axios';
import * as cheerio from 'cheerio';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';
import { ContentCleaner } from '../utils/ContentCleaner';
import { hostnameMatches } from './urlUtils';
import { assertNoAntiBotText, withAntiBotRetries } from './antiBot';

const client = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
});

export class XswAdapter implements NovelSiteAdapter {
    siteName = 'xsw';

    matchUrl(url: string): boolean {
        return hostnameMatches(url, ['m.xsw.tw', 'www.xsw.tw', 'xsw.tw']);
    }

    private extractBookId(url: string): string {
        const match = url.match(/https?:\/\/(?:m|www)\.xsw\.tw\/(\d+)(?:\/|$)/);
        return match?.[1] || '';
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        // Find the base book URL (e.g. from https://m.xsw.tw/1730108/251856158.html to https://m.xsw.tw/1730108/)
        let bookUrl = url;
        const match = url.match(/(https?:\/\/(?:m|www)\.xsw\.tw\/\d+\/)/);
        if (match && match[1]) {
            bookUrl = match[1];
        }

        const { data } = await withAntiBotRetries(
            () => client.get<string>(bookUrl),
            'xsw metadata'
        );
        assertNoAntiBotText(data, 'xsw metadata');
        const $ = cheerio.load(data);

        // m.xsw.tw parsing
        const title = $('.block_txt2 h2').text().trim() || $('meta[property="og:title"]').attr('content') || 'Unknown';
        const authorText = $('.block_txt2 p').filter((i, el) => $(el).text().includes('作者：')).text();
        const author = authorText ? authorText.replace('作者：', '').trim() : 'Unknown';

        // try to find description from meta or other places if present
        const description = $('meta[name="description"]').attr('content') || '';

        return {
            title,
            author,
            siteId: 'xsw',
            sourceUrl: bookUrl,
            description
        };
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        // Derive the base book URL (ID)
        // Example: https://m.xsw.tw/1730108/251856158.html -> 1730108
        const bookId = this.extractBookId(url);

        if (!bookId) {
            console.warn(`[XswAdapter] Could not derive book ID from ${url}, falling back to sequential.`);
            return this.getSequentialChapters(url);
        }

        let currentPage = 1;
        let totalPages = 1;
        const chapters: Chapter[] = [];
        const seenUrls = new Set<string>();

        console.log(`[XswAdapter] Fetching all chapter pages for book ${bookId} starting from page 1...`);

        while (currentPage <= totalPages) {
            const pageUrl = `https://m.xsw.tw/${bookId}/page-${currentPage}.html`;
            try {
                const { data } = await withAntiBotRetries(
                    () => client.get<string>(pageUrl),
                    'xsw paginated chapter list'
                );
                assertNoAntiBotText(data, 'xsw paginated chapter list');
                const $ = cheerio.load(data);

                // Specific selectors for the actual chronological chapter list
                const listSelectors = [
                    'ul.chapter li a',
                    'ul.chapter-list li a',
                    '.block_txt2 li a',
                    '.ablum_read li a'
                ];

                let foundOnPage = 0;
                for (const selector of listSelectors) {
                    $(selector).each((i, el) => {
                        const href = $(el).attr('href');
                        const title = $(el).text().trim();

                        if (href && /\/\d+\/\d+\.html/.test(href)) {
                            const fullUrl = href.startsWith('http') ? href : `https://m.xsw.tw${href}`;
                            if (!seenUrls.has(fullUrl)) {
                                seenUrls.add(fullUrl);
                                chapters.push({
                                    index: chapters.length + 1,
                                    title,
                                    sourceUrl: fullUrl
                                });
                                foundOnPage++;
                            }
                        }
                    });
                    if (foundOnPage > 0) break;
                }

                // Update totalPages from pagination links using labels
                const tailHref = $('a:contains("尾頁")').attr('href') || $('a:contains("末頁")').attr('href');
                if (tailHref) {
                    const pageMatch = tailHref.match(/page-(\d+)\.html/);
                    if (pageMatch && pageMatch[1]) {
                        totalPages = Math.max(totalPages, parseInt(pageMatch[1], 10));
                    }
                }
                const nextHref = $('a:contains("下一頁")').attr('href') || $('a:contains("下頁")').attr('href');
                if (nextHref && totalPages <= currentPage) {
                    totalPages = currentPage + 1;
                }

                console.log(`[XswAdapter] Processed Page ${currentPage}/${totalPages}. Total chapters: ${chapters.length}`);
                currentPage++;

                if (currentPage > 300) break; // Safety limit
                await new Promise(r => setTimeout(r, 200));
            } catch (err: any) {
                console.warn(`[XswAdapter] Finished at page ${currentPage - 1} or error: ${err.message}`);
                break;
            }
        }

        if (chapters.length > 0) {
            return chapters;
        }

        return this.getSequentialChapters(url);
    }

    private async getSequentialChapters(url: string): Promise<Chapter[]> {
        console.warn(`[XswAdapter] Falling back to sequential discovery.`);
        const chapters: Chapter[] = [];
        let currentUrl = url;
        let index = 1;

        while (currentUrl && currentUrl.endsWith('.html')) {
            try {
                const { data: pageData } = await withAntiBotRetries(
                    () => client.get<string>(currentUrl),
                    'xsw sequential chapter discovery'
                );
                assertNoAntiBotText(pageData, 'xsw sequential chapter discovery');
                const $page = cheerio.load(pageData);
                const title = $page('.nr_title').text().trim() || `Chapter ${index}`;

                chapters.push({
                    index: index++,
                    title,
                    sourceUrl: currentUrl
                });

                const nextHref = $page('#pb_next').attr('href');
                if (nextHref && nextHref.endsWith('.html')) {
                    currentUrl = nextHref.startsWith('http') ? nextHref : `https://m.xsw.tw${nextHref}`;
                    if (chapters.length > 5000) break;
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    currentUrl = '';
                }
            } catch (error: any) {
                console.error(`[XswAdapter] Sequential fallback error: ${error.message}`);
                break;
            }
        }

        return chapters;
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        // Some sites check Referer to prevent direct hotlinking of content
        const { data } = await withAntiBotRetries(
            () => client.get<string>(chapterUrl, {
                headers: {
                    'Referer': chapterUrl.split('/').slice(0, -1).join('/') + '/'
                }
            }),
            'xsw chapter content'
        );
        assertNoAntiBotText(data, 'xsw chapter content');
        const $ = cheerio.load(data);

        // Try multiple selectors and pick the one with the longest text
        // Specificity matters here to avoid picking up UI containers
        const selectors = ['#nr1', 'div.content.mm-content', '.content', '#content', '.nr_content', 'article'];
        let bestContent = '';

        for (const selector of selectors) {
            $(selector).each((i, el) => {
                // Focus on elements that don't have too many siblings/structure (likely the story div)
                const text = $(el).text().trim();
                if (text.length > bestContent.length) {
                    bestContent = text;
                }
            });
        }

        let content = bestContent;

        // Last resort: if all selectors are short, the content might be directly in body or a different div
        if (!content || content.length < 200) {
            const body = $('body').clone();
            // Aggressively remove UI and scripts
            body.find('script, style, header, footer, .footer, .nav, .foot-nav, #pb_next, #pb_prev, .nr_title, .nr_page, .nr_set, .nr_foot').remove();
            content = body.text().trim();
        }

        // --- Aggressive Noise Filtering ---
        // 1. Remove "Report Error" and common UI links
        content = content.replace(/>>章節報錯<</g, '');
        content = content.replace(/章節報錯/g, '');
        content = content.replace(/上一章|下一章|目錄|回首頁|書架/g, '');

        // 2. Remove Specific AdSense/JS snippets
        content = content.replace(/\(adsbygoogle = window\.adsbygoogle \|\| \[\]\)\.push\(\{\}\);/g, '');
        content = content.replace(/window\.mg_asy_a = .*?\}\)\(\);/gs, '');
        content = content.replace(/googletag\.cmd\.push\(function\(\)\{.*?\}\);/gs, '');

        // 3. Remove mobile reader UI text
        content = content.replace(/關燈|護眼|字體：|大|中|小/g, '');
        content = content.replace(/1x2x3x4x5x/g, '');
        content = content.replace(/男聲女生逍遙丫丫/g, '');
        content = content.replace(/\(本章完\)/g, '');

        // 4. Cleanup excessive whitespace and special characters
        content = content.replace(/\u00A0/g, ' ');
        content = content.replace(/\s+/g, ' '); // Collapse spaces but keep one
        content = content.trim();

        if (!content || content.length < 150) {
            console.warn(`[XswAdapter] Content too short or only UI junk caught for ${chapterUrl}. Length: ${content.length}`);
            return '';
        }

        return ContentCleaner.clean('xsw', content);
    }
}
