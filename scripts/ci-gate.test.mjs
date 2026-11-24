import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CI_GATE_CHECK_NAME,
  isCiGatePassing,
  knownJobs,
  readJobResults,
  renderCiJobSummary,
  requiredJobs,
  resolveRequiredJobs,
} from './ci-gate.mjs';

const successfulResults = Object.fromEntries(requiredJobs.map((job) => [job, 'success']));

test('the canonical check name is the one required by the rulesets', () => {
  assert.equal(CI_GATE_CHECK_NAME, 'ci-gate');
  assert.equal(requiredJobs.includes(CI_GATE_CHECK_NAME), false);
  assert.deepEqual(requiredJobs, [
    'secret-scan',
    'static-analysis',
    'dependency-audit',
    'quality-and-build',
    'unit-tests',
    'knowledge-gate',
    'postgres-integration',
    'dx-test',
  ]);
});

test('accepts a success from every required job', () => {
  assert.equal(isCiGatePassing(successfulResults), true);
});

test('rejects a failed, cancelled, skipped, or missing required job', () => {
  assert.equal(isCiGatePassing({ ...successfulResults, 'unit-tests': 'failure' }), false);
  assert.equal(isCiGatePassing({ ...successfulResults, 'dx-test': 'cancelled' }), false);
  assert.equal(isCiGatePassing({ ...successfulResults, 'secret-scan': 'skipped' }), false);
  const { 'knowledge-gate': _knowledge, ...missing } = successfulResults;
  assert.equal(isCiGatePassing(missing), false);
  const summary = renderCiJobSummary(missing);
  assert.match(summary, /\| knowledge-gate \| missing \|/);
  assert.match(summary, /Overall: \*\*failed\*\*/);
});

test('rejects renamed or unknown lanes and an empty job list', () => {
  assert.equal(isCiGatePassing({ ...successfulResults, quality: 'success' }, ['quality']), false);
  assert.equal(isCiGatePassing(successfulResults, []), false);
  assert.equal(isCiGatePassing(successfulResults, null), false);
  assert.equal(isCiGatePassing(null, requiredJobs), false);
});

test('configuration can only strengthen the baseline with known optional lanes', () => {
  assert.deepEqual(resolveRequiredJobs({}), requiredJobs);
  assert.deepEqual(resolveRequiredJobs({ CI_GATE_EXTRA_JOBS: '"desktop-webview"' }), requiredJobs);
  assert.deepEqual(resolveRequiredJobs({ CI_GATE_EXTRA_JOBS: '["nope"]' }), requiredJobs);
  assert.deepEqual(resolveRequiredJobs({ CI_GATE_EXTRA_JOBS: 'not json' }), requiredJobs);
  assert.deepEqual(
    resolveRequiredJobs({ CI_GATE_EXTRA_JOBS: '["desktop-webview","freellmapi-vendor"]' }),
    [...requiredJobs, 'desktop-webview', 'freellmapi-vendor']
  );
  assert.equal(knownJobs.length, requiredJobs.length + 2);
});

test('reads inline aggregate results and per-job environment results', () => {
  assert.deepEqual(readJobResults({ CI_GATE_RESULTS: '{"secret-scan":"success"}' }), {
    'secret-scan': 'success',
  });
  assert.deepEqual(readJobResults({ CI_GATE_RESULTS: 'broken' }), {});
  assert.deepEqual(readJobResults({ SECRET_SCAN_RESULT: 'success' }, ['secret-scan']), {
    'secret-scan': 'success',
  });
});

test('summarizes without leaking environment data and never reports a weak pass', () => {
  const summary = renderCiJobSummary({
    ...successfulResults,
    'unit-tests': 'failure',
    'dx-test': 'skipped',
  });
  assert.match(summary, /Overall: \*\*failed\*\*/);
  assert.match(summary, /\| unit-tests \| failure \|/);
  assert.match(summary, /\| dx-test \| skipped \|/);
  assert.match(summary, /\| quality-and-build \| success \|/);
  assert.match(summary, /## ci-gate result/);
  assert.doesNotMatch(summary, /password|token|cookie|DATABASE_URL/i);
});
