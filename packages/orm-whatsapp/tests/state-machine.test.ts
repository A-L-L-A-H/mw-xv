import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  GowaError,
  ReconnectStormBreaker,
  WebhookDeduplicator,
  WHATSAPP_LIFECYCLE_STATES,
  isWhatsAppLifecycleState,
  normalizeGowaError,
  planOrphanDeviceRepair,
  transitionAccountState,
} from '../src/index.js';

describe('Wave F.30 WhatsApp account lifecycle state machine', () => {
  it('covers all 8 lifecycle states and validates legal vs illegal transitions', () => {
    assert.equal(WHATSAPP_LIFECYCLE_STATES.length, 8);
    for (const state of WHATSAPP_LIFECYCLE_STATES) {
      assert.equal(isWhatsAppLifecycleState(state), true);
    }
    assert.equal(isWhatsAppLifecycleState('unknown_state'), false);

    const qr = transitionAccountState('uninitialized', 'QR_ISSUED');
    assert.equal(qr.valid, true);
    assert.equal(qr.nextState, 'qr_pending');

    const expired = transitionAccountState('qr_pending', 'QR_EXPIRED');
    assert.equal(expired.valid, true);
    assert.equal(expired.nextState, 'qr_expired');

    const connected = transitionAccountState('qr_pending', 'CONNECTED');
    assert.equal(connected.valid, true);
    assert.equal(connected.nextState, 'connected');

    const orphan = transitionAccountState('connected', 'ORPHAN_DETECTED');
    assert.equal(orphan.valid, true);
    assert.equal(orphan.nextState, 'disconnected');

    const invalid = transitionAccountState('blocked', 'CONNECTED');
    assert.equal(invalid.valid, false);
    assert.equal(invalid.nextState, 'blocked');
  });

  it('plans orphan-device repair when DB is connected but GoWA v9.6.0 device is missing or unlinked', () => {
    const missingPlan = planOrphanDeviceRepair({
      accountId: 42,
      companyId: 1,
      dbStatus: 'connected',
      deviceId: 'dev-123',
      gatewayDeviceIds: ['dev-999'],
    });
    assert.equal(missingPlan.isOrphan, true);
    assert.equal(missingPlan.nextStatus, 'disconnected');
    assert.equal(missingPlan.recreateSlot, true);
    assert.equal(missingPlan.preserveAccountId, 42);
    assert.equal(missingPlan.patchFields.status, 'disconnected');
    assert.equal(missingPlan.patchFields.qr_code, null);

    const unlinkedPlan = planOrphanDeviceRepair({
      accountId: 42,
      companyId: 1,
      dbStatus: 'connected',
      deviceId: 'dev-123',
      gatewayDeviceIds: ['dev-123'],
      gatewayDeviceConnected: false,
    });
    assert.equal(unlinkedPlan.isOrphan, true);
    assert.equal(unlinkedPlan.nextStatus, 'disconnected');
    assert.equal(unlinkedPlan.recreateSlot, false);

    const healthyPlan = planOrphanDeviceRepair({
      accountId: 42,
      companyId: 1,
      dbStatus: 'connected',
      deviceId: 'dev-123',
      gatewayDeviceIds: ['dev-123'],
      gatewayDeviceConnected: true,
    });
    assert.equal(healthyPlan.isOrphan, false);
    assert.equal(healthyPlan.recreateSlot, false);
  });

  it('normalizes GoWA v9.6.0 HTTP 500-on-missing-device and other gateway errors', () => {
    const missing500 = normalizeGowaError(
      new GowaError('WhatsApp gateway request failed (500)', 500, 'INTERNAL_ERROR'),
      'device not found in session store'
    );
    assert.equal(missing500.category, 'device_missing');
    assert.equal(missing500.httpStatus, 409);
    assert.equal(missing500.shouldDemoteToDisconnected, true);
    assert.equal(missing500.shouldTriggerOrphanRepair, true);
    assert.equal(missing500.retryable, false);

    const rateLimited = normalizeGowaError(new GowaError('Too many requests', 429, 'RATE_LIMITED'));
    assert.equal(rateLimited.category, 'rate_limited');
    assert.equal(rateLimited.retryable, true);

    const blocked = normalizeGowaError(new GowaError('Account banned', 403));
    assert.equal(blocked.category, 'auth_blocked');
    assert.equal(blocked.shouldDemoteToDisconnected, true);

    const unavailable = normalizeGowaError(new GowaError('Circuit open', 503, 'CIRCUIT_OPEN'));
    assert.equal(unavailable.category, 'gateway_unavailable');
    assert.equal(unavailable.retryable, true);
  });

  it('enforces reconnect-storm exponential backoff with jitter and max-attempt circuit breaker', () => {
    const breaker = new ReconnectStormBreaker({
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      maxAttempts: 3,
      jitterRatio: 0.2,
      cooldownMs: 60_000,
      rng: () => 0.5, // zero jitter offset for deterministic verification
    });

    const t0 = 1_000_000;
    assert.equal(breaker.canAttempt('acct:1', t0).allowed, true);

    const f1 = breaker.recordFailure('acct:1', t0);
    assert.equal(f1.attempts, 1);
    assert.equal(f1.circuitOpen, false);
    assert.equal(f1.retryAfterMs, 1_000);
    assert.equal(breaker.canAttempt('acct:1', t0 + 500).allowed, false);
    assert.equal(breaker.canAttempt('acct:1', t0 + 1_000).allowed, true);

    const f2 = breaker.recordFailure('acct:1', t0 + 1_000);
    assert.equal(f2.attempts, 2);
    assert.equal(f2.retryAfterMs, 2_000);

    const f3 = breaker.recordFailure('acct:1', t0 + 3_000);
    assert.equal(f3.attempts, 3);
    assert.equal(f3.circuitOpen, true);
    assert.equal(f3.recommendedState, 'gateway_error');
    assert.equal(breaker.canAttempt('acct:1', t0 + 10_000).allowed, false);
    assert.equal(breaker.canAttempt('acct:1', t0 + 63_000).allowed, true);

    breaker.recordSuccess('acct:1');
    assert.equal(breaker.getState('acct:1'), null);
  });

  it('deduplicates inbound webhook messages per (companyId, messageId) within TTL window', () => {
    const dedup = new WebhookDeduplicator({ windowMs: 10_000, maxEntries: 3 });
    const t0 = 500_000;

    assert.equal(dedup.tryAcquire(1, 'msg-a', t0), true);
    assert.equal(dedup.tryAcquire(1, 'msg-a', t0 + 1_000), false);
    // Different companyId is isolated
    assert.equal(dedup.tryAcquire(2, 'msg-a', t0 + 1_000), true);
    // After TTL expires, messageId is accepted again
    assert.equal(dedup.tryAcquire(1, 'msg-a', t0 + 10_001), true);

    // Capacity eviction keeps size bounded
    dedup.tryAcquire(1, 'msg-b', t0 + 10_002);
    dedup.tryAcquire(1, 'msg-c', t0 + 10_003);
    dedup.tryAcquire(1, 'msg-d', t0 + 10_004);
    assert.ok(dedup.size <= 3);
  });
});
