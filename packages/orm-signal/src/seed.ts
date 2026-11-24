import type { Knex } from 'knex';
import { countValue } from '@moonwitness/types';
import { SignalSource, type SignalSourceKind } from './models.js';
import {
  resolveInsertedId,
  type AddonSeedManifest,
  type SeedContext,
  type SeedResult,
} from '@moonwitness/orm-base';

export const SIGNAL_SEED_VERSION = '1.0.0';

export interface SignalSourceSeed {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: SignalSourceKind;
  readonly config: Record<string, unknown>;
}

export const SIGNAL_SOURCE_SEEDS: readonly SignalSourceSeed[] = [
  {
    id: 'signal-source-rss',
    code: 'rss_generic',
    name: 'Generic RSS/Atom Feed',
    kind: 'rss',
    config: { feeds: [], maxItemsPerFeed: 50 },
  },
  {
    id: 'signal-source-google-trends',
    code: 'google_trends_daily',
    name: 'Google Trends Daily RSS',
    kind: 'google_trends',
    config: { geo: 'US', rssUrl: 'https://trends.google.com/trending/rss?geo=US' },
  },
  {
    id: 'signal-source-github-trending',
    code: 'github_trending_daily',
    name: 'GitHub Trending Repositories',
    kind: 'github_trending',
    config: { language: 'any', since: 'daily' },
  },
  {
    id: 'signal-source-hackernews',
    code: 'hackernews_front_page',
    name: 'Hacker News Front Page',
    kind: 'hackernews',
    config: { firebaseApi: 'https://hacker-news.firebaseio.com/v0', topItems: 30 },
  },
  {
    id: 'signal-source-reddit',
    code: 'reddit_hot',
    name: 'Reddit Hot Threads',
    kind: 'reddit',
    config: { subreddits: ['technology', 'programming'], listing: 'hot', limit: 25 },
  },
  {
    id: 'signal-source-youtube-trending',
    code: 'youtube_trending',
    name: 'YouTube Trending Videos',
    kind: 'youtube_trending',
    config: { regionCode: 'US', chart: 'mostPopular', maxResults: 25 },
  },
  {
    id: 'signal-source-coingecko',
    code: 'coingecko_markets',
    name: 'CoinGecko Market Movers',
    kind: 'coingecko',
    config: { vsCurrency: 'usd', perPage: 25 },
  },
  {
    id: 'signal-source-web-diff',
    code: 'web_diff_watch',
    name: 'Watched Page Content Diff',
    kind: 'web_diff',
    config: { urls: [], hashAlgorithm: 'sha256' },
  },
  {
    id: 'signal-source-custom',
    code: 'custom_ingest',
    name: 'Custom Webhook Ingest',
    kind: 'custom',
    config: { protocol: 'webhook' },
  },
];

export const SIGNAL_SOURCE_SEED_COUNT = SIGNAL_SOURCE_SEEDS.length;

export async function seedSignalSources(
  db: Knex,
  options: { readonly companyId?: number } = {}
): Promise<{ readonly inserted: number; readonly total: number }> {
  const companyRow =
    options.companyId === undefined
      ? await db('companies').orderBy('id', 'asc').first('id')
      : await db('companies').where({ id: options.companyId }).first('id');
  if (!companyRow) {
    throw new Error('Cannot seed signal sources: no company record found');
  }
  const companyId = Number(companyRow.id);

  let inserted = 0;
  for (const sourceSeed of SIGNAL_SOURCE_SEEDS) {
    const existing = await db(SignalSource.tableName).where({ code: sourceSeed.code }).first('id');
    if (existing) continue;
    const result = (await db(SignalSource.tableName)
      .insert({
        company_id: companyId,
        code: sourceSeed.code,
        name: sourceSeed.name,
        kind: sourceSeed.kind,
        config: JSON.stringify(sourceSeed.config),
        is_active: false,
      })
      .returning('id')) as unknown[];
    resolveInsertedId(result, `signal source ${sourceSeed.code}`);
    inserted += 1;
  }

  const total = await db(SignalSource.tableName).count({ count: '*' }).first();
  return { inserted, total: countValue(total) };
}

export const seedManifest: AddonSeedManifest = {
  seedVersion: SIGNAL_SEED_VERSION,
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    const { inserted, total } = await seedSignalSources(ctx.db, { companyId: ctx.companyId });
    return { inserted, updated: 0, skipped: Math.max(0, total - inserted) };
  },
};

export default seedManifest;
