import { createHash } from 'node:crypto';
import { redactTelemetry } from './redaction.js';
import type {
  DecodedLogs,
  DecodedMetrics,
  DecodedTraces,
  LogRecord,
  LogSeverity,
  MetricPoint,
  MetricSeries,
  MetricType,
  SpanEventRecord,
  SpanKind,
  SpanRecord,
  SpanStatus,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

const MAX_STRING_LENGTH = 2_048;
const MAX_ID_LENGTH = 128;
const MAX_BODY_LENGTH = 8_192;

// OTLP attribute keys are dotted lowercase identifiers (http.method, service.name,
// k8s.pod.uid). Restrict writes to that character set so a hostile telemetry payload
// cannot inject arbitrary object property names.
const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:\/\-]{0,255}$/u;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function asItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown, maxLength = MAX_STRING_LENGTH): string | undefined {
  return typeof value === 'string' ? value.slice(0, maxLength) : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readSafeInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string' || !/^-?\d+$/u.test(value)) return undefined;
  try {
    const parsed = BigInt(value);
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
      return undefined;
    }
    return Number(parsed);
  } catch {
    return undefined;
  }
}

function readNonNegativeSafeInteger(value: unknown): number | undefined {
  const parsed = readSafeInteger(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  const parsed = readNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function readNanos(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return undefined;
    return Number(BigInt(value) / 1_000_000n);
  }
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return undefined;
  try {
    const nanos = BigInt(value);
    if (nanos > 9_999_999_999_999_999_999n) return undefined;
    return Number(nanos / 1_000_000n);
  } catch {
    return undefined;
  }
}

function parseAnyValue(value: unknown, depth = 0): unknown {
  const record = asRecord(value);
  if (!record) return undefined;
  if (depth > 8) return '[MAX_DEPTH]';
  const variants = [
    'stringValue',
    'boolValue',
    'intValue',
    'doubleValue',
    'bytesValue',
    'arrayValue',
    'kvlistValue',
  ].filter((key) => record[key] !== undefined);
  if (variants.length !== 1) return undefined;

  if (typeof record.stringValue === 'string') return record.stringValue.slice(0, MAX_STRING_LENGTH);
  if (typeof record.boolValue === 'boolean') return record.boolValue;
  if (record.intValue !== undefined) {
    const parsed = readSafeInteger(record.intValue);
    if (parsed !== undefined) return parsed;
    return typeof record.intValue === 'string' && /^-?\d+$/u.test(record.intValue)
      ? record.intValue.slice(0, MAX_STRING_LENGTH)
      : undefined;
  }
  if (record.doubleValue !== undefined) return readNumber(record.doubleValue);
  if (typeof record.bytesValue === 'string') return record.bytesValue.slice(0, MAX_STRING_LENGTH);
  if (record.arrayValue !== undefined) {
    const array = asRecord(record.arrayValue);
    if (!array || !Array.isArray(array.values)) return undefined;
    return array.values.map((item) => parseAnyValue(item, depth + 1));
  }
  const list = asRecord(record.kvlistValue);
  return list && Array.isArray(list.values) ? parseAttributes(list.values) : undefined;
}

function parseAttributes(value: unknown): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const item of asItems(value)) {
    const entry = asRecord(item);
    const key = readString(entry?.key, 256);
    if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    if (!SAFE_KEY_PATTERN.test(key)) continue;
    const parsed = parseAnyValue(entry?.value);
    if (parsed !== undefined) attributes[key] = parsed;
  }
  return attributes;
}

function firstString(
  attributes: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

function firstNumber(
  attributes: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = readNonNegativeNumber(attributes[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstSafeInteger(
  attributes: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = readNonNegativeSafeInteger(attributes[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseResource(value: unknown): {
  attributes: Record<string, unknown>;
  serviceName: string;
} {
  const resource = asRecord(value);
  const attributes = parseAttributes(resource?.attributes);
  return {
    attributes,
    serviceName: firstString(attributes, ['service.name', 'serviceName']) ?? 'unknown',
  };
}

function parseScopeName(value: unknown): string | undefined {
  const scope = asRecord(value);
  return readString(scope?.name, 256);
}

function parseSpanKind(value: unknown): SpanKind {
  switch (value) {
    case 1:
    case '1':
      return 'internal';
    case 2:
    case '2':
      return 'server';
    case 3:
    case '3':
      return 'client';
    case 4:
    case '4':
      return 'producer';
    case 5:
    case '5':
      return 'consumer';
    default:
      return 'unspecified';
  }
}

function parseSpanStatus(value: unknown): { status: SpanStatus; message?: string } {
  const status = asRecord(value);
  const code = readNumber(status?.code);
  if (code === 2) {
    return { status: 'error', message: readString(status?.message) };
  }
  return { status: code === 1 ? 'ok' : 'unset' };
}

function parseSpanEvents(value: unknown, fallbackTimeMs: number): SpanEventRecord[] {
  const events: SpanEventRecord[] = [];
  for (const item of asItems(value)) {
    const event = asRecord(item);
    const name = readString(event?.name, 512);
    if (!name) continue;
    events.push({
      name,
      timestampMs: readNanos(event?.timeUnixNano) ?? fallbackTimeMs,
      attributes: parseAttributes(event?.attributes),
    });
  }
  return events;
}

function parseSpan(
  value: unknown,
  resourceAttributes: Record<string, unknown>,
  serviceName: string,
  scopeName?: string
): SpanRecord | undefined {
  const span = asRecord(value);
  const traceId = readString(span?.traceId, MAX_ID_LENGTH);
  const spanId = readString(span?.spanId, MAX_ID_LENGTH);
  const startTimeMs = readNanos(span?.startTimeUnixNano);
  if (!span || !traceId || !spanId || startTimeMs === undefined) return undefined;

  const endTimeMs = readNanos(span?.endTimeUnixNano) ?? startTimeMs;
  const attributes = parseAttributes(span.attributes);
  const parentSpanId = readString(span.parentSpanId, MAX_ID_LENGTH);
  const status = parseSpanStatus(span.status);
  const inputTokens = firstSafeInteger(attributes, [
    'gen_ai.usage.input_tokens',
    'gen_ai.usage.prompt_tokens',
    'moonwitness.tokens.input',
  ]);
  const outputTokens = firstSafeInteger(attributes, [
    'gen_ai.usage.output_tokens',
    'gen_ai.usage.completion_tokens',
    'moonwitness.tokens.output',
  ]);
  const totalTokens =
    firstSafeInteger(attributes, ['gen_ai.usage.total_tokens', 'moonwitness.tokens.total']) ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);

  return {
    traceId,
    spanId,
    ...(parentSpanId && !/^0+$/u.test(parentSpanId) ? { parentSpanId } : {}),
    name: readString(span.name, 512) ?? 'unnamed span',
    serviceName,
    ...(scopeName ? { scopeName } : {}),
    kind: parseSpanKind(span.kind),
    status: status.status,
    ...(status.message ? { statusMessage: status.message } : {}),
    startTimeMs,
    endTimeMs,
    durationMs: Math.max(0, endTimeMs - startTimeMs),
    runId:
      firstString(attributes, ['moonwitness.run_id', 'gen_ai.run.id', 'agent.run_id', 'run.id']) ??
      traceId,
    agentName: firstString(attributes, [
      'moonwitness.agent.name',
      'gen_ai.agent.name',
      'agent.name',
      'agent.id',
    ]),
    provider: firstString(attributes, [
      'moonwitness.provider',
      'gen_ai.provider.name',
      'gen_ai.system',
    ]),
    model: firstString(attributes, [
      'moonwitness.model',
      'gen_ai.request.model',
      'gen_ai.response.model',
    ]),
    toolName: firstString(attributes, ['moonwitness.tool.name', 'gen_ai.tool.name', 'tool.name']),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(firstNumber(attributes, [
      'moonwitness.cost_usd',
      'gen_ai.usage.cost_usd',
      'gen_ai.usage.cost',
    ]) !== undefined
      ? {
          costUsd: firstNumber(attributes, [
            'moonwitness.cost_usd',
            'gen_ai.usage.cost_usd',
            'gen_ai.usage.cost',
          ]),
        }
      : {}),
    attributes,
    resourceAttributes,
    events: parseSpanEvents(span.events, startTimeMs),
  };
}

export function decodeTraces(input: unknown): DecodedTraces {
  const request = asRecord(input);
  if (!request || (request.resourceSpans !== undefined && !Array.isArray(request.resourceSpans))) {
    return { valid: false, spans: [], rejected: 0 };
  }

  const spans: SpanRecord[] = [];
  let rejected = 0;
  for (const resourceItem of asItems(request.resourceSpans)) {
    const resourceSpans = asRecord(resourceItem);
    if (!resourceSpans) {
      rejected += 1;
      continue;
    }
    const resource = parseResource(resourceSpans.resource);
    for (const scopeItem of asItems(resourceSpans.scopeSpans)) {
      const scopeSpans = asRecord(scopeItem);
      if (!scopeSpans) {
        rejected += 1;
        continue;
      }
      const scopeName = parseScopeName(scopeSpans.scope);
      for (const spanItem of asItems(scopeSpans.spans)) {
        const span = parseSpan(spanItem, resource.attributes, resource.serviceName, scopeName);
        if (span) spans.push(span);
        else rejected += 1;
      }
    }
  }
  return { valid: true, spans, rejected };
}

function parseSeverity(value: unknown, text?: string): LogSeverity {
  const severity = readNumber(value);
  if (severity !== undefined) {
    if (severity >= 21) return 'FATAL';
    if (severity >= 17) return 'ERROR';
    if (severity >= 13) return 'WARN';
    if (severity >= 9) return 'INFO';
    if (severity >= 5) return 'DEBUG';
    if (severity >= 1) return 'TRACE';
  }
  switch (text?.toUpperCase()) {
    case 'TRACE':
    case 'DEBUG':
    case 'INFO':
    case 'WARN':
    case 'ERROR':
    case 'FATAL':
      return text.toUpperCase() as LogSeverity;
    default:
      return 'UNSPECIFIED';
  }
}

function stringifyBody(value: unknown): string {
  const redacted = redactTelemetry(value);
  if (typeof redacted === 'string') return redacted.slice(0, MAX_BODY_LENGTH);
  if (redacted === undefined) return '';
  try {
    return (JSON.stringify(redacted) ?? String(redacted)).slice(0, MAX_BODY_LENGTH);
  } catch {
    return String(redacted).slice(0, MAX_BODY_LENGTH);
  }
}

function parseLog(
  value: unknown,
  resourceAttributes: Record<string, unknown>,
  serviceName: string,
  scopeName?: string
): LogRecord | undefined {
  const log = asRecord(value);
  const timestampMs = readNanos(log?.observedTimeUnixNano) ?? readNanos(log?.timeUnixNano);
  if (!log || timestampMs === undefined) return undefined;
  const attributes = parseAttributes(log.attributes);
  const traceId = readString(log.traceId, MAX_ID_LENGTH);
  const spanId = readString(log.spanId, MAX_ID_LENGTH);
  const severityText = readString(log.severityText, 64);
  const body = stringifyBody(parseAnyValue(log.body));
  const identity = JSON.stringify([timestampMs, traceId, spanId, severityText, body]);
  const id = createHash('sha256').update(identity).digest('hex').slice(0, 20);

  return {
    id,
    timestampMs,
    serviceName,
    ...(scopeName ? { scopeName } : {}),
    severity: parseSeverity(log.severityNumber, severityText),
    ...(severityText ? { severityText } : {}),
    body,
    ...(traceId && !/^0+$/u.test(traceId) ? { traceId } : {}),
    ...(spanId && !/^0+$/u.test(spanId) ? { spanId } : {}),
    runId: firstString(attributes, [
      'moonwitness.run_id',
      'gen_ai.run.id',
      'agent.run_id',
      'run.id',
    ]),
    agentName: firstString(attributes, [
      'moonwitness.agent.name',
      'gen_ai.agent.name',
      'agent.name',
    ]),
    attributes,
    resourceAttributes,
  };
}

export function decodeLogs(input: unknown): DecodedLogs {
  const request = asRecord(input);
  if (!request || (request.resourceLogs !== undefined && !Array.isArray(request.resourceLogs))) {
    return { valid: false, logs: [], rejected: 0 };
  }

  const logs: LogRecord[] = [];
  let rejected = 0;
  for (const resourceItem of asItems(request.resourceLogs)) {
    const resourceLogs = asRecord(resourceItem);
    if (!resourceLogs) {
      rejected += 1;
      continue;
    }
    const resource = parseResource(resourceLogs.resource);
    for (const scopeItem of asItems(resourceLogs.scopeLogs)) {
      const scopeLogs = asRecord(scopeItem);
      if (!scopeLogs) {
        rejected += 1;
        continue;
      }
      const scopeName = parseScopeName(scopeLogs.scope);
      for (const logItem of asItems(scopeLogs.logRecords)) {
        const log = parseLog(logItem, resource.attributes, resource.serviceName, scopeName);
        if (log) logs.push(log);
        else rejected += 1;
      }
    }
  }
  return { valid: true, logs, rejected };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as UnknownRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function metricSeriesId(
  name: string,
  type: MetricType,
  serviceName: string,
  scopeName: string | undefined,
  attributes: Record<string, unknown>
): string {
  return createHash('sha256')
    .update(canonicalJson([name, type, serviceName, scopeName ?? '', attributes]))
    .digest('hex')
    .slice(0, 24);
}

function parseMetricPoint(value: unknown, type: MetricType): MetricPoint | undefined {
  const point = asRecord(value);
  const timestampMs = readNanos(point?.endTimeUnixNano) ?? readNanos(point?.timeUnixNano);
  if (!point || timestampMs === undefined) return undefined;
  const attributes = parseAttributes(point.attributes);
  const base = { timestampMs, attributes };

  if (type === 'gauge' || type === 'sum') {
    const measured = readNumber(point.asDouble) ?? readSafeInteger(point.asInt);
    return measured === undefined ? undefined : { ...base, value: measured };
  }

  const count = readNonNegativeSafeInteger(point.count);
  const sum = readNumber(point.sum);
  const min = readNumber(point.min);
  const max = readNumber(point.max);
  if (count === undefined && sum === undefined && min === undefined && max === undefined) {
    return undefined;
  }
  return {
    ...base,
    ...(count !== undefined ? { count } : {}),
    ...(sum !== undefined ? { sum } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
}

function parseMetric(
  value: unknown,
  serviceName: string,
  scopeName?: string
): { series: MetricSeries[]; rejected: number } {
  const metric = asRecord(value);
  const name = readString(metric?.name, 512);
  if (!metric || !name) return { series: [], rejected: 1 };

  const type = (['gauge', 'sum', 'histogram', 'exponentialHistogram', 'summary'] as const).find(
    (candidate) => metric[candidate] !== undefined
  );
  if (!type) return { series: [], rejected: 1 };
  const normalizedType: MetricType =
    type === 'exponentialHistogram' ? 'exponential_histogram' : type;
  const data = asRecord(metric[type]);
  const series = new Map<string, MetricSeries>();

  for (const pointItem of asItems(data?.dataPoints)) {
    const point = parseMetricPoint(pointItem, normalizedType);
    if (!point) {
      continue;
    }
    const id = metricSeriesId(name, normalizedType, serviceName, scopeName, point.attributes);
    const existing = series.get(id);
    if (existing) existing.points.push(point);
    else {
      series.set(id, {
        id,
        name,
        ...(readString(metric.description) ? { description: readString(metric.description) } : {}),
        ...(readString(metric.unit) ? { unit: readString(metric.unit) } : {}),
        type: normalizedType,
        serviceName,
        ...(scopeName ? { scopeName } : {}),
        points: [point],
      });
    }
  }

  return {
    series: [...series.values()],
    rejected: Math.max(
      0,
      asItems(data?.dataPoints).length -
        [...series.values()].reduce((total, item) => total + item.points.length, 0)
    ),
  };
}

export function decodeMetrics(input: unknown): DecodedMetrics {
  const request = asRecord(input);
  if (
    !request ||
    (request.resourceMetrics !== undefined && !Array.isArray(request.resourceMetrics))
  ) {
    return { valid: false, metrics: [], rejected: 0 };
  }

  const metrics: MetricSeries[] = [];
  let rejected = 0;
  for (const resourceItem of asItems(request.resourceMetrics)) {
    const resourceMetrics = asRecord(resourceItem);
    if (!resourceMetrics) {
      rejected += 1;
      continue;
    }
    const resource = parseResource(resourceMetrics.resource);
    for (const scopeItem of asItems(resourceMetrics.scopeMetrics)) {
      const scopeMetrics = asRecord(scopeItem);
      if (!scopeMetrics) {
        rejected += 1;
        continue;
      }
      const scopeName = parseScopeName(scopeMetrics.scope);
      for (const metricItem of asItems(scopeMetrics.metrics)) {
        const decoded = parseMetric(metricItem, resource.serviceName, scopeName);
        metrics.push(...decoded.series);
        rejected += decoded.rejected;
      }
    }
  }
  return { valid: true, metrics, rejected };
}
