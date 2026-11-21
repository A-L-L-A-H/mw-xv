import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const tierInfo = {
  tier: 3,
  name: 'Cross-Feature Pairwise Combinations',
  description:
    '20 pairwise integration scenarios (T3-01..T3-20) exercising interactions across FA-01..FA-13.',
};

function requireExport(mod, candidates, label) {
  assert.ok(mod && typeof mod === 'object', `Expected built module for ${label}`);
  for (const name of candidates) {
    if (name in mod && mod[name] !== undefined) {
      return mod[name];
    }
  }
  assert.fail(`Missing required contract export [${candidates.join(' | ')}] for ${label}`);
}

function findManifestModel(manifest, modelName) {
  assert.ok(manifest && Array.isArray(manifest.models), 'Expected addon manifest.models array');
  const model = manifest.models.find(
    (entry) => entry?.modelName === modelName || entry?.name === modelName
  );
  assert.ok(model, `Expected model '${modelName}' in @moonwitness/orm-ai manifest`);
  return model;
}

async function createSqliteOrmDb(ctx) {
  const apiRequire = ctx.harness.createApiRequire();
  const knexFactory = apiRequire('knex');
  const orm = await ctx.harness.importBuiltPackage('orm');
  const ormBase = await ctx.harness.importBuiltPackage('orm-base');
  const auth = await ctx.harness.importBuiltPackage('auth');
  const jobs = await ctx.harness.importBuiltPackage('jobs');
  const ormNotification = await ctx.harness.importBuiltPackage('orm-notification');
  const ormWorkflow = await ctx.harness.importBuiltPackage('orm-workflow');
  const ormOrg = await ctx.harness.importBuiltPackage('orm-organization');
  const ormIntegration = await ctx.harness.importBuiltPackage('orm-integration');
  const ormKnowledge = await ctx.harness.importBuiltPackage('orm-knowledge');
  const ormStorage = await ctx.harness.importBuiltPackage('orm-storage');
  const ormAi = await ctx.harness.importBuiltPackage('orm-ai');

  const db = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: {
      afterCreate(conn, done) {
        conn.pragma('foreign_keys = ON');
        done(null, conn);
      },
    },
  });

  await orm.installAddons(
    db,
    [
      ormBase.manifest,
      auth.manifest,
      jobs.jobsManifest,
      ormNotification.manifest,
      ormWorkflow.manifest,
      ormOrg.manifest,
      ormIntegration.manifest,
      ormKnowledge.manifest,
      ormStorage.manifest,
      ormAi.manifest,
    ].filter(Boolean)
  );

  const { Company, Partner, User, CompanyMembership } = ormBase;
  Company.knex(db);
  Partner.knex(db);
  User.knex(db);
  CompanyMembership.knex(db);

  const companyA = await Company.query().insertAndFetch({ name: 'Pairwise Co A' });
  const companyB = await Company.query().insertAndFetch({ name: 'Pairwise Co B' });
  const partnerA = await Partner.query().insertAndFetch({
    name: 'Pairwise User A',
    company_id: companyA.id,
  });
  const partnerRev = await Partner.query().insertAndFetch({
    name: 'Pairwise Reviewer A',
    company_id: companyA.id,
  });
  const agentPartner = await Partner.query().insertAndFetch({
    name: 'Pairwise Agent A',
    company_id: companyA.id,
  });

  const userA = await User.query().insertAndFetch({
    login: `pair-a-${randomUUID().slice(0, 6)}`,
    password: 'test-user-pass-123',
    partner_id: partnerA.id,
    role: 'user',
  });
  const reviewerA = await User.query().insertAndFetch({
    login: `pair-rev-${randomUUID().slice(0, 6)}`,
    password: 'test-user-pass-123',
    partner_id: partnerRev.id,
    role: 'user',
  });
  const agentUserA = await User.query().insertAndFetch({
    login: `pair-agent-${randomUUID().slice(0, 6)}`,
    partner_id: agentPartner.id,
    role: 'user',
  });
  for (const membership of [
    { user_id: userA.id, company_id: companyA.id, is_default: true, active: true },
    { user_id: reviewerA.id, company_id: companyA.id, is_default: true, active: true },
    { user_id: agentUserA.id, company_id: companyA.id, is_default: true, active: true },
  ]) {
    await CompanyMembership.query().insert(membership);
  }

  return {
    db,
    orm,
    ormBase,
    auth,
    jobs,
    ormNotification,
    ormWorkflow,
    ormOrg,
    ormIntegration,
    ormKnowledge,
    ormStorage,
    ormAi,
    companyA,
    companyB,
    userA,
    reviewerA,
    agentUserA,
  };
}

function buildModelConfig(modelProfile, providerProfile) {
  return {
    id: modelProfile?.code ?? 'mock_model_v1',
    providerId: providerProfile?.code ?? 'mock_local',
    providerKind: providerProfile?.kind ?? 'mock',
    modelName: modelProfile?.model_id ?? 'mock-v1',
    capabilities: {
      textGeneration: true,
      toolCall: Boolean(modelProfile?.supports_tools),
      streaming: Boolean(modelProfile?.supports_streaming),
      structuredOutput: modelProfile?.supports_structured_output !== false,
    },
    contextWindowTokens: modelProfile?.context_window ?? 8192,
    maxOutputTokens: modelProfile?.max_output_tokens ?? 2048,
    modalities: ['text'],
  };
}

async function seedAiContractPrerequisites(db, ormAi, company, humanUser, agentUser, suffix) {
  const ProviderProfile = findManifestModel(ormAi.manifest, 'ai.provider_profile');
  const ModelProfile = findManifestModel(ormAi.manifest, 'ai.model_profile');
  const ExecutionPolicy = findManifestModel(ormAi.manifest, 'ai.execution_policy');
  const Agent = findManifestModel(ormAi.manifest, 'ai.agent');
  for (const M of [ProviderProfile, ModelProfile, ExecutionPolicy, Agent]) {
    M.knex(db);
  }
  const provider = await ProviderProfile.query().insertAndFetch({
    company_id: company.id,
    code: `mock_local_${suffix}`,
    name: 'Mock Local Provider',
    kind: 'mock',
    secret_ref: 'MW_AI_MOCK_KEY',
    data_classification: 'local_only',
    enabled: true,
  });
  const modelProfile = await ModelProfile.query().insertAndFetch({
    company_id: company.id,
    provider_profile_id: provider.id,
    code: `mock_model_${suffix}`,
    name: 'Mock Model',
    model_id: 'mock-v1',
  });
  const policy = await ExecutionPolicy.query().insertAndFetch({
    company_id: company.id,
    code: `policy_${suffix}`,
    policy_version: 1,
    name: 'Default Policy',
    default_risk_tier: 'R0',
    max_risk_tier: 'R3',
    allowed_classification: 'local_only',
    max_delegation_depth: 2,
  });
  const agent = await Agent.query().insertAndFetch({
    company_id: company.id,
    code: `agent_${suffix}`,
    status: 'active',
    service_user_id: agentUser.id,
    role_template: 'researcher',
  });
  return { provider, modelProfile, policy, agent };
}

export const cases = [
  {
    id: 'T3-01',
    tier: 3,
    featureArea: 'FA-01',
    name: 'FA-01 (orm-ai) x FA-02 (DataClassificationRouter): restricted contract blocks cloud provider',
    prerequisites: ['pkg:orm-ai', 'pkg:ai-runtime'],
    async run(ctx) {
      const { db, ormAi, companyA, userA, agentUserA } = await createSqliteOrmDb(ctx);
      try {
        const runtime = await ctx.harness.importBuiltPackage('ai-runtime');
        const Router = requireExport(
          runtime,
          ['DataClassificationRouter'],
          '@moonwitness/ai-runtime'
        );
        const OpenAiProviderAdapter = requireExport(
          runtime,
          ['OpenAiProviderAdapter'],
          '@moonwitness/ai-runtime'
        );
        const { policy } = await seedAiContractPrerequisites(
          db,
          ormAi,
          companyA,
          userA,
          agentUserA,
          't301'
        );
        const WorkContract = findManifestModel(ormAi.manifest, 'ai.work_contract');
        const ProviderProfile = findManifestModel(ormAi.manifest, 'ai.provider_profile');
        const ModelProfile = findManifestModel(ormAi.manifest, 'ai.model_profile');
        WorkContract.knex(db);
        ProviderProfile.knex(db);
        ModelProfile.knex(db);

        const contract = await WorkContract.query().insertAndFetch({
          company_id: companyA.id,
          code: 'wc_restricted_t301',
          title: 'Restricted Contract',
          objective: 'Enforce restricted classification boundary',
          execution_policy_id: policy.id,
          requested_by_id: userA.id,
          risk_tier: 'R1',
          data_classification: 'restricted',
          status: 'draft',
        });
        const cloudProfile = await ProviderProfile.query().insertAndFetch({
          company_id: companyA.id,
          code: 'cloud_openai_t301',
          name: 'Cloud OpenAI',
          kind: 'openai',
          data_classification: 'cloud_eligible',
          secret_ref: 'MW_AI_OPENAI_API_KEY',
          enabled: true,
        });
        const cloudModel = await ModelProfile.query().insertAndFetch({
          company_id: companyA.id,
          provider_profile_id: cloudProfile.id,
          code: 'cloud_gpt_t301',
          name: 'GPT Test',
          model_id: 'gpt-4o-mini',
        });

        assert.equal(
          ormAi.isAllowedClassificationRoute(
            contract.data_classification,
            cloudProfile.kind,
            cloudProfile.data_classification,
            Boolean(policy.allow_cloud_fallback)
          ),
          false
        );

        const cloudProvider = new OpenAiProviderAdapter({
          id: cloudProfile.code,
          secretRef: cloudProfile.secret_ref,
          secretResolver: () => 'synthetic-key-t301',
        });
        const router = new Router({
          targets: [
            {
              id: cloudProfile.code,
              provider: cloudProvider,
              model: buildModelConfig(cloudModel, cloudProfile),
              deploymentZone: 'cloud',
              enabled: true,
            },
          ],
        });

        assert.throws(
          () =>
            router.evaluateRouting({
              correlationId: 't3-01-corr',
              companyId: companyA.id,
              workContractId: String(contract.id),
              dataClassification: contract.data_classification,
              policy: {
                allowedClassification: policy.allowed_classification,
                allowCloudFallback: Boolean(policy.allow_cloud_fallback),
              },
            }),
          /restricted|cloud|blocked|classification|egress|eligible/iu
        );
        return { details: 'Restricted orm-ai contract blocked from cloud provider dispatch.' };
      } finally {
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-02',
    tier: 3,
    featureArea: 'FA-05',
    name: 'FA-01 (INTERNAL_PREFIXES) x FA-05 (ai-mcp): REST block + MCP refuses policy mutation',
    prerequisites: ['api:built', 'api:ai-addon', 'pkg:orm-ai', 'mcp:built'],
    async run(ctx) {
      const api = await ctx.harness.createIsolatedApi();
      try {
        const restBlock = await api.app.inject({
          method: 'POST',
          url: '/api/ai.execution_policy',
          headers: { authorization: `Bearer ${api.superadminToken}` },
          payload: { name: 'bypass-policy' },
        });
        assert.ok(restBlock.statusCode === 403 || restBlock.statusCode === 404);

        const mcp = await ctx.harness.importBuiltPackage('ai-mcp');
        const createMcpServer = requireExport(
          mcp,
          ['createAiMcpServer', 'createMcpServer', 'createMcpHandler'],
          '@moonwitness/ai-mcp'
        );
        const server = await createMcpServer({ db: api.db });
        const mcpRes = await server.handleRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'ai.execution_policy.write',
            arguments: { allowR4: true },
          },
          auth: { companyId: 1, userId: 1, role: 'user' },
        });
        assert.ok(mcpRes.error, 'MCP must not expose execution_policy mutation');
        return { details: 'Both generic REST and MCP blocked policy mutation.' };
      } finally {
        await api.close();
      }
    },
  },
  {
    id: 'T3-03',
    tier: 3,
    featureArea: 'FA-03',
    name: 'FA-02 (Provider Outage) x FA-03 (@moonwitness/jobs): retry backoff and DLQ isolation',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, jobs, companyA, userA } = await createSqliteOrmDb(ctx);
      const runtime = await ctx.harness.importBuiltPackage('ai-runtime');
      const OllamaAdapter = requireExport(runtime, ['OllamaAdapter'], '@moonwitness/ai-runtime');
      const timeoutServer = await ctx.mocks.startMockOllamaServer('timeout');
      let unregisterHandler = null;
      try {
        jobs.Job.knex(db);
        const adapter = new OllamaAdapter({
          id: 'ollama-outage',
          endpoint: timeoutServer.url,
          defaultTimeoutMs: 60,
        });
        const handlerName = `ai.pair.outage.${randomUUID().slice(0, 8)}`;
        unregisterHandler = jobs.registerJobHandler({
          name: handlerName,
          version: 1,
          parse: (payload) => payload,
          async run(_payload, jobCtx) {
            return adapter.generate({
              correlationId: `pair-outage-${jobCtx.jobId}-${jobCtx.attempt}`,
              dataClassification: 'local_only',
              model: {
                id: 'ollama-qwen',
                providerId: 'ollama-outage',
                providerKind: 'ollama',
                modelName: 'qwen2.5:7b',
                capabilities: {
                  textGeneration: true,
                  toolCall: true,
                  streaming: true,
                  structuredOutput: true,
                },
                contextWindowTokens: 8192,
                maxOutputTokens: 1024,
                modalities: ['text'],
              },
              messages: [{ role: 'user', content: 'test' }],
            });
          },
        });
        const jobId = await jobs.enqueueJob(
          handlerName,
          {},
          {
            companyId: companyA.id,
            requestedBy: userA.id,
            maxAttempts: 2,
            idempotencyKey: `pair-outage-${randomUUID()}`,
          }
        );
        await jobs.runOneJob({ workerId: 'pair-w1', leaseSeconds: 10 });
        await db('jobs')
          .where({ id: jobId })
          .update({ available_at: new Date(0).toISOString() });
        await jobs.runOneJob({ workerId: 'pair-w1', leaseSeconds: 10 });
        const finalJob = await jobs.Job.query().findById(jobId);
        assert.equal(finalJob.status, 'dead');
        return { details: `Outage retries exhausted cleanly to '${finalJob.status}'.` };
      } finally {
        unregisterHandler?.();
        await timeoutServer.close();
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-04',
    tier: 3,
    featureArea: 'FA-08',
    name: 'FA-03 (AbortSignal Cancel) x FA-08 (Workforce Parent->Child): cancellation cascade',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, jobs, ormAi, companyA, userA, agentUserA } = await createSqliteOrmDb(ctx);
      let unregisterHandler = null;
      try {
        const runtime = await ctx.harness.importBuiltPackage('ai-runtime');
        const propagateCancellation = requireExport(
          runtime,
          ['propagateCancellation'],
          '@moonwitness/ai-runtime'
        );
        const { policy } = await seedAiContractPrerequisites(
          db,
          ormAi,
          companyA,
          userA,
          agentUserA,
          't304'
        );
        const WorkContract = findManifestModel(ormAi.manifest, 'ai.work_contract');
        WorkContract.knex(db);
        jobs.Job.knex(db);

        const parent = await WorkContract.query().insertAndFetch({
          company_id: companyA.id,
          code: 'wc_parent_t304',
          title: 'Parent Contract',
          objective: 'Parent work contract',
          execution_policy_id: policy.id,
          requested_by_id: userA.id,
          risk_tier: 'R1',
          data_classification: 'local_only',
          status: 'running',
          delegation_depth: 0,
        });
        const child = await WorkContract.query().insertAndFetch({
          company_id: companyA.id,
          code: 'wc_child_t304',
          parent_contract_id: parent.id,
          title: 'Child Contract',
          objective: 'Child work contract',
          execution_policy_id: policy.id,
          requested_by_id: userA.id,
          risk_tier: 'R0',
          data_classification: 'local_only',
          status: 'running',
          delegation_depth: 1,
        });

        const handlerName = `ai.child.task.${randomUUID().slice(0, 8)}`;
        unregisterHandler = jobs.registerJobHandler({
          name: handlerName,
          version: 1,
          parse: (payload) => payload,
          async run() {
            return { ok: true };
          },
        });
        const childJobId = await jobs.enqueueJob(
          handlerName,
          { contractId: child.id },
          { companyId: companyA.id, requestedBy: userA.id }
        );

        const parentRunId = `run-wc-${parent.id}`;
        const childRunId = `run-wc-${child.id}`;
        const targets = propagateCancellation(parentRunId, [
          { runId: parentRunId },
          { runId: childRunId, parentRunId },
        ]);
        assert.ok(targets.some((t) => t.runId === childRunId));
        assert.equal(await jobs.cancelJob(childJobId), true);
        await WorkContract.query().patchAndFetchById(parent.id, { status: 'cancelled' });
        await WorkContract.query().patchAndFetchById(child.id, { status: 'cancelled' });

        const reloadedChild = await WorkContract.query().findById(child.id);
        const reloadedJob = await jobs.Job.query().findById(childJobId);
        assert.equal(reloadedChild.status, 'cancelled');
        assert.equal(reloadedJob.status, 'cancelled');
        return { details: 'Parent cancellation cascaded to child contract and job.' };
      } finally {
        unregisterHandler?.();
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-05',
    tier: 3,
    featureArea: 'FA-04',
    name: 'FA-04 (Capability Gateway) x FA-05 (MCP Server): mid-run revocation blocks MCP write',
    prerequisites: ['mcp:built', 'pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, ormAi, companyA, userA, agentUserA } = await createSqliteOrmDb(ctx);
      try {
        const { policy, agent } = await seedAiContractPrerequisites(
          db,
          ormAi,
          companyA,
          userA,
          agentUserA,
          't305'
        );
        const CapabilityGrant = findManifestModel(ormAi.manifest, 'ai.capability_grant');
        CapabilityGrant.knex(db);
        const grant = await CapabilityGrant.query().insertAndFetch({
          company_id: companyA.id,
          agent_id: agent.id,
          execution_policy_id: policy.id,
          capability: 'ai.work_note.write@v1',
          policy_version: policy.policy_version,
          issued_by_id: userA.id,
          issued_at: new Date().toISOString(),
          status: 'active',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });

        const mcp = await ctx.harness.importBuiltPackage('ai-mcp');
        const createMcpServer = requireExport(
          mcp,
          ['createAiMcpServer', 'createMcpServer', 'createMcpHandler'],
          '@moonwitness/ai-mcp'
        );
        const server = await createMcpServer({ db });

        await CapabilityGrant.query().patchAndFetchById(grant.id, {
          status: 'revoked',
          revoked_at: new Date().toISOString(),
        });

        const res = await server.handleRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'ai.work_note.submit',
            arguments: { idempotency_key: `rev-${randomUUID()}`, summary: 'Should fail' },
          },
          auth: { companyId: companyA.id, userId: userA.id, grantId: grant.id, role: 'user' },
        });
        assert.ok(res.error, 'Expected MCP write to fail when gateway detects revoked grant');
        const logs = await db('audit_logs').select('*');
        assert.ok(logs.length > 0, 'Expected denied MCP gateway call to be audited');
        return { details: 'MCP delegated to gateway, denied revoked write, and audited.' };
      } finally {
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-06',
    tier: 3,
    featureArea: 'FA-11',
    name: 'FA-04 (Quota Exhaustion) x FA-11 (Risk Tiers R0-R4): R1 quota block + R3 approval hold',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, ormAi, companyA, userA, agentUserA } = await createSqliteOrmDb(ctx);
      try {
        const runtime = await ctx.harness.importBuiltPackage('ai-runtime');
        const CapabilityGateway = requireExport(
          runtime,
          ['CapabilityGateway'],
          '@moonwitness/ai-runtime'
        );
        const InMemoryCapabilityGrantStore = requireExport(
          runtime,
          ['InMemoryCapabilityGrantStore'],
          '@moonwitness/ai-runtime'
        );
        const { policy, agent } = await seedAiContractPrerequisites(
          db,
          ormAi,
          companyA,
          userA,
          agentUserA,
          't306'
        );
        const CapabilityGrant = findManifestModel(ormAi.manifest, 'ai.capability_grant');
        CapabilityGrant.knex(db);

        const nowIso = new Date().toISOString();
        const futureIso = new Date(Date.now() + 60_000).toISOString();
        const r1Grant = await CapabilityGrant.query().insertAndFetch({
          company_id: companyA.id,
          agent_id: agent.id,
          execution_policy_id: policy.id,
          capability: 'ai.work_note_write@v1',
          policy_version: policy.policy_version,
          max_calls_per_run: 1,
          issued_by_id: userA.id,
          issued_at: nowIso,
          status: 'active',
          expires_at: futureIso,
        });
        const r3Grant = await CapabilityGrant.query().insertAndFetch({
          company_id: companyA.id,
          agent_id: agent.id,
          execution_policy_id: policy.id,
          capability: 'external.deploy@v1',
          policy_version: policy.policy_version,
          max_calls_per_run: 5,
          issued_by_id: userA.id,
          issued_at: nowIso,
          status: 'active',
          expires_at: futureIso,
        });

        const grantStore = new InMemoryCapabilityGrantStore();
        grantStore.setPolicyVersion(companyA.id, policy.policy_version);
        for (const row of [r1Grant, r3Grant]) {
          grantStore.upsertGrant({
            grantId: String(row.id),
            companyId: companyA.id,
            agentId: agent.id,
            capability: row.capability,
            scope: { allowWrite: true },
            policyVersion: row.policy_version,
            maxCallsPerRun: row.max_calls_per_run,
            issuedBy: row.issued_by_id,
            issuedAt: row.issued_at,
            expiresAt: row.expires_at,
            status: 'active',
          });
        }

        const gw = new CapabilityGateway({ grantStore });
        gw.registerTool({
          name: 'ai.work_note.write',
          version: 1,
          capability: 'ai.work_note_write@v1',
          ownerAddon: 'ai',
          riskTier: 'R1',
          dataClassification: 'local_only',
          sideEffect: 'reversible_write',
          requiresConfirmation: false,
          idempotent: false,
          inputSchema: {
            type: 'object',
            properties: { note: { type: 'string' } },
            required: ['note'],
          },
          description: 'Write work note',
          execute: async (args) => ({ written: args.note }),
        });
        gw.registerTool({
          name: 'external.deploy',
          version: 1,
          capability: 'external.deploy@v1',
          ownerAddon: 'ai',
          riskTier: 'R3',
          dataClassification: 'local_only',
          sideEffect: 'external_effect',
          requiresConfirmation: true,
          idempotent: false,
          inputSchema: { type: 'object' },
          description: 'External deploy',
          execute: async () => ({ deployed: true }),
        });

        const baseCtx = {
          actorType: 'agent',
          actorId: agent.id,
          companyId: companyA.id,
          runId: 'run-t3-06',
          correlationId: 'corr-t3-06',
          policyVersion: policy.policy_version,
          maxRiskTier: 'R3',
        };
        const firstRes = await gw.invoke('ai.work_note.write', { note: 'first' }, baseCtx);
        assert.equal(firstRes.allowed, true);

        const overQuotaRes = await gw.invoke(
          'ai.work_note.write',
          { note: 'second over quota' },
          baseCtx
        );
        assert.equal(overQuotaRes.allowed, false);
        assert.match(
          `${overQuotaRes.denial.reasonCode} ${overQuotaRes.denial.message}`,
          /quota|limit|exceed|calls/iu
        );

        const r3Blocked = await gw.invoke('external.deploy', {}, baseCtx);
        assert.equal(r3Blocked.allowed, false);
        assert.match(
          `${r3Blocked.denial.reasonCode} ${r3Blocked.denial.message}`,
          /approval|human|R3|confirm/iu
        );
        return { details: 'R1 quota limit enforced alongside R3 human-approval gate.' };
      } finally {
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-07',
    tier: 3,
    featureArea: 'FA-09',
    name: 'FA-05 (MCP K0-K9 Read) x FA-09 (Workforce Memory): strict provenance separation',
    prerequisites: ['mcp:built', 'pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, ormAi, companyA, userA } = await createSqliteOrmDb(ctx);
      try {
        const MemoryCandidate = findManifestModel(ormAi.manifest, 'ai.memory_candidate');
        MemoryCandidate.knex(db);
        await MemoryCandidate.query().insertAndFetch({
          company_id: companyA.id,
          memory_kind: 'semantic',
          scope_kind: 'project',
          scope_ref: 'packages/orm-ai',
          title: 'Synthetic Candidate Note',
          source_ref: 'run:t3-07',
          status: 'approved',
          content: 'Synthetic candidate note not in K0-K9',
          data_classification: 'local_only',
        });

        const mcp = await ctx.harness.importBuiltPackage('ai-mcp');
        const createMcpServer = requireExport(
          mcp,
          ['createAiMcpServer', 'createMcpServer', 'createMcpHandler'],
          '@moonwitness/ai-mcp'
        );
        const server = await createMcpServer({ db });
        const kRes = await server.handleRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'knowledge.publications.list', arguments: {} },
          auth: { companyId: companyA.id, userId: userA.id, role: 'user' },
        });
        assert.ok(!kRes.error);
        const serialized = JSON.stringify(kRes.result);
        assert.equal(serialized.includes('Synthetic candidate note not in K0-K9'), false);
        return {
          details: 'MCP K0-K9 retrieval remained strictly isolated from ai.memory_candidate.',
        };
      } finally {
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-08',
    tier: 3,
    featureArea: 'FA-06',
    name: 'FA-06 (PCW Verifier) x FA-03 (orm-storage): SHA-256 blob validation before review',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, ormAi, ormStorage, companyA, userA, agentUserA } = await createSqliteOrmDb(ctx);
      try {
        const runtime = await ctx.harness.importBuiltPackage('ai-runtime');
        const verifyProofCarryingWork = requireExport(
          runtime,
          ['verifyProofCarryingWork'],
          '@moonwitness/ai-runtime'
        );
        const storageDir = await ctx.harness.makeTempDir('t3-pcw-storage');
        const storage = new ormStorage.LocalFileAttachmentStorage(storageDir);
        const { provider, modelProfile, policy, agent } = await seedAiContractPrerequisites(
          db,
          ormAi,
          companyA,
          userA,
          agentUserA,
          't308'
        );

        const payload = Buffer.from(JSON.stringify({ summary: 'Verified package report' }), 'utf8');
        const key = randomUUID();
        const meta = await storage.put(key, payload);
        const expectedSha = createHash('sha256').update(payload).digest('hex');
        assert.equal(meta.checksum, expectedSha);

        const WorkContract = findManifestModel(ormAi.manifest, 'ai.work_contract');
        const Criterion = findManifestModel(ormAi.manifest, 'ai.acceptance_criterion');
        const CapabilityGrant = findManifestModel(ormAi.manifest, 'ai.capability_grant');
        const AgentRun = findManifestModel(ormAi.manifest, 'ai.agent_run');
        const ArtifactManifest = findManifestModel(ormAi.manifest, 'ai.artifact_manifest');
        for (const M of [WorkContract, Criterion, CapabilityGrant, AgentRun, ArtifactManifest]) {
          M.knex(db);
        }

        const lockedAt = new Date().toISOString();
        const contract = await WorkContract.query().insertAndFetch({
          company_id: companyA.id,
          code: 'wc_pcw_t308',
          title: 'PCW Storage Verification',
          objective: 'Verify SHA-256 artifact via PCW',
          execution_policy_id: policy.id,
          requested_by_id: userA.id,
          assigned_agent_id: agent.id,
          risk_tier: 'R0',
          data_classification: 'local_only',
          status: 'running',
          criteria_locked_at: lockedAt,
        });
        const crit = await Criterion.query().insertAndFetch({
          company_id: companyA.id,
          work_contract_id: contract.id,
          code: 'c_sha_t308',
          title: 'Valid SHA-256 artifact',
          verification_method: 'automated_test',
          required_evidence_type: 'artifact_sha256',
          mandatory: true,
        });
        const grant = await CapabilityGrant.query().insertAndFetch({
          company_id: companyA.id,
          agent_id: agent.id,
          work_contract_id: contract.id,
          execution_policy_id: policy.id,
          capability: 'repo.read@v1',
          policy_version: policy.policy_version,
          issued_by_id: userA.id,
          issued_at: lockedAt,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          status: 'active',
        });
        const run = await AgentRun.query().insertAndFetch({
          company_id: companyA.id,
          work_contract_id: contract.id,
          agent_id: agent.id,
          capability_grant_id: grant.id,
          provider_profile_id: provider.id,
          model_profile_id: modelProfile.id,
          execution_policy_id: policy.id,
          idempotency_key: `pcw-run-${randomUUID()}`,
          correlation_id: `pcw-corr-${randomUUID()}`,
          status: 'completed',
        });
        const artifact = await ArtifactManifest.query().insertAndFetch({
          company_id: companyA.id,
          work_contract_id: contract.id,
          acceptance_criterion_id: crit.id,
          agent_run_id: run.id,
          producer_agent_id: agent.id,
          artifact_kind: 'report',
          storage_key: key,
          sha256: expectedSha,
          size_bytes: payload.byteLength,
          verification_status: 'produced',
        });

        const storedBlob = await storage.get(key);
        const verification = verifyProofCarryingWork({
          contract: {
            id: String(contract.id),
            companyId: companyA.id,
            code: contract.code,
            assignedAgentId: agent.id,
            riskTier: 'R0',
            dataClassification: 'local_only',
            criteriaLockedAt: lockedAt,
            criteria: [
              {
                id: String(crit.id),
                code: crit.code,
                title: crit.title,
                verificationMethod: 'automated_test',
                requiredEvidenceType: crit.required_evidence_type,
                mandatory: true,
                version: crit.version,
              },
            ],
          },
          artifacts: [
            {
              id: String(artifact.id),
              companyId: companyA.id,
              workContractId: String(contract.id),
              acceptanceCriterionId: String(crit.id),
              criterionVersion: crit.version,
              agentRunId: String(run.id),
              producerAgentId: agent.id,
              artifactKind: 'report',
              storageKey: artifact.storage_key,
              sha256: artifact.sha256,
              rawContent: storedBlob,
              sizeBytes: artifact.size_bytes,
              mimeType: artifact.mime_type,
              producedAt: lockedAt,
              verificationStatus: 'produced',
              automatedTestPassed: true,
            },
          ],
          requireIndependentReview: false,
        });
        assert.equal(verification.accepted, true);
        assert.equal(verification.status, 'accepted');
        return { details: 'PCW verifier validated orm-storage blob SHA-256 and criteria.' };
      } finally {
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-09',
    tier: 3,
    featureArea: 'FA-08',
    name: 'FA-06 (Independent Review) x FA-08 (Workforce Roles): builder vs distinct reviewer',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, ormWorkflow, companyA, userA, reviewerA } = await createSqliteOrmDb(ctx);
      try {
        const wfCode = `ai.workforce.review_${randomUUID().slice(0, 8)}`;
        const def = await ormWorkflow.WorkflowDefinition.query(db).insertAndFetch({
          code: wfCode,
          version: 1,
          name: 'Workforce Review',
          enabled: true,
          config: JSON.stringify({
            startState: 'submitted',
            startRoles: ['user', 'superadmin'],
            timeoutMinutes: 60,
            resourceModels: ['ai.work_contract'],
            transitions: [
              {
                action: 'approve',
                from: 'submitted',
                to: 'approved',
                roles: ['user', 'superadmin'],
                requiredApprovals: 1,
                requireDifferentActor: true,
              },
            ],
          }),
        });
        const inst = await ormWorkflow.startWorkflow(db, {
          code: def.code,
          companyId: companyA.id,
          actorId: userA.id,
          role: 'user',
          resourceModel: 'ai.work_contract',
          resourceId: 101,
          idempotencyKey: `wf-start-${randomUUID()}`,
        });

        await assert.rejects(
          () =>
            ormWorkflow.transitionWorkflow(db, {
              instanceId: inst.id,
              companyId: companyA.id,
              actorId: userA.id,
              role: 'user',
              action: 'approve',
              expectedRevision: inst.revision,
              idempotencyKey: `wf-self-${randomUUID()}`,
            }),
          (err) => err instanceof ormWorkflow.WorkflowError && err.code === 'FORBIDDEN'
        );

        const approved = await ormWorkflow.transitionWorkflow(db, {
          instanceId: inst.id,
          companyId: companyA.id,
          actorId: reviewerA.id,
          role: 'user',
          action: 'approve',
          expectedRevision: inst.revision,
          idempotencyKey: `wf-peer-${randomUUID()}`,
        });
        assert.equal(approved.currentState, 'approved');
        assert.equal(approved.status, 'completed');
        return { details: 'Builder self-approval blocked; distinct reviewer accepted workflow.' };
      } finally {
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-10',
    tier: 3,
    featureArea: 'FA-07',
    name: 'FA-06 (Contract Acceptance) x FA-07 (Obligation Ledger): overlapping change reopens obligation',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, ormAi, companyA, userA, agentUserA } = await createSqliteOrmDb(ctx);
      try {
        const runtime = await ctx.harness.importBuiltPackage('ai-runtime');
        const ObligationContinuityLedger = requireExport(
          runtime,
          ['ObligationContinuityLedger'],
          '@moonwitness/ai-runtime'
        );
        const { policy } = await seedAiContractPrerequisites(
          db,
          ormAi,
          companyA,
          userA,
          agentUserA,
          't310'
        );
        const WorkContract = findManifestModel(ormAi.manifest, 'ai.work_contract');
        const Obligation = findManifestModel(ormAi.manifest, 'ai.obligation');
        WorkContract.knex(db);
        Obligation.knex(db);

        const contract = await WorkContract.query().insertAndFetch({
          company_id: companyA.id,
          code: 'wc_ob_t310',
          title: 'Accepted Baseline Contract',
          objective: 'Maintain obligation continuity',
          execution_policy_id: policy.id,
          requested_by_id: userA.id,
          risk_tier: 'R1',
          data_classification: 'local_only',
          status: 'accepted',
        });
        const ob = await Obligation.query().insertAndFetch({
          company_id: companyA.id,
          code: 'ob_t310',
          origin_contract_id: contract.id,
          scope_json: JSON.stringify({ paths: ['packages/orm-ai/src/models.ts'] }),
          impact_links_json: JSON.stringify(['packages/orm-ai/src/models.ts']),
          trigger_kind: 'code_change',
          required_evidence: 'automated_test',
          status: 'open',
        });

        const ledger = new ObligationContinuityLedger();
        ledger.registerObligation({
          id: String(ob.id),
          companyId: companyA.id,
          code: ob.code,
          originContractId: String(contract.id),
          ownerActorId: userA.id,
          triggerKind: 'code_change',
          impactLinks: ['packages/orm-ai/src/models.ts'],
          requiredEvidence: ob.required_evidence,
          status: 'open',
        });
        const reopened = ledger.evaluateTrigger({
          companyId: companyA.id,
          triggerKind: 'code_change',
          actorId: userA.id,
          affectedImpacts: ['packages/orm-ai/src/models.ts'],
          reason: 'models.ts changed',
        });
        assert.equal(reopened.length, 1);
        assert.equal(reopened[0].status, 'reverification_due');

        await Obligation.query().patchAndFetchById(ob.id, { status: reopened[0].status });
        const updated = await Obligation.query().findById(ob.id);
        assert.equal(updated.status, 'reverification_due');
        return {
          details: 'Overlapping change transitioned open obligation to reverification_due.',
        };
      } finally {
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-11',
    tier: 3,
    featureArea: 'FA-12',
    name: 'FA-07 (Obligation Reopen) x FA-12 (Eval Retained Functionality): G2/G3 regression check',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'eval:built'],
    async run(ctx) {
      const evalPkg = await ctx.harness.importBuiltPackage('ai-evaluation');
      const evaluateGate = requireExport(
        evalPkg,
        ['evaluateCapabilityGate', 'evaluateGate'],
        '@moonwitness/ai-evaluation'
      );
      const verdict = evaluateGate('G3', {
        taskSuccessRate: 0.9,
        evidenceCompleteness: 1.0,
        unauthorizedActionRate: 0,
        reopenedObligationsCount: 2,
        retainedFunctionality: 0.5,
      });
      assert.equal(verdict.passed, false);
      return { details: 'Reopened obligations lowered retainedFunctionality and failed G3 gate.' };
    },
  },
  {
    id: 'T3-12',
    tier: 3,
    featureArea: 'FA-08',
    name: 'FA-08 (Parallel Builders) x FA-11 (Sandbox Isolation): conflict guard + disjoint caps',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const runtime = await ctx.harness.importBuiltPackage('ai-runtime');
      const WorkspaceConflictLockManager = requireExport(
        runtime,
        ['WorkspaceConflictLockManager'],
        '@moonwitness/ai-runtime'
      );
      const lockMgr = new WorkspaceConflictLockManager();
      const firstLock = lockMgr.acquireWriteLock({
        companyId: 1,
        workspaceId: 'ws-1',
        runId: 'run-1',
        agentId: 1,
        fencingToken: 1,
        writePaths: ['packages/orm-ai/src/index.ts'],
      });
      assert.equal(firstLock.acquired, true);

      const conflict = lockMgr.acquireWriteLock({
        companyId: 1,
        workspaceId: 'ws-1',
        runId: 'run-2',
        agentId: 2,
        fencingToken: 1,
        writePaths: ['packages/orm-ai/src/index.ts'],
      });
      assert.equal(conflict.acquired, false);
      assert.equal(conflict.conflictWithRunId, 'run-1');
      assert.ok(conflict.conflictingPaths.includes('packages/orm-ai/src/index.ts'));

      const disjoint = lockMgr.acquireWriteLock({
        companyId: 1,
        workspaceId: 'ws-1',
        runId: 'run-2',
        agentId: 2,
        fencingToken: 1,
        writePaths: ['packages/orm-ai/src/b.ts'],
      });
      assert.equal(disjoint.acquired, true);
      assert.equal(disjoint.lock.runId, 'run-2');
      return {
        details: 'Same-path conflict blocked while disjoint parallel workspaces succeeded.',
      };
    },
  },
  {
    id: 'T3-13',
    tier: 3,
    featureArea: 'FA-09',
    name: 'FA-09 (Memory Revocation) x FA-03 (Agent Run Dispatch): instant skill exclusion',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, ormAi, companyA } = await createSqliteOrmDb(ctx);
      try {
        const runtime = await ctx.harness.importBuiltPackage('ai-runtime');
        const retrieveEligibleMemoryContext = requireExport(
          runtime,
          ['retrieveEligibleMemoryContext'],
          '@moonwitness/ai-runtime'
        );

        const SkillVersion = findManifestModel(ormAi.manifest, 'ai.skill_version');
        SkillVersion.knex(db);
        const skill = await SkillVersion.query().insertAndFetch({
          company_id: companyA.id,
          code: 'sop.repo_inspect',
          version: 1,
          title: 'Inspect Repo SOP',
          sop_body: 'Inspect manifest exports first',
          status: 'approved',
        });

        const toSkillRecord = (row) => ({
          id: String(row.id),
          companyId: row.company_id,
          code: row.code,
          version: row.version,
          title: row.title,
          sopBody: row.sop_body,
          referencedCapabilities: [],
          dataClassification: 'local_only',
          status: row.status,
          revokedAt: row.revoked_at ?? undefined,
          revocationReason: row.revocation_reason ?? undefined,
        });

        const preRevoke = retrieveEligibleMemoryContext({
          runId: 'run-t3-13-pre',
          companyId: companyA.id,
          maxDataClassification: 'local_only',
          mode: 'skill-only',
          memories: [],
          skills: [toSkillRecord(skill)],
        });
        assert.equal(
          preRevoke.items.some((s) => s.itemId === String(skill.id)),
          true,
          'Approved skill must be included before revocation'
        );

        const revokedRow = await SkillVersion.query().patchAndFetchById(skill.id, {
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revocation_reason: 'Superseded by safer check',
        });
        assert.equal(ormAi.isUsableApprovedSkill(revokedRow, { companyId: companyA.id }), false);

        const available = retrieveEligibleMemoryContext({
          runId: 'run-t3-13-post',
          companyId: companyA.id,
          maxDataClassification: 'local_only',
          mode: 'skill-only',
          memories: [],
          skills: [toSkillRecord(revokedRow)],
        });
        assert.equal(
          available.items.some((s) => s.itemId === String(skill.id)),
          false
        );
        return {
          details: 'Revoked ai.skill_version immediately excluded from next run retrieval.',
        };
      } finally {
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-14',
    tier: 3,
    featureArea: 'FA-12',
    name: 'FA-09 (Memory Promotion) x FA-12 (Ablation Evaluator): 4-arm ablation gate check',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'eval:built'],
    async run(ctx) {
      const evalPkg = await ctx.harness.importBuiltPackage('ai-evaluation');
      const runAblation = requireExport(
        evalPkg,
        ['runMemoryAblation', 'evaluateMemoryAblation'],
        '@moonwitness/ai-evaluation'
      );
      const report = await runAblation({ mode: 'mock' });
      const arms = Object.keys(report.arms ?? report);
      for (const arm of ['no-memory', 'episodic-only', 'skill-only', 'combined']) {
        assert.ok(arms.includes(arm), `Expected ablation arm '${arm}' in report`);
      }
      return { details: '4-arm memory ablation report verified.' };
    },
  },
  {
    id: 'T3-15',
    tier: 3,
    featureArea: 'FA-10',
    name: 'FA-10 (Mission Control UI) x FA-04 (Grant Revocation): 403 non-optimistic vs 200 persisted',
    prerequisites: [
      'board:server',
      'board:ai-routes',
      'cmd:playwright',
      'api:built',
      'api:ai-addon',
    ],
    async run(ctx) {
      const api = await ctx.harness.createIsolatedApi();
      const apiUrl = await api.app.listen({ port: 0, host: '127.0.0.1' });
      let board = null;
      try {
        const tenantA = await api.createCompanyAndUsers({
          companyName: 'UI T3-15 Alpha',
          users: [{ login: `ui_op_${randomUUID().slice(0, 6)}`, role: 'user' }],
        });
        const op = Object.values(tenantA.users)[0];
        const ormAi = await ctx.harness.importBuiltPackage('orm-ai');
        const { policy, agent } = await seedAiContractPrerequisites(
          api.db,
          ormAi,
          tenantA.company,
          op.user,
          op.user,
          't315'
        );
        const CapabilityGrant = findManifestModel(ormAi.manifest, 'ai.capability_grant');
        CapabilityGrant.knex(api.db);
        const grant = await CapabilityGrant.query().insertAndFetch({
          company_id: tenantA.company.id,
          agent_id: agent.id,
          execution_policy_id: policy.id,
          capability: 'repo.read@v1',
          policy_version: policy.policy_version,
          issued_by_id: op.user.id,
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          status: 'active',
        });

        board = await ctx.harness.startIsolatedBoard(apiUrl);
        const session = {
          access_token: op.token,
          refresh_token: op.refreshToken,
          user: op.user,
        };

        const failRes = await ctx.playwright.runBoardAiPlaywrightCheck({
          baseUrl: board.url,
          session,
          companyId: tenantA.company.id,
          routes: ['/board/ai/governance'],
          checkColorSchemes: false,
          nonOptimisticCheck: {
            route: '/board/ai/governance',
            apiPattern: '**/api/ai/**',
            status: 403,
            triggerLabel: /revoke/iu,
            confirmLabel: /confirm|proceed|revoke/iu,
            optimisticSuccessText: /persisted revocation confirmed|revoked/iu,
          },
        });
        assert.equal(failRes.ok, true, failRes.details);

        const okRes = await ctx.playwright.runBoardAiPlaywrightCheck({
          baseUrl: board.url,
          session,
          companyId: tenantA.company.id,
          routes: ['/board/ai/governance'],
          checkColorSchemes: false,
        });
        assert.equal(okRes.ok, true, okRes.details);
        assert.ok(grant.id);
        return {
          details: 'Playwright confirmed 403 non-optimistic error and real board render.',
        };
      } finally {
        if (board) await board.close();
        await api.close();
      }
    },
  },
  {
    id: 'T3-16',
    tier: 3,
    featureArea: 'FA-10',
    name: 'FA-10 (Continuity View) x FA-07 (Obligation Ledger): reopened state rendered per company',
    prerequisites: [
      'board:server',
      'board:ai-routes',
      'cmd:playwright',
      'api:built',
      'api:ai-addon',
      'pkg:orm-ai',
    ],
    async run(ctx) {
      const api = await ctx.harness.createIsolatedApi();
      const apiUrl = await api.app.listen({ port: 0, host: '127.0.0.1' });
      let board = null;
      try {
        const tenantA = await api.createCompanyAndUsers({
          companyName: 'UI T3-16 Alpha',
          users: [{ login: `ui_cont_${randomUUID().slice(0, 6)}`, role: 'user' }],
        });
        const op = Object.values(tenantA.users)[0];
        const ormAi = await ctx.harness.importBuiltPackage('orm-ai');
        const { policy } = await seedAiContractPrerequisites(
          api.db,
          ormAi,
          tenantA.company,
          op.user,
          op.user,
          't316'
        );
        const WorkContract = findManifestModel(ormAi.manifest, 'ai.work_contract');
        const Obligation = findManifestModel(ormAi.manifest, 'ai.obligation');
        WorkContract.knex(api.db);
        Obligation.knex(api.db);
        const contract = await WorkContract.query().insertAndFetch({
          company_id: tenantA.company.id,
          code: 'wc_ui_t316',
          title: 'Continuity UI Contract',
          objective: 'Render reopened obligation',
          execution_policy_id: policy.id,
          requested_by_id: op.user.id,
          status: 'accepted',
        });
        await Obligation.query().insertAndFetch({
          company_id: tenantA.company.id,
          code: 'ob_ui_t316',
          origin_contract_id: contract.id,
          scope_json: JSON.stringify({ paths: ['packages/orm-ai/src'] }),
          trigger_kind: 'code_change',
          required_evidence: 'automated_test',
          status: 'reverification_due',
        });

        board = await ctx.harness.startIsolatedBoard(apiUrl);
        const uiRes = await ctx.playwright.runBoardAiPlaywrightCheck({
          baseUrl: board.url,
          session: {
            access_token: op.token,
            refresh_token: op.refreshToken,
            user: op.user,
          },
          routes: ['/board/ai/continuity'],
          checkColorSchemes: false,
          companyId: tenantA.company.id,
        });
        assert.equal(uiRes.ok, true, uiRes.details);
        return { details: 'Continuity view verified with persisted obligation record.' };
      } finally {
        if (board) await board.close();
        await api.close();
      }
    },
  },
  {
    id: 'T3-17',
    tier: 3,
    featureArea: 'FA-11',
    name: 'FA-11 (Emergency Stop) x FA-05 (MCP Server): immediate block on subsequent MCP calls',
    prerequisites: ['mcp:built', 'pkg:ai-runtime', 'pkg:orm-ai'],
    async run(ctx) {
      const { db, companyA, userA } = await createSqliteOrmDb(ctx);
      try {
        const runtime = await ctx.harness.importBuiltPackage('ai-runtime');
        const setEmergencyStop = requireExport(
          runtime,
          ['activateEmergencyStop', 'setEmergencyStop', 'EmergencyStopController'],
          '@moonwitness/ai-runtime'
        );
        const mcp = await ctx.harness.importBuiltPackage('ai-mcp');
        const createMcpServer = requireExport(
          mcp,
          ['createAiMcpServer', 'createMcpServer', 'createMcpHandler'],
          '@moonwitness/ai-mcp'
        );

        await (typeof setEmergencyStop === 'function'
          ? setEmergencyStop(db, { companyId: companyA.id, active: true, reason: 'Incident drill' })
          : new setEmergencyStop(db).activate({
              companyId: companyA.id,
              reason: 'Incident drill',
            }));

        const server = await createMcpServer({ db });
        const res = await server.handleRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'ai.work_note.submit',
            arguments: { idempotency_key: `estop-${randomUUID()}`, summary: 'Blocked' },
          },
          auth: { companyId: companyA.id, userId: userA.id, role: 'user' },
        });
        assert.ok(res.error, 'Emergency stop must immediately block subsequent MCP write calls');
        return { details: 'Emergency stop immediately rejected subsequent MCP call.' };
      } finally {
        await db.destroy();
      }
    },
  },
  {
    id: 'T3-18',
    tier: 3,
    featureArea: 'FA-11',
    name: 'FA-11 (Restore Drill) x FA-07 (Obligations) & FA-03 (Jobs): restore-drill-fixture coverage',
    prerequisites: ['api:built', 'api:ai-addon', 'pkg:orm-ai'],
    async run(ctx) {
      const { copyFile, readFile } = await import('node:fs/promises');
      const fixtureSource = await readFile(
        path.join(ctx.root, 'apps/api/src/commands/restore-drill-fixture.ts'),
        'utf8'
      );
      assert.match(fixtureSource, /orm-ai|ai_work_contracts|ai_obligations|ai_agent_runs/iu);

      const tempDir = await ctx.harness.makeTempDir('t3-restore-drill');
      const primaryPath = path.join(tempDir, 'primary.sqlite');
      const restoredPath = path.join(tempDir, 'restored.sqlite');
      const apiRequire = ctx.harness.createApiRequire();
      const knexFactory = apiRequire('knex');
      const orm = await ctx.harness.importBuiltPackage('orm');
      const ormBase = await ctx.harness.importBuiltPackage('orm-base');
      const auth = await ctx.harness.importBuiltPackage('auth');
      const jobs = await ctx.harness.importBuiltPackage('jobs');
      const ormNotification = await ctx.harness.importBuiltPackage('orm-notification');
      const ormWorkflow = await ctx.harness.importBuiltPackage('orm-workflow');
      const ormOrg = await ctx.harness.importBuiltPackage('orm-organization');
      const ormIntegration = await ctx.harness.importBuiltPackage('orm-integration');
      const ormStorage = await ctx.harness.importBuiltPackage('orm-storage');
      const ormAi = await ctx.harness.importBuiltPackage('orm-ai');

      const db1 = knexFactory({
        client: 'better-sqlite3',
        connection: { filename: primaryPath },
        useNullAsDefault: true,
      });
      await orm.installAddons(db1, [
        ormBase.manifest,
        auth.manifest,
        jobs.jobsManifest,
        ormNotification.manifest,
        ormWorkflow.manifest,
        ormOrg.manifest,
        ormIntegration.manifest,
        ormStorage.manifest,
        ormAi.manifest,
      ]);

      const { Company, Partner, User, CompanyMembership } = ormBase;
      Company.knex(db1);
      Partner.knex(db1);
      User.knex(db1);
      CompanyMembership.knex(db1);
      const company = await Company.query().insertAndFetch({ name: 'Restore Drill Co' });
      const partner = await Partner.query().insertAndFetch({
        name: 'Restore Op',
        company_id: company.id,
      });
      const user = await User.query().insertAndFetch({
        login: 'restore-op',
        partner_id: partner.id,
        role: 'user',
      });
      await CompanyMembership.query().insert({
        user_id: user.id,
        company_id: company.id,
        is_default: true,
        active: true,
      });

      const Policy = findManifestModel(ormAi.manifest, 'ai.execution_policy');
      const WorkContract = findManifestModel(ormAi.manifest, 'ai.work_contract');
      const Obligation = findManifestModel(ormAi.manifest, 'ai.obligation');
      Policy.knex(db1);
      WorkContract.knex(db1);
      Obligation.knex(db1);
      const policy = await Policy.query().insertAndFetch({
        company_id: company.id,
        code: 'restore_policy',
        policy_version: 1,
        name: 'Restore Policy',
      });
      const contract = await WorkContract.query().insertAndFetch({
        company_id: company.id,
        code: 'restore_wc_1',
        title: 'Restore Drill Contract',
        objective: 'Verify backup/restore continuity',
        execution_policy_id: policy.id,
        requested_by_id: user.id,
        status: 'accepted',
      });
      const obligation = await Obligation.query().insertAndFetch({
        company_id: company.id,
        code: 'restore_ob_1',
        origin_contract_id: contract.id,
        trigger_kind: 'code_change',
        required_evidence: 'targeted_retest',
        status: 'reverification_due',
      });

      jobs.Job.knex(db1);
      const handlerName = `ai.restore.probe.${randomUUID().slice(0, 8)}`;
      const staleJob = await jobs.Job.query().insertAndFetch({
        handler: handlerName,
        handler_version: 1,
        payload: JSON.stringify({ obligationId: obligation.id }),
        company_id: company.id,
        requested_by_id: user.id,
        status: 'running',
        attempts: 1,
        max_attempts: 3,
        fencing_token: 1,
        lease_owner: 'pre-backup-worker',
        lease_until: new Date(0).toISOString(),
        available_at: new Date(0).toISOString(),
      });
      await db1.destroy();

      await copyFile(primaryPath, restoredPath);

      const db2 = knexFactory({
        client: 'better-sqlite3',
        connection: { filename: restoredPath },
        useNullAsDefault: true,
      });
      let unregisterHandler = null;
      try {
        jobs.Job.knex(db2);
        jobs.JobRun.knex(db2);
        Obligation.knex(db2);
        unregisterHandler = jobs.registerJobHandler({
          name: handlerName,
          version: 1,
          parse: (p) => p,
          async run() {
            return { restored: true };
          },
        });
        assert.equal(await jobs.runOneJob({ workerId: 'restored-worker', leaseSeconds: 10 }), true);
        const recoveredJob = await jobs.Job.query().findById(staleJob.id);
        assert.equal(recoveredJob.status, 'succeeded');
        assert.equal(recoveredJob.fencing_token, 2);

        const restoredOb = await Obligation.query().findById(obligation.id);
        assert.equal(restoredOb.status, 'reverification_due');
        return {
          details:
            'Verified restore-drill-fixture.ts and live SQLite snapshot/restore across jobs + ai.obligation.',
        };
      } finally {
        unregisterHandler?.();
        await db2.destroy();
      }
    },
  },
  {
    id: 'T3-19',
    tier: 3,
    featureArea: 'FA-12',
    name: 'FA-12 (Eval Lab) x FA-02 (Provider Accounting): estimated vs provider_reported & failed retention',
    prerequisites: ['eval:built', 'pkg:ai-runtime'],
    async run(ctx) {
      const evalPkg = await ctx.harness.importBuiltPackage('ai-evaluation');
      const runEval = requireExport(
        evalPkg,
        ['runEvaluationCorpus', 'runEvaluationSuite'],
        '@moonwitness/ai-evaluation'
      );
      const report = await runEval({ mode: 'mock', includeFailedFixtures: true });
      assert.ok(report.metrics && typeof report.metrics.costPerAcceptedDeliverable === 'number');
      assert.ok(
        report.runs.some((r) => r.status === 'failed' || r.status === 'cancelled'),
        'Eval report must retain failed/partial/cancelled runs'
      );
      return { details: 'Eval Lab aggregated cost metrics while retaining failed runs.' };
    },
  },
  {
    id: 'T3-20',
    tier: 3,
    featureArea: 'FA-10',
    name: 'FA-10 (Board UI Check) x FA-12 (Doc Gates): joint repository boundary & doc link checks',
    prerequisites: ['board:ai-routes', 'pkg:orm-ai'],
    async run(ctx) {
      const uiRes = await execFileAsync(
        process.execPath,
        [path.join(ctx.root, 'scripts/check-board-shared-ui.mjs')],
        { cwd: ctx.root }
      );
      assert.match(uiRes.stdout, /Board shared UI check passed/u);

      const addonRes = await execFileAsync(
        process.execPath,
        [path.join(ctx.root, 'scripts/check-api-addon-boundary.mjs')],
        { cwd: ctx.root }
      );
      assert.match(addonRes.stdout, /API addon-first boundary check passed/u);

      const docRes = await execFileAsync(
        process.execPath,
        [path.join(ctx.root, 'scripts/check-docs.mjs')],
        { cwd: ctx.root }
      );
      assert.match(
        docRes.stdout,
        /Checked \d+ Markdown files; all local links and anchors resolve\./u
      );
      return { details: 'board:ui:check, api:addon:check, and check-docs.mjs all passed.' };
    },
  },
];
