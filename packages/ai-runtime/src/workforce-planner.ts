import { RISK_TIER_ORDER, type RiskTier } from './risk-policy.js';
import type { Clock } from './types.js';
import { SYSTEM_CLOCK } from './types.js';

export type AgentRoleTemplate = 'planner' | 'manager' | 'researcher' | 'builder' | 'reviewer';
export type WorkforceAgentStatus = 'draft' | 'active' | 'paused' | 'disabled' | 'retired';

export interface WorkforceAgentNode {
  readonly agentId: string | number;
  readonly companyId: number;
  readonly roleTemplate: AgentRoleTemplate;
  readonly status: WorkforceAgentStatus;
  readonly isEmergencyStopped: boolean;
  readonly capabilities: readonly string[];
  readonly reportsToAgentId?: string | number;
  readonly maxConcurrentRuns?: number;
  readonly activeRunsCount?: number;
}

export interface PlannerSubtaskSpec {
  readonly taskId: string;
  readonly parentTaskId?: string;
  readonly companyId: number;
  readonly title: string;
  readonly scope: string;
  readonly acceptanceCriteria: readonly string[];
  readonly dependencies: readonly string[];
  readonly riskTier: RiskTier;
  readonly estimatedCostMicros: number;
  readonly requiredCapabilities: readonly string[];
  readonly assignedAgentId?: string | number;
  readonly reviewerAgentId?: string | number;
  readonly delegationDepth: number;
  readonly writeScopes?: readonly string[];
  readonly workspaceId?: string;
}

export interface PlannerCritique {
  readonly reviewedBy: string | number;
  readonly approved: boolean;
  readonly rationale: string;
}

export interface PlannerDecompositionPlan {
  readonly planId: string;
  readonly companyId: number;
  readonly rootGoal: string;
  readonly mode: 'single_agent' | 'multi_agent';
  readonly decomposable: boolean;
  readonly maxRiskTier: RiskTier;
  readonly maxDelegationDepth: number;
  readonly maxActiveAgents: number;
  readonly totalBudgetMicros: number;
  readonly tasks: readonly PlannerSubtaskSpec[];
  readonly critique?: PlannerCritique;
}

export interface ActiveCompanyTaskScope {
  readonly taskId: string;
  readonly companyId: number;
  readonly scope: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface PlanValidationIssue {
  readonly code:
    | 'EMPTY_PLAN_TASKS'
    | 'NON_DECOMPOSABLE_MULTI_AGENT_OVERHEAD'
    | 'CROSS_COMPANY_DELEGATION'
    | 'MISSING_SCOPE_OR_CRITERIA'
    | 'RISK_ESCALATION_REJECTED'
    | 'MAX_DELEGATION_DEPTH_EXCEEDED'
    | 'BUDGET_EXCEEDED'
    | 'MAX_ACTIVE_AGENTS_EXCEEDED'
    | 'MISSING_PLAN_CRITIQUE'
    | 'UNKNOWN_TASK_DEPENDENCY'
    | 'DEPENDENCY_CYCLE_DETECTED'
    | 'DELEGATION_LOOP_DETECTED'
    | 'REPORTING_LINE_CYCLE_DETECTED'
    | 'DUPLICATE_ACTIVE_SCOPE'
    | 'AGENT_NOT_ELIGIBLE'
    | 'AGENT_NOT_ACTIVE'
    | 'AGENT_LACKS_CAPABILITIES'
    | 'CONFLICT_OF_INTEREST'
    | 'CONCURRENT_WRITE_CONFLICT';
  readonly taskId?: string;
  readonly message: string;
}

export interface PlanValidationResult {
  readonly valid: boolean;
  readonly recommendedMode: 'single_agent' | 'multi_agent';
  readonly totalEstimatedCostMicros: number;
  readonly assignedAgentCount: number;
  readonly issues: readonly PlanValidationIssue[];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}

function normalizeScopeFingerprint(
  companyId: number,
  scope: string,
  acceptanceCriteria: readonly string[]
): string {
  const normScope = normalizeText(scope);
  const normCriteria = [...acceptanceCriteria].map(normalizeText).sort().join('|');
  return `${companyId}::${normScope}::${normCriteria}`;
}

function normalizeWritePath(rawPath: string): string {
  return (
    rawPath
      .trim()
      .replace(/\\/gu, '/')
      .replace(/^\/+|\/+$/gu, '') || '.'
  );
}

function pathsOverlap(pathA: string, pathB: string): boolean {
  const a = normalizeWritePath(pathA);
  const b = normalizeWritePath(pathB);
  if (a === '.' || b === '.') return true;
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function hasPathReachability(
  adjacency: ReadonlyMap<string, readonly string[]>,
  start: string,
  target: string
): boolean {
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }
  return false;
}

function detectDirectedCycle(
  nodes: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>
): readonly string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const dfs = (node: string): readonly string[] | null => {
    state.set(node, 1);
    stack.push(node);

    for (const neighbor of edges.get(node) ?? []) {
      const neighborState = state.get(neighbor) ?? 0;
      if (neighborState === 1) {
        const cycleStart = stack.indexOf(neighbor);
        return [...stack.slice(cycleStart), neighbor];
      }
      if (neighborState === 0) {
        const found = dfs(neighbor);
        if (found) return found;
      }
    }

    stack.pop();
    state.set(node, 2);
    return null;
  };

  for (const node of nodes) {
    if ((state.get(node) ?? 0) === 0) {
      const cycle = dfs(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

export function validatePlannerDecomposition(
  plan: PlannerDecompositionPlan,
  options: {
    readonly agents: readonly WorkforceAgentNode[];
    readonly activeCompanyTasks?: readonly ActiveCompanyTaskScope[];
  }
): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];
  const agentsById = new Map<string, WorkforceAgentNode>();
  for (const agent of options.agents) {
    agentsById.set(String(agent.agentId), agent);
  }

  // Check agent reporting hierarchy cycles
  const reportingEdges = new Map<string, readonly string[]>();
  const reportingNodes: string[] = [];
  for (const agent of options.agents) {
    if (agent.companyId !== plan.companyId) continue;
    const id = String(agent.agentId);
    reportingNodes.push(id);
    if (agent.reportsToAgentId !== undefined) {
      reportingEdges.set(id, [String(agent.reportsToAgentId)]);
    }
  }
  const reportingCycle = detectDirectedCycle(reportingNodes, reportingEdges);
  if (reportingCycle) {
    issues.push({
      code: 'REPORTING_LINE_CYCLE_DETECTED',
      message: `Agent reporting hierarchy cycle detected: ${reportingCycle.join(' -> ')}`,
    });
  }

  if (plan.tasks.length === 0) {
    issues.push({
      code: 'EMPTY_PLAN_TASKS',
      message: 'Planner decomposition must contain at least one task',
    });
    return {
      valid: false,
      recommendedMode: 'single_agent',
      totalEstimatedCostMicros: 0,
      assignedAgentCount: 0,
      issues,
    };
  }

  if (!plan.decomposable && (plan.mode === 'multi_agent' || plan.tasks.length > 1)) {
    issues.push({
      code: 'NON_DECOMPOSABLE_MULTI_AGENT_OVERHEAD',
      message:
        'Non-decomposable task must use single_agent mode with a single task to avoid coordination overhead',
    });
  }

  const taskIds = new Set(plan.tasks.map((t) => t.taskId));
  const dependencyEdges = new Map<string, readonly string[]>();
  const parentEdges = new Map<string, readonly string[]>();
  const seenScopeFingerprints = new Map<string, string>();
  for (const activeTask of options.activeCompanyTasks ?? []) {
    if (activeTask.companyId !== plan.companyId) continue;
    seenScopeFingerprints.set(
      normalizeScopeFingerprint(
        activeTask.companyId,
        activeTask.scope,
        activeTask.acceptanceCriteria
      ),
      activeTask.taskId
    );
  }

  let totalEstimatedCostMicros = 0;
  let maxObservedRiskOrder = 0;
  const assignedAgents = new Set<string>();

  for (const task of plan.tasks) {
    totalEstimatedCostMicros += Math.max(0, task.estimatedCostMicros);
    maxObservedRiskOrder = Math.max(maxObservedRiskOrder, RISK_TIER_ORDER[task.riskTier]);

    if (task.companyId !== plan.companyId) {
      issues.push({
        code: 'CROSS_COMPANY_DELEGATION',
        taskId: task.taskId,
        message: `Task "${task.taskId}" companyId (${task.companyId}) !== plan companyId (${plan.companyId})`,
      });
    }

    if (!task.scope.trim() || task.acceptanceCriteria.length === 0) {
      issues.push({
        code: 'MISSING_SCOPE_OR_CRITERIA',
        taskId: task.taskId,
        message: `Task "${task.taskId}" must define a non-empty scope and acceptanceCriteria`,
      });
    }

    if (RISK_TIER_ORDER[task.riskTier] > RISK_TIER_ORDER[plan.maxRiskTier]) {
      issues.push({
        code: 'RISK_ESCALATION_REJECTED',
        taskId: task.taskId,
        message: `Task "${task.taskId}" risk tier ${task.riskTier} exceeds plan maxRiskTier ${plan.maxRiskTier}`,
      });
    }

    if (task.delegationDepth > plan.maxDelegationDepth) {
      issues.push({
        code: 'MAX_DELEGATION_DEPTH_EXCEEDED',
        taskId: task.taskId,
        message: `Task "${task.taskId}" delegationDepth (${task.delegationDepth}) exceeds max (${plan.maxDelegationDepth})`,
      });
    }

    for (const dep of task.dependencies) {
      if (!taskIds.has(dep)) {
        issues.push({
          code: 'UNKNOWN_TASK_DEPENDENCY',
          taskId: task.taskId,
          message: `Task "${task.taskId}" depends on unknown task "${dep}"`,
        });
      }
    }
    dependencyEdges.set(task.taskId, task.dependencies);

    if (task.parentTaskId !== undefined) {
      parentEdges.set(task.taskId, [task.parentTaskId]);
    }

    const fingerprint = normalizeScopeFingerprint(
      task.companyId,
      task.scope,
      task.acceptanceCriteria
    );
    const existingScopeOwner = seenScopeFingerprints.get(fingerprint);
    if (existingScopeOwner !== undefined) {
      issues.push({
        code: 'DUPLICATE_ACTIVE_SCOPE',
        taskId: task.taskId,
        message: `Task "${task.taskId}" duplicates active scope/criteria of "${existingScopeOwner}"`,
      });
    } else {
      seenScopeFingerprints.set(fingerprint, task.taskId);
    }

    if (task.assignedAgentId !== undefined) {
      const agentIdKey = String(task.assignedAgentId);
      assignedAgents.add(agentIdKey);
      const agent = agentsById.get(agentIdKey);
      if (!agent || agent.companyId !== plan.companyId) {
        issues.push({
          code: 'AGENT_NOT_ELIGIBLE',
          taskId: task.taskId,
          message: `Assigned agent "${agentIdKey}" does not exist in company ${plan.companyId}`,
        });
      } else {
        if (agent.status !== 'active' || agent.isEmergencyStopped) {
          issues.push({
            code: 'AGENT_NOT_ACTIVE',
            taskId: task.taskId,
            message: `Assigned agent "${agentIdKey}" is not active or is emergency-stopped`,
          });
        }
        const agentCaps = new Set(agent.capabilities);
        const missingCaps = task.requiredCapabilities.filter((cap) => !agentCaps.has(cap));
        if (missingCaps.length > 0) {
          issues.push({
            code: 'AGENT_LACKS_CAPABILITIES',
            taskId: task.taskId,
            message: `Agent "${agentIdKey}" lacks required capabilities: ${missingCaps.join(', ')}`,
          });
        }
      }

      if (task.reviewerAgentId !== undefined && String(task.reviewerAgentId) === agentIdKey) {
        issues.push({
          code: 'CONFLICT_OF_INTEREST',
          taskId: task.taskId,
          message: `Task "${task.taskId}" assigns agent "${agentIdKey}" as both worker and reviewer`,
        });
      }
    }
  }

  if (totalEstimatedCostMicros > plan.totalBudgetMicros) {
    issues.push({
      code: 'BUDGET_EXCEEDED',
      message: `Total estimated cost (${totalEstimatedCostMicros}) exceeds plan budget (${plan.totalBudgetMicros})`,
    });
  }

  if (assignedAgents.size > plan.maxActiveAgents) {
    issues.push({
      code: 'MAX_ACTIVE_AGENTS_EXCEEDED',
      message: `Assigned distinct agents (${assignedAgents.size}) exceeds maxActiveAgents (${plan.maxActiveAgents})`,
    });
  }

  const requiresCritique = maxObservedRiskOrder >= RISK_TIER_ORDER.R2 || plan.tasks.length > 3;
  if (
    requiresCritique &&
    (!plan.critique || !plan.critique.approved || !plan.critique.rationale.trim())
  ) {
    issues.push({
      code: 'MISSING_PLAN_CRITIQUE',
      message: 'High-impact or multi-step plan requires approved critique with rationale',
    });
  }

  const depCycle = detectDirectedCycle([...taskIds], dependencyEdges);
  if (depCycle) {
    issues.push({
      code: 'DEPENDENCY_CYCLE_DETECTED',
      message: `Task dependency cycle detected: ${depCycle.join(' -> ')}`,
    });
  }

  const parentCycle = detectDirectedCycle([...taskIds], parentEdges);
  if (parentCycle) {
    issues.push({
      code: 'DELEGATION_LOOP_DETECTED',
      message: `Parent-child delegation loop detected: ${parentCycle.join(' -> ')}`,
    });
  }

  // Parallel write conflict check across sibling tasks lacking dependency ordering
  for (let i = 0; i < plan.tasks.length; i += 1) {
    const taskA = plan.tasks[i];
    if (!taskA.writeScopes || taskA.writeScopes.length === 0) continue;
    const wsA = taskA.workspaceId ?? 'shared';

    for (let j = i + 1; j < plan.tasks.length; j += 1) {
      const taskB = plan.tasks[j];
      if (!taskB.writeScopes || taskB.writeScopes.length === 0) continue;
      const wsB = taskB.workspaceId ?? 'shared';
      if (wsA !== wsB) continue;

      const ordered =
        hasPathReachability(dependencyEdges, taskA.taskId, taskB.taskId) ||
        hasPathReachability(dependencyEdges, taskB.taskId, taskA.taskId);
      if (ordered) continue;

      const overlap = taskA.writeScopes.some((pA) =>
        taskB.writeScopes!.some((pB) => pathsOverlap(pA, pB))
      );
      if (overlap) {
        issues.push({
          code: 'CONCURRENT_WRITE_CONFLICT',
          taskId: taskB.taskId,
          message: `Tasks "${taskA.taskId}" and "${taskB.taskId}" write overlapping paths in shared workspace "${wsA}" without isolation or dependency ordering`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    recommendedMode: plan.decomposable && plan.tasks.length > 1 ? 'multi_agent' : 'single_agent',
    totalEstimatedCostMicros,
    assignedAgentCount: assignedAgents.size,
    issues,
  };
}

export interface WorkspaceWriteLock {
  readonly companyId: number;
  readonly workspaceId: string;
  readonly runId: string;
  readonly agentId: string | number;
  readonly fencingToken: number;
  readonly writePaths: readonly string[];
  readonly acquiredAt: string;
}

export type WorkspaceLockAcquireResult =
  | { readonly acquired: true; readonly lock: WorkspaceWriteLock }
  | {
      readonly acquired: false;
      readonly conflictWithRunId: string;
      readonly conflictingPaths: readonly string[];
    };

export class WorkspaceConflictLockManager {
  private readonly locks = new Map<string, WorkspaceWriteLock>();
  private readonly clock: Clock;

  constructor(clock: Clock = SYSTEM_CLOCK) {
    this.clock = clock;
  }

  acquireWriteLock(params: {
    readonly companyId: number;
    readonly workspaceId: string;
    readonly runId: string;
    readonly agentId: string | number;
    readonly fencingToken: number;
    readonly writePaths: readonly string[];
  }): WorkspaceLockAcquireResult {
    const normalizedPaths = params.writePaths.map(normalizeWritePath);

    for (const existing of this.locks.values()) {
      if (existing.companyId !== params.companyId) continue;
      if (existing.workspaceId !== params.workspaceId) continue;
      if (existing.runId === params.runId) continue;

      const conflictingPaths: string[] = [];
      for (const reqPath of normalizedPaths) {
        for (const heldPath of existing.writePaths) {
          if (pathsOverlap(reqPath, heldPath)) {
            conflictingPaths.push(reqPath);
          }
        }
      }
      if (conflictingPaths.length > 0) {
        return {
          acquired: false,
          conflictWithRunId: existing.runId,
          conflictingPaths,
        };
      }
    }

    const lock: WorkspaceWriteLock = {
      companyId: params.companyId,
      workspaceId: params.workspaceId,
      runId: params.runId,
      agentId: params.agentId,
      fencingToken: params.fencingToken,
      writePaths: normalizedPaths,
      acquiredAt: new Date(this.clock.now()).toISOString(),
    };
    this.locks.set(`${params.companyId}:${params.runId}`, lock);
    return { acquired: true, lock };
  }

  releaseWriteLock(companyId: number, runId: string, fencingToken: number): boolean {
    const key = `${companyId}:${runId}`;
    const existing = this.locks.get(key);
    if (!existing) return false;
    if (existing.fencingToken !== fencingToken) {
      throw new Error(
        `Cannot release workspace lock for run "${runId}" with stale fencing token ${fencingToken}`
      );
    }
    return this.locks.delete(key);
  }

  listActiveLocks(companyId?: number): readonly WorkspaceWriteLock[] {
    if (companyId === undefined) return [...this.locks.values()];
    return [...this.locks.values()].filter((lock) => lock.companyId === companyId);
  }
}

export interface RunHierarchyNode {
  readonly runId: string;
  readonly parentRunId?: string;
}

export interface CancellationTarget {
  readonly runId: string;
  readonly parentRunId?: string;
  readonly depth: number;
}

export function propagateCancellation(
  rootRunId: string,
  nodes: readonly RunHierarchyNode[]
): readonly CancellationTarget[] {
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentRunId !== undefined) {
      const list = childrenByParent.get(node.parentRunId) ?? [];
      list.push(node.runId);
      childrenByParent.set(node.parentRunId, list);
    }
  }

  const ordered: CancellationTarget[] = [];
  const visited = new Set<string>();

  const visit = (runId: string, parentRunId: string | undefined, depth: number): void => {
    if (visited.has(runId)) return;
    visited.add(runId);
    for (const childId of childrenByParent.get(runId) ?? []) {
      visit(childId, runId, depth + 1);
    }
    ordered.push({ runId, parentRunId, depth });
  };

  visit(rootRunId, undefined, 0);
  return ordered;
}

export type ChildOutcomeStatus =
  'accepted' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'partial';

export interface ChildWorkOutcome {
  readonly taskId: string;
  readonly status: ChildOutcomeStatus;
  readonly mandatory: boolean;
  readonly costMicros: number;
  readonly reason?: string;
}

export type AggregatedOutcomeStatus = 'accepted' | 'partial' | 'blocked' | 'failed' | 'cancelled';

export interface AggregatedWorkforceOutcome {
  readonly parentContractId: string;
  readonly status: AggregatedOutcomeStatus;
  readonly totalCostMicros: number;
  readonly acceptedTasks: readonly string[];
  readonly failedTasks: readonly string[];
  readonly blockedTasks: readonly string[];
  readonly cancelledTasks: readonly string[];
  readonly partialTasks: readonly string[];
  readonly unresolvedObligationIds: readonly string[];
  readonly blockingReasons: readonly string[];
}

export function aggregateWorkforceOutcomes(
  parentContractId: string,
  childOutcomes: readonly ChildWorkOutcome[],
  unresolvedObligationIds: readonly string[] = []
): AggregatedWorkforceOutcome {
  const acceptedTasks: string[] = [];
  const failedTasks: string[] = [];
  const blockedTasks: string[] = [];
  const cancelledTasks: string[] = [];
  const partialTasks: string[] = [];
  const blockingReasons: string[] = [];
  let totalCostMicros = 0;

  for (const child of childOutcomes) {
    totalCostMicros += Math.max(0, child.costMicros);
    if (child.status === 'accepted' || child.status === 'completed') {
      acceptedTasks.push(child.taskId);
    } else if (child.status === 'failed') {
      failedTasks.push(child.taskId);
      if (child.mandatory) {
        blockingReasons.push(
          `Mandatory task "${child.taskId}" failed: ${child.reason ?? 'unknown'}`
        );
      }
    } else if (child.status === 'blocked') {
      blockedTasks.push(child.taskId);
      if (child.mandatory) {
        blockingReasons.push(
          `Mandatory task "${child.taskId}" blocked: ${child.reason ?? 'unknown'}`
        );
      }
    } else if (child.status === 'cancelled') {
      cancelledTasks.push(child.taskId);
      if (child.mandatory) {
        blockingReasons.push(`Mandatory task "${child.taskId}" cancelled`);
      }
    } else {
      partialTasks.push(child.taskId);
      if (child.mandatory) {
        blockingReasons.push(`Mandatory task "${child.taskId}" is only partial`);
      }
    }
  }

  for (const obId of unresolvedObligationIds) {
    blockingReasons.push(`Continuing obligation "${obId}" remains unresolved`);
  }

  const mandatoryIncomplete = childOutcomes.some(
    (c) => c.mandatory && c.status !== 'accepted' && c.status !== 'completed'
  );

  let status: AggregatedOutcomeStatus;
  if (!mandatoryIncomplete && unresolvedObligationIds.length === 0) {
    status = 'accepted';
  } else if (unresolvedObligationIds.length > 0 && !mandatoryIncomplete) {
    status = 'blocked';
  } else if (acceptedTasks.length > 0 || partialTasks.length > 0) {
    status = 'partial';
  } else if (cancelledTasks.length > 0 && failedTasks.length === 0 && blockedTasks.length === 0) {
    status = 'cancelled';
  } else if (blockedTasks.length > 0 && failedTasks.length === 0) {
    status = 'blocked';
  } else {
    status = 'failed';
  }

  return {
    parentContractId,
    status,
    totalCostMicros,
    acceptedTasks,
    failedTasks,
    blockedTasks,
    cancelledTasks,
    partialTasks,
    unresolvedObligationIds: [...unresolvedObligationIds],
    blockingReasons,
  };
}
