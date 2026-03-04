import type { NovelSiteAdapter } from './NovelSiteAdapter';
import { EightNovelAdapter } from './EightNovelAdapter';
import { WfxsAdapter } from './WfxsAdapter';
import { SampleAdapter } from './SampleAdapter';

const adapters: NovelSiteAdapter[] = [
    new EightNovelAdapter(),
    new WfxsAdapter(),
    new SampleAdapter()
];

export function getAdapterForUrl(url: string): NovelSiteAdapter | undefined {
    return adapters.find(adapter => adapter.matchUrl(url));
}
