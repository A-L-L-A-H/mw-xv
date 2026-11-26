import { describe, expect, test } from 'vitest';
import {
  aggregateMizanScores,
  traverseMizanGraph,
  type MizanGraph,
} from '../src/mizan-graph.js';

describe('mizan-graph', () => {
  test('performs cycle-safe traversal and detects cycles', () => {
    const graph: MizanGraph = {
      nodes: new Map([
        ['a', { id: 'a', epistemicWeight: 0.9, ethicalWeight: 0.9 }],
        ['b', { id: 'b', epistemicWeight: 0.7, ethicalWeight: 0.7 }],
        ['c', { id: 'c', epistemicWeight: 0.8, ethicalWeight: 0.8 }],
      ]),
      edges: [
        { from: 'a', to: 'b', weight: 1 },
        { from: 'b', to: 'c', weight: 1 },
        { from: 'c', to: 'a', weight: 1 },
      ],
    };

    const traversal = traverseMizanGraph(graph, 'a');
    expect(traversal.visitedOrder).toEqual(['a', 'b', 'c']);
    expect(traversal.cyclesDetected).toBe(1);
  });

  test('aggregates epistemic, ethical, and balance scores', () => {
    const graph: MizanGraph = {
      nodes: new Map([
        ['root', { id: 'root', epistemicWeight: 0.8, ethicalWeight: 0.8 }],
        ['leaf', { id: 'leaf', epistemicWeight: 0.6, ethicalWeight: 0.6 }],
      ]),
      edges: [{ from: 'root', to: 'leaf', weight: 1 }],
    };

    const summary = aggregateMizanScores(graph, 'root');
    expect(summary.reachableCount).toBe(2);
    expect(summary.epistemicScore).toBeCloseTo(0.7, 6);
    expect(summary.ethicalScore).toBeCloseTo(0.7, 6);
    expect(summary.balanceIndex).toBeCloseTo(1.0, 6);
  });
});
