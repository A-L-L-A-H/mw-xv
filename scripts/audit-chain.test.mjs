import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIT_STAGES,
  appendEvent,
  createGenesisCheckpoint,
  hashEvent,
  mergeCheckpoints,
  projectCorrelation,
  redactEvent,
  verifyChain,
  verifyEventLinkage,
} from './audit-chain.mjs';

const event = (overrides = {}) => ({
  stage: 'task',
  taskId: 'MW-123',
  agentId: 'codex-1',
  agentRunId: 'run-9',
  traceId: 'trace-abc',
  ref: 'MW-123',
  ...overrides,
});

function chain(stages = AUDIT_STAGES) {
  return stages.reduce((checkpoint, stage) => appendEvent(checkpoint, event({ stage })), createGenesisCheckpoint());
}

test('hash chain is deterministic and detects edits, duplicates and reordering', () => {
  assert.deepEqual(createGenesisCheckpoint(), { schemaVersion: 1, headHash: '0'.repeat(64), sequence: 0, events: [] });
  const first = appendEvent(createGenesisCheckpoint(), event({ stage: 'task' }));
  const again = appendEvent(createGenesisCheckpoint(), event({ stage: 'task' }));
  assert.equal(first.headHash, again.headHash);
  assert.equal(hashEvent(event()), hashEvent({ traceId: 'trace-abc', stage: 'task', taskId: 'MW-123', agentId: 'codex-1', agentRunId: 'run-9', ref: 'MW-123' }));
  assert.equal(verifyChain(first).valid, true);

  const tampered = structuredClone(first);
  tampered.events[0].event.taskId = 'MW-999';
  assert.match(verifyChain(tampered).reason, /tampered/u);

  const duplicated = structuredClone(first);
  duplicated.events.push({ ...duplicated.events[0], sequence: 2 });
  assert.match(verifyChain(duplicated).reason, /hash gap/u);

  assert.match(verifyChain({ ...first, headHash: 'a'.repeat(64) }).reason, /head does not match/u);
  assert.match(verifyChain({ ...first, sequence: 99 }).reason, /head does not match/u);
  assert.match(verifyChain({ schemaVersion: 2, events: [] }).reason, /invalid checkpoint/u);
});

test('secret-bearing fields are redacted before hashing', () => {
  const clean = redactEvent({ taskId: 'MW-1', apiKey: 'super-secret', nested: { token: 'abc', keep: 'yes' }, note: 'Bearer ghp_abcdefghijklmnopqrstuvwxyz' });
  assert.equal('apiKey' in clean, false);
  assert.equal('token' in clean.nested, false);
  assert.equal(clean.nested.keep, 'yes');
  assert.equal(clean.note, '[redacted]');
  assert.equal(JSON.stringify(appendEvent(createGenesisCheckpoint(), event({ password: 'x' }))).includes('password'), false);
  assert.throws(() => redactEvent(null), /must be an object/u);
});

test('merge requires a shared prefix and fails closed on a fork', () => {
  const base = chain(['task', 'agent']);
  const left = appendEvent(base, event({ stage: 'run', ref: 'left' }));
  const right = appendEvent(base, event({ stage: 'run', ref: 'right' }));
  assert.equal(verifyChain(mergeCheckpoints(left, base)).valid, true);
  assert.equal(mergeCheckpoints(left, base).sequence, 3);
  assert.throws(() => mergeCheckpoints(left, right), /Audit fork/u);
  assert.throws(() => mergeCheckpoints(left, { schemaVersion: 2, events: [] }), /invalid checkpoint/u);
});

test('correlation projection reports missing stages without inventing them', () => {
  const projection = projectCorrelation(chain().events);
  assert.equal(projection.complete, true);
  assert.deepEqual(projection.missing, []);
  const partial = projectCorrelation(chain(['task', 'agent']).events);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, AUDIT_STAGES.slice(2));
});

test('event linkage requires claim identity and a full commit SHA', () => {
  assert.equal(verifyEventLinkage(event({ stage: 'commit', ref: 'a'.repeat(40) })).valid, true);
  assert.match(verifyEventLinkage(event({ traceId: '' })).reason, /traceId/u);
  assert.match(verifyEventLinkage(event({ stage: 'commit', ref: 'short' })).reason, /commitSha/u);
});
