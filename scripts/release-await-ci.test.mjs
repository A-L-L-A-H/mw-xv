import assert from 'node:assert/strict';
import test from 'node:test';
import {
  awaitExactCi,
  evaluateAwaitEvidence,
  selectExactCiRun,
  verifyExactCheckRuns,
} from './release-await-ci.mjs';

const sha = 'a'.repeat(40);
const repo = 'bjo163/moonwitness-xiv';
const run = (overrides = {}) => ({
  id: 10,
  head_sha: sha,
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  head_repository: { full_name: repo },
  ...overrides,
});
const check = (name, conclusion = 'success', overrides = {}) => ({
  id: 1,
  name,
  head_sha: sha,
  status: 'completed',
  conclusion,
  ...overrides,
});
const options = {
  sha,
  repository: repo,
  allowedEvents: ['workflow_dispatch', 'push'],
  requiredChecks: ['ci-gate', 'policy-gate'],
  timeoutSeconds: 1,
  intervalSeconds: 0,
};

test('selects only the newest terminal exact-SHA run from the same repository', () => {
  assert.equal(
    selectExactCiRun(
      [
        run({ id: 11, conclusion: 'failure' }),
        run({ id: 12 }),
        run({ id: 13, status: 'in_progress' }),
      ],
      sha,
      repo
    ).id,
    12
  );
  assert.equal(selectExactCiRun([run({ head_sha: 'b'.repeat(40) })], sha, repo), undefined);
  assert.equal(
    selectExactCiRun([run({ head_repository: { full_name: 'evil/fork' } })], sha, repo),
    undefined
  );
  assert.equal(selectExactCiRun([run({ event: 'pull_request' })], sha, repo), undefined);
  assert.equal(selectExactCiRun([run()], 'short', repo), undefined);
});

test('requires both governance checks on the exact SHA', () => {
  assert.equal(
    verifyExactCheckRuns([check('ci-gate'), check('policy-gate')], sha, options.requiredChecks)
      .passed,
    true
  );
  assert.equal(verifyExactCheckRuns([check('ci-gate')], sha, options.requiredChecks).passed, false);
  assert.equal(
    verifyExactCheckRuns(
      [check('ci-gate'), check('policy-gate', 'failure')],
      sha,
      options.requiredChecks
    ).passed,
    false
  );
  assert.equal(
    verifyExactCheckRuns([check('ci-gate', 'success', { head_sha: 'b'.repeat(40) })], sha, [
      'ci-gate',
    ]).passed,
    false
  );
});

test('await is retry-safe: existing successful evidence converges without another dispatch', async () => {
  const verdict = evaluateAwaitEvidence(
    { runs: [run()], checkRuns: [check('ci-gate'), check('policy-gate')] },
    options
  );
  assert.equal(verdict.done, true);
  assert.equal(verdict.runId, 10);
  let reads = 0;
  const result = await awaitExactCi(options, {
    async read(kind) {
      reads += 1;
      const evidence =
        reads <= 4
          ? { runs: [], checkRuns: [] }
          : { runs: [run()], checkRuns: [check('ci-gate'), check('policy-gate')] };
      return evidence[kind];
    },
  });
  assert.equal(result.done, true);
  assert.ok(reads >= 5);
});

test('await fails closed on a newer failed run or a timeout', async () => {
  assert.equal(
    evaluateAwaitEvidence(
      { runs: [run({ id: 12, conclusion: 'failure' })], checkRuns: [check('ci-gate')] },
      options
    ).done,
    false
  );
  await assert.rejects(
    () =>
      awaitExactCi(options, {
        async read(kind) {
          return { runs: [], checkRuns: [] }[kind];
        },
      }),
    /Timed out awaiting exact-SHA CI/u
  );
});
