export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SpanStatus = 'ok' | 'error' | 'unset';
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer' | 'unspecified';
export type LogSeverity = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'UNSPECIFIED';
export type MetricType = 'gauge' | 'sum' | 'histogram' | 'exponential_histogram' | 'summary';

export interface SpanEventRecord {
  name: string;
  timestampMs: number;
  attributes: Record<string, unknown>;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  serviceName: string;
  scopeName?: string;
  kind: SpanKind;
  status: SpanStatus;
  statusMessage?: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  runId: string;
  agentName?: string;
  provider?: string;
  model?: string;
  toolName?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
  events: SpanEventRecord[];
}

export interface LogRecord {
  id: string;
  timestampMs: number;
  serviceName: string;
  scopeName?: string;
  severity: LogSeverity;
  severityText?: string;
  body: string;
  traceId?: string;
  spanId?: string;
  runId?: string;
  agentName?: string;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
}

export interface MetricPoint {
  timestampMs: number;
  value?: number;
  count?: number;
  sum?: number;
  min?: number;
  max?: number;
  attributes: Record<string, unknown>;
}

export interface MetricSeries {
  id: string;
  name: string;
  description?: string;
  unit?: string;
  type: MetricType;
  serviceName: string;
  scopeName?: string;
  points: MetricPoint[];
}

export interface TraceSummary {
  traceId: string;
  rootName: string;
  startedAt: number;
  durationMs: number;
  spanCount: number;
  errorCount: number;
  serviceNames: string[];
  runId: string;
  agentName?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface IngestResult {
  accepted: number;
  rejected: number;
}

export interface DecodedTraces {
  valid: boolean;
  spans: SpanRecord[];
  rejected: number;
}

export interface DecodedLogs {
  valid: boolean;
  logs: LogRecord[];
  rejected: number;
}

export interface DecodedMetrics {
  valid: boolean;
  metrics: MetricSeries[];
  rejected: number;
}

export interface TelemetryLimits {
  maxSpans: number;
  maxLogs: number;
  maxMetricSeries: number;
  maxMetricPoints: number;
  retentionMs: number;
}

export interface TelemetryStoreOptions extends Partial<TelemetryLimits> {
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

export interface TraceDetail {
  summary: TraceSummary;
  spans: SpanRecord[];
  logs: LogRecord[];
}

export interface TelemetrySummary {
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
}

export interface TelemetryStore {
  readonly limits: TelemetryLimits;
  getRevision(): Promise<number>;
  ingestSpans(input: readonly SpanRecord[]): Promise<IngestResult>;
  ingestLogs(input: readonly LogRecord[]): Promise<IngestResult>;
  ingestMetrics(input: readonly MetricSeries[]): Promise<IngestResult>;
  listTraces(query?: TraceQuery): Promise<TraceSummary[]>;
  getTrace(traceId: string): Promise<TraceDetail | undefined>;
  listLogs(query?: LogQuery): Promise<LogRecord[]>;
  listMetrics(query?: MetricQuery): Promise<MetricSeries[]>;
  summary(): Promise<TelemetrySummary>;
  close(): Promise<void>;
}
