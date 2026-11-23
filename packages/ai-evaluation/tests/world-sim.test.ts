import { describe, expect, it } from 'vitest';
import { createSeededPrng, generateWorldSimScenario } from '../src/world-sim.js';

describe('world-sim deterministic simulator', () => {
  it('produces identical PRNG sequences for the same seed', () => {
    const a = createSeededPrng(1337);
    const b = createSeededPrng(1337);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('generates bit-identical scenarios and SHA-256 for identical seeds', () => {
    const s1 = generateWorldSimScenario({ seed: 42, agentCount: 4 });
    const s2 = generateWorldSimScenario({ seed: 42, agentCount: 4 });
    expect(s1.scenarioSha256).toBe(s2.scenarioSha256);
    expect(s1.agents).toEqual(s2.agents);
  });

  it('injects controllable obligation drift and world-model surprise faults', () => {
    const clean = generateWorldSimScenario({
      seed: 99,
      faults: { injectObligationDrift: false, injectWorldModelSurprise: false },
    });
    const drifted = generateWorldSimScenario({
      seed: 99,
      faults: { injectObligationDrift: true, injectWorldModelSurprise: true },
    });
    expect(clean.scenarioSha256).not.toBe(drifted.scenarioSha256);
    expect(drifted.worldSnapshot.repoGitSha).not.toBe(drifted.obligations[0]?.expectedRepoGitSha);
    expect(drifted.worldObservation.observedChangedFiles?.length).toBeGreaterThan(
      clean.worldObservation.observedChangedFiles?.length ?? 0
    );
  });
});
