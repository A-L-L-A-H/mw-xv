import { defineAddon, seed } from '@moonwitness/orm';
import { observabilityHttpPlugin } from './http-plugin.js';
import { IngestCredential, QoderCorrelation, TelemetryLog, TelemetryMetricPoint, TelemetryMetricSeries, TelemetrySpan, TelemetryState, TelemetryTrace } from './models.js';
import { REVISION_STATE_KEY } from './constants.js';

const INDEXES = [
  ['observability_spans_trace_lookup_idx', TelemetrySpan.tableName, ['tenant_key', 'trace_id', 'start_time_ms', 'span_id']],
  ['observability_spans_retention_idx', TelemetrySpan.tableName, ['end_time_ms', 'start_time_ms']],
  ['observability_spans_tenant_time_idx', TelemetrySpan.tableName, ['tenant_id', 'start_time_ms', 'id']],
  ['observability_traces_recency_idx', TelemetryTrace.tableName, ['tenant_id', 'started_at', 'trace_id']],
  ['observability_logs_severity_time_idx', TelemetryLog.tableName, ['tenant_id', 'severity', 'timestamp_ms', 'id']],
  ['observability_logs_trace_time_idx', TelemetryLog.tableName, ['tenant_id', 'trace_id', 'timestamp_ms', 'id']],
  ['observability_logs_retention_idx', TelemetryLog.tableName, ['timestamp_ms', 'id']],
  ['observability_metric_series_recency_idx', TelemetryMetricSeries.tableName, ['tenant_id', 'latest_time_ms', 'id']],
  ['observability_metric_points_retention_idx', TelemetryMetricPoint.tableName, ['timestamp_ms', 'series_key']],
  ['observability_correlation_expiry_idx', QoderCorrelation.tableName, ['expires_at']],
  ['observability_credential_lookup_idx', IngestCredential.tableName, ['token_hash']],
] as const;

export const observabilityAddon = defineAddon({
  name: 'observability', version: '1.1.0', depends: [], httpPlugins: [observabilityHttpPlugin],
  models: [TelemetrySpan, TelemetryTrace, TelemetryLog, TelemetryMetricSeries, TelemetryMetricPoint, TelemetryState, QoderCorrelation, IngestCredential],
  data: [seed(TelemetryState, 'observability.state_revision', { key: REVISION_STATE_KEY, value: 0 })],
  setup: async (trx) => {
    for (const [name, table, columns] of INDEXES) {
      await trx.raw(`CREATE INDEX IF NOT EXISTS ?? ON ?? (${columns.map(() => '??').join(', ')})`, [name, table, ...columns]);
    }
    await trx(TelemetryState.tableName).insert({ key: REVISION_STATE_KEY, value: 0 }).onConflict('key').ignore();
    // Backfill projections once for databases installed before this addon version.
    const existing = await trx(TelemetryTrace.tableName).first('id');
    if (!existing) {
      const spans = await trx<{ trace_id: string; tenant_key: string; payload_json: string }>(TelemetrySpan.tableName).select('trace_id', 'tenant_key', 'payload_json');
      const groups = new Map<string, { trace_id: string; tenant_key: string; spans: Record<string, unknown>[] }>();
      for (const span of spans) { const key = `${span.tenant_key}\u0000${span.trace_id}`; const group = groups.get(key) ?? { trace_id: span.trace_id, tenant_key: span.tenant_key, spans: [] }; group.spans.push(JSON.parse(span.payload_json) as Record<string, unknown>); groups.set(key, group) }
      const { summarizeTrace } = await import('./internal.js');
      for (const group of groups.values()) {
        const summary = summarizeTrace(group.trace_id, group.spans as unknown as import('./types.js').SpanRecord[]);
        await trx(TelemetryTrace.tableName).insert({ tenant_key: group.tenant_key, trace_id: group.trace_id, started_at: summary.startedAt, span_count: summary.spanCount, error_count: summary.errorCount, latency_sum_ms: group.spans.reduce((sum, span) => sum + Number(span.durationMs ?? 0), 0), payload_json: JSON.stringify(summary) }).onConflict(['tenant_key', 'trace_id']).ignore();
      }
    }
  },
});
export const observabilityManifest = observabilityAddon;
export const manifest = observabilityAddon;
