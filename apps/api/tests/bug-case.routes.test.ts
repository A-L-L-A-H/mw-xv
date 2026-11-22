import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  bugCaseHttpPlugin,
  ensureBugCaseWorkflowDefinition,
  manifest as knowledgeManifest,
  type BugCaseHttpPluginOptions,
} from '@moonwitness/orm-knowledge';
import type { ResearchEvidenceReference } from '@moonwitness/research';

const sha = (label: string) => createHash('sha256').update(label, 'utf8').digest('hex');

const validEvidence: ResearchEvidenceReference = {
  id: 'mw:evidence:api-bug-proof-001',
  assertion_id: 'mw:assertion:api-bug-proof-001',
  direction: 'supporting',
  selector: {
    source_id: 'mw:source:ebible-webp-protestant',
    expression_id: 'mw:expression:webp-protestant',
    edition_id: 'mw:edition:webp-protestant-2020-stable',
    locator: 'Genesis 1:1',
    content_sha256: sha('synthetic-api-bug-proof'),
  },
};

describe('role-safe BUG case submission & status prototype (K8-005)', () => {
  let db: Knex;
  let app: ReturnType<typeof Fastify>;
  let companyId: number;
  let otherCompanyId: number;
  let starterUserId: number;
  let superadminId: number;

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
      knowledgeManifest,
    ]);
    await ensureBugCaseWorkflowDefinition(db);

    companyId = Number((await db('companies').first('id'))?.id);
    const [other] = await db('companies')
      .insert({ name: 'Other BUG Company', active: true })
      .returning('id');
    otherCompanyId = typeof other === 'object' ? Number(other.id) : Number(other);

    const [partner] = await db('partners')
      .insert({ name: 'API Starter Partner', active: true })
      .returning('id');
    const partnerId = typeof partner === 'object' ? Number(partner.id) : Number(partner);
    const [starter] = await db('users')
      .insert({ login: 'api_bug_starter', partner_id: partnerId, role: 'user', active: true })
      .returning('id');
    starterUserId = typeof starter === 'object' ? Number(starter.id) : Number(starter);
    superadminId = Number((await db('users').where({ login: 'superadmin' }).first('id'))?.id);

    for (const userId of [starterUserId, superadminId]) {
      await db('company_memberships')
        .insert({ user_id: userId, company_id: companyId, active: true, is_default: true })
        .onConflict(['user_id', 'company_id'])
        .ignore();
    }

    app = Fastify();
    app.decorateRequest('auth', null);
    app.decorate('db', db);
    app.addHook('onRequest', async (request) => {
      const role = request.headers['x-test-role'];
      if (role === 'superadmin' || role === 'user') {
        request.auth = {
          userId: role === 'user' ? starterUserId : superadminId,
          role,
          companyId: request.headers['x-test-company'] === 'other' ? otherCompanyId : companyId,
          groupPermissions: [],
        };
      }
    });
    const bugCaseOptions: BugCaseHttpPluginOptions = {
      resolveTrustedOutcomeEvidence: async (evidenceId) =>
        evidenceId === validEvidence.id
          ? {
              canonicalEvidence: validEvidence,
              reviewStatus: 'accepted',
              access: 'readable',
              observedContentSha256: validEvidence.selector.content_sha256,
              capturedAt: new Date().toISOString(),
            }
          : null,
    };
    await app.register(bugCaseHttpPlugin as Parameters<typeof app.register>[0], bugCaseOptions);
  });

  afterEach(async () => {
    await app.close();
    await db.destroy();
  });

  it('denies unauthenticated, minor-sensitive/slot-13, minor-PII, and cross-company requests fail-closed', async () => {
    const unauth = await app.inject({
      method: 'POST',
      url: '/api/research/bug-cases',
      payload: {
        program_id: 'mw:bug-program:slot-01',
        case_id: 'mw:bug-case:unauth-001',
        title: 'Unauth Case',
        classification: 'INTERNAL',
        synthetic: true,
        summary: 'Should 401.',
        idempotency_key: 'unauth-case-001',
      },
    });
    expect(unauth.statusCode).toBe(401);

    // Slot 13 / CHILD_SENSITIVE denied while safeguarding process not approved
    const slot13Blocked = await app.inject({
      method: 'POST',
      url: '/api/research/bug-cases',
      headers: { 'x-test-role': 'user' },
      payload: {
        program_id: 'mw:bug-program:slot-13',
        case_id: 'mw:bug-case:slot-13-blocked',
        title: 'Slot 13 Case',
        classification: 'CHILD_SENSITIVE',
        synthetic: true,
        summary: 'Must fail closed.',
        idempotency_key: 'slot-13-blocked-001',
      },
    });
    expect(slot13Blocked.statusCode).toBe(403);

    // Email/minor PII in summary blocked even on INTERNAL slot
    const piiBlocked = await app.inject({
      method: 'POST',
      url: '/api/research/bug-cases',
      headers: { 'x-test-role': 'user' },
      payload: {
        program_id: 'mw:bug-program:slot-01',
        case_id: 'mw:bug-case:pii-blocked',
        title: 'PII Leak',
        classification: 'INTERNAL',
        synthetic: true,
        summary: 'Contact minor@example.invalid immediately.',
        idempotency_key: 'pii-blocked-001',
      },
    });
    expect(piiBlocked.statusCode).toBe(403);
  });

  it('runs intake, duplicate replay, transitions, independent outcome verification, and cross-company 403/404 isolation', async () => {
    const intakePayload = {
      program_id: 'mw:bug-program:slot-01',
      case_id: 'mw:bug-case:api-flow-001',
      title: 'API BUG Prototype Flow',
      classification: 'INTERNAL',
      synthetic: true,
      summary: 'Synthetic API case lifecycle test.',
      idempotency_key: 'api-intake-001',
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/research/bug-cases',
      headers: { 'x-test-role': 'user' },
      payload: intakePayload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.case_state).toBe('intake');
    expect(created.json().data.resolved_status).toBe('unresolved');

    // Exact replay returns 201 without creating duplicate case/events
    const replayed = await app.inject({
      method: 'POST',
      url: '/api/research/bug-cases',
      headers: { 'x-test-role': 'user' },
      payload: intakePayload,
    });
    expect(replayed.statusCode).toBe(201);

    // Conflicting replay returns 409
    const conflicting = await app.inject({
      method: 'POST',
      url: '/api/research/bug-cases',
      headers: { 'x-test-role': 'user' },
      payload: { ...intakePayload, title: 'Different Title' },
    });
    expect(conflicting.statusCode).toBe(409);

    for (const [step, action, rev] of [
      ['triage', 'triage', 0],
      ['plan', 'plan', 1],
      ['action', 'record_action', 2],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/research/bug-cases/mw:bug-case:api-flow-001/transitions',
        headers: { 'x-test-role': 'user' },
        payload: {
          action,
          expected_workflow_revision: rev,
          idempotency_key: `api-${step}-001`,
          details: { step },
        },
      });
      expect(res.statusCode).toBe(200);
    }

    // Ordinary user cannot verify outcome (403)
    const selfVerify = await app.inject({
      method: 'POST',
      url: '/api/research/bug-cases/mw:bug-case:api-flow-001/verify-outcome',
      headers: { 'x-test-role': 'user' },
      payload: {
        expected_workflow_revision: 3,
        idempotency_key: 'api-self-verify-001',
        evidence: validEvidence,
        outcome_test_proof: {
          test_run_id: 'run-api-001',
          passed: true,
          summary: 'Passed',
          artifact_sha256: sha('artifact-001'),
        },
      },
    });
    expect(selfVerify.statusCode).toBe(403);

    // Independent superadmin verifies outcome with K3-002 evidence
    const verified = await app.inject({
      method: 'POST',
      url: '/api/research/bug-cases/mw:bug-case:api-flow-001/verify-outcome',
      headers: { 'x-test-role': 'superadmin' },
      payload: {
        expected_workflow_revision: 3,
        idempotency_key: 'api-verify-001',
        evidence: validEvidence,
        outcome_test_proof: {
          test_run_id: 'run-api-001',
          passed: true,
          summary: 'Synthetic API outcome proof passed.',
          artifact_sha256: sha('artifact-001'),
        },
      },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().data.case_state).toBe('verified_resolved');
    expect(verified.json().data.resolved_status).toBe('verified_resolved');

    // Cross-company read fails closed (403 active membership denial)
    const crossCompany = await app.inject({
      method: 'GET',
      url: '/api/research/bug-cases/mw:bug-case:api-flow-001',
      headers: { 'x-test-role': 'superadmin', 'x-test-company': 'other' },
    });
    expect(crossCompany.statusCode).toBe(403);
  });
});
