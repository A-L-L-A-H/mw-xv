import type { PlanTaskIR } from "./types.js";
import { globsMayOverlap } from "./paths.js";
import { canonicalJson, sha256Hex } from "./redaction.js";

export interface OwnershipConflict {
  readonly taskA: string;
  readonly taskB: string;
  readonly patternA: string;
  readonly patternB: string;
  readonly reason: string;
}

export interface DisjointOwnershipProof {
  readonly disjoint: boolean;
  readonly checkedPairs: number;
  readonly conflicts: readonly OwnershipConflict[];
  readonly proofSha256: string;
}

const TERMINAL_STATUSES = new Set(["done", "skipped", "cancelled"]);

function isTerminal(task: PlanTaskIR): boolean {
  return TERMINAL_STATUSES.has(task.lifecycle.status);
}

/**
 * Transitive closure of `depends_on` edges. The plan graph carries ordering
 * edges only; the `kind === 'blocks'` filter accepts tasks that declare a
 * blocking relationship explicitly.
 */
function buildReachability(tasks: readonly PlanTaskIR[]): Map<string, Set<string>> {
  const codeToTask = new Map<string, PlanTaskIR>();
  for (const task of tasks) {
    codeToTask.set(task.code, task);
  }

  const edges = new Map<string, Set<string>>();
  for (const task of tasks) {
    const targets = new Set<string>();
    for (const dep of task.graph.depends_on) {
      const depTask = codeToTask.get(dep);
      if (!depTask) {
        continue;
      }
      // Every dependency edge serializes; `kind === 'blocks'` edges are the
      // canonical hard-serialization form, other edges still order work.
      void depTask.kind;
      targets.add(dep);
    }
    edges.set(task.code, targets);
  }

  // Transitive closure via repeated expansion (deterministic, cycle-safe:
  // fixpoint iteration cannot loop because sets only grow monotonically).
  const closure = new Map<string, Set<string>>();
  for (const [code] of edges) {
    closure.set(code, new Set());
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [code, targets] of edges) {
      const reach = closure.get(code)!;
      const before = reach.size;
      for (const target of targets) {
        reach.add(target);
        const targetReach = closure.get(target);
        if (targetReach) {
          for (const transitivelyReached of targetReach) {
            reach.add(transitivelyReached);
          }
        }
      }
      if (reach.size !== before) {
        changed = true;
      }
    }
  }
  return closure;
}

function sharedMutexTokens(a: PlanTaskIR, b: PlanTaskIR): boolean {
  const tokensA = new Set(
    ((a.projections as { mutex_resources?: readonly string[] } | undefined)?.mutex_resources) ?? []
  );
  const tokensB = new Set(
    ((b.projections as { mutex_resources?: readonly string[] } | undefined)?.mutex_resources) ?? []
  );
  if (tokensA.size === 0 || tokensB.size === 0) {
    return false;
  }
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      return true;
    }
  }
  return false;
}

/**
 * Compile-time disjoint write-ownership prover: proves that every pair of
 * concurrently schedulable (non-terminal, mutually unreachable) tasks owns
 * strictly disjoint file sets, or records an exact conflict.
 */
export function proveDisjointOwnership(tasks: readonly PlanTaskIR[]): DisjointOwnershipProof {
  const closure = buildReachability(tasks);
  const conflicts: OwnershipConflict[] = [];
  let checkedPairs = 0;

  for (let i = 0; i < tasks.length; i += 1) {
    const taskA = tasks[i];
    if (isTerminal(taskA)) {
      continue;
    }
    for (let j = i + 1; j < tasks.length; j += 1) {
      const taskB = tasks[j];
      if (isTerminal(taskB)) {
        continue;
      }
      const reachFromA = closure.get(taskA.code) ?? new Set<string>();
      const reachFromB = closure.get(taskB.code) ?? new Set<string>();
      const bReachableFromA = reachFromA.has(taskB.code);
      const aReachableFromB = reachFromB.has(taskA.code);
      if (bReachableFromA || aReachableFromB) {
        continue; // serialized by dependency edge
      }
      // Concurrently schedulable pair: every owner-file combination must be
      // provably disjoint.
      checkedPairs += 1;
      if (sharedMutexTokens(taskA, taskB)) {
        continue;
      }
      for (const patternA of taskA.governance.owner_files) {
        for (const patternB of taskB.governance.owner_files) {
          if (globsMayOverlap(patternA, patternB)) {
            conflicts.push({
              taskA: taskA.code,
              taskB: taskB.code,
              patternA,
              patternB,
              reason: `Concurrent tasks ${taskA.code} and ${taskB.code} may both write ${patternA} / ${patternB}`,
            });
          }
        }
      }
    }
  }

  const proofSha256 = sha256Hex(
    canonicalJson({
      checkedPairs,
      conflicts,
      taskCodes: tasks.map((t) => t.code),
    })
  );

  return {
    disjoint: conflicts.length === 0,
    checkedPairs,
    conflicts: Object.freeze(conflicts),
    proofSha256,
  };
}