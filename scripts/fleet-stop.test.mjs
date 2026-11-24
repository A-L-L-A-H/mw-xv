import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTreeEntries, applyFleetAction, createFleetStore, verifyCas } from './fleet-stop.mjs';
import {
  FLEET_STATE_FILE,
  FLEET_STATE_REF,
  buildNextFleetState,
  createGenesisFleetState,
} from './fleet-state.mjs';

function mockAdapter({ refExists = false, activeRuns = [] } = {}) {
  let ref = refExists ? 'b'.repeat(40) : null;
  let content = refExists
    ? JSON.stringify(
        buildNextFleetState(createGenesisFleetState(), 'pause', {
          actor: 'bjo163',
          reason: 'incident-2026-11-24 stop fleet',
          nowMs: Date.parse('2026-11-24T00:00:00.000Z'),
        })
      )
    : null;
  const calls = [];
  const blobs = new Map();
  return {
    calls,
    get ref() {
      return ref;
    },
    async readRef() {
      calls.push('readRef');
      return ref ? { sha: ref } : null;
    },
    async readCommit() {
      calls.push('readCommit');
      return {
        fileSha: 'c'.repeat(40),
        treeEntries: [{ path: 'README.md', sha: 'd'.repeat(40) }],
        treeSha: 'e'.repeat(40),
      };
    },
    async readBlob() {
      calls.push('readBlob');
      return content;
    },
    async createBlob(value) {
      calls.push('createBlob');
      const sha = `${String(blobs.size + 1).padStart(40, '0')}`;
      blobs.set(sha, value);
      content = value;
      return sha;
    },
    async createTree(base, entries) {
      calls.push('createTree');
      assert.equal(base, ref ? 'e'.repeat(40) : null);
      return 'f'.repeat(40);
    },
    async createCommit({ parents, message }) {
      calls.push('createCommit');
      assert.equal(parents.length, ref ? 1 : 0);
      assert.match(message, /fleet/u);
      return 'a'.repeat(40);
    },
    async updateRef(targetRef, newSha, oldSha) {
      calls.push('updateRef');
      assert.equal(targetRef, FLEET_STATE_REF);
      const previous = ref;
      ref = newSha;
      // Re-read what was written so applyFleetAction can verify convergence.
      content = blobs.get(newSha) ?? content;
      return oldSha === '0'.repeat(40) ? { created: true } : { updated: previous === oldSha };
    },
    async listActiveRuns() {
      calls.push('listActiveRuns');
      return activeRuns;
    },
    async cancelRun(id) {
      calls.push(`cancel:${id}`);
    },
  };
}

test('tree entries preserve other files and replace only the state file', () => {
  const entries = buildTreeEntries(
    [
      { path: 'README.md', sha: 'a'.repeat(40) },
      { path: FLEET_STATE_FILE, sha: 'b'.repeat(40) },
    ],
    FLEET_STATE_FILE,
    'c'.repeat(40)
  );
  assert.deepEqual(
    entries.map((entry) => entry.path),
    [FLEET_STATE_FILE, 'README.md']
  );
  assert.equal(entries.find((entry) => entry.path === FLEET_STATE_FILE).sha, 'c'.repeat(40));
  assert.equal(entries.find((entry) => entry.path === 'README.md').sha, 'a'.repeat(40));
});

test('CAS rejects missing creation and stale updates', () => {
  const sha = 'a'.repeat(40);
  assert.equal(verifyCas(sha, '0'.repeat(40), { created: true }).applied, true);
  assert.equal(verifyCas(sha, '0'.repeat(40), { updated: true }).applied, false);
  assert.equal(verifyCas(sha, sha, { updated: true }).applied, true);
  assert.equal(verifyCas(sha, sha, { updated: false }).applied, false);
  assert.equal(verifyCas('short', sha, { updated: true }).applied, false);
});

test('pause bootstraps a missing ref, persists state, and cancels active runs', async () => {
  const adapter = mockAdapter({ activeRuns: [{ id: 11 }, { id: 12 }] });
  const store = createFleetStore(adapter);
  const result = await applyFleetAction(store, adapter, {
    action: 'pause',
    actor: 'bjo163',
    reason: 'incident-2026-11-24 stop fleet',
  });
  assert.equal(result.changed, true);
  assert.equal(result.state.paused, true);
  assert.equal(result.state.epoch, 2);
  assert.deepEqual(result.cancelled, [11, 12]);
  assert.equal(adapter.ref, result.commitSha);
  assert.ok(adapter.calls.includes('createCommit'));
  assert.ok(adapter.calls.includes('cancel:11'));
});

test('a repeated pause is a no-op and resume is not attempted without a paused state', async () => {
  const paused = createGenesisFleetState();
  const adapter = mockAdapter({ refExists: true });
  adapter.readBlob = async () => JSON.stringify(paused);
  const store = createFleetStore(adapter);
  const result = await applyFleetAction(store, adapter, {
    action: 'resume',
    actor: 'bjo163',
    reason: 'incident-2026-11-24 recovery',
  });
  assert.equal(result.changed, false);
  assert.deepEqual(result.cancelled, []);
});

test('epoch expectation mismatch fails before any write', async () => {
  const adapter = mockAdapter();
  await assert.rejects(
    () =>
      applyFleetAction(createFleetStore(adapter), adapter, {
        action: 'pause',
        actor: 'bjo163',
        reason: 'incident stop fleet',
        expectEpoch: 9,
      }),
    /Expected fleet epoch/u
  );
  assert.equal(adapter.calls.includes('createCommit'), false);
});
