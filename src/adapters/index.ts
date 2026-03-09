import type { NovelSiteAdapter } from './NovelSiteAdapter';
import { EightNovelAdapter } from './EightNovelAdapter';
import { WfxsAdapter } from './WfxsAdapter';
import { SampleAdapter } from './SampleAdapter';
import { XswAdapter } from './XswAdapter';
import { CzbooksAdapter } from './CzbooksAdapter';
import { HjwzwAdapter } from './HjwzwAdapter';
import { TwkanAdapter } from './TwkanAdapter';

const adapters: NovelSiteAdapter[] = [
    new EightNovelAdapter(),
    new WfxsAdapter(),
    new SampleAdapter(),
    new XswAdapter(),
    new CzbooksAdapter(),
    new HjwzwAdapter(),
    new TwkanAdapter()
];

export function getAdapterForUrl(url: string): NovelSiteAdapter | undefined {
    return adapters.find(adapter => adapter.matchUrl(url));
}
