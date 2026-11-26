import { describe, expect, test } from 'vitest';
import {
  branchScenario,
  compareScenarios,
  createBaselineScenario,
  propagateDoCalculus,
  type CausalGraph,
} from '../src/causal-world-sim-v2.js';

const sampleGraph: CausalGraph = {
  nodes: new Map([
    ['rain', { id: 'rain', label: 'Rain', baselineValue: 0 }],
    ['sprinkler', { id: 'sprinkler', label: 'Sprinkler', baselineValue: 1 }],
    ['wet', { id: 'wet', label: 'Wet Grass', baselineValue: 1 }],
  ]),
  edges: [
    { from: 'rain', to: 'sprinkler', weight: -0.5 },
    { from: 'rain', to: 'wet', weight: 1.0 },
    { from: 'sprinkler', to: 'wet', weight: 0.8 },
  ],
};

describe('causal-world-sim-v2', () => {
  test('propagates do-calculus interventions and severs incoming edges', () => {
    const values = propagateDoCalculus(sampleGraph, new Map([['sprinkler', 0]]));
    expect(values.get('rain')).toBe(0);
    expect(values.get('sprinkler')).toBe(0);
    expect(values.get('wet')).toBeCloseTo(0.2, 6);
  });

  test('supports multi-step scenario branching and comparison', () => {
    const base = createBaselineScenario(sampleGraph);
    const step1 = branchScenario(sampleGraph, base, 's1', new Map([['rain', 2]]));
    const step2 = branchScenario(sampleGraph, step1, 's2', new Map([['sprinkler', 1]]));

    expect(step1.step).toBe(1);
    expect(step2.step).toBe(2);
    expect(step2.parentScenarioId).toBe('s1');

    const diffs = compareScenarios(base, step2);
    const wetDiff = diffs.find((d) => d.nodeId === 'wet');
    expect(wetDiff?.delta).toBeCloseTo(2.0, 6);
  });
});
