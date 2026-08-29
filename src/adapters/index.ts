import type { NovelSiteAdapter } from './NovelSiteAdapter';
import { EightNovelAdapter } from './EightNovelAdapter';
import { WfxsAdapter } from './WfxsAdapter';
import { SampleAdapter } from './SampleAdapter';
import { XswAdapter } from './XswAdapter';
import { CzbooksAdapter } from './CzbooksAdapter';
import { HjwzwAdapter } from './HjwzwAdapter';
import { TwkanAdapter } from './TwkanAdapter';
import { UukanshuAdapter } from './UukanshuAdapter';
import { ZhysAdapter } from './ZhysAdapter';
import { Novel543Adapter } from './Novel543Adapter';

const adapters: NovelSiteAdapter[] = [
    new EightNovelAdapter(),
    new WfxsAdapter(),
    new SampleAdapter(),
    new XswAdapter(),
    new CzbooksAdapter(),
    new HjwzwAdapter(),
    new TwkanAdapter(),
    new UukanshuAdapter(),
    new ZhysAdapter(),
    new Novel543Adapter(),
];

/** 全部已註冊的適配器。供測試做註冊表級不變量斷言（例如誰宣告了哪些能力）。 */
export function allAdapters(): readonly NovelSiteAdapter[] {
    return adapters;
}

export function getAdapterForUrl(url: string): NovelSiteAdapter | undefined {
    return adapters.find(adapter => adapter.matchUrl(url));
}
