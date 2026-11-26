import { Knex } from 'knex';
import { User, Partner } from '@moonwitness/orm-base';
import {
  isAccountCreatedPayload,
  isAccountDisabledPayload,
  isAccountReactivatedPayload,
  PROVISIONING_SCHEMA_VERSION,
  type AccountCreatedPayload,
  type AccountDisabledPayload,
  type AccountReactivatedPayload,
} from '@moonwitness/types';

export const IDENTITY_PROVISIONING_CONSUMER_NAME = 'identity-provisioning-consumer';
export const DEFAULT_MAX_RETRIES = 5;

export interface ProvisioningConsumerOptions {
  readonly db: Knex;
  readonly clock: { now: () => Date };
  readonly maxRetries?: number;
  readonly logger?: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  };
}

export interface ProcessedEventRecord {
  event_id: string;
  processed_at: string;
  event_type: string;
  schema_version: number;
  subject: string;
}

export interface ConsumptionResult {
  ok: boolean;
  status: 'processed' | 'duplicate' | 'invalid_event' | 'unknown_version' | 'validation_failed' | 'db_error';
  eventId?: string;
  error?: string;
}

interface ProvisioningEventEnvelope {
  readonly id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly schema_version: number;
  readonly payload: unknown;
  readonly created_at: string;
  readonly attempt_count: number;
  readonly next_attempt_at: string;
  readonly claimed_at: string | null;
  readonly delivered_at: string | null;
}

function buildProcessedEventTable() {
  return {
    name: 'identity_provisioning_processed_events',
    columns: {
      event_id: 'text not null primary key',
      processed_at: 'timestamptz not null default now()',
      event_type: 'text not null',
      schema_version: 'integer not null',
      subject: 'text not null',
    },
  };
}

async function ensureProcessedEventTable(db: Knex): Promise<void> {
  const exists = await db.schema.hasTable('identity_provisioning_processed_events');
  if (!exists) {
    await db.schema.createTable('identity_provisioning_processed_events', (table) => {
      table.text('event_id').notNullable().primary();
      table.timestamp('processed_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      table.text('event_type').notNullable();
      table.integer('schema_version').notNullable();
      table.text('subject').notNullable();
    });
  }
}

async function isEventProcessed(db: Knex, eventId: string): Promise<boolean> {
  const row = await db('identity_provisioning_processed_events')
    .where({ event_id: eventId })
    .first();
  return row !== undefined;
}

async function recordProcessedEvent(
  trx: Knex.Transaction,
  event: ProvisioningEventEnvelope
): Promise<void> {
  await trx('identity_provisioning_processed_events').insert({
    event_id: event.event_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    subject: (event.payload as Record<string, unknown>).subject as string,
  });
}

async function upsertBusinessUser(
  trx: Knex.Transaction,
  payload: AccountCreatedPayload
): Promise<void> {
  const displayValue = payload.display_identifier.trim();

  let partnerId: number;
  const existingPartner = await Partner.query(trx)
    .where({ email: displayValue })
    .first();

  if (existingPartner) {
    partnerId = existingPartner.id;
  } else {
    const partner = await Partner.query(trx)
      .insert({
        name: displayValue,
        email: displayValue,
        is_company: false,
      })
      .returning('*');
    partnerId = Number(partner.id);
  }

  const existingUser = await User.query(trx)
    .where({ identity_subject: payload.subject })
    .first();

  if (existingUser) {
    await User.query(trx)
      .findById(existingUser.id)
      .patch({
        active: true,
        partner_id: partnerId,
      });
    return;
  }

  await User.query(trx).insert({
    identity_subject: payload.subject,
    login: displayValue,
    partner_id: partnerId,
    role: 'user',
    token_version: 1,
    active: true,
  });
}

async function setBusinessUserActive(
  trx: Knex.Transaction,
  subject: string,
  active: boolean
): Promise<void> {
  await User.query(trx)
    .where({ identity_subject: subject })
    .patch({ active });
}

function validateEnvelopeStructure(event: unknown): event is ProvisioningEventEnvelope {
  if (!event || typeof event !== 'object') return false;
  const obj = event as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.trim().length === 0) return false;
  if (typeof obj.event_id !== 'string' || obj.event_id.trim().length === 0) return false;
  if (typeof obj.event_type !== 'string') return false;
  if (typeof obj.schema_version !== 'number') return false;
  if (!obj.payload || typeof obj.payload !== 'object') return false;
  if (typeof obj.created_at !== 'string') return false;
  if (typeof obj.attempt_count !== 'number') return false;
  if (typeof obj.next_attempt_at !== 'string') return false;
  if (obj.claimed_at !== null && typeof obj.claimed_at !== 'string') return false;
  if (obj.delivered_at !== null && typeof obj.delivered_at !== 'string') return false;
  return true;
}

function validatePayloadForEventType(
  event: ProvisioningEventEnvelope
): { valid: boolean; error?: string } {
  const payload = event.payload;

  switch (event.event_type) {
    case 'account.created':
      if (!isAccountCreatedPayload(payload)) {
        return { valid: false, error: 'Invalid account.created payload' };
      }
      break;
    case 'account.disabled':
      if (!isAccountDisabledPayload(payload)) {
        return { valid: false, error: 'Invalid account.disabled payload' };
      }
      break;
    case 'account.reactivated':
      if (!isAccountReactivatedPayload(payload)) {
        return { valid: false, error: 'Invalid account.reactivated payload' };
      }
      break;
    default:
      return { valid: false, error: `Unknown event_type: ${event.event_type}` };
  }
  return { valid: true };
}

export async function consumeProvisioningEvent(
  event: unknown,
  options: ProvisioningConsumerOptions
): Promise<ConsumptionResult> {
  const { db, clock, maxRetries = DEFAULT_MAX_RETRIES, logger } = options;

  // Check envelope structure first
  if (!validateEnvelopeStructure(event)) {
    return { ok: false, status: 'invalid_event', error: 'Event envelope structure invalid' };
  }

  // Check unknown version BEFORE full schema validation to return 'unknown_version' status
  if (event.schema_version !== PROVISIONING_SCHEMA_VERSION) {
    return {
      ok: false,
      status: 'unknown_version',
      eventId: event.event_id,
      error: `Unsupported schema version: ${event.schema_version}`,
    };
  }

  const validation = validatePayloadForEventType(event);
  if (!validation.valid) {
    return {
      ok: false,
      status: 'validation_failed',
      eventId: event.event_id,
      error: validation.error,
    };
  }

  await ensureProcessedEventTable(db);

  if (await isEventProcessed(db, event.event_id)) {
    logger?.info('Duplicate identity provisioning event ignored', { eventId: event.event_id });
    return { ok: true, status: 'duplicate', eventId: event.event_id };
  }

  try {
    await db.transaction(async (trx) => {
      switch (event.event_type) {
        case 'account.created':
          await upsertBusinessUser(trx, event.payload as AccountCreatedPayload);
          break;
        case 'account.disabled':
          await setBusinessUserActive(trx, (event.payload as Record<string, unknown>).subject as string, false);
          break;
        case 'account.reactivated':
          await setBusinessUserActive(trx, (event.payload as Record<string, unknown>).subject as string, true);
          break;
      }
      await recordProcessedEvent(trx, event);
    });

    logger?.info('Identity provisioning event processed', { eventId: event.event_id, type: event.event_type });
    return { ok: true, status: 'processed', eventId: event.event_id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error('Identity provisioning event processing failed', { eventId: event.event_id, error: message });
    return { ok: false, status: 'db_error', eventId: event.event_id, error: message };
  }
}

export async function runProvisioningConsumer(
  events: readonly unknown[],
  options: ProvisioningConsumerOptions
): Promise<ConsumptionResult[]> {
  const results: ConsumptionResult[] = [];
  for (const event of events) {
    const result = await consumeProvisioningEvent(event, options);
    results.push(result);
    // Hard failures (not duplicate) stop the batch; unknown_version is a hard failure per contract
    if (!result.ok && result.status !== 'duplicate') {
      break;
    }
  }
  return results;
}
