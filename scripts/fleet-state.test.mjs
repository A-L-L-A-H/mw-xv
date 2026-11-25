import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNextFleetState,
  createGenesisFleetState,
  fleetStateHash,
  isMutationAllowed,
  parseFleetState,
  verifyFleetState,
  verifyFleetTransition,
} from './fleet-state.mjs';

const now = Date.parse('2026-11-24T00:00:00.000Z');
const genesis = createGenesisFleetState(now);

test('genesis state is valid, deterministic, and self-hashed', () => {
  assert.equal(verifyFleetState(genesis).valid, true);
  assert.equal(genesis.epoch, 1);
  assert.equal(genesis.paused, false);
  assert.deepEqual(createGenesisFleetState(now), genesis);
  assert.equal(parseFleetState(JSON.stringify(genesis)).hash, genesis.hash);
  assert.throws(() => parseFleetState('not json'), /not valid JSON/u);
});

test('tampering with any state field invalidates its hash', () => {
  assert.match(verifyFleetState({ ...genesis, paused: true }).reason, /hash mismatch/u);
  assert.match(verifyFleetState({ ...genesis, hash: 'a'.repeat(64) }).reason, /hash mismatch/u);
  assert.match(verifyFleetState({ ...genesis, schemaVersion: 2 }).reason, /schemaVersion/u);
  assert.match(verifyFleetState({ ...genesis, epoch: 0 }).reason, /epoch/u);
  assert.equal(fleetStateHash(genesis).length, 64);
});

test('pause and resume always advance the epoch, even resume', () => {
  const paused = buildNextFleetState(genesis, 'pause', {
    actor: 'bjo163',
    reason: 'incident-2026-11-24 stop fleet',
    nowMs: now + 1000,
  });
  assert.equal(verifyFleetState(paused).valid, true);
  assert.equal(paused.paused, true);
  assert.equal(paused.epoch, 2);
  assert.equal(verifyFleetTransition(genesis, paused, 'pause').valid, true);

  const resumed = buildNextFleetState(paused, 'resume', {
    actor: 'bjo163',
    reason: 'incident-2026-11-24 recovery',
    nowMs: now + 2000,
  });
  assert.equal(resumed.paused, false);
  assert.equal(resumed.epoch, 3);
  assert.equal(verifyFleetTransition(paused, resumed, 'resume').valid, true);
  assert.match(verifyFleetTransition(paused, paused, 'pause').reason, /exactly one/u);
  assert.match(verifyFleetTransition(genesis, paused, 'resume').reason, /pause state/u);
});

test('transitions reject unsafe actors and empty reasons', () => {
  assert.throws(
    () =>
      buildNextFleetState(genesis, 'pause', {
        actor: 'agent-1; rm',
        reason: 'a valid reason here',
      }),
    /actor/u
  );
  assert.throws(
    () => buildNextFleetState(genesis, 'pause', { actor: 'bjo163', reason: 'short' }),
    /reason/u
  );
  assert.throws(
    () =>
      buildNextFleetState(genesis, 'delete', { actor: 'bjo163', reason: 'a valid reason here' }),
    /Unknown/u
  );
});

test('kill switch blocks every mutation and stale epochs can never revive', () => {
  assert.deepEqual(isMutationAllowed(genesis, { fleetEpoch: 1 }), { allowed: true, epoch: 1 });
  assert.match(isMutationAllowed(genesis, { fleetEpoch: 2 }).reason, /stale/u);
  assert.match(isMutationAllowed(genesis, null).reason, /stale/u);
  const paused = buildNextFleetState(genesis, 'pause', {
    actor: 'bjo163',
    reason: 'incident stop for audit',
    nowMs: now + 1000,
  });
  assert.match(isMutationAllowed(paused, { fleetEpoch: 2 }).reason, /paused/u);
  const resumed = buildNextFleetState(paused, 'resume', {
    actor: 'bjo163',
    reason: 'incident recovery done',
    nowMs: now + 2000,
  });
  assert.match(isMutationAllowed(resumed, { fleetEpoch: 2 }).reason, /stale/u);
  assert.equal(isMutationAllowed(resumed, { fleetEpoch: 3 }).allowed, true);
});
