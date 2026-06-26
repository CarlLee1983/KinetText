import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    chapterFileToMp3,
    listChapterTextFiles,
    resolveLocalAudiobookPaths,
} from '../src/workflows/chapterFiles';
import { prepareChapterTextForTts } from '../src/workflows/chapterText';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('prepareChapterTextForTts', () => {
    test('extracts markdown body after ## 正文', () => {
        const source = `# 第 1 章

## 標題

- outline item

## 正文

雨是後半晌起的。
---
他推開門。`;

        expect(prepareChapterTextForTts(source)).toBe('雨是後半晌起的。\n\n他推開門。');
    });

    test('strips crawler header before --- in first lines', () => {
        const source = `第 1 章 標題
---
正文第一段。`;

        expect(prepareChapterTextForTts(source)).toBe('正文第一段。');
    });
});

describe('chapterFileToMp3', () => {
    test('replaces txt and md extensions', () => {
        expect(chapterFileToMp3('0001.md')).toBe('0001.mp3');
        expect(chapterFileToMp3('0010 - c10.txt')).toBe('0010 - c10.mp3');
    });
});

describe('listChapterTextFiles', () => {
    test('includes md files and excludes readme', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kineti-text-files-'));
        tempDirs.push(root);

        await fs.writeFile(path.join(root, '0001.md'), '# x');
        await fs.writeFile(path.join(root, '0002.txt'), 'x');
        await fs.writeFile(path.join(root, 'readme.md'), 'ignore');
        await fs.writeFile(path.join(root, 'metadata.txt'), 'ignore');

        const files = await listChapterTextFiles(root);
        expect(files).toEqual(['0001.md', '0002.txt']);
    });
});

describe('resolveLocalAudiobookPaths', () => {
    test('defaults audio dir to sibling of input', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kineti-local-paths-'));
        tempDirs.push(root);
        const chapters = path.join(root, 'chapters');
        await fs.mkdir(chapters);
        await fs.writeFile(path.join(chapters, '0001.md'), 'x');

        const paths = await resolveLocalAudiobookPaths(chapters);
        expect(paths.txtSourceDir).toBe(chapters);
        expect(paths.audioDir).toBe(path.join(root, 'audio'));
    });
});
