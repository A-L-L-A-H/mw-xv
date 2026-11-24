import type { Knex } from 'knex';
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
import { REVISION_STATE_KEY } from './manifest.js';
import {
  TelemetryLog,
  TelemetryMetricPoint,
  TelemetryMetricSeries,
  TelemetrySpan,
  TelemetryState,
} from './models.js';
import { redactTelemetry } from './redaction.js';
import type {
  IngestResult,
  LogQuery,
  LogRecord,
  MetricPoint,
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

interface PayloadRow {
  payload_json: string;
}

interface SpanRow extends PayloadRow {
  id: number;
}

interface LogRow extends PayloadRow {
  id: number;
}

interface MetricSeriesRow extends PayloadRow {
  id: number;
  series_id: string;
}

interface MetricPointRow extends PayloadRow {
  series_id: string;
  timestamp_ms: number;
}

interface StateRow {
  key: string;
  value: number | string;
}

function parsePayload<T>(row: PayloadRow): T {
  return JSON.parse(row.payload_json) as T;
}

function spanRow(span: SpanRecord): Record<string, unknown> {
  return {
    trace_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId ?? null,
    name: span.name,
    service_name: span.serviceName,
    run_id: span.runId,
    agent_name: span.agentName ?? null,
    status: span.status,
    start_time_ms: span.startTimeMs,
    end_time_ms: span.endTimeMs,
    duration_ms: span.durationMs,
    payload_json: JSON.stringify(span),
  };
}

function logRow(log: LogRecord): Record<string, unknown> {
  return {
    log_id: log.id,
    timestamp_ms: log.timestampMs,
    service_name: log.serviceName,
    severity: log.severity,
    trace_id: log.traceId ?? null,
    span_id: log.spanId ?? null,
    run_id: log.runId ?? null,
    agent_name: log.agentName ?? null,
    payload_json: JSON.stringify(log),
  };
}

function metricSeriesRow(series: MetricSeries): Record<string, unknown> {
  return {
    series_id: series.id,
    name: series.name,
    description: series.description ?? null,
    unit: series.unit ?? null,
    metric_type: series.type,
    service_name: series.serviceName,
    scope_name: series.scopeName ?? null,
    latest_time_ms: latestMetricTime(series),
    payload_json: JSON.stringify(series),
  };
}

function metricPointRow(seriesId: string, point: MetricPoint): MetricPointRow {
  return {
    series_id: seriesId,
    timestamp_ms: point.timestampMs,
    payload_json: JSON.stringify(point),
  };
}

async function rowCount(db: Knex, table: string): Promise<number> {
  const row = await db(table).count('* as count').first();
  return Number(row?.count ?? 0);
}

async function readRevision(db: Knex): Promise<number> {
  const row = await db<StateRow>(TelemetryState.tableName)
    .where({ key: REVISION_STATE_KEY })
    .first();
  if (!row) throw new Error('Observability addon is not installed: revision state is missing');
  return Number(row.value);
}

async function loadSpans(db: Knex): Promise<SpanRecord[]> {
  const rows = await db<SpanRow>(TelemetrySpan.tableName)
    .select('id', 'payload_json')
    .orderBy('id', 'asc');
  return rows.map((row) => parsePayload<SpanRecord>(row));
}

async function loadLogs(db: Knex): Promise<LogRecord[]> {
  const rows = await db<LogRow>(TelemetryLog.tableName)
    .select('id', 'payload_json')
    .orderBy('id', 'asc');
  return rows.map((row) => parsePayload<LogRecord>(row));
}

async function loadMetricSeries(db: Knex): Promise<MetricSeries[]> {
  const rows = await db<MetricSeriesRow>(TelemetryMetricSeries.tableName)
    .select('id', 'payload_json')
    .orderBy('id', 'asc');
  return rows.map((row) => parsePayload<MetricSeries>(row));
}

export class SqlTelemetryStore implements TelemetryStore {
  readonly limits: TelemetryLimits;
  private readonly db: Knex;
  private readonly now: () => number;
  private closing?: Promise<void>;

  constructor(db: Knex, options: TelemetryStoreOptions = {}) {
    const resolved = resolveTelemetryOptions(options);
    this.limits = resolved.limits;
    this.now = resolved.now;
    this.db = db;
  }

  async getRevision(): Promise<number> {
    return readRevision(this.db);
  }

  async ingestSpans(input: readonly SpanRecord[]): Promise<IngestResult> {
    return this.runWrite(async (trx) => {
      const revision = await readRevision(trx);
      let changed = (await this.prune(trx)) > 0;
      let spanCount = await rowCount(trx, TelemetrySpan.tableName);
      let accepted = 0;
      let rejected = 0;

      for (const span of input) {
        const existing = await trx(TelemetrySpan.tableName)
          .where({ trace_id: span.traceId, span_id: span.spanId })
          .first('id');
        if (existing) {
          accepted += 1;
          continue;
        }
        if (spanCount >= this.limits.maxSpans) {
          rejected += 1;
          continue;
        }
        const redacted = redactTelemetry(span);
        if (serializedBytes(redacted) > MAX_RECORD_BYTES) {
          rejected += 1;
          continue;
        }
        await trx(TelemetrySpan.tableName)
          .insert(spanRow(redacted))
          .onConflict(['trace_id', 'span_id'])
          .ignore();
        spanCount += 1;
        accepted += 1;
        changed = true;
      }

      if ((await this.prune(trx)) > 0) changed = true;
      if (changed) await this.writeRevision(trx, revision + 1);
      return { accepted, rejected };
    });
  }

  async ingestLogs(input: readonly LogRecord[]): Promise<IngestResult> {
    return this.runWrite(async (trx) => {
      const revision = await readRevision(trx);
      let changed = (await this.prune(trx)) > 0;
      let logCount = await rowCount(trx, TelemetryLog.tableName);
      let accepted = 0;
      let rejected = 0;

      for (const log of input) {
        const existing = await trx(TelemetryLog.tableName).where({ log_id: log.id }).first('id');
        if (existing) {
          accepted += 1;
          continue;
        }
        if (logCount >= this.limits.maxLogs) {
          rejected += 1;
          continue;
        }
        const redacted = redactTelemetry(log);
        if (serializedBytes(redacted) > MAX_RECORD_BYTES) {
          rejected += 1;
          continue;
        }
        await trx(TelemetryLog.tableName).insert(logRow(redacted)).onConflict('log_id').ignore();
        logCount += 1;
        accepted += 1;
        changed = true;
      }

      if ((await this.prune(trx)) > 0) changed = true;
      if (changed) await this.writeRevision(trx, revision + 1);
      return { accepted, rejected };
    });
  }

  async ingestMetrics(input: readonly MetricSeries[]): Promise<IngestResult> {
    return this.runWrite(async (trx) => {
      const revision = await readRevision(trx);
      let changed = (await this.prune(trx)) > 0;
      let seriesCount = await rowCount(trx, TelemetryMetricSeries.tableName);
      let accepted = 0;
      let rejected = 0;

      for (const incoming of input) {
        const prepared = prepareMetricSeries(incoming, this.limits.maxMetricPoints);
        rejected += prepared.rejected;
        if (!prepared.series) continue;
        const series = prepared.series;
        const existingRow = await trx<MetricSeriesRow>(TelemetryMetricSeries.tableName)
          .where({ series_id: series.id })
          .first('id', 'payload_json');

        if (existingRow) {
          const existing = parsePayload<MetricSeries>(existingRow);
          const merged = mergeMetricPoints(
            existing.points,
            series.points,
            this.limits.maxMetricPoints
          );
          accepted += merged.accepted;
          rejected += merged.rejected;
          if (merged.changed > 0) {
            const updated = { ...existing, points: merged.points };
            for (const point of updated.points) {
              const row = metricPointRow(updated.id, point);
              await trx(TelemetryMetricPoint.tableName)
                .insert(row)
                .onConflict(['series_id', 'timestamp_ms'])
                .merge({ payload_json: row.payload_json });
            }
            if (merged.rejected > 0 && updated.points[0]) {
              await trx(TelemetryMetricPoint.tableName)
                .where({ series_id: updated.id })
                .where('timestamp_ms', '<', updated.points[0].timestampMs)
                .delete();
            }
            await trx(TelemetryMetricSeries.tableName)
              .where({ id: existingRow.id })
              .update({
                latest_time_ms: latestMetricTime(updated),
                payload_json: JSON.stringify(updated),
              });
            changed = true;
          }
          continue;
        }

        if (seriesCount >= this.limits.maxMetricSeries) {
          const oldest = await trx<MetricSeriesRow>(TelemetryMetricSeries.tableName)
            .orderBy('id', 'asc')
            .first('id', 'series_id', 'payload_json');
          if (oldest) {
            rejected += parsePayload<MetricSeries>(oldest).points.length;
            await trx(TelemetryMetricPoint.tableName)
              .where({ series_id: oldest.series_id })
              .delete();
            await trx(TelemetryMetricSeries.tableName).where({ id: oldest.id }).delete();
            seriesCount -= 1;
          }
        }

        const merged = mergeMetricPoints([], series.points, this.limits.maxMetricPoints);
        const stored = { ...series, points: merged.points };
        await trx(TelemetryMetricSeries.tableName)
          .insert(metricSeriesRow(stored))
          .onConflict('series_id')
          .ignore();
        for (const point of stored.points) {
          const row = metricPointRow(stored.id, point);
          await trx(TelemetryMetricPoint.tableName)
            .insert(row)
            .onConflict(['series_id', 'timestamp_ms'])
            .merge({ payload_json: row.payload_json });
        }
        seriesCount += 1;
        accepted += prepared.accepted;
        rejected += merged.rejected;
        changed = true;
      }

      if ((await this.prune(trx)) > 0) changed = true;
      if (changed) await this.writeRevision(trx, revision + 1);
      return { accepted, rejected };
    });
  }

  async listTraces(query: TraceQuery = {}): Promise<TraceSummary[]> {
    const limit = boundedLimit(query.limit);
    const search = query.query?.trim().toLowerCase().slice(0, 256) ?? '';
    const status = query.status?.toLowerCase() ?? 'all';
    const traces = new Map<string, SpanRecord[]>();

    for (const span of await loadSpans(this.db)) {
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
    return this.db.transaction(async (trx) => {
      const spanRows = await trx<SpanRow>(TelemetrySpan.tableName)
        .where('trace_id', traceId)
        .select('id', 'payload_json')
        .orderBy('id', 'asc');
      const spans = spanRows
        .map((row) => parsePayload<SpanRecord>(row))
        .sort(
          (left, right) =>
            left.startTimeMs - right.startTimeMs || left.spanId.localeCompare(right.spanId)
        );
      if (spans.length === 0) return undefined;
      const logRows = await trx<LogRow>(TelemetryLog.tableName)
        .where('trace_id', traceId)
        .select('id', 'payload_json')
        .orderBy('id', 'asc');
      const logs = logRows
        .map((row) => parsePayload<LogRecord>(row))
        .sort((left, right) => left.timestampMs - right.timestampMs);
      return { summary: summarizeTrace(traceId, spans), spans, logs };
    });
  }

  async listLogs(query: LogQuery = {}): Promise<LogRecord[]> {
    const limit = boundedLimit(query.limit);
    const search = query.query?.trim().toLowerCase().slice(0, 256) ?? '';
    const severity = query.severity?.toUpperCase() ?? '';
    let rowsQuery = this.db<LogRow>(TelemetryLog.tableName)
      .select('id', 'payload_json')
      .orderBy('id', 'asc');
    if (severity && severity !== 'ALL') rowsQuery = rowsQuery.where('severity', severity);

    const logs = (await rowsQuery)
      .map((row) => parsePayload<LogRecord>(row))
      .filter((log) => {
        if (!search) return true;
        return `${log.body} ${log.serviceName} ${log.agentName ?? ''} ${JSON.stringify(log.attributes)}`
          .toLowerCase()
          .includes(search);
      })
      .sort((left, right) => right.timestampMs - left.timestampMs);
    return logs.slice(0, limit);
  }

  async listMetrics(query: MetricQuery = {}): Promise<MetricSeries[]> {
    const limit = boundedLimit(query.limit);
    const search = query.query?.trim().toLowerCase().slice(0, 256) ?? '';
    const series = await loadMetricSeries(this.db);
    return series
      .filter((item) => {
        if (!search) return true;
        return `${item.name} ${item.serviceName} ${item.unit ?? ''} ${item.description ?? ''}`
          .toLowerCase()
          .includes(search);
      })
      .sort((left, right) => latestMetricTime(right) - latestMetricTime(left))
      .slice(0, limit)
      .map((item) => ({ ...item, points: [...item.points] }));
  }

  async summary(): Promise<TelemetrySummary> {
    return this.db.transaction(async (trx) => {
      const revision = await readRevision(trx);
      const [spans, logs, metrics] = await Promise.all([
        loadSpans(trx),
        loadLogs(trx),
        loadMetricSeries(trx),
      ]);
      return summarizeRecords(spans, logs, metrics, revision);
    });
  }

  async close(): Promise<void> {
    this.closing ??= this.db.destroy();
    await this.closing;
  }

  private async runWrite<T>(operation: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (trx) => {
      // A no-op state update acquires the database write lock before capacity and
      // dedupe reads. This serializes writers even on SQLite, where FOR UPDATE is
      // not supported, without changing the logical revision.
      await trx<StateRow>(TelemetryState.tableName)
        .where({ key: REVISION_STATE_KEY })
        .update({ value: trx.ref('value') });
      return operation(trx);
    });
  }

  private async writeRevision(trx: Knex.Transaction, revision: number): Promise<void> {
    await trx<StateRow>(TelemetryState.tableName)
      .where({ key: REVISION_STATE_KEY })
      .update({ value: revision });
  }

  private async prune(trx: Knex.Transaction): Promise<number> {
    const cutoff = this.now() - this.limits.retentionMs;
    const deletedSpans = await trx(TelemetrySpan.tableName)
      .where('start_time_ms', '<', cutoff)
      .where('end_time_ms', '<', cutoff)
      .delete();
    const deletedLogs = await trx(TelemetryLog.tableName)
      .where('timestamp_ms', '<', cutoff)
      .delete();
    const affected = await trx<{ series_id: string }>(TelemetryMetricPoint.tableName)
      .distinct('series_id')
      .where('timestamp_ms', '<', cutoff);
    const deletedPoints = await trx(TelemetryMetricPoint.tableName)
      .where('timestamp_ms', '<', cutoff)
      .delete();
    let removed = Number(deletedSpans) + Number(deletedLogs) + Number(deletedPoints);

    for (const { series_id: seriesId } of affected) {
      const row = await trx<MetricSeriesRow>(TelemetryMetricSeries.tableName)
        .where({ series_id: seriesId })
        .first('id', 'payload_json');
      if (!row) continue;
      const series = parsePayload<MetricSeries>(row);
      const points = series.points.filter((point) => point.timestampMs >= cutoff);
      removed += series.points.length - points.length;
      if (points.length === 0) {
        await trx(TelemetryMetricSeries.tableName).where({ id: row.id }).delete();
        removed += 1;
      } else if (points.length !== series.points.length) {
        const updated = { ...series, points };
        await trx(TelemetryMetricSeries.tableName)
          .where({ id: row.id })
          .update({
            latest_time_ms: latestMetricTime(updated),
            payload_json: JSON.stringify(updated),
          });
      }
    }
    return removed;
  }
}
