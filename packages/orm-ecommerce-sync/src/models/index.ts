import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';

export type SyncDirection = 'pull' | 'push';
export type SyncStatus = 'queued' | 'running' | 'done' | 'failed';
export type ConnectionStatus = 'active' | 'inactive' | 'error' | 'pending';

export const MarketplaceSyncJob = defineModel('ecommerce.sync_job', {
  table: 'marketplace_sync_jobs',
  order: 'requested_at desc, id desc',
  fields: {
    marketplace: fields.string({ required: true, label: 'Marketplace' }),
    direction: fields.enum(['pull', 'push'], { required: true, default: 'pull', label: 'Sync Direction' }),
    status: fields.enum(['queued', 'running', 'done', 'failed'], { required: true, default: 'queued', label: 'Job Status' }),
    payload: fields.json({ label: 'Sync Payload' }),
    source_rule_id: fields.string({ label: 'Source Rule ID' }),
    dedupe_key: fields.string({ label: 'Deduplication Key' }),
    requested_at: fields.datetime({ required: true, label: 'Requested At' }),
    started_at: fields.datetime({ label: 'Started At' }),
    completed_at: fields.datetime({ label: 'Completed At' }),
    error_message: fields.text({ label: 'Error Message' }),
    retry_count: fields.integer({ required: true, default: 0, label: 'Retry Count' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});

export const MarketplaceConnection = defineModel('ecommerce.connection', {
  table: 'marketplace_connections',
  order: 'id asc',
  fields: {
    marketplace: fields.string({ required: true, label: 'Marketplace' }),
    name: fields.string({ required: true, label: 'Connection Name' }),
    status: fields.enum(['active', 'inactive', 'error', 'pending'], { required: true, default: 'pending', label: 'Connection Status' }),
    config: fields.json({ required: true, label: 'Connection Configuration' }),
    credentials: fields.json({ label: 'Encrypted Credentials' }),
    last_sync_at: fields.datetime({ label: 'Last Sync At' }),
    last_error: fields.text({ label: 'Last Error' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});

function metricModel(): typeof BaseModel {
  return SyncMetric;
}

export const SyncMetric = defineModel('ecommerce.sync_metric', {
  table: 'marketplace_sync_metrics',
  order: 'date desc, id desc',
  fields: {
    date: fields.date({ required: true, label: 'Metric Date' }),
    marketplace: fields.string({ required: true, label: 'Marketplace' }),
    direction: fields.enum(['pull', 'push'], { required: true, label: 'Direction' }),
    jobs_queued: fields.integer({ required: true, default: 0, label: 'Jobs Queued' }),
    jobs_completed: fields.integer({ required: true, default: 0, label: 'Jobs Completed' }),
    jobs_failed: fields.integer({ required: true, default: 0, label: 'Jobs Failed' }),
    items_processed: fields.integer({ required: true, default: 0, label: 'Items Processed' }),
    duration_ms_sum: fields.integer({ required: true, default: 0, label: 'Total Duration (ms)' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
  unique: [['date', 'marketplace', 'direction', 'company']],
});