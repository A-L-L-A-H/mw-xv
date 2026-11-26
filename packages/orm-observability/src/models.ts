import { defineModel, fields } from '@moonwitness/orm';

export const TelemetrySpan = defineModel('observability.telemetry_span', {
  table: 'observability_spans', order: 'id asc', unique: [['tenant_key', 'trace_id', 'span_id']],
  fields: {
    tenant_key: fields.string({ required: true, default: 'global' }), trace_id: fields.text({ required: true }), span_id: fields.text({ required: true }),
    parent_span_id: fields.text({}), name: fields.text({ required: true }),
    service_name: fields.text({ required: true }), run_id: fields.text({ required: true }),
    agent_name: fields.text({}), status: fields.enum(['ok', 'error', 'unset'], { required: true }),
    start_time_ms: fields.float({ required: true }), end_time_ms: fields.float({ required: true }),
    duration_ms: fields.float({ required: true }), tenant_id: fields.integer({}),
    payload_json: fields.text({ required: true }),
  },
});
export const TelemetryTrace = defineModel('observability.telemetry_trace', {
  table: 'observability_traces', order: 'id asc', unique: [['tenant_key', 'trace_id']],
  fields: {
    tenant_key: fields.string({ required: true, default: 'global' }), tenant_id: fields.integer({}),
    trace_id: fields.text({ required: true }), started_at: fields.float({ required: true }),
    span_count: fields.integer({ required: true }), error_count: fields.integer({ required: true }),
    latency_sum_ms: fields.float({ required: true, default: 0 }),
    payload_json: fields.text({ required: true }),
  },
});
export const TelemetryLog = defineModel('observability.telemetry_log', {
  table: 'observability_logs', order: 'id asc', unique: [['tenant_key', 'log_id']],
  fields: {
    tenant_key: fields.string({ required: true, default: 'global' }), log_id: fields.text({ required: true }), timestamp_ms: fields.float({ required: true }),
    service_name: fields.text({ required: true }),
    severity: fields.enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'UNSPECIFIED'], { required: true }),
    trace_id: fields.text({}), span_id: fields.text({}), run_id: fields.text({}),
    agent_name: fields.text({}), tenant_id: fields.integer({}), payload_json: fields.text({ required: true }),
  },
});
export const TelemetryMetricSeries = defineModel('observability.telemetry_metric_series', {
  table: 'observability_metric_series', order: 'id asc', unique: [['tenant_key', 'series_id']],
  fields: {
    tenant_key: fields.string({ required: true, default: 'global' }), series_id: fields.text({ required: true }), name: fields.text({ required: true }),
    description: fields.text({}), unit: fields.text({}),
    metric_type: fields.enum(['gauge', 'sum', 'histogram', 'exponential_histogram', 'summary'], { required: true }),
    service_name: fields.text({ required: true }), scope_name: fields.text({}),
    latest_time_ms: fields.float({ required: true }), tenant_id: fields.integer({}),
    payload_json: fields.text({ required: true }),
  },
});
export const TelemetryMetricPoint = defineModel('observability.telemetry_metric_point', {
  table: 'observability_metric_points', order: 'id asc', unique: [['series_key', 'timestamp_ms']],
  fields: {
    series_key: fields.string({ required: true }), series_id: fields.text({ required: true }), timestamp_ms: fields.float({ required: true }),
    tenant_id: fields.integer({}), payload_json: fields.text({ required: true }),
  },
});
export const TelemetryState = defineModel('observability.telemetry_state', {
  table: 'observability_state', order: 'id asc', unique: [['key']],
  fields: { key: fields.string({ required: true }), value: fields.integer({ required: true, default: 0 }) },
});
export const QoderCorrelation = defineModel('observability.qoder_correlation', {
  table: 'observability_qoder_correlation', order: 'id asc', unique: [['state_key']],
  fields: {
    state_key: fields.string({ required: true }), tenant_id: fields.integer({}),
    kind: fields.string({ required: true }), expires_at: fields.float({ required: true }),
    payload_json: fields.text({ required: true }),
  },
});
export const IngestCredential = defineModel('observability.ingest_credential', {
  table: 'observability_ingest_credentials', order: 'id asc', unique: [['token_hash']],
  fields: {
    credential_id: fields.string({ required: true }), name: fields.string({ required: true }),
    token_hash: fields.string({ required: true }), company_id: fields.integer({}),
    user_id: fields.integer({}), created_at: fields.string({ required: true }),
    expires_at: fields.string({}), revoked_at: fields.string({}),
  },
});
