import { isRecord } from './guards.js';

/**
 * Schema version for the Identity-to-Business provisioning contract.
 * Current version = 1 (I43).
 * Increment for breaking changes; additive compatible changes may reuse version.
 */
export const PROVISIONING_SCHEMA_VERSION = 1 as const;

/**
 * Supported event types in this contract.
 */
export const PROVISIONING_EVENT_TYPES = [
  'account.created',
  'account.disabled',
  'account.reactivated',
] as const;

export type ProvisioningEventType = (typeof PROVISIONING_EVENT_TYPES)[number];

/**
 * Valid account states for provisioning events.
 */
export const ACCOUNT_STATES = ['enabled', 'disabled'] as const;

export type AccountState = (typeof ACCOUNT_STATES)[number];

const ACCOUNT_CREATED_KEYS = new Set([
  'subject',
  'account_state',
  'display_identifier',
  'correlation_id',
  'occurred_at',
]);

const ACCOUNT_STATE_CHANGE_KEYS = new Set([
  'subject',
  'account_state',
  'correlation_id',
  'occurred_at',
]);

function hasOnlyAllowedKeys(record: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

/**
 * Base payload fields shared by all provisioning events.
 */
export interface BaseProvisioningPayload {
  /** Opaque OIDC subject (UUIDv4-style). Never empty. */
  subject: string;
  /** Account state at the time of the event. */
  account_state: AccountState;
  /** Stable identifier of the originating Identity account operation. */
  correlation_id: string;
  /** ISO 8601 UTC timestamp when the account lifecycle change occurred. */
  occurred_at: string;
}

/**
 * Payload for `account.created` events.
 * Includes display_identifier for provisioning context (never used for matching).
 */
export interface AccountCreatedPayload extends BaseProvisioningPayload {
  account_state: 'enabled';
  /** Human-readable identifier (email/login) for context only. Never used for linking. */
  display_identifier: string;
}

/**
 * Payload for `account.disabled` events.
 */
export interface AccountDisabledPayload extends BaseProvisioningPayload {
  account_state: 'disabled';
}

/**
 * Payload for `account.reactivated` events.
 */
export interface AccountReactivatedPayload extends BaseProvisioningPayload {
  account_state: 'enabled';
}

/**
 * Discriminated union of all provisioning payloads.
 */
export type ProvisioningPayload =
  | AccountCreatedPayload
  | AccountDisabledPayload
  | AccountReactivatedPayload;

/**
 * Complete provisioning event envelope (matches identity.outbox_event row + parsed payload).
 */
export interface ProvisioningEvent {
  /** Envelope UUID (new per outbox row). */
  id: string;
  /** Stable content-based event ID for idempotency (see contract §3). */
  event_id: string;
  /** One of the known event types. */
  event_type: ProvisioningEventType;
  /** Explicit schema version. */
  schema_version: number;
  /** Parsed event payload. */
  payload: ProvisioningPayload;
  /** Envelope creation timestamp (ISO 8601 UTC). */
  created_at: string;
  attempt_count: number;
  next_attempt_at: string;
  claimed_at: string | null;
  delivered_at: string | null;
}

/**
 * Validates that a value is a well-formed ISO 8601 UTC timestamp string.
 */
function isIso8601Utc(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // Basic ISO 8601 UTC regex: YYYY-MM-DDTHH:mm:ss.sssZ
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value);
}

/**
 * Validates that a string is a non-empty opaque subject.
 */
function isValidSubject(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates that a string is a non-empty correlation ID.
 */
function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates an account state value.
 */
function isValidAccountState(value: unknown): value is AccountState {
  return typeof value === 'string' && ACCOUNT_STATES.includes(value as AccountState);
}

/**
 * Validates an event type value.
 */
function isValidEventType(value: unknown): value is ProvisioningEventType {
  return typeof value === 'string' && PROVISIONING_EVENT_TYPES.includes(value as ProvisioningEventType);
}

/**
 * Validates the payload for an `account.created` event.
 */
export function isAccountCreatedPayload(value: unknown): value is AccountCreatedPayload {
  if (!isRecord(value)) return false;
  if (!hasOnlyAllowedKeys(value, ACCOUNT_CREATED_KEYS)) return false;
  if (!isValidSubject(value.subject)) return false;
  if (!isValidAccountState(value.account_state)) return false;
  if (value.account_state !== 'enabled') return false;
  if (!isValidCorrelationId(value.correlation_id)) return false;
  if (!isIso8601Utc(value.occurred_at)) return false;
  if (typeof value.display_identifier !== 'string' || value.display_identifier.trim().length === 0) return false;
  return true;
}

/**
 * Validates the payload for an `account.disabled` event.
 */
export function isAccountDisabledPayload(value: unknown): value is AccountDisabledPayload {
  if (!isRecord(value)) return false;
  if (!hasOnlyAllowedKeys(value, ACCOUNT_STATE_CHANGE_KEYS)) return false;
  if (!isValidSubject(value.subject)) return false;
  if (!isValidAccountState(value.account_state)) return false;
  if (value.account_state !== 'disabled') return false;
  if (!isValidCorrelationId(value.correlation_id)) return false;
  if (!isIso8601Utc(value.occurred_at)) return false;
  return true;
}

/**
 * Validates the payload for an `account.reactivated` event.
 */
export function isAccountReactivatedPayload(value: unknown): value is AccountReactivatedPayload {
  if (!isRecord(value)) return false;
  if (!hasOnlyAllowedKeys(value, ACCOUNT_STATE_CHANGE_KEYS)) return false;
  if (!isValidSubject(value.subject)) return false;
  if (!isValidAccountState(value.account_state)) return false;
  if (value.account_state !== 'enabled') return false;
  if (!isValidCorrelationId(value.correlation_id)) return false;
  if (!isIso8601Utc(value.occurred_at)) return false;
  return true;
}

/**
 * Validates any provisioning payload based on its account_state discriminant.
 */
export function isProvisioningPayload(value: unknown): value is ProvisioningPayload {
  if (!isRecord(value)) return false;
  if (!isValidSubject(value.subject)) return false;
  if (!isValidAccountState(value.account_state)) return false;
  if (!isValidCorrelationId(value.correlation_id)) return false;
  if (!isIso8601Utc(value.occurred_at)) return false;

  switch (value.account_state) {
    case 'enabled':
      if ('display_identifier' in value) {
        return isAccountCreatedPayload(value);
      }
      return isAccountReactivatedPayload(value);
    case 'disabled':
      return isAccountDisabledPayload(value);
    default:
      return false;
  }
}

function isPayloadMatchingEventType(eventType: ProvisioningEventType, payload: unknown): boolean {
  switch (eventType) {
    case 'account.created':
      return isAccountCreatedPayload(payload);
    case 'account.disabled':
      return isAccountDisabledPayload(payload);
    case 'account.reactivated':
      return isAccountReactivatedPayload(payload);
    default:
      return false;
  }
}

/**
 * Validates a complete provisioning event envelope.
 * Fails closed on unknown schema_version or missing required fields.
 */
export function isProvisioningEvent(value: unknown): value is ProvisioningEvent {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return false;
  if (typeof value.event_id !== 'string' || value.event_id.trim().length === 0) return false;
  if (!isValidEventType(value.event_type)) return false;
  if (typeof value.schema_version !== 'number' || value.schema_version !== PROVISIONING_SCHEMA_VERSION) return false;
  if (!isPayloadMatchingEventType(value.event_type, value.payload)) return false;
  if (!isIso8601Utc(value.created_at)) return false;
  if (typeof value.attempt_count !== 'number' || value.attempt_count < 0) return false;
  if (!isIso8601Utc(value.next_attempt_at)) return false;
  if (value.claimed_at !== null && !isIso8601Utc(value.claimed_at)) return false;
  if (value.delivered_at !== null && !isIso8601Utc(value.delivered_at)) return false;
  return true;
}

/**
 * Computes the stable `event_id` for a provisioning event.
 * Matches the contract §3 construction:
 *   sha256_hex(`${event_type}|${subject}|${schema_version}|${correlation_id}`)
 */
export async function computeEventId(
  eventType: ProvisioningEventType,
  subject: string,
  correlationId: string
): Promise<string> {
  const message = `${eventType}|${subject}|${PROVISIONING_SCHEMA_VERSION}|${correlationId}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Parses and validates a raw outbox row into a ProvisioningEvent.
 * Throws on validation failure (fail-closed).
 */
export function parseProvisioningEvent(raw: unknown): ProvisioningEvent {
  if (!isProvisioningEvent(raw)) {
    throw new Error('Invalid provisioning event: failed schema validation');
  }
  return raw;
}
