import { describe, expect, it } from 'bun:test';
import {
  createDagExecutionState,
  DagValidationError,
  detectDagCycles,
  executeDagWorkflow,
  getReadyDagNodes,
  topologicalSortDag,
  transitionDagNode,
} from './dag-engine.js';

describe('dag-engine', () => {
  it('performs deterministic topological sort', () => {
    const order = topologicalSortDag([
      { id: 'c', dependencies: ['a', 'b'] },
      { id: 'b', dependencies: ['a'] },
      { id: 'a' },
      { id: 'd', dependencies: ['c'] },
    ]);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('detects cycles and throws DagValidationError', () => {
    const nodes = [
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['a'] },
    ];
    expect(detectDagCycles(nodes).length).toBeGreaterThan(0);
    expect(() => topologicalSortDag(nodes)).toThrow(DagValidationError);
  });

  it('schedules parallel ready nodes and transitions state', async () => {
    const state0 = createDagExecutionState([
      { id: 'root' },
      { id: 'left', dependencies: ['root'] },
      { id: 'right', dependencies: ['root'] },
      { id: 'join', dependencies: ['left', 'right'] },
    ]);
    expect(getReadyDagNodes(state0)).toEqual(['root']);

    const state1 = transitionDagNode(state0, 'root', 'running');
    const state2 = transitionDagNode(state1, 'root', 'completed', { output: 42 });
    expect(getReadyDagNodes(state2)).toEqual(['left', 'right']);

    const result = await executeDagWorkflow(
      [
        { id: 'root', data: 1 },
        { id: 'left', dependencies: ['root'], data: 2 },
        { id: 'right', dependencies: ['root'], data: 3 },
        { id: 'join', dependencies: ['left', 'right'], data: 4 },
      ],
      async (node) => (node.data ?? 0) * 10,
      { maxConcurrency: 2 },
    );

    expect(result.completed).toBe(true);
    expect(result.outputs).toEqual({
      root: 10,
      left: 20,
      right: 30,
      join: 40,
    });
  });

  it('marks downstream nodes skipped on failFast failure', async () => {
    const result = await executeDagWorkflow(
      [
        { id: 'a' },
        { id: 'b', dependencies: ['a'] },
      ],
      async (node) => {
        if (node.id === 'a') {
          throw new Error('boom');
        }
        return 'ok';
      },
      { failFast: true },
    );

    expect(result.completed).toBe(false);
    expect(result.state.nodes.a?.status).toBe('failed');
    expect(result.state.nodes.b?.status).toBe('skipped');
  });
});
