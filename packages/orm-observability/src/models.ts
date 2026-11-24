import { defineModel, fields } from '@moonwitness/orm';

export const TelemetrySpan = defineModel('observability.telemetry_span', {
  table: 'observability_spans',
  order: 'id asc',
  unique: [['trace_id', 'span_id']],
  fields: {
    trace_id: fields.text({ required: true }),
    span_id: fields.text({ required: true }),
    parent_span_id: fields.text({}),
    name: fields.text({ required: true }),
    service_name: fields.text({ required: true }),
    run_id: fields.text({ required: true }),
    agent_name: fields.text({}),
    status: fields.enum(['ok', 'error', 'unset'], { required: true }),
    start_time_ms: fields.float({ required: true }),
    end_time_ms: fields.float({ required: true }),
    duration_ms: fields.float({ required: true }),
    payload_json: fields.text({ required: true }),
  },
});

export const TelemetryLog = defineModel('observability.telemetry_log', {
  table: 'observability_logs',
  order: 'id asc',
  unique: [['log_id']],
  fields: {
    log_id: fields.text({ required: true }),
    timestamp_ms: fields.float({ required: true }),
    service_name: fields.text({ required: true }),
    severity: fields.enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'UNSPECIFIED'], {
      required: true,
    }),
    trace_id: fields.text({}),
    span_id: fields.text({}),
    run_id: fields.text({}),
    agent_name: fields.text({}),
    payload_json: fields.text({ required: true }),
  },
});

export const TelemetryMetricSeries = defineModel('observability.telemetry_metric_series', {
  table: 'observability_metric_series',
  order: 'id asc',
  unique: [['series_id']],
  fields: {
    series_id: fields.text({ required: true }),
    name: fields.text({ required: true }),
    description: fields.text({}),
    unit: fields.text({}),
    metric_type: fields.enum(['gauge', 'sum', 'histogram', 'exponential_histogram', 'summary'], {
      required: true,
    }),
    service_name: fields.text({ required: true }),
    scope_name: fields.text({}),
    latest_time_ms: fields.float({ required: true }),
    payload_json: fields.text({ required: true }),
  },
});

export const TelemetryMetricPoint = defineModel('observability.telemetry_metric_point', {
  table: 'observability_metric_points',
  order: 'id asc',
  unique: [['series_id', 'timestamp_ms']],
  fields: {
    series_id: fields.text({ required: true }),
    timestamp_ms: fields.float({ required: true }),
    payload_json: fields.text({ required: true }),
  },
});

export const TelemetryState = defineModel('observability.telemetry_state', {
  table: 'observability_state',
  order: 'id asc',
  unique: [['key']],
  fields: {
    key: fields.string({ required: true }),
    value: fields.integer({ required: true, default: 0 }),
  },
});
