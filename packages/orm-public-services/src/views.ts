import { defineView } from '@moonwitness/orm';
import { PublicTool, PublicUsage, PublicMetric, PublicFeedback } from './models/index.js';

export const views = [
  defineView(PublicTool, {
    title: 'Public Tools',
    list: {
      columns: ['name', 'slug', 'kind', 'handler', 'rate_limit', 'is_active', 'charity_mode'],
      order: 'name asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Tool Configuration',
          columns: 2,
          fields: [
            'slug',
            'name',
            'kind',
            'handler',
            'rate_limit',
            'is_active',
            'charity_mode',
            'company',
          ],
        },
        {
          title: 'Descriptions',
          fields: ['description', 'attribution_text'],
        },
      ],
    },
    search: { fields: ['name', 'slug', 'handler', 'description'] },
  }),
  defineView(PublicUsage, {
    title: 'Public Tool Usage',
    list: {
      columns: ['tool', 'user_identifier', 'latency_ms', 'status', 'created_at'],
      order: 'created_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Usage Record',
          columns: 2,
          fields: ['tool', 'user_identifier', 'latency_ms', 'status', 'created_at'],
        },
        {
          title: 'Hashes',
          fields: ['input_hash', 'output_hash'],
        },
      ],
    },
    search: { fields: ['user_identifier', 'input_hash', 'output_hash'] },
  }),
  defineView(PublicMetric, {
    title: 'Public Daily Metrics',
    list: {
      columns: [
        'tool',
        'date',
        'calls',
        'unique_users',
        'avg_latency',
        'errors',
        'charity_attribution_minor',
      ],
      order: 'date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Metric',
          columns: 2,
          fields: [
            'tool',
            'date',
            'calls',
            'unique_users',
            'avg_latency',
            'errors',
            'charity_attribution_minor',
          ],
        },
      ],
    },
    search: {
      fields: [],
      filters: [
        {
          label: 'Last 7 Days',
          domain: [['date', '>=', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)]],
        },
        {
          label: 'Last 30 Days',
          domain: [['date', '>=', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)]],
        },
        { label: 'Has Errors', domain: [['errors', '>', 0]] },
        { label: 'Charity Active', domain: [['charity_attribution_minor', '>', 0]] },
      ],
      groupBy: [
        { label: 'Tool', field: 'tool_id' },
        { label: 'Date', field: 'date' },
      ],
    },
  }),
  defineView(PublicFeedback, {
    title: 'Public Feedback',
    list: {
      columns: ['tool', 'rating', 'contact_opt_in', 'created_at'],
      order: 'created_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Feedback',
          columns: 2,
          fields: ['tool', 'rating', 'contact_opt_in', 'created_at'],
        },
        {
          title: 'Comment',
          fields: ['comment'],
        },
      ],
    },
    search: { fields: ['comment'] },
  }),
];
