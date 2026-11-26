/**
 * T42 — OTel sink for Plan-TaskOS lifecycle events.
 *
 * The SDK event contract is deliberately dependency-free; this adapter is the
 * outer workspace boundary that turns typed events into spans and metrics.
 * Only allow-listed scalar attributes are emitted — never raw command output,
 * secrets, or unredacted tool payloads.
 */
import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Meter,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { redactSensitiveText, type PlanLifecycleEvent, type PlanTelemetrySink } from '@moonwitness/plan-taskos';

export interface PlanTelemetrySinkOptions {
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly tracerName?: string;
  readonly meterName?: string;
}

export interface OtelPlanTelemetrySink extends PlanTelemetrySink {
  readonly tracer: Tracer;
  readonly meter: Meter;
}

const SPAN_NAMES: Readonly<Record<PlanLifecycleEvent['name'], string>> = {
  'task.claimed': 'plan.task.claimed',
  'task.verified': 'plan.task.verified',
  'task.proof_sealed': 'plan.task.proof_sealed',
  'task.retry_escalated': 'plan.task.retry_escalated',
  'task.blocked': 'plan.task.blocked',
  'wave.completed': 'plan.wave.completed',
  'sleep.invariant_proposed': 'plan.sleep.invariant_proposed',
};

const ALLOWED_ATTRIBUTE_KEYS = new Set([
  'plan.proof.sha256',
  'plan.task.urn',
  'plan.wave.id',
  'verify.exit_code',
  'attempts',
  'model_tier',
]);

function safeText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactSensitiveText(value).text;
}

function spanAttributes(event: PlanLifecycleEvent): Attributes {
  const attributes: Attributes = {
    'plan.id': safeText(event.planId),
    'plan.severity': event.severity,
  };
  const taskCode = safeText(event.taskCode);
  if (taskCode) attributes['plan.task.code'] = taskCode;
  const waveId = safeText(event.waveId);
  if (waveId) attributes['plan.wave.id'] = waveId;
  const modelTier = safeText(event.modelTier);
  if (modelTier) attributes['plan.model_tier'] = modelTier;
  if (typeof event.attempts === 'number') attributes['plan.attempts'] = event.attempts;
  const reason = safeText(event.reason);
  if (reason) attributes['plan.reason'] = reason;
  for (const [rawKey, value] of Object.entries(event.attributes ?? {})) {
    const key = rawKey.startsWith('plan.') ? rawKey : `plan.${rawKey}`;
    if (!ALLOWED_ATTRIBUTE_KEYS.has(key)) continue;
    attributes[key] = typeof value === 'string' ? safeText(value) ?? '' : value;
  }
  return attributes;
}

function closeSpan(span: Span, event: PlanLifecycleEvent): void {
  if (event.severity === 'error') {
    span.setStatus({ code: SpanStatusCode.ERROR, message: safeText(event.reason) ?? event.name });
  }
  span.end();
}

export function createOtelPlanTelemetrySink(
  options: PlanTelemetrySinkOptions = {}
): OtelPlanTelemetrySink {
  const tracer = options.tracer ?? trace.getTracer(options.tracerName ?? 'moonwitness-plan-taskos');
  const meter = options.meter ?? metrics.getMeter(options.meterName ?? 'moonwitness-plan-taskos');
  const duration = meter.createHistogram('plan_task_duration_ms', {
    description: 'Plan-TaskOS task lifecycle duration in milliseconds',
    unit: 'ms',
  });
  const completions = meter.createCounter('plan_task_completions_total', {
    description: 'Completed Plan-TaskOS tasks',
  });
  const retries = meter.createCounter('plan_task_retries_total', {
    description: 'Plan-TaskOS retry escalations',
  });

  return {
    tracer,
    meter,
    emit(event: PlanLifecycleEvent): void {
      const attributes = spanAttributes(event);
      const span = tracer.startSpan(SPAN_NAMES[event.name], {
        attributes,
        startTime: new Date(event.timestamp),
      });
      switch (event.name) {
        case 'task.verified': {
          const durationRaw = event.attributes?.['duration_ms'];
          if (typeof durationRaw === 'number' && Number.isFinite(durationRaw)) {
            duration.record(durationRaw, attributes);
          }
          completions.add(1, attributes);
          break;
        }
        case 'task.retry_escalated':
          retries.add(1, attributes);
          break;
        default:
          break;
      }
      closeSpan(span, event);
    },
  };
}
