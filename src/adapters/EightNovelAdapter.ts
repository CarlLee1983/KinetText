import axios from 'axios';
import * as cheerio from 'cheerio';
import type { NovelSiteAdapter } from './NovelSiteAdapter';
import type { Book, Chapter } from '../core/types';

export class EightNovelAdapter implements NovelSiteAdapter {
    siteName = '8novel';

    matchUrl(url: string): boolean {
        return url.includes('8novel.com');
    }

    async getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>> {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        const title = $('meta[property="og:title"]').attr('content') || $('h1').text().trim();
        const author = $('meta[property="og:novel:author"]').attr('content') || '';
        const description = $('meta[property="og:description"]').attr('content') || '';
        const coverUrl = $('meta[property="og:image"]').attr('content');

        return {
            title,
            author,
            description,
            coverUrl: coverUrl ? (coverUrl.startsWith('http') ? coverUrl : `https://www.8novel.com${coverUrl}`) : undefined
        };
    }

    async getChapterList(url: string): Promise<Chapter[]> {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const chapters: Chapter[] = [];

        $('.episode_li').each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).text().trim();
            if (href) {
                chapters.push({
                    index: i + 1,
                    title,
                    sourceUrl: href.startsWith('http') ? href : `https://www.8novel.com${href}`
                });
            }
        });

        return chapters;
    }

    async getChapterContent(chapterUrl: string): Promise<string> {
        const { data } = await axios.get(chapterUrl);
        
        // Extract the magic string and IDs from the scripts
        // Example: var b9_1m_3="ID1,ID2,...,MAGIC_STRING".split(',');
        const arrayMatch = data.match(/var b9_1m_3\s*=\s*"([^"]+)"\.split\(','\);/);
        if (!arrayMatch) {
            throw new Error('Could not find b9_1m_3 array in chapter page');
        }
        const elements = arrayMatch[1].split(',');
        const magicString = elements[elements.length - 1];

        // Extract chapter ID from URL
        const chapterIdMatch = chapterUrl.match(/\?([0-9]+)/);
        if (!chapterIdMatch || !chapterIdMatch[1]) {
            throw new Error('Could not find chapter ID in URL');
        }
        const chapterId = parseInt(chapterIdMatch[1], 10);

        // Suffix logic: b9_1m_3[0].substr(chapterId * 3 % 100, 5)
        // Note: hh5_l_4_2 = 3, u47ho9em_ = 100, q78sw24 = 5
        const startIndex = (chapterId * 3) % 100;
        const suffix = magicString.substring(startIndex, startIndex + 5);

        // Construct AJAX URL
        // Pattern: /txt/3/{book_id}/{chapter_id}{suffix}.html
        const bookIdMatch = chapterUrl.match(/novelbooks\/([0-9]+)/) || chapterUrl.match(/read\/([0-9]+)/);
        if (!bookIdMatch) {
            throw new Error('Could not find book ID in URL');
        }
        const bookId = bookIdMatch[1];
        
        const ajaxUrl = `https://www.8novel.com/txt/3/${bookId}/${chapterId}${suffix}.html`;
        
        const { data: contentHtml } = await axios.get(ajaxUrl);
        
        // Clean the content
        // The content is usually wrapped in <br> tags
        const $ = cheerio.load(contentHtml);
        let text = $.root().text();
        
        // Remove common watermarks if any (handles various Unicode full-width/half-width characters)
        const noiseRegex = /[8８⒏⑻⑧][\s]*[nｎＮ][\s]*[oｏＯσο][\s]*[vｖＶ][\s]*[eｅＥЁ][\s]*[lｌＬ┗└][\s]*[.．·。][\s]*[cｃＣС][\s]*[oｏＯοо][\s]*[mｍＭｍ]/ig;
        text = text.replace(noiseRegex, '');
        
        return text.trim();
    }
}
