import type { LogRecord, MetricPoint, MetricSeries, SpanRecord } from '../src/types.js';

export const NOW_MS = 1_700_000_000_000;

export function makeSpan(overrides: Partial<SpanRecord> = {}): SpanRecord {
  return {
    traceId: 'trace-1',
    spanId: 'span-1',
    name: 'agent.run',
    serviceName: 'agent-service',
    kind: 'server',
    status: 'ok',
    startTimeMs: NOW_MS,
    endTimeMs: NOW_MS + 100,
    durationMs: 100,
    runId: 'run-1',
    attributes: {},
    resourceAttributes: {},
    events: [],
    ...overrides,
  };
}

export function makeLog(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    id: 'log-1',
    timestampMs: NOW_MS + 50,
    serviceName: 'agent-service',
    severity: 'INFO',
    body: 'Agent started',
    traceId: 'trace-1',
    spanId: 'span-1',
    runId: 'run-1',
    attributes: {},
    resourceAttributes: {},
    ...overrides,
  };
}

export function makePoint(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    timestampMs: NOW_MS,
    value: 1,
    attributes: {},
    ...overrides,
  };
}

export function makeSeries(overrides: Partial<MetricSeries> = {}): MetricSeries {
  return {
    id: 'metric-1',
    name: 'agent.tool.calls',
    description: 'Tool calls',
    unit: '1',
    type: 'sum',
    serviceName: 'agent-service',
    points: [makePoint()],
    ...overrides,
  };
}
