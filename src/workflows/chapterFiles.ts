import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const CHAPTER_TEXT_EXTENSIONS = ['.txt', '.md'] as const;

export interface BookDirectories {
    bookDir: string;
    txtSourceDir: string;
    audioDir: string;
}

export interface LocalAudiobookPaths {
    txtSourceDir: string;
    audioDir: string;
}

export async function resolveBookDirectories(outputRoot: string, bookTitle: string): Promise<BookDirectories> {
    const bookDir = path.join(outputRoot, bookTitle);
    await fs.access(bookDir);

    const txtDir = path.join(bookDir, 'txt');
    const audioDir = path.join(bookDir, 'audio');

    let txtSourceDir = txtDir;
    try {
        await fs.access(txtDir);
    } catch {
        txtSourceDir = bookDir;
    }

    return { bookDir, txtSourceDir, audioDir };
}

export async function listChapterTextFiles(
    txtSourceDir: string,
    extensions: readonly string[] = CHAPTER_TEXT_EXTENSIONS,
): Promise<string[]> {
    const normalized = extensions.map((ext) => ext.toLowerCase());
    const entries = await fs.readdir(txtSourceDir, { withFileTypes: true });
    return entries
        .filter((entry) => {
            if (!entry.isFile()) return false;
            const lower = entry.name.toLowerCase();
            if (lower === 'metadata.txt' || lower === 'readme.md') return false;
            return normalized.some((ext) => lower.endsWith(ext));
        })
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** @deprecated Use listChapterTextFiles */
export async function listChapterTxtFiles(txtSourceDir: string): Promise<string[]> {
    return listChapterTextFiles(txtSourceDir, ['.txt']);
}

export async function resolveLocalAudiobookPaths(
    inputDir: string,
    outputDir?: string,
): Promise<LocalAudiobookPaths> {
    await fs.access(inputDir);
    const audioDir = outputDir ?? path.join(path.dirname(inputDir), 'audio');
    return { txtSourceDir: inputDir, audioDir };
}

export function chapterFileToMp3(filename: string): string {
    return filename.replace(/\.(txt|md)$/i, '.mp3');
}

