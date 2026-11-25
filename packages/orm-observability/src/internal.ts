import { Buffer } from 'node:buffer';
import { redactTelemetry } from './redaction.js';
import type {
  LogRecord,
  MetricPoint,
  MetricSeries,
  SpanRecord,
  TelemetryLimits,
  TelemetryStoreOptions,
  TelemetrySummary,
  TraceSummary,
} from './types.js';

export const MAX_RECORD_BYTES = 32 * 1024;
export const MAX_METRIC_SERIES_BYTES = 256 * 1024;

export interface ResolvedTelemetryOptions {
  limits: TelemetryLimits;
  now: () => number;
}

export interface PreparedMetricSeries {
  series?: MetricSeries;
  accepted: number;
  rejected: number;
}

export interface MergedMetricPoints {
  points: MetricPoint[];
  accepted: number;
  rejected: number;
  changed: number;
}

export function positiveOption(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function boundedLimit(value: number | undefined, fallback = 100, maximum = 500): number {
  return Math.min(positiveOption(value, fallback), maximum);
}

export function serializedBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? Number.POSITIVE_INFINITY : Buffer.byteLength(serialized);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function resolveTelemetryOptions(
  options: TelemetryStoreOptions = {}
): ResolvedTelemetryOptions {
  return {
    limits: {
      maxSpans: positiveOption(options.maxSpans, 5_000),
      maxLogs: positiveOption(options.maxLogs, 5_000),
      maxMetricSeries: positiveOption(options.maxMetricSeries, 1_000),
      maxMetricPoints: positiveOption(options.maxMetricPoints, 120),
      retentionMs: positiveOption(options.retentionMs, 3_600_000),
    },
    now: options.now ?? Date.now,
  };
}

export function latestMetricTime(series: MetricSeries): number {
  return series.points.at(-1)?.timestampMs ?? 0;
}

export function prepareMetricSeries(
  incoming: MetricSeries,
  maxMetricPoints: number
): PreparedMetricSeries {
  const retained = incoming.points.slice(-maxMetricPoints);
  let rejected = incoming.points.length - retained.length;
  const redacted = redactTelemetry({ ...incoming, points: retained });
  const points = redacted.points.filter((point) => {
    if (serializedBytes(point) <= MAX_RECORD_BYTES) return true;
    rejected += 1;
    return false;
  });
  if (points.length === 0) return { accepted: 0, rejected };

  const series = { ...redacted, points };
  if (serializedBytes(series) > MAX_METRIC_SERIES_BYTES) {
    return { accepted: 0, rejected: rejected + points.length };
  }
  return { series, accepted: points.length, rejected };
}

function samePoint(left: MetricPoint, right: MetricPoint): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function mergeMetricPoints(
  existing: readonly MetricPoint[],
  incoming: readonly MetricPoint[],
  maxMetricPoints: number
): MergedMetricPoints {
  const points = existing.map((point) => ({ ...point }));
  let accepted = 0;
  let changed = 0;

  for (const point of incoming) {
    const index = points.findIndex((item) => item.timestampMs === point.timestampMs);
    if (index >= 0) {
      if (!samePoint(points[index]!, point)) {
        points[index] = point;
        changed += 1;
      }
    } else {
      points.push(point);
      changed += 1;
    }
    accepted += 1;
  }

  points.sort((left, right) => left.timestampMs - right.timestampMs);
  let rejected = 0;
  if (points.length > maxMetricPoints) {
    rejected = points.length - maxMetricPoints;
    points.splice(0, rejected);
    changed += rejected;
  }
  return { points, accepted, rejected, changed };
}

export function summarizeTrace(traceId: string, spans: readonly SpanRecord[]): TraceSummary {
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
    ...(firstSpan?.tenantId ? { tenantId: firstSpan.tenantId } : {}),
  };
}

export function traceMatches(summary: TraceSummary, search: string): boolean {
  return `${summary.rootName} ${summary.traceId} ${summary.runId} ${summary.agentName ?? ''} ${summary.serviceNames.join(' ')}`
    .toLowerCase()
    .includes(search);
}

export function summarizeRecords(
  spans: readonly SpanRecord[],
  logs: readonly LogRecord[],
  metrics: readonly MetricSeries[],
  revision: number
): TelemetrySummary {
  const traces = new Set(spans.map((span) => `${span.tenantId ?? 'global'}\u0000${span.traceId}`));
  const services = new Set<string>();
  let errorCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let latencySum = 0;
  let lastEventMs = 0;

  for (const span of spans) {
    services.add(span.serviceName);
    if (span.status === 'error') errorCount += 1;
    inputTokens += span.inputTokens ?? 0;
    outputTokens += span.outputTokens ?? 0;
    totalTokens += span.totalTokens ?? 0;
    costUsd += span.costUsd ?? 0;
    latencySum += span.durationMs;
    lastEventMs = Math.max(lastEventMs, span.endTimeMs);
  }
  for (const log of logs) {
    services.add(log.serviceName);
    lastEventMs = Math.max(lastEventMs, log.timestampMs);
  }
  for (const series of metrics) {
    services.add(series.serviceName);
    lastEventMs = Math.max(lastEventMs, latestMetricTime(series));
  }

  return {
    status: 'ok',
    revision,
    traceCount: traces.size,
    spanCount: spans.length,
    errorCount,
    logCount: logs.length,
    errorLogCount: logs.filter((log) => log.severity === 'ERROR' || log.severity === 'FATAL')
      .length,
    metricSeriesCount: metrics.length,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    avgLatencyMs: spans.length > 0 ? Math.round(latencySum / spans.length) : 0,
    services: [...services].sort(),
    ...(lastEventMs > 0 ? { lastEventAt: new Date(lastEventMs).toISOString() } : {}),
  };
}
