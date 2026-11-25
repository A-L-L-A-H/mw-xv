'use client';

import { useDeferredValue, useId, useState, type ReactNode } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { LineChart } from '@moonwitness/ui/components/chart';
import { Input } from '@moonwitness/ui/components/input';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@moonwitness/ui/components/table';
import { Toolbar } from '@moonwitness/ui/components/toolbar';
import {
  ActivityIcon,
  CheckIcon,
  DocumentIcon,
  LockIcon,
  RefreshIcon,
  SearchIcon,
  WarningIcon,
  WorkflowIcon,
} from '@moonwitness/ui/icons';
import {
  useTelemetryConfig,
  useTelemetryLogs,
  useTelemetryMetrics,
  useTelemetrySummary,
  useTelemetryTraceDetail,
  useTelemetryTraces,
  type TelemetryLogDto,
  type TelemetryLogSeverityFilter,
  type TelemetryLogSeverity,
  type TelemetryMetricSeriesDto,
  type TelemetrySpanDto,
  type TelemetrySummaryDto,
  type TelemetryTraceDetailDto,
  type TelemetryTraceStatus,
  type TelemetryTraceSummaryDto,
  type TelemetryConfigDto,
  type TelemetryEffectiveConfigDto,
} from './telemetry-api';

const TRACE_LIST_LIMIT = 10;
const LOG_LIST_LIMIT = 20;
const METRIC_LIST_LIMIT = 10;
const TRACE_SPAN_RENDER_LIMIT = 100;
const TRACE_LOG_RENDER_LIMIT = 50;
const METRIC_POINT_RENDER_LIMIT = 24;
const SEARCH_MAX_LENGTH = 256;

interface TelemetryQueryState<T> {
  readonly data: T | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const status = Number((error as Record<string, unknown>).status);
  return Number.isInteger(status) ? status : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The observability API request failed.';
}

function formatTimestamp(value: number | string | undefined): string {
  if (value === undefined) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : `${date.toISOString().replace('T', ' ')} UTC`;
}

function formatDuration(value: number): string {
  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 1_000) return `${formatNumber(value)} ms`;
  return `${formatNumber(value / 1_000)} s`;
}

function formatRetention(value: number): string {
  if (value < 1_000) return `${formatNumber(value)} ms`;
  if (value < 60_000) return `${formatNumber(value / 1_000)} seconds`;
  if (value < 3_600_000) return `${formatNumber(value / 60_000)} minutes`;
  if (value < 86_400_000) return `${formatNumber(value / 3_600_000)} hours`;
  return `${formatNumber(value / 86_400_000)} days`;
}

function formatEffectiveValue(value: string | number | boolean | null | undefined | readonly string[]): string {
  if (value === null || value === undefined) return 'Not configured';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && value !== null) {
    return value.join(', ') || 'None';
  }
  if (typeof value === 'number') return formatNumber(value);
  return value;
}

function formatNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value);
}

function formatServices(services: readonly string[]): string {
  if (services.length === 0) return '—';
  const visible = services.slice(0, 3).join(', ');
  return services.length > 3 ? `${visible} +${services.length - 3} more` : visible;
}

function metricPlotValue(
  series: TelemetryMetricSeriesDto,
  point: TelemetryMetricSeriesDto['points'][number]
): number | undefined {
  return series.type === 'gauge' || series.type === 'sum' ? point.value : point.sum;
}

function formatMetricReading(series: TelemetryMetricSeriesDto): string {
  const point = series.points.at(-1);
  if (!point) return '—';
  if (series.type === 'gauge' || series.type === 'sum') return formatNumber(point.value);
  return (
    [
      point.sum !== undefined ? `sum ${formatNumber(point.sum)}` : undefined,
      point.count !== undefined ? `count ${formatNumber(point.count)}` : undefined,
      point.min !== undefined ? `min ${formatNumber(point.min)}` : undefined,
      point.max !== undefined ? `max ${formatNumber(point.max)}` : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || '—'
  );
}

function severityVariant(severity: TelemetryLogSeverity): 'destructive' | 'cyan' | 'default' {
  if (severity === 'ERROR' || severity === 'FATAL') return 'destructive';
  if (severity === 'WARN') return 'cyan';
  return 'default';
}

function PaginationControls({
  nextCursor,
  onNext,
  onPrevious,
  canGoPrevious,
  disabled = false,
}: {
  readonly nextCursor?: string | null;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly canGoPrevious: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <nav aria-label="Telemetry pagination" className="flex flex-wrap items-center gap-2 border-t border-ink/15 pt-3">
      <Button type="button" variant="outline" size="sm" disabled={disabled || !canGoPrevious} onClick={onPrevious}>
        Previous page
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={disabled || !nextCursor} onClick={onNext}>
        Next page
      </Button>
      <span role="status" className="font-mono text-[10px] text-ink-soft">
        {nextCursor ? 'More results available' : 'End of results'}
      </span>
    </nav>
  );
}

function EffectiveConfigFields({
  title,
  values,
  formatValue,
}: {
  readonly title: string;
  readonly values: TelemetryEffectiveConfigDto | undefined;
  readonly formatValue: (value: string | number | boolean | null | undefined | readonly string[]) => string;
}) {
  const entries = Object.entries(values ?? {}).filter(([, value]) =>
    value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)
  );
  if (entries.length === 0) return null;
  return (
    <div>
      <h4 className="font-mono text-xs font-bold uppercase text-ink">{title}</h4>
      <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="break-all text-[10px] text-ink-faint uppercase">{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</dt>
            <dd className="mt-1 break-words text-ink">{formatValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function QueryFeedback({
  query,
  label,
  isEmpty = false,
  emptyMessage,
  children,
}: {
  readonly query: TelemetryQueryState<unknown>;
  readonly label: string;
  readonly isEmpty?: boolean;
  readonly emptyMessage?: string;
  readonly children: ReactNode;
}) {
  if (query.isPending) {
    return <Skeleton className="h-36 w-full bg-ink/10" label={`Loading telemetry ${label}`} />;
  }
  if (query.isError) {
    return (
      <div
        role="alert"
        className="border-2 border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-ink"
      >
        <strong className="block uppercase">Unable to load telemetry {label}</strong>
        <p className="mt-1">{errorMessage(query.error)}</p>
        <p className="mt-1 text-ink-soft">This is an error, not an empty-data state.</p>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <p
        role="status"
        className="border border-dashed border-ink/25 p-4 font-mono text-xs text-ink-soft"
      >
        {emptyMessage ?? `No telemetry ${label} retained.`}
      </p>
    );
  }
  return children;
}

function SummaryPanel({ query }: { readonly query: TelemetryQueryState<TelemetrySummaryDto> }) {
  return (
    <Panel
      title="Telemetry Health & Counters"
      description="Store-wide retained records; counters are not scoped to the selected work contract."
      headingLevel={3}
      density="compact"
    >
      <QueryFeedback query={query} label="summary">
        {query.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                label="Telemetry Read Health"
                value={
                  query.data.status === 'ok' &&
                  query.data.errorCount === 0 &&
                  query.data.errorLogCount === 0
                    ? 'Read healthy'
                    : 'Errors observed'
                }
                detail={`API ${query.data.status} · revision ${formatNumber(query.data.revision)}`}
                accent={
                  query.data.errorCount === 0 && query.data.errorLogCount === 0
                    ? 'green'
                    : 'magenta'
                }
                icon={<ActivityIcon className="size-4" />}
              />
              <MetricTile
                label="Retained Traces"
                value={formatNumber(query.data.traceCount)}
                detail={`${formatNumber(query.data.spanCount)} spans · ${formatNumber(query.data.errorCount)} errors`}
                accent="cyan"
                icon={<WorkflowIcon className="size-4" />}
              />
              <MetricTile
                label="Retained Logs"
                value={formatNumber(query.data.logCount)}
                detail={`${formatNumber(query.data.errorLogCount)} error / fatal records`}
                accent="yellow"
                icon={<DocumentIcon className="size-4" />}
              />
              <MetricTile
                label="Metric Series"
                value={formatNumber(query.data.metricSeriesCount)}
                detail={`${formatNumber(query.data.totalTokens)} total tokens`}
                accent="violet"
                icon={<CheckIcon className="size-4" />}
              />
            </div>
            <dl className="grid grid-cols-1 gap-3 border-t border-ink/15 pt-3 font-mono text-xs sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className="text-ink-faint uppercase">Token usage</dt>
                <dd className="mt-1 text-ink">
                  {formatNumber(query.data.inputTokens)} in /{' '}
                  {formatNumber(query.data.outputTokens)} out
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Average span latency</dt>
                <dd className="mt-1 text-ink">{formatDuration(query.data.avgLatencyMs)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Reported cost</dt>
                <dd className="mt-1 text-ink">${formatNumber(query.data.costUsd)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Services</dt>
                <dd className="mt-1 break-words text-ink">{formatServices(query.data.services)}</dd>
              </div>
              <div className="sm:col-span-2 xl:col-span-4">
                <dt className="text-ink-faint uppercase">Last retained event</dt>
                <dd className="mt-1 text-ink">
                  {query.data.lastEventAt
                    ? formatTimestamp(query.data.lastEventAt)
                    : 'No event timestamp retained'}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </QueryFeedback>
    </Panel>
  );
}

function TracesPanel({
  query,
  search,
  status,
  selectedTraceId,
  onSearchChange,
  onStatusChange,
  onSelectTrace,
  onNext,
  onPrevious,
  canGoPrevious,
}: {
  readonly query: TelemetryQueryState<{ traces?: readonly TelemetryTraceSummaryDto[]; nextCursor?: string | null }>;
  readonly search: string;
  readonly status: TelemetryTraceStatus;
  readonly selectedTraceId: string | null;
  readonly onSearchChange: (value: string) => void;
  readonly onStatusChange: (value: TelemetryTraceStatus) => void;
  readonly onSelectTrace: (traceId: string) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly canGoPrevious: boolean;
}) {
  const traces = (query.data?.traces ?? []).slice(0, TRACE_LIST_LIMIT);
  return (
    <Panel
      aria-label="Recent observed traces"
      title="Recent Observed Traces"
      description="Select a trace to inspect emitted spans, observed parent IDs, and correlated log metadata."
      headingLevel={3}
      density="compact"
    >
      <QueryFeedback
        query={query}
        label="traces"
        isEmpty={traces.length === 0}
        emptyMessage="No retained traces match these filters. A successful empty response is not an access error."
      >
        <div className="space-y-3">
          <Toolbar
            aria-label="Observed trace filters"
            filters={
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="board-telemetry-trace-search">
                  Search observed traces
                </label>
                <Input
                  id="board-telemetry-trace-search"
                  type="search"
                  value={search}
                  maxLength={SEARCH_MAX_LENGTH}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="Trace, run, service, agent…"
                  className="w-full sm:w-56"
                />
                <label className="sr-only" htmlFor="board-telemetry-trace-status">
                  Filter traces by error status
                </label>
                <SelectField
                  id="board-telemetry-trace-status"
                  value={status}
                  onChange={(event) => onStatusChange(event.target.value as TelemetryTraceStatus)}
                >
                  <option value="all">All trace states</option>
                  <option value="error">With span errors</option>
                  <option value="ok">Without span errors</option>
                </SelectField>
              </div>
            }
          />
          <Table
            scrollLabel={`Recent observed traces, up to ${TRACE_LIST_LIMIT}`}
            density="compact"
          >
            <TableCaption className="sr-only">Recent observed traces</TableCaption>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Root span / trace</TableHeader>
                <TableHeader scope="col">Started</TableHeader>
                <TableHeader scope="col">Services</TableHeader>
                <TableHeader scope="col">Spans / errors</TableHeader>
                <TableHeader scope="col">Tokens</TableHeader>
                <TableHeader scope="col">Duration / cost</TableHeader>
                <TableHeader scope="col">Detail</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {traces.map((trace) => (
                <TableRow key={trace.traceId}>
                  <TableCell>
                    <div className="font-bold text-ink">{trace.rootName}</div>
                    <div className="mt-1 break-all font-mono text-[10px] text-ink-faint">
                      {trace.traceId}
                    </div>
                    <div className="mt-1 break-all font-mono text-[10px] text-ink-soft">
                      Run {trace.runId}
                      {trace.agentName ? ` · ${trace.agentName}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px]">
                    {formatTimestamp(trace.startedAt)}
                  </TableCell>
                  <TableCell className="max-w-48 text-xs">
                    {formatServices(trace.serviceNames)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <div>{formatNumber(trace.spanCount)} spans</div>
                    <Badge variant={trace.errorCount > 0 ? 'destructive' : 'primary'}>
                      {formatNumber(trace.errorCount)} errors
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <div>{formatNumber(trace.totalTokens)} total</div>
                    <div className="text-ink-faint">
                      {formatNumber(trace.inputTokens)} in / {formatNumber(trace.outputTokens)} out
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    <div>{formatDuration(trace.durationMs)}</div>
                    <div className="text-ink-faint">${formatNumber(trace.costUsd)}</div>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={selectedTraceId === trace.traceId}
                      aria-controls="board-telemetry-trace-detail"
                      aria-label={`Inspect trace ${trace.traceId}`}
                      onClick={() => onSelectTrace(trace.traceId)}
                    >
                      Inspect
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationControls nextCursor={query.data?.nextCursor} onNext={onNext} onPrevious={onPrevious} canGoPrevious={canGoPrevious} disabled={query.isPending} />
        </div>
      </QueryFeedback>
    </Panel>
  );
}

function ConfigPanel({
  query,
  summary,
}: {
  readonly query: TelemetryQueryState<TelemetryConfigDto>;
  readonly summary: TelemetrySummaryDto | undefined;
}) {
  const effectiveScope = typeof query.data?.scope === 'object'
    ? (query.data.scope.global ? 'all' : 'company')
    : query.data?.scope;
  return (
    <Panel
      aria-label="Telemetry retention and configuration"
      title="Retention & Configuration"
      description="Effective store limits. Ingest credentials stay server-side and are never returned to Board."
      headingLevel={3}
      density="compact"
      actions={
        <Badge variant="primary">
          <LockIcon className="size-3" /> Read-only
        </Badge>
      }
    >
      <QueryFeedback query={query} label="configuration">
        {query.data ? (
          <div className="space-y-4 font-mono text-xs">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-ink-faint uppercase">Protocol</dt>
                <dd className="mt-1 text-ink">{query.data.protocol}</dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Retention window</dt>
                <dd className="mt-1 text-ink">{formatRetention(query.data.retentionMs)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Capacity</dt>
                <dd className="mt-1 text-ink">
                  {formatNumber(query.data.maxSpans)} spans · {formatNumber(query.data.maxLogs)}{' '}
                  logs
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Metric capacity</dt>
                <dd className="mt-1 text-ink">
                  {formatNumber(query.data.maxMetricSeries)} series ·{' '}
                  {formatNumber(query.data.maxMetricPoints)} points each
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Data revision</dt>
                <dd className="mt-1 text-ink">
                  {summary ? formatNumber(summary.revision) : 'Summary unavailable'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Effective tenant scope</dt>
                <dd className="mt-1 text-ink">{effectiveScope === 'all' ? 'All tenants' : effectiveScope === 'company' ? 'Current company' : 'Not reported'}</dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Prune on read</dt>
                <dd className="mt-1 text-ink">{query.data.pruneOnRead === undefined ? 'Not reported' : query.data.pruneOnRead ? 'Enabled' : 'Disabled'}</dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Prune interval</dt>
                <dd className="mt-1 text-ink">{query.data.pruneIntervalMs === undefined ? 'Not reported' : formatRetention(query.data.pruneIntervalMs)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Read readiness</dt>
                <dd className="mt-1 text-ink">{query.data.ready === undefined ? 'Not reported' : query.data.ready ? 'Ready' : 'Not ready'}</dd>
              </div>
            </dl>
            <EffectiveConfigFields title="Effective retention" values={query.data.effectiveRetention} formatValue={formatEffectiveValue} />
            <EffectiveConfigFields title="Readiness and prune status" values={query.data.status} formatValue={formatEffectiveValue} />
            <EffectiveConfigFields title="Readiness details" values={query.data.readiness} formatValue={formatEffectiveValue} />
            <EffectiveConfigFields title="Prune details" values={query.data.prune} formatValue={formatEffectiveValue} />
            <div className="border-t border-ink/15 pt-3">
              <p className="text-ink-faint uppercase">Server-to-server ingest routes</p>
              <ul className="mt-2 space-y-1 text-ink">
                <li>
                  Traces <code>{query.data.endpoints.traces}</code>
                </li>
                <li>
                  Metrics <code>{query.data.endpoints.metrics}</code>
                </li>
                <li>
                  Logs <code>{query.data.endpoints.logs}</code>
                </li>
                <li>
                  Qoder hooks <code>{query.data.integrations.qoderHooks}</code>
                </li>
              </ul>
              <p className="mt-3 text-ink-soft">
                Configuration availability does not assert that an ingest credential is configured.
              </p>
            </div>
          </div>
        ) : null}
      </QueryFeedback>
    </Panel>
  );
}

function LogMetadataTable({
  logs,
  caption,
  onSelectTrace,
}: {
  readonly logs: readonly TelemetryLogDto[];
  readonly caption: string;
  readonly onSelectTrace?: (traceId: string) => void;
}) {
  return (
    <Table scrollLabel={caption} density="compact">
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHead>
        <TableRow>
          <TableHeader scope="col">Timestamp</TableHeader>
          <TableHeader scope="col">Severity</TableHeader>
          <TableHeader scope="col">Service</TableHeader>
          <TableHeader scope="col">Trace / span</TableHeader>
          <TableHeader scope="col">Run / agent</TableHeader>
          <TableHeader scope="col">Correlation</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell className="whitespace-nowrap font-mono text-[11px]">
              {formatTimestamp(log.timestampMs)}
            </TableCell>
            <TableCell>
              <Badge variant={severityVariant(log.severity)}>{log.severity}</Badge>
            </TableCell>
            <TableCell>
              <div>{log.serviceName}</div>
              {log.scopeName ? <div className="text-ink-faint">{log.scopeName}</div> : null}
            </TableCell>
            <TableCell className="max-w-48 font-mono text-[10px]">
              <div className="break-all">{log.traceId ?? 'No trace ID'}</div>
              <div className="break-all text-ink-faint">{log.spanId ?? 'No span ID'}</div>
            </TableCell>
            <TableCell className="max-w-48 text-xs">
              <div className="break-all">{log.runId ?? '—'}</div>
              <div className="text-ink-faint">{log.agentName ?? '—'}</div>
            </TableCell>
            <TableCell>
              {log.traceId && onSelectTrace ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-controls="board-telemetry-trace-detail"
                  aria-label={`Inspect trace ${log.traceId}`}
                  onClick={() => {
                    if (log.traceId) onSelectTrace(log.traceId);
                  }}
                >
                  Inspect trace
                </Button>
              ) : (
                <span className="font-mono text-xs text-ink-faint">
                  {log.traceId ? 'Correlated' : 'Uncorrelated'}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function LogsPanel({
  query,
  severity,
  onSeverityChange,
  onSelectTrace,
  onNext,
  onPrevious,
  canGoPrevious,
}: {
  readonly query: TelemetryQueryState<{ logs?: readonly TelemetryLogDto[]; nextCursor?: string | null }>;
  readonly severity: TelemetryLogSeverityFilter;
  readonly onSeverityChange: (value: TelemetryLogSeverityFilter) => void;
  readonly onSelectTrace: (traceId: string) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly canGoPrevious: boolean;
}) {
  const logs = (query.data?.logs ?? []).slice(0, LOG_LIST_LIMIT);
  return (
    <Panel
      aria-label="Recent log metadata"
      title="Recent Log Metadata"
      description="Bodies, prompts, arbitrary attributes, and tool payloads are intentionally not rendered."
      headingLevel={3}
      density="compact"
    >
      <div className="space-y-3">
        <Toolbar
          aria-label="Log severity filter"
          filters={
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="board-telemetry-log-severity">
                Filter logs by severity
              </label>
              <SelectField
                id="board-telemetry-log-severity"
                value={severity}
                onChange={(event) =>
                  onSeverityChange(event.target.value as TelemetryLogSeverityFilter)
                }
              >
                <option value="ALL">All severities</option>
                <option value="TRACE">Trace</option>
                <option value="DEBUG">Debug</option>
                <option value="INFO">Info</option>
                <option value="WARN">Warn</option>
                <option value="ERROR">Error</option>
                <option value="FATAL">Fatal</option>
                <option value="UNSPECIFIED">Unspecified</option>
              </SelectField>
            </div>
          }
        />
        <QueryFeedback
          query={query}
          label="logs"
          isEmpty={logs.length === 0}
          emptyMessage="No retained log records match this severity."
        >
          <LogMetadataTable
            logs={logs}
            caption={`Recent log metadata, up to ${LOG_LIST_LIMIT}`}
            onSelectTrace={onSelectTrace}
          />
          <PaginationControls nextCursor={query.data?.nextCursor} onNext={onNext} onPrevious={onPrevious} canGoPrevious={canGoPrevious} disabled={query.isPending} />
        </QueryFeedback>
      </div>
    </Panel>
  );
}

function TraceDetailPanel({
  query,
  selectedTraceId,
  onClose,
  onNext,
  onPrevious,
  canGoPrevious,
  onNextLogs,
  onPreviousLogs,
  canGoPreviousLogs,
}: {
  readonly query: TelemetryQueryState<TelemetryTraceDetailDto | undefined>;
  readonly selectedTraceId: string | null;
  readonly onClose: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly canGoPrevious: boolean;
  readonly onNextLogs: () => void;
  readonly onPreviousLogs: () => void;
  readonly canGoPreviousLogs: boolean;
}) {
  const detail = query.data;
  const spans = detail?.spans.slice(0, TRACE_SPAN_RENDER_LIMIT) ?? [];
  const logs = detail?.logs.slice(-TRACE_LOG_RENDER_LIMIT) ?? [];
  const spanMap = new Map(detail?.spans.map((span) => [span.spanId, span]) ?? []);

  return (
    <Panel
      aria-label="Observed trace detail"
      id="board-telemetry-trace-detail"
      title={
        <span
          id="board-telemetry-trace-detail-heading"
          tabIndex={-1}
          className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          Observed Trace Detail
        </span>
      }
      description="Parent span IDs describe emitted telemetry only — explicitly not the planned task DAG or work-contract hierarchy."
      headingLevel={3}
      density="compact"
      actions={
        selectedTraceId ? (
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close detail
          </Button>
        ) : undefined
      }
    >
      {selectedTraceId === null ? (
        <p className="font-mono text-xs text-ink-soft">
          Select an observed trace above to inspect its spans and correlated logs.
        </p>
      ) : (
        <QueryFeedback
          query={query}
          label="trace detail"
          isEmpty={!detail}
          emptyMessage="The selected trace detail is no longer retained."
        >
          {detail ? (
            <div className="space-y-5">
              <dl className="grid grid-cols-1 gap-3 font-mono text-xs sm:grid-cols-2 xl:grid-cols-4">
                <div className="sm:col-span-2">
                  <dt className="text-ink-faint uppercase">Trace ID</dt>
                  <dd className="mt-1 break-all text-ink">{detail.summary.traceId}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint uppercase">Root span</dt>
                  <dd className="mt-1 text-ink">{detail.summary.rootName}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint uppercase">Run / agent</dt>
                  <dd className="mt-1 break-words text-ink">
                    {detail.summary.runId} / {detail.summary.agentName ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint uppercase">Started / duration</dt>
                  <dd className="mt-1 text-ink">
                    {formatTimestamp(detail.summary.startedAt)} ·{' '}
                    {formatDuration(detail.summary.durationMs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint uppercase">Spans / errors</dt>
                  <dd className="mt-1 text-ink">
                    {formatNumber(detail.summary.spanCount)} /{' '}
                    {formatNumber(detail.summary.errorCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint uppercase">Tokens / cost</dt>
                  <dd className="mt-1 text-ink">
                    {formatNumber(detail.summary.totalTokens)} · $
                    {formatNumber(detail.summary.costUsd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint uppercase">Services</dt>
                  <dd className="mt-1 break-words text-ink">
                    {formatServices(detail.summary.serviceNames)}
                  </dd>
                </div>
              </dl>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-mono text-xs font-bold uppercase text-ink">
                    Observed spans ({formatNumber(detail.spans.length)} returned)
                  </h4>
                  {detail.spans.length > TRACE_SPAN_RENDER_LIMIT ? (
                    <span className="font-mono text-xs text-ink-soft">
                      Showing first {TRACE_SPAN_RENDER_LIMIT}; summary includes all returned spans.
                    </span>
                  ) : null}
                </div>
                <Table
                  scrollLabel={`Observed spans for trace ${detail.summary.traceId}`}
                  density="compact"
                >
                  <TableCaption className="sr-only">
                    Observed spans and parent span identifiers; not a planned task DAG
                  </TableCaption>
                  <TableHead>
                    <TableRow>
                      <TableHeader scope="col">Span / ID</TableHeader>
                      <TableHeader scope="col">Service / kind</TableHeader>
                      <TableHeader scope="col">Observed parent span</TableHeader>
                      <TableHeader scope="col">Timing</TableHeader>
                      <TableHeader scope="col">Status</TableHeader>
                      <TableHeader scope="col">Execution metadata</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {spans.map((span) => (
                      <SpanRow
                        key={`${span.traceId}:${span.spanId}`}
                        span={span}
                        spanMap={spanMap}
                      />
                    ))}
                  </TableBody>
                </Table>
                <PaginationControls nextCursor={detail.spanNextCursor} onNext={onNext} onPrevious={onPrevious} canGoPrevious={canGoPrevious} disabled={query.isPending} />
              </div>

              <div className="space-y-2 border-t border-ink/15 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-mono text-xs font-bold uppercase text-ink">
                    Correlated log metadata ({formatNumber(detail.logs.length)} returned)
                  </h4>
                  {detail.logs.length > TRACE_LOG_RENDER_LIMIT ? (
                    <span className="font-mono text-xs text-ink-soft">
                      Showing latest {TRACE_LOG_RENDER_LIMIT} log records.
                    </span>
                  ) : null}
                </div>
                {logs.length > 0 ? (
                  <LogMetadataTable logs={logs} caption="Logs correlated to the selected trace" />
                ) : (
                  <p role="status" className="font-mono text-xs text-ink-soft">
                    No log records are correlated to this retained trace.
                  </p>
                )}
                <PaginationControls nextCursor={detail.logNextCursor} onNext={onNextLogs} onPrevious={onPreviousLogs} canGoPrevious={canGoPreviousLogs} disabled={query.isPending} />
              </div>
            </div>
          ) : null}
        </QueryFeedback>
      )}
    </Panel>
  );
}

function SpanRow({
  span,
  spanMap,
}: {
  readonly span: TelemetrySpanDto;
  readonly spanMap: ReadonlyMap<string, TelemetrySpanDto>;
}) {
  const parent = span.parentSpanId ? spanMap.get(span.parentSpanId) : undefined;
  return (
    <TableRow>
      <TableCell>
        <div className="font-bold text-ink">{span.name}</div>
        <div className="mt-1 break-all font-mono text-[10px] text-ink-faint">{span.spanId}</div>
      </TableCell>
      <TableCell>
        <div>{span.serviceName}</div>
        <div className="text-ink-faint">
          {span.kind}
          {span.scopeName ? ` · ${span.scopeName}` : ''}
        </div>
      </TableCell>
      <TableCell className="max-w-52 font-mono text-[10px]">
        {span.parentSpanId ? (
          <>
            <div className="break-all">{span.parentSpanId}</div>
            <div className="mt-1 break-words text-ink-faint">
              {parent?.name ?? 'Parent span not present in returned trace'}
            </div>
          </>
        ) : (
          <span className="text-ink-faint">No parent ID reported</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-[11px]">
        <div>{formatTimestamp(span.startTimeMs)}</div>
        <div className="text-ink-faint">{formatDuration(span.durationMs)}</div>
      </TableCell>
      <TableCell>
        <Badge
          variant={
            span.status === 'error' ? 'destructive' : span.status === 'ok' ? 'primary' : 'default'
          }
        >
          {span.status}
        </Badge>
      </TableCell>
      <TableCell className="max-w-64 text-xs">
        <div>Agent: {span.agentName ?? '—'}</div>
        <div className="text-ink-soft">
          {span.provider ?? '—'} / {span.model ?? '—'}
        </div>
        {span.toolName ? <div className="text-ink-soft">Tool: {span.toolName}</div> : null}
        <div className="break-all font-mono text-[10px] text-ink-faint">Run: {span.runId}</div>
        <div className="font-mono text-[10px] text-ink-faint">
          {formatNumber(span.inputTokens)} in / {formatNumber(span.outputTokens)} out ·{' '}
          {formatNumber(span.totalTokens)} total · ${formatNumber(span.costUsd)}
        </div>
      </TableCell>
    </TableRow>
  );
}

function MetricTimeSeriesChart({ series }: { readonly series: TelemetryMetricSeriesDto }) {
  const points = series.points.slice(-METRIC_POINT_RENDER_LIMIT);
  const values = points
    .map((point) => metricPlotValue(series, point))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const valueLabel = series.type === 'gauge' || series.type === 'sum' ? 'value' : 'sum';

  if (points.length === 0 || values.length !== points.length) {
    return (
      <p
        role="status"
        className="border border-dashed border-ink/25 p-3 font-mono text-xs text-ink-soft"
      >
        No complete numeric {valueLabel} series is available to plot. Returned values remain in the
        table below.
      </p>
    );
  }

  return (
    <figure className="border border-ink/20 bg-paper p-3">
      <figcaption className="font-mono text-xs font-bold uppercase text-ink">
        {series.name} — {valueLabel} over time {series.unit ? `(${series.unit})` : ''}
      </figcaption>
      {series.description ? (
        <p className="mt-1 text-xs text-ink-soft">{series.description}</p>
      ) : null}
      <LineChart
        title={`${series.name} ${valueLabel} time series`}
        labels={points.map((point) => formatTimestamp(point.timestampMs))}
        series={[
          {
            label: `${series.name} ${valueLabel}`,
            values,
          },
        ]}
        locale="en-US"
        valueLabel={valueLabel}
        className="mt-2 h-40 w-full text-magenta"
        renderValue={(value) => `${formatNumber(value)} ${series.unit ?? ''}`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-ink-faint">
        <span>{formatTimestamp(points[0]?.timestampMs)}</span>
        <span>
          Range {formatNumber(Math.min(...values))}–{formatNumber(Math.max(...values))}{' '}
          {series.unit ?? ''}
        </span>
        <span>{formatTimestamp(points.at(-1)?.timestampMs)}</span>
      </div>
    </figure>
  );
}

function MetricPointTable({ series }: { readonly series: TelemetryMetricSeriesDto }) {
  const points = series.points.slice(-METRIC_POINT_RENDER_LIMIT).reverse();
  return (
    <Table scrollLabel={`${series.name} metric points`} density="compact">
      <TableCaption className="sr-only">Latest returned points for {series.name}</TableCaption>
      <TableHead>
        <TableRow>
          <TableHeader scope="col">Timestamp</TableHeader>
          <TableHeader scope="col">Value / sum</TableHeader>
          <TableHeader scope="col">Count</TableHeader>
          <TableHeader scope="col">Min</TableHeader>
          <TableHeader scope="col">Max</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {points.map((point) => (
          <TableRow key={point.timestampMs}>
            <TableCell className="whitespace-nowrap font-mono text-[11px]">
              {formatTimestamp(point.timestampMs)}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {formatNumber(
                series.type === 'gauge' || series.type === 'sum' ? point.value : point.sum
              )}
            </TableCell>
            <TableCell className="font-mono text-xs">{formatNumber(point.count)}</TableCell>
            <TableCell className="font-mono text-xs">{formatNumber(point.min)}</TableCell>
            <TableCell className="font-mono text-xs">{formatNumber(point.max)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MetricDetail({ series }: { readonly series: TelemetryMetricSeriesDto }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3 border-t border-ink/15 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="font-mono text-xs font-bold uppercase text-ink">
          {series.name} · {series.serviceName}
        </h4>
        <span className="font-mono text-xs text-ink-soft">
          Latest {Math.min(series.points.length, METRIC_POINT_RENDER_LIMIT)} of{' '}
          {formatNumber(series.points.length)} returned points; no client-side aggregation.
        </span>
      </div>
      <MetricTimeSeriesChart series={series} />
      <MetricPointTable series={series} />
    </section>
  );
}

function MetricsPanel({
  query,
  search,
  selectedMetricId,
  onSearchChange,
  onSelectMetric,
  onNext,
  onPrevious,
  canGoPrevious,
}: {
  readonly query: TelemetryQueryState<{ metrics?: readonly TelemetryMetricSeriesDto[]; nextCursor?: string | null }>;
  readonly search: string;
  readonly selectedMetricId: string | null;
  readonly onSearchChange: (value: string) => void;
  readonly onSelectMetric: (id: string) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly canGoPrevious: boolean;
}) {
  const metrics = (query.data?.metrics ?? []).slice(0, METRIC_LIST_LIMIT);
  const selectedMetric = metrics.find((metric) => metric.id === selectedMetricId) ?? metrics[0];
  return (
    <Panel
      aria-label="Metric time series"
      title="Metric Time Series"
      description="Returned redacted metric metadata only; point attributes are not rendered."
      headingLevel={3}
      density="compact"
    >
      <QueryFeedback
        query={query}
        label="metrics"
        isEmpty={metrics.length === 0}
        emptyMessage="No retained metric series match this search."
      >
        <div className="space-y-4">
          <Toolbar
            aria-label="Metric search"
            filters={
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="board-telemetry-metric-search">
                  Search metric series
                </label>
                <SearchIcon className="size-4 shrink-0 text-ink-faint" />
                <Input
                  id="board-telemetry-metric-search"
                  type="search"
                  value={search}
                  maxLength={SEARCH_MAX_LENGTH}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="Metric name, service, unit, description…"
                  className="w-full sm:w-80"
                />
              </div>
            }
          />
          <Table scrollLabel={`Metric series, up to ${METRIC_LIST_LIMIT}`} density="compact">
            <TableCaption className="sr-only">Retained metric series</TableCaption>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Metric</TableHeader>
                <TableHeader scope="col">Service</TableHeader>
                <TableHeader scope="col">Type</TableHeader>
                <TableHeader scope="col">Unit</TableHeader>
                <TableHeader scope="col">Points</TableHeader>
                <TableHeader scope="col">Latest reading</TableHeader>
                <TableHeader scope="col">Plot</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {metrics.map((metric) => (
                <TableRow key={metric.id}>
                  <TableCell>
                    <div className="font-bold text-ink">{metric.name}</div>
                    <div className="break-all font-mono text-[10px] text-ink-faint">
                      {metric.id}
                    </div>
                  </TableCell>
                  <TableCell>{metric.serviceName}</TableCell>
                  <TableCell>
                    <Badge>{metric.type}</Badge>
                  </TableCell>
                  <TableCell>{metric.unit ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatNumber(metric.points.length)}
                  </TableCell>
                  <TableCell className="max-w-64 font-mono text-xs">
                    {formatMetricReading(metric)}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={selectedMetric?.id === metric.id}
                      aria-label={`Plot ${metric.name}`}
                      onClick={() => onSelectMetric(metric.id)}
                    >
                      Plot
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {selectedMetric ? <MetricDetail series={selectedMetric} /> : null}
          <PaginationControls nextCursor={query.data?.nextCursor} onNext={onNext} onPrevious={onPrevious} canGoPrevious={canGoPrevious} disabled={query.isPending} />
        </div>
      </QueryFeedback>
    </Panel>
  );
}

export function BoardTelemetryPanel() {
  const [traceSearch, setTraceSearch] = useState('');
  const [traceStatus, setTraceStatus] = useState<TelemetryTraceStatus>('all');
  const [logSeverity, setLogSeverity] = useState<TelemetryLogSeverityFilter>('ALL');
  const [metricSearch, setMetricSearch] = useState('');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);
  const [traceCursor, setTraceCursor] = useState<string>();
  const [previousTraceCursor, setPreviousTraceCursor] = useState<string>();
  const [logCursor, setLogCursor] = useState<string>();
  const [previousLogCursor, setPreviousLogCursor] = useState<string>();
  const [metricCursor, setMetricCursor] = useState<string>();
  const [previousMetricCursor, setPreviousMetricCursor] = useState<string>();
  const [detailCursor, setDetailCursor] = useState<string>();
  const [previousDetailCursor, setPreviousDetailCursor] = useState<string>();
  const [detailLogCursor, setDetailLogCursor] = useState<string>();
  const [previousDetailLogCursor, setPreviousDetailLogCursor] = useState<string>();
  const deferredTraceSearch = useDeferredValue(traceSearch);
  const deferredMetricSearch = useDeferredValue(metricSearch);

  const summaryQuery = useTelemetrySummary();
  const tracesQuery = useTelemetryTraces({
    limit: TRACE_LIST_LIMIT,
    query: deferredTraceSearch,
    status: traceStatus,
    cursor: traceCursor,
  });
  const traceDetailQuery = useTelemetryTraceDetail(selectedTraceId, { cursor: detailCursor, logCursor: detailLogCursor });
  const logsQuery = useTelemetryLogs({ limit: LOG_LIST_LIMIT, severity: logSeverity, cursor: logCursor });
  const metricsQuery = useTelemetryMetrics({
    limit: METRIC_LIST_LIMIT,
    query: deferredMetricSearch,
    cursor: metricCursor,
  });
  const configQuery = useTelemetryConfig();
  const isFetching =
    summaryQuery.isFetching ||
    tracesQuery.isFetching ||
    traceDetailQuery.isFetching ||
    logsQuery.isFetching ||
    metricsQuery.isFetching ||
    configQuery.isFetching;
  const queryErrors = [
    summaryQuery.error,
    tracesQuery.error,
    traceDetailQuery.error,
    logsQuery.error,
    metricsQuery.error,
    configQuery.error,
  ];
  const accessError =
    queryErrors.find((error) => errorStatus(error) === 403) ??
    queryErrors.find((error) => errorStatus(error) === 401);

  const selectTrace = (traceId: string) => {
    setSelectedTraceId(traceId);
    setDetailCursor(undefined);
    setPreviousDetailCursor(undefined);
    setDetailLogCursor(undefined);
    setPreviousDetailLogCursor(undefined);
    window.requestAnimationFrame(() => {
      document.getElementById('board-telemetry-trace-detail-heading')?.focus();
    });
  };

  const refresh = () => {
    void summaryQuery.refetch();
    void tracesQuery.refetch();
    void logsQuery.refetch();
    void metricsQuery.refetch();
    void configQuery.refetch();
    if (selectedTraceId) void traceDetailQuery.refetch();
  };

  return (
    <section aria-label="Board telemetry" className="min-w-0 space-y-4 border-t-4 border-ink pt-6">
      <Panel
        title="Board Telemetry"
        description="Canonical observed traces, correlated log metadata, metrics, and retention from the consolidated observability API. This is not the planned task DAG."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">
              <LockIcon className="size-3" /> Read-only
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={isFetching}
            >
              <RefreshIcon className="size-3.5" />
              {isFetching ? 'Refreshing…' : 'Refresh telemetry'}
            </Button>
          </div>
        }
        aria-busy={isFetching}
      >
        <span role="status" className="sr-only">
          {isFetching ? 'Refreshing Board telemetry.' : ''}
        </span>
        {accessError ? (
          <div
            role="alert"
            className="border-2 border-destructive bg-destructive/10 p-4 font-mono text-xs text-ink"
          >
            <div className="flex items-start gap-3">
              <WarningIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <strong className="block font-display text-sm uppercase">
                  {errorStatus(accessError) === 403
                    ? 'Telemetry scope access denied'
                    : 'Authentication required'}
                </strong>
                <p className="mt-2">
                  {errorStatus(accessError) === 403
                    ? 'Your account cannot read this telemetry scope.'
                    : 'Sign in with an authorized account to read Board telemetry.'}
                </p>
                <p className="mt-2 text-ink-soft">
                  Telemetry is unavailable — this response is not an empty-data state.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <SummaryPanel query={summaryQuery} />
            <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <TracesPanel
                query={tracesQuery}
                search={traceSearch}
                status={traceStatus}
                selectedTraceId={selectedTraceId}
                onSearchChange={(value) => {
                  setTraceSearch(value);
                  setTraceCursor(undefined);
                  setPreviousTraceCursor(undefined);
                }}
                onStatusChange={(value) => {
                  setTraceStatus(value);
                  setTraceCursor(undefined);
                  setPreviousTraceCursor(undefined);
                }}
                onSelectTrace={selectTrace}
                onNext={() => {
                  if (!tracesQuery.data?.nextCursor) return;
                  setPreviousTraceCursor(traceCursor);
                  setTraceCursor(tracesQuery.data.nextCursor);
                }}
                onPrevious={() => setTraceCursor(previousTraceCursor)}
                canGoPrevious={traceCursor !== undefined}
              />
              <ConfigPanel query={configQuery} summary={summaryQuery.data} />
            </div>
            <TraceDetailPanel
              query={traceDetailQuery}
              selectedTraceId={selectedTraceId}
              onClose={() => setSelectedTraceId(null)}
              onNext={() => {
                if (!traceDetailQuery.data?.spanNextCursor) return;
                setPreviousDetailCursor(detailCursor);
                setDetailCursor(traceDetailQuery.data.spanNextCursor);
              }}
              onPrevious={() => setDetailCursor(previousDetailCursor)}
              canGoPrevious={detailCursor !== undefined}
              onNextLogs={() => {
                if (!traceDetailQuery.data?.logNextCursor) return;
                setPreviousDetailLogCursor(detailLogCursor);
                setDetailLogCursor(traceDetailQuery.data.logNextCursor);
              }}
              onPreviousLogs={() => setDetailLogCursor(previousDetailLogCursor)}
              canGoPreviousLogs={detailLogCursor !== undefined}
            />
            <LogsPanel
              query={logsQuery}
              severity={logSeverity}
              onSeverityChange={(value) => {
                setLogSeverity(value);
                setLogCursor(undefined);
                setPreviousLogCursor(undefined);
              }}
              onSelectTrace={selectTrace}
              onNext={() => {
                if (!logsQuery.data?.nextCursor) return;
                setPreviousLogCursor(logCursor);
                setLogCursor(logsQuery.data.nextCursor);
              }}
              onPrevious={() => setLogCursor(previousLogCursor)}
              canGoPrevious={logCursor !== undefined}
            />
            <MetricsPanel
              query={metricsQuery}
              search={metricSearch}
              selectedMetricId={selectedMetricId}
              onSearchChange={(value) => {
                setMetricSearch(value);
                setMetricCursor(undefined);
                setPreviousMetricCursor(undefined);
              }}
              onSelectMetric={setSelectedMetricId}
              onNext={() => {
                if (!metricsQuery.data?.nextCursor) return;
                setPreviousMetricCursor(metricCursor);
                setMetricCursor(metricsQuery.data.nextCursor);
              }}
              onPrevious={() => setMetricCursor(previousMetricCursor)}
              canGoPrevious={metricCursor !== undefined}
            />
          </div>
        )}
      </Panel>
    </section>
  );
}
