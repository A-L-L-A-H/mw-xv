import { createHash } from 'node:crypto';
import {
  startWorkflow,
  transitionWorkflow,
  type WorkflowDefinitionConfig,
  type WorkflowEventPayload,
} from '@moonwitness/orm-workflow';
import type { Knex } from 'knex';
import { canonicalResearchJson } from './research-release.js';

export const bugCaseWorkflowDefinitionCode = 'knowledge.bug_case' as const;

export const bugCaseWorkflowConfig: WorkflowDefinitionConfig = {
  startState: 'intake',
  startRoles: ['user', 'superadmin'],
  timeoutMinutes: 43_200,
  resourceModels: ['knowledge.bug_case'],
  transitions: [
    {
      action: 'triage',
      from: 'intake',
      to: 'triaged',
      roles: ['user', 'superadmin'],
    },
    {
      action: 'plan',
      from: 'triaged',
      to: 'planned',
      roles: ['user', 'superadmin'],
    },
    {
      action: 'record_action',
      from: 'planned',
      to: 'action_recorded',
      roles: ['user', 'superadmin'],
    },
    {
      action: 'verify_outcome',
      from: 'action_recorded',
      to: 'verified_resolved',
      roles: ['user', 'superadmin'],
      requireDifferentActor: true,
    },
    {
      action: 'reopen',
      from: 'verified_resolved',
      to: 'reopened',
      roles: ['user', 'superadmin'],
    },
    {
      action: 'replan',
      from: 'reopened',
      to: 'planned',
      roles: ['user', 'superadmin'],
    },
  ],
};

/** Idempotently register the `knowledge.bug_case` workflow definition when `@moonwitness/orm-workflow` is installed. */
export async function ensureBugCaseWorkflowDefinition(db: Knex): Promise<void> {
  const existing = await db('workflow_definitions')
    .where({ code: bugCaseWorkflowDefinitionCode, version: 1 })
    .first('id');
  if (!existing) {
    await db('workflow_definitions').insert({
      code: bugCaseWorkflowDefinitionCode,
      version: 1,
      name: 'Knowledge BUG case lifecycle',
      config: JSON.stringify(bugCaseWorkflowConfig),
      enabled: true,
    });
  }
}

export type BugCaseClassification = 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'CHILD_SENSITIVE';

export type BugCaseState =
  'intake' | 'triaged' | 'planned' | 'action_recorded' | 'verified_resolved' | 'reopened';

export type BugCaseApprovalStatus = 'unreviewed' | 'human_approved' | 'human_rejected';
export type BugCasePublicationStatus = 'unpublished' | 'editorial_candidate' | 'public_approved';
export type BugCaseResolvedStatus = 'unresolved' | 'verified_resolved' | 'reopened';
export type BugCaseEventKind = 'intake' | 'triage' | 'plan' | 'action' | 'verification' | 'reopen';
export type BugCaseTransitionAction =
  'triage' | 'plan' | 'record_action' | 'verify_outcome' | 'reopen' | 'replan';

export interface AuthenticatedBugCaseActor {
  readonly userId: number;
  readonly companyId: number;
  readonly role: 'user' | 'superadmin';
}

export interface StoredBugCaseRecord {
  readonly id: number;
  readonly company_id: number;
  readonly program_id: string;
  readonly case_id: string;
  readonly workflow_instance_id: number;
  readonly title: string;
  readonly classification: BugCaseClassification;
  readonly synthetic: boolean;
  readonly case_state: BugCaseState;
  readonly human_approval_status: BugCaseApprovalStatus;
  readonly publication_status: BugCasePublicationStatus;
  readonly resolved_status: BugCaseResolvedStatus;
  readonly created_by_id: number;
  readonly revision: number;
}

export interface StoredBugCaseEvent {
  readonly id: number;
  readonly company_id: number;
  readonly bug_case_id: number;
  readonly workflow_instance_id: number;
  readonly workflow_event_sequence: number;
  readonly event_kind: BugCaseEventKind;
  readonly from_state: string;
  readonly to_state: string;
  readonly actor_id: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly event_digest: string;
  readonly recorded_at: string;
}

export interface IntakeBugCaseInput {
  readonly db: Knex;
  readonly actor: AuthenticatedBugCaseActor;
  readonly programId: `mw:bug-program:slot-${string}`;
  readonly caseId: `mw:bug-case:${string}`;
  readonly title: string;
  readonly classification: BugCaseClassification;
  readonly synthetic: boolean;
  readonly summary: string;
  readonly idempotencyKey: string;
  readonly now?: Date;
}

export interface TransitionBugCaseInput {
  readonly db: Knex;
  readonly actor: AuthenticatedBugCaseActor;
  readonly caseId: `mw:bug-case:${string}`;
  readonly action: BugCaseTransitionAction;
  readonly expectedWorkflowRevision: number;
  readonly idempotencyKey: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly now?: Date;
}

export interface UpdateBugCasePublicationInput {
  readonly db: Knex;
  readonly actor: AuthenticatedBugCaseActor;
  readonly caseId: `mw:bug-case:${string}`;
  readonly nextPublicationStatus: 'editorial_candidate' | 'public_approved';
  readonly expectedRevision: number;
  readonly publicationDecisionRef?: string;
}

export interface BugCaseHistoryResult {
  readonly bugCase: StoredBugCaseRecord;
  readonly events: readonly StoredBugCaseEvent[];
}

export type BugCaseWorkflowErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CONFLICT'
  | 'INTEGRITY_ERROR';

export class BugCaseWorkflowError extends Error {
  readonly code: BugCaseWorkflowErrorCode;

  constructor(code: BugCaseWorkflowErrorCode, message: string) {
    super(message);
    this.name = 'BugCaseWorkflowError';
    this.code = code;
  }
}

const programIdPattern = /^mw:bug-program:slot-(0[1-9]|[12][0-9]|3[0-3])$/u;
const caseIdPattern = /^mw:bug-case:[a-z0-9][a-z0-9._-]{0,127}$/u;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

function fail(code: BugCaseWorkflowErrorCode, message: string): never {
  throw new BugCaseWorkflowError(code, message);
}

function sha256Hex(value: unknown): string {
  return createHash('sha256').update(canonicalResearchJson(value), 'utf8').digest('hex');
}

async function assertActiveActorMembership(
  trx: Knex.Transaction,
  actor: AuthenticatedBugCaseActor
): Promise<void> {
  if (
    !Number.isSafeInteger(actor.userId) ||
    actor.userId <= 0 ||
    !Number.isSafeInteger(actor.companyId) ||
    actor.companyId <= 0 ||
    (actor.role !== 'user' && actor.role !== 'superadmin')
  ) {
    fail('FORBIDDEN', 'Invalid authenticated actor context');
  }
  const user = await trx('users')
    .where({ id: actor.userId, active: true })
    .forUpdate()
    .first('id', 'role');
  if (!user || user.role !== actor.role) {
    fail('FORBIDDEN', 'Actor is missing, inactive, or role-mismatched');
  }
  const company = await trx('companies')
    .where({ id: actor.companyId, active: true })
    .forUpdate()
    .first('id');
  if (!company) {
    fail('FORBIDDEN', 'Active company not found');
  }
  const membership = await trx('company_memberships')
    .where({ user_id: actor.userId, company_id: actor.companyId, active: true })
    .forUpdate()
    .first('id');
  if (!membership) {
    fail('FORBIDDEN', 'Actor has no active membership in target company');
  }
}

function normalizeCaseRow(row: Record<string, unknown>): StoredBugCaseRecord {
  return {
    id: Number(row.id),
    company_id: Number(row.company_id),
    program_id: String(row.program_id),
    case_id: String(row.case_id),
    workflow_instance_id: Number(row.workflow_instance_id),
    title: String(row.title),
    classification: row.classification as BugCaseClassification,
    synthetic: Boolean(row.synthetic),
    case_state: row.case_state as BugCaseState,
    human_approval_status: row.human_approval_status as BugCaseApprovalStatus,
    publication_status: row.publication_status as BugCasePublicationStatus,
    resolved_status: row.resolved_status as BugCaseResolvedStatus,
    created_by_id: Number(row.created_by_id),
    revision: Number(row.revision),
  };
}

function normalizeEventRow(row: Record<string, unknown>): StoredBugCaseEvent {
  let parsedPayload: Record<string, unknown>;
  try {
    parsedPayload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
  } catch {
    fail('INTEGRITY_ERROR', 'Stored BUG case event payload is not valid JSON');
  }
  const expectedDigest = sha256Hex({
    company_id: Number(row.company_id),
    bug_case_id: Number(row.bug_case_id),
    workflow_instance_id: Number(row.workflow_instance_id),
    workflow_event_sequence: Number(row.workflow_event_sequence),
    event_kind: String(row.event_kind),
    from_state: String(row.from_state),
    to_state: String(row.to_state),
    actor_id: Number(row.actor_id),
    payload: parsedPayload,
    recorded_at: String(row.recorded_at),
  });
  if (expectedDigest !== String(row.event_digest)) {
    fail('INTEGRITY_ERROR', 'Stored BUG case event digest mismatch');
  }
  return {
    id: Number(row.id),
    company_id: Number(row.company_id),
    bug_case_id: Number(row.bug_case_id),
    workflow_instance_id: Number(row.workflow_instance_id),
    workflow_event_sequence: Number(row.workflow_event_sequence),
    event_kind: row.event_kind as BugCaseEventKind,
    from_state: String(row.from_state),
    to_state: String(row.to_state),
    actor_id: Number(row.actor_id),
    payload: parsedPayload,
    event_digest: String(row.event_digest),
    recorded_at: String(row.recorded_at),
  };
}

function eventKindForAction(action: BugCaseTransitionAction): BugCaseEventKind {
  switch (action) {
    case 'triage':
      return 'triage';
    case 'plan':
    case 'replan':
      return 'plan';
    case 'record_action':
      return 'action';
    case 'verify_outcome':
      return 'verification';
    case 'reopen':
      return 'reopen';
  }
}

/**
 * Intake a scoped BUG case, bind it to an `@moonwitness/orm-workflow` `knowledge.bug_case`
 * instance, and append an idempotent `intake` event. Retrying with identical input and
 * idempotency key returns the existing record without creating duplicate rows or side effects.
 */
export async function intakeBugCase(
  input: IntakeBugCaseInput
): Promise<{ bugCase: StoredBugCaseRecord; event: StoredBugCaseEvent }> {
  if (
    !programIdPattern.test(input.programId) ||
    !caseIdPattern.test(input.caseId) ||
    !idempotencyPattern.test(input.idempotencyKey) ||
    input.title.trim().length === 0 ||
    input.summary.trim().length === 0
  ) {
    fail(
      'INVALID_INPUT',
      'BUG case intake requires valid programId, caseId, title, summary, and idempotencyKey'
    );
  }
  if (input.programId === 'mw:bug-program:slot-13' && input.classification !== 'CHILD_SENSITIVE') {
    fail('INVALID_INPUT', 'Slot 13 requires CHILD_SENSITIVE classification');
  }
  if (input.classification === 'CHILD_SENSITIVE' && input.synthetic !== true) {
    fail(
      'FORBIDDEN',
      'Non-synthetic CHILD_SENSITIVE cases are blocked pending safeguarding approval'
    );
  }

  const intakeIdempotencyKey = `intake:${input.idempotencyKey}`;
  const nowIso = (input.now ?? new Date()).toISOString();
  const payloadObject: Record<string, unknown> = {
    program_id: input.programId,
    case_id: input.caseId,
    title: input.title,
    classification: input.classification,
    synthetic: input.synthetic,
    summary: input.summary,
  };
  const canonicalPayload = canonicalResearchJson(payloadObject);

  return input.db.transaction(async (trx) => {
    await assertActiveActorMembership(trx, input.actor);

    const existingByCaseId = await trx('knowledge_bug_cases')
      .where({ company_id: input.actor.companyId, case_id: input.caseId })
      .forUpdate()
      .first();

    if (existingByCaseId) {
      const priorEvent = await trx('knowledge_bug_case_events')
        .where({
          company_id: input.actor.companyId,
          bug_case_id: existingByCaseId.id,
          idempotency_key: intakeIdempotencyKey,
        })
        .first();
      if (!priorEvent) {
        fail('CONFLICT', `BUG case "${input.caseId}" already exists in this company`);
      }
      if (
        String(priorEvent.payload_json) !== canonicalPayload ||
        Number(priorEvent.actor_id) !== input.actor.userId
      ) {
        fail(
          'IDEMPOTENCY_CONFLICT',
          'Intake idempotency key reused with conflicting payload or actor'
        );
      }
      return {
        bugCase: normalizeCaseRow(existingByCaseId),
        event: normalizeEventRow(priorEvent),
      };
    }

    const [insertedCase] = await trx('knowledge_bug_cases')
      .insert({
        company_id: input.actor.companyId,
        program_id: input.programId,
        case_id: input.caseId,
        workflow_instance_id: null,
        title: input.title,
        classification: input.classification,
        synthetic: input.synthetic,
        case_state: 'intake',
        human_approval_status: 'unreviewed',
        publication_status: 'unpublished',
        resolved_status: 'unresolved',
        created_by_id: input.actor.userId,
        revision: 1,
      })
      .returning('*');

    const caseRow = insertedCase
      ? insertedCase
      : await trx('knowledge_bug_cases')
          .where({ company_id: input.actor.companyId, case_id: input.caseId })
          .first();

    const workflowInstance = await startWorkflow(trx, {
      code: 'knowledge.bug_case',
      companyId: input.actor.companyId,
      actorId: input.actor.userId,
      role: input.actor.role,
      resourceModel: 'knowledge.bug_case',
      resourceId: Number(caseRow.id),
      idempotencyKey: input.idempotencyKey,
      now: input.now,
    });

    await trx('knowledge_bug_cases')
      .where({ id: caseRow.id })
      .update({ workflow_instance_id: workflowInstance.id });

    const eventDigest = sha256Hex({
      company_id: input.actor.companyId,
      bug_case_id: Number(caseRow.id),
      workflow_instance_id: workflowInstance.id,
      workflow_event_sequence: 0,
      event_kind: 'intake',
      from_state: 'none',
      to_state: 'intake',
      actor_id: input.actor.userId,
      payload: JSON.parse(canonicalPayload) as Record<string, unknown>,
      recorded_at: nowIso,
    });

    await trx('knowledge_bug_case_events').insert({
      company_id: input.actor.companyId,
      bug_case_id: caseRow.id,
      workflow_instance_id: workflowInstance.id,
      workflow_event_sequence: 0,
      event_kind: 'intake',
      from_state: 'none',
      to_state: 'intake',
      actor_id: input.actor.userId,
      idempotency_key: intakeIdempotencyKey,
      payload_json: canonicalPayload,
      event_digest: eventDigest,
      recorded_at: nowIso,
    });

    const updatedCase = await trx('knowledge_bug_cases').where({ id: caseRow.id }).first();
    const insertedEvent = await trx('knowledge_bug_case_events')
      .where({ bug_case_id: caseRow.id, workflow_event_sequence: 0 })
      .first();

    return {
      bugCase: normalizeCaseRow(updatedCase),
      event: normalizeEventRow(insertedEvent),
    };
  });
}

/**
 * Execute one workflow-backed transition (`triage`, `plan`, `record_action`,
 * `verify_outcome`, `reopen`, `replan`). Enforces independent verification,
 * status separation, and idempotent replay with zero duplicate events.
 */
export async function transitionBugCaseWorkflow(
  input: TransitionBugCaseInput
): Promise<BugCaseHistoryResult> {
  if (!caseIdPattern.test(input.caseId) || !idempotencyPattern.test(input.idempotencyKey)) {
    fail('INVALID_INPUT', 'Valid caseId and idempotencyKey are required');
  }

  const canonicalDetails = canonicalResearchJson(input.details);
  const parsedDetails = JSON.parse(canonicalDetails) as WorkflowEventPayload;

  const existingInstance = await input.db.transaction(async (trx) => {
    await assertActiveActorMembership(trx, input.actor);
    const row = await trx('knowledge_bug_cases')
      .where({ company_id: input.actor.companyId, case_id: input.caseId })
      .first();
    if (!row || !row.workflow_instance_id) {
      fail('NOT_FOUND', `BUG case "${input.caseId}" was not found`);
    }
    return normalizeCaseRow(row);
  });

  await transitionWorkflow(input.db, {
    instanceId: existingInstance.workflow_instance_id,
    companyId: input.actor.companyId,
    actorId: input.actor.userId,
    role: input.actor.role,
    action: input.action,
    expectedRevision: input.expectedWorkflowRevision,
    idempotencyKey: input.idempotencyKey,
    payload: parsedDetails,
    now: input.now,
    preparePayload: async (ctx) => {
      await assertActiveActorMembership(ctx.trx, input.actor);
      const lockedCase = await ctx
        .trx('knowledge_bug_cases')
        .where({ id: existingInstance.id, company_id: input.actor.companyId })
        .forUpdate()
        .first();
      if (!lockedCase) {
        fail('NOT_FOUND', 'BUG case disappeared during transition');
      }

      if (ctx.action === 'verify_outcome') {
        const lastActionEvent = await ctx
          .trx('knowledge_bug_case_events')
          .where({ bug_case_id: lockedCase.id, event_kind: 'action' })
          .orderBy('workflow_event_sequence', 'desc')
          .first();
        if (!lastActionEvent) {
          fail('CONFLICT', 'Cannot verify outcome before an action is recorded');
        }
        if (
          Number(lastActionEvent.actor_id) === input.actor.userId ||
          Number(lockedCase.created_by_id) === input.actor.userId
        ) {
          fail(
            'FORBIDDEN',
            'Outcome verification requires an independent reviewer distinct from the case starter and action actor'
          );
        }
        const evidenceId = (parsedDetails as Record<string, unknown>).evidence_id;
        if (
          typeof evidenceId !== 'string' ||
          !/^mw:evidence:[a-z0-9][a-z0-9._-]{0,179}$/u.test(evidenceId)
        ) {
          fail('INVALID_INPUT', 'verify_outcome requires an explicit mw:evidence:* reference');
        }
      }

      const nextState = ctx.toState as BugCaseState;
      const nextResolvedStatus: BugCaseResolvedStatus =
        nextState === 'verified_resolved'
          ? 'verified_resolved'
          : nextState === 'reopened'
            ? 'reopened'
            : lockedCase.resolved_status === 'reopened'
              ? 'reopened'
              : 'unresolved';
      const nextApprovalStatus: BugCaseApprovalStatus =
        nextState === 'verified_resolved'
          ? 'human_approved'
          : nextState === 'reopened'
            ? 'unreviewed'
            : (lockedCase.human_approval_status as BugCaseApprovalStatus);

      // Publication status stays strictly independent of case verification/resolution.
      await ctx
        .trx('knowledge_bug_cases')
        .where({ id: lockedCase.id })
        .update({
          case_state: nextState,
          resolved_status: nextResolvedStatus,
          human_approval_status: nextApprovalStatus,
          revision: Number(lockedCase.revision) + 1,
        });

      const eventKind = eventKindForAction(input.action);
      const eventDigest = sha256Hex({
        company_id: input.actor.companyId,
        bug_case_id: Number(lockedCase.id),
        workflow_instance_id: ctx.instance.id,
        workflow_event_sequence: ctx.sequence,
        event_kind: eventKind,
        from_state: ctx.fromState,
        to_state: ctx.toState,
        actor_id: input.actor.userId,
        payload: parsedDetails,
        recorded_at: ctx.eventTime,
      });

      await ctx.trx('knowledge_bug_case_events').insert({
        company_id: input.actor.companyId,
        bug_case_id: lockedCase.id,
        workflow_instance_id: ctx.instance.id,
        workflow_event_sequence: ctx.sequence,
        event_kind: eventKind,
        from_state: ctx.fromState,
        to_state: ctx.toState,
        actor_id: input.actor.userId,
        idempotency_key: input.idempotencyKey,
        payload_json: canonicalDetails,
        event_digest: eventDigest,
        recorded_at: ctx.eventTime,
      });

      return parsedDetails;
    },
    verifyPreparedPayloadReplay: async (ctx) => {
      const eventRow = await ctx
        .trx('knowledge_bug_case_events')
        .where({
          company_id: input.actor.companyId,
          bug_case_id: existingInstance.id,
          idempotency_key: input.idempotencyKey,
        })
        .first();
      if (!eventRow) {
        fail('INTEGRITY_ERROR', 'Missing BUG case event projection for workflow replay');
      }
      normalizeEventRow(eventRow);
    },
  });

  return readBugCaseHistory(input.db, input.caseId, input.actor);
}

/**
 * Update editorial/publication status independently without ever altering `case_state`,
 * `human_approval_status`, or `resolved_status`. Denies `public_approved` for `CHILD_SENSITIVE`
 * records and blocks self-approval.
 */
export async function updateBugCasePublicationStatus(
  input: UpdateBugCasePublicationInput
): Promise<StoredBugCaseRecord> {
  if (!caseIdPattern.test(input.caseId)) {
    fail('INVALID_INPUT', 'Valid caseId is required');
  }
  return input.db.transaction(async (trx) => {
    await assertActiveActorMembership(trx, input.actor);
    const lockedCase = await trx('knowledge_bug_cases')
      .where({ company_id: input.actor.companyId, case_id: input.caseId })
      .forUpdate()
      .first();
    if (!lockedCase) {
      fail('NOT_FOUND', `BUG case "${input.caseId}" was not found`);
    }
    if (Number(lockedCase.revision) !== input.expectedRevision) {
      fail('CONFLICT', 'Stale BUG case revision');
    }
    if (input.nextPublicationStatus === 'public_approved') {
      if (lockedCase.classification === 'CHILD_SENSITIVE') {
        fail('FORBIDDEN', 'CHILD_SENSITIVE cases cannot be transitioned to public_approved');
      }
      if (Number(lockedCase.created_by_id) === input.actor.userId) {
        fail('FORBIDDEN', 'Requester cannot self-approve public publication');
      }
      if (!input.publicationDecisionRef || input.publicationDecisionRef.trim().length === 0) {
        fail('INVALID_INPUT', 'public_approved requires a recorded publicationDecisionRef');
      }
    }

    await trx('knowledge_bug_cases')
      .where({ id: lockedCase.id })
      .update({
        publication_status: input.nextPublicationStatus,
        revision: Number(lockedCase.revision) + 1,
      });

    const updated = await trx('knowledge_bug_cases').where({ id: lockedCase.id }).first();
    return normalizeCaseRow(updated);
  });
}

/** Read a tenant-scoped BUG case and verify every append-only event digest. */
export async function readBugCaseHistory(
  db: Knex,
  caseId: string,
  actor: AuthenticatedBugCaseActor
): Promise<BugCaseHistoryResult> {
  return db.transaction(async (trx) => {
    await assertActiveActorMembership(trx, actor);
    const caseRow = await trx('knowledge_bug_cases')
      .where({ company_id: actor.companyId, case_id: caseId })
      .first();
    if (!caseRow) {
      fail('NOT_FOUND', `BUG case "${caseId}" was not found`);
    }
    const eventRows = await trx('knowledge_bug_case_events')
      .where({ company_id: actor.companyId, bug_case_id: caseRow.id })
      .orderBy('workflow_event_sequence', 'asc')
      .orderBy('id', 'asc');
    return {
      bugCase: normalizeCaseRow(caseRow),
      events: eventRows.map((row) => normalizeEventRow(row)),
    };
  });
}
