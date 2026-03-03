import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageAdapter } from './StorageAdapter';
import { Book, Chapter } from '../core/types';

export class TxtStorageAdapter implements StorageAdapter {
    private baseDir: string;

    constructor(baseDir: string = './output') {
        this.baseDir = baseDir;
    }

    private async ensureDir(dirPath: string) {
        await fs.mkdir(dirPath, { recursive: true });
    }

    async saveBookMetadata(book: Omit<Book, 'chapters'>): Promise<void> {
        const bookDir = path.join(this.baseDir, this.sanitizeFilename(book.title));
        await this.ensureDir(bookDir);

        const metaContent = `
Title: ${book.title}
Author: ${book.author}
Description:
${book.description}
    `.trim();

        await fs.writeFile(path.join(bookDir, 'metadata.txt'), metaContent, 'utf-8');
    }

    async saveChapter(bookTitle: string, chapter: Chapter): Promise<void> {
        const bookDir = path.join(this.baseDir, this.sanitizeFilename(bookTitle));
        await this.ensureDir(bookDir);

        const chapterFileName = this.getChapterFilename(chapter);
        const chapterPath = path.join(bookDir, chapterFileName);

        const content = `
${chapter.title}
--------------------------------------------------
${chapter.content || ''}
    `.trim();

        await fs.writeFile(chapterPath, content, 'utf-8');
    }

    async chapterExists(bookTitle: string, chapter: Chapter): Promise<boolean> {
        const bookDir = path.join(this.baseDir, this.sanitizeFilename(bookTitle));
        const chapterFileName = this.getChapterFilename(chapter);
        const chapterPath = path.join(bookDir, chapterFileName);
        
        try {
            await fs.access(chapterPath);
            return true;
        } catch {
            return false;
        }
    }

    private getChapterFilename(chapter: Chapter): string {
        return `${String(chapter.index).padStart(4, '0')} - ${this.sanitizeFilename(chapter.title)}.txt`;
    }

    private sanitizeFilename(name: string): string {
        return name.replace(/[<>:"/\\|?*]+/g, '_').trim();
    }
}
