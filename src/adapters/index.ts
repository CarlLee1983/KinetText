import type { NovelSiteAdapter } from './NovelSiteAdapter';
import { EightNovelAdapter } from './EightNovelAdapter';
import { WfxsAdapter } from './WfxsAdapter';
import { SampleAdapter } from './SampleAdapter';
import { XswAdapter } from './XswAdapter';

const adapters: NovelSiteAdapter[] = [
    new EightNovelAdapter(),
    new WfxsAdapter(),
    new SampleAdapter(),
    new XswAdapter()
];

export function getAdapterForUrl(url: string): NovelSiteAdapter | undefined {
    return adapters.find(adapter => adapter.matchUrl(url));
}
