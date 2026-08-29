import type { Book, Chapter } from '../core/types';

export interface AdapterResourceProfile {
    maxConcurrency?: number;
    requestIntervalMs?: number;
    postSuccessDelayMs?: number;
    runFullIntegrityCheck?: boolean;
}

export interface NovelSiteAdapter {
    siteName: string;
    resourceProfile?: AdapterResourceProfile;

    /**
     * 此適配器執行所需的本機能力 id（例如 'browser'）。
     *
     * 只有當網址解析到這個適配器時，這些前置條件才成為爬取設定檔的檢查項——
     * 爬純 HTTP 站點的使用者不該因為缺少瀏覽器而被阻斷。
     */
    requiredCapabilities?: readonly string[];

    // Check if this adapter can handle the given URL
    matchUrl(url: string): boolean;

    // Fetch metadata of the book
    getBookMetadata(url: string): Promise<Omit<Book, 'chapters'>>;

    // Fetch the list of chapters
    getChapterList(url: string): Promise<Chapter[]>;

    // Fetch the text content of a single chapter
    getChapterContent(chapterUrl: string): Promise<string>;

    // Optional method to clean up resources (e.g. headless browser)
    close?(): Promise<void>;
}
