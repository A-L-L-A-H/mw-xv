import type { Knex } from 'knex';
import { boundedLimit, latestMetricTime, mergeMetricPoints, prepareMetricSeries, resolveTelemetryOptions, serializedBytes, summarizeTrace, MAX_RECORD_BYTES } from './internal.js';
import { decodeCursor, pageItems, type CursorPosition } from './pagination.js';
import { REVISION_STATE_KEY } from './constants.js';
import { IngestCredential, QoderCorrelation, TelemetryLog, TelemetryMetricPoint, TelemetryMetricSeries, TelemetrySpan, TelemetryState, TelemetryTrace } from './models.js';
import { redactTelemetry } from './redaction.js';
import type { CredentialLookup, IngestContext, IngestResult, LogQuery, LogRecord, MetricPoint, MetricQuery, MetricSeries, ObservabilityStatus, Page, QoderStateRepository, SpanRecord, TelemetryLimits, TelemetryScope, TelemetryStore, TelemetryStoreOptions, TelemetrySummary, TraceDetail, TraceQuery, TraceSummary } from './types.js';

export interface SqlTelemetryStoreOptions extends TelemetryStoreOptions {
  closeDb?: boolean;
  configured?: boolean;
  pruneOnRead?: boolean;
  correlationMaxAgeMs?: number;
}
interface PayloadRow { payload_json: string }
interface SpanRow extends PayloadRow { id: number }
interface LogRow extends PayloadRow { id: number }
interface SeriesRow extends PayloadRow { id: number; series_id: string }
interface TraceRow extends PayloadRow { trace_id: string; latency_sum_ms?: number }
interface StateRow { key: string; value: number | string }
interface CorrelationRow extends PayloadRow { state_key: string; kind: string; expires_at: number }
interface CountRow { count: number | string }

function parsePayload<T>(row: PayloadRow): T { return JSON.parse(row.payload_json) as T }
function tenantKey(context: IngestContext | TelemetryScope | undefined): string { return context && 'tenantId' in context && context.tenantId ? `company:${context.tenantId}` : 'global' }
function pageId(tenant: string, id: string): string { return `${tenant}\u0000${id}`; }
function seriesKey(tenant: string, id: string): string { return JSON.stringify([tenant, id]); }
function scoped<T>(query: T, scope?: TelemetryScope): T {
  const builder = query as unknown as Knex.QueryBuilder;
  if (!scope || scope.global) return query;
  if (!scope.tenantId) return builder.whereRaw('1 = 0') as T;
  return builder.where('tenant_id', scope.tenantId) as T;
}
function cursorWhere<T extends Knex.QueryBuilder>(query: T, column: string, idColumn: string, cursor: CursorPosition | undefined): T {
  if (!cursor) return query;
  const separator = cursor.id.indexOf('\u0000');
  const tenant = separator < 0 ? undefined : cursor.id.slice(0, separator);
  const id = separator < 0 ? cursor.id : cursor.id.slice(separator + 1);
  if (tenant === undefined) return query;
  const comparison = cursor.direction === 'asc' ? '>' : '<';
  return query.whereRaw(`(?? ${comparison} ? OR (?? = ? AND (?? ${comparison} ? OR (?? = ? AND ?? ${comparison} ?))))`, [column, cursor.time, column, cursor.time, 'tenant_key', tenant, 'tenant_key', tenant, idColumn, id]) as T;
}
function spanRow(span: SpanRecord, context?: IngestContext): Record<string, unknown> {
  const stored = { ...span, ...(context?.tenantId ? { tenantId: context.tenantId } : { tenantId: undefined }) };
  return { tenant_key: tenantKey(context), tenant_id: context?.tenantId ?? null, trace_id: span.traceId, span_id: span.spanId, parent_span_id: span.parentSpanId ?? null, name: span.name, service_name: span.serviceName, run_id: span.runId, agent_name: span.agentName ?? null, status: span.status, start_time_ms: span.startTimeMs, end_time_ms: span.endTimeMs, duration_ms: span.durationMs, payload_json: JSON.stringify(stored) };
}
function logRow(log: LogRecord, context?: IngestContext): Record<string, unknown> {
  const stored = { ...log, ...(context?.tenantId ? { tenantId: context.tenantId } : { tenantId: undefined }) };
  return { tenant_key: tenantKey(context), tenant_id: context?.tenantId ?? null, log_id: log.id, timestamp_ms: log.timestampMs, service_name: log.serviceName, severity: log.severity, trace_id: log.traceId ?? null, span_id: log.spanId ?? null, run_id: log.runId ?? null, agent_name: log.agentName ?? null, payload_json: JSON.stringify(stored) };
}
function seriesRow(series: MetricSeries, context?: IngestContext): Record<string, unknown> {
  const stored = { ...series, ...(context?.tenantId ? { tenantId: context.tenantId } : { tenantId: undefined }) };
  return { tenant_key: tenantKey(context), tenant_id: context?.tenantId ?? null, series_id: series.id, name: series.name, description: series.description ?? null, unit: series.unit ?? null, metric_type: series.type, service_name: series.serviceName, scope_name: series.scopeName ?? null, latest_time_ms: latestMetricTime(series), payload_json: JSON.stringify(stored) };
}
function pointRow(seriesId: string, point: MetricPoint, context?: IngestContext): Record<string, unknown> {
  return { series_key: seriesKey(tenantKey(context), seriesId), series_id: seriesId, tenant_id: context?.tenantId ?? null, timestamp_ms: point.timestampMs, payload_json: JSON.stringify(point) };
}
async function ingestCount(db: Knex, table: string, context?: IngestContext): Promise<number> {
  const row = await db(table).where('tenant_key', tenantKey(context)).count('* as count').first() as CountRow | undefined;
  return Number(row?.count ?? 0);
}
async function readRevision(db: Knex): Promise<number> {
  const row = await db<StateRow>(TelemetryState.tableName).where({ key: REVISION_STATE_KEY }).first();
  if (!row) throw new Error('Observability addon is not installed: revision state is missing');
  return Number(row.value);
}
async function updateProjection(trx: Knex.Transaction, traceId: string, context?: IngestContext): Promise<void> {
  const rows = await trx<SpanRow>(TelemetrySpan.tableName).where('tenant_key', tenantKey(context)).where('trace_id', traceId).select('payload_json');
  if (rows.length === 0) {
    await trx(TelemetryTrace.tableName).where('tenant_key', tenantKey(context)).where('trace_id', traceId).delete();
    return;
  }
  const summary = summarizeTrace(traceId, rows.map((row) => parsePayload<SpanRecord>(row)));
  await trx(TelemetryTrace.tableName).insert({ tenant_key: tenantKey(context), tenant_id: context?.tenantId ?? null, trace_id: traceId, started_at: summary.startedAt, span_count: summary.spanCount, error_count: summary.errorCount, latency_sum_ms: rows.reduce((sum, row) => sum + parsePayload<SpanRecord>(row).durationMs, 0), payload_json: JSON.stringify(summary) }).onConflict(['tenant_key', 'trace_id']).merge(['started_at', 'span_count', 'error_count', 'latency_sum_ms', 'payload_json']);
}

export class SqlTelemetryStore implements TelemetryStore {
  readonly limits: TelemetryLimits;
  private readonly db: Knex;
  private readonly now: () => number;
  private readonly closeDb: boolean;
  private readonly configured: boolean;
  private readonly pruneOnRead: boolean;
  private readonly correlationMaxAgeMs: number;
  private closing?: Promise<void>;
  private lastPruneAt?: string;
  private lastPrunedRecords = 0;

  constructor(db: Knex, options: SqlTelemetryStoreOptions = {}) {
    const resolved = resolveTelemetryOptions(options);
    this.limits = resolved.limits; this.now = resolved.now; this.db = db;
    this.closeDb = options.closeDb ?? true; this.configured = options.configured ?? true;
    this.pruneOnRead = options.pruneOnRead ?? true;
    this.correlationMaxAgeMs = options.correlationMaxAgeMs ?? 10 * 60_000;
  }
  async getRevision(): Promise<number> { return readRevision(this.db) }
  async ingestSpans(input: readonly SpanRecord[], context?: IngestContext): Promise<IngestResult> {
    return this.runWrite(async (trx) => this.ingestSpansTrx(trx, input, context, await readRevision(trx)));
  }
  private async ingestSpansTrx(trx: Knex.Transaction, input: readonly SpanRecord[], context: IngestContext | undefined, revision: number): Promise<IngestResult> {
      let changed = (await this.prune(trx)) > 0;
      let count = await ingestCount(trx, TelemetrySpan.tableName, context); let accepted = 0; let rejected = 0;
      const traces = new Set<string>();
      for (const span of input) {
        const existing = await trx(TelemetrySpan.tableName).where({ tenant_key: tenantKey(context), trace_id: span.traceId, span_id: span.spanId }).first('id');
        if (existing) { accepted += 1; continue }
        if (count >= this.limits.maxSpans) { rejected += 1; continue }
        const redacted = redactTelemetry({ ...span, ...(context?.tenantId ? { tenantId: context.tenantId } : {}) });
        if (serializedBytes(redacted) > MAX_RECORD_BYTES) { rejected += 1; continue }
        const inserted = await trx(TelemetrySpan.tableName).insert(spanRow(redacted, context)).onConflict(['tenant_key', 'trace_id', 'span_id']).ignore();
        if (Number(inserted) === 0) { accepted += 1; continue }
        count += 1; accepted += 1; changed = true; traces.add(span.traceId);
      }
      for (const traceId of traces) await updateProjection(trx, traceId, context);
      if ((await this.prune(trx)) > 0) changed = true;
      if (changed) await this.writeRevision(trx, revision + 1);
      return { accepted, rejected };
  }
  async ingestLogs(input: readonly LogRecord[], context?: IngestContext): Promise<IngestResult> {
    return this.runWrite(async (trx) => this.ingestLogsTrx(trx, input, context, await readRevision(trx)));
  }
  private async ingestLogsTrx(trx: Knex.Transaction, input: readonly LogRecord[], context: IngestContext | undefined, revision: number): Promise<IngestResult> {
      let changed = (await this.prune(trx)) > 0;
      let count = await ingestCount(trx, TelemetryLog.tableName, context); let accepted = 0; let rejected = 0;
      for (const log of input) {
        if (await trx(TelemetryLog.tableName).where({ tenant_key: tenantKey(context), log_id: log.id }).first('id')) { accepted += 1; continue }
        if (count >= this.limits.maxLogs) { rejected += 1; continue }
        const redacted = redactTelemetry({ ...log, ...(context?.tenantId ? { tenantId: context.tenantId } : {}) });
        if (serializedBytes(redacted) > MAX_RECORD_BYTES) { rejected += 1; continue }
        const inserted = await trx(TelemetryLog.tableName).insert(logRow(redacted, context)).onConflict(['tenant_key', 'log_id']).ignore();
        if (Number(inserted) === 0) { accepted += 1; continue }
        count += 1; accepted += 1; changed = true;
      }
      if ((await this.prune(trx)) > 0) changed = true;
      if (changed) await this.writeRevision(trx, revision + 1);
      return { accepted, rejected };
  }
  async ingestMetrics(input: readonly MetricSeries[], context?: IngestContext): Promise<IngestResult> {
    return this.runWrite(async (trx) => this.ingestMetricsTrx(trx, input, context, await readRevision(trx)));
  }
  private async ingestMetricsTrx(trx: Knex.Transaction, input: readonly MetricSeries[], context: IngestContext | undefined, revision: number): Promise<IngestResult> {
    let changed = (await this.prune(trx)) > 0;
    let count = await ingestCount(trx, TelemetryMetricSeries.tableName, context); let accepted = 0; let rejected = 0;
    for (const incoming of input) {
      const prepared = prepareMetricSeries({ ...incoming, ...(context?.tenantId ? { tenantId: context.tenantId } : {}) }, this.limits.maxMetricPoints);
      rejected += prepared.rejected; if (!prepared.series) continue;
      const series = prepared.series;
      const existingRow = await trx<SeriesRow>(TelemetryMetricSeries.tableName).where('tenant_key', tenantKey(context)).where('series_id', series.id).first('id', 'payload_json');
      if (existingRow) {
        const existing = parsePayload<MetricSeries>(existingRow);
        const merged = mergeMetricPoints(existing.points, series.points, this.limits.maxMetricPoints);
        accepted += merged.accepted; rejected += merged.rejected;
        if (merged.changed > 0) {
          const updated = { ...existing, points: merged.points };
          for (const point of updated.points) { const row = pointRow(updated.id, point, context); await trx(TelemetryMetricPoint.tableName).insert(row).onConflict(['series_key', 'timestamp_ms']).merge({ payload_json: row.payload_json }) }
          if (updated.points[0]) await trx(TelemetryMetricPoint.tableName).where({ series_key: seriesKey(tenantKey(context), updated.id) }).where('timestamp_ms', '<', updated.points[0].timestampMs).delete();
          await trx(TelemetryMetricSeries.tableName).where({ id: existingRow.id }).update({ latest_time_ms: latestMetricTime(updated), payload_json: JSON.stringify(updated) }); changed = true;
        }
        continue;
      }
      if (count >= this.limits.maxMetricSeries) {
        const oldestQuery = trx<SeriesRow>(TelemetryMetricSeries.tableName).where('tenant_key', tenantKey(context)).orderBy('id', 'asc');
        const oldest = await oldestQuery.first('id', 'series_id', 'payload_json');
        if (oldest) { rejected += parsePayload<MetricSeries>(oldest).points.length; await trx(TelemetryMetricPoint.tableName).where({ series_key: seriesKey(tenantKey(context), oldest.series_id) }).delete(); await trx(TelemetryMetricSeries.tableName).where({ id: oldest.id }).delete(); count -= 1 }
      }
      const stored = { ...series, points: series.points.slice(-this.limits.maxMetricPoints) };
      const inserted = await trx(TelemetryMetricSeries.tableName).insert(seriesRow(stored, context)).onConflict(['tenant_key', 'series_id']).ignore();
      if (Number(inserted) === 0) continue;
      for (const point of stored.points) await trx(TelemetryMetricPoint.tableName).insert(pointRow(stored.id, point, context)).onConflict(['series_key', 'timestamp_ms']).merge({ payload_json: JSON.stringify(point) });
      count += 1; accepted += prepared.accepted; changed = true;
    }
    if ((await this.prune(trx)) > 0) changed = true;
    if (changed) await this.writeRevision(trx, revision + 1);
    return { accepted, rejected };
  }
  async listTraces(query: TraceQuery = {}): Promise<Page<TraceSummary>> {
    await this.readPrune(); const limit = boundedLimit(query.limit); const direction = 'desc';
    const cursor = decodeCursor(query.cursor, direction); const search = query.query?.trim().toLowerCase().slice(0, 256) ?? '';
    let builder = scoped(this.db<TraceRow>(TelemetryTrace.tableName).select('trace_id', 'started_at', 'payload_json'), query.scope).orderBy('started_at', direction).orderBy('tenant_key', direction).orderBy('trace_id', direction).limit(limit + 1);
    builder = cursorWhere(builder, 'started_at', 'trace_id', cursor);
    if (query.status === 'error') builder = builder.where('error_count', '>', 0);
    if (query.status === 'ok') builder = builder.where('error_count', 0);
    if (search) builder = builder.whereRaw('LOWER(payload_json) LIKE ?', [`%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`]);
    const rows = await builder;
    return pageItems(rows.map((row) => parsePayload<TraceSummary>(row)), limit, (item) => ({ time: item.startedAt, id: pageId(tenantKey({ tenantId: item.tenantId }), item.traceId), direction }));
  }
  async getTrace(traceId: string, options: { scope?: TelemetryScope; spanCursor?: string; logCursor?: string; spanLimit?: number; logLimit?: number } = {}): Promise<TraceDetail | undefined> {
    await this.readPrune();
    const projection = await scoped(this.db<TraceRow>(TelemetryTrace.tableName).where('trace_id', traceId), options.scope).first('payload_json');
    if (!projection) return undefined;
    const summary = parsePayload<TraceSummary>(projection);
    const spanLimit = boundedLimit(options.spanLimit, 500); const logLimit = boundedLimit(options.logLimit, 500);
    let spansQuery = scoped(this.db<SpanRow>(TelemetrySpan.tableName).where('trace_id', traceId).select('payload_json'), options.scope).orderBy('start_time_ms', 'asc').orderBy('tenant_key', 'asc').orderBy('span_id', 'asc').limit(spanLimit + 1);
    spansQuery = cursorWhere(spansQuery, 'start_time_ms', 'span_id', decodeCursor(options.spanCursor, 'asc'));
    let logsQuery = scoped(this.db<LogRow>(TelemetryLog.tableName).where('trace_id', traceId).select('id', 'timestamp_ms', 'payload_json'), options.scope).orderBy('timestamp_ms', 'asc').orderBy('tenant_key', 'asc').orderBy('log_id', 'asc').limit(logLimit + 1);
    logsQuery = cursorWhere(logsQuery, 'timestamp_ms', 'log_id', decodeCursor(options.logCursor, 'asc'));
    const [spanRows, logRows] = await Promise.all([spansQuery, logsQuery]);
    const spans = spanRows.map((row) => parsePayload<SpanRecord>(row)); const logs = logRows.map((row) => parsePayload<LogRecord>(row));
    return { summary, spans: pageItems(spans, spanLimit, (item) => ({ time: item.startTimeMs, id: pageId(tenantKey({ tenantId: item.tenantId }), item.spanId), direction: 'asc' })), logs: pageItems(logs, logLimit, (item) => ({ time: item.timestampMs, id: pageId(tenantKey({ tenantId: item.tenantId }), item.id), direction: 'asc' })) };
  }
  async listLogs(query: LogQuery = {}): Promise<Page<LogRecord>> {
    await this.readPrune(); const limit = boundedLimit(query.limit); const direction = 'desc';
    let builder = scoped(this.db<LogRow>(TelemetryLog.tableName).select('id', 'timestamp_ms', 'payload_json'), query.scope).orderBy('timestamp_ms', direction).orderBy('tenant_key', direction).orderBy('log_id', direction).limit(limit + 1);
    builder = cursorWhere(builder, 'timestamp_ms', 'log_id', decodeCursor(query.cursor, direction));
    const severity = query.severity?.toUpperCase() ?? ''; if (severity && severity !== 'ALL') builder = builder.where('severity', severity);
    const search = query.query?.trim().toLowerCase().slice(0, 256) ?? ''; if (search) builder = builder.whereRaw('LOWER(payload_json) LIKE ?', [`%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`]);
    const logs = (await builder).map((row) => parsePayload<LogRecord>(row));
    return pageItems(logs, limit, (item) => ({ time: item.timestampMs, id: pageId(tenantKey({ tenantId: item.tenantId }), item.id), direction }));
  }
  async listMetrics(query: MetricQuery = {}): Promise<Page<MetricSeries>> {
    await this.readPrune(); const limit = boundedLimit(query.limit); const direction = 'desc';
    let builder = scoped(this.db<SeriesRow>(TelemetryMetricSeries.tableName).select('id', 'series_id', 'payload_json'), query.scope).orderBy('latest_time_ms', direction).orderBy('tenant_key', direction).orderBy('series_id', direction).limit(limit + 1);
    builder = cursorWhere(builder, 'latest_time_ms', 'series_id', decodeCursor(query.cursor, direction));
    const search = query.query?.trim().toLowerCase().slice(0, 256) ?? ''; if (search) builder = builder.whereRaw('LOWER(payload_json) LIKE ?', [`%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`]);
    return pageItems((await builder).map((row) => parsePayload<MetricSeries>(row)), limit, (item) => ({ time: latestMetricTime(item), id: pageId(tenantKey({ tenantId: item.tenantId }), item.id), direction }));
  }
  async summary(scope?: TelemetryScope): Promise<TelemetrySummary> {
    await this.readPrune(); return this.db.transaction(async (trx) => {
      const revision = await readRevision(trx);
      const traces = await scoped(trx<TraceRow>(TelemetryTrace.tableName).select('payload_json', 'latency_sum_ms'), scope);
      const logs = await scoped(trx<LogRow>(TelemetryLog.tableName).select('payload_json', 'severity'), scope);
      const metrics = await scoped(trx<SeriesRow>(TelemetryMetricSeries.tableName).select('payload_json'), scope);
      const summaries = traces.map((row) => parsePayload<TraceSummary>(row)); const logRecords = logs.map((row) => parsePayload<LogRecord>(row)); const series = metrics.map((row) => parsePayload<MetricSeries>(row));
      const services = new Set<string>(); let lastEventMs = 0;
      for (const trace of summaries) { for (const service of trace.serviceNames) services.add(service); lastEventMs = Math.max(lastEventMs, trace.startedAt + trace.durationMs) }
      for (const log of logRecords) { services.add(log.serviceName); lastEventMs = Math.max(lastEventMs, log.timestampMs) }
      for (const metric of series) { services.add(metric.serviceName); lastEventMs = Math.max(lastEventMs, latestMetricTime(metric)) }
      const spanCount = summaries.reduce((sum, item) => sum + item.spanCount, 0);
      return { status: 'ok', revision, traceCount: summaries.length, spanCount, errorCount: summaries.reduce((sum, item) => sum + item.errorCount, 0), logCount: logs.length, errorLogCount: logs.filter((row) => row.severity === 'ERROR' || row.severity === 'FATAL').length, metricSeriesCount: metrics.length, inputTokens: summaries.reduce((sum, item) => sum + item.inputTokens, 0), outputTokens: summaries.reduce((sum, item) => sum + item.outputTokens, 0), totalTokens: summaries.reduce((sum, item) => sum + item.totalTokens, 0), costUsd: summaries.reduce((sum, item) => sum + item.costUsd, 0), avgLatencyMs: spanCount === 0 ? 0 : Math.round(traces.reduce((sum, item) => sum + Number(item.latency_sum_ms ?? 0), 0) / spanCount), services: [...services].sort(), ...(lastEventMs > 0 ? { lastEventAt: new Date(lastEventMs).toISOString() } : {}) };
    });
  }
  async pruneExpired(): Promise<number> {
    const result = await this.runWrite(async (trx) => { const revision = await readRevision(trx); const removed = await this.prune(trx); if (removed > 0) await this.writeRevision(trx, revision + 1); return removed });
    this.lastPruneAt = new Date(this.now()).toISOString(); this.lastPrunedRecords = result; return result;
  }
  async status(): Promise<ObservabilityStatus> {
    try {
      const [revision, pending] = await Promise.all([this.getRevision(), this.db(QoderCorrelation.tableName).whereIn('kind', ['prompt', 'tool', 'subagent']).count('* as count').first() as Promise<CountRow | undefined>]);
      return { configured: this.configured, storage: 'ok', correlation: 'ok', revision, pendingCorrelations: Number(pending?.count ?? 0), lastPrunedRecords: this.lastPrunedRecords, ...(this.lastPruneAt ? { lastPruneAt: this.lastPruneAt } : {}) };
    } catch { return { configured: this.configured, storage: 'unavailable', correlation: 'unavailable', revision: 0, lastPrunedRecords: 0, pendingCorrelations: 0 } }
  }
  async withQoderState(context: IngestContext, operation: (state: QoderStateRepository) => Promise<void>): Promise<void> {
    await this.runWrite(async (trx) => {
      const revision = await readRevision(trx); let changed = (await this.prune(trx)) > 0;
      const expired = await trx(QoderCorrelation.tableName).where('expires_at', '<=', this.now()).delete(); if (Number(expired) > 0) changed = true;
      const repository: QoderStateRepository = {
        get: async <T>(kind: string, key: string) => { const stateKey = `${tenantKey(context)}\u0000${kind}\u0000${key}`; const row = await trx<CorrelationRow>(QoderCorrelation.tableName).where({ state_key: stateKey }).first(); if (!row || row.expires_at <= this.now()) { if (row) { await trx(QoderCorrelation.tableName).where({ state_key: stateKey }).delete(); changed = true } return undefined } return { value: parsePayload<T>(row), expiresAt: row.expires_at } },
        set: async <T>(kind: string, key: string, value: T, expiresAt: number) => { const stateKey = `${tenantKey(context)}\u0000${kind}\u0000${key}`; const payload = JSON.stringify(value); if (serializedBytes(value) > MAX_RECORD_BYTES) throw new Error('Qoder correlation metadata exceeds size limit'); await trx(QoderCorrelation.tableName).insert({ state_key: stateKey, tenant_id: context.tenantId ?? null, kind, expires_at: Math.min(expiresAt, this.now() + this.correlationMaxAgeMs), payload_json: payload }).onConflict('state_key').merge(['expires_at', 'payload_json']); changed = true },
        delete: async (kind, key) => { const deleted = await trx(QoderCorrelation.tableName).where({ state_key: `${tenantKey(context)}\u0000${kind}\u0000${key}` }).delete(); if (Number(deleted) > 0) changed = true },
        count: async () => Number((await trx(QoderCorrelation.tableName).count('* as count').first() as CountRow | undefined)?.count ?? 0),
        ingestSpans: (input) => this.ingestSpansTrx(trx, input, context, revision),
        ingestLogs: (input) => this.ingestLogsTrx(trx, input, context, revision),
        ingestMetrics: (input) => this.ingestMetricsTrx(trx, input, context, revision),
      };
      await operation(repository);
      if (changed) await this.writeRevision(trx, revision + 1);
    });
  }
  async createCredential(input: { name: string; companyId?: number; userId?: number; expiresAt?: string }): Promise<{ credential: { id: string; name: string; companyId?: number; userId?: number; createdAt: string; expiresAt?: string }; token: string }> { throw new Error('Use SqlIngestCredentialRegistry') }
  async close(): Promise<void> { this.closing ??= this.closeDb ? this.db.destroy() : Promise.resolve(); await this.closing }
  private async runWrite<T>(operation: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (trx) => { await trx<StateRow>(TelemetryState.tableName).where({ key: REVISION_STATE_KEY }).update({ value: trx.ref('value') }); return operation(trx) });
  }
  private async writeRevision(trx: Knex.Transaction, revision: number): Promise<void> {
    const current = await readRevision(trx);
    if (revision > current) await trx<StateRow>(TelemetryState.tableName).where({ key: REVISION_STATE_KEY }).update({ value: revision });
  }
  private async readPrune(): Promise<void> { if (this.pruneOnRead) await this.pruneExpired() }
  private async prune(trx: Knex.Transaction): Promise<number> {
    const cutoff = this.now() - this.limits.retentionMs;
    const affected = await trx<{ trace_id: string; tenant_key: string }>(TelemetrySpan.tableName).where('start_time_ms', '<', cutoff).where('end_time_ms', '<', cutoff).distinct('trace_id', 'tenant_key');
    const deletedSpans = await trx(TelemetrySpan.tableName).where('start_time_ms', '<', cutoff).where('end_time_ms', '<', cutoff).delete();
    const deletedLogs = await trx(TelemetryLog.tableName).where('timestamp_ms', '<', cutoff).delete();
    for (const trace of affected) await updateProjection(trx, trace.trace_id, { tenantId: trace.tenant_key.startsWith('company:') ? Number(trace.tenant_key.slice(8)) : undefined });
    const affectedSeries = await trx<{ series_key: string }>(TelemetryMetricPoint.tableName).where('timestamp_ms', '<', cutoff).distinct('series_key');
    const deletedPoints = await trx(TelemetryMetricPoint.tableName).where('timestamp_ms', '<', cutoff).delete();
    let removed = Number(deletedSpans) + Number(deletedLogs) + Number(deletedPoints);
    for (const item of affectedSeries) {
      const [key, seriesId] = JSON.parse(item.series_key) as [string, string];
      const row = await trx<SeriesRow>(TelemetryMetricSeries.tableName).where('tenant_key', key).where('series_id', seriesId).first('id', 'payload_json'); if (!row) continue;
      const series = parsePayload<MetricSeries>(row); const points = series.points.filter((point) => point.timestampMs >= cutoff);
      if (points.length === 0) { await trx(TelemetryMetricSeries.tableName).where({ id: row.id }).delete(); removed += 1 }
      else if (points.length !== series.points.length) await trx(TelemetryMetricSeries.tableName).where({ id: row.id }).update({ latest_time_ms: latestMetricTime({ ...series, points }), payload_json: JSON.stringify({ ...series, points }) });
    }
    const expired = await trx(QoderCorrelation.tableName).where('expires_at', '<=', this.now()).delete(); removed += Number(expired);
    return removed;
  }
}

export class SqlIngestCredentialRegistry {
  private readonly db: Knex;
  private readonly now: () => number;
  constructor(db: Knex, now: () => number = Date.now) { this.db = db; this.now = now }
  async lookup(token: string): Promise<CredentialLookup | undefined> {
    const { createHash } = await import('node:crypto');
    const row = await this.db(IngestCredential.tableName).where({ token_hash: createHash('sha256').update(token).digest('hex') }).first();
    if (!row || (row.revoked_at !== null && row.revoked_at !== undefined) || (row.expires_at && Date.parse(row.expires_at) <= this.now())) return undefined;
    return { id: row.credential_id, ...(row.company_id ? { companyId: Number(row.company_id) } : {}), ...(row.user_id ? { userId: Number(row.user_id) } : {}) };
  }
  async create(input: { name: string; companyId?: number; userId?: number; expiresAt?: string }): Promise<{ credential: { id: string; name: string; companyId?: number; userId?: number; createdAt: string; expiresAt?: string }; token: string }> {
    const { createHash, randomBytes } = await import('node:crypto'); const token = `mwobs_${randomBytes(32).toString('base64url')}`; const id = randomUUID(); const createdAt = new Date(this.now()).toISOString();
    await this.db(IngestCredential.tableName).insert({ credential_id: id, name: input.name, token_hash: createHash('sha256').update(token).digest('hex'), company_id: input.companyId ?? null, user_id: input.userId ?? null, created_at: createdAt, expires_at: input.expiresAt ?? null, revoked_at: null });
    return { credential: { id, name: input.name, ...(input.companyId ? { companyId: input.companyId } : {}), ...(input.userId ? { userId: input.userId } : {}), createdAt, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) }, token };
  }
  async revoke(id: string): Promise<boolean> { const count = await this.db(IngestCredential.tableName).where({ credential_id: id }).whereNull('revoked_at').update({ revoked_at: new Date(this.now()).toISOString() }); return Number(count) > 0 }
  async list() { const rows = await this.db(IngestCredential.tableName).orderBy('created_at', 'desc'); return rows.map((row) => ({ id: row.credential_id, name: row.name, ...(row.company_id ? { companyId: Number(row.company_id) } : {}), ...(row.user_id ? { userId: Number(row.user_id) } : {}), createdAt: row.created_at, ...(row.expires_at ? { expiresAt: row.expires_at } : {}), ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}) })) }
}

import { randomUUID } from 'node:crypto';
