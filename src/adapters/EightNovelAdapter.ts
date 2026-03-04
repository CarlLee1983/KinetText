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

export class EightNovelAdapter implements NovelSiteAdapter {
    siteName = '8novel';

    matchUrl(url: string): boolean {
        return url.includes('8novel.com');
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        const { data } = await client.get(url);
        const $ = cheerio.load(data);

        const title = $('meta[property="og:title"]').attr('content') || $('h1').text().trim();
        const author = $('meta[property="og:novel:author"]').attr('content') || '';
        const description = $('meta[property="og:description"]').attr('content') || '';
        const coverUrl = $('meta[property="og:image"]').attr('content');

        return {
            title,
            author,
            description,
            siteId: '8novel',
            sourceUrl: url,
            coverUrl: coverUrl ? (coverUrl.startsWith('http') ? coverUrl : `https://www.8novel.com${coverUrl}`) : undefined
        };
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        const { data } = await client.get(url);
        const $ = cheerio.load(data);
        const chapters: Chapter[] = [];

        $('.episode_li').each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).text().trim();
            if (href) {
                // Use article subdomain for reading as it seems more stable
                chapters.push({
                    index: i + 1,
                    title,
                    sourceUrl: href.startsWith('http') ? href : `https://article.8novel.com${href}`
                });
            }
        });

        return chapters;
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        const { data } = await client.get(chapterUrl);

        const $ = cheerio.load(data);
        // Combine content from all inline script tags to ensure all variables 
        // (including those from separate script blocks) are available for evaluation.
        let scriptContent = '';
        $('script').each((i: number, el: any) => {
            const html = $(el).html();
            if (html && !$(el).attr('src')) {
                scriptContent += html + '\n';
            }
        });

        if (!scriptContent.includes(".split(',')")) {
            throw new Error('Could not find translation script in chapter page');
        }

        // Extract variables
        const vars: Record<string, any> = {};
        const varRegex = /var\s+(\w+)\s*=\s*([^;]+);/g;
        let m: RegExpExecArray | null;
        while ((m = varRegex.exec(scriptContent)) !== null) {
            const name = m[1];
            if (!name) continue;

            let value = m[2]?.trim() || '';
            if (value.startsWith('"') && value.endsWith('"')) {
                vars[name] = value.substring(1, value.length - 1);
            } else if (value.includes(".split(',')")) {
                const strMatch = value.match(/"([^"]*)"/);
                vars[name] = (strMatch && strMatch[1]) ? strMatch[1].split(',') : [];
            } else {
                // Try to parse as number
                const num = parseInt(value, 10);
                if (!isNaN(num)) {
                    vars[name] = num;
                } else {
                    vars[name] = value;
                }
            }
        }

        // Find the magic array (the one with many elements, usually hundreds)
        let magicArray: string[] = [];
        for (const key in vars) {
            if (Array.isArray(vars[key]) && vars[key].length > 10) {
                magicArray = vars[key];
                break;
            }
        }

        if (magicArray.length === 0) {
            throw new Error('Could not find magic array for suffix calculation');
        }

        const magicString = magicArray[magicArray.length - 1];
        if (magicString === undefined) {
            throw new Error('Magic string is undefined');
        }

        // Extract coefficients and path parts from the unescape logic
        let multiplier = 3;
        let modulus = 100;
        let suffixLen = 5;

        // Try to find them from the substr call in the script
        const substrRegex = /\.substr\([^,]+ \* (\w+) % (\w+), (\w+)\)/;
        const substrMatch = scriptContent.match(substrRegex);
        if (substrMatch) {
            const mKey = substrMatch[1];
            const modKey = substrMatch[2];
            const lenKey = substrMatch[3];

            if (mKey !== undefined && typeof vars[mKey] === 'number') multiplier = vars[mKey];
            if (modKey !== undefined && typeof vars[modKey] === 'number') modulus = vars[modKey];
            if (lenKey !== undefined && typeof vars[lenKey] === 'number') suffixLen = vars[lenKey];
        }

        // Extract basic ID info for fallback and context
        const bookIdMatch = chapterUrl.match(/novelbooks\/([0-9]+)/) || chapterUrl.match(/read\/([0-9]+)/);
        const bookId = bookIdMatch ? bookIdMatch[1] : '';
        const chapterIdMatch = chapterUrl.match(/\?([0-9]+)/);
        const chapterId = chapterIdMatch ? parseInt(chapterIdMatch[1] || '0', 10) : 0;
        const startIndex = (chapterId * multiplier) % modulus;
        const suffix = magicString.substring(startIndex, startIndex + suffixLen);

        // Transform the entire script into a function that returns the AJAX URL
        // We replace the $.get(...) call with a return of the unescaped URL
        let ajaxUrlPath = '';
        try {
            // Step 1: Find the part where $.get happens
            const getRegex = /\$.get\(unescape\((.+)\),\s*function/s;
            const getMatch = scriptContent.match(getRegex);
            if (!getMatch) throw new Error('Could not find $.get in script');

            const expression = getMatch[1];

            // Step 2: Remove the $.get call and everything after it to avoid side effects
            // and replace it with a return of the unescaped string.
            // We need to keep all variables defined before the $.get call.
            const scriptBeforeGet = scriptContent.substring(0, getMatch.index);

            // Step 3: Create a wrapper function
            // We need to mocks 'window', 'document', '$', etc. if used.
            // But usually only 'u' (chapterUrl) is used from the environment.
            const sandboxScript = `
                var u = "${chapterUrl}";
                var document = { location: { href: u } };
                var window = { location: { href: u } };
                var $ = { get: function() {} };
                ${scriptBeforeGet}
                return unescape(${expression});
            `;

            const evaluator = new Function('unescape', sandboxScript);
            ajaxUrlPath = evaluator(unescape);
        } catch (err: any) {
            console.error('[8novel] Script evaluation failed:', err.message);
            // Emergency fallback
            const fallMatch = scriptContent.match(/unescape\("([^"]+)"\)/);
            if (fallMatch && fallMatch[1]) {
                ajaxUrlPath = unescape(fallMatch[1]);
            } else {
                ajaxUrlPath = `/txt/3/${bookId}/${chapterId}${suffix}.html`;
            }
        }

        const ajaxUrl = ajaxUrlPath.startsWith('http') ? ajaxUrlPath : `https://article.8novel.com${ajaxUrlPath.startsWith('/') ? '' : '/'}${ajaxUrlPath}`;
        console.log(`[8novel] Fetching AJAX content from: ${ajaxUrl}`);

        const { data: contentHtml } = await client.get(ajaxUrl);

        // Clean the content
        const c = cheerio.load(contentHtml);
        let text = c.root().text();

        return ContentCleaner.clean('8novel', text);
    }
}
