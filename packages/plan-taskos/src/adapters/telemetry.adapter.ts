/**
 * T28c — Zero-Dependency Telemetry & Operator Notification Event Adapters.
 *
 * Defines typed lifecycle-event SPIs (`PlanTelemetrySink`, `OperatorAlertSink`)
 * consumable by `apps/agent-observability` (OTel) and `apps/whatsapp` /
 * `orm-notification`. No direct `@opentelemetry/*` imports (INV-004).
 */

/** Typed Plan-TaskOS lifecycle event names. */
export type PlanLifecycleEventName =
  | "task.claimed"
  | "task.verified"
  | "task.proof_sealed"
  | "task.retry_escalated"
  | "task.blocked"
  | "wave.completed"
  | "sleep.invariant_proposed";

export type PlanLifecycleSeverity = "info" | "warn" | "error";

export interface PlanLifecycleEvent {
  readonly name: PlanLifecycleEventName;
  readonly severity: PlanLifecycleSeverity;
  readonly planId: string;
  readonly taskCode?: string;
  readonly waveId?: string;
  /** Attempt count after escalation / circuit breaker trip. */
  readonly attempts?: number;
  /** Model tier that attempted (or would attempt next). */
  readonly modelTier?: string;
  readonly reason?: string;
  readonly timestamp: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Telemetry sink SPI. Implementations forward events to OTel
 * (`apps/agent-observability`) or any other observability backend.
 */
export interface PlanTelemetrySink {
  emit(event: PlanLifecycleEvent): void;
}

/** Severity implied by each lifecycle event name. */
export const EVENT_DEFAULT_SEVERITY: Readonly<
  Record<PlanLifecycleEventName, PlanLifecycleSeverity>
> = {
  "task.claimed": "info",
  "task.verified": "info",
  "task.proof_sealed": "info",
  "task.retry_escalated": "warn",
  "task.blocked": "error",
  "wave.completed": "info",
  "sleep.invariant_proposed": "warn",
};

/**
 * Events that should surface to a human operator (WhatsApp / orm-notification
 * pagers). Everything else stays telemetry-only.
 */
export const OPERATOR_ALERT_EVENTS: ReadonlySet<PlanLifecycleEventName> = new Set([
  "task.retry_escalated",
  "task.blocked",
  "sleep.invariant_proposed",
]);

/**
 * Operator alert sink SPI (WhatsApp bot, notification service, ...).
 */
export interface OperatorAlertSink {
  alert(event: PlanLifecycleEvent, message: string): void;
}

/**
 * Deterministic one-line human message for an operator-facing event.
 */
export function renderOperatorAlertMessage(event: PlanLifecycleEvent): string {
  const subject = event.taskCode ?? event.waveId ?? event.planId;
  switch (event.name) {
    case "task.retry_escalated":
      return `⚠️ ${subject}: retry #${event.attempts ?? 1} escalated to '${event.modelTier ?? "next tier"}' — ${event.reason ?? "verify failed"}`;
    case "task.blocked":
      return `⛔ ${subject}: blocked after ${event.attempts ?? 0} attempts — ${event.reason ?? "circuit breaker tripped"}`;
    case "sleep.invariant_proposed":
      return `🧠 ${subject}: sleep consolidation proposed invariant — ${event.reason ?? "review required"}`;
    default:
      return `${event.name}: ${subject} — ${event.reason ?? ""}`.trim();
  }
}

/**
 * Fan-out sink dispatching every event to all registered sinks. Pure and
 * synchronous; sinks own any async/network behavior.
 */
export class FanoutTelemetrySink implements PlanTelemetrySink {
  private readonly sinks: readonly PlanTelemetrySink[];

  constructor(sinks: readonly PlanTelemetrySink[]) {
    this.sinks = sinks;
  }

  emit(event: PlanLifecycleEvent): void {
    for (const sink of this.sinks) {
      sink.emit(event);
    }
  }
}

/**
 * Telemetry sink that additionally pages the operator alert sink whenever an
 * event name is in `OPERATOR_ALERT_EVENTS`.
 */
export class AlertingTelemetrySink implements PlanTelemetrySink {
  constructor(
    private readonly telemetry: PlanTelemetrySink,
    private readonly alerts: OperatorAlertSink
  ) {}

  emit(event: PlanLifecycleEvent): void {
    this.telemetry.emit(event);
    if (OPERATOR_ALERT_EVENTS.has(event.name)) {
      this.alerts.alert(event, renderOperatorAlertMessage(event));
    }
  }
}

/**
 * No-op sink (default when no telemetry backend is wired).
 */
export class NullTelemetrySink implements PlanTelemetrySink {
  emit(_event: PlanLifecycleEvent): void {
    /* intentionally empty */
  }
}
