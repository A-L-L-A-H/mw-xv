export {
  SignalSource,
  SignalObservation,
  SignalScore,
  SignalAlert,
  SIGNAL_SOURCE_KINDS,
  SIGNAL_ALERT_STATUSES,
} from './models.js';
export type { SignalSourceKind, SignalAlertStatus } from './models.js';
export { views } from './views.js';
export { manifest } from './manifest.js';
export { signalHttpPlugin } from './http-plugin.js';
export {
  DEFAULT_SIGNAL_SCORE_WEIGHTS,
  SIGNAL_ALERT_DEFAULT_THRESHOLD,
  computeSignalFinalScore,
  shouldFireAlert,
  type SignalScoreInput,
  type SignalScoreWeights,
  type SignalFinalScore,
} from './scoring.js';
export { signalSeedManifest } from './seed-manifest.js';
export type { AddonSeedManifest } from '@moonwitness/orm-base';
export { SIGNAL_SOURCE_SEEDS } from './seed.js';
export {
  signalAdapters,
  adapterForKind,
  RssAdapter,
  GoogleTrendsAdapter,
  GithubTrendingAdapter,
  HackerNewsAdapter,
  RedditAdapter,
  YoutubeTrendingAdapter,
  CoinGeckoAdapter,
  WebDiffAdapter,
  CustomAdapter,
  XMLParser,
  hashObservationContent,
  toRawJson,
} from './adapters/index.js';
export type {
  SignalAdapter,
  SignalAdapterContext,
  SignalObservationDraft,
} from './adapters/index.js';
