import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkDesktopPcwBoundary, runAiDriftWatchdog } from './ai-drift-watchdog.mjs';

test('runAiDriftWatchdog executes memory ablation, evaluation corpus, G0-G6 capability gates, and desktop PCW checks', async () => {
  const first = await runAiDriftWatchdog();
  const second = await runAiDriftWatchdog();

  assert.equal(first.format, 'moonwitness-ai-drift-watchdog/v1');
  assert.equal(first.passed, true);
  assert.equal(first.agiClaimed, false);
  assert.equal(first.driftAlerts.length, 0);
  assert.equal(first.memoryAblation.promotionApproved, true);
  assert.deepEqual(first.memoryAblation.arms, [
    'combined',
    'episodic-only',
    'no-memory',
    'skill-only',
  ]);
  assert.equal(first.capabilityGates.highestSatisfiedGate, 'G6');
  for (const gateId of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6']) {
    assert.equal(first.capabilityGates.gates[gateId].passed, true);
  }
  assert.equal(first.desktopPcwBoundary.passed, true);
  assert.equal(first.watchdogSha256, second.watchdogSha256);
});

test('checkDesktopPcwBoundary detects PCW sidecar or non-overlap regressions in temp fixtures', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'mw-ai-watchdog-pcw-'));
  try {
    await mkdir(path.join(tempRoot, 'apps/desktop/src'), { recursive: true });
    await mkdir(path.join(tempRoot, 'apps/board/src'), { recursive: true });

    await writeFile(
      path.join(tempRoot, 'apps/desktop/src/local-sidecar.ts'),
      'export function acquireSingleWriterLock() {} export function computeEnvelopeSha256() {} const t = "desktop_pcw_outbox";\n'
    );
    await writeFile(
      path.join(tempRoot, 'apps/desktop/src/agent-runner.ts'),
      'export const policy = { allowCloudFallback: false };\n'
    );
    await writeFile(
      path.join(tempRoot, 'apps/board/src/app.tsx'),
      'export function App() { return null; }\n'
    );

    const clean = await checkDesktopPcwBoundary(tempRoot);
    assert.equal(clean.passed, true);

    await writeFile(
      path.join(tempRoot, 'apps/desktop/src/agent-runner.ts'),
      'export const policy = { allowCloudFallback: true };\n'
    );
    const broken = await checkDesktopPcwBoundary(tempRoot);
    assert.equal(broken.passed, false);
    assert.ok(
      broken.violations.some((v) =>
        v.includes('missing allowCloudFallback: false routing invariant')
      )
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('runAiDriftWatchdog flags drift alerts when a capability gate or ablation gate regresses', async () => {
  const mockAiEval = {
    runMemoryAblationSuite: async () => ({
      promotionApproved: false,
      promotionReasons: ['Utility gain below threshold'],
      utilityGainBps: 100,
      harmRateBps: 0,
      transferRetentionBps: 8000,
      arms: { 'no-memory': {}, 'episodic-only': {}, 'skill-only': {}, 'episodic+skill': {} },
      reportSha256: 'a'.repeat(64),
    }),
    runEvaluationCorpus: async () => ({
      sourceSha: 'deadbeef',
      fixtureHash: 'b'.repeat(64),
      families: ['coding'],
      runs: [{ id: '1', status: 'failed' }],
      metrics: {
        verifiedSuccessRateBps: 5000,
        evidenceCompletenessRateBps: 9000,
        unauthorizedActionRateBps: 100,
        costPerAcceptedDeliverableMicros: 1500,
      },
      reportSha256: 'c'.repeat(64),
    }),
    evaluateCapabilityGates: async () => ({
      passed: false,
      agiClaimed: false,
      highestSatisfiedGate: 'G2',
      gates: {
        G0: { passed: true, reasons: [] },
        G1: { passed: true, reasons: [] },
        G2: { passed: true, reasons: [] },
        G3: { passed: false, reasons: ['Memory ablation failed'] },
        G4: { passed: false, reasons: ['Blocked by G3'] },
        G5: { passed: false, reasons: ['Blocked by G4'] },
        G6: { passed: false, reasons: ['Blocked by G5'] },
      },
      reportSha256: 'd'.repeat(64),
    }),
  };

  const report = await runAiDriftWatchdog({ aiEvaluationModule: mockAiEval });
  assert.equal(report.passed, false);
  assert.ok(report.driftAlerts.length >= 3);
  assert.ok(report.driftAlerts.some((a) => a.includes('Memory ablation promotion gate failed')));
  assert.ok(report.driftAlerts.some((a) => a.includes("Expected highestSatisfiedGate to be 'G6'")));
});
