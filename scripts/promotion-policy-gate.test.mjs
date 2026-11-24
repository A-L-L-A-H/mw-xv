import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOVERNANCE_PATHS,
  resolvePolicyContext,
  verifyChangedPaths,
  verifyPolicyContext,
} from './promotion-policy-gate.mjs';

const repo = 'bjo163/moonwitness-xiv';
const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const mergeSha = 'c'.repeat(40);

const pullRequestEvent = {
  pull_request: {
    number: 24,
    head: { sha: headSha, repo: { full_name: repo } },
    base: { sha: baseSha, repo: { full_name: repo } },
  },
};
const mergeGroupEvent = {
  merge_group: {
    head_sha: headSha,
    base_sha: baseSha,
    head_repo: { full_name: repo },
    base_repo: { full_name: repo },
  },
};

test('resolves exact head, base, and merge SHAs for both supported events', () => {
  const pr = resolvePolicyContext('pull_request', pullRequestEvent, mergeSha);
  assert.deepEqual(verifyPolicyContext(pr, repo), { headSha, baseSha, mergeSha, repository: repo });
  const group = resolvePolicyContext('merge_group', mergeGroupEvent, mergeSha);
  assert.deepEqual(verifyPolicyContext(group, repo), { headSha, baseSha, mergeSha, repository: repo });
  assert.throws(() => resolvePolicyContext('push', {}, mergeSha), /Unsupported/u);
});

test('rejects malformed, fork, and cross-repository contexts', () => {
  assert.throws(() => verifyPolicyContext({ ...resolvePolicyContext('pull_request', pullRequestEvent, mergeSha), headSha: 'short' }, repo), /invalid headSha/u);
  assert.throws(() => verifyPolicyContext({ ...resolvePolicyContext('pull_request', pullRequestEvent, mergeSha), mergeSha: 'z'.repeat(40) }, repo), /invalid mergeSha/u);
  assert.throws(() => verifyPolicyContext({ ...resolvePolicyContext('pull_request', pullRequestEvent, mergeSha), headRepo: 'evil/fork' }, repo), /same-repository/u);
  assert.throws(() => verifyPolicyContext(resolvePolicyContext('pull_request', pullRequestEvent, mergeSha), 'other/repo'), /same-repository/u);
});

test('enforces a non-empty safe diff scope and the governance boundary', () => {
  assert.deepEqual(verifyChangedPaths(['scripts/ci-gate.mjs', 'package.json']), ['scripts/ci-gate.mjs', 'package.json']);
  assert.throws(() => verifyChangedPaths([]), /non-empty/u);
  assert.throws(() => verifyChangedPaths(['../outside']), /unsafe path/u);
  assert.throws(() => verifyChangedPaths(['/absolute/path']), /unsafe path/u);
  for (const path of GOVERNANCE_PATHS) {
    const file = path.endsWith('/') ? `${path}rulesets.json` : path;
    assert.throws(() => verifyChangedPaths([file]), /governance plane/u);
  }
  assert.deepEqual(
    verifyChangedPaths(['.github/governance/rulesets.json'], { breakGlass: true }),
    ['.github/governance/rulesets.json']
  );
});

test('the promotion policy workflow is a named merge_group gate on exact SHAs', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../.github/workflows/promotion-policy.yml', import.meta.url), 'utf8');
  assert.match(source, /pull_request:/u);
  assert.match(source, /merge_group:/u);
  assert.match(source, /name: policy-gate/u);
  assert.match(source, /resolvePolicyContext/u);
  assert.match(source, /verifyChangedPaths/u);
  assert.match(source, /persist-credentials: false/u);
});
