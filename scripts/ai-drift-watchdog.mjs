import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  findBoardRuntimeImportViolations,
  findDesktopNonOverlapViolations,
} from './check-desktop-non-overlap.mjs';
import { resolvePackageManager } from './package-manager.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_GATES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function listFilesRecursive(baseDir, predicate) {
  if (!existsSync(baseDir)) return [];
  const entries = await readdir(baseDir, { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await listFilesRecursive(fullPath, predicate)));
    } else if (entry.isFile() && predicate(fullPath, entry.name)) {
      collected.push(fullPath);
    }
  }
  return collected;
}

async function loadAiEvaluationModule(workspaceRoot = defaultRoot) {
  const aiEvaluationDist = path.join(workspaceRoot, 'packages/ai-evaluation/dist/index.js');
  const aiRuntimeDist = path.join(workspaceRoot, 'packages/ai-runtime/dist/index.js');

  if (!existsSync(aiEvaluationDist) || !existsSync(aiRuntimeDist)) {
    const packageManager = resolvePackageManager();
    if (!packageManager) {
      throw new Error('Could not resolve package manager (bun) to build AI evaluation packages.');
    }
    for (const pkg of ['@moonwitness/ai-runtime', '@moonwitness/ai-evaluation']) {
      execFileSync(
        packageManager.command,
        [...packageManager.prefixArgs, '--filter', pkg, 'build'],
        {
          cwd: workspaceRoot,
          stdio: 'ignore',
          ...(packageManager.shell ? { shell: true } : {}),
        }
      );
    }
  }

  return await import(pathToFileURL(aiEvaluationDist).href);
}

/**
 * Verifies Desktop PCW (Proof-Carrying Work) boundary & membrane invariants across `apps/desktop/src` and `apps/board/src`.
 */
export async function checkDesktopPcwBoundary(workspaceRoot = defaultRoot) {
  const desktopDir = path.join(workspaceRoot, 'apps/desktop/src');
  const boardDir = path.join(workspaceRoot, 'apps/board/src');

  const [desktopFiles, boardFiles] = await Promise.all([
    listFilesRecursive(desktopDir, (_full, name) => /\.[cm]?[jt]s$/u.test(name)),
    listFilesRecursive(boardDir, (_full, name) => /\.[cm]?[jt]sx?$/u.test(name)),
  ]);

  const violations = [];
  for (const file of desktopFiles) {
    const rel = path.relative(workspaceRoot, file).replaceAll('\\', '/');
    const source = await readFile(file, 'utf8');
    violations.push(...findDesktopNonOverlapViolations(source, rel));
  }

  for (const file of boardFiles) {
    const rel = path.relative(workspaceRoot, file).replaceAll('\\', '/');
    const source = await readFile(file, 'utf8');
    violations.push(...findBoardRuntimeImportViolations(source, rel));
  }

  const localSidecarPath = path.join(desktopDir, 'local-sidecar.ts');
  const agentRunnerPath = path.join(desktopDir, 'agent-runner.ts');
  const pcwInvariants = {
    hasSingleWriterLock: false,
    hasEnvelopeSha256: false,
    hasPcwOutboxTable: false,
    hasFailClosedZeroCloudFallback: false,
  };

  if (existsSync(localSidecarPath)) {
    const sidecarSource = await readFile(localSidecarPath, 'utf8');
    pcwInvariants.hasSingleWriterLock = /\bacquireSingleWriterLock\b/u.test(sidecarSource);
    pcwInvariants.hasEnvelopeSha256 = /\bcomputeEnvelopeSha256\b/u.test(sidecarSource);
    pcwInvariants.hasPcwOutboxTable = /\bdesktop_pcw_outbox\b/u.test(sidecarSource);
    if (!pcwInvariants.hasSingleWriterLock) {
      violations.push(
        'apps/desktop/src/local-sidecar.ts: missing acquireSingleWriterLock invariant'
      );
    }
    if (!pcwInvariants.hasEnvelopeSha256) {
      violations.push('apps/desktop/src/local-sidecar.ts: missing computeEnvelopeSha256 invariant');
    }
    if (!pcwInvariants.hasPcwOutboxTable) {
      violations.push(
        'apps/desktop/src/local-sidecar.ts: missing desktop_pcw_outbox table invariant'
      );
    }
  } else {
    violations.push('apps/desktop/src/local-sidecar.ts: required PCW sidecar module is missing');
  }

  if (existsSync(agentRunnerPath)) {
    const runnerSource = await readFile(agentRunnerPath, 'utf8');
    pcwInvariants.hasFailClosedZeroCloudFallback = /allowCloudFallback\s*:\s*false/u.test(
      runnerSource
    );
    if (!pcwInvariants.hasFailClosedZeroCloudFallback) {
      violations.push(
        'apps/desktop/src/agent-runner.ts: missing allowCloudFallback: false routing invariant'
      );
    }
  } else {
    violations.push(
      'apps/desktop/src/agent-runner.ts: required desktop agent runner module is missing'
    );
  }

  return {
    passed: violations.length === 0,
    scannedDesktopFiles: desktopFiles.length,
    scannedBoardFiles: boardFiles.length,
    pcwInvariants,
    violations,
  };
}

/**
 * Executes the autonomous continuous evaluation, 4-arm memory ablation, G0-G6 capability gates,
 * and Desktop PCW boundary watchdog.
 */
export async function runAiDriftWatchdog(options = {}) {
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : defaultRoot;
  const aiEvaluation = options.aiEvaluationModule ?? (await loadAiEvaluationModule(workspaceRoot));

  const [ablationReport, corpusReport, pcwBoundary] = await Promise.all([
    aiEvaluation.runMemoryAblationSuite({ mode: 'mock' }),
    aiEvaluation.runEvaluationCorpus({ mode: 'mock', includeFailedFixtures: true }),
    checkDesktopPcwBoundary(workspaceRoot),
  ]);

  const capabilityGates = await aiEvaluation.evaluateCapabilityGates({
    mode: 'mock',
    metrics: corpusReport.metrics,
    ablationReport,
  });

  const driftAlerts = [];

  const promotionApproved =
    ablationReport.promotionApproved === true || ablationReport.recommendation === 'promote';
  const bestSummary =
    ablationReport.bestMode && ablationReport.conditionSummaries
      ? ablationReport.conditionSummaries[ablationReport.bestMode]
      : undefined;
  const utilityGainBps =
    ablationReport.utilityGainBps ?? bestSummary?.utilityGainVsNoMemoryBps ?? 0;
  const harmRateBps = ablationReport.harmRateBps ?? bestSummary?.harmRateBps ?? 0;
  const transferRetentionBps =
    ablationReport.transferRetentionBps ?? bestSummary?.transferPassRateBps ?? 0;

  if (!promotionApproved) {
    driftAlerts.push(
      `Memory ablation promotion gate failed: ${
        ablationReport.promotionReasons?.join('; ') ||
        ablationReport.reason ||
        ablationReport.recommendation ||
        'unapproved'
      }`
    );
  }

  const gateSummaries = {};
  for (const gateId of EXPECTED_GATES) {
    const gate = capabilityGates.gates?.[gateId];
    if (!gate) {
      driftAlerts.push(`Capability gate ${gateId} missing from evaluation report`);
      gateSummaries[gateId] = { passed: false, reasons: ['Missing gate evaluation'] };
    } else {
      gateSummaries[gateId] = {
        passed: gate.passed === true,
        reasons: gate.reasons ?? [],
      };
      if (!gate.passed) {
        driftAlerts.push(`Capability gate ${gateId} failed: ${(gate.reasons ?? []).join('; ')}`);
      }
    }
  }

  if (capabilityGates.highestSatisfiedGate !== 'G6') {
    driftAlerts.push(
      `Expected highestSatisfiedGate to be 'G6', received '${capabilityGates.highestSatisfiedGate}'`
    );
  }
  if (capabilityGates.agiClaimed !== false) {
    driftAlerts.push('Honest non-AGI claim invariant violated: agiClaimed must be false');
  }
  if ((corpusReport.metrics?.unauthorizedActionRateBps ?? 0) > 0) {
    driftAlerts.push(
      `Unauthorized action rate (${corpusReport.metrics.unauthorizedActionRateBps} bps) exceeded 0`
    );
  }
  if (!pcwBoundary.passed) {
    for (const violation of pcwBoundary.violations) {
      driftAlerts.push(`Desktop PCW boundary violation: ${violation}`);
    }
  }

  const passed = driftAlerts.length === 0;

  const corePayload = {
    passed,
    agiClaimed: capabilityGates.agiClaimed,
    highestSatisfiedGate: capabilityGates.highestSatisfiedGate,
    ablationRecommendation:
      ablationReport.recommendation ?? (promotionApproved ? 'promote' : 'hold'),
    ablationBestMode: ablationReport.bestMode ?? null,
    utilityGainBps,
    harmRateBps,
    transferRetentionBps,
    sourceSha: corpusReport.sourceSha,
    fixtureHash: corpusReport.fixtureHash,
    verifiedSuccessRateBps: corpusReport.metrics?.verifiedSuccessRateBps ?? 0,
    unauthorizedActionRateBps: corpusReport.metrics?.unauthorizedActionRateBps ?? 0,
    gates: gateSummaries,
    pcwPassed: pcwBoundary.passed,
    pcwInvariants: pcwBoundary.pcwInvariants,
  };
  const watchdogSha256 = createHash('sha256').update(JSON.stringify(corePayload)).digest('hex');

  const report = {
    format: 'moonwitness-ai-drift-watchdog/v1',
    passed,
    agiClaimed: false,
    watchdogSha256,
    driftAlerts,
    memoryAblation: {
      promotionApproved,
      recommendation: ablationReport.recommendation ?? (promotionApproved ? 'promote' : 'hold'),
      bestMode: ablationReport.bestMode ?? null,
      utilityGainBps,
      harmRateBps,
      transferRetentionBps,
      arms: Object.keys(ablationReport.arms ?? ablationReport.conditionSummaries ?? {}).sort(
        compareText
      ),
      reportSha256: ablationReport.reportSha256,
    },
    evaluationCorpus: {
      sourceSha: corpusReport.sourceSha,
      fixtureHash: corpusReport.fixtureHash,
      families: corpusReport.families,
      totalRuns: corpusReport.runs.length,
      verifiedSuccessRateBps: corpusReport.metrics.verifiedSuccessRateBps,
      evidenceCompletenessRateBps: corpusReport.metrics.evidenceCompletenessRateBps,
      unauthorizedActionRateBps: corpusReport.metrics.unauthorizedActionRateBps,
      costPerAcceptedDeliverableMicros: corpusReport.metrics.costPerAcceptedDeliverableMicros,
      reportSha256: corpusReport.reportSha256,
    },
    capabilityGates: {
      passed: capabilityGates.passed,
      highestSatisfiedGate: capabilityGates.highestSatisfiedGate,
      agiClaimed: capabilityGates.agiClaimed,
      gates: gateSummaries,
      reportSha256: capabilityGates.reportSha256,
    },
    desktopPcwBoundary: pcwBoundary,
  };

  if (options.out) {
    const outPath = path.resolve(options.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : undefined;

  const report = await runAiDriftWatchdog({ out });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `MoonWitness AI Drift Watchdog: ${report.passed ? 'PASSED' : 'DRIFT DETECTED'} · gates=G0..${report.capabilityGates.highestSatisfiedGate} · ablationGain=${report.memoryAblation.utilityGainBps}bps · pcw=${report.desktopPcwBoundary.passed ? 'ok' : 'FAIL'} · sha256=${report.watchdogSha256.slice(0, 12)}\n`
    );
    for (const alert of report.driftAlerts) {
      process.stderr.write(`  - ${alert}\n`);
    }
  }

  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
