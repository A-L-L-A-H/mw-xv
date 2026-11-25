import { defineAddon, seed } from '@moonwitness/orm';
import { observabilityHttpPlugin } from './http-plugin.js';
import {
  TelemetryLog,
  TelemetryMetricPoint,
  TelemetryMetricSeries,
  TelemetrySpan,
  TelemetryState,
} from './models.js';

export const REVISION_STATE_KEY = 'revision';

const INDEXES = [
  {
    name: 'observability_spans_trace_lookup_idx',
    table: TelemetrySpan.tableName,
    columns: ['trace_id', 'start_time_ms', 'span_id'],
  },
  {
    name: 'observability_spans_retention_idx',
    table: TelemetrySpan.tableName,
    columns: ['end_time_ms', 'start_time_ms'],
  },
  {
    name: 'observability_spans_service_status_idx',
    table: TelemetrySpan.tableName,
    columns: ['service_name', 'status', 'start_time_ms'],
  },
  {
    name: 'observability_logs_severity_time_idx',
    table: TelemetryLog.tableName,
    columns: ['severity', 'timestamp_ms', 'id'],
  },
  {
    name: 'observability_logs_service_time_idx',
    table: TelemetryLog.tableName,
    columns: ['service_name', 'timestamp_ms', 'id'],
  },
  {
    name: 'observability_logs_trace_time_idx',
    table: TelemetryLog.tableName,
    columns: ['trace_id', 'timestamp_ms', 'id'],
  },
  {
    name: 'observability_logs_retention_idx',
    table: TelemetryLog.tableName,
    columns: ['timestamp_ms', 'id'],
  },
  {
    name: 'observability_metric_series_recency_idx',
    table: TelemetryMetricSeries.tableName,
    columns: ['latest_time_ms', 'id'],
  },
  {
    name: 'observability_metric_points_retention_idx',
    table: TelemetryMetricPoint.tableName,
    columns: ['timestamp_ms', 'series_id'],
  },
] as const;

export const observabilityAddon = defineAddon({
  name: 'observability',
  version: '1.0.0',
  depends: [],
  httpPlugins: [observabilityHttpPlugin],
  models: [
    TelemetrySpan,
    TelemetryLog,
    TelemetryMetricSeries,
    TelemetryMetricPoint,
    TelemetryState,
  ],
  data: [
    seed(TelemetryState, 'observability.state_revision', {
      key: REVISION_STATE_KEY,
      value: 0,
    }),
  ],
  setup: async (trx) => {
    for (const index of INDEXES) {
      const columns = index.columns.map(() => '??').join(', ');
      await trx.raw(`CREATE INDEX IF NOT EXISTS ?? ON ?? (${columns})`, [
        index.name,
        index.table,
        ...index.columns,
      ]);
    }
    await trx(TelemetryState.tableName)
      .insert({ key: REVISION_STATE_KEY, value: 0 })
      .onConflict('key')
      .ignore();
  },
});

export const observabilityManifest = observabilityAddon;
export const manifest = observabilityAddon;
