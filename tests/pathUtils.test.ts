import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveExistingPathWithOutputFallback } from '../src/workflows/pathUtils';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

describe('resolveExistingPathWithOutputFallback', () => {
    test('resolves direct existing path', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kineti-path-'));
        tempDirs.push(root);
        const directDir = path.join(root, 'direct');
        await fsp.mkdir(directDir);

        const resolved = resolveExistingPathWithOutputFallback('direct', root);
        expect(resolved).toBe(directDir);
    });

    test('resolves output fallback path', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kineti-path-'));
        tempDirs.push(root);
        const fallbackDir = path.join(root, 'output', 'bookA');
        await fsp.mkdir(fallbackDir, { recursive: true });

        const resolved = resolveExistingPathWithOutputFallback('bookA', root);
        expect(resolved).toBe(fallbackDir);
    });

    test('throws when path does not exist', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kineti-path-'));
        tempDirs.push(root);

        expect(() => resolveExistingPathWithOutputFallback('missing', root)).toThrow();
        expect(fs.existsSync(path.join(root, 'missing'))).toBe(false);
    });
});

