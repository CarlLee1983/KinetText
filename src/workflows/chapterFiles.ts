import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface BookDirectories {
    bookDir: string;
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

export async function listChapterTxtFiles(txtSourceDir: string): Promise<string[]> {
    const entries = await fs.readdir(txtSourceDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.txt') && entry.name !== 'metadata.txt')
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

