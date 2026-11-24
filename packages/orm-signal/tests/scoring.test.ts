import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNAL_SCORE_WEIGHTS,
  SIGNAL_ALERT_DEFAULT_THRESHOLD,
  computeSignalFinalScore,
  shouldFireAlert,
} from '../src/scoring.js';

describe('computeSignalFinalScore', () => {
  it('computes weighted average with default weights', () => {
    const result = computeSignalFinalScore({
      keywordWeight: 1,
      recencyDecay: 1,
      sourceAuthority: 1,
      velocity: 1,
    });
    expect(result.finalScore).toBeCloseTo(1, 10);
    expect(result.weights).toEqual(DEFAULT_SIGNAL_SCORE_WEIGHTS);
  });

  it('weights components proportionally', () => {
    const result = computeSignalFinalScore({
      keywordWeight: 1,
      recencyDecay: 0,
      sourceAuthority: 0,
      velocity: 0,
    });
    expect(result.finalScore).toBeCloseTo(0.35, 10);
  });

  it('honours custom weights', () => {
    const result = computeSignalFinalScore(
      { keywordWeight: 1, recencyDecay: 0, sourceAuthority: 0, velocity: 0 },
      { keywordWeight: 0.5, recencyDecay: 0.5, sourceAuthority: 0, velocity: 0 }
    );
    expect(result.finalScore).toBeCloseTo(0.5, 10);
  });

  it('clamps out-of-range components into [0, 1]', () => {
    const result = computeSignalFinalScore({
      keywordWeight: 5,
      recencyDecay: -3,
      sourceAuthority: 0.5,
      velocity: 0.5,
    });
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.finalScore).toBeLessThanOrEqual(1);
  });

  it('treats non-finite components as invalid', () => {
    expect(() =>
      computeSignalFinalScore({
        keywordWeight: Number.NaN,
        recencyDecay: 0,
        sourceAuthority: 0,
        velocity: 0,
      })
    ).toThrow(/finite number/);
    expect(() =>
      computeSignalFinalScore({
        keywordWeight: 0,
        recencyDecay: 0,
        sourceAuthority: 0,
        velocity: Number.POSITIVE_INFINITY,
      })
    ).toThrow(/finite number/);
  });

  it('rejects weights that sum to zero', () => {
    expect(() =>
      computeSignalFinalScore(
        { keywordWeight: 0.5, recencyDecay: 0.5, sourceAuthority: 0.5, velocity: 0.5 },
        { keywordWeight: 0, recencyDecay: 0, sourceAuthority: 0, velocity: 0 }
      )
    ).toThrow(/positive value/);
  });
});

describe('shouldFireAlert', () => {
  it('fires at or above the default threshold 0.75', () => {
    expect(shouldFireAlert(0.75)).toBe(true);
    expect(shouldFireAlert(0.9)).toBe(true);
    expect(shouldFireAlert(SIGNAL_ALERT_DEFAULT_THRESHOLD)).toBe(true);
  });

  it('stays silent below the threshold', () => {
    expect(shouldFireAlert(0.74)).toBe(false);
    expect(shouldFireAlert(0)).toBe(false);
  });

  it('respects custom thresholds and rejects non-finite scores', () => {
    expect(shouldFireAlert(0.5, 0.5)).toBe(true);
    expect(shouldFireAlert(0.49, 0.5)).toBe(false);
    expect(shouldFireAlert(Number.NaN)).toBe(false);
  });
});
