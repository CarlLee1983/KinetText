import type { NovelSiteAdapter } from './NovelSiteAdapter';
import { EightNovelAdapter } from './EightNovelAdapter';
import { WfxsAdapter } from './WfxsAdapter';
import { SampleAdapter } from './SampleAdapter';
import { XswAdapter } from './XswAdapter';
import { CzbooksAdapter } from './CzbooksAdapter';

const adapters: NovelSiteAdapter[] = [
    new EightNovelAdapter(),
    new WfxsAdapter(),
    new SampleAdapter(),
    new XswAdapter(),
    new CzbooksAdapter()
];

export function getAdapterForUrl(url: string): NovelSiteAdapter | undefined {
    return adapters.find(adapter => adapter.matchUrl(url));
}
