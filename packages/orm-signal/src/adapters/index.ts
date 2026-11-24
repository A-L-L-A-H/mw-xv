import { CoinGeckoAdapter } from './coingecko.js';
import { CustomAdapter } from './custom.js';
import { GithubTrendingAdapter } from './github-trending.js';
import { GoogleTrendsAdapter } from './google-trends.js';
import { HackerNewsAdapter } from './hackernews.js';
import { RedditAdapter } from './reddit.js';
import { RssAdapter } from './rss.js';
import { WebDiffAdapter } from './web-diff.js';
import { YoutubeTrendingAdapter } from './youtube-trending.js';
import type { SignalAdapter } from './types.js';
import { SIGNAL_SOURCE_KINDS, type SignalSourceKind } from '../models.js';

export { hashObservationContent, toRawJson } from './types.js';
export type { SignalAdapter, SignalAdapterContext, SignalObservationDraft } from './types.js';
export { XMLParser } from './xml-parser.js';
export { RssAdapter } from './rss.js';
export { GoogleTrendsAdapter } from './google-trends.js';
export { GithubTrendingAdapter, parseTrendingHtml } from './github-trending.js';
export { HackerNewsAdapter } from './hackernews.js';
export { RedditAdapter } from './reddit.js';
export { YoutubeTrendingAdapter } from './youtube-trending.js';
export { CoinGeckoAdapter } from './coingecko.js';
export { WebDiffAdapter } from './web-diff.js';
export { CustomAdapter } from './custom.js';

export const signalAdapters: Readonly<Record<SignalSourceKind, SignalAdapter>> = {
  rss: new RssAdapter(),
  google_trends: new GoogleTrendsAdapter(),
  github_trending: new GithubTrendingAdapter(),
  hackernews: new HackerNewsAdapter(),
  reddit: new RedditAdapter(),
  youtube_trending: new YoutubeTrendingAdapter(),
  coingecko: new CoinGeckoAdapter(),
  web_diff: new WebDiffAdapter(),
  custom: new CustomAdapter(),
};

export function adapterForKind(kind: SignalSourceKind): SignalAdapter {
  const adapter = signalAdapters[kind];
  if (!adapter) {
    throw new Error(
      `No signal adapter registered for kind ${kind}; known kinds: ${SIGNAL_SOURCE_KINDS.join(', ')}`
    );
  }
  return adapter;
}
