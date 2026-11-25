import { describe, expect, it } from 'vitest';
import {
  applyFencedHeartbeat,
  nextHaGeneration,
  planHaNodeRecovery,
  resolveHaFailoverRace,
  tryClaimHaOwnership,
  type HaOwnershipState,
} from '../src/ha.js';
import {
  applyDeploymentEvent,
  MAX_DEPLOYMENT_RECONCILIATION_ATTEMPTS,
  planDeploymentRetry,
  reconcileDeploymentOutcome,
  TERMINAL_DEPLOYMENT_STATES,
} from '../src/providers/coolify.js';
import { PaasQuotaReservationLedger, type QuotaReservationScope } from '../src/quota.js';

const OBSERVED_AT = '2026-11-24T00:00:00.000Z';

describe('CF-006 deployment state reconciliation', () => {
  it('documents allowed transitions and terminal states', () => {
    expect([...TERMINAL_DEPLOYMENT_STATES].sort()).toEqual(['failed', 'stopped']);

    const accepted = applyDeploymentEvent('pending', {
      kind: 'provider_started',
      observedAt: OBSERVED_AT,
    });
    expect(accepted).toMatchObject({ from: 'pending', to: 'building', changed: true });

    const succeeded = applyDeploymentEvent('building', {
      kind: 'provider_succeeded',
      observedAt: OBSERVED_AT,
    });
    expect(succeeded.to).toBe('running');
  });

  it('ignores out-of-order and duplicate events once a terminal state is committed', () => {
    const failed = applyDeploymentEvent('building', {
      kind: 'provider_failed',
      observedAt: OBSERVED_AT,
    });
    expect(failed.to).toBe('failed');

    const lateSuccess = applyDeploymentEvent('failed', {
      kind: 'provider_succeeded',
      observedAt: OBSERVED_AT,
      providerCorrelationId: 'dep-123',
    });
    expect(lateSuccess).toMatchObject({
      from: 'failed',
      to: 'failed',
      changed: false,
      terminalProtected: true,
      providerCorrelationId: 'dep-123',
    });

    const duplicateCancel = applyDeploymentEvent('stopped', {
      kind: 'provider_cancelled',
      observedAt: OBSERVED_AT,
    });
    expect(duplicateCancel.changed).toBe(false);
  });

  it('reconciles timeout-after-success without losing the provider correlation ID', () => {
    const timeout = applyDeploymentEvent('pending', {
      kind: 'provider_timeout',
      observedAt: OBSERVED_AT,
      providerCorrelationId: 'coolify-dep-1',
    });
    expect(timeout.to).toBe('unknown');

    const resolved = reconcileDeploymentOutcome(
      { state: 'unknown', providerCorrelationId: 'coolify-dep-1', attempts: 1 },
      'running'
    );
    expect(resolved).toMatchObject({
      state: 'running',
      resolved: true,
      needsOperatorReview: false,
      providerCorrelationId: 'coolify-dep-1',
    });
  });

  it('keeps cancellation final when a success event arrives afterwards', () => {
    const cancelled = applyDeploymentEvent('running', {
      kind: 'provider_cancelled',
      observedAt: OBSERVED_AT,
    });
    expect(cancelled.to).toBe('stopped');
    expect(
      applyDeploymentEvent('stopped', { kind: 'provider_succeeded', observedAt: OBSERVED_AT }).to
    ).toBe('stopped');
  });

  it('bounds ambiguous reconciliation and escalates after the attempt budget', () => {
    const first = reconcileDeploymentOutcome({ state: 'unknown', attempts: 0 }, 'ambiguous');
    const second = reconcileDeploymentOutcome({ state: 'unknown', attempts: 1 }, 'timeout');
    const exhausted = reconcileDeploymentOutcome(
      { state: 'unknown', attempts: 2, providerCorrelationId: 'dep-x' },
      'ambiguous'
    );

    expect(first).toMatchObject({ attemptsUsed: 1, resolved: false, needsOperatorReview: false });
    expect(second).toMatchObject({ attemptsUsed: 2, resolved: false });
    expect(MAX_DEPLOYMENT_RECONCILIATION_ATTEMPTS).toBe(2);
    expect(exhausted).toMatchObject({
      state: 'unknown',
      attemptsUsed: 2,
      resolved: false,
      needsOperatorReview: true,
      providerCorrelationId: 'dep-x',
    });
  });

  it('reuses a stable idempotency key and correlation ID across retries', () => {
    const first = planDeploymentRetry({
      deploymentId: 42,
      state: 'unknown',
      providerCorrelationId: 'dep-42',
      attempts: 0,
    });
    const second = planDeploymentRetry({
      deploymentId: 42,
      state: 'unknown',
      providerCorrelationId: 'dep-42',
      attempts: 1,
    });

    expect(first.idempotencyKey).toBe('deploy:42:dep-42');
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(second.providerCorrelationId).toBe('dep-42');
    expect(second.attempt).toBe(2);
    expect(second.shouldRetry).toBe(true);

    const terminal = planDeploymentRetry({
      deploymentId: 42,
      state: 'failed',
      providerCorrelationId: 'dep-42',
      attempts: 1,
    });
    expect(terminal.shouldRetry).toBe(false);
    expect(terminal.idempotencyKey).toBe(second.idempotencyKey);
  });
});

describe('CF-007 concurrency-safe quota reservation', () => {
  const scope: QuotaReservationScope = { companyId: 7, resource: 'ramMb' };

  it('never lets two concurrent requests consume the same remaining capacity', async () => {
    const ledger = new PaasQuotaReservationLedger();
    const [a, b] = await Promise.all([
      ledger.reserve({ scope, idempotencyKey: 'req-a', units: 3, capacity: 4 }),
      ledger.reserve({ scope, idempotencyKey: 'req-b', units: 3, capacity: 4 }),
    ]);

    expect([a?.allowed, b?.allowed].filter(Boolean)).toHaveLength(1);
    const denied = [a, b].find((result) => !result.allowed);
    expect(denied?.code).toBe('PAAS_QUOTA_RESERVATION_EXCEEDED');
    expect(ledger.snapshot(scope)).toMatchObject({
      capacity: 4,
      reservedUnits: 3,
      remainingUnits: 1,
    });
  });

  it('treats a retried reserve as an idempotent replay', async () => {
    const ledger = new PaasQuotaReservationLedger();
    const input = { scope, idempotencyKey: 'req-retry', units: 2, capacity: 5 };
    const first = await ledger.reserve(input);
    const replay = await ledger.reserve(input);

    expect(first.allowed).toBe(true);
    expect(replay).toMatchObject({ allowed: true, replay: true });
    expect(replay.reservation?.id).toBe(first.reservation?.id);
    expect(ledger.snapshot(scope).reservedUnits).toBe(2);
  });

  it('releases a failed reservation exactly once', async () => {
    const ledger = new PaasQuotaReservationLedger();
    const reservation = await ledger.reserve({
      scope,
      idempotencyKey: 'req-fail',
      units: 2,
      capacity: 5,
    });
    const firstRelease = await ledger.settle(reservation.reservation!.id, 'failure');
    const duplicateRelease = await ledger.settle(reservation.reservation!.id, 'failure');

    expect(firstRelease).toMatchObject({ changed: true, usageRecorded: false });
    expect(duplicateRelease).toMatchObject({ changed: false, usageRecorded: false });
    expect(ledger.snapshot(scope)).toMatchObject({
      reservedUnits: 0,
      committedUnits: 0,
      remainingUnits: 5,
    });
  });

  it('records usage exactly once under duplicate settlement', async () => {
    const ledger = new PaasQuotaReservationLedger();
    const reservation = await ledger.reserve({
      scope,
      idempotencyKey: 'req-ok',
      units: 4,
      capacity: 5,
    });
    const first = await ledger.settle(reservation.reservation!.id, 'success');
    const duplicate = await ledger.settle(reservation.reservation!.id, 'success');

    expect(first).toMatchObject({ changed: true, usageRecorded: true });
    expect(duplicate).toMatchObject({ changed: false, usageRecorded: false });
    expect(ledger.snapshot(scope)).toMatchObject({
      committedUnits: 4,
      reservedUnits: 0,
      remainingUnits: 1,
    });
  });

  it('denies over-commit without creating a reservation', async () => {
    const ledger = new PaasQuotaReservationLedger();
    const result = await ledger.reserve({
      scope,
      idempotencyKey: 'too-big',
      units: 6,
      capacity: 5,
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('PAAS_QUOTA_RESERVATION_EXCEEDED');
    expect(result.reservation).toBeUndefined();
    expect(ledger.snapshot(scope).reservedUnits).toBe(0);
  });
});

describe('CF-009 monotonic stale-target fencing', () => {
  const committed: HaOwnershipState = {
    targetId: 'target-a',
    generation: 4,
    claimedAtMs: 1_000,
    active: true,
    health_status: 'healthy',
  };

  it('issues strictly monotonic generations and rejects stale claims', () => {
    expect(nextHaGeneration(4)).toBe(5);
    expect(nextHaGeneration(-1)).toBe(1);

    const stale = tryClaimHaOwnership(committed, {
      targetId: 'target-b',
      generation: 3,
      claimedAtMs: 2_000,
    });
    expect(stale).toMatchObject({ granted: false, code: 'STALE_GENERATION' });
    expect(stale.state).toBe(committed);

    const conflict = tryClaimHaOwnership(committed, {
      targetId: 'target-b',
      generation: 4,
      claimedAtMs: 2_000,
    });
    expect(conflict.code).toBe('EQUAL_GENERATION_CONFLICT');

    const granted = tryClaimHaOwnership(committed, {
      targetId: 'target-b',
      generation: 5,
      claimedAtMs: 2_000,
    });
    expect(granted).toMatchObject({ granted: true });
    expect(granted.state).toMatchObject({ targetId: 'target-b', generation: 5, active: true });
  });

  it('drops stale heartbeats so a partitioned node cannot overwrite newer state', () => {
    const decision = applyFencedHeartbeat(committed, {
      targetId: 'target-a',
      generation: 2,
      health_status: 'healthy',
      observedAtMs: 5_000,
    });

    expect(decision.applied).toBe(false);
    expect(decision.state).toBe(committed);
    expect(decision.state.generation).toBe(4);
  });

  it('resolves concurrent failover claims deterministically regardless of arrival order', () => {
    const claims = [
      { targetId: 'target-c', generation: 6, claimedAtMs: 3_000 },
      { targetId: 'target-b', generation: 6, claimedAtMs: 2_000 },
      { targetId: 'target-a', generation: 7, claimedAtMs: 5_000 },
    ];
    const forward = resolveHaFailoverRace(claims);
    const reversed = resolveHaFailoverRace([...claims].reverse());

    expect(forward.winner?.targetId).toBe('target-a');
    expect(forward.winner).toEqual(reversed.winner);
    expect(forward.ordered.map((claim) => claim.targetId)).toEqual(
      reversed.ordered.map((claim) => claim.targetId)
    );
  });

  it('keeps a recovered old node as standby without an explicit newer claim', () => {
    const recovery = planHaNodeRecovery(committed, 'target-a', 4);
    expect(recovery).toMatchObject({ role: 'standby', generation: 4 });

    const promoted = planHaNodeRecovery(committed, 'target-c', 5);
    expect(promoted).toMatchObject({ role: 'active', generation: 5 });
  });
});
