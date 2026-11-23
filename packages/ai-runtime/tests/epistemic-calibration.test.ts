import { describe, expect, it } from 'vitest';
import {
  computeEpistemicCalibration,
  deriveDynamicAutonomyPolicy,
} from '../src/epistemic-calibration.js';

describe('epistemic-calibration', () => {
  it('computes exact Brier Score, ECE, and overconfidence index for well-calibrated predictions', () => {
    const samples = [
      { predictedProbability: 0.9, outcome: 1 as const },
      { predictedProbability: 0.9, outcome: 1 as const },
      { predictedProbability: 0.9, outcome: 1 as const },
      { predictedProbability: 0.9, outcome: 1 as const },
      { predictedProbability: 0.9, outcome: 1 as const },
      { predictedProbability: 0.9, outcome: 1 as const },
      { predictedProbability: 0.9, outcome: 1 as const },
      { predictedProbability: 0.9, outcome: 1 as const },
      { predictedProbability: 0.9, outcome: 1 as const },
      { predictedProbability: 0.9, outcome: 0 as const },
    ];

    const report = computeEpistemicCalibration(samples, { numBins: 10 });
    const policy = deriveDynamicAutonomyPolicy(report);

    expect(report.sampleCount).toBe(10);
    expect(report.invalidSampleCount).toBe(0);
    // 9 * (0.9 - 1)^2 + 1 * (0.9 - 0)^2 = 0.09 + 0.81 = 0.90; / 10 = 0.09
    expect(report.brierScore).toBe(0.09);
    expect(report.ece).toBe(0);
    expect(report.avgConfidence).toBe(0.9);
    expect(report.empiricalAccuracy).toBe(0.9);
    expect(report.overconfidenceIndex).toBe(0);
    expect(report.automatedPromotionAllowed).toBe(false);
    expect(report.automatedSelfAccept).toBe(false);
    expect(report.calibrationSha256).toMatch(/^[a-f0-9]{64}$/u);

    expect(policy.mode).toBe('standard');
    expect(policy.maxAutonomyTier).toBe('R3');
    expect(policy.extraRtvBranches).toBe(0);
    expect(policy.r4HumanGateLocked).toBe(true);
    expect(policy.automatedPromotionAllowed).toBe(false);
    expect(policy.automatedSelfAccept).toBe(false);
    expect(policy.policySha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('escalates to require_extra_rtv_branches on moderate miscalibration', () => {
    const samples = [
      { predictedProbability: 0.85, outcome: true },
      { predictedProbability: 0.85, outcome: true },
      { predictedProbability: 0.85, outcome: true },
      { predictedProbability: 0.85, outcome: true },
      { predictedProbability: 0.85, outcome: true },
      { predictedProbability: 0.85, outcome: true },
      { predictedProbability: 0.85, outcome: true },
      { predictedProbability: 0.85, outcome: false },
      { predictedProbability: 0.85, outcome: false },
      { predictedProbability: 0.85, outcome: false },
    ];
    // avgConfidence = 0.85, empiricalAccuracy = 0.70 -> ece = 0.15? Wait: 0.85 - 0.70 = 0.15 hits human gate!
    // Use 0.80 with 7/10 = 0.70 -> ece = 0.10, overconfidence = 0.10, brier = (7*0.04 + 3*0.64)/10 = 0.22
    const moderateSamples = samples.map((s) => ({
      predictedProbability: 0.8,
      outcome: s.outcome,
    }));

    const report = computeEpistemicCalibration(moderateSamples);
    const policy = deriveDynamicAutonomyPolicy(report);

    expect(report.ece).toBe(0.1);
    expect(report.overconfidenceIndex).toBe(0.1);
    expect(report.brierScore).toBe(0.22);
    expect(policy.mode).toBe('require_extra_rtv_branches');
    expect(policy.maxAutonomyTier).toBe('R2');
    expect(policy.extraRtvBranches).toBe(1);
    expect(policy.r4HumanGateLocked).toBe(true);
    expect(policy.automatedSelfAccept).toBe(false);
  });

  it('escalates to require_human_gate on severe overconfidence or insufficient samples', () => {
    const overconfidentSamples = [
      { predictedProbability: 0.95, outcome: 0 as const },
      { predictedProbability: 0.95, outcome: 0 as const },
      { predictedProbability: 0.95, outcome: 0 as const },
      { predictedProbability: 0.95, outcome: 1 as const },
      { predictedProbability: 0.95, outcome: 0 as const },
    ];

    const report = computeEpistemicCalibration(overconfidentSamples);
    const policy = deriveDynamicAutonomyPolicy(report);

    expect(report.overconfidenceIndex).toBe(0.75);
    expect(report.ece).toBe(0.75);
    expect(policy.mode).toBe('require_human_gate');
    expect(policy.maxAutonomyTier).toBe('R1');
    expect(policy.extraRtvBranches).toBe(2);
    expect(policy.r4HumanGateLocked).toBe(true);
    expect(policy.automatedSelfAccept).toBe(false);

    const emptyReport = computeEpistemicCalibration([]);
    const emptyPolicy = deriveDynamicAutonomyPolicy(emptyReport);
    expect(emptyReport.sampleCount).toBe(0);
    expect(emptyReport.brierScore).toBe(1);
    expect(emptyReport.ece).toBe(1);
    expect(emptyPolicy.mode).toBe('require_human_gate');
    expect(emptyPolicy.maxAutonomyTier).toBe('R1');
  });

  it('ignores invalid out-of-range probabilities and produces deterministic digests', () => {
    const samples = [
      { predictedProbability: 1.5, outcome: 1 as const },
      { predictedProbability: Number.NaN, outcome: 0 as const },
      { predictedProbability: 1.0, outcome: 1 as const },
      { predictedProbability: 0.0, outcome: 0 as const },
    ];

    const first = computeEpistemicCalibration(samples);
    const second = computeEpistemicCalibration(samples);

    expect(first.sampleCount).toBe(2);
    expect(first.invalidSampleCount).toBe(2);
    expect(first.brierScore).toBe(0);
    expect(first.ece).toBe(0);
    expect(first.calibrationSha256).toBe(second.calibrationSha256);
  });
});
