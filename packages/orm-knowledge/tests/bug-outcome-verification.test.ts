import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import type { ResearchEvidenceReference } from '@moonwitness/research';
import {
  ensureBugCaseWorkflowDefinition,
  intakeBugCase,
  manifest,
  reopenBugCaseOnEvidenceChange,
  transitionBugCaseWorkflow,
  updateBugCasePublicationStatus,
  verifyBugCaseOutcomeWithEvidence,
  type AuthenticatedBugCaseActor,
  type BugOutcomeVerificationError,
  type TrustedBugOutcomeEvidenceResolution,
} from '../src/index.js';

const sha = (label: string) => createHash('sha256').update(label, 'utf8').digest('hex');

const validEvidence: ResearchEvidenceReference = {
  id: 'mw:evidence:outcome-proof-001',
  assertion_id: 'mw:assertion:outcome-proof-001',
  direction: 'supporting',
  selector: {
    source_id: 'mw:source:ebible-webp-protestant',
    expression_id: 'mw:expression:webp-protestant',
    edition_id: 'mw:edition:webp-protestant-2020-stable',
    locator: 'Genesis 1:1',
    content_sha256: sha('synthetic-outcome-evidence-bytes'),
  },
};

function makeTrustedResolution(
  overrides: Partial<TrustedBugOutcomeEvidenceResolution> = {}
): TrustedBugOutcomeEvidenceResolution {
  return {
    canonicalEvidence: validEvidence,
    reviewStatus: 'accepted',
    access: 'readable',
    observedContentSha256: validEvidence.selector.content_sha256,
    capturedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('evidence-backed BUG outcome verification and reopen', () => {
  let db: Knex;
  let companyId: number;
  let starterActor: AuthenticatedBugCaseActor;
  let reviewerActor: AuthenticatedBugCaseActor;

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

    companyId = Number((await db('companies').first('id'))?.id);
    const [starterPartner] = await db('partners')
      .insert({ name: 'Outcome Starter Partner', active: true })
      .returning('id');
    const starterPartnerId =
      typeof starterPartner === 'object' ? Number(starterPartner.id) : Number(starterPartner);
    const [starterRow] = await db('users')
      .insert({
        login: 'outcome_starter',
        partner_id: starterPartnerId,
        role: 'user',
        active: true,
      })
      .returning('id');
    const starterUserId =
      typeof starterRow === 'object' ? Number(starterRow.id) : Number(starterRow);
    const reviewerRow = await db('users').where({ login: 'superadmin' }).first('id');

    starterActor = { userId: starterUserId, companyId, role: 'user' };
    reviewerActor = { userId: Number(reviewerRow?.id), companyId, role: 'superadmin' };

    for (const userId of [starterActor.userId, reviewerActor.userId]) {
      await db('company_memberships')
        .insert({ user_id: userId, company_id: companyId, active: true, is_default: true })
        .onConflict(['user_id', 'company_id'])
        .ignore();
    }
  });

  afterEach(async () => db.destroy());

  async function advanceToActionRecorded(caseId: `mw:bug-case:${string}`) {
    await intakeBugCase({
      db,
      actor: starterActor,
      programId: 'mw:bug-program:slot-05',
      caseId,
      title: 'Synthetic outcome verification case',
      classification: 'INTERNAL',
      synthetic: true,
      summary: 'Test case for outcome verification.',
      idempotencyKey: `intake-${caseId}`,
    });
    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId,
      action: 'triage',
      expectedWorkflowRevision: 0,
      idempotencyKey: `triage-${caseId}`,
      details: { stage: 'triaged' },
    });
    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId,
      action: 'plan',
      expectedWorkflowRevision: 1,
      idempotencyKey: `plan-${caseId}`,
      details: { stage: 'planned' },
    });
    await transitionBugCaseWorkflow({
      db,
      actor: starterActor,
      caseId,
      action: 'record_action',
      expectedWorkflowRevision: 2,
      idempotencyKey: `action-${caseId}`,
      details: { stage: 'action_recorded' },
    });
  }

  it('verifies outcome with fresh, accepted, digest-matched evidence and passing test proof, and reopens on stale/tampered evidence', async () => {
    const caseId = 'mw:bug-case:outcome-001' as const;
    await advanceToActionRecorded(caseId);

    const verified = await verifyBugCaseOutcomeWithEvidence({
      db,
      actor: reviewerActor,
      caseId,
      expectedWorkflowRevision: 3,
      idempotencyKey: 'verify-outcome-001',
      evidence: validEvidence,
      resolveTrustedEvidence: async () => makeTrustedResolution(),
      outcomeTestProof: {
        test_run_id: 'synthetic-run-001',
        passed: true,
        summary: 'Synthetic verification test passed.',
        artifact_sha256: sha('synthetic-test-artifact'),
      },
      now: new Date('2026-11-21T00:00:00.000Z'),
    });

    expect(verified.bugCase.case_state).toBe('verified_resolved');
    expect(verified.bugCase.resolved_status).toBe('verified_resolved');
    expect(verified.bugCase.publication_status).toBe('unpublished');

    // Fresh check when evidence is still valid -> does not reopen
    const stillValid = await reopenBugCaseOnEvidenceChange({
      db,
      actor: reviewerActor,
      caseId,
      expectedWorkflowRevision: 4,
      idempotencyKey: 'reopen-check-still-valid',
      resolveTrustedEvidence: async () => makeTrustedResolution(),
      maxEvidenceAgeHours: 48,
      now: new Date('2026-11-21T00:00:00.000Z'),
    });
    expect(stillValid.reopened).toBe(false);

    // Tampered digest detected -> reopens case cleanly
    const reopened = await reopenBugCaseOnEvidenceChange({
      db,
      actor: reviewerActor,
      caseId,
      expectedWorkflowRevision: 4,
      idempotencyKey: 'reopen-on-tampered-001',
      resolveTrustedEvidence: async () =>
        makeTrustedResolution({ observedContentSha256: sha('tampered-bytes') }),
      now: new Date('2026-11-21T00:00:00.000Z'),
    });
    expect(reopened.reopened).toBe(true);
    expect(reopened.reason).toBe('tampered_evidence_digest');
    expect(reopened.history.bugCase.case_state).toBe('reopened');
    expect(reopened.history.bugCase.resolved_status).toBe('reopened');
  });

  it('rejects story posting closure, missing/tampered/unreviewed/stale evidence, failed test proof, and self-verification', async () => {
    const storyCaseId = 'mw:bug-case:outcome-story-002' as const;
    await intakeBugCase({
      db,
      actor: starterActor,
      programId: 'mw:bug-program:slot-06',
      caseId: storyCaseId,
      title: 'Story submission cannot close BUG',
      classification: 'INTERNAL',
      synthetic: true,
      summary: 'Editorial publication does not resolve BUG.',
      idempotencyKey: `intake-${storyCaseId}`,
    });

    const storyPublished = await updateBugCasePublicationStatus({
      db,
      actor: reviewerActor,
      caseId: storyCaseId,
      nextPublicationStatus: 'public_approved',
      expectedRevision: 1,
      publicationDecisionRef: 'synthetic:story-pub-002',
    });
    expect(storyPublished.publication_status).toBe('public_approved');
    expect(storyPublished.resolved_status).toBe('unresolved');

    // Cannot verify_outcome directly from intake
    await expect(
      verifyBugCaseOutcomeWithEvidence({
        db,
        actor: reviewerActor,
        caseId: storyCaseId,
        expectedWorkflowRevision: 0,
        idempotencyKey: 'premature-verify-002',
        evidence: validEvidence,
        resolveTrustedEvidence: async () => makeTrustedResolution(),
        outcomeTestProof: {
          test_run_id: 'run-1',
          passed: true,
          summary: 'ok',
          artifact_sha256: sha('art'),
        },
        now: new Date('2026-11-21T00:00:00.000Z'),
      })
    ).rejects.toThrow();

    const caseId = 'mw:bug-case:outcome-neg-003' as const;
    await advanceToActionRecorded(caseId);

    // Missing evidence
    await expect(
      verifyBugCaseOutcomeWithEvidence({
        db,
        actor: reviewerActor,
        caseId,
        expectedWorkflowRevision: 3,
        idempotencyKey: 'verify-missing-003',
        evidence: validEvidence,
        resolveTrustedEvidence: async () => null,
        outcomeTestProof: {
          test_run_id: 'run-1',
          passed: true,
          summary: 'ok',
          artifact_sha256: sha('art'),
        },
        now: new Date('2026-11-21T00:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      code: 'MISSING_EVIDENCE',
    } satisfies Partial<BugOutcomeVerificationError>);

    // Unreviewed evidence
    await expect(
      verifyBugCaseOutcomeWithEvidence({
        db,
        actor: reviewerActor,
        caseId,
        expectedWorkflowRevision: 3,
        idempotencyKey: 'verify-unreviewed-003',
        evidence: validEvidence,
        resolveTrustedEvidence: async () => makeTrustedResolution({ reviewStatus: 'unreviewed' }),
        outcomeTestProof: {
          test_run_id: 'run-1',
          passed: true,
          summary: 'ok',
          artifact_sha256: sha('art'),
        },
        now: new Date('2026-11-21T00:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      code: 'UNREVIEWED_EVIDENCE',
    } satisfies Partial<BugOutcomeVerificationError>);

    // Tampered evidence digest
    await expect(
      verifyBugCaseOutcomeWithEvidence({
        db,
        actor: reviewerActor,
        caseId,
        expectedWorkflowRevision: 3,
        idempotencyKey: 'verify-tampered-003',
        evidence: validEvidence,
        resolveTrustedEvidence: async () =>
          makeTrustedResolution({ observedContentSha256: sha('tampered') }),
        outcomeTestProof: {
          test_run_id: 'run-1',
          passed: true,
          summary: 'ok',
          artifact_sha256: sha('art'),
        },
        now: new Date('2026-11-21T00:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      code: 'TAMPERED_EVIDENCE',
    } satisfies Partial<BugOutcomeVerificationError>);

    // Stale evidence (> maxEvidenceAgeHours)
    await expect(
      verifyBugCaseOutcomeWithEvidence({
        db,
        actor: reviewerActor,
        caseId,
        expectedWorkflowRevision: 3,
        idempotencyKey: 'verify-stale-003',
        evidence: validEvidence,
        resolveTrustedEvidence: async () =>
          makeTrustedResolution({ capturedAt: '2026-01-01T00:00:00.000Z' }),
        outcomeTestProof: {
          test_run_id: 'run-1',
          passed: true,
          summary: 'ok',
          artifact_sha256: sha('art'),
        },
        maxEvidenceAgeHours: 24,
        now: new Date('2026-11-21T00:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      code: 'STALE_EVIDENCE',
    } satisfies Partial<BugOutcomeVerificationError>);

    // Failing test proof
    await expect(
      verifyBugCaseOutcomeWithEvidence({
        db,
        actor: reviewerActor,
        caseId,
        expectedWorkflowRevision: 3,
        idempotencyKey: 'verify-fail-test-003',
        evidence: validEvidence,
        resolveTrustedEvidence: async () => makeTrustedResolution(),
        outcomeTestProof: {
          test_run_id: 'run-1',
          passed: false,
          summary: 'Failed assertion.',
          artifact_sha256: sha('art'),
        },
        now: new Date('2026-11-21T00:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      code: 'OUTCOME_TEST_FAILED',
    } satisfies Partial<BugOutcomeVerificationError>);

    // Self-verification rejected
    await expect(
      verifyBugCaseOutcomeWithEvidence({
        db,
        actor: starterActor,
        caseId,
        expectedWorkflowRevision: 3,
        idempotencyKey: 'verify-self-003',
        evidence: validEvidence,
        resolveTrustedEvidence: async () => makeTrustedResolution(),
        outcomeTestProof: {
          test_run_id: 'run-1',
          passed: true,
          summary: 'ok',
          artifact_sha256: sha('art'),
        },
        now: new Date('2026-11-21T00:00:00.000Z'),
      })
    ).rejects.toThrow();
  });
});
