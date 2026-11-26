import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('normalizes GitHub Actions aggregate objects and fails closed on malformed entries', () => {
  const aggregate = {
    'secret-scan': { result: 'success', outputs: {} },
    'static-analysis': 'success',
    'dependency-audit': { result: 'failure', outputs: {} },
    'quality-and-build': { outputs: {} },
    'unit-tests': null,
    'knowledge-gate': { result: 1 },
    'postgres-integration': ['success'],
  };
  const results = readJobResults({ CI_GATE_RESULTS: JSON.stringify(aggregate) });
  assert.deepEqual(results, {
    'secret-scan': 'success',
    'static-analysis': 'success',
    'dependency-audit': 'failure',
    'quality-and-build': undefined,
    'unit-tests': undefined,
    'knowledge-gate': undefined,
    'postgres-integration': undefined,
  });
  assert.equal(isCiGatePassing(results, ['secret-scan', 'static-analysis']), true);
  assert.equal(isCiGatePassing(results, ['secret-scan', 'dependency-audit']), false);
  assert.equal(isCiGatePassing(results, ['secret-scan', 'quality-and-build']), false);
  assert.equal(isCiGatePassing(results, ['secret-scan', 'unknown']), false);
});

test('rejects every non-success aggregate object conclusion', () => {
  for (const result of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'stale', '']) {
    const results = readJobResults(
      {
        CI_GATE_RESULTS: JSON.stringify({ 'secret-scan': { result, outputs: {} } }),
      },
      ['secret-scan']
    );
    assert.deepEqual(results, { 'secret-scan': result });
    assert.equal(isCiGatePassing(results, ['secret-scan']), false);
  }
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

// Workflow parity: the canonical lane list lives in ci-gate.mjs, but the
// hosted workflow declares the jobs independently. Without this test a lane
// rename, a removed dependency, or a weakened `if:` would silently change the
// promotion gate. Parsing is indentation-anchored so a YAML dependency is not
// needed; the exact lines below are the contract.
const workflowPath = new URL('../.github/workflows/ci.yml', import.meta.url);
const workflow = readFileSync(workflowPath, 'utf8');

/** @param {string} text @param {string} job */
function workflowJob(text, job) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${job}:`);
  assert.notEqual(start, -1, `ci.yml is missing job '${job}'`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && /^ {1,2}[A-Za-z0-9_-]+:\s*$/u.test(line)) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function needsList(body) {
  const line = body.find((entry) => /^\s+needs:\s*\[/u.test(entry));
  assert.ok(line, 'job is missing a needs list');
  return line
    .slice(line.indexOf('[') + 1, line.lastIndexOf(']'))
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

test('ci.yml job graph matches the canonical gate exactly', () => {
  const jobKeys = [...workflow.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gmu)].map((match) => match[1]);
  const expected = [...requiredJobs, 'gate-failure-triage', 'ci-gate'];
  for (const job of expected) assert.ok(jobKeys.includes(job), `ci.yml is missing job '${job}'`);
  assert.deepEqual(needsList(workflowJob(workflow, 'ci-gate')), requiredJobs);
  const triageNeeds = needsList(workflowJob(workflow, 'gate-failure-triage'));
  assert.deepEqual(triageNeeds, [...requiredJobs, 'ci-gate']);
});

test('ci.yml keeps triage on every terminal result (never skip green)', () => {
  const lines = workflowJob(workflow, 'gate-failure-triage');
  assert.ok(
    lines.includes('    if: always() && !cancelled()'),
    'gate-failure-triage must run on every terminal result, including success'
  );
});

test('ci.yml close-on-green stays guarded by exact-SHA evidence', () => {
  const lines = workflowJob(workflow, 'gate-failure-triage');
  const closeIndex = lines.findIndex((line) => line.includes('id: close_resolved'));
  assert.notEqual(closeIndex, -1, 'close_resolved step is missing');
  const closeBlock = lines.slice(closeIndex, closeIndex + 30);
  assert.ok(
    closeBlock.some((line) => line.includes("needs.ci-gate.result == 'success'")),
    'close-on-green must be gated on a successful ci-gate result'
  );
  assert.ok(
    closeBlock.some((line) => line.includes('--checks-file')),
    'close-on-green must verify exact-SHA check runs from a snapshot'
  );
  const resolverIndex = closeBlock.findIndex((line) =>
    line.includes('node scripts/roadmap/resolve-gate-failure-issue.mjs')
  );
  const snapshotIndex = closeBlock.findIndex((line) => line.includes('--checks-file'));
  assert.notEqual(resolverIndex, -1, 'close-on-green must call the auto-heal resolver');
  assert.ok(resolverIndex > snapshotIndex, 'resolver must run only after exact-SHA verification');
});

test('cancelled or skipped lanes never satisfy the aggregate, even with successes', () => {
  const aggregate = Object.fromEntries(requiredJobs.map((job) => [job, { result: 'success', outputs: {} }]));
  aggregate['unit-tests'] = { result: 'cancelled', outputs: {} };
  aggregate['dx-test'] = { result: 'skipped', outputs: {} };
  aggregate['gate-failure-triage'] = { result: 'success', outputs: {} };
  const results = readJobResults({ CI_GATE_RESULTS: JSON.stringify(aggregate) });
  assert.equal(isCiGatePassing(results), false);
  assert.equal(results['unit-tests'], 'cancelled');
  assert.equal(results['dx-test'], 'skipped');

  const cancelledOnly = Object.fromEntries(
    requiredJobs.map((job) => [job, job === 'secret-scan' ? { result: 'cancelled', outputs: {} } : 'success'])
  );
  assert.equal(isCiGatePassing(readJobResults({ CI_GATE_RESULTS: JSON.stringify(cancelledOnly) })), false);

  const missingLane = { ...successfulResults };
  delete missingLane['postgres-integration'];
  assert.equal(isCiGatePassing(missingLane), false);
  // An extra key cannot stand in for a missing or non-success required lane.
  assert.equal(isCiGatePassing({ ...missingLane, 'postgres-integration-2': 'success' }), false);
  const failedLane = { ...successfulResults, 'unit-tests': 'cancelled' };
  assert.equal(isCiGatePassing({ ...failedLane, 'unit-tests-2': 'success' }), false);
});
