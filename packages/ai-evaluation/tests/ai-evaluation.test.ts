import { describe, expect, it } from 'vitest';
import {
  computeSliceMetrics,
  evaluateCapabilityGate,
  evaluateCapabilityGates,
  evaluateMemoryPromotionGate,
  evaluateReleaseGates,
  runBaselineComparison,
  runEvaluationCorpus,
  runMemoryAblationSuite,
  runOverlapDetectorBenchmark,
  summarizeRunDataset,
  validateEvaluationReport,
} from '../src/index.js';

describe('@moonwitness/ai-evaluation suite, memory ablation, and G0-G6 capability gates', () => {
  it('runs 4-arm memory ablation (no-memory, episodic-only, skill-only, combined) and blocks harmful promotions', async () => {
    const report = await runMemoryAblationSuite({ mode: 'mock' });
    for (const arm of ['no-memory', 'episodic-only', 'skill-only', 'combined'] as const) {
      expect(report.conditions[arm]).toBeDefined();
      expect(report.arms[arm]).toBeDefined();
    }
    expect(report.recommendation).toBe('promote');

    const badGate = await evaluateMemoryPromotionGate({
      baselinePassRate: 0.9,
      withMemoryPassRate: 0.55,
      memoryHarmRate: 0.35,
      unauthorizedActionRate: 0.1,
    });
    expect(badGate.approved).toBe(false);
  });

  it('executes deterministic corpus with full provenance, preserves failed runs, and compares baselines', async () => {
    const corpus = await runEvaluationCorpus({ mode: 'mock', includeFailedFixtures: true });
    expect(corpus.sourceSha).toBeTruthy();
    expect(corpus.fixtureHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(corpus.families.length).toBeGreaterThanOrEqual(4);
    expect(corpus.runs.some((r) => r.status === 'failed')).toBe(true);
    expect(typeof corpus.metrics.costPerAcceptedDeliverable).toBe('number');

    expect(
      validateEvaluationReport({
        sourceSha: corpus.sourceSha,
        fixtureHash: corpus.fixtureHash,
        runs: corpus.runs,
      })
    ).toBe(true);

    expect(() =>
      validateEvaluationReport({
        sourceSha: null,
        fixtureHash: null,
        droppedFailedRuns: true,
        runs: [],
      })
    ).toThrow();

    const baseline = await runBaselineComparison({ mode: 'mock' });
    expect(baseline.multiAgent.passRate).toBeGreaterThan(baseline.singleAgent.passRate);

    const summary = summarizeRunDataset([
      { id: 'r1', status: 'passed' },
      { id: 'r2', status: 'failed' },
      { id: 'r3', status: 'partial' },
      { id: 'r4', status: 'cancelled' },
    ]);
    expect(summary).toEqual({
      totalRuns: 4,
      passedRuns: 1,
      acceptedRuns: 1,
      failedRuns: 1,
      partialRuns: 1,
      cancelledRuns: 1,
    });
  });

  it('evaluates G0-G6 capability gates and G1-G14 release gates offline with agiClaimed=false', async () => {
    const gateSuite = await evaluateCapabilityGates({ mode: 'mock' });
    expect(gateSuite.passed).toBe(true);
    expect(gateSuite.agiClaimed).toBe(false);
    expect(gateSuite.gates.length).toBe(7);
    for (const g of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'] as const) {
      expect(gateSuite.gates[g]?.passed).toBe(true);
    }

    const unsafe = evaluateCapabilityGate('G1', {
      taskSuccessRate: 1.0,
      evidenceCompleteness: 1.0,
      unauthorizedActionRate: 0.01,
      retainedFunctionality: 1.0,
    });
    expect(unsafe.passed).toBe(false);

    const regressed = evaluateCapabilityGate('G2', {
      taskSuccessRate: 0.95,
      evidenceCompleteness: 1.0,
      unauthorizedActionRate: 0,
      retainedFunctionality: 0.4,
    });
    expect(regressed.passed).toBe(false);

    const slice = computeSliceMetrics({
      acceptedDeliverables: 1,
      totalCostMicros: 1_200,
      verifiedCriteria: 2,
      requiredCriteria: 2,
      recoveryTimeMs: 45,
    });
    expect(slice.costPerAcceptedDeliverableMicros).toBe(1_200);
    expect(slice.evidenceCompletenessRate).toBe(1);
    expect(slice.timeToRecoveryMs).toBe(45);

    const release = await evaluateReleaseGates({ mode: 'offline' });
    expect(release.passed).toBe(true);
    expect(release.agiClaimed).toBe(false);
    expect(release.results.G14?.passed).toBe(true);
  });

  it('runs 6-state M13.03 Overlap Detector offline benchmark with advisoryOnly invariant', async () => {
    const benchmark = await runOverlapDetectorBenchmark({ companyId: 1 });
    expect(benchmark.actualStatuses).toEqual(benchmark.expectedStatuses);
    expect(benchmark.passed).toBe(true);
    expect(benchmark.totalCases).toBe(6);
    expect(benchmark.matchedCases).toBe(6);
    expect(benchmark.advisoryOnlyEnforced).toBe(true);
    expect(benchmark.benchmarkSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
