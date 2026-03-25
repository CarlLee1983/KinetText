import { describe, expect, test } from 'bun:test';
import { ContentCleaner } from '../src/utils/ContentCleaner';

describe('ContentCleaner', () => {
    test('removes global watermarks', () => {
        const input = '第一段內容 上一章 第二段內容';
        const output = ContentCleaner.clean('sample', input);
        expect(output).not.toContain('上一章');
    });

    test('removes exact watermarks for wfxs', () => {
        const input = '第一段內容 網腐小說 第二段內容';
        const output = ContentCleaner.clean('wfxs', input);
        expect(output).not.toContain('網腐小說');
    });

    test('removes regex noise for czbooks', () => {
        const input = '正文A 『PS:測試內容』 正文B';
        const output = ContentCleaner.clean('czbooks', input);
        expect(output).not.toContain('『PS:');
    });

    test('removes global regex noise patterns', () => {
        const input = '正文內容 >>章節報錯<< 繼續文本';
        const output = ContentCleaner.clean('any-site', input);
        expect(output).not.toContain('>>章節報錯<<');
        expect(output).toContain('正文內容');
        expect(output).toContain('繼續文本');
    });

    test('cleans excessive whitespace', () => {
        const input = '第一段\n\n\n\n第二段  \n第三段';
        const output = ContentCleaner.clean('sample', input);
        // Should have max 2 newlines between paragraphs
        expect(output.includes('\n\n\n')).toBe(false);
    });

    test('removes multiple watermarks from same content', () => {
        const input = '正文開始 上一章 中間 下一章 結尾';
        const output = ContentCleaner.clean('sample', input);
        expect(output).not.toContain('上一章');
        expect(output).not.toContain('下一章');
        expect(output).toContain('正文開始');
        expect(output).toContain('結尾');
    });

    test('handles empty content', () => {
        const input = '';
        const output = ContentCleaner.clean('sample', input);
        expect(output).toBe('');
    });

    test('handles content with only watermarks', () => {
        const input = '上一章 下一章 目錄';
        const output = ContentCleaner.clean('sample', input);
        expect(output.trim()).toBe('');
    });
});

