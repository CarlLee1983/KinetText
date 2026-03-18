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
