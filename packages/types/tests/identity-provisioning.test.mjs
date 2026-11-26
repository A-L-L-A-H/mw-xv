import assert from 'node:assert';
import test from 'node:test';
import {
  PROVISIONING_SCHEMA_VERSION,
  PROVISIONING_EVENT_TYPES,
  ACCOUNT_STATES,
  isAccountCreatedPayload,
  isAccountDisabledPayload,
  isAccountReactivatedPayload,
  isProvisioningPayload,
  isProvisioningEvent,
  computeEventId,
  parseProvisioningEvent,
} from '../dist/identity-provisioning.js';

test('exports have expected constants', () => {
  assert.equal(PROVISIONING_SCHEMA_VERSION, 1);
  assert.deepEqual(PROVISIONING_EVENT_TYPES, ['account.created', 'account.disabled', 'account.reactivated']);
  assert.deepEqual(ACCOUNT_STATES, ['enabled', 'disabled']);
});

test('isAccountCreatedPayload accepts valid payload and rejects invalid', async () => {
  const valid = {
    subject: '9f1c0e3a-6f0b-4a3e-9c22-0a4b7c6d8e91',
    account_state: 'enabled',
    display_identifier: 'user@example.com',
    correlation_id: 'acc-01-example-0001',
    occurred_at: '2026-11-26T17:30:00.000Z',
  };
  assert.strictEqual(isAccountCreatedPayload(valid), true);

  // missing display_identifier
  assert.strictEqual(isAccountCreatedPayload({ ...valid, display_identifier: '' }), false);
  assert.strictEqual(isAccountCreatedPayload({ ...valid, display_identifier: undefined }), false);
  // wrong account_state
  assert.strictEqual(isAccountCreatedPayload({ ...valid, account_state: 'disabled' }), false);
  // empty subject
  assert.strictEqual(isAccountCreatedPayload({ ...valid, subject: '' }), false);
  // missing correlation_id
  assert.strictEqual(isAccountCreatedPayload({ ...valid, correlation_id: '' }), false);
  // invalid occurred_at
  assert.strictEqual(isAccountCreatedPayload({ ...valid, occurred_at: 'not-a-date' }), false);
  assert.strictEqual(isAccountCreatedPayload({ ...valid, occurred_at: '2026-11-26T17:30:00.000+01:00' }), false);
  // rejects unknown / credential fields
  assert.strictEqual(isAccountCreatedPayload({ ...valid, password_hash: 'secret' }), false);
  assert.strictEqual(isAccountCreatedPayload({ ...valid, refresh_token: 'tok' }), false);
  assert.strictEqual(isAccountCreatedPayload({ ...valid, mfa_secret: 'totp' }), false);
  assert.strictEqual(isAccountCreatedPayload({ ...valid, private_key: 'pem' }), false);
  assert.strictEqual(isAccountCreatedPayload({ ...valid, raw_setup_secret: 'sec' }), false);
  assert.strictEqual(isAccountCreatedPayload({ ...valid, extra_field: 'unexpected' }), false);
});

test('isAccountDisabledPayload accepts valid payload and rejects invalid', async () => {
  const valid = {
    subject: '9f1c0e3a-6f0b-4a3e-9c22-0a4b7c6d8e91',
    account_state: 'disabled',
    correlation_id: 'acc-01-example-0001',
    occurred_at: '2026-11-26T17:35:00.000Z',
  };
  assert.strictEqual(isAccountDisabledPayload(valid), true);

  // wrong account_state
  assert.strictEqual(isAccountDisabledPayload({ ...valid, account_state: 'enabled' }), false);
  // empty subject
  assert.strictEqual(isAccountDisabledPayload({ ...valid, subject: '' }), false);
  // missing correlation_id
  assert.strictEqual(isAccountDisabledPayload({ ...valid, correlation_id: '' }), false);
  // rejects unknown fields
  assert.strictEqual(isAccountDisabledPayload({ ...valid, extra_field: 'unexpected' }), false);
});

test('isAccountReactivatedPayload accepts valid payload and rejects invalid', async () => {
  const valid = {
    subject: '9f1c0e3a-6f0b-4a3e-9c22-0a4b7c6d8e91',
    account_state: 'enabled',
    correlation_id: 'acc-01-example-0001',
    occurred_at: '2026-11-26T17:40:00.000Z',
  };
  assert.strictEqual(isAccountReactivatedPayload(valid), true);

  // has display_identifier (should fail - only account.created has it)
  assert.strictEqual(isAccountReactivatedPayload({ ...valid, display_identifier: 'user@example.com' }), false);
  // wrong account_state
  assert.strictEqual(isAccountReactivatedPayload({ ...valid, account_state: 'disabled' }), false);
  // rejects unknown fields
  assert.strictEqual(isAccountReactivatedPayload({ ...valid, extra_field: 'unexpected' }), false);
});

test('isProvisioningPayload discriminates correctly', async () => {
  const created = {
    subject: 'sub-1',
    account_state: 'enabled',
    display_identifier: 'a@b.com',
    correlation_id: 'corr-1',
    occurred_at: '2026-11-26T17:30:00.000Z',
  };
  const disabled = {
    subject: 'sub-1',
    account_state: 'disabled',
    correlation_id: 'corr-1',
    occurred_at: '2026-11-26T17:35:00.000Z',
  };
  const reactivated = {
    subject: 'sub-1',
    account_state: 'enabled',
    correlation_id: 'corr-1',
    occurred_at: '2026-11-26T17:40:00.000Z',
  };

  assert.strictEqual(isProvisioningPayload(created), true);
  assert.strictEqual(isProvisioningPayload(disabled), true);
  assert.strictEqual(isProvisioningPayload(reactivated), true);

  // invalid: empty subject
  assert.strictEqual(isProvisioningPayload({ ...created, subject: '' }), false);
  // invalid: unknown account_state
  assert.strictEqual(isProvisioningPayload({ ...created, account_state: 'unknown' }), false);
  // invalid: missing correlation_id
  assert.strictEqual(isProvisioningPayload({ ...created, correlation_id: '' }), false);
});

test('isProvisioningEvent validates complete envelope', async () => {
  const eventId = await computeEventId('account.created', 'sub-1', 'corr-1');
  const validEvent = {
    id: 'env-uuid-123',
    event_id: eventId,
    event_type: 'account.created',
    schema_version: PROVISIONING_SCHEMA_VERSION,
    payload: {
      subject: 'sub-1',
      account_state: 'enabled',
      display_identifier: 'user@example.com',
      correlation_id: 'corr-1',
      occurred_at: '2026-11-26T17:30:00.000Z',
    },
    created_at: '2026-11-26T17:30:00.000Z',
    attempt_count: 0,
    next_attempt_at: '2026-11-26T17:30:00.000Z',
    claimed_at: null,
    delivered_at: null,
  };

  assert.strictEqual(isProvisioningEvent(validEvent), true);

  // unknown event_type
  assert.strictEqual(isProvisioningEvent({ ...validEvent, event_type: 'account.unknown' }), false);
  // wrong schema_version (future)
  assert.strictEqual(isProvisioningEvent({ ...validEvent, schema_version: 2 }), false);
  // missing event_id
  assert.strictEqual(isProvisioningEvent({ ...validEvent, event_id: '' }), false);
  // invalid payload
  assert.strictEqual(isProvisioningEvent({ ...validEvent, payload: { ...validEvent.payload, subject: '' } }), false);
  // mismatched event_type and payload
  assert.strictEqual(isProvisioningEvent({ ...validEvent, event_type: 'account.disabled' }), false);
  assert.strictEqual(isProvisioningEvent({ ...validEvent, event_type: 'account.reactivated' }), false);
  // invalid ISO timestamps
  assert.strictEqual(isProvisioningEvent({ ...validEvent, created_at: 'not-a-date' }), false);
  assert.strictEqual(isProvisioningEvent({ ...validEvent, next_attempt_at: 'not-a-date' }), false);
  assert.strictEqual(isProvisioningEvent({ ...validEvent, claimed_at: 'not-a-date' }), false);
});

test('computeEventId produces stable deterministic IDs', async () => {
  const id1 = await computeEventId('account.created', 'sub-1', 'corr-1');
  const id2 = await computeEventId('account.created', 'sub-1', 'corr-1');
  assert.strictEqual(id1, id2);
  assert.strictEqual(id1.length, 64); // sha256 hex = 64 chars

  // Different inputs produce different IDs
  const id3 = await computeEventId('account.disabled', 'sub-1', 'corr-1');
  assert.notStrictEqual(id1, id3);
  const id4 = await computeEventId('account.created', 'sub-2', 'corr-1');
  assert.notStrictEqual(id1, id4);
  const id5 = await computeEventId('account.created', 'sub-1', 'corr-2');
  assert.notStrictEqual(id1, id5);
});

test('parseProvisioningEvent throws on invalid input', async () => {
  const eventId = await computeEventId('account.created', 'sub-1', 'corr-1');
  const validEvent = {
    id: 'env-uuid-123',
    event_id: eventId,
    event_type: 'account.created',
    schema_version: PROVISIONING_SCHEMA_VERSION,
    payload: {
      subject: 'sub-1',
      account_state: 'enabled',
      display_identifier: 'user@example.com',
      correlation_id: 'corr-1',
      occurred_at: '2026-11-26T17:30:00.000Z',
    },
    created_at: '2026-11-26T17:30:00.000Z',
    attempt_count: 0,
    next_attempt_at: '2026-11-26T17:30:00.000Z',
    claimed_at: null,
    delivered_at: null,
  };

  const parsed = parseProvisioningEvent(validEvent);
  assert.strictEqual(parsed.event_type, 'account.created');
  assert.strictEqual(parsed.payload.subject, 'sub-1');

  // Should throw on invalid
  assert.throws(() => parseProvisioningEvent({ ...validEvent, schema_version: 2 }), /failed schema validation/);
  assert.throws(() => parseProvisioningEvent(null), /failed schema validation/);
  assert.throws(() => parseProvisioningEvent('not-an-object'), /failed schema validation/);
});
