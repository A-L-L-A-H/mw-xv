import { Buffer } from 'node:buffer';
import { redactTelemetry } from './redaction.js';
import type { IngestResult, LogRecord, MetricSeries, SpanRecord, TraceSummary } from './types.js';

const MAX_RECORD_BYTES = 32 * 1024;
const MAX_METRIC_SERIES_BYTES = 256 * 1024;

export interface TelemetryStoreOptions {
  maxSpans?: number;
  maxLogs?: number;
  maxMetricSeries?: number;
  maxMetricPoints?: number;
  retentionMs?: number;
  now?: () => number;
}

export interface TraceQuery {
  limit?: number;
  query?: string;
  status?: string;
}

export interface LogQuery {
  limit?: number;
  query?: string;
  severity?: string;
}

export interface MetricQuery {
  limit?: number;
  query?: string;
}

function positiveOption(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function boundedLimit(value: number | undefined, fallback = 100, maximum = 500): number {
  return positiveOption(value, fallback) > maximum ? maximum : positiveOption(value, fallback);
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function spanKey(span: SpanRecord): string {
  return `${span.traceId}\u0000${span.spanId}`;
}

function latestMetricTime(series: MetricSeries): number {
  return series.points.at(-1)?.timestampMs ?? 0;
}

export class TelemetryStore {
  private readonly maxSpans: number;
  private readonly maxLogs: number;
  private readonly maxMetricSeries: number;
  private readonly maxMetricPoints: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private spans: SpanRecord[] = [];
  private logs: LogRecord[] = [];
  private readonly spanIds = new Set<string>();
  private readonly logIds = new Set<string>();
  private readonly metrics = new Map<string, MetricSeries>();
  private revisionValue = 0;

  constructor(options: TelemetryStoreOptions = {}) {
    this.maxSpans = positiveOption(options.maxSpans, 5_000);
    this.maxLogs = positiveOption(options.maxLogs, 5_000);
    this.maxMetricSeries = positiveOption(options.maxMetricSeries, 1_000);
    this.maxMetricPoints = positiveOption(options.maxMetricPoints, 120);
    this.retentionMs = positiveOption(options.retentionMs, 3_600_000);
    this.now = options.now ?? Date.now;
  }

  get revision(): number {
    return this.revisionValue;
  }

  get limits(): {
    maxSpans: number;
    maxLogs: number;
    maxMetricSeries: number;
    maxMetricPoints: number;
    retentionMs: number;
  } {
    return {
      maxSpans: this.maxSpans,
      maxLogs: this.maxLogs,
      maxMetricSeries: this.maxMetricSeries,
      maxMetricPoints: this.maxMetricPoints,
      retentionMs: this.retentionMs,
    };
  }

  ingestSpans(input: readonly SpanRecord[]): IngestResult {
    this.prune();
    let accepted = 0;
    let rejected = 0;
    let changed = 0;
    for (const span of input) {
      const key = spanKey(span);
      if (this.spanIds.has(key)) {
        accepted += 1;
        continue;
      }
      if (this.spans.length >= this.maxSpans) {
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
    this.prune();
    this.bump(changed);
    return { accepted, rejected };
  }

  ingestLogs(input: readonly LogRecord[]): IngestResult {
    this.prune();
    let accepted = 0;
    let rejected = 0;
    let changed = 0;
    for (const log of input) {
      if (this.logIds.has(log.id)) {
        accepted += 1;
        continue;
      }
      if (this.logs.length >= this.maxLogs) {
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
    this.prune();
    this.bump(changed);
    return { accepted, rejected };
  }

  ingestMetrics(input: readonly MetricSeries[]): IngestResult {
    this.prune();
    let accepted = 0;
    let rejected = 0;
    let changed = 0;
    for (const incoming of input) {
      const retained = incoming.points.slice(-this.maxMetricPoints);
      rejected += incoming.points.length - retained.length;
      const redacted = redactTelemetry({ ...incoming, points: retained });
      const points = redacted.points.filter((point) => {
        if (serializedBytes(point) <= MAX_RECORD_BYTES) return true;
        rejected += 1;
        return false;
      });
      if (points.length === 0) continue;
      const series = { ...redacted, points };
      if (serializedBytes(series) > MAX_METRIC_SERIES_BYTES) {
        rejected += points.length;
        continue;
      }

      const existing = this.metrics.get(series.id);
      if (existing) {
        for (const point of series.points) {
          const index = existing.points.findIndex((item) => item.timestampMs === point.timestampMs);
          if (index >= 0) existing.points[index] = point;
          else existing.points.push(point);
          accepted += 1;
          changed += 1;
        }
        existing.points.sort((left, right) => left.timestampMs - right.timestampMs);
        if (existing.points.length > this.maxMetricPoints) {
          const overflow = existing.points.length - this.maxMetricPoints;
          existing.points.splice(0, overflow);
          rejected += overflow;
        }
      } else {
        if (this.metrics.size >= this.maxMetricSeries) {
          const oldest = this.metrics.keys().next().value;
          if (oldest !== undefined) {
            rejected += this.metrics.get(oldest)?.points.length ?? 1;
            this.metrics.delete(oldest);
          }
        }
        this.metrics.set(series.id, series);
        accepted += series.points.length;
        changed += 1;
      }
    }
    this.prune();
    this.bump(changed);
    return { accepted, rejected };
  }

  listTraces(query: TraceQuery = {}): TraceSummary[] {
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
      const summary = this.summarizeTrace(traceId, spans);
      if (status === 'error' && summary.errorCount === 0) continue;
      if (status === 'ok' && summary.errorCount > 0) continue;
      if (search && !this.traceMatches(summary, search)) continue;
      summaries.push(summary);
    }

    return summaries.sort((left, right) => right.startedAt - left.startedAt).slice(0, limit);
  }

  getTrace(
    traceId: string
  ): { summary: TraceSummary; spans: SpanRecord[]; logs: LogRecord[] } | undefined {
    const spans = this.spans
      .filter((span) => span.traceId === traceId)
      .sort(
        (left, right) =>
          left.startTimeMs - right.startTimeMs || left.spanId.localeCompare(right.spanId)
      );
    if (spans.length === 0) return undefined;
    return {
      summary: this.summarizeTrace(traceId, spans),
      spans,
      logs: this.logs
        .filter((log) => log.traceId === traceId)
        .sort((left, right) => left.timestampMs - right.timestampMs),
    };
  }

  listLogs(query: LogQuery = {}): LogRecord[] {
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

  listMetrics(query: MetricQuery = {}): MetricSeries[] {
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

  summary(): {
    status: 'ok';
    revision: number;
    traceCount: number;
    spanCount: number;
    errorCount: number;
    logCount: number;
    errorLogCount: number;
    metricSeriesCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    avgLatencyMs: number;
    services: string[];
    lastEventAt?: string;
  } {
    const traces = new Set(this.spans.map((span) => span.traceId));
    const services = new Set<string>();
    let errorCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let costUsd = 0;
    let latencySum = 0;
    let lastEventMs = 0;

    for (const span of this.spans) {
      services.add(span.serviceName);
      if (span.status === 'error') errorCount += 1;
      inputTokens += span.inputTokens ?? 0;
      outputTokens += span.outputTokens ?? 0;
      totalTokens += span.totalTokens ?? 0;
      costUsd += span.costUsd ?? 0;
      latencySum += span.durationMs;
      lastEventMs = Math.max(lastEventMs, span.endTimeMs);
    }
    for (const log of this.logs) {
      services.add(log.serviceName);
      lastEventMs = Math.max(lastEventMs, log.timestampMs);
    }
    for (const series of this.metrics.values()) {
      services.add(series.serviceName);
      lastEventMs = Math.max(lastEventMs, latestMetricTime(series));
    }

    return {
      status: 'ok',
      revision: this.revisionValue,
      traceCount: traces.size,
      spanCount: this.spans.length,
      errorCount,
      logCount: this.logs.length,
      errorLogCount: this.logs.filter((log) => log.severity === 'ERROR' || log.severity === 'FATAL')
        .length,
      metricSeriesCount: this.metrics.size,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      avgLatencyMs: this.spans.length > 0 ? Math.round(latencySum / this.spans.length) : 0,
      services: [...services].sort(),
      ...(lastEventMs > 0 ? { lastEventAt: new Date(lastEventMs).toISOString() } : {}),
    };
  }

  private summarizeTrace(traceId: string, spans: SpanRecord[]): TraceSummary {
    const startedAt = Math.min(...spans.map((span) => span.startTimeMs));
    const endedAt = Math.max(...spans.map((span) => span.endTimeMs));
    const roots = spans.filter((span) => !span.parentSpanId);
    const firstSpan = spans[0];
    const firstRoot = roots[0] ?? firstSpan;
    const errorCount = spans.filter((span) => span.status === 'error').length;
    return {
      traceId,
      rootName: firstRoot?.name ?? 'unnamed trace',
      startedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      spanCount: spans.length,
      errorCount,
      serviceNames: [...new Set(spans.map((span) => span.serviceName))].sort(),
      runId: firstSpan?.runId ?? traceId,
      agentName: spans.find((span) => span.agentName)?.agentName,
      inputTokens: spans.reduce((total, span) => total + (span.inputTokens ?? 0), 0),
      outputTokens: spans.reduce((total, span) => total + (span.outputTokens ?? 0), 0),
      totalTokens: spans.reduce((total, span) => total + (span.totalTokens ?? 0), 0),
      costUsd: spans.reduce((total, span) => total + (span.costUsd ?? 0), 0),
    };
  }

  private traceMatches(summary: TraceSummary, search: string): boolean {
    return `${summary.rootName} ${summary.traceId} ${summary.runId} ${summary.agentName ?? ''} ${summary.serviceNames.join(' ')}`
      .toLowerCase()
      .includes(search);
  }

  private prune(): void {
    const cutoff = this.now() - this.retentionMs;
    this.spans = this.spans.filter((span) => Math.max(span.startTimeMs, span.endTimeMs) >= cutoff);
    this.logs = this.logs.filter((log) => log.timestampMs >= cutoff);
    this.spanIds.clear();
    for (const span of this.spans) this.spanIds.add(spanKey(span));
    this.logIds.clear();
    for (const log of this.logs) this.logIds.add(log.id);
    for (const [id, series] of this.metrics) {
      series.points = series.points.filter((point) => point.timestampMs >= cutoff);
      if (series.points.length === 0) this.metrics.delete(id);
    }
  }

  private bump(accepted: number): void {
    if (accepted > 0) this.revisionValue += 1;
  }
}
