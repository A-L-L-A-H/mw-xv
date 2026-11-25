import { boundedLimit, latestMetricTime, mergeMetricPoints, prepareMetricSeries, resolveTelemetryOptions, serializedBytes, summarizeRecords, summarizeTrace, MAX_RECORD_BYTES } from './internal.js';
import { decodeCursor, pageItems } from './pagination.js';
import { redactTelemetry } from './redaction.js';
import type { IngestContext, IngestResult, LogQuery, LogRecord, MetricQuery, MetricSeries, QoderStateRepository, SpanRecord, TelemetryLimits, TelemetryScope, TelemetryStore, TelemetryStoreOptions, TelemetrySummary, TraceDetail, TraceQuery, TraceSummary } from './types.js';
function tenantId(record: { tenantId?: number }): number | undefined { return record.tenantId }
function tenantKey(record: { tenantId?: number }): string { return record.tenantId ? `company:${record.tenantId}` : 'global'; }
function pageId(record: { tenantId?: number }, id: string): string { return `${tenantKey(record)}\u0000${id}`; }
function visible<T extends { tenantId?: number }>(item: T, scope?: TelemetryScope): boolean { return !scope || scope.global || (scope.tenantId !== undefined && item.tenantId === scope.tenantId) }
function after<T>(items: T[], cursor: string | undefined, direction: 'asc' | 'desc', time: (item: T) => number, id: (item: T) => string): T[] {
  const position = decodeCursor(cursor, direction); if (!position) return items;
  const comparison = direction === 'asc' ? 1 : -1;
  return items.filter((item) => comparison * (time(item) - position.time) > 0 || (time(item) === position.time && comparison * id(item).localeCompare(position.id) > 0));
}
export class MemoryTelemetryStore implements TelemetryStore {
  readonly limits: TelemetryLimits;
  private readonly now: () => number;
  private spans: SpanRecord[] = []; private logs: LogRecord[] = []; private readonly metrics = new Map<string, MetricSeries>();
  private readonly correlation = new Map<string, { value: unknown; expiresAt: number }>(); private revisionValue = 0;
  private queue: Promise<void> = Promise.resolve();
  constructor(options: TelemetryStoreOptions = {}) { const resolved = resolveTelemetryOptions(options); this.limits = resolved.limits; this.now = resolved.now }
  async getRevision() { return this.revisionValue }
  async ingestSpans(input: readonly SpanRecord[], context: IngestContext = {}): Promise<IngestResult> {
    let changed = this.prune() > 0; let accepted = 0; let rejected = 0;
    for (const incoming of input) {
      const span = redactTelemetry({ ...incoming, ...(context.tenantId ? { tenantId: context.tenantId } : { tenantId: undefined }) });
      if (this.spans.some((item) => item.traceId === span.traceId && item.spanId === span.spanId && tenantId(item) === tenantId(span))) { accepted += 1; continue }
      if (this.spans.length >= this.limits.maxSpans || serializedBytes(span) > MAX_RECORD_BYTES) { rejected += 1; continue }
      this.spans.push(span); accepted += 1; changed = true;
    }
    if (this.prune() > 0) changed = true;
    if (changed) this.revisionValue += 1; return { accepted, rejected };
  }
  async ingestLogs(input: readonly LogRecord[], context: IngestContext = {}): Promise<IngestResult> {
    let changed = this.prune() > 0; let accepted = 0; let rejected = 0;
    for (const incoming of input) {
      const log = redactTelemetry({ ...incoming, ...(context.tenantId ? { tenantId: context.tenantId } : { tenantId: undefined }) });
      if (this.logs.some((item) => item.id === log.id && tenantId(item) === tenantId(log))) { accepted += 1; continue }
      if (this.logs.length >= this.limits.maxLogs || serializedBytes(log) > MAX_RECORD_BYTES) { rejected += 1; continue }
      this.logs.push(log); accepted += 1; changed = true;
    }
    if (this.prune() > 0) changed = true;
    if (changed) this.revisionValue += 1; return { accepted, rejected };
  }
  async ingestMetrics(input: readonly MetricSeries[], context: IngestContext = {}): Promise<IngestResult> {
    let changed = this.prune() > 0; let accepted = 0; let rejected = 0;
    for (const incoming of input) {
      const prepared = prepareMetricSeries({ ...incoming, ...(context.tenantId ? { tenantId: context.tenantId } : {}) }, this.limits.maxMetricPoints); rejected += prepared.rejected; if (!prepared.series) continue;
      const series = prepared.series; const key = `${tenantId(series) ?? 'global'}\u0000${series.id}`; const existing = this.metrics.get(key);
      if (existing) { const merged = mergeMetricPoints(existing.points, series.points, this.limits.maxMetricPoints); accepted += merged.accepted; rejected += merged.rejected; if (merged.changed > 0) { existing.points = merged.points; changed = true } continue }
      if ([...this.metrics.values()].filter((item) => tenantId(item) === tenantId(series)).length >= this.limits.maxMetricSeries) {
        const oldest = [...this.metrics.entries()].find(([, item]) => tenantId(item) === tenantId(series)); if (oldest) { rejected += oldest[1].points.length; this.metrics.delete(oldest[0]); changed = true }
      }
      this.metrics.set(key, { ...series, points: series.points.slice(-this.limits.maxMetricPoints) }); accepted += prepared.accepted; changed = true;
    }
    if (this.prune() > 0) changed = true;
    if (changed) this.revisionValue += 1; return { accepted, rejected };
  }
  async listTraces(query: TraceQuery = {}) {
    this.prune(); const groups = new Map<string, SpanRecord[]>();
    for (const span of this.spans.filter((item) => visible(item, query.scope))) { const key = `${tenantId(span) ?? 'global'}\u0000${span.traceId}`; const group = groups.get(key) ?? []; group.push(span); groups.set(key, group) }
    const summaries = [...groups.values()].map((spans) => summarizeTrace(spans[0]!.traceId, spans)).filter((item) => (query.status !== 'error' || item.errorCount > 0) && (query.status !== 'ok' || item.errorCount === 0) && (!query.query?.trim() || JSON.stringify(item).toLowerCase().includes(query.query.trim().toLowerCase()))).sort((a, b) => b.startedAt - a.startedAt || tenantKey(b).localeCompare(tenantKey(a)) || b.traceId.localeCompare(a.traceId));
    const paged = after(summaries, query.cursor, 'desc', (item) => item.startedAt, (item) => pageId(item, item.traceId)); return pageItems(paged, boundedLimit(query.limit), (item) => ({ time: item.startedAt, id: pageId(item, item.traceId), direction: 'desc' }));
  }
  async getTrace(traceId: string, options: { scope?: TelemetryScope; spanCursor?: string; logCursor?: string; spanLimit?: number; logLimit?: number } = {}): Promise<TraceDetail | undefined> {
    this.prune(); const allSpans = this.spans.filter((span) => span.traceId === traceId && visible(span, options.scope)).sort((a, b) => a.startTimeMs - b.startTimeMs || tenantKey(a).localeCompare(tenantKey(b)) || a.spanId.localeCompare(b.spanId)); if (allSpans.length === 0) return undefined;
    const spans = after(allSpans, options.spanCursor, 'asc', (item) => item.startTimeMs, (item) => pageId(item, item.spanId)); const allLogs = this.logs.filter((log) => log.traceId === traceId && visible(log, options.scope)).sort((a, b) => a.timestampMs - b.timestampMs || tenantKey(a).localeCompare(tenantKey(b)) || a.id.localeCompare(b.id)); const logs = after(allLogs, options.logCursor, 'asc', (item) => item.timestampMs, (item) => pageId(item, item.id));
    return { summary: summarizeTrace(traceId, allSpans), spans: pageItems(spans, boundedLimit(options.spanLimit, 500), (item) => ({ time: item.startTimeMs, id: pageId(item, item.spanId), direction: 'asc' })), logs: pageItems(logs, boundedLimit(options.logLimit, 500), (item) => ({ time: item.timestampMs, id: pageId(item, item.id), direction: 'asc' })) };
  }
  async listLogs(query: LogQuery = {}) {
    this.prune(); const severity = query.severity?.toUpperCase() ?? ''; const items = this.logs.filter((log) => visible(log, query.scope) && (!severity || severity === 'ALL' || log.severity === severity) && (!query.query || JSON.stringify(log).toLowerCase().includes(query.query.toLowerCase()))).sort((a, b) => b.timestampMs - a.timestampMs || tenantKey(b).localeCompare(tenantKey(a)) || b.id.localeCompare(a.id)); const paged = after(items, query.cursor, 'desc', (item) => item.timestampMs, (item) => pageId(item, item.id)); return pageItems(paged, boundedLimit(query.limit), (item) => ({ time: item.timestampMs, id: pageId(item, item.id), direction: 'desc' }));
  }
  async listMetrics(query: MetricQuery = {}) {
    this.prune(); const items = [...this.metrics.values()].filter((item) => visible(item, query.scope) && (!query.query?.trim() || JSON.stringify(item).toLowerCase().includes(query.query.trim().toLowerCase()))).sort((a, b) => latestMetricTime(b) - latestMetricTime(a) || tenantKey(b).localeCompare(tenantKey(a)) || b.id.localeCompare(a.id)); const paged = after(items, query.cursor, 'desc', latestMetricTime, (item) => pageId(item, item.id)); return pageItems(paged, boundedLimit(query.limit), (item) => ({ time: latestMetricTime(item), id: pageId(item, item.id), direction: 'desc' }));
  }
  async summary(scope?: TelemetryScope) { this.prune(); return summarizeRecords(this.spans.filter((item) => visible(item, scope)), this.logs.filter((item) => visible(item, scope)), [...this.metrics.values()].filter((item) => visible(item, scope)), this.revisionValue) }
  async pruneExpired() { const removed = this.prune(); if (removed > 0) this.revisionValue += 1; return removed }
  withQoderState(context: IngestContext, operation: (state: QoderStateRepository) => Promise<void>): Promise<void> {
    const handled = this.queue.then(() => this.applyQoderState(context, operation));
    this.queue = handled.then(() => undefined, () => undefined);
    return handled;
  }
  private async applyQoderState(context: IngestContext, operation: (state: QoderStateRepository) => Promise<void>): Promise<void> {
    const key = (kind: string, id: string) => `${context.tenantId ?? 'global'}\u0000${kind}\u0000${id}`; const now = this.now();
    for (const [stateKey, item] of this.correlation) if (item.expiresAt <= now) this.correlation.delete(stateKey);
    const state: QoderStateRepository = {
      get: async <T>(kind: string, id: string) => { const item = this.correlation.get(key(kind, id)); return item && item.expiresAt > now ? { value: item.value as T, expiresAt: item.expiresAt } : undefined },
      set: async <T>(kind: string, id: string, value: T, expiresAt: number) => { this.correlation.set(key(kind, id), { value, expiresAt }); this.revisionValue += 1 },
      delete: async (kind: string, id: string) => { if (this.correlation.delete(key(kind, id))) this.revisionValue += 1 },
      count: async () => this.correlation.size,
      ingestSpans: (input) => this.ingestSpans(input, context), ingestLogs: (input) => this.ingestLogs(input, context), ingestMetrics: (input) => this.ingestMetrics(input, context),
    };
    await operation(state);
  }
  async close() {}
  private prune(): number {
    const cutoff = this.now() - this.limits.retentionMs; const spans = this.spans.filter((span) => Math.max(span.startTimeMs, span.endTimeMs) >= cutoff); const logs = this.logs.filter((log) => log.timestampMs >= cutoff); let removed = this.spans.length - spans.length + this.logs.length - logs.length; this.spans = spans; this.logs = logs;
    for (const [id, series] of this.metrics) { const points = series.points.filter((point) => point.timestampMs >= cutoff); removed += series.points.length - points.length; if (points.length === 0) this.metrics.delete(id); else series.points = points }
    return removed;
  }
}
