import {
  boundedLimit,
  latestMetricTime,
  mergeMetricPoints,
  prepareMetricSeries,
  resolveTelemetryOptions,
  serializedBytes,
  summarizeRecords,
  summarizeTrace,
  traceMatches,
  MAX_RECORD_BYTES,
} from './internal.js';
import { redactTelemetry } from './redaction.js';
import type {
  IngestResult,
  LogQuery,
  LogRecord,
  MetricQuery,
  MetricSeries,
  SpanRecord,
  TelemetryLimits,
  TelemetryStore,
  TelemetryStoreOptions,
  TelemetrySummary,
  TraceDetail,
  TraceQuery,
  TraceSummary,
} from './types.js';

function spanKey(span: SpanRecord): string {
  return `${span.traceId}\u0000${span.spanId}`;
}

export class MemoryTelemetryStore implements TelemetryStore {
  readonly limits: TelemetryLimits;
  private readonly now: () => number;
  private spans: SpanRecord[] = [];
  private logs: LogRecord[] = [];
  private readonly spanIds = new Set<string>();
  private readonly logIds = new Set<string>();
  private readonly metrics = new Map<string, MetricSeries>();
  private revisionValue = 0;

  constructor(options: TelemetryStoreOptions = {}) {
    const resolved = resolveTelemetryOptions(options);
    this.limits = resolved.limits;
    this.now = resolved.now;
  }

  async getRevision(): Promise<number> {
    return this.revisionValue;
  }

  async ingestSpans(input: readonly SpanRecord[]): Promise<IngestResult> {
    const prunedBefore = this.prune();
    let accepted = 0;
    let rejected = 0;
    let changed = 0;
    for (const span of input) {
      const key = spanKey(span);
      if (this.spanIds.has(key)) {
        accepted += 1;
        continue;
      }
      if (this.spans.length >= this.limits.maxSpans) {
        rejected += 1;
        continue;
      }
      const redacted = redactTelemetry(span);
      if (serializedBytes(redacted) > MAX_RECORD_BYTES) {
        rejected += 1;
        continue;
      }
      this.spans.push(redacted);
      this.spanIds.add(key);
      accepted += 1;
      changed += 1;
    }
    const prunedAfter = this.prune();
    if (changed > 0 || prunedBefore > 0 || prunedAfter > 0) this.revisionValue += 1;
    return { accepted, rejected };
  }

  async ingestLogs(input: readonly LogRecord[]): Promise<IngestResult> {
    const prunedBefore = this.prune();
    let accepted = 0;
    let rejected = 0;
    let changed = 0;
    for (const log of input) {
      if (this.logIds.has(log.id)) {
        accepted += 1;
        continue;
      }
      if (this.logs.length >= this.limits.maxLogs) {
        rejected += 1;
        continue;
      }
      const redacted = redactTelemetry(log);
      if (serializedBytes(redacted) > MAX_RECORD_BYTES) {
        rejected += 1;
        continue;
      }
      this.logs.push(redacted);
      this.logIds.add(log.id);
      accepted += 1;
      changed += 1;
    }
    const prunedAfter = this.prune();
    if (changed > 0 || prunedBefore > 0 || prunedAfter > 0) this.revisionValue += 1;
    return { accepted, rejected };
  }

  async ingestMetrics(input: readonly MetricSeries[]): Promise<IngestResult> {
    const prunedBefore = this.prune();
    let accepted = 0;
    let rejected = 0;
    let changed = 0;
    for (const incoming of input) {
      const prepared = prepareMetricSeries(incoming, this.limits.maxMetricPoints);
      rejected += prepared.rejected;
      if (!prepared.series) continue;

      const existing = this.metrics.get(prepared.series.id);
      if (existing) {
        const merged = mergeMetricPoints(
          existing.points,
          prepared.series.points,
          this.limits.maxMetricPoints
        );
        accepted += merged.accepted;
        rejected += merged.rejected;
        if (merged.changed > 0) {
          existing.points = merged.points;
          changed += merged.changed;
        }
      } else {
        if (this.metrics.size >= this.limits.maxMetricSeries) {
          const oldest = this.metrics.keys().next().value;
          if (oldest !== undefined) {
            rejected += this.metrics.get(oldest)?.points.length ?? 1;
            this.metrics.delete(oldest);
            changed += 1;
          }
        }
        const merged = mergeMetricPoints([], prepared.series.points, this.limits.maxMetricPoints);
        this.metrics.set(prepared.series.id, { ...prepared.series, points: merged.points });
        accepted += prepared.accepted;
        rejected += merged.rejected;
        changed += 1;
      }
    }
    const prunedAfter = this.prune();
    if (changed > 0 || prunedBefore > 0 || prunedAfter > 0) this.revisionValue += 1;
    return { accepted, rejected };
  }

  async listTraces(query: TraceQuery = {}): Promise<TraceSummary[]> {
    const limit = boundedLimit(query.limit);
    const search = query.query?.trim().toLowerCase().slice(0, 256) ?? '';
    const status = query.status?.toLowerCase() ?? 'all';
    const traces = new Map<string, SpanRecord[]>();

    for (const span of this.spans) {
      const group = traces.get(span.traceId);
      if (group) group.push(span);
      else traces.set(span.traceId, [span]);
    }

    const summaries: TraceSummary[] = [];
    for (const [traceId, spans] of traces) {
      const summary = summarizeTrace(traceId, spans);
      if (status === 'error' && summary.errorCount === 0) continue;
      if (status === 'ok' && summary.errorCount > 0) continue;
      if (search && !traceMatches(summary, search)) continue;
      summaries.push(summary);
    }
    return summaries.sort((left, right) => right.startedAt - left.startedAt).slice(0, limit);
  }

  async getTrace(traceId: string): Promise<TraceDetail | undefined> {
    const spans = this.spans
      .filter((span) => span.traceId === traceId)
      .sort(
        (left, right) =>
          left.startTimeMs - right.startTimeMs || left.spanId.localeCompare(right.spanId)
      );
    if (spans.length === 0) return undefined;
    return {
      summary: summarizeTrace(traceId, spans),
      spans,
      logs: this.logs
        .filter((log) => log.traceId === traceId)
        .sort((left, right) => left.timestampMs - right.timestampMs),
    };
  }

  async listLogs(query: LogQuery = {}): Promise<LogRecord[]> {
    const limit = boundedLimit(query.limit);
    const search = query.query?.trim().toLowerCase().slice(0, 256) ?? '';
    const severity = query.severity?.toUpperCase() ?? '';
    return this.logs
      .filter((log) => {
        if (severity && severity !== 'ALL' && log.severity !== severity) return false;
        if (!search) return true;
        return `${log.body} ${log.serviceName} ${log.agentName ?? ''} ${JSON.stringify(log.attributes)}`
          .toLowerCase()
          .includes(search);
      })
      .sort((left, right) => right.timestampMs - left.timestampMs)
      .slice(0, limit);
  }

  async listMetrics(query: MetricQuery = {}): Promise<MetricSeries[]> {
    const limit = boundedLimit(query.limit);
    const search = query.query?.trim().toLowerCase().slice(0, 256) ?? '';
    return [...this.metrics.values()]
      .filter((series) => {
        if (!search) return true;
        return `${series.name} ${series.serviceName} ${series.unit ?? ''} ${series.description ?? ''}`
          .toLowerCase()
          .includes(search);
      })
      .sort((left, right) => latestMetricTime(right) - latestMetricTime(left))
      .slice(0, limit)
      .map((series) => ({ ...series, points: [...series.points] }));
  }

  async summary(): Promise<TelemetrySummary> {
    return summarizeRecords(this.spans, this.logs, [...this.metrics.values()], this.revisionValue);
  }

  async pruneExpired(): Promise<number> {
    const removed = this.prune();
    if (removed > 0) this.revisionValue += 1;
    return removed;
  }

  async close(): Promise<void> {}

  private prune(): number {
    const cutoff = this.now() - this.limits.retentionMs;
    const spans = this.spans.filter((span) => Math.max(span.startTimeMs, span.endTimeMs) >= cutoff);
    const logs = this.logs.filter((log) => log.timestampMs >= cutoff);
    let removed = this.spans.length - spans.length + (this.logs.length - logs.length);
    this.spans = spans;
    this.logs = logs;
    this.spanIds.clear();
    for (const span of this.spans) this.spanIds.add(spanKey(span));
    this.logIds.clear();
    for (const log of this.logs) this.logIds.add(log.id);
    for (const [id, series] of this.metrics) {
      const points = series.points.filter((point) => point.timestampMs >= cutoff);
      removed += series.points.length - points.length;
      series.points = points;
      if (series.points.length === 0) this.metrics.delete(id);
    }
    return removed;
  }
}
