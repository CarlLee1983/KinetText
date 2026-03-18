import { describe, expect, test } from 'bun:test';
import { XswAdapter } from '../src/adapters/XswAdapter';
import { WfxsAdapter } from '../src/adapters/WfxsAdapter';
import { TwkanAdapter } from '../src/adapters/TwkanAdapter';
import { CzbooksAdapter } from '../src/adapters/CzbooksAdapter';
import { UukanshuAdapter } from '../src/adapters/UukanshuAdapter';

describe('adapter URL handling', () => {
    test('xsw extracts book id from supported URLs', () => {
        const adapter = new XswAdapter() as any;

        expect(adapter.extractBookId('https://m.xsw.tw/1730108/251856158.html')).toBe('1730108');
        expect(adapter.extractBookId('https://www.xsw.tw/1730108/')).toBe('1730108');
        expect(adapter.extractBookId('https://example.com/1730108/251856158.html')).toBe('');
    });

    test('wfxs distinguishes book home, chapter list, and chapter page URLs', () => {
        const adapter = new WfxsAdapter() as any;

        expect(adapter.isChapterListUrl('https://www.wfxs.tw/booklist/9999.html')).toBe(true);
        expect(adapter.isChapterPageUrl('https://www.wfxs.tw/xiaoshuo/123/456/')).toBe(true);
        expect(adapter.isBookHomeUrl('https://www.wfxs.tw/xiaoshuo/123/')).toBe(true);

        expect(adapter.isChapterListUrl('https://www.wfxs.tw/xiaoshuo/123/')).toBe(false);
        expect(adapter.isChapterPageUrl('https://www.wfxs.tw/xiaoshuo/123/')).toBe(false);
    });

    test('hostname-based matchUrl avoids false positives from query strings', () => {
        const redirectUrl = 'https://example.com/?target=twkan.com/book/123.html';

        expect(new TwkanAdapter().matchUrl(redirectUrl)).toBe(false);
        expect(new CzbooksAdapter().matchUrl('https://example.com/?redirect=czbooks.net/n/abc')).toBe(false);
        expect(new UukanshuAdapter().matchUrl('https://example.com/?next=uukanshu.cc/book/123')).toBe(false);

        expect(new TwkanAdapter().matchUrl('https://twkan.com/book/123.html')).toBe(true);
        expect(new CzbooksAdapter().matchUrl('https://czbooks.net/n/abc')).toBe(true);
        expect(new UukanshuAdapter().matchUrl('https://www.uukanshu.cc/book/123')).toBe(true);
    });
});
