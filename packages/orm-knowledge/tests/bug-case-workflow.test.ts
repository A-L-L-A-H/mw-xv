import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest, ModelAccess } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  BugCaseActionOutcomeEvent,
  BugCaseRecord,
  BugCaseWorkflowError,
  ensureBugCaseWorkflowDefinition,
  intakeBugCase,
  manifest,
  readBugCaseHistory,
  transitionBugCaseWorkflow,
  updateBugCasePublicationStatus,
  type AuthenticatedBugCaseActor,
} from '../src/index.js';

describe('BUG case workflow reuse and action/outcome models', () => {
  let db: Knex;
  let companyId: number;
  let secondCompanyId: number;
  let starterActor: AuthenticatedBugCaseActor;
  let verifierActor: AuthenticatedBugCaseActor;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await installAddons(db, [
      baseManifest,
      jobsManifest,
      notificationManifest,
      workflowManifest,
      manifest,
    ]);
    await ensureBugCaseWorkflowDefinition(db);

    const defaultCompany = await db('companies').first('id');
    companyId = Number(defaultCompany?.id);
    const [otherCompany] = await db('companies')
      .insert({
        name: 'Other Tenant',
        active: true,
      })
      .returning('id');
    secondCompanyId =
      typeof otherCompany === 'object' ? Number(otherCompany.id) : Number(otherCompany);

    const [starterPartner] = await db('partners')
      .insert({ name: 'Case Starter Partner', active: true })
      .returning('id');
    const starterPartnerId =
      typeof starterPartner === 'object' ? Number(starterPartner.id) : Number(starterPartner);
    const [starterRow] = await db('users')
      .insert({ login: 'case_starter', partner_id: starterPartnerId, role: 'user', active: true })
      .returning('id');
    const starterUserId =
      typeof starterRow === 'object' ? Number(starterRow.id) : Number(starterRow);
    const verifierRow = await db('users').where({ login: 'superadmin' }).first('id');
    starterActor = {
      userId: starterUserId,
      companyId,
      role: 'user',
    };
    verifierActor = {
      userId: Number(verifierRow?.id),
      companyId,
      role: 'superadmin',
    };

    for (const userId of [starterActor.userId, verifierActor.userId]) {
      await db('company_memberships')
        .insert({ user_id: userId, company_id: companyId, active: true, is_default: true })
        .onConflict(['user_id', 'company_id'])
        .ignore();
    }
  });

  afterEach(async () => db.destroy());

  it('runs intake, triage, plan, action, independent verification, reopen, and replan linked to workflow events', async () => {
    const intake = await intakeBugCase({
      db,
      actor: starterActor,
      programId: 'mw:bug-program:slot-01',
      caseId: 'mw:bug-case:synth-001',
      title: 'Synthetic case 001',
      classification: 'INTERNAL',
      synthetic: true,
      summary: 'Synthetic intake description.',
      idempotencyKey: 'bug-intake-001',
      now: new Date('2026-11-21T01:00:00.000Z'),
    });

    expect(intake.bugCase).toMatchObject({
      case_state: 'intake',
      human_approval_status: 'unreviewed',
      publication_status: 'unpublished',
      resolved_status: 'unresolved',
    });

    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-001',
      action: 'triage',
      expectedWorkflowRevision: 0,
      idempotencyKey: 'bug-triage-001',
      details: { severity: 'moderate' },
      now: new Date('2026-11-21T01:05:00.000Z'),
    });

    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-001',
      action: 'plan',
      expectedWorkflowRevision: 1,
      idempotencyKey: 'bug-plan-001',
      details: { plan_ref: 'synthetic:plan:001' },
      now: new Date('2026-11-21T01:10:00.000Z'),
    });

    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-001',
      action: 'record_action',
      expectedWorkflowRevision: 2,
      idempotencyKey: 'bug-action-001',
      details: { action_note: 'Synthetic action completed.' },
      now: new Date('2026-11-21T01:15:00.000Z'),
    });

    const verified = await transitionBugCaseWorkflow({
      db,
      actor: verifierActor,
      caseId: 'mw:bug-case:synth-001',
      action: 'verify_outcome',
      expectedWorkflowRevision: 3,
      idempotencyKey: 'bug-verify-001',
      details: { evidence_id: 'mw:evidence:bug-proof-001' },
      now: new Date('2026-11-21T01:20:00.000Z'),
    });

    expect(verified.bugCase).toMatchObject({
      case_state: 'verified_resolved',
      human_approval_status: 'human_approved',
      publication_status: 'unpublished',
      resolved_status: 'verified_resolved',
    });
    expect(verified.events).toHaveLength(5);

    const reopened = await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-001',
      action: 'reopen',
      expectedWorkflowRevision: 4,
      idempotencyKey: 'bug-reopen-001',
      details: { reason: 'Follow-up check needed.' },
      now: new Date('2026-11-21T01:25:00.000Z'),
    });
    expect(reopened.bugCase).toMatchObject({
      case_state: 'reopened',
      human_approval_status: 'unreviewed',
      publication_status: 'unpublished',
      resolved_status: 'reopened',
    });

    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-001',
      action: 'replan',
      expectedWorkflowRevision: 5,
      idempotencyKey: 'bug-replan-001',
      details: { plan_ref: 'synthetic:plan:002' },
    });
    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-001',
      action: 'record_action',
      expectedWorkflowRevision: 6,
      idempotencyKey: 'bug-action-002',
      details: { action_note: 'Second cycle action.' },
    });
    const reVerified = await transitionBugCaseWorkflow({
      db,
      actor: verifierActor,
      caseId: 'mw:bug-case:synth-001',
      action: 'verify_outcome',
      expectedWorkflowRevision: 7,
      idempotencyKey: 'bug-verify-002',
      details: { evidence_id: 'mw:evidence:bug-proof-002' },
    });

    expect(reVerified.bugCase.resolved_status).toBe('verified_resolved');
    expect(reVerified.events).toHaveLength(9);
  });

  it('replays intake and transitions idempotently without duplicate events and rejects conflicting replays', async () => {
    const firstIntake = await intakeBugCase({
      db,
      actor: starterActor,
      programId: 'mw:bug-program:slot-02',
      caseId: 'mw:bug-case:synth-002',
      title: 'Synthetic replay case',
      classification: 'INTERNAL',
      synthetic: true,
      summary: 'Replay safety check.',
      idempotencyKey: 'bug-intake-replay-002',
      now: new Date('2026-11-21T02:00:00.000Z'),
    });
    const secondIntake = await intakeBugCase({
      db,
      actor: starterActor,
      programId: 'mw:bug-program:slot-02',
      caseId: 'mw:bug-case:synth-002',
      title: 'Synthetic replay case',
      classification: 'INTERNAL',
      synthetic: true,
      summary: 'Replay safety check.',
      idempotencyKey: 'bug-intake-replay-002',
      now: new Date('2026-11-21T02:00:00.000Z'),
    });
    expect(secondIntake.bugCase.id).toBe(firstIntake.bugCase.id);
    expect(secondIntake.event.id).toBe(firstIntake.event.id);

    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-002',
      action: 'triage',
      expectedWorkflowRevision: 0,
      idempotencyKey: 'bug-triage-replay-002',
      details: { priority: 'p1' },
      now: new Date('2026-11-21T02:05:00.000Z'),
    });
    const replayed = await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-002',
      action: 'triage',
      expectedWorkflowRevision: 0,
      idempotencyKey: 'bug-triage-replay-002',
      details: { priority: 'p1' },
      now: new Date('2026-11-21T02:05:00.000Z'),
    });
    expect(replayed.events).toHaveLength(2);
    expect(
      await db('workflow_events').where({ instance_id: replayed.bugCase.workflow_instance_id })
    ).toHaveLength(2);

    await expect(
      intakeBugCase({
        db,
        actor: starterActor,
        programId: 'mw:bug-program:slot-02',
        caseId: 'mw:bug-case:synth-002',
        title: 'Modified replay title',
        classification: 'INTERNAL',
        synthetic: true,
        summary: 'Replay safety check.',
        idempotencyKey: 'bug-intake-replay-002',
      })
    ).rejects.toThrow(BugCaseWorkflowError);
  });

  it('separates publication from resolution/approval and blocks self-verification, SQL edits, and generic access', async () => {
    await intakeBugCase({
      db,
      actor: starterActor,
      programId: 'mw:bug-program:slot-03',
      caseId: 'mw:bug-case:synth-003',
      title: 'Status separation check',
      classification: 'INTERNAL',
      synthetic: true,
      summary: 'Publication cannot resolve a case.',
      idempotencyKey: 'bug-intake-003',
    });

    const publishedCandidate = await updateBugCasePublicationStatus({
      db,
      actor: verifierActor,
      caseId: 'mw:bug-case:synth-003',
      nextPublicationStatus: 'public_approved',
      expectedRevision: 1,
      publicationDecisionRef: 'synthetic:pub-decision:003',
    });
    expect(publishedCandidate.publication_status).toBe('public_approved');
    expect(publishedCandidate.resolved_status).toBe('unresolved');
    expect(publishedCandidate.human_approval_status).toBe('unreviewed');

    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-003',
      action: 'triage',
      expectedWorkflowRevision: 0,
      idempotencyKey: 'bug-triage-003',
      details: { note: 'triaged' },
    });
    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-003',
      action: 'plan',
      expectedWorkflowRevision: 1,
      idempotencyKey: 'bug-plan-003',
      details: { note: 'planned' },
    });
    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId: 'mw:bug-case:synth-003',
      action: 'record_action',
      expectedWorkflowRevision: 2,
      idempotencyKey: 'bug-action-003',
      details: { note: 'acted' },
    });

    // Self-verification by starter must fail closed
    await expect(
      transitionBugCaseWorkflow({
        db,
        actor: starterActor,
        caseId: 'mw:bug-case:synth-003',
        action: 'verify_outcome',
        expectedWorkflowRevision: 3,
        idempotencyKey: 'bug-self-verify-003',
        details: { evidence_id: 'mw:evidence:self-003' },
      })
    ).rejects.toThrow();

    // Direct SQL mutation on append-only events must fail
    await expect(db('knowledge_bug_case_events').update({ to_state: 'tampered' })).rejects.toThrow(
      /append-only/u
    );
    await expect(db('knowledge_bug_case_events').delete()).rejects.toThrow(/append-only/u);

    // Cross-company read denied
    await expect(
      readBugCaseHistory(db, 'mw:bug-case:synth-003', {
        userId: verifierActor.userId,
        companyId: secondCompanyId,
        role: 'superadmin',
      })
    ).rejects.toThrow(BugCaseWorkflowError);

    // Slot 13 requires CHILD_SENSITIVE and blocks public_approved
    await expect(
      intakeBugCase({
        db,
        actor: starterActor,
        programId: 'mw:bug-program:slot-13',
        caseId: 'mw:bug-case:synth-013-bad',
        title: 'Bad slot 13',
        classification: 'INTERNAL',
        synthetic: true,
        summary: 'Must fail.',
        idempotencyKey: 'bug-intake-013-bad',
      })
    ).rejects.toThrow(BugCaseWorkflowError);

    await intakeBugCase({
      db,
      actor: starterActor,
      programId: 'mw:bug-program:slot-13',
      caseId: 'mw:bug-case:synth-013',
      title: 'Synthetic protected slot 13',
      classification: 'CHILD_SENSITIVE',
      synthetic: true,
      summary: 'Synthetic child safety case.',
      idempotencyKey: 'bug-intake-013',
    });
    await expect(
      updateBugCasePublicationStatus({
        db,
        actor: verifierActor,
        caseId: 'mw:bug-case:synth-013',
        nextPublicationStatus: 'public_approved',
        expectedRevision: 1,
        publicationDecisionRef: 'synthetic:pub-decision:013',
      })
    ).rejects.toThrow(BugCaseWorkflowError);

    // Generic base.group_user access denied for both new models
    const userGroup = await db('access_groups').where({ code: 'user' }).first('id');
    const accessRows = await ModelAccess.query()
      .where({ group_id: userGroup?.id })
      .whereIn('model_name', [BugCaseRecord.modelName, BugCaseActionOutcomeEvent.modelName]);
    expect(accessRows).toHaveLength(2);
    for (const row of accessRows) {
      expect(row).toMatchObject({ read: false, create: false, write: false, unlink: false });
    }
  });
});
