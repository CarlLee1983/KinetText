import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listChapterTxtFiles, resolveBookDirectories } from '../src/workflows/chapterFiles';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('chapterFiles workflow helpers', () => {
    test('resolveBookDirectories prefers txt subfolder when present', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kineti-chapters-'));
        tempDirs.push(root);

        const bookDir = path.join(root, 'MyBook');
        const txtDir = path.join(bookDir, 'txt');
        await fs.mkdir(txtDir, { recursive: true });

        const dirs = await resolveBookDirectories(root, 'MyBook');
        expect(dirs.bookDir).toBe(bookDir);
        expect(dirs.txtSourceDir).toBe(txtDir);
        expect(dirs.audioDir).toBe(path.join(bookDir, 'audio'));
    });

    test('listChapterTxtFiles excludes metadata and sorts numerically', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kineti-chapters-'));
        tempDirs.push(root);

        await fs.writeFile(path.join(root, '0010 - c10.txt'), 'x');
        await fs.writeFile(path.join(root, '0002 - c2.txt'), 'x');
        await fs.writeFile(path.join(root, 'metadata.txt'), 'meta');
        await fs.writeFile(path.join(root, 'note.md'), 'ignore');

        const files = await listChapterTxtFiles(root);
        expect(files).toEqual(['0002 - c2.txt', '0010 - c10.txt']);
    });
});

