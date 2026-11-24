import { defineAddon, ref, seed } from '@moonwitness/orm';
import { ModelAccess } from '@moonwitness/orm-base';
import { SignalAlert, SignalObservation, SignalScore, SignalSource } from './models.js';
import { SIGNAL_ALERT_DEFAULT_THRESHOLD } from './scoring.js';
import { views } from './views.js';
import { signalHttpPlugin } from './http-plugin.js';

export const manifest = defineAddon({
  name: 'signal',
  version: '1.0.0',
  depends: ['base'],
  models: [SignalSource, SignalObservation, SignalScore, SignalAlert],
  httpPlugins: [signalHttpPlugin],
  data: [
    seed(SignalSource, 'signal.source_rss_generic', {
      company: ref('base.company_default'),
      code: 'rss_generic',
      name: 'Generic RSS/Atom Feed',
      kind: 'rss',
      config: { feeds: [], maxItemsPerFeed: 50 },
      is_active: false,
    }),
    seed(SignalSource, 'signal.source_google_trends', {
      company: ref('base.company_default'),
      code: 'google_trends_daily',
      name: 'Google Trends Daily RSS',
      kind: 'google_trends',
      config: { geo: 'US', rssUrl: 'https://trends.google.com/trending/rss?geo=US' },
      is_active: false,
    }),
    seed(SignalSource, 'signal.source_github_trending', {
      company: ref('base.company_default'),
      code: 'github_trending_daily',
      name: 'GitHub Trending Repositories',
      kind: 'github_trending',
      config: { language: 'any', since: 'daily' },
      is_active: false,
    }),
    seed(SignalSource, 'signal.source_hackernews', {
      company: ref('base.company_default'),
      code: 'hackernews_front_page',
      name: 'Hacker News Front Page',
      kind: 'hackernews',
      config: { firebaseApi: 'https://hacker-news.firebaseio.com/v0', topItems: 30 },
      is_active: false,
    }),
    seed(SignalSource, 'signal.source_reddit', {
      company: ref('base.company_default'),
      code: 'reddit_hot',
      name: 'Reddit Hot Threads',
      kind: 'reddit',
      config: { subreddits: ['technology', 'programming'], listing: 'hot', limit: 25 },
      is_active: false,
    }),
    seed(SignalSource, 'signal.source_youtube_trending', {
      company: ref('base.company_default'),
      code: 'youtube_trending',
      name: 'YouTube Trending Videos',
      kind: 'youtube_trending',
      config: { regionCode: 'US', chart: 'mostPopular', maxResults: 25 },
      is_active: false,
    }),
    seed(SignalSource, 'signal.source_coingecko', {
      company: ref('base.company_default'),
      code: 'coingecko_markets',
      name: 'CoinGecko Market Movers',
      kind: 'coingecko',
      config: { vsCurrency: 'usd', perPage: 25 },
      is_active: false,
    }),
    seed(SignalSource, 'signal.source_web_diff', {
      company: ref('base.company_default'),
      code: 'web_diff_watch',
      name: 'Watched Page Content Diff',
      kind: 'web_diff',
      config: { urls: [], hashAlgorithm: 'sha256' },
      is_active: false,
    }),
    seed(SignalSource, 'signal.source_custom', {
      company: ref('base.company_default'),
      code: 'custom_ingest',
      name: 'Custom Webhook Ingest',
      kind: 'custom',
      config: { protocol: 'webhook' },
      is_active: false,
    }),
    seed(ModelAccess, 'signal.access_user_source_rw', {
      group: ref('base.group_user'),
      model_name: SignalSource.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'signal.access_user_observation_rw', {
      group: ref('base.group_user'),
      model_name: SignalObservation.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'signal.access_user_score_rw', {
      group: ref('base.group_user'),
      model_name: SignalScore.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'signal.access_user_alert_rw', {
      group: ref('base.group_user'),
      model_name: SignalAlert.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
  ],
  views,
  menus: [
    { model: SignalObservation.modelName, label: 'Signal Feed', group: 'Signals', sequence: 10 },
    { model: SignalSource.modelName, label: 'Signal Sources', group: 'Signals', sequence: 20 },
    {
      model: SignalScore.modelName,
      label: 'Signal Scores',
      group: 'Signals',
      sequence: 30,
      developmentOnly: true,
    },
    { model: SignalAlert.modelName, label: 'Signal Alerts', group: 'Signals', sequence: 40 },
  ],
});

export const SIGNAL_ALERT_SEED_THRESHOLD = SIGNAL_ALERT_DEFAULT_THRESHOLD;
