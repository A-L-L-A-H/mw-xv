import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWED_CREDENTIAL_SCOPES,
  MAX_CREDENTIAL_TTL_SECONDS,
  authorizeCredentialMint,
  compareFencing,
  detectScopeViolation,
  extractTrailers,
  normalizePathScope,
  pathInScope,
  resolvePathLock,
  scopesOverlap,
  verifyClaimShape,
  verifyCommitTrailers,
  verifyClaimedDiff,
  verifyExecutionClaim,
} from './execution-claim-gate.mjs';

const now = 1_800_000_000_000;
const presentation = {
  taskId: 'MW-123',
  agentId: 'codex-1',
  agentRunId: 'run-9',
  jobRunId: 'job-7',
  traceId: 'trace-abc',
  baseSha: 'a'.repeat(40),
  fencingToken: 4,
  fleetEpoch: 2,
  leaseExpiresAtMs: now + 60_000,
  pathScope: ['packages/jobs/src', 'scripts/fleet-state.mjs'],
};
const authoritative = {
  claimId: 'claim-1',
  taskId: presentation.taskId,
  agentId: presentation.agentId,
  agentRunId: presentation.agentRunId,
  traceId: presentation.traceId,
  fencingToken: 4,
  fleetEpoch: 2,
  paused: false,
  pathScope: ['packages/jobs', 'scripts/'],
};

test('normalizes prefixes and rejects traversal or escape attempts', () => {
  assert.deepEqual(normalizePathScope(['./packages//jobs/', 'packages/jobs', 'scripts']), [
    'packages/jobs',
    'scripts',
  ]);
  for (const bad of ['/abs', '..', 'a/../b', 'a\\b', '', null, 'a\0b']) {
    assert.throws(() => normalizePathScope([bad]), undefined, `must reject ${String(bad)}`);
  }
  assert.equal(pathInScope('packages/jobs/src/models.ts', ['packages/jobs']), true);
  assert.equal(pathInScope('packages/jobs-other/x.ts', ['packages/jobs']), false);
  assert.equal(pathInScope('../outside', ['packages']), false);
});

test('detects diff escapes, including renames and deletes outside scope', () => {
  assert.equal(
    detectScopeViolation(['packages/jobs/src/a.ts', 'packages/jobs/src/b.ts'], ['packages/jobs']),
    null
  );
  assert.equal(
    detectScopeViolation(['packages/jobs/a.ts', 'apps/board/x.tsx'], ['packages/jobs']),
    'apps/board/x.tsx'
  );
  assert.equal(detectScopeViolation(null, ['packages/jobs']), '(missing diff)');
  assert.equal(scopesOverlap(['packages/jobs'], ['packages']), true);
  assert.equal(scopesOverlap(['packages/jobs'], ['apps/board']), false);
});

test('workspace lock is deterministic and rejects overlapping prefixes', () => {
  const requested = { claimId: 'claim-b', pathScope: ['packages/jobs'] };
  assert.equal(resolvePathLock([], requested).granted, true);
  const conflict = resolvePathLock(
    [
      { claimId: 'claim-a', pathScope: ['packages'] },
      { claimId: 'claim-c', pathScope: ['apps'] },
    ],
    requested
  );
  assert.equal(conflict.granted, false);
  assert.equal(conflict.winner, 'claim-a');
  assert.deepEqual(conflict.blockedBy, ['claim-a']);
  const wins = resolvePathLock([{ claimId: 'claim-z', pathScope: ['packages'] }], {
    claimId: 'claim-a',
    pathScope: ['packages'],
  });
  assert.equal(wins.granted, true);
  assert.equal(wins.reason, 'lowest claim id wins the overlapping scope');
  assert.equal(resolvePathLock(null, requested).granted, false);
});

test('claim shape binds every identity field', () => {
  assert.equal(verifyClaimShape(presentation).valid, true);
  for (const field of ['taskId', 'agentId', 'agentRunId', 'traceId', 'jobRunId']) {
    const malformed = { ...presentation, [field]: 'bad value!' };
    assert.equal(verifyClaimShape(malformed).valid, false, field);
  }
  assert.equal(verifyClaimShape({ ...presentation, baseSha: 'short' }).valid, false);
  assert.equal(verifyClaimShape({ ...presentation, fencingToken: '4' }).valid, false);
  assert.equal(verifyClaimShape({ ...presentation, fleetEpoch: 0 }).valid, false);
});

test('execution claim fails closed on pause, stale epoch, stale fence, expiry, and scope escape', () => {
  assert.deepEqual(verifyExecutionClaim(presentation, authoritative, now), {
    allowed: true,
    pathScope: presentation.pathScope,
    claimId: 'claim-1',
  });
  assert.match(
    verifyExecutionClaim(presentation, { ...authoritative, paused: true }, now).reason,
    /paused/u
  );
  assert.match(
    verifyExecutionClaim(presentation, { ...authoritative, fleetEpoch: 3 }, now).reason,
    /epoch/u
  );
  assert.match(
    verifyExecutionClaim({ ...presentation, fencingToken: 3 }, authoritative, now).reason,
    /fencing/u
  );
  assert.match(
    verifyExecutionClaim({ ...presentation, leaseExpiresAtMs: now - 1 }, authoritative, now).reason,
    /expired/u
  );
  assert.match(
    verifyExecutionClaim({ ...presentation, pathScope: ['apps/board'] }, authoritative, now).reason,
    /exceeds/u
  );
  assert.match(
    verifyExecutionClaim({ ...presentation, agentId: 'other' }, authoritative, now).reason,
    /identity/u
  );
  assert.match(verifyExecutionClaim(presentation, null, now).reason, /paused/u);
});

test('credential minting is bounded by scope, TTL, repository and claim validity', () => {
  const policy = {
    repository: 'bjo163/moonwitness-xiv',
    scopes: ['contents:write'],
    ttlSeconds: 600,
  };
  assert.equal(authorizeCredentialMint(presentation, authoritative, policy, now).allowed, true);
  assert.equal(
    authorizeCredentialMint({ ...presentation, fleetEpoch: 1 }, authoritative, policy, now).allowed,
    false
  );
  assert.equal(
    authorizeCredentialMint(presentation, authoritative, { ...policy, scopes: ['admin'] }, now)
      .allowed,
    false
  );
  assert.equal(
    authorizeCredentialMint(presentation, authoritative, { ...policy, ttlSeconds: 3600 }, now)
      .allowed,
    false
  );
  assert.equal(
    authorizeCredentialMint(presentation, authoritative, { ...policy, repository: '' }, now)
      .allowed,
    false
  );
  assert.equal(MAX_CREDENTIAL_TTL_SECONDS, 900);
  assert.equal(ALLOWED_CREDENTIAL_SCOPES.includes('pull-requests:write'), true);
});

test('commit trailers are bound to the claim and diff is rechecked before merge', () => {
  const message = [
    'feat(jobs): add claim gate',
    '',
    `Task-Id: ${presentation.taskId}`,
    `Agent-Id: ${presentation.agentId}`,
    `Agent-Run-Id: ${presentation.agentRunId}`,
    `Trace-Id: ${presentation.traceId}`,
    `Base-Sha: ${presentation.baseSha}`,
  ].join('\n');
  assert.equal(verifyCommitTrailers(message, presentation).valid, true);
  assert.match(
    verifyCommitTrailers(message, { ...presentation, traceId: 'other' }).reason,
    /trace-id/u
  );
  assert.deepEqual(extractTrailers('Subject: not a trailer\n\nTask-Id: MW-123'), {
    'task-id': 'MW-123',
  });
  assert.equal(
    verifyClaimedDiff(['packages/jobs/src/a.ts'], presentation, authoritative, now).allowed,
    true
  );
  assert.match(
    verifyClaimedDiff(['apps/board/a.tsx'], presentation, authoritative, now).reason,
    /outside claim scope/u
  );
});

test('fencing comparisons never accept a stale token', () => {
  assert.deepEqual(compareFencing(5, 4), { acceptable: true, token: 5 });
  assert.equal(compareFencing(3, 4).acceptable, false);
  assert.equal(compareFencing(3, 4).required, 4);
  assert.equal(compareFencing('4', 4).acceptable, false);
});
