import { createHash } from 'node:crypto';

export type SagaValidationErrorCode =
  | 'EMPTY_STEP_ID'
  | 'DUPLICATE_STEP_ID'
  | 'SELF_DEPENDENCY'
  | 'MISSING_DEPENDENCY'
  | 'CYCLE_DETECTED';

export class SagaValidationError extends Error {
  readonly code: SagaValidationErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: SagaValidationErrorCode,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'SagaValidationError';
    this.code = code;
    this.details = details;
  }
}

export interface SagaStepExecutionContext<TContext> {
  readonly workflowRunId: string;
  readonly stepId: string;
  readonly idempotencyKey: string;
  readonly context: TContext;
  readonly outputs: Readonly<Record<string, unknown>>;
}

export interface SagaStepCompensationContext<TContext, TOutput> {
  readonly workflowRunId: string;
  readonly stepId: string;
  readonly idempotencyKey: string;
  readonly context: TContext;
  readonly output: TOutput;
  readonly failureReason: string;
}

export interface SagaStepDefinition<TContext = Record<string, unknown>, TOutput = unknown> {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly idempotencyScope?: string;
  execute(ctx: SagaStepExecutionContext<TContext>): Promise<TOutput> | TOutput;
  compensate?(ctx: SagaStepCompensationContext<TContext, TOutput>): Promise<void> | void;
}

export interface ValidatedSagaDag<TContext = Record<string, unknown>> {
  readonly executionOrder: readonly string[];
  readonly stepsById: ReadonlyMap<string, SagaStepDefinition<TContext, unknown>>;
}

export interface SagaReplayRecord {
  readonly stepId: string;
  readonly idempotencyKey: string;
  readonly output: unknown;
}

export interface SagaReplayLedger {
  get(idempotencyKey: string): SagaReplayRecord | undefined;
  set(record: SagaReplayRecord): void;
}

export class InMemorySagaReplayLedger implements SagaReplayLedger {
  private readonly records = new Map<string, SagaReplayRecord>();

  get(idempotencyKey: string): SagaReplayRecord | undefined {
    return this.records.get(idempotencyKey);
  }

  set(record: SagaReplayRecord): void {
    this.records.set(record.idempotencyKey, record);
  }

  snapshot(): readonly SagaReplayRecord[] {
    return Array.from(this.records.values());
  }
}

export interface SagaStepResult {
  readonly stepId: string;
  readonly idempotencyKey: string;
  readonly status: 'executed' | 'replayed' | 'failed';
  readonly output?: unknown;
  readonly error?: string;
}

export interface SagaCompensationPlanEntry {
  readonly stepId: string;
  readonly idempotencyKey: string;
  readonly hasCompensator: boolean;
}

export interface SagaCompensationResult {
  readonly stepId: string;
  readonly idempotencyKey: string;
  readonly status: 'compensated' | 'skipped' | 'compensation_failed';
  readonly error?: string;
}

export interface SagaExecutionOptions<TContext> {
  readonly workflowRunId: string;
  readonly context: TContext;
  readonly replayLedger?: SagaReplayLedger;
}

export interface SagaExecutionResult {
  readonly workflowRunId: string;
  readonly status: 'completed' | 'compensated' | 'compensation_failed';
  readonly executionOrder: readonly string[];
  readonly stepResults: readonly SagaStepResult[];
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly compensationPlan: readonly SagaCompensationPlanEntry[];
  readonly compensationResults: readonly SagaCompensationResult[];
  readonly failedStepId?: string;
  readonly failureReason?: string;
}

export function deriveStepIdempotencyKey(
  workflowRunId: string,
  stepId: string,
  idempotencyScope?: string
): string {
  const normalizedRunId = workflowRunId.trim();
  const normalizedStepId = stepId.trim();
  const normalizedScope = idempotencyScope?.trim() ?? 'default';
  const digest = createHash('sha256')
    .update(`${normalizedRunId}\0${normalizedStepId}\0${normalizedScope}`)
    .digest('hex');
  return `saga:${normalizedRunId}:${normalizedStepId}:${digest.slice(0, 16)}`;
}

export function validateSagaDag<TContext>(
  steps: readonly SagaStepDefinition<TContext, unknown>[]
): ValidatedSagaDag<TContext> {
  const stepsById = new Map<string, SagaStepDefinition<TContext, unknown>>();

  for (const step of steps) {
    const id = step.id.trim();
    if (!id) {
      throw new SagaValidationError('EMPTY_STEP_ID', 'Saga step id must be non-empty');
    }
    if (stepsById.has(id)) {
      throw new SagaValidationError('DUPLICATE_STEP_ID', `Duplicate saga step id: ${id}`, {
        stepId: id,
      });
    }
    stepsById.set(id, step);
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const id of stepsById.keys()) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }

  for (const [id, step] of stepsById.entries()) {
    const uniqueDeps = new Set(step.dependsOn ?? []);
    for (const dep of uniqueDeps) {
      if (dep === id) {
        throw new SagaValidationError(
          'SELF_DEPENDENCY',
          `Saga step "${id}" cannot depend on itself`,
          { stepId: id }
        );
      }
      if (!stepsById.has(dep)) {
        throw new SagaValidationError(
          'MISSING_DEPENDENCY',
          `Saga step "${id}" depends on unknown step "${dep}"`,
          { stepId: id, missingDependencyId: dep }
        );
      }
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      dependents.get(dep)!.push(id);
    }
  }

  const readyQueue = Array.from(inDegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b));

  const executionOrder: string[] = [];

  while (readyQueue.length > 0) {
    const currentId = readyQueue.shift()!;
    executionOrder.push(currentId);

    const children = dependents.get(currentId) ?? [];
    for (const childId of children) {
      const nextDegree = (inDegree.get(childId) ?? 0) - 1;
      inDegree.set(childId, nextDegree);
      if (nextDegree === 0) {
        readyQueue.push(childId);
        readyQueue.sort((a, b) => a.localeCompare(b));
      }
    }
  }

  if (executionOrder.length !== stepsById.size) {
    const cycleMembers = Array.from(inDegree.entries())
      .filter(([, degree]) => degree > 0)
      .map(([id]) => id)
      .sort((a, b) => a.localeCompare(b));
    throw new SagaValidationError(
      'CYCLE_DETECTED',
      `Saga DAG contains a cycle involving steps: ${cycleMembers.join(', ')}`,
      { cycleMembers }
    );
  }

  return { executionOrder, stepsById };
}

export function planSagaCompensation<TContext>(
  completedSteps: readonly { stepId: string; idempotencyKey: string }[],
  stepsById: ReadonlyMap<string, SagaStepDefinition<TContext, unknown>>
): readonly SagaCompensationPlanEntry[] {
  const plan: SagaCompensationPlanEntry[] = [];
  for (let idx = completedSteps.length - 1; idx >= 0; idx -= 1) {
    const completed = completedSteps[idx]!;
    const step = stepsById.get(completed.stepId);
    plan.push({
      stepId: completed.stepId,
      idempotencyKey: completed.idempotencyKey,
      hasCompensator: typeof step?.compensate === 'function',
    });
  }
  return plan;
}

export async function executeSaga<TContext>(
  steps: readonly SagaStepDefinition<TContext, unknown>[],
  options: SagaExecutionOptions<TContext>
): Promise<SagaExecutionResult> {
  const { executionOrder, stepsById } = validateSagaDag(steps);
  const ledger = options.replayLedger ?? new InMemorySagaReplayLedger();
  const outputs: Record<string, unknown> = {};
  const stepResults: SagaStepResult[] = [];
  const completedSteps: { stepId: string; idempotencyKey: string; output: unknown }[] = [];

  for (const stepId of executionOrder) {
    const step = stepsById.get(stepId)!;
    const idempotencyKey = deriveStepIdempotencyKey(
      options.workflowRunId,
      stepId,
      step.idempotencyScope
    );

    const existing = ledger.get(idempotencyKey);
    if (existing) {
      outputs[stepId] = existing.output;
      completedSteps.push({ stepId, idempotencyKey, output: existing.output });
      stepResults.push({
        stepId,
        idempotencyKey,
        status: 'replayed',
        output: existing.output,
      });
      continue;
    }

    try {
      const output = await step.execute({
        workflowRunId: options.workflowRunId,
        stepId,
        idempotencyKey,
        context: options.context,
        outputs: { ...outputs },
      });
      ledger.set({ stepId, idempotencyKey, output });
      outputs[stepId] = output;
      completedSteps.push({ stepId, idempotencyKey, output });
      stepResults.push({
        stepId,
        idempotencyKey,
        status: 'executed',
        output,
      });
    } catch (err) {
      const failureReason = err instanceof Error ? err.message : String(err);
      stepResults.push({
        stepId,
        idempotencyKey,
        status: 'failed',
        error: failureReason,
      });

      const compensationPlan = planSagaCompensation(completedSteps, stepsById);
      const compensationResults: SagaCompensationResult[] = [];
      let anyCompensationFailed = false;

      for (let idx = completedSteps.length - 1; idx >= 0; idx -= 1) {
        const completed = completedSteps[idx]!;
        const completedDef = stepsById.get(completed.stepId);
        if (!completedDef?.compensate) {
          compensationResults.push({
            stepId: completed.stepId,
            idempotencyKey: completed.idempotencyKey,
            status: 'skipped',
          });
          continue;
        }

        try {
          await completedDef.compensate({
            workflowRunId: options.workflowRunId,
            stepId: completed.stepId,
            idempotencyKey: completed.idempotencyKey,
            context: options.context,
            output: completed.output,
            failureReason,
          });
          compensationResults.push({
            stepId: completed.stepId,
            idempotencyKey: completed.idempotencyKey,
            status: 'compensated',
          });
        } catch (compErr) {
          anyCompensationFailed = true;
          compensationResults.push({
            stepId: completed.stepId,
            idempotencyKey: completed.idempotencyKey,
            status: 'compensation_failed',
            error: compErr instanceof Error ? compErr.message : String(compErr),
          });
        }
      }

      return {
        workflowRunId: options.workflowRunId,
        status: anyCompensationFailed ? 'compensation_failed' : 'compensated',
        executionOrder,
        stepResults,
        outputs,
        compensationPlan,
        compensationResults,
        failedStepId: stepId,
        failureReason,
      };
    }
  }

  return {
    workflowRunId: options.workflowRunId,
    status: 'completed',
    executionOrder,
    stepResults,
    outputs,
    compensationPlan: [],
    compensationResults: [],
  };
}

export type QuorumViolationCode =
  | 'INVALID_QUORUM_POLICY'
  | 'DUPLICATE_APPROVER'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'INELIGIBLE_APPROVER'
  | 'ROLE_SEPARATION_VIOLATION';

export interface QuorumViolation {
  readonly code: QuorumViolationCode;
  readonly message: string;
  readonly approverId?: string;
  readonly role?: string;
}

export interface ApprovalQuorumPolicy {
  readonly requiredApprovals: number;
  readonly eligibleApproverIds: readonly string[];
  readonly requesterId: string;
  readonly allowSelfApproval?: boolean;
  readonly requiredRoles?: readonly string[];
  readonly enforceDistinctRoles?: boolean;
  readonly rejectOnAnyRejection?: boolean;
}

export interface ApprovalVote {
  readonly approverId: string;
  readonly role: string;
  readonly decision: 'approve' | 'reject';
  readonly decidedAt: Date | string;
  readonly reason?: string;
}

export interface QuorumEvaluationResult {
  readonly status: 'approved' | 'rejected' | 'pending' | 'invalid';
  readonly approved: boolean;
  readonly requiredApprovals: number;
  readonly totalEligible: number;
  readonly validApprovalCount: number;
  readonly validRejectionCount: number;
  readonly remainingApprovalsNeeded: number;
  readonly missingRequiredRoles: readonly string[];
  readonly violations: readonly QuorumViolation[];
}

export function evaluateApprovalQuorum(
  policy: ApprovalQuorumPolicy,
  votes: readonly ApprovalVote[]
): QuorumEvaluationResult {
  const violations: QuorumViolation[] = [];
  const eligibleSet = new Set(policy.eligibleApproverIds);
  const totalEligible = eligibleSet.size;

  if (
    !Number.isInteger(policy.requiredApprovals) ||
    policy.requiredApprovals <= 0 ||
    policy.requiredApprovals > totalEligible
  ) {
    violations.push({
      code: 'INVALID_QUORUM_POLICY',
      message: `requiredApprovals (${policy.requiredApprovals}) must be an integer between 1 and totalEligible (${totalEligible})`,
    });
  }

  const seenApprovers = new Set<string>();
  const approvedRoles = new Set<string>();
  let validApprovalCount = 0;
  let validRejectionCount = 0;

  for (const vote of votes) {
    if (seenApprovers.has(vote.approverId)) {
      violations.push({
        code: 'DUPLICATE_APPROVER',
        approverId: vote.approverId,
        role: vote.role,
        message: `Duplicate approval vote from approver "${vote.approverId}"`,
      });
      continue;
    }
    seenApprovers.add(vote.approverId);

    if (!policy.allowSelfApproval && vote.approverId === policy.requesterId) {
      violations.push({
        code: 'SELF_APPROVAL_FORBIDDEN',
        approverId: vote.approverId,
        role: vote.role,
        message: `Requester "${vote.approverId}" cannot self-approve`,
      });
      continue;
    }

    if (!eligibleSet.has(vote.approverId)) {
      violations.push({
        code: 'INELIGIBLE_APPROVER',
        approverId: vote.approverId,
        role: vote.role,
        message: `Approver "${vote.approverId}" is not in the eligible approver pool`,
      });
      continue;
    }

    if (vote.decision === 'approve') {
      if (policy.enforceDistinctRoles && approvedRoles.has(vote.role)) {
        violations.push({
          code: 'ROLE_SEPARATION_VIOLATION',
          approverId: vote.approverId,
          role: vote.role,
          message: `Role "${vote.role}" already satisfied by another approver; distinct roles required`,
        });
        continue;
      }
      approvedRoles.add(vote.role);
      validApprovalCount += 1;
    } else {
      validRejectionCount += 1;
    }
  }

  const missingRequiredRoles = (policy.requiredRoles ?? []).filter(
    (role) => !approvedRoles.has(role)
  );
  const remainingApprovalsNeeded = Math.max(0, policy.requiredApprovals - validApprovalCount);

  if (violations.length > 0) {
    return {
      status: 'invalid',
      approved: false,
      requiredApprovals: policy.requiredApprovals,
      totalEligible,
      validApprovalCount,
      validRejectionCount,
      remainingApprovalsNeeded,
      missingRequiredRoles,
      violations,
    };
  }

  const maxPossibleApprovals = totalEligible - validRejectionCount;
  const rejected =
    (policy.rejectOnAnyRejection && validRejectionCount > 0) ||
    maxPossibleApprovals < policy.requiredApprovals;

  if (rejected) {
    return {
      status: 'rejected',
      approved: false,
      requiredApprovals: policy.requiredApprovals,
      totalEligible,
      validApprovalCount,
      validRejectionCount,
      remainingApprovalsNeeded,
      missingRequiredRoles,
      violations,
    };
  }

  if (remainingApprovalsNeeded === 0 && missingRequiredRoles.length === 0) {
    return {
      status: 'approved',
      approved: true,
      requiredApprovals: policy.requiredApprovals,
      totalEligible,
      validApprovalCount,
      validRejectionCount,
      remainingApprovalsNeeded: 0,
      missingRequiredRoles: [],
      violations,
    };
  }

  return {
    status: 'pending',
    approved: false,
    requiredApprovals: policy.requiredApprovals,
    totalEligible,
    validApprovalCount,
    validRejectionCount,
    remainingApprovalsNeeded,
    missingRequiredRoles,
    violations,
  };
}

export type SlaStage = 'on_track' | 'warning' | 'escalate' | 'breach';

export interface SlaEscalationPolicy {
  readonly warningAtMs: number;
  readonly escalateAtMs: number;
  readonly breachAtMs: number;
  readonly warningNotifyRoles?: readonly string[];
  readonly escalateNotifyRoles?: readonly string[];
  readonly breachNotifyRoles?: readonly string[];
}

export interface SlaEvaluationInput {
  readonly startedAt: Date | string | number;
}

export interface SlaEvaluationResult {
  readonly stage: SlaStage;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly overdueMs: number;
  readonly startedAtIso: string;
  readonly evaluatedAtIso: string;
  readonly deadlineAtIso: string;
  readonly nextTransitionAtIso: string | null;
  readonly notifyRoles: readonly string[];
}

export type DeterministicClock = () => Date | number;

function toEpochMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

export function evaluateSlaEscalation(
  policy: SlaEscalationPolicy,
  input: SlaEvaluationInput,
  clock: DeterministicClock = () => new Date()
): SlaEvaluationResult {
  if (
    policy.warningAtMs < 0 ||
    policy.escalateAtMs < policy.warningAtMs ||
    policy.breachAtMs < policy.escalateAtMs
  ) {
    throw new Error(
      'Invalid SLA policy: thresholds must satisfy 0 <= warningAtMs <= escalateAtMs <= breachAtMs'
    );
  }

  const startedAtMs = toEpochMs(input.startedAt);
  const nowValue = clock();
  const evaluatedAtMs = nowValue instanceof Date ? nowValue.getTime() : nowValue;
  const elapsedMs = Math.max(0, evaluatedAtMs - startedAtMs);
  const deadlineAtMs = startedAtMs + policy.breachAtMs;
  const remainingMs = Math.max(0, policy.breachAtMs - elapsedMs);
  const overdueMs = Math.max(0, elapsedMs - policy.breachAtMs);

  let stage: SlaStage;
  let nextTransitionAtMs: number | null;
  let notifyRoles: readonly string[];

  if (elapsedMs >= policy.breachAtMs) {
    stage = 'breach';
    nextTransitionAtMs = null;
    notifyRoles = policy.breachNotifyRoles ?? [];
  } else if (elapsedMs >= policy.escalateAtMs) {
    stage = 'escalate';
    nextTransitionAtMs = deadlineAtMs;
    notifyRoles = policy.escalateNotifyRoles ?? [];
  } else if (elapsedMs >= policy.warningAtMs) {
    stage = 'warning';
    nextTransitionAtMs = startedAtMs + policy.escalateAtMs;
    notifyRoles = policy.warningNotifyRoles ?? [];
  } else {
    stage = 'on_track';
    nextTransitionAtMs = startedAtMs + policy.warningAtMs;
    notifyRoles = [];
  }

  return {
    stage,
    elapsedMs,
    remainingMs,
    overdueMs,
    startedAtIso: new Date(startedAtMs).toISOString(),
    evaluatedAtIso: new Date(evaluatedAtMs).toISOString(),
    deadlineAtIso: new Date(deadlineAtMs).toISOString(),
    nextTransitionAtIso:
      nextTransitionAtMs === null ? null : new Date(nextTransitionAtMs).toISOString(),
    notifyRoles,
  };
}
