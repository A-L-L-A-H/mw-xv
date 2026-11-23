import { describe, expect, it } from 'vitest';
import {
  deriveStepIdempotencyKey,
  evaluateApprovalQuorum,
  evaluateSlaEscalation,
  executeSaga,
  InMemorySagaReplayLedger,
  SagaValidationError,
  validateSagaDag,
  type SagaStepDefinition,
} from '../src/saga-engine.js';

describe('saga-engine', () => {
  describe('DAG validation', () => {
    it('computes deterministic topological order independent of input order', () => {
      const stepsA: SagaStepDefinition[] = [
        { id: 'settle', dependsOn: ['reserve', 'fraud_check'], execute: () => 'settled' },
        { id: 'fraud_check', dependsOn: ['intake'], execute: () => 'clean' },
        { id: 'reserve', dependsOn: ['intake'], execute: () => 'reserved' },
        { id: 'intake', execute: () => 'received' },
      ];
      const stepsB: SagaStepDefinition[] = [...stepsA].reverse();

      const validatedA = validateSagaDag(stepsA);
      const validatedB = validateSagaDag(stepsB);

      expect(validatedA.executionOrder).toEqual(['intake', 'fraud_check', 'reserve', 'settle']);
      expect(validatedB.executionOrder).toEqual(validatedA.executionOrder);
    });

    it('rejects cycles with CYCLE_DETECTED', () => {
      const cyclicSteps: SagaStepDefinition[] = [
        { id: 'a', dependsOn: ['c'], execute: () => 'a' },
        { id: 'b', dependsOn: ['a'], execute: () => 'b' },
        { id: 'c', dependsOn: ['b'], execute: () => 'c' },
      ];

      expect(() => validateSagaDag(cyclicSteps)).toThrow(SagaValidationError);
      try {
        validateSagaDag(cyclicSteps);
      } catch (err) {
        expect(err).toBeInstanceOf(SagaValidationError);
        const validationErr = err as SagaValidationError;
        expect(validationErr.code).toBe('CYCLE_DETECTED');
        expect(validationErr.details.cycleMembers).toEqual(['a', 'b', 'c']);
      }
    });

    it('rejects missing/orphan dependencies and self-dependencies', () => {
      const missingDep: SagaStepDefinition[] = [
        { id: 'charge', dependsOn: ['nonexistent_step'], execute: () => 'ok' },
      ];
      expect(() => validateSagaDag(missingDep)).toThrowError(
        expect.objectContaining({ code: 'MISSING_DEPENDENCY' })
      );

      const selfDep: SagaStepDefinition[] = [
        { id: 'loop', dependsOn: ['loop'], execute: () => 'ok' },
      ];
      expect(() => validateSagaDag(selfDep)).toThrowError(
        expect.objectContaining({ code: 'SELF_DEPENDENCY' })
      );
    });
  });

  describe('saga execution, reverse compensation & idempotent replay', () => {
    it('executes forward in topological order and compensates in reverse on partial failure', async () => {
      const trace: string[] = [];

      const steps: SagaStepDefinition<{ amount: number }>[] = [
        {
          id: 'step_1_hold',
          execute: ({ context }) => {
            trace.push(`exec:hold:${context.amount}`);
            return { holdId: 'H-100' };
          },
          compensate: ({ output }) => {
            const { holdId } = output as { holdId: string };
            trace.push(`comp:hold:${holdId}`);
          },
        },
        {
          id: 'step_2_audit',
          dependsOn: ['step_1_hold'],
          execute: () => {
            trace.push('exec:audit');
            return { auditId: 'A-200' };
          },
        },
        {
          id: 'step_3_reserve',
          dependsOn: ['step_2_audit'],
          execute: () => {
            trace.push('exec:reserve');
            return { reservationId: 'R-300' };
          },
          compensate: ({ output }) => {
            const { reservationId } = output as { reservationId: string };
            trace.push(`comp:reserve:${reservationId}`);
          },
        },
        {
          id: 'step_4_capture',
          dependsOn: ['step_3_reserve'],
          execute: () => {
            trace.push('exec:capture');
            throw new Error('PSP gateway timeout');
          },
          compensate: () => {
            trace.push('comp:capture');
          },
        },
      ];

      const result = await executeSaga(steps, {
        workflowRunId: 'run-saga-001',
        context: { amount: 2500 },
      });

      expect(result.status).toBe('compensated');
      expect(result.failedStepId).toBe('step_4_capture');
      expect(result.failureReason).toBe('PSP gateway timeout');
      expect(trace).toEqual([
        'exec:hold:2500',
        'exec:audit',
        'exec:reserve',
        'exec:capture',
        'comp:reserve:R-300',
        'comp:hold:H-100',
      ]);
      expect(result.compensationPlan.map((entry) => entry.stepId)).toEqual([
        'step_3_reserve',
        'step_2_audit',
        'step_1_hold',
      ]);
      expect(result.compensationResults.map((entry) => entry.status)).toEqual([
        'compensated',
        'skipped',
        'compensated',
      ]);
    });

    it('replays completed steps idempotently without re-executing side effects', async () => {
      const ledger = new InMemorySagaReplayLedger();
      let step1Calls = 0;
      let step2Calls = 0;
      let shouldFailStep2 = true;

      const steps: SagaStepDefinition<{ orderId: string }>[] = [
        {
          id: 'allocate_inventory',
          execute: ({ context }) => {
            step1Calls += 1;
            return { allocation: `ALLOC-${context.orderId}` };
          },
        },
        {
          id: 'dispatch_shipment',
          dependsOn: ['allocate_inventory'],
          execute: ({ outputs }) => {
            step2Calls += 1;
            if (shouldFailStep2) {
              throw new Error('Carrier offline');
            }
            return { shippedFrom: outputs.allocate_inventory };
          },
        },
      ];

      const firstAttempt = await executeSaga(steps, {
        workflowRunId: 'run-replay-42',
        context: { orderId: 'ORD-9' },
        replayLedger: ledger,
      });

      expect(firstAttempt.status).toBe('compensated');
      expect(step1Calls).toBe(1);
      expect(step2Calls).toBe(1);

      shouldFailStep2 = false;
      const secondAttempt = await executeSaga(steps, {
        workflowRunId: 'run-replay-42',
        context: { orderId: 'ORD-9' },
        replayLedger: ledger,
      });

      expect(secondAttempt.status).toBe('completed');
      expect(step1Calls).toBe(1);
      expect(step2Calls).toBe(2);
      expect(secondAttempt.stepResults[0]?.status).toBe('replayed');
      expect(secondAttempt.stepResults[1]?.status).toBe('executed');
      expect(secondAttempt.stepResults[0]?.idempotencyKey).toBe(
        deriveStepIdempotencyKey('run-replay-42', 'allocate_inventory')
      );
    });
  });

  describe('N-of-M approval quorum evaluator', () => {
    const basePolicy = {
      requiredApprovals: 2,
      eligibleApproverIds: ['u-finance', 'u-legal', 'u-cfo'],
      requesterId: 'u-requester',
      requiredRoles: ['finance', 'legal'],
      enforceDistinctRoles: true,
    };

    it('approves when N-of-M quorum and required roles are satisfied', () => {
      const result = evaluateApprovalQuorum(basePolicy, [
        {
          approverId: 'u-finance',
          role: 'finance',
          decision: 'approve',
          decidedAt: '2026-11-23T01:00:00Z',
        },
        {
          approverId: 'u-legal',
          role: 'legal',
          decision: 'approve',
          decidedAt: '2026-11-23T01:05:00Z',
        },
      ]);

      expect(result.status).toBe('approved');
      expect(result.approved).toBe(true);
      expect(result.validApprovalCount).toBe(2);
      expect(result.remainingApprovalsNeeded).toBe(0);
      expect(result.missingRequiredRoles).toEqual([]);
      expect(result.violations).toEqual([]);
    });

    it('blocks self-approval and duplicate approvers', () => {
      const selfApproval = evaluateApprovalQuorum(
        {
          ...basePolicy,
          eligibleApproverIds: ['u-requester', 'u-finance', 'u-legal'],
        },
        [
          {
            approverId: 'u-requester',
            role: 'finance',
            decision: 'approve',
            decidedAt: '2026-11-23T01:00:00Z',
          },
          {
            approverId: 'u-legal',
            role: 'legal',
            decision: 'approve',
            decidedAt: '2026-11-23T01:05:00Z',
          },
        ]
      );

      expect(selfApproval.status).toBe('invalid');
      expect(selfApproval.approved).toBe(false);
      expect(selfApproval.violations.map((v) => v.code)).toContain('SELF_APPROVAL_FORBIDDEN');

      const duplicateVote = evaluateApprovalQuorum(basePolicy, [
        {
          approverId: 'u-finance',
          role: 'finance',
          decision: 'approve',
          decidedAt: '2026-11-23T01:00:00Z',
        },
        {
          approverId: 'u-finance',
          role: 'legal',
          decision: 'approve',
          decidedAt: '2026-11-23T01:01:00Z',
        },
      ]);

      expect(duplicateVote.status).toBe('invalid');
      expect(duplicateVote.approved).toBe(false);
      expect(duplicateVote.violations.map((v) => v.code)).toContain('DUPLICATE_APPROVER');
    });

    it('enforces role separation and rejects when quorum becomes unreachable', () => {
      const sameRole = evaluateApprovalQuorum(basePolicy, [
        {
          approverId: 'u-finance',
          role: 'finance',
          decision: 'approve',
          decidedAt: '2026-11-23T01:00:00Z',
        },
        {
          approverId: 'u-cfo',
          role: 'finance',
          decision: 'approve',
          decidedAt: '2026-11-23T01:02:00Z',
        },
      ]);

      expect(sameRole.status).toBe('invalid');
      expect(sameRole.violations.map((v) => v.code)).toContain('ROLE_SEPARATION_VIOLATION');

      const unreachable = evaluateApprovalQuorum(basePolicy, [
        {
          approverId: 'u-finance',
          role: 'finance',
          decision: 'reject',
          decidedAt: '2026-11-23T01:00:00Z',
        },
        {
          approverId: 'u-legal',
          role: 'legal',
          decision: 'reject',
          decidedAt: '2026-11-23T01:05:00Z',
        },
      ]);

      expect(unreachable.status).toBe('rejected');
      expect(unreachable.approved).toBe(false);
    });
  });

  describe('SLA deadline & multi-tier escalation calculator', () => {
    const startedAt = new Date('2026-11-23T00:00:00.000Z');
    const policy = {
      warningAtMs: 60_000 * 30, // 30m
      escalateAtMs: 60_000 * 50, // 50m
      breachAtMs: 60_000 * 60, // 60m
      warningNotifyRoles: ['assignee'],
      escalateNotifyRoles: ['assignee', 'team_lead'],
      breachNotifyRoles: ['team_lead', 'director'],
    };

    it('transitions deterministically across on_track -> warning -> escalate -> breach', () => {
      const onTrack = evaluateSlaEscalation(
        policy,
        { startedAt },
        () => startedAt.getTime() + 60_000 * 10
      );
      expect(onTrack.stage).toBe('on_track');
      expect(onTrack.overdueMs).toBe(0);
      expect(onTrack.notifyRoles).toEqual([]);
      expect(onTrack.nextTransitionAtIso).toBe('2026-11-23T00:30:00.000Z');

      const warning = evaluateSlaEscalation(
        policy,
        { startedAt },
        () => startedAt.getTime() + 60_000 * 35
      );
      expect(warning.stage).toBe('warning');
      expect(warning.notifyRoles).toEqual(['assignee']);
      expect(warning.nextTransitionAtIso).toBe('2026-11-23T00:50:00.000Z');

      const escalate = evaluateSlaEscalation(
        policy,
        { startedAt },
        () => startedAt.getTime() + 60_000 * 55
      );
      expect(escalate.stage).toBe('escalate');
      expect(escalate.remainingMs).toBe(60_000 * 5);
      expect(escalate.notifyRoles).toEqual(['assignee', 'team_lead']);
      expect(escalate.nextTransitionAtIso).toBe('2026-11-23T01:00:00.000Z');

      const breach = evaluateSlaEscalation(
        policy,
        { startedAt },
        () => startedAt.getTime() + 60_000 * 75
      );
      expect(breach.stage).toBe('breach');
      expect(breach.remainingMs).toBe(0);
      expect(breach.overdueMs).toBe(60_000 * 15);
      expect(breach.notifyRoles).toEqual(['team_lead', 'director']);
      expect(breach.nextTransitionAtIso).toBeNull();
    });
  });
});
