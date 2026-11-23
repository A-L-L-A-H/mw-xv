import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AccessGroup,
  Company,
  CompanyMembership,
  GroupMembership,
  Partner,
  User,
} from '@moonwitness/orm-base';
import { WorkContract } from '@moonwitness/orm-ai';
import {
  Project,
  ProjectStage,
  ProjectTask,
  ProjectTaskDependency,
} from '@moonwitness/orm-project';
import { LocalFileAttachmentStorage } from '@moonwitness/orm-storage';
import { buildApp } from '../src/app.js';

const SUPERADMIN_PASSWORD = 'test-superadmin-password-123';
const USER_PASSWORD = 'test-operator-password-123';
const JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long-123';

function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('M13.09 & M13.10 Run Start Gates and Proof Gate v2', () => {
  let db: Knex;
  let app: FastifyInstance;
  let storageDir: string;
  let attachmentStorage: LocalFileAttachmentStorage;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_TO_FILE = 'false';

    storageDir = await mkdtemp(join(tmpdir(), 'mw-api-m13-gates-'));
    attachmentStorage = new LocalFileAttachmentStorage(storageDir);
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        afterCreate(
          conn: { pragma(sql: string): unknown },
          done: (err: Error | null, conn: unknown) => void
        ) {
          conn.pragma('foreign_keys = ON');
          done(null, conn);
        },
      },
    });

    app = await buildApp({
      db,
      superadminPassword: SUPERADMIN_PASSWORD,
      jwtSecret: JWT_SECRET,
      loginRateMax: 1000,
      attachmentStorage,
      attachmentScanner: null,
      checkWhatsAppGateway: async () => true,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    await db?.destroy();
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  async function createTenantOperator(companyName: string, login: string, companyId?: number) {
    const company = companyId
      ? await Company.query().findById(companyId)
      : await Company.query().insertAndFetch({ name: companyName });
    if (!company) {
      throw new Error('Company not found');
    }
    const partner = await Partner.query().insertAndFetch({
      name: `${company.name} ${login}`,
      company_id: company.id,
    });
    const user = await User.query().insertAndFetch({
      login,
      password: USER_PASSWORD,
      role: 'user',
      partner_id: partner.id,
    });
    await CompanyMembership.query().insert({
      user_id: user.id,
      company_id: company.id,
      is_default: true,
    });
    const userGroup = await AccessGroup.query().findOne({ code: 'user' });
    if (userGroup) {
      await GroupMembership.query().insert({
        user_id: user.id,
        group_id: userGroup.id,
      });
    }
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login, password: USER_PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    const token = (loginRes.json() as { data: { access_token: string } }).data.access_token;
    return {
      company,
      user,
      headers: {
        authorization: `Bearer ${token}`,
        'x-company-id': String(company.id),
      },
    };
  }

  async function setupContractFixtures(headers: Record<string, string>, scopeJson = '{}') {
    const agentRes = await app.inject({
      method: 'POST',
      url: '/api/ai/agents',
      headers,
      payload: {
        name: 'Gate Worker Agent',
        code: `worker_${randomUUID().slice(0, 8)}`,
        status: 'active',
      },
    });
    expect(agentRes.statusCode).toBe(201);
    const agentId = (agentRes.json() as { data: { id: number } }).data.id;

    const contractRes = await app.inject({
      method: 'POST',
      url: '/api/ai/work-contracts',
      headers,
      payload: {
        title: 'M13 Gate Contract',
        objective: 'Verify M13.09 and M13.10 gates',
        scope_json: scopeJson,
        assigned_agent_id: agentId,
        criteria: [{ code: 'unit_tests', title: 'Unit tests pass', mandatory: true }],
      },
    });
    expect(contractRes.statusCode).toBe(201);
    const contractId = (contractRes.json() as { data: { id: number } }).data.id;

    const grantRes = await app.inject({
      method: 'POST',
      url: '/api/ai/grants',
      headers,
      payload: {
        agent_id: agentId,
        work_contract_id: contractId,
        capability: 'repo.write@v1',
      },
    });
    expect(grantRes.statusCode).toBe(201);
    const grantId = (grantRes.json() as { data: { id: number } }).data.id;

    return { agentId, contractId, grantId };
  }

  it('M13.09: enforces DAG readiness, terminal contract guard, execution packet, and worktree lease invariants on POST /api/ai/runs', async () => {
    const operator = await createTenantOperator('M13 Run Gate Corp', 'm13_run_op');
    const { agentId, contractId, grantId } = await setupContractFixtures(operator.headers);

    const project = await Project.query().insertAndFetch({
      company_id: operator.company.id,
      code: 'm13_proj',
      name: 'M13 Gate Project',
      status: 'active',
    });
    const stage = await ProjectStage.query().insertAndFetch({
      company_id: operator.company.id,
      project_id: project.id,
      code: 'todo',
      name: 'To Do',
      sequence: 1,
    });
    const blockerTask = await ProjectTask.query().insertAndFetch({
      company_id: operator.company.id,
      project_id: project.id,
      stage_id: stage.id,
      code: 'M13_BLOCKER',
      title: 'Prerequisite task',
      status: 'in_progress',
      priority: 'high',
    });
    const targetTask = await ProjectTask.query().insertAndFetch({
      company_id: operator.company.id,
      project_id: project.id,
      stage_id: stage.id,
      code: 'M13_TARGET',
      title: 'Dependent task',
      status: 'backlog',
      priority: 'high',
    });
    await ProjectTaskDependency.query().insert({
      company_id: operator.company.id,
      task_id: targetTask.id,
      depends_on_id: blockerTask.id,
      kind: 'blocks',
    });

    await WorkContract.query().patchAndFetchById(contractId, {
      source_model: ProjectTask.modelName,
      source_id: targetTask.id,
    });

    // Blocked by unresolved DAG dependency -> 409 PROJECT_TASK_NOT_READY
    const blockedRes = await app.inject({
      method: 'POST',
      url: '/api/ai/runs',
      headers: operator.headers,
      payload: {
        agent_id: agentId,
        work_contract_id: contractId,
        capability_grant_id: grantId,
      },
    });
    expect(blockedRes.statusCode).toBe(409);
    const blockedBody = blockedRes.json() as { code: string; blockedByTaskIds: number[] };
    expect(blockedBody.code).toBe('PROJECT_TASK_NOT_READY');
    expect(blockedBody.blockedByTaskIds).toContain(blockerTask.id);

    // Resolve blocker -> task becomes ready
    await ProjectTask.query().patchAndFetchById(blockerTask.id, { status: 'done' });

    // Invalid execution_packet -> 422 INVALID_EXECUTION_PACKET
    const badPacketRes = await app.inject({
      method: 'POST',
      url: '/api/ai/runs',
      headers: operator.headers,
      payload: {
        agent_id: agentId,
        work_contract_id: contractId,
        capability_grant_id: grantId,
        execution_packet: { contentSha256: 'not-a-sha', workContractId: contractId },
      },
    });
    expect(badPacketRes.statusCode).toBe(422);
    expect((badPacketRes.json() as { code: string }).code).toBe('INVALID_EXECUTION_PACKET');

    // Expired worktree_lease -> 409 WORKTREE_LEASE_EXPIRED
    const expiredLeaseRes = await app.inject({
      method: 'POST',
      url: '/api/ai/runs',
      headers: operator.headers,
      payload: {
        agent_id: agentId,
        work_contract_id: contractId,
        capability_grant_id: grantId,
        worktree_lease: {
          fencingToken: 2,
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          allowedPaths: ['apps/api/src'],
        },
      },
    });
    expect(expiredLeaseRes.statusCode).toBe(409);
    expect((expiredLeaseRes.json() as { code: string }).code).toBe('WORKTREE_LEASE_EXPIRED');

    // Unsafe worktree_lease allowedPaths -> 422 INVALID_WORKTREE_LEASE_SCOPE
    const unsafeLeaseRes = await app.inject({
      method: 'POST',
      url: '/api/ai/runs',
      headers: operator.headers,
      payload: {
        agent_id: agentId,
        work_contract_id: contractId,
        capability_grant_id: grantId,
        worktree_lease: {
          fencingToken: 2,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          allowedPaths: ['../secrets/.env'],
        },
      },
    });
    expect(unsafeLeaseRes.statusCode).toBe(422);
    expect((unsafeLeaseRes.json() as { code: string }).code).toBe('INVALID_WORKTREE_LEASE_SCOPE');

    // Valid execution_packet + worktree_lease -> 201 with persisted fencing_token
    const validRunRes = await app.inject({
      method: 'POST',
      url: '/api/ai/runs',
      headers: operator.headers,
      payload: {
        agent_id: agentId,
        work_contract_id: contractId,
        capability_grant_id: grantId,
        execution_packet: {
          contentSha256: sha256Hex('execution-packet-v1'),
          workContractId: contractId,
        },
        worktree_lease: {
          companyId: operator.company.id,
          fencingToken: 3,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          allowedPaths: ['apps/api/src'],
        },
      },
    });
    expect(validRunRes.statusCode).toBe(201);
    expect((validRunRes.json() as { data: { fencing_token: number } }).data.fencing_token).toBe(3);

    // Stale fencingToken -> 409 STALE_FENCING_TOKEN
    const staleLeaseRes = await app.inject({
      method: 'POST',
      url: '/api/ai/runs',
      headers: operator.headers,
      payload: {
        agent_id: agentId,
        work_contract_id: contractId,
        capability_grant_id: grantId,
        worktree_lease: {
          fencingToken: 2,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          allowedPaths: ['apps/api/src'],
        },
      },
    });
    expect(staleLeaseRes.statusCode).toBe(409);
    expect((staleLeaseRes.json() as { code: string }).code).toBe('STALE_FENCING_TOKEN');

    // Terminal contract cannot start new run -> 409 WORK_CONTRACT_NOT_EXECUTABLE
    await WorkContract.query().patchAndFetchById(contractId, { status: 'accepted' });
    const terminalRes = await app.inject({
      method: 'POST',
      url: '/api/ai/runs',
      headers: operator.headers,
      payload: {
        agent_id: agentId,
        work_contract_id: contractId,
        capability_grant_id: grantId,
      },
    });
    expect(terminalRes.statusCode).toBe(409);
    expect((terminalRes.json() as { code: string }).code).toBe('WORK_CONTRACT_NOT_EXECUTABLE');
  });

  it('M13.10: enforces Proof Gate v2 on POST /api/ai/work-contracts/:id/verify and preserves backwards compatibility', async () => {
    const requester = await createTenantOperator('M13 Verify Corp', 'm13_req');
    const reviewer = await createTenantOperator('M13 Verify Corp', 'm13_rev', requester.company.id);

    const { contractId } = await setupContractFixtures(
      requester.headers,
      JSON.stringify({ allowedPaths: ['apps/api/src/routes'] })
    );

    const artifactContent = JSON.stringify({ result: 'passed' });
    const artifactRes = await app.inject({
      method: 'POST',
      url: '/api/ai/artifacts',
      headers: requester.headers,
      payload: {
        work_contract_id: contractId,
        content: artifactContent,
        sha256: sha256Hex(artifactContent),
      },
    });
    expect(artifactRes.statusCode).toBe(201);

    // Failed check -> 422 PROOF_CHECK_FAILED
    const failedCheckRes = await app.inject({
      method: 'POST',
      url: `/api/ai/work-contracts/${contractId}/verify`,
      headers: reviewer.headers,
      payload: {
        checks: [{ code: 'vitest', status: 'fail', mandatory: true }],
      },
    });
    expect(failedCheckRes.statusCode).toBe(422);
    expect((failedCheckRes.json() as { code: string }).code).toBe('PROOF_CHECK_FAILED');

    // Skipped check without reason -> 422 MISSING_SKIP_REASON
    const missingSkipRes = await app.inject({
      method: 'POST',
      url: `/api/ai/work-contracts/${contractId}/verify`,
      headers: reviewer.headers,
      payload: {
        checks: [{ code: 'e2e', status: 'skipped', mandatory: false }],
      },
    });
    expect(missingSkipRes.statusCode).toBe(422);
    expect((missingSkipRes.json() as { code: string }).code).toBe('MISSING_SKIP_REASON');

    // Mandatory check not_run -> 422 MANDATORY_CHECK_NOT_PASSED
    const notRunRes = await app.inject({
      method: 'POST',
      url: `/api/ai/work-contracts/${contractId}/verify`,
      headers: reviewer.headers,
      payload: {
        checks: [{ code: 'typecheck', status: 'not_run', mandatory: true }],
      },
    });
    expect(notRunRes.statusCode).toBe(422);
    expect((notRunRes.json() as { code: string }).code).toBe('MANDATORY_CHECK_NOT_PASSED');

    // Out-of-scope changed_files -> 422 OUT_OF_SCOPE_DIFF_DETECTED
    const driftRes = await app.inject({
      method: 'POST',
      url: `/api/ai/work-contracts/${contractId}/verify`,
      headers: reviewer.headers,
      payload: {
        checks: [{ code: 'vitest', status: 'pass', mandatory: true }],
        changed_files: [
          'apps/api/src/routes/ai-corporation.routes.ts',
          'apps/board/src/app/page.tsx',
        ],
      },
    });
    expect(driftRes.statusCode).toBe(422);
    expect((driftRes.json() as { code: string }).code).toBe('OUT_OF_SCOPE_DIFF_DETECTED');

    // Valid Proof Gate v2 payload -> 200 accepted
    const passRes = await app.inject({
      method: 'POST',
      url: `/api/ai/work-contracts/${contractId}/verify`,
      headers: reviewer.headers,
      payload: {
        checks: [
          { code: 'vitest', status: 'pass', mandatory: true },
          { code: 'e2e', status: 'skipped', mandatory: false, reason: 'No UI files changed' },
        ],
        changed_files: ['apps/api/src/routes/ai-corporation.routes.ts'],
      },
    });
    expect(passRes.statusCode).toBe(200);
    expect((passRes.json() as { data: { status: string } }).data.status).toBe('accepted');
  });

  it('M13.10: enforces Proof Gate v2 and server-only accepted authority on POST /api/ai/desktop/pcw-sync', async () => {
    const operator = await createTenantOperator('M13 Desktop Sync Corp', 'm13_sync_op');
    const { agentId, contractId } = await setupContractFixtures(
      operator.headers,
      JSON.stringify({ allowedPaths: ['apps/api/src'] })
    );

    const content = JSON.stringify({ ok: true });
    const artifact = {
      storageKey: randomUUID(),
      artifactKind: 'evidence_bundle',
      sha256: sha256Hex(content),
      sizeBytes: Buffer.byteLength(content),
      mimeType: 'application/json',
      content,
    };

    // Server-only accepted authority -> 403
    const selfAcceptRes = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/pcw-sync',
      headers: operator.headers,
      payload: {
        workContractId: contractId,
        agentId,
        fencingToken: 1,
        proofGate: { status: 'accepted' },
        artifacts: [artifact],
      },
    });
    expect(selfAcceptRes.statusCode).toBe(403);

    // Failed check -> 422 PROOF_CHECK_FAILED (contract stays draft)
    const failedSyncRes = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/pcw-sync',
      headers: operator.headers,
      payload: {
        workContractId: contractId,
        agentId,
        fencingToken: 1,
        checks: [{ code: 'lint', status: 'fail', mandatory: true }],
        artifacts: [artifact],
      },
    });
    expect(failedSyncRes.statusCode).toBe(422);
    expect((failedSyncRes.json() as { code: string }).code).toBe('PROOF_CHECK_FAILED');

    // Out-of-scope file -> 422 OUT_OF_SCOPE_DIFF_DETECTED
    const driftSyncRes = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/pcw-sync',
      headers: operator.headers,
      payload: {
        workContractId: contractId,
        agentId,
        fencingToken: 1,
        checks: [{ code: 'lint', status: 'pass', mandatory: true }],
        changed_files: ['apps/api/src/routes/ai-desktop-sync.routes.ts', '.env.local'],
        artifacts: [artifact],
      },
    });
    expect(driftSyncRes.statusCode).toBe(422);
    expect((driftSyncRes.json() as { code: string }).code).toBe('OUT_OF_SCOPE_DIFF_DETECTED');

    // Contract must still be draft (not in_review or accepted)
    const contractAfterReject = await WorkContract.query().findById(contractId);
    expect(contractAfterReject?.status).toBe('draft');

    // Valid Proof Gate v2 sync -> 200 and contract transitions to in_review (never accepted)
    const okSyncRes = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/pcw-sync',
      headers: operator.headers,
      payload: {
        workContractId: contractId,
        agentId,
        fencingToken: 1,
        checks: [{ code: 'lint', status: 'pass', mandatory: true }],
        changed_files: ['apps/api/src/routes/ai-desktop-sync.routes.ts'],
        artifacts: [artifact],
      },
    });
    expect(okSyncRes.statusCode).toBe(200);
    const contractAfterOk = await WorkContract.query().findById(contractId);
    expect(contractAfterOk?.status).toBe('in_review');
  });
});
