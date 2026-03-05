import type { Book, Chapter } from '../core/types';

export interface StorageAdapter {
    saveBookMetadata(book: Omit<Book, 'chapters'>): Promise<void>;
    saveChapter(bookTitle: string, chapter: Chapter): Promise<void>;
    chapterExists(bookTitle: string, chapter: Chapter): Promise<boolean>;
    isValidChapter(bookTitle: string, chapter: Chapter): Promise<boolean>;
    saveRunArtifact?(bookTitle: string, filename: string, data: unknown): Promise<void>;
}
