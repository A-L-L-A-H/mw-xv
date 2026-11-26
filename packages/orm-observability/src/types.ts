export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type SpanStatus = 'ok' | 'error' | 'unset';
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer' | 'unspecified';
export type LogSeverity = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'UNSPECIFIED';
export type MetricType = 'gauge' | 'sum' | 'histogram' | 'exponential_histogram' | 'summary';

export interface IngestContext {
  /** Derived from a credential, never from telemetry attributes. */
  readonly tenantId?: number;
}
export interface TelemetryScope {
  /** Global administrators use { global: true }; company users must supply a positive id. */
  readonly global: boolean;
  readonly tenantId?: number;
}
export interface Page<T> extends Array<T> {
  items: T[];
  nextCursor?: string;
}
export interface SpanEventRecord { name: string; timestampMs: number; attributes: Record<string, unknown> }
export interface SpanRecord {
  traceId: string; spanId: string; parentSpanId?: string; name: string; serviceName: string;
  scopeName?: string; kind: SpanKind; status: SpanStatus; statusMessage?: string;
  startTimeMs: number; endTimeMs: number; durationMs: number; runId: string; agentName?: string;
  provider?: string; model?: string; toolName?: string; inputTokens?: number; outputTokens?: number;
  totalTokens?: number; costUsd?: number; attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>; events: SpanEventRecord[]; tenantId?: number;
}
export interface LogRecord {
  id: string; timestampMs: number; serviceName: string; scopeName?: string; severity: LogSeverity;
  severityText?: string; body: string; traceId?: string; spanId?: string; runId?: string;
  agentName?: string; attributes: Record<string, unknown>; resourceAttributes: Record<string, unknown>;
  tenantId?: number;
}
export interface MetricPoint { timestampMs: number; value?: number; count?: number; sum?: number; min?: number; max?: number; attributes: Record<string, unknown> }
export interface MetricSeries {
  id: string; name: string; description?: string; unit?: string; type: MetricType; serviceName: string;
  scopeName?: string; points: MetricPoint[]; tenantId?: number;
}
export interface TraceSummary {
  traceId: string; rootName: string; startedAt: number; durationMs: number; spanCount: number;
  errorCount: number; serviceNames: string[]; runId: string; agentName?: string; inputTokens: number;
  outputTokens: number; totalTokens: number; costUsd: number; tenantId?: number;
}
export interface IngestResult { accepted: number; rejected: number }
export interface DecodedTraces { valid: boolean; spans: SpanRecord[]; rejected: number }
export interface DecodedLogs { valid: boolean; logs: LogRecord[]; rejected: number }
export interface DecodedMetrics { valid: boolean; metrics: MetricSeries[]; rejected: number }
export interface TelemetryLimits { maxSpans: number; maxLogs: number; maxMetricSeries: number; maxMetricPoints: number; retentionMs: number }
export interface TelemetryStoreOptions extends Partial<TelemetryLimits> { now?: () => number }
interface PagedQuery { limit?: number; cursor?: string; scope?: TelemetryScope }
export interface TraceQuery extends PagedQuery { query?: string; status?: string }
export interface LogQuery extends PagedQuery { query?: string; severity?: string }
export interface MetricQuery extends PagedQuery { query?: string }
export interface TraceDetail { summary: TraceSummary; spans: Page<SpanRecord>; logs: Page<LogRecord> }
export interface TelemetrySummary {
  status: 'ok'; revision: number; traceCount: number; spanCount: number; errorCount: number;
  logCount: number; errorLogCount: number; metricSeriesCount: number; inputTokens: number;
  outputTokens: number; totalTokens: number; costUsd: number; avgLatencyMs: number;
  services: string[]; lastEventAt?: string;
}
export interface ObservabilityStatus {
  configured: boolean; storage: 'ok' | 'unavailable'; correlation: 'ok' | 'unavailable';
  revision: number; lastPruneAt?: string; lastPrunedRecords: number; pendingCorrelations: number;
}
export interface IngestCredential {
  id: string; name: string; companyId?: number; userId?: number; createdAt: string;
  expiresAt?: string; revokedAt?: string;
}
export interface CredentialLookup { id: string; companyId?: number; userId?: number }
export interface IngestCredentialRegistry {
  lookup(token: string): Promise<CredentialLookup | undefined>;
  create(input: { name: string; companyId?: number; userId?: number; expiresAt?: string }): Promise<{ credential: IngestCredential; token: string }>;
  revoke(id: string): Promise<boolean>;
  list(): Promise<IngestCredential[]>;
}
export interface QoderStateRepository {
  get<T>(kind: string, key: string): Promise<{ value: T; expiresAt: number } | undefined>;
  set<T>(kind: string, key: string, value: T, expiresAt: number): Promise<void>;
  delete(kind: string, key: string): Promise<void>;
  count(): Promise<number>;
  ingestSpans(input: readonly SpanRecord[]): Promise<IngestResult>;
  ingestLogs(input: readonly LogRecord[]): Promise<IngestResult>;
  ingestMetrics(input: readonly MetricSeries[]): Promise<IngestResult>;
}
export interface TelemetryStore {
  readonly limits: TelemetryLimits;
  getRevision(): Promise<number>;
  ingestSpans(input: readonly SpanRecord[], context?: IngestContext): Promise<IngestResult>;
  ingestLogs(input: readonly LogRecord[], context?: IngestContext): Promise<IngestResult>;
  ingestMetrics(input: readonly MetricSeries[], context?: IngestContext): Promise<IngestResult>;
  listTraces(query?: TraceQuery): Promise<Page<TraceSummary>>;
  getTrace(traceId: string, options?: { scope?: TelemetryScope; spanCursor?: string; logCursor?: string; spanLimit?: number; logLimit?: number }): Promise<TraceDetail | undefined>;
  listLogs(query?: LogQuery): Promise<Page<LogRecord>>;
  listMetrics(query?: MetricQuery): Promise<Page<MetricSeries>>;
  summary(scope?: TelemetryScope): Promise<TelemetrySummary>;
  pruneExpired?(): Promise<number>;
  withQoderState?(context: IngestContext, operation: (state: QoderStateRepository) => Promise<void>): Promise<void>;
  status?(): Promise<ObservabilityStatus>;
  close(): Promise<void>;
}
