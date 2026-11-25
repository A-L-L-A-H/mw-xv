import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';

function contentTemplateModel(): typeof BaseModel {
  return ContentTemplate;
}

export const ContentTemplateStatus = {
  DRAFT: 'draft',
  REVIEW: 'review',
  APPROVED: 'approved',
  ARCHIVED: 'archived',
} as const;

export const ContentAssetStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
} as const;

export const ContentCampaignStatus = {
  PLANNED: 'planned',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export const PublishTargetKind = {
  SOCIAL: 'social',
  BLOG: 'blog',
  NEWSLETTER: 'newsletter',
  VIDEO: 'video',
  PODCAST: 'podcast',
  CUSTOM: 'custom',
} as const;

export const ContentTemplate = defineModel('content.template', {
  table: 'content_templates',
  order: 'name asc',
  fields: {
    slug: fields.string({ required: true, unique: true, pattern: '^[a-z0-9-]+$' }),
    name: fields.string({ required: true }),
    description: fields.text(),
    kind: fields.enum(
      [
        'article',
        'social_post',
        'video_script',
        'newsletter',
        'thread',
        'carousel',
        'ad_copy',
        'landing_page',
      ] as const,
      { required: true }
    ),
    structure: fields.json({ label: 'Template Structure', required: true }),
    variables: fields.json({ label: 'Variables Schema' }),
    default_locale: fields.string({ required: true, default: 'en' }),
    supported_locales: fields.json({ default: ['en'] }),
    status: fields.enum(['draft', 'review', 'approved', 'archived'] as const, {
      required: true,
      default: ContentTemplateStatus.DRAFT,
    }),
    version: fields.string({ required: true, default: '1.0.0' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});

export const ContentAsset = defineModel('content.asset', {
  table: 'content_assets',
  order: 'created_at desc',
  fields: {
    template: fields.belongsTo(contentTemplateModel, { required: true, label: 'Template' }),
    title: fields.string({ required: true }),
    slug: fields.string({ required: true, unique: true }),
    locale: fields.string({ required: true, default: 'en' }),
    content: fields.json({ label: 'Rendered Content', required: true }),
    status: fields.enum(['pending', 'processing', 'ready', 'failed'] as const, {
      required: true,
      default: ContentAssetStatus.PENDING,
    }),
    metadata: fields.json({ label: 'SEO / Metadata' }),
    template_version: fields.string({ required: true }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
  unique: [['template', 'locale', 'slug']],
});

export const ContentCampaign = defineModel('content.campaign', {
  table: 'content_campaigns',
  order: 'created_at desc',
  fields: {
    name: fields.string({ required: true }),
    slug: fields.string({ required: true, unique: true }),
    description: fields.text(),
    status: fields.enum(['planned', 'active', 'paused', 'completed', 'cancelled'] as const, {
      required: true,
      default: ContentCampaignStatus.PLANNED,
    }),
    start_date: fields.date(),
    end_date: fields.date(),
    target_metrics: fields.json({ label: 'Target Metrics' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});

export const ContentPublishTarget = defineModel('content.publish_target', {
  table: 'content_publish_targets',
  order: 'name asc',
  fields: {
    campaign: fields.belongsTo(ContentCampaign, { required: true, label: 'Campaign' }),
    name: fields.string({ required: true }),
    kind: fields.enum(['social', 'blog', 'newsletter', 'video', 'podcast', 'custom'] as const, {
      required: true,
    }),
    platform: fields.string({ required: true }),
    config: fields.json({ label: 'Platform Config', required: true }),
    is_active: fields.boolean({ required: true, default: true }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});

export const ContentPublication = defineModel('content.publication', {
  table: 'content_publications',
  order: 'published_at desc',
  fields: {
    asset: fields.belongsTo(ContentAsset, { required: true, label: 'Asset' }),
    target: fields.belongsTo(ContentPublishTarget, { required: true, label: 'Publish Target' }),
    external_id: fields.string({ label: 'External Publication ID' }),
    url: fields.string({ label: 'Publication URL' }),
    status: fields.enum(['pending', 'published', 'failed', 'deleted'] as const, {
      required: true,
      default: 'pending',
    }),
    published_at: fields.datetime(),
    error: fields.text(),
    metrics: fields.json({ label: 'Engagement Metrics' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});

export const ContentAnalytics = defineModel('content.analytics', {
  table: 'content_analytics',
  unique: [['asset', 'date']],
  order: 'date desc',
  fields: {
    asset: fields.belongsTo(ContentAsset, { required: true, label: 'Asset' }),
    date: fields.date({ required: true }),
    views: fields.integer({ required: true, default: 0 }),
    clicks: fields.integer({ required: true, default: 0 }),
    shares: fields.integer({ required: true, default: 0 }),
    conversions: fields.integer({ required: true, default: 0 }),
    revenue_minor: fields.integer({ required: true, default: 0 }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});
