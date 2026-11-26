'use client';

import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

export const TELEMETRY_DEFAULT_LIMIT = 100;
export const TELEMETRY_MAX_LIMIT = 500;
export const TELEMETRY_MAX_QUERY_LENGTH = 256;
export const TELEMETRY_MAX_TRACE_ID_LENGTH = 128;

export type TelemetrySpanStatus = 'ok' | 'error' | 'unset';
export type TelemetrySpanKind =
  'internal' | 'server' | 'client' | 'producer' | 'consumer' | 'unspecified';
export type TelemetryLogSeverity =
  'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'UNSPECIFIED';
export type TelemetryMetricType =
  'gauge' | 'sum' | 'histogram' | 'exponential_histogram' | 'summary';
export type TelemetryTraceStatus = 'all' | 'error' | 'ok';
export type TelemetryLogSeverityFilter = TelemetryLogSeverity | 'ALL';

export interface TelemetrySpanEventDto {
  readonly name: string;
  readonly timestampMs: number;
  readonly attributes: Record<string, unknown>;
}

/** Mirrors the redacted SpanRecord returned by the observability SQL store. */
export interface TelemetrySpanDto {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly serviceName: string;
  readonly scopeName?: string;
  readonly kind: TelemetrySpanKind;
  readonly status: TelemetrySpanStatus;
  readonly statusMessage?: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly durationMs: number;
  readonly runId: string;
  readonly agentName?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly toolName?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
  readonly attributes: Record<string, unknown>;
  readonly resourceAttributes: Record<string, unknown>;
  readonly events: TelemetrySpanEventDto[];
}

/** Mirrors LogRecord. The Board intentionally does not render body or attributes. */
export interface TelemetryLogDto {
  readonly id: string;
  readonly timestampMs: number;
  readonly serviceName: string;
  readonly scopeName?: string;
  readonly severity: TelemetryLogSeverity;
  readonly severityText?: string;
  readonly body: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly runId?: string;
  readonly agentName?: string;
  readonly attributes: Record<string, unknown>;
  readonly resourceAttributes: Record<string, unknown>;
}

export interface TelemetryMetricPointDto {
  readonly timestampMs: number;
  readonly value?: number;
  readonly count?: number;
  readonly sum?: number;
  readonly min?: number;
  readonly max?: number;
  readonly attributes: Record<string, unknown>;
}

export interface TelemetryMetricSeriesDto {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly unit?: string;
  readonly type: TelemetryMetricType;
  readonly serviceName: string;
  readonly scopeName?: string;
  readonly points: TelemetryMetricPointDto[];
}

export interface TelemetryTraceSummaryDto {
  readonly traceId: string;
  readonly rootName: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly spanCount: number;
  readonly errorCount: number;
  readonly serviceNames: string[];
  readonly runId: string;
  readonly agentName?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

export interface TelemetryTraceDetailDto {
  readonly summary: TelemetryTraceSummaryDto;
  readonly spans: TelemetrySpanDto[];
  readonly logs: TelemetryLogDto[];
  readonly spanNextCursor?: string | null;
  readonly logNextCursor?: string | null;
}

export interface TelemetrySummaryDto {
  readonly status: 'ok';
  readonly revision: number;
  readonly traceCount: number;
  readonly spanCount: number;
  readonly errorCount: number;
  readonly logCount: number;
  readonly errorLogCount: number;
  readonly metricSeriesCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly avgLatencyMs: number;
  readonly services: string[];
  readonly lastEventAt?: string;
}

export interface TelemetryLimitsDto {
  readonly maxSpans: number;
  readonly maxLogs: number;
  readonly maxMetricSeries: number;
  readonly maxMetricPoints: number;
  readonly retentionMs: number;
}

export type TelemetryScope = 'company' | 'all';

export interface TelemetryEffectiveConfigDto {
  readonly [key: string]: string | number | boolean | null | undefined | readonly string[];
}

export interface TelemetryConfigDto extends TelemetryLimitsDto {
  readonly protocol: 'OTLP/HTTP JSON';
  /** Additive fields supplied by backends that expose effective runtime policy. */
  readonly scope?: TelemetryScope | { readonly global: boolean; readonly tenantId?: number };
  readonly status?: TelemetryEffectiveConfigDto;
  readonly effectiveRetention?: TelemetryEffectiveConfigDto;
  readonly readiness?: TelemetryEffectiveConfigDto;
  readonly prune?: TelemetryEffectiveConfigDto;
  readonly pruneIntervalMs?: number;
  readonly pruneOnRead?: boolean;
  readonly ready?: boolean;
  readonly endpoints: {
    readonly traces: '/v1/traces';
    readonly metrics: '/v1/metrics';
    readonly logs: '/v1/logs';
  };
  readonly integrations: {
    readonly qoderHooks: '/v1/qoder';
  };
}

export interface TelemetryListQuery {
  readonly limit?: number;
  readonly query?: string;
  readonly cursor?: string;
  readonly scope?: TelemetryScope;
}

export interface TelemetryPageDto<T> {
  readonly traces?: readonly T[];
  readonly logs?: readonly T[];
  readonly metrics?: readonly T[];
  readonly nextCursor?: string | null;
}

export interface TelemetryTraceQuery extends TelemetryListQuery {
  readonly status?: TelemetryTraceStatus;
}

export interface TelemetryLogQuery extends TelemetryListQuery {
  readonly severity?: TelemetryLogSeverityFilter;
}

export type TelemetryMetricQuery = TelemetryListQuery;

interface TelemetryResponse<T> {
  readonly success: boolean;
  readonly data: T;
}

type TelemetryRequestQuery = Record<string, string | number | undefined>;

function boundedLimit(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    return TELEMETRY_DEFAULT_LIMIT;
  }
  return Math.min(value, TELEMETRY_MAX_LIMIT);
}

function boundedSearch(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, TELEMETRY_MAX_QUERY_LENGTH) : undefined;
}

function boundedCursor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 512) : undefined;
}

function telemetryParams(query: TelemetryListQuery) {
  return {
    limit: boundedLimit(query.limit),
    query: boundedSearch(query.query),
    cursor: boundedCursor(query.cursor),
  };
}

function requestTelemetry<T>(path: string, query?: TelemetryRequestQuery): Promise<T> {
  return client.request<TelemetryResponse<T>>(path, { query }).then((response) => {
    if (response?.success !== true || response.data === undefined) {
      throw new Error(`Observability returned an invalid response for ${path}.`);
    }
    return response.data;
  });
}

export function useTelemetrySummary(query: Pick<TelemetryListQuery, 'scope'> = {}) {
  const params = { scope: query.scope ?? 'company' };
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'observability', 'summary', params]),
    queryFn: () => requestTelemetry<TelemetrySummaryDto>('/api/observability/summary', params),
  });
}

export function useTelemetryTraces(query: TelemetryTraceQuery = {}) {
  const params = {
    ...telemetryParams(query),
    status: query.status?.toLowerCase() ?? 'all',
  };
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'observability', 'traces', params]),
    queryFn: () =>
      requestTelemetry<TelemetryPageDto<TelemetryTraceSummaryDto>>('/api/observability/traces', params),
  });
}

export function useTelemetryTraceDetail(
  traceId?: string | null,
  query: Pick<TelemetryListQuery, 'cursor' | 'scope'> & { logCursor?: string } = {}
) {
  const boundedTraceId = traceId?.slice(0, TELEMETRY_MAX_TRACE_ID_LENGTH) ?? '';
  const params = {
    spanCursor: boundedCursor(query.cursor),
    logCursor: boundedCursor(query.logCursor),
    spanLimit: TELEMETRY_DEFAULT_LIMIT,
    logLimit: 50,
    scope: query.scope ?? 'company',
  };
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'observability', 'trace-detail', boundedTraceId, params]),
    queryFn: () =>
      requestTelemetry<TelemetryTraceDetailDto>(
        `/api/observability/traces/${encodeURIComponent(boundedTraceId)}`,
        params
      ),
    enabled: boundedTraceId.length > 0,
  });
}

export function useTelemetryLogs(query: TelemetryLogQuery = {}) {
  const params = {
    ...telemetryParams(query),
    severity: query.severity?.toUpperCase(),
  };
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'observability', 'logs', params]),
    queryFn: () => requestTelemetry<TelemetryPageDto<TelemetryLogDto>>('/api/observability/logs', params),
  });
}

export function useTelemetryMetrics(query: TelemetryMetricQuery = {}) {
  const params = telemetryParams(query);
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'observability', 'metrics', params]),
    queryFn: () =>
      requestTelemetry<TelemetryPageDto<TelemetryMetricSeriesDto>>(
        '/api/observability/metrics',
        params
      ),
  });
}

export function useTelemetryConfig(query: Pick<TelemetryListQuery, 'scope'> = {}) {
  const params = { scope: query.scope ?? 'company' };
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'observability', 'config', params]),
    queryFn: () => requestTelemetry<TelemetryConfigDto>('/api/observability/config', params),
  });
}
