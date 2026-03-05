import * as path from 'path'
import type { StorageAdapter } from './StorageAdapter'
import type { Book, Chapter } from '../core/types'

export class TxtStorageAdapter implements StorageAdapter {
    private baseDir: string
    private minContentLength: number

    constructor(baseDir: string = './output', minContentLength: number = 50) {
        this.baseDir = baseDir
        this.minContentLength = minContentLength
    }

    private async ensureDir(dirPath: string) {
        try {
            const stat = await Bun.file(dirPath).stat()
            if (!stat?.isDirectory()) {
                throw new Error(`Path exists but is not a directory: ${dirPath}`)
            }
        } catch {
            // Directory doesn't exist, create it
            await Bun.$`mkdir -p ${dirPath}`
        }
    }

    async saveBookMetadata(book: Omit<Book, 'chapters'>): Promise<void> {
        const bookDir = this.getBookDir(book.title)
        await this.ensureDir(bookDir)

        const metaContent = `
Title: ${book.title}
Author: ${book.author}
Source: ${book.siteId}
URL: ${book.sourceUrl || ''}
Description:
${book.description}
    `.trim()

        await Bun.write(path.join(bookDir, 'metadata.txt'), metaContent)
    }

    async saveChapter(bookTitle: string, chapter: Chapter): Promise<void> {
        const bookDir = this.getBookDir(bookTitle)
        const txtDir = path.join(bookDir, 'txt')
        await this.ensureDir(txtDir)

        const chapterFileName = this.getChapterFilename(chapter)
        const chapterPath = path.join(txtDir, chapterFileName)

        const content = `
${chapter.title}
Source: ${chapter.sourceUrl}
--------------------------------------------------
${chapter.content || ''}
    `.trim()

        await Bun.write(chapterPath, content)
    }

    async chapterExists(bookTitle: string, chapter: Chapter): Promise<boolean> {
        const bookDir = this.getBookDir(bookTitle)
        const txtDir = path.join(bookDir, 'txt')
        const chapterFileName = this.getChapterFilename(chapter)
        const chapterPath = path.join(txtDir, chapterFileName)

        return await Bun.file(chapterPath).exists()
    }

    async isValidChapter(bookTitle: string, chapter: Chapter): Promise<boolean> {
        const bookDir = this.getBookDir(bookTitle)
        const txtDir = path.join(bookDir, 'txt')
        const chapterFileName = this.getChapterFilename(chapter)
        const chapterPath = path.join(txtDir, chapterFileName)

        const file = Bun.file(chapterPath)
        if (!(await file.exists())) return false

        const text = await file.text()
        const parts = text.split('--------------------------------------------------')
        if (parts.length < 2) return false

        let content = parts.slice(1).join('--------------------------------------------------').trim()

        // Stricter check: remove noise that might artificially inflate length
        content = content.replace(/>>章節報錯<</g, '');
        content = content.replace(/上一章|下一章|目錄|回首頁|書架/g, '');
        content = content.replace(/關燈|護眼|字體：|大|中|小/g, '');
        content = content.replace(/\(adsbygoogle.*?;/g, '');
        content = content.replace(/window\.mg_asy_a = .*?\}\)\(\);/gs, '');

        const cleanLength = content.trim().length;
        // Most real chapters are 1000+ chars. 300 is a safe threshold to filter out ad-only junk.
        return cleanLength >= 300;
    }

    async saveRunArtifact(bookTitle: string, filename: string, data: unknown): Promise<void> {
        const bookDir = this.getBookDir(bookTitle);
        await this.ensureDir(bookDir);
        const artifactPath = path.join(bookDir, filename);
        await Bun.write(artifactPath, JSON.stringify(data, null, 2));
    }

    private getChapterFilename(chapter: Chapter): string {
        return `${String(chapter.index).padStart(4, '0')} - ${this.sanitizeFilename(chapter.title)}.txt`
    }

    private getBookDir(bookTitle: string): string {
        return path.join(this.baseDir, this.sanitizeFilename(bookTitle))
    }

    private sanitizeFilename(name: string): string {
        return name.replace(/[<>:"/\\|?*]+/g, '_').trim()
    }
}
