import type { NovelSiteAdapter } from '../adapters/NovelSiteAdapter';
import type { Chapter } from '../core/types';

export interface ProfileResult {
    adapter: string;
    sourceUrl: string;
    sampledChapters: number;
    metadataMs: number;
    chapterListMs: number;
    totalMs: number;
    chapterSamples: Array<{
        index: number;
        title: string;
        elapsedMs: number;
        contentLength: number;
    }>;
}

function nowMs(): number {
    return performance.now();
}

export function selectChapterSamples(chapters: Chapter[], sampleCount: number): Chapter[] {
    if (sampleCount <= 0 || chapters.length === 0) {
        return [];
    }

    if (sampleCount >= chapters.length) {
        return [...chapters];
    }

    const selected: Chapter[] = [];
    const seen = new Set<number>();

    for (let i = 0; i < sampleCount; i++) {
        const position = Math.floor((i * (chapters.length - 1)) / Math.max(1, sampleCount - 1));
        if (seen.has(position)) {
            continue;
        }
        seen.add(position);
        const chapter = chapters[position];
        if (chapter) {
            selected.push(chapter);
        }
    }

    return selected;
}

export async function profileAdapter(
    adapter: NovelSiteAdapter,
    sourceUrl: string,
    sampleCount: number
): Promise<ProfileResult> {
    const runStartedAt = nowMs();

    const metadataStartedAt = nowMs();
    await adapter.getBookMetadata(sourceUrl);
    const metadataMs = nowMs() - metadataStartedAt;

    const chapterListStartedAt = nowMs();
    const chapters = await adapter.getChapterList(sourceUrl);
    const chapterListMs = nowMs() - chapterListStartedAt;

    const sampledChapters = selectChapterSamples(chapters, sampleCount);
    const chapterSamples: ProfileResult['chapterSamples'] = [];

    for (const chapter of sampledChapters) {
        const chapterStartedAt = nowMs();
        const content = await adapter.getChapterContent(chapter.sourceUrl);
        chapterSamples.push({
            index: chapter.index,
            title: chapter.title,
            elapsedMs: nowMs() - chapterStartedAt,
            contentLength: content.length
        });
    }

    return {
        adapter: adapter.siteName,
        sourceUrl,
        sampledChapters: sampledChapters.length,
        metadataMs,
        chapterListMs,
        totalMs: nowMs() - runStartedAt,
        chapterSamples
    };
}
