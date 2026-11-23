import { defineModel, fields } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';

export const SIGNAL_SOURCE_KINDS = [
  'rss',
  'google_trends',
  'github_trending',
  'hackernews',
  'reddit',
  'youtube_trending',
  'coingecko',
  'web_diff',
  'custom',
] as const;

export type SignalSourceKind = (typeof SIGNAL_SOURCE_KINDS)[number];

export const SIGNAL_ALERT_STATUSES = ['open', 'ack', 'resolved'] as const;

export type SignalAlertStatus = (typeof SIGNAL_ALERT_STATUSES)[number];

export const SignalSource = defineModel('signal.source', {
  table: 'signal_sources',
  order: 'create_date desc',
  unique: [['code']],
  fields: {
    code: fields.string({ required: true, label: 'Code' }),
    name: fields.string({ required: true, label: 'Name' }),
    kind: fields.enum(SIGNAL_SOURCE_KINDS, {
      required: true,
      label: 'Adapter Kind',
    }),
    config: fields.json({ label: 'Adapter Config' }),
    is_active: fields.boolean({ required: true, default: false, label: 'Active' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
  },
});

export const SignalObservation = defineModel('signal.observation', {
  table: 'signal_observations',
  order: 'published_at desc, id desc',
  unique: [['source', 'content_hash']],
  fields: {
    source: fields.belongsTo(SignalSource, { required: true, label: 'Source' }),
    title: fields.string({ required: true, label: 'Title' }),
    summary: fields.text({ label: 'Summary' }),
    url: fields.string({ label: 'URL' }),
    content_hash: fields.string({ required: true, label: 'Content Hash' }),
    raw: fields.json({ label: 'Raw Payload' }),
    published_at: fields.datetime({ label: 'Published At' }),
    tags: fields.json({ label: 'Tags' }),
    source_ref: fields.string({ label: 'Source Reference' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
  },
});

export const SignalScore = defineModel('signal.score', {
  table: 'signal_scores',
  order: 'scored_at desc, id desc',
  fields: {
    observation: fields.belongsTo(SignalObservation, {
      required: true,
      label: 'Observation',
    }),
    keyword_weight: fields.float({ required: true, default: 0, label: 'Keyword Weight' }),
    recency_decay: fields.float({ required: true, default: 0, label: 'Recency Decay' }),
    source_authority: fields.float({ required: true, default: 0, label: 'Source Authority' }),
    velocity: fields.float({ required: true, default: 0, label: 'Velocity' }),
    final_score: fields.float({ required: true, default: 0, label: 'Final Score' }),
    scored_at: fields.datetime({ required: true, label: 'Scored At' }),
  },
});

export const SignalAlert = defineModel('signal.alert', {
  table: 'signal_alerts',
  order: 'fired_at desc, id desc',
  fields: {
    observation: fields.belongsTo(SignalObservation, {
      required: true,
      label: 'Observation',
    }),
    score_ref: fields.string({ label: 'Score Reference' }),
    threshold: fields.float({ required: true, default: 0, label: 'Threshold' }),
    fired_at: fields.datetime({ required: true, label: 'Fired At' }),
    status: fields.enum(SIGNAL_ALERT_STATUSES, {
      required: true,
      default: 'open',
      label: 'Status',
    }),
  },
});
