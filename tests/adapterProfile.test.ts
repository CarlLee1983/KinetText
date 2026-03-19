import { describe, expect, test } from 'bun:test';
import { selectChapterSamples } from '../src/profiling/adapterProfile';

describe('selectChapterSamples', () => {
    const chapters = Array.from({ length: 10 }, (_, i) => ({
        index: i + 1,
        title: `Chapter ${i + 1}`,
        sourceUrl: `https://example.com/${i + 1}`
    }));

    test('returns evenly distributed samples', () => {
        const samples = selectChapterSamples(chapters, 3);
        expect(samples.map((chapter) => chapter.index)).toEqual([1, 5, 10]);
    });

    test('returns all chapters when sample count exceeds chapter count', () => {
        const samples = selectChapterSamples(chapters, 20);
        expect(samples).toHaveLength(10);
    });

    test('returns empty array for zero samples', () => {
        expect(selectChapterSamples(chapters, 0)).toEqual([]);
    });
});
