#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolvePackageManager } from '../package-manager.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function resolveGitSha(cwd = repositoryRoot) {
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/iu.test(process.env.GITHUB_SHA.trim())) {
    return process.env.GITHUB_SHA.trim().toLowerCase();
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`Unable to resolve exact git HEAD SHA: ${result.stderr || result.stdout}`);
  }
  const sha = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/iu.test(sha)) {
    throw new Error(`Invalid git HEAD SHA resolved: "${sha}"`);
  }
  return sha.toLowerCase();
}

export function extractSkipMetrics(output) {
  const skippedFilesMatch = output.match(/Test Files\s+.*?(\d+)\s+skipped/u);
  const skippedTestsMatch = output.match(/Tests\s+.*?(\d+)\s+skipped/u);
  const nodeSkippedMatch = output.match(/ℹ\s+skipped\s+(\d+)/u);
  const skippedFiles = skippedFilesMatch ? Number(skippedFilesMatch[1]) : 0;
  const skippedTests = Math.max(
    skippedTestsMatch ? Number(skippedTestsMatch[1]) : 0,
    nodeSkippedMatch ? Number(nodeSkippedMatch[1]) : 0
  );
  return { skippedFiles, skippedTests };
}

export function parseGateArgs(argv = []) {
  return {
    strictNoSkip: argv.includes('--strict-no-skip') || process.env.K_GATE_REQUIRE_ALL_TESTS === '1',
    json: argv.includes('--json'),
  };
}

export const KNOWLEDGE_GATE_STEPS = [
  {
    id: 'knowledge-build-and-test',
    allowPostgresSkipWhenUnset: false,
    maxAllowedSkippedTests: 0,
    commands: [
      { bin: 'bun', args: ['--filter', '@moonwitness/knowledge', 'build'] },
      { bin: 'bun', args: ['--filter', '@moonwitness/knowledge', 'typecheck'] },
      { bin: 'bun', args: ['--filter', '@moonwitness/knowledge', 'test', '--', '--maxWorkers=1'] },
    ],
  },
  {
    id: 'corpus-build-and-test',
    allowPostgresSkipWhenUnset: false,
    // 3 POSIX mode-bit tests in private-archive-manifest.test.ts skip only on win32; Linux CI requires 0 skips.
    maxAllowedSkippedTests: process.platform === 'win32' ? 3 : 0,
    commands: [
      { bin: 'bun', args: ['--filter', '@moonwitness/corpus', 'build'] },
      { bin: 'bun', args: ['--filter', '@moonwitness/corpus', 'typecheck'] },
      { bin: 'bun', args: ['--filter', '@moonwitness/corpus', 'test', '--', '--maxWorkers=1'] },
    ],
  },
  {
    id: 'research-build-and-test',
    allowPostgresSkipWhenUnset: false,
    maxAllowedSkippedTests: 0,
    commands: [
      { bin: 'bun', args: ['--filter', '@moonwitness/research', 'build'] },
      { bin: 'bun', args: ['--filter', '@moonwitness/research', 'typecheck'] },
      { bin: 'bun', args: ['--filter', '@moonwitness/research', 'test', '--', '--maxWorkers=1'] },
    ],
  },
  {
    id: 'local-ai-build-and-test',
    allowPostgresSkipWhenUnset: false,
    // 16 conditional matrix branches in prompt-injection.test.ts (it.runIf per LMI-01..13 expectation profile).
    maxAllowedSkippedTests: 16,
    commands: [
      { bin: 'bun', args: ['--filter', '@moonwitness/local-ai', 'build'] },
      { bin: 'bun', args: ['--filter', '@moonwitness/local-ai', 'typecheck'] },
      { bin: 'bun', args: ['--filter', '@moonwitness/local-ai', 'test', '--', '--maxWorkers=1'] },
    ],
  },
  {
    id: 'orm-knowledge-build-and-test',
    allowPostgresSkipWhenUnset: true,
    maxAllowedSkippedTests: 0,
    commands: [
      { bin: 'bun', args: ['--filter', '@moonwitness/orm-knowledge', 'build'] },
      {
        bin: 'bun',
        args: ['--filter', '@moonwitness/orm-knowledge', 'test', '--', '--maxWorkers=1'],
      },
    ],
  },
  {
    id: 'compliance-and-egress-certification',
    allowPostgresSkipWhenUnset: false,
    maxAllowedSkippedTests: 0,
    commands: [
      { bin: 'node', args: ['scripts/knowledge/verify-compliance-scan.mjs'] },
      {
        bin: 'node',
        args: [
          '--test',
          'scripts/knowledge/offline-egress-certification.test.mjs',
          'scripts/knowledge/verify-compliance-scan.test.mjs',
          'scripts/knowledge/run-k-gate.test.mjs',
        ],
      },
    ],
  },
  {
    id: 'roadmap-contract',
    allowPostgresSkipWhenUnset: false,
    maxAllowedSkippedTests: 0,
    commands: [{ bin: 'node', args: ['scripts/roadmap/validate-roadmap.mjs'] }],
  },
];

function executeCommand(command, cwd) {
  const isBun = command.bin === 'bun';
  const env = {
    ...process.env,
    AI_MODE: 'disabled',
  };
  const packageManager = isBun ? resolvePackageManager() : null;
  if (isBun && !packageManager) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Could not resolve package manager (bun).',
      error: 'Could not resolve package manager (bun).',
    };
  }
  const result = isBun
    ? spawnSync(packageManager.command, [...packageManager.prefixArgs, ...command.args], {
        cwd,
        encoding: 'utf8',
        shell: packageManager.shell,
        maxBuffer: 16 * 1024 * 1024,
        env,
      })
    : spawnSync(process.execPath, command.args, {
        cwd,
        encoding: 'utf8',
        shell: false,
        maxBuffer: 16 * 1024 * 1024,
        env,
      });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error.message ?? result.error) : null,
  };
}

export function evaluateStepOutcome(step, combinedOutput, exitCode, options = {}) {
  const { skippedFiles, skippedTests } = extractSkipMetrics(combinedOutput);
  const postgresConfigured = Boolean(options.postgresTestUrl ?? process.env.POSTGRES_TEST_URL);
  const postgresSkipAllowed =
    !options.strictNoSkip && Boolean(step.allowPostgresSkipWhenUnset) && !postgresConfigured;
  const maxAllowedSkippedTests = options.strictNoSkip ? 0 : (step.maxAllowedSkippedTests ?? 0);

  if (exitCode !== 0) {
    return {
      id: step.id,
      status: 'failed',
      exitCode,
      skippedFiles,
      skippedTests,
      reason: `command_failed_${exitCode}`,
    };
  }
  if (skippedFiles > 0 && !postgresSkipAllowed) {
    return {
      id: step.id,
      status: 'failed',
      exitCode: 1,
      skippedFiles,
      skippedTests,
      reason: 'required_test_files_skipped',
    };
  }
  if (!postgresSkipAllowed && skippedTests > maxAllowedSkippedTests) {
    return {
      id: step.id,
      status: 'failed',
      exitCode: 1,
      skippedFiles,
      skippedTests,
      reason: 'required_tests_skipped',
    };
  }
  if (postgresSkipAllowed && (skippedFiles > 0 || skippedTests > 0)) {
    return {
      id: step.id,
      status: 'passed_with_postgres_skips',
      exitCode: 0,
      skippedFiles,
      skippedTests,
      reason: null,
    };
  }
  return {
    id: step.id,
    status: skippedTests > 0 ? 'passed_with_declared_skips' : 'passed',
    exitCode: 0,
    skippedFiles,
    skippedTests,
    reason: null,
  };
}

export function runKnowledgeGate({
  cwd = repositoryRoot,
  strictNoSkip = false,
  steps = KNOWLEDGE_GATE_STEPS,
  runner = executeCommand,
  postgresTestUrl = process.env.POSTGRES_TEST_URL,
} = {}) {
  const sourceSha = resolveGitSha(cwd);
  const startedAt = new Date().toISOString();
  const stepResults = [];
  let overallPassed = true;

  for (const step of steps) {
    let combinedOutput = '';
    let stepExitCode = 0;

    for (const command of step.commands) {
      const result = runner(command, cwd);
      combinedOutput += `${result.stdout}\n${result.stderr}\n`;
      if (result.error) {
        combinedOutput += `${result.error}\n`;
      }
      if (result.exitCode !== 0) {
        stepExitCode = result.exitCode;
        break;
      }
    }

    const evaluated = evaluateStepOutcome(step, combinedOutput, stepExitCode, {
      strictNoSkip,
      postgresTestUrl,
    });
    stepResults.push(evaluated);
    if (evaluated.status === 'failed') {
      overallPassed = false;
    }
  }

  return {
    contract: 'mw:k9-001:knowledge-gate:v1',
    sourceSha,
    aiMode: 'disabled',
    strictNoSkip,
    postgresConfigured: Boolean(postgresTestUrl),
    startedAt,
    completedAt: new Date().toISOString(),
    overallStatus: overallPassed ? 'passed' : 'failed',
    steps: stepResults,
  };
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const options = parseGateArgs(process.argv.slice(2));
  const summary = runKnowledgeGate({ strictNoSkip: options.strictNoSkip });
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `K9-001 Gate (${summary.sourceSha}): ${summary.overallStatus} (strictNoSkip=${String(summary.strictNoSkip)}, postgresConfigured=${String(summary.postgresConfigured)})`
    );
    for (const step of summary.steps) {
      console.log(
        ` - ${step.id}: ${step.status} (skippedFiles=${step.skippedFiles}, skippedTests=${step.skippedTests}${step.reason ? `, reason=${step.reason}` : ''})`
      );
    }
  }
  if (summary.overallStatus !== 'passed') {
    process.exitCode = 1;
  }
}
