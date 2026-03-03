import { NovelSiteAdapter } from './NovelSiteAdapter';
import { EightNovelAdapter } from './EightNovelAdapter';
import { SampleAdapter } from './SampleAdapter';

const adapters: NovelSiteAdapter[] = [
    new EightNovelAdapter(),
    new SampleAdapter()
];

export function getAdapterForUrl(url: string): NovelSiteAdapter | undefined {
    return adapters.find(adapter => adapter.matchUrl(url));
}
