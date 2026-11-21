import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateStepOutcome,
  extractSkipMetrics,
  parseGateArgs,
  runKnowledgeGate,
} from './run-k-gate.mjs';

test('extractSkipMetrics parses Vitest and node:test skip summaries', () => {
  assert.deepEqual(
    extractSkipMetrics('Test Files  4 skipped | 12 passed (16)\nTests  34 passed (34)'),
    {
      skippedFiles: 4,
      skippedTests: 0,
    }
  );
  assert.deepEqual(extractSkipMetrics('Tests  2 skipped | 8 passed (10)'), {
    skippedFiles: 0,
    skippedTests: 2,
  });
  assert.deepEqual(extractSkipMetrics('ℹ tests 6\nℹ skipped 1'), {
    skippedFiles: 0,
    skippedTests: 1,
  });
});

test('evaluateStepOutcome fails closed when required tests are skipped or strictNoSkip is enabled', () => {
  const requiredStep = {
    id: 'research',
    allowPostgresSkipWhenUnset: false,
    maxAllowedSkippedTests: 0,
  };
  const skippedRequired = evaluateStepOutcome(
    requiredStep,
    'Test Files  1 passed (1)\nTests  1 skipped | 4 passed (5)',
    0,
    { strictNoSkip: false, postgresTestUrl: '' }
  );
  assert.equal(skippedRequired.status, 'failed');
  assert.equal(skippedRequired.reason, 'required_tests_skipped');

  const declaredCeilingStep = {
    id: 'local-ai',
    allowPostgresSkipWhenUnset: false,
    maxAllowedSkippedTests: 16,
  };
  const declaredOk = evaluateStepOutcome(
    declaredCeilingStep,
    'Test Files  6 passed (6)\nTests  154 passed | 16 skipped (170)',
    0,
    { strictNoSkip: false, postgresTestUrl: '' }
  );
  assert.equal(declaredOk.status, 'passed_with_declared_skips');

  const exceededCeiling = evaluateStepOutcome(
    declaredCeilingStep,
    'Test Files  6 passed (6)\nTests  153 passed | 17 skipped (170)',
    0,
    { strictNoSkip: false, postgresTestUrl: '' }
  );
  assert.equal(exceededCeiling.status, 'failed');
  assert.equal(exceededCeiling.reason, 'required_tests_skipped');

  const postgresStep = {
    id: 'orm-knowledge',
    allowPostgresSkipWhenUnset: true,
    maxAllowedSkippedTests: 0,
  };
  const allowedLocalSkip = evaluateStepOutcome(
    postgresStep,
    'Test Files  4 skipped | 12 passed (16)\nTests  34 passed (34)',
    0,
    { strictNoSkip: false, postgresTestUrl: '' }
  );
  assert.equal(allowedLocalSkip.status, 'passed_with_postgres_skips');

  const strictModeRejection = evaluateStepOutcome(
    postgresStep,
    'Test Files  4 skipped | 12 passed (16)\nTests  34 passed (34)',
    0,
    { strictNoSkip: true, postgresTestUrl: '' }
  );
  assert.equal(strictModeRejection.status, 'failed');
  assert.equal(strictModeRejection.reason, 'required_test_files_skipped');
});

test('runKnowledgeGate binds exact 40-hex git SHA and fails closed when any step fails', () => {
  const steps = [
    {
      id: 'step-ok',
      allowPostgresSkipWhenUnset: false,
      maxAllowedSkippedTests: 0,
      commands: [{ bin: 'node', args: ['-v'] }],
    },
    {
      id: 'step-fail',
      allowPostgresSkipWhenUnset: false,
      maxAllowedSkippedTests: 0,
      commands: [{ bin: 'node', args: ['-e', 'process.exit(1)'] }],
    },
  ];
  let callIndex = 0;
  const summary = runKnowledgeGate({
    steps,
    strictNoSkip: true,
    postgresTestUrl: 'postgres://localhost/test',
    runner: () => {
      callIndex += 1;
      if (callIndex === 1) {
        return { exitCode: 0, stdout: 'Tests  5 passed (5)', stderr: '', error: null };
      }
      return { exitCode: 1, stdout: '', stderr: 'boom', error: null };
    },
  });

  assert.match(summary.sourceSha, /^[0-9a-f]{40}$/u);
  assert.equal(summary.aiMode, 'disabled');
  assert.equal(summary.overallStatus, 'failed');
  assert.equal(summary.steps[0].status, 'passed');
  assert.equal(summary.steps[1].status, 'failed');
  assert.equal(summary.steps[1].reason, 'command_failed_1');
});

test('parseGateArgs recognizes strict-no-skip and json flags', () => {
  assert.deepEqual(parseGateArgs(['--strict-no-skip', '--json']), {
    strictNoSkip: true,
    json: true,
  });
});
