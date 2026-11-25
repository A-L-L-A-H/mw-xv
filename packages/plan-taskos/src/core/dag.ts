import type { PlanTaskIR } from "./types.js";
import { globsMayOverlap } from "./paths.js";
import { canonicalJson, sha256Hex } from "./redaction.js";

export type DagNodeState = "done" | "active" | "ready" | "blocked" | "skipped";

export interface DagNode {
  readonly code: string;
  readonly urn: string;
  readonly title: string;
  readonly state: DagNodeState;
  readonly depth: number;
  readonly dependsOn: readonly string[];
  readonly ownerFiles: readonly string[];
  readonly onCriticalPath: boolean;
  readonly priority: string;
  readonly waveOrder: number;
}

export interface WorkGraphDagResult {
  readonly nodes: readonly DagNode[];
  readonly cycles: readonly (readonly string[])[];
  readonly criticalPathIds: readonly string[];
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
}

export interface SelectFrontierOptions {
  readonly activeLeases?: ReadonlySet<string>;
  readonly dirtyFiles?: readonly string[];
}

const DONE_STATES = new Set(["done"]);
const ACTIVE_STATES = new Set(["in_progress", "review"]);
const BLOCKED_STATES = new Set(["blocked"]);
const SKIPPED_STATES = new Set(["skipped", "cancelled"]);

function deriveState(task: PlanTaskIR, unmetDeps: readonly string[]): DagNodeState {
  const status = task.lifecycle.status;
  if (DONE_STATES.has(status)) return "done";
  if (SKIPPED_STATES.has(status)) return "skipped";
  if (ACTIVE_STATES.has(status)) return "active";
  if (BLOCKED_STATES.has(status)) return "blocked";
  if (unmetDeps.length > 0) return "blocked";
  return "ready";
}

function unmetDependencies(task: PlanTaskIR, tasksByCode: Map<string, PlanTaskIR>): string[] {
  const unmet: string[] = [];
  for (const dep of task.graph.depends_on) {
    const depTask = tasksByCode.get(dep);
    if (!depTask) continue;
    const depStatus = depTask.lifecycle.status;
    // A dependency on `todo`, `in_progress`, `review`, or `blocked` blocks
    // this task; only `done`, `skipped`, and `cancelled` satisfy it.
    if (depStatus !== "done" && depStatus !== "skipped" && depStatus !== "cancelled") {
      unmet.push(dep);
    }
  }
  return unmet;
}

function detectCycles(tasks: readonly PlanTaskIR[], tasksByCode: Map<string, PlanTaskIR>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  function dfs(code: string): void {
    if (inStack.has(code)) {
      const cycleStart = stack.indexOf(code);
      if (cycleStart >= 0) {
        cycles.push([...stack.slice(cycleStart), code]);
      }
      return;
    }
    if (visited.has(code)) return;
    visited.add(code);
    inStack.add(code);
    stack.push(code);
    const task = tasksByCode.get(code);
    if (task) {
      for (const dep of task.graph.depends_on) {
        if (tasksByCode.has(dep)) {
          dfs(dep);
        }
      }
    }
    stack.pop();
    inStack.delete(code);
  }

  for (const task of tasks) {
    dfs(task.code);
  }
  return cycles;
}

function computeDepths(
  tasks: readonly PlanTaskIR[],
  tasksByCode: Map<string, PlanTaskIR>,
  cyclicCodes: Set<string>
): Map<string, number> {
  const depthCache = new Map<string, number>();

  function depth(code: string, visiting: Set<string>): number {
    if (depthCache.has(code)) return depthCache.get(code)!;
    if (visiting.has(code) || cyclicCodes.has(code)) return 0;
    visiting.add(code);
    const task = tasksByCode.get(code);
    let result = 0;
    if (task) {
      for (const dep of task.graph.depends_on) {
        if (tasksByCode.has(dep)) {
          result = Math.max(result, depth(dep, visiting) + 1);
        }
      }
    }
    visiting.delete(code);
    depthCache.set(code, result);
    return result;
  }

  for (const task of tasks) {
    depth(task.code, new Set());
  }
  return depthCache;
}

function computeCriticalPath(nodes: readonly DagNode[]): string[] {
  // Longest remaining pending dependency chain starting from any
  // ready/active node.
  const nodeByCode = new Map(nodes.map((n) => [n.code, n]));
  const memo = new Map<string, string[]>();

  function longestChainFrom(code: string, visiting: Set<string>): string[] {
    if (memo.has(code)) return memo.get(code)!;
    if (visiting.has(code)) return [code];
    visiting.add(code);
    const node = nodeByCode.get(code);
    let best: string[] = [];
    if (node) {
      for (const dep of node.dependsOn) {
        const depNode = nodeByCode.get(dep);
        if (!depNode) continue;
        if (depNode.state === "done" || depNode.state === "skipped") continue;
        const chain = longestChainFrom(dep, visiting);
        if (chain.length > best.length) {
          best = chain;
        }
      }
    }
    visiting.delete(code);
    const result = [code, ...best];
    memo.set(code, result);
    return result;
  }

  let bestPath: string[] = [];
  for (const node of nodes) {
    if (node.state !== "ready" && node.state !== "active") continue;
    const chain = longestChainFrom(node.code, new Set());
    if (chain.length > bestPath.length) {
      bestPath = chain;
    }
  }
  return bestPath;
}

function priorityRank(priority: string): number {
  const rank: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
  return rank[priority] ?? 99;
}

/**
 * Build a cycle-safe DAG with topological depth, derived runtime states,
 * Boss Critical Path, and deterministic ordering.
 */
export function buildWorkGraphDag(
  tasks: readonly PlanTaskIR[],
  options?: SelectFrontierOptions
): WorkGraphDagResult {
  const tasksByCode = new Map<string, PlanTaskIR>();
  for (const task of tasks) {
    tasksByCode.set(task.code, task);
  }

  const cycles = detectCycles(tasks, tasksByCode);
  const cyclicCodes = new Set(cycles.flat());

  const depths = computeDepths(tasks, tasksByCode, cyclicCodes);

  const _activeLeases = options?.activeLeases ?? new Set<string>();
  const _dirtyFiles = options?.dirtyFiles ?? [];

  const nodes: DagNode[] = [];
  for (const task of tasks) {
    const unmet = unmetDependencies(task, tasksByCode);
    const state = deriveState(task, unmet);
    nodes.push({
      code: task.code,
      urn: task.urn,
      title: task.title,
      state,
      depth: depths.get(task.code) ?? 0,
      dependsOn: task.graph.depends_on,
      ownerFiles: task.governance.owner_files,
      onCriticalPath: false,
      priority: task.projections.taskos_code ? "p1" : "p2",
      waveOrder: depths.get(task.code) ?? 0,
    });
  }

  const criticalPathIds = computeCriticalPath(nodes);
  const criticalSet = new Set(criticalPathIds);
  const withCritical = nodes.map((node) => ({
    ...node,
    onCriticalPath: criticalSet.has(node.code),
  }));

  return {
    nodes: withCritical,
    cycles: Object.freeze(cycles.map((c) => Object.freeze(c))),
    criticalPathIds,
    adjacency: buildAdjacency(tasks),
  };
}

function buildAdjacency(tasks: readonly PlanTaskIR[]): ReadonlyMap<string, readonly string[]> {
  const adjacency = new Map<string, string[]>();
  for (const task of tasks) {
    if (!adjacency.has(task.code)) {
      adjacency.set(task.code, []);
    }
    for (const dep of task.graph.depends_on) {
      if (!adjacency.has(dep)) {
        adjacency.set(dep, []);
      }
      adjacency.get(dep)!.push(task.code);
    }
  }
  return adjacency;
}

function isLeased(node: DagNode, activeLeases: ReadonlySet<string>): boolean {
  return activeLeases.has(node.code);
}

function touchesDirtyFiles(node: DagNode, dirtyFiles: readonly string[]): boolean {
  if (dirtyFiles.length === 0 || node.ownerFiles.length === 0) {
    return false;
  }
  for (const ownerFile of node.ownerFiles) {
    for (const dirty of dirtyFiles) {
      if (globsMayOverlap(ownerFile, dirty)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Select up to `maxParallel` ready tasks with pairwise-disjoint owner files,
 * not currently leased, prioritized by critical-path membership, priority
 * rank, and wave order.
 */
export function selectDisjointFrontier(
  dag: WorkGraphDagResult,
  maxParallel: number,
  options?: SelectFrontierOptions
): readonly DagNode[] {
  const activeLeases = options?.activeLeases ?? new Set<string>();
  const dirtyFiles = options?.dirtyFiles ?? [];

  const candidates = dag.nodes
    .filter((node) => node.state === "ready")
    .filter((node) => !isLeased(node, activeLeases))
    .filter((node) => !touchesDirtyFiles(node, dirtyFiles))
    .sort((a, b) => {
      if (a.onCriticalPath !== b.onCriticalPath) return a.onCriticalPath ? -1 : 1;
      const prA = priorityRank(a.priority);
      const prB = priorityRank(b.priority);
      if (prA !== prB) return prA - prB;
      if (a.waveOrder !== b.waveOrder) return a.waveOrder - b.waveOrder;
      return a.code.localeCompare(b.code);
    });

  const selected: DagNode[] = [];
  for (const candidate of candidates) {
    if (selected.length >= maxParallel) break;
    const conflicts = selected.some((existing) =>
      existing.ownerFiles.some((a) => candidate.ownerFiles.some((b) => globsMayOverlap(a, b)))
    );
    if (!conflicts) {
      selected.push(candidate);
    }
  }
  return selected;
}

export function dagFingerprint(dag: WorkGraphDagResult): string {
  return sha256Hex(
    canonicalJson({
      nodes: dag.nodes.map((n) => ({ code: n.code, state: n.state, depth: n.depth })),
      criticalPathIds: dag.criticalPathIds,
    })
  );
}