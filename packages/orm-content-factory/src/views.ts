import { defineView } from '@moonwitness/orm';
import {
  ContentTemplate,
  ContentAsset,
  ContentCampaign,
  ContentPublishTarget,
  ContentPublication,
  ContentAnalytics,
} from './models/index.js';

export const views = [
  defineView(ContentTemplate, {
    title: 'Content Templates',
    list: {
      columns: ['name', 'slug', 'kind', 'default_locale', 'version', 'status'],
      order: 'name asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Template',
          columns: 2,
          fields: ['slug', 'name', 'kind', 'default_locale', 'version', 'status', 'company'],
        },
        {
          title: 'Definition',
          fields: ['description', 'structure', 'variables', 'supported_locales'],
        },
      ],
    },
    search: { fields: ['name', 'slug', 'description'] },
  }),
  defineView(ContentAsset, {
    title: 'Content Assets',
    list: {
      columns: ['title', 'template', 'locale', 'status', 'template_version'],
      order: 'created_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Asset',
          columns: 2,
          fields: ['template', 'title', 'slug', 'locale', 'status', 'template_version', 'company'],
        },
        {
          title: 'Content',
          fields: ['content', 'metadata'],
        },
      ],
    },
    search: { fields: ['title', 'slug'] },
  }),
  defineView(ContentCampaign, {
    title: 'Content Campaigns',
    list: {
      columns: ['name', 'slug', 'status', 'start_date', 'end_date'],
      order: 'created_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Campaign',
          columns: 2,
          fields: ['slug', 'name', 'status', 'start_date', 'end_date', 'company'],
        },
        {
          title: 'Details',
          fields: ['description', 'target_metrics'],
        },
      ],
    },
    search: { fields: ['name', 'slug', 'description'] },
  }),
  defineView(ContentPublishTarget, {
    title: 'Publish Targets',
    list: {
      columns: ['name', 'campaign', 'kind', 'platform', 'is_active'],
      order: 'name asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Target',
          columns: 2,
          fields: ['campaign', 'name', 'kind', 'platform', 'is_active', 'company'],
        },
        {
          title: 'Configuration',
          fields: ['config'],
        },
      ],
    },
    search: { fields: ['name', 'platform'] },
  }),
  defineView(ContentPublication, {
    title: 'Publications',
    list: {
      columns: ['asset', 'target', 'status', 'external_id', 'published_at'],
      order: 'published_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Publication',
          columns: 2,
          fields: ['asset', 'target', 'status', 'external_id', 'url', 'published_at', 'company'],
        },
        {
          title: 'Diagnostics',
          fields: ['error', 'metrics'],
        },
      ],
    },
    search: { fields: ['external_id', 'url'] },
  }),
  defineView(ContentAnalytics, {
    title: 'Content Analytics',
    list: {
      columns: ['asset', 'date', 'views', 'clicks', 'shares', 'conversions', 'revenue_minor'],
      order: 'date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Daily Metrics',
          columns: 2,
          fields: ['asset', 'date', 'views', 'clicks', 'shares', 'conversions', 'revenue_minor'],
        },
      ],
    },
    search: {
      fields: [],
      filters: [
        { label: 'Last 7 Days', domain: [['date', '>=', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)]] },
        { label: 'Last 30 Days', domain: [['date', '>=', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)]] },
        { label: 'Has Revenue', domain: [['revenue_minor', '>', 0]] },
{ label: 'Has Conversions', domain: [['conversions', '>', 0]] },
      ],
      groupBy: [
        { label: 'Asset', field: 'asset_id' },
        { label: 'Date', field: 'date' },
      ],
    },
  }),
];
