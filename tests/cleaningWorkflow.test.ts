import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSiteIdFromMetadata, splitKinetiTextDocument } from '../src/workflows/cleaning';

describe('cleaning workflow helpers', () => {
    test('getSiteIdFromMetadata returns Source value', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kineti-cleaning-'));
        const bookDir = path.join(root, 'book');
        await fs.mkdir(bookDir, { recursive: true });
        await fs.writeFile(
            path.join(bookDir, 'metadata.txt'),
            'Title: T\nAuthor: A\nSource: wfxs\nURL: x\nDescription:\n...',
            'utf-8'
        );

        const siteId = await getSiteIdFromMetadata(bookDir);
        expect(siteId).toBe('wfxs');

        await fs.rm(root, { recursive: true, force: true });
    });

    test('splitKinetiTextDocument splits standard header and body', () => {
        const input = 'Title line\nSource: x\n--------------------------------------------------\n正文內容';
        const parts = splitKinetiTextDocument(input);

        expect(parts.header).toBe('Title line\nSource: x\n--------------------------------------------------\n');
        expect(parts.body).toBe('正文內容');
    });
});

