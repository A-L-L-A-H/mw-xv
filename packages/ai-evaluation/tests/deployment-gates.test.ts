import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BENCHMARK_FIXTURES,
  evaluateCapabilityGates,
  runEvaluationCorpus,
  runOfflineEvaluationGates,
  validateEvaluationReport,
} from '../src/index.js';

describe('offline deployment evaluation gate', () => {
  it('is deterministic and never claims a real model or AGI', async () => {
    const first = await runOfflineEvaluationGates();
    const second = await runOfflineEvaluationGates();

    expect(first.mode).toBe('offline-mock');
    expect(first.realModelUsed).toBe(false);
    expect(first.syntheticFixture).toBe(true);
    expect(first.ok).toBe(true);
    expect(first.checks.every((entry) => entry.passed)).toBe(true);
    expect(first.gates.agiClaimed).toBe(false);
    expect(first.gates.passed).toBe(first.gates.highestSatisfiedGate === 'G6');
    expect(first.gates.gateIds).toEqual([...first.gates.gateIds].sort());
    expect(first.gates.gateIds).toEqual(['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6']);

    expect(second.ok).toBe(true);
    // Raw report digests embed a generation timestamp, so compare the
    // deterministic parts instead of the digests themselves.
    expect(first.corpus.sourceSha).toBe(second.corpus.sourceSha);
    expect(first.corpus.fixtureHash).toBe(second.corpus.fixtureHash);
    expect(first.corpus.runCount).toBe(second.corpus.runCount);
    expect(first.corpus.reportSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.gates.passed).toBe(second.gates.passed);
    expect(first.gates.highestSatisfiedGate).toBe(second.gates.highestSatisfiedGate);
    expect(first.gates.gateIds).toEqual(second.gates.gateIds);
    expect(first.ablation.arms).toEqual(second.ablation.arms);
  });

  it('fails closed on a fabricated evaluation report', async () => {
    const corpus = await runEvaluationCorpus({ mode: 'mock' });
    expect(() => validateEvaluationReport(corpus)).not.toThrow();
    expect(() => validateEvaluationReport({ ...corpus, sourceSha: '' })).toThrow(
      /missing provenance sourceSha/
    );
    expect(() => validateEvaluationReport({ ...corpus, fixtureHash: null })).toThrow(
      /missing provenance fixtureHash/
    );
    expect(() => validateEvaluationReport({ ...corpus, droppedFailedRuns: true })).toThrow(
      /dropped failed runs/
    );
    expect(() => validateEvaluationReport({ ...corpus, runs: [] })).toThrow(/empty runs dataset/);
  });

  it('evaluates gates from supplied metrics instead of hardcoded verdicts', async () => {
    const withFailures = await runEvaluationCorpus({
      mode: 'mock',
      includeFailedFixtures: true,
    });
    const withoutFailures = await runEvaluationCorpus({
      mode: 'mock',
      includeFailedFixtures: false,
    });

    expect(withFailures.runs.length).toBe(
      DEFAULT_BENCHMARK_FIXTURES.length +
        DEFAULT_BENCHMARK_FIXTURES.filter((fixture) => fixture.decomposable).length
    );
    expect(withFailures.metrics).not.toEqual(withoutFailures.metrics);

    const suite = await evaluateCapabilityGates({
      mode: 'mock',
      metrics: withFailures.metrics,
      ablationReport: undefined,
    });
    const replay = await evaluateCapabilityGates({
      mode: 'mock',
      metrics: withFailures.metrics,
      ablationReport: undefined,
    });
    expect(suite.gates.map((gate) => gate.passed)).toEqual(replay.gates.map((gate) => gate.passed));
    expect(suite.agiClaimed).toBe(false);
    expect(suite.disclaimer.length).toBeGreaterThan(0);
  });
});
