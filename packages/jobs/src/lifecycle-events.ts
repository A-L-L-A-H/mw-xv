import type { Transaction } from 'objection';
import { OutboxEvent } from './models.js';

export type ModelLifecycleEventKind =
  | 'record.created'
  | 'record.updated'
  | 'record.archived'
  | 'record.deleted'
  | `record.action_${string}`;

export interface PublishLifecycleEventOptions {
  eventType: ModelLifecycleEventKind;
  model: string;
  recordId: number | string;
  companyId?: number | null;
  actorId?: number | null;
  snapshot?: Record<string, unknown>;
  hiddenFields?: readonly string[];
  sensitiveFields?: readonly string[];
  dedupeKey?: string;
  transaction?: Transaction;
}

const DEFAULT_REDACTED_KEYS = new Set(['password', 'password_hash', 'secret', 'token']);

/** Strips hidden/sensitive fields from a record snapshot before writing to outbox. */
export function redactLifecyclePayload(
  snapshot: Record<string, unknown> | undefined,
  hiddenFields: readonly string[] = [],
  sensitiveFields: readonly string[] = []
): Record<string, unknown> {
  if (!snapshot) return {};
  const blocked = new Set<string>([...DEFAULT_REDACTED_KEYS, ...hiddenFields, ...sensitiveFields]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (blocked.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Publishes a standardized model lifecycle event into `base.outbox_event` with redacted payload. */
export async function publishModelLifecycleEvent(
  options: PublishLifecycleEventOptions
): Promise<unknown> {
  const payload = {
    model: options.model,
    record_id: options.recordId,
    company_id: options.companyId ?? null,
    actor_id: options.actorId ?? null,
    snapshot: redactLifecyclePayload(
      options.snapshot,
      options.hiddenFields,
      options.sensitiveFields
    ),
  };

  const nowIso = new Date().toISOString();
  return OutboxEvent.query(options.transaction).insert({
    event_type: options.eventType,
    aggregate_model: options.model,
    aggregate_id: Number(options.recordId),
    company_id: options.companyId ?? undefined,
    payload: JSON.stringify(payload),
    status: 'pending',
    available_at: nowIso,
    created_at: nowIso,
  });
}
