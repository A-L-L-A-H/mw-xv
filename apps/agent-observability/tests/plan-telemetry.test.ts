/**
 * T42 — OTel plan lifecycle sink tests with in-memory tracer/meter stubs.
 */
import { describe, expect, it } from 'vitest';
import type { Attributes, Counter, Histogram, Meter, Span, SpanOptions, Tracer } from '@opentelemetry/api';
import type { PlanLifecycleEvent } from '@moonwitness/plan-taskos';
import { createOtelPlanTelemetrySink } from '../src/plan-telemetry.js';
import { createOtelPlanTelemetrySink as exportedSink } from '../src/index.js';

interface RecordedSpan {
  name: string;
  attributes: Attributes | undefined;
  readonly options: SpanOptions | undefined;
  status?: { code: number; message?: string };
  ended: boolean;
}

class FakeSpan implements Span {
  status: { code: number; message?: string } | undefined;
  ended = false;
  readonly events: Array<{ name: string; attributes?: Attributes }> = [];
  constructor(private readonly record: RecordedSpan) {}

  setAttributes(attributes: Attributes): this {
    this.record.attributes = { ...this.record.attributes, ...attributes };
    return this;
  }
  setAttribute(key: string, value: Attributes[string]): this {
    return this.setAttributes({ [key]: value });
  }
  setStatus(status: { code: number; message?: string }): this {
    this.status = status;
    this.record.status = status;
    return this;
  }
  end(): void {
    this.ended = true;
    this.record.ended = true;
  }
  addEvent(name: string, attributes?: Attributes): this {
    this.events.push({ name, attributes });
    return this;
  }
  recordException(_exception: unknown, _time?: number | Date): void {}
  addLink(): this {
    return this;
  }
  addLinks(): this {
    return this;
  }
  updateName(name: string): this {
    (this.record as { name: string }).name = name;
    return this;
  }
  isRecording(): boolean {
    return !this.ended;
  }
  get spanContext(): never {
    throw new Error('not used');
  }
}

function fakeTracer(spans: RecordedSpan[]): Tracer {
  return {
    startSpan(name: string, options?: SpanOptions): Span {
      const record: RecordedSpan = { name, attributes: options?.attributes, options, ended: false };
      spans.push(record);
      return new FakeSpan(record);
    },
    startActiveSpan<T>(_name: string, _fn: unknown): T {
      throw new Error('not used');
    },
  } as unknown as Tracer;
}

function fakeMeter(calls: {
  durations: Array<{ value: number; attributes?: Attributes }>;
  completions: Array<{ value: number; attributes?: Attributes }>;
  retries: Array<{ value: number; attributes?: Attributes }>;
}): Meter {
  return {
    createHistogram: () =>
      ({
        record(value: number, attributes?: Attributes) {
          calls.durations.push({ value, attributes });
        },
      }) as unknown as Histogram,
    createCounter: (name: string) =>
      ({
        add(value: number, attributes?: Attributes) {
          const target = name.includes('retries') ? calls.retries : calls.completions;
          target.push({ value, attributes });
        },
      }) as unknown as Counter,
  } as unknown as Meter;
}

function event(overrides: Partial<PlanLifecycleEvent> = {}): PlanLifecycleEvent {
  return {
    name: 'task.verified',
    severity: 'info',
    planId: 'plan-taskos-cognitive-workgraph',
    taskCode: 'T42',
    modelTier: 'flash',
    attempts: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    attributes: { 'plan.proof.sha256': 'a'.repeat(64), 'api_key': 'sk-secret-do-not-emit' },
    ...overrides,
  };
}

describe('createOtelPlanTelemetrySink', () => {
  it('is exported from the package barrel', () => {
    expect(exportedSink).toBe(createOtelPlanTelemetrySink);
  });

  it('emits named spans with only allow-listed redacted attributes', () => {
    const spans: RecordedSpan[] = [];
    const calls = { durations: [], completions: [], retries: [] };
    const sink = createOtelPlanTelemetrySink({
      tracer: fakeTracer(spans),
      meter: fakeMeter(calls),
    });
    sink.emit(event());

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('plan.task.verified');
    expect(spans[0]?.attributes).toMatchObject({
      'plan.id': 'plan-taskos-cognitive-workgraph',
      'plan.task.code': 'T42',
      'plan.model_tier': 'flash',
      'plan.attempts': 1,
      'plan.proof.sha256': 'a'.repeat(64),
    });
    expect(JSON.stringify(spans[0]?.attributes)).not.toContain('sk-secret-do-not-emit');
    expect(spans[0]?.ended).toBe(true);
  });

  it('records duration, completion, and retry metrics for lifecycle events', () => {
    const spans: RecordedSpan[] = [];
    const calls = { durations: [], completions: [], retries: [] };
    const sink = createOtelPlanTelemetrySink({
      tracer: fakeTracer(spans),
      meter: fakeMeter(calls),
    });
    sink.emit(event({ attributes: { duration_ms: 42 } }));
    sink.emit(event({ name: 'task.retry_escalated', severity: 'warn' }));

    expect(calls.durations).toEqual([{ value: 42, attributes: expect.any(Object) }]);
    expect(calls.completions).toHaveLength(1);
    expect(calls.retries).toHaveLength(1);
    expect(spans.map((entry) => entry.name)).toEqual([
      'plan.task.verified',
      'plan.task.retry_escalated',
    ]);
  });

  it('marks error-severity spans as errors and maps wave / blocked names', () => {
    const spans: RecordedSpan[] = [];
    const sink = createOtelPlanTelemetrySink({
      tracer: fakeTracer(spans),
      meter: fakeMeter({ durations: [], completions: [], retries: [] }),
    });
    sink.emit(event({ name: 'task.blocked', severity: 'error', reason: 'circuit breaker' }));
    sink.emit(event({ name: 'wave.completed', taskCode: undefined, waveId: 'W6' }));

    expect(spans[0]?.name).toBe('plan.task.blocked');
    expect(spans[0]?.status?.code).toBe(2);
    expect(spans[1]?.name).toBe('plan.wave.completed');
    expect(spans[1]?.attributes).toMatchObject({ 'plan.wave.id': 'W6' });
  });
});
