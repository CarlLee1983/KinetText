import { describe, expect, test } from 'bun:test';
import { ContentCleaner } from '../src/utils/ContentCleaner';

describe('ContentCleaner', () => {
    test('removes exact watermarks for wfxs', () => {
        const input = '第一段內容 網腐小說 第二段內容';
        const output = ContentCleaner.clean('wfxs', input);
        expect(output).toBe('第一段內容  第二段內容');
    });

    test('removes regex noise for czbooks', () => {
        const input = '正文A 『PS:測試內容』 正文B';
        const output = ContentCleaner.clean('czbooks', input);
        expect(output).toBe('正文A  正文B');
    });
});

