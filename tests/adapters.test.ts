import { describe, expect, test } from 'bun:test';
import { XswAdapter } from '../src/adapters/XswAdapter';
import { WfxsAdapter } from '../src/adapters/WfxsAdapter';
import { TwkanAdapter } from '../src/adapters/TwkanAdapter';
import { CzbooksAdapter } from '../src/adapters/CzbooksAdapter';
import { UukanshuAdapter } from '../src/adapters/UukanshuAdapter';
import { ZhysAdapter } from '../src/adapters/ZhysAdapter';
import { Novel543Adapter } from '../src/adapters/Novel543Adapter';

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

    test('zhys matches zhys.tw subdomains and normalizes book URLs', () => {
        const adapter = new ZhysAdapter() as any;

        expect(new ZhysAdapter().matchUrl('https://twp.zhys.tw/book/777167.html')).toBe(true);
        expect(new ZhysAdapter().matchUrl('https://cn.zhys.tw/read/777167/76825511.html')).toBe(true);
        expect(new ZhysAdapter().matchUrl('https://example.com/?host=zhys.tw/book/1')).toBe(false);

        expect(adapter.extractBookId('https://twp.zhys.tw/book/777167.html')).toBe('777167');
        expect(adapter.toBookUrl('https://twp.zhys.tw/read/777167/76825511.html'))
            .toBe('https://twp.zhys.tw/book/777167.html');
    });

    test('novel543 matches mirror hosts and normalizes chapter URLs', () => {
        const adapter = new Novel543Adapter() as any;

        expect(new Novel543Adapter().matchUrl('https://look.thisiscm.com/0805675463/8096_1.html')).toBe(true);
        expect(new Novel543Adapter().matchUrl('https://www.novel543.com/0805675463/')).toBe(true);
        expect(new Novel543Adapter().matchUrl('https://example.com/?host=novel543.com/book/1')).toBe(false);

        expect(adapter.extractBookId('https://look.thisiscm.com/0805675463/8096_1.html')).toBe('0805675463');
        expect(adapter.toCanonicalUrl('https://look.thisiscm.com/0805675463/8096_1.html'))
            .toBe('https://www.novel543.com/0805675463/8096_1.html');
        expect(adapter.toBookUrl('https://look.thisiscm.com/0805675463/8096_1.html'))
            .toBe('https://www.novel543.com/0805675463/');
    });

    test('novel543 distinguishes chapter entries from sub-pages', () => {
        const adapter = new Novel543Adapter() as any;

        expect(adapter.isChapterListEntry('/0805675463/8096_1.html')).toBe(true);
        expect(adapter.isChapterListEntry('/0805675463/8096_1_2.html')).toBe(false);
        expect(adapter.isContinuationUrl(
            'https://www.novel543.com/0805675463/8096_1.html',
            'https://www.novel543.com/0805675463/8096_1_2.html',
        )).toBe(true);
        expect(adapter.isContinuationUrl(
            'https://www.novel543.com/0805675463/8096_1_2.html',
            'https://www.novel543.com/0805675463/8096_2.html',
        )).toBe(false);
    });

    test('zhys deduplicates repeated chapter paragraphs', () => {
        const adapter = new ZhysAdapter() as any;
        const paragraphs = ['a', 'b', 'c', 'a', 'b', 'c'];

        expect(adapter.dedupeParagraphs(paragraphs)).toEqual(['a', 'b', 'c']);
        expect(adapter.dedupeParagraphs(['only one'])).toEqual(['only one']);
    });
});
