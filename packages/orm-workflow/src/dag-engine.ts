export type DagNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface DagNodeDefinition<TData = unknown> {
  readonly id: string;
  readonly dependencies?: readonly string[];
  readonly data?: TData;
}

export interface DagNodeState<TData = unknown> {
  readonly id: string;
  readonly status: DagNodeStatus;
  readonly dependencies: readonly string[];
  readonly data?: TData;
  readonly output?: unknown;
  readonly error?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface DagExecutionState<TData = unknown> {
  readonly nodes: Readonly<Record<string, DagNodeState<TData>>>;
  readonly order: readonly string[];
}

export type DagValidationErrorCode =
  | 'CYCLE_DETECTED'
  | 'MISSING_DEPENDENCY'
  | 'DUPLICATE_NODE'
  | 'EMPTY_DAG'
  | 'INVALID_TRANSITION';

export class DagValidationError extends Error {
  readonly code: DagValidationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DagValidationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DagValidationError';
    this.code = code;
    this.details = details;
  }
}

export function detectDagCycles(nodes: readonly DagNodeDefinition[]): string[][] {
  const adj = new Map<string, string[]>();
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    nodeIds.add(node.id);
    adj.set(node.id, []);
  }
  for (const node of nodes) {
    for (const dep of node.dependencies ?? []) {
      if (nodeIds.has(dep)) {
        adj.get(dep)!.push(node.id);
      }
    }
  }

  const state = new Map<string, 'unvisited' | 'visiting' | 'visited'>();
  for (const id of nodeIds) {
    state.set(id, 'unvisited');
  }

  const cycles: string[][] = [];
  const stack: string[] = [];

  const dfs = (id: string): void => {
    state.set(id, 'visiting');
    stack.push(id);
    const neighbors = [...(adj.get(id) ?? [])].sort();
    for (const next of neighbors) {
      const nextState = state.get(next);
      if (nextState === 'visiting') {
        const idx = stack.indexOf(next);
        cycles.push([...stack.slice(idx), next]);
      } else if (nextState === 'unvisited') {
        dfs(next);
      }
    }
    stack.pop();
    state.set(id, 'visited');
  };

  for (const id of [...nodeIds].sort()) {
    if (state.get(id) === 'unvisited') {
      dfs(id);
    }
  }

  return cycles;
}

export function topologicalSortDag(nodes: readonly DagNodeDefinition[]): string[] {
  if (nodes.length === 0) {
    throw new DagValidationError('EMPTY_DAG', 'DAG must contain at least one node.');
  }

  const nodeMap = new Map<string, DagNodeDefinition>();
  for (const node of nodes) {
    if (nodeMap.has(node.id)) {
      throw new DagValidationError('DUPLICATE_NODE', `Duplicate DAG node id: ${node.id}`, {
        nodeId: node.id,
      });
    }
    nodeMap.set(node.id, node);
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    dependents.set(node.id, []);
  }

  for (const node of nodes) {
    const deps = node.dependencies ?? [];
    for (const dep of deps) {
      if (!nodeMap.has(dep)) {
        throw new DagValidationError(
          'MISSING_DEPENDENCY',
          `Node "${node.id}" depends on unknown node "${dep}".`,
          { nodeId: node.id, dependencyId: dep },
        );
      }
      dependents.get(dep)!.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }

  const ready: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      ready.push(id);
    }
  }
  ready.sort();

  const order: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    order.push(current);
    for (const dep of dependents.get(current) ?? []) {
      const nextDeg = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, nextDeg);
      if (nextDeg === 0) {
        ready.push(dep);
      }
    }
    ready.sort();
  }

  if (order.length !== nodes.length) {
    const cycles = detectDagCycles(nodes);
    throw new DagValidationError('CYCLE_DETECTED', 'Cycle detected in DAG workflow.', {
      cycles,
    });
  }

  return order;
}

export function createDagExecutionState<TData = unknown>(
  nodes: readonly DagNodeDefinition<TData>[],
): DagExecutionState<TData> {
  const order = topologicalSortDag(nodes);
  const nodeStates: Record<string, DagNodeState<TData>> = {};
  for (const node of nodes) {
    nodeStates[node.id] = {
      id: node.id,
      status: 'pending',
      dependencies: [...(node.dependencies ?? [])],
      data: node.data,
    };
  }
  return { nodes: nodeStates, order };
}

export function getReadyDagNodes<TData = unknown>(state: DagExecutionState<TData>): string[] {
  const ready: string[] = [];
  for (const id of state.order) {
    const node = state.nodes[id];
    if (!node || node.status !== 'pending') {
      continue;
    }
    const allDepsCompleted = node.dependencies.every(
      (depId) => state.nodes[depId]?.status === 'completed',
    );
    if (allDepsCompleted) {
      ready.push(id);
    }
  }
  return ready.sort();
}

const ALLOWED_TRANSITIONS: Record<DagNodeStatus, readonly DagNodeStatus[]> = {
  pending: ['running', 'skipped'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
  skipped: [],
};

export function transitionDagNode<TData = unknown>(
  state: DagExecutionState<TData>,
  nodeId: string,
  nextStatus: DagNodeStatus,
  options?: { output?: unknown; error?: string; timestamp?: string },
): DagExecutionState<TData> {
  const current = state.nodes[nodeId];
  if (!current) {
    throw new DagValidationError('MISSING_DEPENDENCY', `Unknown DAG node "${nodeId}".`, {
      nodeId,
    });
  }

  const allowed = ALLOWED_TRANSITIONS[current.status];
  if (!allowed.includes(nextStatus)) {
    throw new DagValidationError(
      'INVALID_TRANSITION',
      `Invalid transition for node "${nodeId}": ${current.status} -> ${nextStatus}.`,
      { nodeId, from: current.status, to: nextStatus },
    );
  }

  const ts = options?.timestamp ?? new Date().toISOString();
  const updatedNode: DagNodeState<TData> = {
    ...current,
    status: nextStatus,
    ...(nextStatus === 'running' ? { startedAt: ts } : {}),
    ...(nextStatus === 'completed' || nextStatus === 'failed' || nextStatus === 'skipped'
      ? { completedAt: ts }
      : {}),
    ...(options?.output !== undefined ? { output: options.output } : {}),
    ...(options?.error !== undefined ? { error: options.error } : {}),
  };

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: updatedNode,
    },
  };
}

export interface DagExecutionOptions {
  readonly maxConcurrency?: number;
  readonly failFast?: boolean;
  readonly now?: () => string;
}

export interface DagExecutionResult<TData = unknown, TResult = unknown> {
  readonly state: DagExecutionState<TData>;
  readonly outputs: Record<string, TResult>;
  readonly completed: boolean;
}

export async function executeDagWorkflow<TData = unknown, TResult = unknown>(
  nodes: readonly DagNodeDefinition<TData>[],
  executor: (
    node: DagNodeDefinition<TData>,
    context: { outputs: Readonly<Record<string, TResult>> },
  ) => Promise<TResult>,
  options?: DagExecutionOptions,
): Promise<DagExecutionResult<TData, TResult>> {
  const maxConcurrency = Math.max(1, options?.maxConcurrency ?? Number.POSITIVE_INFINITY);
  const failFast = options?.failFast ?? true;
  const now = options?.now ?? (() => new Date().toISOString());

  let state = createDagExecutionState(nodes);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outputs: Record<string, TResult> = {};
  let hasFailure = false;

  while (true) {
    if (hasFailure && failFast) {
      for (const id of state.order) {
        if (state.nodes[id]?.status === 'pending') {
          state = transitionDagNode(state, id, 'skipped', { timestamp: now() });
        }
      }
      break;
    }

    const readyIds = getReadyDagNodes(state);
    if (readyIds.length === 0) {
      break;
    }

    const batch = readyIds.slice(0, maxConcurrency);
    for (const id of batch) {
      state = transitionDagNode(state, id, 'running', { timestamp: now() });
    }

    const results = await Promise.all(
      batch.map(async (id) => {
        const def = nodeMap.get(id)!;
        try {
          const output = await executor(def, { outputs });
          return { id, ok: true as const, output };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { id, ok: false as const, error: message };
        }
      }),
    );

    for (const res of results) {
      if (res.ok) {
        outputs[res.id] = res.output;
        state = transitionDagNode(state, res.id, 'completed', {
          output: res.output,
          timestamp: now(),
        });
      } else {
        hasFailure = true;
        state = transitionDagNode(state, res.id, 'failed', {
          error: res.error,
          timestamp: now(),
        });
      }
    }
  }

  const completed = state.order.every((id) => state.nodes[id]?.status === 'completed');
  return { state, outputs, completed };
}
