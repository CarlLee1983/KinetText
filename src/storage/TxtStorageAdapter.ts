import * as path from 'path'
import type { StorageAdapter } from './StorageAdapter'
import type { Book, Chapter } from '../core/types'

export class TxtStorageAdapter implements StorageAdapter {
    private baseDir: string

    constructor(baseDir: string = './output') {
        this.baseDir = baseDir
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
        const bookDir = path.join(this.baseDir, this.sanitizeFilename(book.title))
        await this.ensureDir(bookDir)

        const metaContent = `
Title: ${book.title}
Author: ${book.author}
Source: ${book.siteId}
Description:
${book.description}
    `.trim()

        await Bun.write(path.join(bookDir, 'metadata.txt'), metaContent)
    }

    async saveChapter(bookTitle: string, chapter: Chapter): Promise<void> {
        const bookDir = path.join(this.baseDir, this.sanitizeFilename(bookTitle))
        const txtDir = path.join(bookDir, 'txt')
        await this.ensureDir(txtDir)

        const chapterFileName = this.getChapterFilename(chapter)
        const chapterPath = path.join(txtDir, chapterFileName)

        const content = `
${chapter.title}
--------------------------------------------------
${chapter.content || ''}
    `.trim()

        await Bun.write(chapterPath, content)
    }

    async chapterExists(bookTitle: string, chapter: Chapter): Promise<boolean> {
        const bookDir = path.join(this.baseDir, this.sanitizeFilename(bookTitle))
        const txtDir = path.join(bookDir, 'txt')
        const chapterFileName = this.getChapterFilename(chapter)
        const chapterPath = path.join(txtDir, chapterFileName)

        return await Bun.file(chapterPath).exists()
    }

    private getChapterFilename(chapter: Chapter): string {
        return `${String(chapter.index).padStart(4, '0')} - ${this.sanitizeFilename(chapter.title)}.txt`
    }

    private sanitizeFilename(name: string): string {
        return name.replace(/[<>:"/\\|?*]+/g, '_').trim()
    }
}
