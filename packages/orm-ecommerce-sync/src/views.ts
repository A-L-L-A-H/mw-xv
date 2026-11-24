import { defineView } from '@moonwitness/orm';
import { MarketplaceConnection, MarketplaceSyncJob, SyncMetric } from './models/index.js';

export const views = [
  defineView(MarketplaceSyncJob, {
    title: 'Sync Jobs',
    list: {
      columns: [
        'marketplace',
        'direction',
        'status',
        'requested_at',
        'started_at',
        'completed_at',
        'retry_count',
        'company',
      ],
      order: 'requested_at desc, id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'done']] },
        { color: 'warning', domain: [['status', '=', 'running']] },
        { color: 'danger', domain: [['status', '=', 'failed']] },
        { color: 'info', domain: [['status', '=', 'queued']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Job Details',
          columns: 2,
          fields: ['marketplace', 'direction', 'status', 'company', 'source_rule_id', 'dedupe_key'],
        },
        {
          title: 'Payload & Timing',
          columns: 2,
          fields: ['payload', 'requested_at', 'started_at', 'completed_at', 'retry_count', 'error_message'],
        },
      ],
    },
    search: {
      fields: ['marketplace', 'source_rule_id', 'dedupe_key', 'error_message'],
      filters: [
        { label: 'Queued', domain: [['status', '=', 'queued']] },
        { label: 'Running', domain: [['status', '=', 'running']] },
        { label: 'Completed', domain: [['status', '=', 'done']] },
        { label: 'Failed', domain: [['status', '=', 'failed']] },
        { label: 'Pull Jobs', domain: [['direction', '=', 'pull']] },
        { label: 'Push Jobs', domain: [['direction', '=', 'push']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Marketplace', field: 'marketplace' },
        { label: 'Direction', field: 'direction' },
        { label: 'Company', field: 'company_id' },
      ],
    },
    kanban: {
      groupBy: 'status',
      cardTitle: 'marketplace',
      cardFields: ['direction', 'requested_at', 'retry_count'],
      badgeField: 'status',
    },
  }),
  defineView(MarketplaceConnection, {
    title: 'Marketplace Connections',
    list: {
      columns: ['marketplace', 'name', 'status', 'last_sync_at', 'company'],
      order: 'id asc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'active']] },
        { color: 'danger', domain: [['status', '=', 'error']] },
        { color: 'warning', domain: [['status', '=', 'pending']] },
        { color: 'muted', domain: [['status', '=', 'inactive']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Connection',
          columns: 2,
          fields: ['marketplace', 'name', 'status', 'company', 'last_sync_at'],
        },
        {
          title: 'Configuration',
          fields: ['config'],
        },
        {
          title: 'Credentials (Encrypted)',
          fields: ['credentials'],
        },
        {
          title: 'Error Tracking',
          fields: ['last_error'],
        },
      ],
    },
    search: {
      fields: ['name', 'marketplace', 'last_error'],
      filters: [
        { label: 'Active', domain: [['status', '=', 'active']] },
        { label: 'Inactive', domain: [['status', '=', 'inactive']] },
        { label: 'Error', domain: [['status', '=', 'error']] },
        { label: 'Pending', domain: [['status', '=', 'pending']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Marketplace', field: 'marketplace' },
        { label: 'Company', field: 'company_id' },
      ],
    },
  }),
  defineView(SyncMetric, {
    title: 'Sync Metrics',
    list: {
      columns: ['date', 'marketplace', 'direction', 'jobs_queued', 'jobs_completed', 'jobs_failed', 'items_processed', 'duration_ms_sum', 'company'],
      order: 'date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Daily Metric',
          columns: 2,
          fields: ['date', 'marketplace', 'direction', 'company', 'jobs_queued', 'jobs_completed', 'jobs_failed', 'items_processed', 'duration_ms_sum'],
        },
      ],
    },
    search: {
      fields: ['marketplace'],
      filters: [
        { label: 'Pull', domain: [['direction', '=', 'pull']] },
        { label: 'Push', domain: [['direction', '=', 'push']] },
      ],
      groupBy: [
        { label: 'Date', field: 'date' },
        { label: 'Marketplace', field: 'marketplace' },
        { label: 'Direction', field: 'direction' },
        { label: 'Company', field: 'company_id' },
      ],
    },
  }),
];