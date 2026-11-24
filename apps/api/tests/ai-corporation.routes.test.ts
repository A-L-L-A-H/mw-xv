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
import { LocalFileAttachmentStorage } from '@moonwitness/orm-storage';
import { buildApp } from '../src/app.js';

const SUPERADMIN_PASSWORD = 'test-superadmin-password-123';
const USER_PASSWORD = 'test-operator-password-123';
const JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long-123';

function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('AI Corporation & Desktop Sync API routes', () => {
  let db: Knex;
  let app: FastifyInstance;
  let storageDir: string;
  let attachmentStorage: LocalFileAttachmentStorage;
  let superadminToken: string;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_TO_FILE = 'false';

    storageDir = await mkdtemp(join(tmpdir(), 'mw-api-ai-routes-'));
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

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login: 'superadmin', password: SUPERADMIN_PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    superadminToken = (loginRes.json() as { data: { access_token: string } }).data.access_token;
  });

  afterEach(async () => {
    await app?.close();
    await db?.destroy();
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  async function createTenantOperator(companyName: string, login: string) {
    const company = await Company.query().insertAndFetch({ name: companyName });
    const partner = await Partner.query().insertAndFetch({
      name: `${companyName} ${login}`,
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
      token,
      headers: {
        authorization: `Bearer ${token}`,
        'x-company-id': String(company.id),
      },
    };
  }

  it('requires authentication and blocks generic REST and JSON-RPC for all ai.* models across all roles', async () => {
    const unauthRes = await app.inject({ method: 'GET', url: '/api/ai/agents' });
    expect(unauthRes.statusCode).toBe(401);

    const internalModels = [
      'ai.agent',
      'ai.agent_profile',
      'ai.provider_profile',
      'ai.model_profile',
      'ai.execution_policy',
      'ai.capability_grant',
      'ai.work_contract',
      'ai.acceptance_criterion',
      'ai.agent_run',
      'ai.artifact_manifest',
      'ai.obligation',
      'ai.taskforce',
      'ai.workforce_assignment',
      'ai.skill_version',
      'ai.memory_candidate',
    ];

    for (const model of internalModels) {
      const restGet = await app.inject({
        method: 'GET',
        url: `/api/${model}`,
        headers: { authorization: `Bearer ${superadminToken}` },
      });
      expect(restGet.statusCode).toBe(403);

      const restPost = await app.inject({
        method: 'POST',
        url: `/api/${model}`,
        headers: { authorization: `Bearer ${superadminToken}` },
        payload: { name: 'bypass' },
      });
      expect(restPost.statusCode).toBe(403);

      const rpcRes = await app.inject({
        method: 'POST',
        url: '/jsonrpc',
        headers: { authorization: `Bearer ${superadminToken}` },
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'call',
          params: {
            service: 'object',
            method: 'execute_kw',
            args: [model, 'search_read', [[]], {}],
          },
        },
      });
      expect(rpcRes.statusCode === 403 || rpcRes.json()?.error?.code === -32003).toBe(true);
    }

    const modelsCatalog = await app.inject({
      method: 'GET',
      url: '/api/models',
      headers: { authorization: `Bearer ${superadminToken}` },
    });
    expect(modelsCatalog.statusCode).toBe(200);
    expect(JSON.stringify(modelsCatalog.json())).not.toContain('ai.capability_grant');
  });

  it('enforces strict company isolation across Company A and Company B on /api/ai/* and /ai/*', async () => {
    const tenantA = await createTenantOperator('AI Tenant Alpha', 'op_alpha');
    const tenantB = await createTenantOperator('AI Tenant Beta', 'op_beta');

    const createAgentB = await app.inject({
      method: 'POST',
      url: '/api/ai/agents',
      headers: tenantB.headers,
      payload: { name: 'Beta Private Agent', code: 'beta_private_agent', status: 'active' },
    });
    expect(createAgentB.statusCode).toBe(201);
    const agentB = (createAgentB.json() as { data: { id: number; company_id: number } }).data;
    expect(agentB.company_id).toBe(tenantB.company.id);

    // Tenant A cannot list Tenant B's agent.
    const listA = await app.inject({
      method: 'GET',
      url: '/api/ai/agents',
      headers: tenantA.headers,
    });
    expect(listA.statusCode).toBe(200);
    const listedAgentsA = (listA.json() as { data: Array<{ id: number }> }).data;
    expect(listedAgentsA.some((a) => a.id === agentB.id)).toBe(false);

    // Tenant A cannot fetch or patch Tenant B's agent via /api/ai/agents/:id or /ai/agents/:id.
    const getCross1 = await app.inject({
      method: 'GET',
      url: `/api/ai/agents/${agentB.id}`,
      headers: tenantA.headers,
    });
    expect(getCross1.statusCode).toBe(404);

    const getCross2 = await app.inject({
      method: 'GET',
      url: `/ai/agents/${agentB.id}`,
      headers: tenantA.headers,
    });
    expect(getCross2.statusCode).toBe(404);

    const patchCross = await app.inject({
      method: 'PATCH',
      url: `/api/ai/agents/${agentB.id}`,
      headers: tenantA.headers,
      payload: { status: 'disabled' },
    });
    expect(patchCross.statusCode).toBe(404);

    // Tenant A cannot switch x-company-id header to Tenant B.
    const spoofHeader = await app.inject({
      method: 'GET',
      url: '/api/ai/agents',
      headers: {
        authorization: `Bearer ${tenantA.token}`,
        'x-company-id': String(tenantB.company.id),
      },
    });
    expect(spoofHeader.statusCode).toBe(403);

    // Tenant A cannot pass company_id in query or body targeting Tenant B.
    const spoofBody = await app.inject({
      method: 'POST',
      url: '/api/ai/agents',
      headers: tenantA.headers,
      payload: {
        company_id: tenantB.company.id,
        name: 'Spoofed Agent',
        code: 'spoofed_agent',
      },
    });
    expect(spoofBody.statusCode).toBe(403);
  });

  it('manages agents, providers, capability grants, work contracts, runs, PCW verification, obligations, memory, governance, and emergency stop', async () => {
    const operator = await createTenantOperator('AI Lifecycle Co', 'op_lifecycle');
    const reviewerPartner = await Partner.query().insertAndFetch({
      name: 'Independent Reviewer',
      company_id: operator.company.id,
    });
    const reviewerUser = await User.query().insertAndFetch({
      login: 'reviewer_lifecycle',
      password: USER_PASSWORD,
      role: 'user',
      partner_id: reviewerPartner.id,
    });
    await CompanyMembership.query().insert({
      user_id: reviewerUser.id,
      company_id: operator.company.id,
      is_default: true,
    });
    const reviewerLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login: 'reviewer_lifecycle', password: USER_PASSWORD },
    });
    const reviewerHeaders = {
      authorization: `Bearer ${(reviewerLogin.json() as { data: { access_token: string } }).data.access_token}`,
      'x-company-id': String(operator.company.id),
    };

    // 1. Provider creation rejects raw secret and accepts MW_AI_* reference.
    const badProviderRes = await app.inject({
      method: 'POST',
      url: '/api/ai/providers',
      headers: operator.headers,
      payload: {
        name: 'Unsafe Provider',
        code: 'unsafe_provider',
        kind: 'openai',
        secret_ref: ['sk', 'live', 'rawkey', '1234'].join('-'),
      },
    });
    expect(badProviderRes.statusCode).toBe(400);

    const goodProviderRes = await app.inject({
      method: 'POST',
      url: '/api/ai/providers',
      headers: operator.headers,
      payload: {
        name: 'Local Ollama',
        code: 'local_ollama',
        kind: 'ollama',
        endpoint_url: 'http://127.0.0.1:11434',
        secret_ref: 'MW_AI_OLLAMA_LOCAL',
        data_classification: 'local_only',
        enabled: true,
      },
    });
    expect(goodProviderRes.statusCode).toBe(201);
    expect(goodProviderRes.json().data.secret_masked).toBe('••••••••');

    // 2. Agent create & lifecycle transition.
    const workerRes = await app.inject({
      method: 'POST',
      url: '/api/ai/agents',
      headers: operator.headers,
      payload: { name: 'Worker Agent 1', code: 'worker_agent_1', status: 'draft' },
    });
    expect(workerRes.statusCode).toBe(201);
    const workerId = (workerRes.json() as { data: { id: number } }).data.id;

    const activateRes = await app.inject({
      method: 'PATCH',
      url: `/api/ai/agents/${workerId}`,
      headers: operator.headers,
      payload: { status: 'active' },
    });
    expect(activateRes.statusCode).toBe(200);
    expect(activateRes.json().data.status).toBe('active');

    // 3. Work contract with acceptance criterion & capability grant.
    const contractRes = await app.inject({
      method: 'POST',
      url: '/api/ai/work-contracts',
      headers: operator.headers,
      payload: {
        code: 'contract_audit_01',
        title: 'Audit Repository',
        objective: 'Produce SHA-256 verified inspection report',
        assigned_agent_id: workerId,
        risk_tier: 'R0',
        data_classification: 'local_only',
        criteria: [
          {
            code: 'crit_report',
            title: 'Source-backed report artifact',
            verification_method: 'automated_test',
            required_evidence_type: 'evidence_bundle',
            mandatory: true,
          },
        ],
      },
    });
    expect(contractRes.statusCode).toBe(201);
    const contract = contractRes.json().data as {
      id: number;
      criteria: Array<{ id: number }>;
    };
    expect(contract.criteria).toHaveLength(1);

    const grantRes = await app.inject({
      method: 'POST',
      url: '/api/ai/grants',
      headers: operator.headers,
      payload: {
        agent_id: workerId,
        work_contract_id: contract.id,
        capability: 'repo.read@v1',
      },
    });
    expect(grantRes.statusCode).toBe(201);
    const grantId = (grantRes.json() as { data: { id: number } }).data.id;

    // 4. Dispatch durable AgentRun correlated with @moonwitness/jobs.
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/ai/runs',
      headers: operator.headers,
      payload: {
        agent_id: workerId,
        work_contract_id: contract.id,
        capability_grant_id: grantId,
        idempotency_key: 'api-run-idem-01',
        correlation_id: 'corr-api-01',
      },
    });
    expect(runRes.statusCode).toBe(201);
    const run = runRes.json().data as { id: number; job_id: number };
    expect(run.job_id).toBeGreaterThan(0);

    // 5. Self-approval or verification without evidence is rejected.
    const selfVerifyRes = await app.inject({
      method: 'POST',
      url: `/api/ai/work-contracts/${contract.id}/verify`,
      headers: operator.headers,
      payload: {},
    });
    expect(selfVerifyRes.statusCode).toBe(403);

    const missingEvidenceVerifyRes = await app.inject({
      method: 'POST',
      url: `/api/ai/work-contracts/${contract.id}/verify`,
      headers: reviewerHeaders,
      payload: {},
    });
    expect(missingEvidenceVerifyRes.statusCode).toBe(400);

    // 6. Upload evidence artifact & verify independently.
    const reportContent = JSON.stringify({ summary: 'Verified clean architecture', findings: [] });
    const artifactRes = await app.inject({
      method: 'POST',
      url: '/api/ai/artifacts',
      headers: operator.headers,
      payload: {
        work_contract_id: contract.id,
        acceptance_criterion_id: contract.criteria[0]!.id,
        agent_run_id: run.id,
        producer_agent_id: workerId,
        artifact_kind: 'evidence_bundle',
        content: reportContent,
        sha256: sha256Hex(reportContent),
      },
    });
    expect(artifactRes.statusCode).toBe(201);
    const artifactId = (artifactRes.json() as { data: { id: number } }).data.id;

    const indepVerifyRes = await app.inject({
      method: 'POST',
      url: `/api/ai/work-contracts/${contract.id}/verify`,
      headers: reviewerHeaders,
      payload: {},
    });
    expect(indepVerifyRes.statusCode).toBe(200);
    expect(indepVerifyRes.json().data.status).toBe('accepted');

    // 7. Obligation creation & supersession rationale enforcement.
    const obRes = await app.inject({
      method: 'POST',
      url: '/api/ai/obligations',
      headers: operator.headers,
      payload: {
        code: 'ob_api_continuity',
        origin_contract_id: contract.id,
        origin_artifact_id: artifactId,
        owner_agent_id: workerId,
        trigger_kind: 'code_change',
        required_evidence: 'Re-run API verification suite',
      },
    });
    expect(obRes.statusCode).toBe(201);
    const obId = (obRes.json() as { data: { id: number } }).data.id;

    const badSupersede = await app.inject({
      method: 'PATCH',
      url: `/api/ai/obligations/${obId}`,
      headers: operator.headers,
      payload: { status: 'superseded' },
    });
    expect(badSupersede.statusCode).toBe(400);

    const goodSupersede = await app.inject({
      method: 'PATCH',
      url: `/api/ai/obligations/${obId}`,
      headers: operator.headers,
      payload: { status: 'superseded', decision_rationale: 'Superseded by v2 contract' },
    });
    expect(goodSupersede.statusCode).toBe(200);

    // 8. Memory candidate creation & revocation + eval summary.
    const memRes = await app.inject({
      method: 'POST',
      url: '/api/ai/memory',
      headers: operator.headers,
      payload: {
        memory_kind: 'episodic',
        title: 'Check SHA-256 before acceptance',
        content: 'Always recompute SHA-256 digest on server upload.',
        source_ref: `run:${run.id}`,
        work_contract_id: contract.id,
        source_run_id: run.id,
        source_agent_id: workerId,
      },
    });
    expect(memRes.statusCode).toBe(201);
    expect(memRes.json().data.status).toBe('candidate');

    const revokeMemRes = await app.inject({
      method: 'POST',
      url: `/api/ai/memory/${memRes.json().data.id}/revoke`,
      headers: operator.headers,
      payload: { reason: 'Retiring candidate' },
    });
    expect(revokeMemRes.statusCode).toBe(200);
    expect(revokeMemRes.json().data.status).toBe('revoked');

    const unauthEvalSummary = await app.inject({
      method: 'GET',
      url: '/api/ai/eval-summary',
    });
    expect(unauthEvalSummary.statusCode).toBe(401);

    const evalSummaryRes = await app.inject({
      method: 'GET',
      url: '/api/ai/eval-summary',
      headers: operator.headers,
    });
    expect(evalSummaryRes.statusCode).toBe(200);
    const evalSummary = evalSummaryRes.json().data;
    expect(evalSummary.agiClaimed).toBe(false);
    expect(evalSummary.capabilityGates).toHaveLength(7);

    // Provenance comes from the offline evaluation contract and is persisted
    // in the operator's audit trail; no value is hardcoded by the endpoint.
    expect(evalSummary.reportAvailable).toBe(true);
    expect(evalSummary.sourceSha).toBeTruthy();
    expect(evalSummary.fixtureHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(evalSummary.reportSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(evalSummary.capturedAt).toBeTruthy();
    expect(evalSummary.offlineGate.ok).toBe(true);
    expect(evalSummary.offlineGate.mode).toBe('offline-mock');
    expect(evalSummary.offlineGate.syntheticFixture).toBe(true);
    expect(evalSummary.offlineGate.realModelUsed).toBe(false);

    // Offline fixtures are not a live evaluation: verdicts, rates and
    // regression totals stay NO DATA instead of being synthesized.
    expect(
      evalSummary.capabilityGates.every(
        (gate: { passed: unknown; safetyRegressions: unknown }) =>
          gate.passed === null && gate.safetyRegressions === null
      )
    ).toBe(true);
    expect(
      Object.values(evalSummary.ablationConditions).every(
        (arm: { passRate: unknown; harmRate: unknown }) =>
          arm.passRate === null && arm.harmRate === null
      )
    ).toBe(true);

    // 9. Emergency stop halts agent, cancels active runs, and blocks new dispatch.
    const stopRes = await app.inject({
      method: 'POST',
      url: '/api/ai/emergency-stop',
      headers: operator.headers,
      payload: { agent_id: workerId, revoke_grants: true, reason: 'Operator drill halt' },
    });
    expect(stopRes.statusCode).toBe(200);
    expect(stopRes.json().data.emergencyStopActive).toBe(true);

    const blockedRunRes = await app.inject({
      method: 'POST',
      url: '/api/ai/runs',
      headers: operator.headers,
      payload: {
        agent_id: workerId,
        work_contract_id: contract.id,
        capability_grant_id: grantId,
      },
    });
    expect(blockedRunRes.statusCode).toBe(403);
  });

  it('verifies Desktop Sync lease fencing tokens, server-side SHA-256 recomputation, and server-only accepted transitions', async () => {
    const operator = await createTenantOperator('Desktop Sync Co', 'op_desktop');

    const agentRes = await app.inject({
      method: 'POST',
      url: '/api/ai/agents',
      headers: operator.headers,
      payload: { name: 'Desktop Runner Agent', code: 'desktop_runner', status: 'active' },
    });
    const agentId = (agentRes.json() as { data: { id: number } }).data.id;

    const contractRes = await app.inject({
      method: 'POST',
      url: '/api/ai/work-contracts',
      headers: operator.headers,
      payload: {
        code: 'desktop_contract_01',
        title: 'Local Worktree Inspection',
        objective: 'Sync PCW evidence from desktop sidecar',
        assigned_agent_id: agentId,
      },
    });
    const contractId = (contractRes.json() as { data: { id: number } }).data.id;

    const grantRes = await app.inject({
      method: 'POST',
      url: '/api/ai/grants',
      headers: operator.headers,
      payload: {
        agent_id: agentId,
        work_contract_id: contractId,
        capability: 'repo.read@v1',
      },
    });
    const grantId = (grantRes.json() as { data: { id: number } }).data.id;

    // 1. Acquire lease 1 & renew to lease 2 (monotonic fencingToken 1 -> 2).
    const lease1 = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/lease',
      headers: operator.headers,
      payload: {
        workContractId: contractId,
        agentId,
        capabilityGrantId: grantId,
        idempotencyKey: 'desktop-run-01',
      },
    });
    expect(lease1.statusCode).toBe(200);
    expect(lease1.json().data.fencingToken).toBe(1);

    const lease2 = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/lease',
      headers: operator.headers,
      payload: {
        workContractId: contractId,
        agentId,
        capabilityGrantId: grantId,
        idempotencyKey: 'desktop-run-01',
      },
    });
    expect(lease2.statusCode).toBe(200);
    expect(lease2.json().data.fencingToken).toBe(2);

    // 2. Pull company-scoped snapshot.
    const pullRes = await app.inject({
      method: 'GET',
      url: '/api/ai/desktop/pull',
      headers: operator.headers,
    });
    expect(pullRes.statusCode).toBe(200);
    expect(pullRes.json().data.companyId).toBe(operator.company.id);

    // 3. Artifact upload recomputes SHA-256 and rejects tampered digest with 409.
    const storageKey = randomUUID();
    const content = JSON.stringify({ step: 'completed', diffLines: 12 });
    const actualSha = sha256Hex(content);

    const tamperedUpload = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/artifacts/upload',
      headers: operator.headers,
      payload: {
        workContractId: contractId,
        storageKey,
        artifactKind: 'evidence_bundle',
        content,
        expectedSha256: 'a'.repeat(64),
      },
    });
    expect(tamperedUpload.statusCode).toBe(409);

    // Desktop sidecar attempting to upload verificationStatus: 'accepted' is rejected with 403.
    const selfApprovedUpload = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/artifacts/upload',
      headers: operator.headers,
      payload: {
        workContractId: contractId,
        storageKey,
        artifactKind: 'evidence_bundle',
        content,
        expectedSha256: actualSha,
        verificationStatus: 'accepted',
      },
    });
    expect(selfApprovedUpload.statusCode).toBe(403);

    const validUpload = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/artifacts/upload',
      headers: operator.headers,
      payload: {
        workContractId: contractId,
        storageKey,
        artifactKind: 'evidence_bundle',
        content,
        expectedSha256: actualSha,
      },
    });
    expect(validUpload.statusCode).toBe(201);
    expect(validUpload.json().data.verification_status).toBe('produced');

    // 4. PCW sync rejects stale fencing token (1 < 2) with 409 and self-approved 'accepted' with 403.
    const artifactEntry = {
      storageKey,
      artifactKind: 'evidence_bundle',
      sha256: actualSha,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      mimeType: 'application/json',
      dataClassification: 'local_only',
    };

    const staleSync = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/pcw-sync',
      headers: operator.headers,
      payload: {
        envelopeId: randomUUID(),
        workContractId: contractId,
        agentRunId: 'desktop-run-01',
        agentId,
        correlationId: 'corr-desktop-01',
        fencingToken: 1,
        runStatus: 'completed',
        artifacts: [artifactEntry],
      },
    });
    expect(staleSync.statusCode).toBe(409);
    expect(staleSync.json().code).toBe('STALE_FENCING_TOKEN');

    const forbiddenAcceptedSync = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/pcw-sync',
      headers: operator.headers,
      payload: {
        envelopeId: randomUUID(),
        workContractId: contractId,
        agentRunId: 'desktop-run-01',
        agentId,
        correlationId: 'corr-desktop-01',
        fencingToken: 2,
        runStatus: 'completed',
        requestedContractStatus: 'accepted',
        artifacts: [artifactEntry],
      },
    });
    expect(forbiddenAcceptedSync.statusCode).toBe(403);

    // Valid PCW sync with current fencingToken = 2 succeeds.
    const validSync = await app.inject({
      method: 'POST',
      url: '/api/ai/desktop/pcw-sync',
      headers: operator.headers,
      payload: {
        envelopeId: randomUUID(),
        workContractId: contractId,
        agentRunId: 'desktop-run-01',
        agentId,
        correlationId: 'corr-desktop-01',
        fencingToken: 2,
        runStatus: 'completed',
        artifacts: [artifactEntry],
      },
    });
    expect(validSync.statusCode).toBe(200);
    expect(validSync.json().data).toMatchObject({
      outcome: 'synced',
      fencingToken: 2,
      runStatus: 'completed',
      artifactCount: 1,
    });
  });
});
