import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { computePassAtK, computeReliabilityProfile } from '../src/pass-at-k.js';

describe('pass^k reliability metric', () => {
  it('requires every trial to succeed', () => {
    const result = computePassAtK({
      trialsByTask: [
        [true, true, true],
        [true, false, true],
      ],
      k: 3,
    });
    expect(result.taskCount).toBe(2);
    expect(result.qualifyingTaskCount).toBe(1);
    expect(result.passAtK).toBe(0.5);
    expect(result.passAtKBps).toBe(5_000);
  });

  it('uses combinations when more trials than k are available', () => {
    const result = computePassAtK({ trialsByTask: [[true, true, true, false]], k: 2 });
    // C(3,2) / C(4,2) = 3/6
    expect(result.passAtK).toBe(0.5);
  });

  it('reports zero when the sample is too small for k', () => {
    expect(computePassAtK({ trialsByTask: [[true, true]], k: 3 }).passAtK).toBe(0);
  });

  it('produces a deterministic profile digest', () => {
    const trials = [
      [true, true, true],
      [true, true, true],
    ];
    const first = computeReliabilityProfile(trials);
    const second = computeReliabilityProfile(trials);
    assert.equal(first.pass3.passAtK, 1);
    assert.equal(first.pass3.reportSha256, second.pass3.reportSha256);
  });

  it('rejects invalid k and empty datasets', () => {
    expect(() => computePassAtK({ trialsByTask: [], k: 1 })).toThrow();
    expect(() => computePassAtK({ trialsByTask: [[true]], k: 0 })).toThrow();
  });
});
