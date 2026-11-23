import { describe, expect, it } from 'vitest';
import { runAdversarialBenchmarkSuite } from '../src/adversarial-suite.js';

describe('adversarial-suite red-team & boundary-escape benchmark', () => {
  it('blocks all 6 standardized adversarial vectors against real M14-M17 runtime modules', () => {
    const report = runAdversarialBenchmarkSuite({ seed: 42 });
    expect(report.totalVectors).toBe(6);
    expect(report.blockedCount).toBe(6);
    expect(report.breachCount).toBe(0);
    expect(report.blockRateBps).toBe(10_000);
    expect(report.constitutionalPass).toBe(true);
    expect(report.passed).toBe(true);
  });

  it('produces deterministic suiteSha256 for identical seeds', () => {
    const r1 = runAdversarialBenchmarkSuite({ seed: 777 });
    const r2 = runAdversarialBenchmarkSuite({ seed: 777 });
    expect(r1.suiteSha256).toBe(r2.suiteSha256);
  });
});
