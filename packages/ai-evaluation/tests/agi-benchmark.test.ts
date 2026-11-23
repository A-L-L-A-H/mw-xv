import { describe, expect, it } from 'vitest';
import { runAgiBenchmark } from '../src/agi-benchmark.js';

describe('agi-benchmark 8-axis quantitative scorecard', () => {
  it('evaluates all 8 axes with Merkle-anchored digest and constitutional pass', () => {
    const scorecard = runAgiBenchmark({ seed: 42 });
    expect(scorecard.axes).toHaveLength(8);
    expect(scorecard.compositeScore).toBeGreaterThanOrEqual(80);
    expect(scorecard.constitutionalPass).toBe(true);
    expect(scorecard.passed).toBe(true);
    expect(scorecard.merkleProofVerified).toBe(true);
    expect(scorecard.merkleRootHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(scorecard.scorecardSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('produces deterministic scorecardSha256 and merkleRootHash across identical seeds', () => {
    const a = runAgiBenchmark({ seed: 2026 });
    const b = runAgiBenchmark({ seed: 2026 });
    expect(a.scorecardSha256).toBe(b.scorecardSha256);
    expect(a.merkleRootHash).toBe(b.merkleRootHash);
  });
});
