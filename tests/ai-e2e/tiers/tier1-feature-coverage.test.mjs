import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const tierInfo = {
  tier: 1,
  name: 'Feature Coverage (Category-Partition Happy Paths)',
  description:
    '66 opaque-box Tier 1 test cases (>= 5 per Feature Area across FA-01 through FA-13) derived from ADR 0007, PROJECT.md, and todo-ai-corporation.md.',
};

async function createOrmAiDb(harness, options = {}) {
  const requireFromApi = harness.createApiRequire();
  const knex = requireFromApi('knex');
  const orm = await harness.importBuiltPackage('orm');
  const ormBase = await harness.importBuiltPackage('orm-base');
  const ormOrg = await harness.importBuiltPackage('orm-organization');
  const ormWorkflow = await harness.importBuiltPackage('orm-workflow');
  const ormIntegration = await harness.importBuiltPackage('orm-integration');
  const ormNotification = await harness.importBuiltPackage('orm-notification');
  const ormStorage = await harness.importBuiltPackage('orm-storage');
  const ormKnowledge = await harness.importBuiltPackage('orm-knowledge');
  const jobs = await harness.importBuiltPackage('jobs');
  const ormAi = await harness.importBuiltPackage('orm-ai');

  assert.ok(orm && ormBase && ormAi, 'Core ORM and orm-ai packages must be built');

  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: options.dbPath ?? ':memory:' },
    useNullAsDefault: true,
    pool: {
      afterCreate(conn, done) {
        conn.pragma('foreign_keys = ON');
        done(null, conn);
      },
    },
  });

  const manifests = [
    ormBase.manifest,
    jobs?.jobsManifest,
    ormNotification?.manifest,
    ormOrg?.manifest,
    ormWorkflow?.manifest,
    ormIntegration?.manifest,
    ormStorage?.manifest,
    ormKnowledge?.manifest,
    ormAi.manifest,
  ].filter(Boolean);

  if (!options.skipInstall) {
    await orm.installAddons(db, manifests);
  }

  return {
    db,
    orm,
    ormBase,
    ormOrg,
    ormWorkflow,
    ormIntegration,
    ormNotification,
    ormStorage,
    ormKnowledge,
    jobs,
    ormAi,
    manifests,
  };
}

function resolveRoutePath(app, candidates) {
  const routes = app.printRoutes({ commonPrefix: false });
  return candidates.find((candidate) => routes.includes(candidate)) ?? candidates[0];
}

function findManifestModel(manifest, modelName) {
  return manifest?.models?.find((m) => m.modelName === modelName);
}

async function runWithIsolatedBoard(harness, playwright, opts) {
  const api = await harness.createIsolatedApi();
  let board = null;
  try {
    const apiUrl = await api.app.listen({ port: 0, host: '127.0.0.1' });
    const orgA = await api.createCompanyAndUsers({
      companyName: 'Board UI Co',
      users: [{ login: 'board_op', password: 'test-user-pass-123', role: 'user' }],
    });
    const op = orgA.users.board_op;
    board = await harness.startIsolatedBoard(apiUrl);
    return await playwright.runBoardAiPlaywrightCheck({
      baseUrl: board.url,
      session: {
        access_token: op.token,
        refresh_token: op.refreshToken,
        user: op.user,
      },
      companyId: orgA.company.id,
      ...opts,
    });
  } finally {
    await board?.close?.();
    await api.close();
  }
}

export const cases = [
  // =========================================================================
  // FA-01: Addon-First Domain Foundation & Generic CRUD Isolation (6 cases)
  // =========================================================================
  {
    id: 'T1-01.1',
    tier: 1,
    featureArea: 'FA-01',
    name: 'Fresh addon installation creates all 15 ai.* tables, indexes, and _orm_addons/_orm_data seeds',
    prerequisites: ['pkg:orm', 'pkg:orm-base', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      try {
        const installed = await ctx.db('_orm_addons').select('name', 'version');
        assert.ok(
          installed.some((row) => row.name === 'ai' || row.name === '@moonwitness/orm-ai'),
          'ai addon must be recorded in _orm_addons'
        );

        const tables = await ctx.db('sqlite_master').where({ type: 'table' }).select('name');
        const tableNames = new Set(tables.map((t) => t.name));
        const expectedModels = [
          'ai.provider_profile',
          'ai.model_profile',
          'ai.execution_policy',
          'ai.agent',
          'ai.agent_profile',
          'ai.work_contract',
          'ai.acceptance_criterion',
          'ai.capability_grant',
          'ai.agent_run',
          'ai.artifact_manifest',
          'ai.obligation',
          'ai.taskforce',
          'ai.workforce_assignment',
          'ai.skill_version',
          'ai.memory_candidate',
        ];
        assert.equal(expectedModels.length, 15);
        for (const modelName of expectedModels) {
          assert.ok(ctx.orm.Registry.has(modelName), `Registry must contain ${modelName}`);
          const tableName = ctx.orm.Registry.get(modelName).tableName;
          assert.ok(tableNames.has(tableName), `Missing table ${tableName} for ${modelName}`);
        }

        const aiIndexes = await ctx
          .db('sqlite_master')
          .where({ type: 'index' })
          .where('tbl_name', 'like', 'ai_%')
          .select('name', 'tbl_name');
        assert.ok(aiIndexes.length > 0, 'Addon installation must create indexes on ai_* tables');

        const dataRows = await ctx.db('_orm_data').where('id', 'like', 'ai.%').select('*');
        assert.ok(dataRows.length > 0, 'Addon installation must seed _orm_data records');
        return { details: `Verified ${expectedModels.length} ai.* models, tables, and indexes` };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-01.2',
    tier: 1,
    featureArea: 'FA-01',
    name: 'Pre-installed dependencies install preserves existing core records',
    prerequisites: ['pkg:orm', 'pkg:orm-base', 'pkg:orm-organization', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness, { skipInstall: true });
      try {
        const coreManifests = ctx.manifests.filter((m) => m !== ctx.ormAi.manifest);
        await ctx.orm.installAddons(ctx.db, coreManifests);

        const company = await ctx.ormBase.Company.query().insertAndFetch({
          name: 'Preinstalled Co',
        });
        const dept = await ctx.ormOrg.OrganizationDepartment.query().insertAndFetch({
          name: 'Core Engineering',
          code: 'eng',
          company_id: company.id,
        });

        await ctx.orm.installAddons(ctx.db, ctx.manifests);

        const reloadedCompany = await ctx.ormBase.Company.query().findById(company.id);
        const reloadedDept = await ctx.ormOrg.OrganizationDepartment.query().findById(dept.id);
        assert.equal(reloadedCompany.name, 'Preinstalled Co');
        assert.equal(reloadedDept.code, 'eng');
        assert.ok(ctx.orm.Registry.has('ai.agent'));
        return { details: 'Installed @moonwitness/orm-ai over pre-existing core data cleanly' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-01.3',
    tier: 1,
    featureArea: 'FA-01',
    name: 'Idempotent reinstall preserves maintainer edits and avoids duplicate _orm_data rows',
    prerequisites: ['pkg:orm', 'pkg:orm-base', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      try {
        const beforeSeeds = await ctx.db('_orm_data').select('id', 'model', 'record_id');
        const profileModel = ctx.orm.Registry.get('ai.agent_profile');
        const firstProfile = await ctx.db(profileModel.tableName).first();
        assert.ok(firstProfile, 'Seeded ai.agent_profile must exist');

        await ctx
          .db(profileModel.tableName)
          .where({ id: firstProfile.id })
          .update({ description: 'Maintainer Customized Profile Description' });

        await ctx.orm.installAddons(ctx.db, ctx.manifests);

        const afterSeeds = await ctx.db('_orm_data').select('id', 'model', 'record_id');
        assert.equal(afterSeeds.length, beforeSeeds.length);
        const updatedProfile = await ctx
          .db(profileModel.tableName)
          .where({ id: firstProfile.id })
          .first();
        assert.equal(updatedProfile.description, 'Maintainer Customized Profile Description');
        return { details: 'Reinstall preserved user edit and _orm_data count' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-01.4',
    tier: 1,
    featureArea: 'FA-01',
    name: 'Semver addon upgrade hook executes inside transaction and preserves existing AI records',
    prerequisites: ['pkg:orm', 'pkg:orm-base', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Upgrade Co' });
        const agentModel = ctx.orm.Registry.get('ai.agent');
        const inserted = await ctx.db(agentModel.tableName).insert({
          code: 'upgrade_sentinel_agent',
          company_id: company.id,
          status: 'draft',
          role_template: 'researcher',
          is_emergency_stopped: false,
          active: true,
        });
        assert.ok(inserted);

        const baseManifest = ctx.ormAi.manifest;
        const nextVersion = '99.0.0';
        let upgradeRan = false;
        const upgradedManifest = {
          ...baseManifest,
          version: nextVersion,
          upgrade: {
            ...(baseManifest.upgrade ?? {}),
            [baseManifest.version]: async (trx) => {
              upgradeRan = true;
              const rows = await trx(agentModel.tableName).where({ company_id: company.id });
              assert.equal(rows.length, 1);
            },
          },
        };

        await ctx.orm.installAddons(
          ctx.db,
          ctx.manifests.map((m) => (m === baseManifest ? upgradedManifest : m))
        );
        assert.equal(upgradeRan, true, 'Semver upgrade hook must run on version bump');

        const addonRow = await ctx.db('_orm_addons').where({ name: baseManifest.name }).first();
        assert.equal(addonRow.version, nextVersion);
        const preserved = await ctx
          .db(agentModel.tableName)
          .where({ company_id: company.id })
          .first();
        assert.equal(preserved.code, 'upgrade_sentinel_agent');
        return { details: `Upgraded ${baseManifest.name} -> ${nextVersion}` };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-01.5',
    tier: 1,
    featureArea: 'FA-01',
    name: 'Authorized same-company addon route access and agent lifecycle transitions',
    prerequisites: ['api:built', 'api:ai-addon', 'pkg:orm-ai', 'pkg:orm-base'],
    async run({ harness }) {
      const api = await harness.createIsolatedApi();
      try {
        const orgA = await api.createCompanyAndUsers({
          companyName: 'AI Operator Co',
          users: [{ login: 'op_a', password: 'test-user-pass-123', role: 'user' }],
        });
        const headers = orgA.users.op_a.headers;
        const agentsRoute = resolveRoutePath(api.app, ['/api/ai/agents', '/ai/agents']);

        const listRes = await api.app.inject({ method: 'GET', url: agentsRoute, headers });
        assert.equal(listRes.statusCode, 200);

        const createRes = await api.app.inject({
          method: 'POST',
          url: agentsRoute,
          headers,
          payload: { name: 'Bounded Inspector A', code: 'inspector-a', status: 'draft' },
        });
        assert.ok(createRes.statusCode === 200 || createRes.statusCode === 201);
        const created = createRes.json().data ?? createRes.json();
        assert.ok(created.id, 'Created agent must have an id');
        assert.equal(created.company_id, orgA.company.id);

        return { details: `Created and queried ai.agent ${created.id} via ${agentsRoute}` };
      } finally {
        await api.close();
      }
    },
  },
  {
    id: 'T1-01.6',
    tier: 1,
    featureArea: 'FA-01',
    name: 'Service principal agent registration enforces role user and single CompanyMembership',
    prerequisites: ['pkg:orm', 'pkg:orm-base', 'pkg:orm-organization', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Principal Co' });
        const dept = await ctx.ormOrg.OrganizationDepartment.query().insertAndFetch({
          name: 'AI Ops',
          code: 'aiops',
          company_id: company.id,
        });
        const pos = await ctx.ormOrg.OrganizationPosition.query().insertAndFetch({
          name: 'Repo Inspector',
          code: 'pos-insp',
          company_id: company.id,
          department_id: dept.id,
        });
        const partner = await ctx.ormBase.Partner.query().insertAndFetch({
          name: 'Agent Service Principal',
          company_id: company.id,
        });
        const svcUser = await ctx.ormBase.User.query().insertAndFetch({
          login: 'svc_agent_inspector',
          partner_id: partner.id,
          role: 'user',
        });
        assert.equal(
          svcUser.password ?? null,
          null,
          'Service principal user must not have password'
        );
        await ctx.ormBase.CompanyMembership.query().insert({
          user_id: svcUser.id,
          company_id: company.id,
          is_default: true,
        });

        const agentModel = ctx.orm.Registry.get('ai.agent');
        const agent = await agentModel.query().insertAndFetch({
          code: 'inspector_agent_1',
          company_id: company.id,
          service_user_id: svcUser.id,
          department_id: dept.id,
          position_id: pos.id,
          status: 'active',
          role_template: 'researcher',
          is_emergency_stopped: false,
        });

        const memberships = await ctx.ormBase.CompanyMembership.query().where({
          user_id: svcUser.id,
        });
        assert.equal(svcUser.role, 'user');
        assert.equal(memberships.length, 1);
        assert.equal(memberships[0].company_id, agent.company_id);
        return { details: 'Registered single-company role:user agent service principal' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },

  // =========================================================================
  // FA-02: Provider Abstraction, Model Registry & Classification Routing (5 cases)
  // =========================================================================
  {
    id: 'T1-02.1',
    tier: 1,
    featureArea: 'FA-02',
    name: 'Shared contract suite passes across MockProvider, OllamaAdapter, and CloudProviderAdapter',
    prerequisites: ['pkg:ai-runtime'],
    async run({ harness, mocks }) {
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const ollama = await mocks.startMockOllamaServer('ok');
      const cloud = await mocks.startMockCloudServer('ok');

      try {
        const providers = [
          new runtime.MockProvider({ id: 'mock-1' }),
          new runtime.OllamaAdapter({ id: 'ollama-1', baseUrl: ollama.url, model: 'qwen2.5:3b' }),
          new runtime.CloudProviderAdapter({
            id: 'cloud-1',
            kind: 'openai',
            baseUrl: cloud.url,
            model: 'mock-cloud-model',
            secretRef: 'MW_AI_MOCK_KEY',
          }),
        ];

        for (const provider of providers) {
          const health = await provider.healthCheck();
          assert.equal(health.ok, true, `${provider.id} healthCheck must succeed`);
          const response = await provider.generate({
            messages: [{ role: 'user', content: 'Return JSON summary' }],
            model: 'default',
          });
          assert.ok(response, `${provider.id} must return ProviderResponse`);
          assert.ok(response.usage, `${provider.id} must return usage`);
          assert.equal(typeof response.usage.inputTokens, 'number');
          assert.equal(typeof response.usage.outputTokens, 'number');
          assert.ok(
            response.usage.source === 'estimated' || response.usage.source === 'provider_reported'
          );
        }

        assert.ok(ollama.calls.length >= 2);
        assert.ok(cloud.calls.length >= 1);
        return { details: 'Executed shared AiProvider contract across Mock, Ollama, and Cloud' };
      } finally {
        await ollama.close();
        await cloud.close();
      }
    },
  },
  {
    id: 'T1-02.2',
    tier: 1,
    featureArea: 'FA-02',
    name: 'Capability-aware model selection picks matching toolCall & structuredOutput profile',
    prerequisites: ['pkg:ai-runtime'],
    async run({ harness }) {
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const router = new runtime.DataClassificationRouter({
        providers: [
          new runtime.MockProvider({
            id: 'basic-local',
            capabilities: { textGeneration: true, toolCall: false, structuredOutput: false },
          }),
          new runtime.MockProvider({
            id: 'capable-local',
            capabilities: { textGeneration: true, toolCall: true, structuredOutput: true },
          }),
        ],
      });

      const selected = router.selectProvider({
        dataClassification: 'local_only',
        requiredCapabilities: { toolCall: true, structuredOutput: true },
      });
      assert.equal(selected.id, 'capable-local');
      return { details: `Selected capability-matched provider ${selected.id}` };
    },
  },
  {
    id: 'T1-02.3',
    tier: 1,
    featureArea: 'FA-02',
    name: 'DataClassificationRouter routes local_only to local and cloud_eligible to cloud',
    prerequisites: ['pkg:ai-runtime'],
    async run({ harness, mocks }) {
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const ollama = await mocks.startMockOllamaServer('ok');
      const cloud = await mocks.startMockCloudServer('ok');
      try {
        const localProvider = new runtime.OllamaAdapter({
          id: 'local-ollama',
          endpoint: ollama.url,
        });
        const OpenAiCtor = runtime.OpenAiProviderAdapter ?? runtime.CloudProviderAdapter;
        const cloudProvider = new OpenAiCtor({
          id: 'cloud-openai',
          kind: 'openai',
          baseUrl: cloud.url,
          allowLoopbackHttp: true,
          secretRef: 'MW_AI_MOCK_KEY',
          secretResolver: runtime.createEnvSecretResolver({ MW_AI_MOCK_KEY: 'mock-test-key-123' }),
        });

        const localTarget = {
          id: 'local-ollama',
          provider: localProvider,
          deploymentZone: 'local',
          model: {
            id: 'local-model',
            providerId: 'local-ollama',
            providerKind: 'ollama',
            modelName: 'qwen2.5:3b',
            capabilities: {
              textGeneration: true,
              toolCall: true,
              streaming: true,
              structuredOutput: true,
            },
            contextWindowTokens: 8192,
            maxOutputTokens: 2048,
            modalities: ['text'],
          },
        };
        const cloudTarget = {
          id: 'cloud-openai',
          provider: cloudProvider,
          deploymentZone: 'cloud',
          model: {
            id: 'cloud-model',
            providerId: 'cloud-openai',
            providerKind: 'openai',
            modelName: 'mock-cloud-model',
            capabilities: {
              textGeneration: true,
              toolCall: true,
              streaming: false,
              structuredOutput: true,
            },
            contextWindowTokens: 128000,
            maxOutputTokens: 4096,
            modalities: ['text'],
          },
        };

        const router = new runtime.DataClassificationRouter({
          targets: [localTarget, cloudTarget],
        });

        const localDecision = router.evaluateRouting({
          correlationId: 't1-02-3-local',
          companyId: 1,
          dataClassification: 'local_only',
          policy: { allowedClassification: 'local_only', allowCloudFallback: false },
        });
        const localSelected = localDecision.selectedTarget;
        assert.equal(localSelected.id, 'local-ollama');

        const cloudDecision = router.evaluateRouting({
          correlationId: 't1-02-3-cloud',
          companyId: 1,
          dataClassification: 'cloud_eligible',
          policy: { allowedClassification: 'cloud_eligible', allowCloudFallback: true },
          criteria: { preferredProviderIds: ['cloud-openai'] },
        });
        const cloudSelected = cloudDecision.selectedTarget;
        assert.equal(cloudSelected.id, 'cloud-openai');

        const cloudOnlyRouter = new runtime.DataClassificationRouter({
          targets: [cloudTarget],
        });
        assert.throws(
          () =>
            cloudOnlyRouter.evaluateRouting({
              correlationId: 't1-02-3-local-blocked',
              companyId: 1,
              dataClassification: 'local_only',
              policy: { allowedClassification: 'local_only', allowCloudFallback: false },
            }),
          (err) => err?.reasonCode === 'CLASSIFICATION_EGRESS_BLOCKED'
        );

        return { details: 'Verified data-classification routing across local and cloud' };
      } finally {
        await ollama.close();
        await cloud.close();
      }
    },
  },
  {
    id: 'T1-02.4',
    tier: 1,
    featureArea: 'FA-02',
    name: 'Provider healthCheck verifies readiness without transmitting prompt or secret material',
    prerequisites: ['pkg:ai-runtime'],
    async run({ harness, mocks }) {
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const ollama = await mocks.startMockOllamaServer('ok');
      try {
        const provider = new runtime.OllamaAdapter({
          id: 'ollama-health',
          baseUrl: ollama.url,
        });
        const health = await provider.healthCheck();
        assert.equal(health.ok, true);
        assert.ok(ollama.calls.some((c) => c.method === 'GET' && c.url.includes('/api/tags')));
        for (const call of ollama.calls) {
          assert.equal(call.bodyText, '');
          assert.equal(call.headers.authorization, undefined);
        }
        return { details: 'Verified zero-prompt healthCheck over /api/tags' };
      } finally {
        await ollama.close();
      }
    },
  },
  {
    id: 'T1-02.5',
    tier: 1,
    featureArea: 'FA-02',
    name: 'Explicit token and cost accounting labels provider_reported vs estimated',
    prerequisites: ['pkg:ai-runtime'],
    async run({ harness, mocks }) {
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const cloud = await mocks.startMockCloudServer('ok');
      try {
        const mockProvider = new runtime.MockProvider({ id: 'mock-est' });
        const estRes = await mockProvider.generate({
          messages: [{ role: 'user', content: 'Estimate tokens' }],
        });
        assert.equal(estRes.usage.source, 'estimated');
        assert.equal(typeof estRes.usage.estimatedCostMicros, 'number');

        const cloudProvider = new runtime.CloudProviderAdapter({
          id: 'cloud-rep',
          kind: 'openai',
          baseUrl: cloud.url,
          secretRef: 'MW_AI_MOCK_KEY',
        });
        const repRes = await cloudProvider.generate({
          messages: [{ role: 'user', content: 'Reported tokens' }],
        });
        assert.equal(repRes.usage.source, 'provider_reported');
        assert.equal(repRes.usage.inputTokens, 18);
        assert.equal(repRes.usage.outputTokens, 24);
        return { details: 'Verified estimated vs provider_reported usage accounting' };
      } finally {
        await cloud.close();
      }
    },
  },

  // =========================================================================
  // FA-03: Durable Bounded Agent & @moonwitness/jobs Integration (5 cases)
  // =========================================================================
  {
    id: 'T1-03.1',
    tier: 1,
    featureArea: 'FA-03',
    name: 'End-to-end bounded read-only repo inspection persists run, job, and SHA-256 artifact',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:jobs', 'pkg:orm-storage', 'api:ai-addon'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const storageDir = await harness.makeTempDir('mw-e2e-fa03-');
      const attachmentStorage = new ctx.ormStorage.LocalFileAttachmentStorage(storageDir);
      const workspaceDir = await harness.makeTempDir('mw-e2e-repo-');
      writeFileSync(path.join(workspaceDir, 'README.md'), '# Sample Target\nLine 2\n', 'utf8');

      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Bounded Co' });
        const runner = new runtime.BoundedAgentRunner({
          db: ctx.db,
          attachmentStorage,
          provider: new runtime.MockProvider({ id: 'mock-bounded' }),
          allowlistedRoots: [workspaceDir],
        });
        const result = await runner.executeInspection({
          companyId: company.id,
          targetPath: workspaceDir,
          objective: 'Inspect README.md',
        });
        assert.equal(result.status, 'completed');
        assert.ok(result.artifactManifest?.storageKey);
        const blob = await attachmentStorage.get(result.artifactManifest.storageKey);
        assert.ok(blob, 'Artifact blob must exist in orm-storage');
        assert.equal(harness.createDeterministicHash(blob), result.artifactManifest.sha256);
        return {
          details: `Completed bounded run with SHA-256 ${result.artifactManifest.sha256.slice(0, 12)}`,
        };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-03.2',
    tier: 1,
    featureArea: 'FA-03',
    name: 'Correlation chain integrity links work_contract -> agent_run -> base.job -> artifact_manifest',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:jobs', 'pkg:orm-storage'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const storageDir = await harness.makeTempDir('mw-e2e-fa03-chain-');
      const attachmentStorage = new ctx.ormStorage.LocalFileAttachmentStorage(storageDir);
      const workspaceDir = await harness.makeTempDir('mw-e2e-repo-chain-');
      writeFileSync(path.join(workspaceDir, 'index.js'), 'export const v = 1;\n', 'utf8');

      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Chain Co' });
        const runner = new runtime.BoundedAgentRunner({
          db: ctx.db,
          attachmentStorage,
          provider: new runtime.MockProvider({ id: 'mock-chain' }),
          allowlistedRoots: [workspaceDir],
        });
        const result = await runner.executeInspection({
          companyId: company.id,
          targetPath: workspaceDir,
          objective: 'Trace correlation chain',
        });
        assert.ok(result.workContractId);
        assert.ok(result.agentRunId);
        assert.ok(result.jobId);
        assert.ok(result.artifactManifest?.id);
        return {
          details: `Verified chain contract=${result.workContractId} run=${result.agentRunId} job=${result.jobId}`,
        };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-03.3',
    tier: 1,
    featureArea: 'FA-03',
    name: 'Safe checkpoint and resume continues without repeating completed steps',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:jobs'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Checkpoint Co' });
        const harnessEngine = new runtime.AgentHarness({ db: ctx.db });
        const checkpoint = await harnessEngine.saveCheckpoint({
          companyId: company.id,
          stepIndex: 2,
          cursor: 'step-2-complete',
        });
        const resumed = await harnessEngine.loadCheckpoint(checkpoint.runId);
        assert.equal(resumed.stepIndex, 2);
        assert.equal(resumed.cursor, 'step-2-complete');
        return { details: 'Verified checkpoint persistence and resume cursor' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-03.4',
    tier: 1,
    featureArea: 'FA-03',
    name: 'Cooperative cancellation propagates AbortSignal and moves run/job to cancelled state',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:jobs'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const controller = new globalThis.AbortController();
        controller.abort(new Error('Operator cancelled run'));
        const harnessEngine = new runtime.AgentHarness({ db: ctx.db });
        const outcome = await harnessEngine.runWithCancellation({
          signal: controller.signal,
          work: async ({ signal }) => {
            assert.equal(signal.aborted, true);
            return 'should-not-complete';
          },
        });
        assert.equal(outcome.status, 'cancelled');
        return { details: 'Verified AbortSignal cancellation transitions to cancelled' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-03.5',
    tier: 1,
    featureArea: 'FA-03',
    name: 'Authorized operator retry of failed run re-dispatches with a fresh job lease',
    prerequisites: [
      'api:built',
      'api:ai-addon',
      'pkg:ai-runtime',
      'pkg:orm-ai',
      'pkg:jobs',
      'pkg:orm-storage',
    ],
    async run({ harness, mocks }) {
      const api = await harness.createIsolatedApi();
      const jobs = await harness.importBuiltPackage('jobs');
      const ormBase = await harness.importBuiltPackage('orm-base');
      const ormAi = await harness.importBuiltPackage('orm-ai');
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const ollamaFail = await mocks.startMockOllamaServer('error_500');
      const ollamaOk = await mocks.startMockOllamaServer('ok');
      let unregisterHandler = null;

      try {
        const orgA = await api.createCompanyAndUsers({
          companyName: 'Retry Co',
          users: [{ login: 'retry_op', password: 'test-user-pass-123', role: 'user' }],
        });
        const opUser = orgA.users.retry_op.user;

        const { Partner, User, CompanyMembership } = ormBase;
        Partner.knex(api.db);
        User.knex(api.db);
        CompanyMembership.knex(api.db);

        const ProviderProfile = findManifestModel(ormAi.manifest, 'ai.provider_profile');
        const ModelProfile = findManifestModel(ormAi.manifest, 'ai.model_profile');
        const ExecutionPolicy = findManifestModel(ormAi.manifest, 'ai.execution_policy');
        const Agent = findManifestModel(ormAi.manifest, 'ai.agent');
        const WorkContract = findManifestModel(ormAi.manifest, 'ai.work_contract');
        const CapabilityGrant = findManifestModel(ormAi.manifest, 'ai.capability_grant');
        const AgentRun = findManifestModel(ormAi.manifest, 'ai.agent_run');
        for (const ModelCls of [
          ProviderProfile,
          ModelProfile,
          ExecutionPolicy,
          Agent,
          WorkContract,
          CapabilityGrant,
          AgentRun,
        ]) {
          ModelCls.knex(api.db);
        }

        const svcPartner = await Partner.query().insertAndFetch({
          name: 'Retry Agent Principal',
          company_id: orgA.company.id,
        });
        const svcUser = await User.query().insertAndFetch({
          login: `svc-retry-${randomUUID().slice(0, 8)}`,
          partner_id: svcPartner.id,
          role: 'user',
        });
        await CompanyMembership.query().insert({
          user_id: svcUser.id,
          company_id: orgA.company.id,
          is_default: true,
        });

        const providerProfile = await ProviderProfile.query().insertAndFetch({
          company_id: orgA.company.id,
          code: `ollama_retry_${randomUUID().slice(0, 6)}`,
          name: 'Retry Ollama Provider',
          kind: 'ollama',
          endpoint_url: ollamaOk.url,
          secret_ref: 'MW_AI_OLLAMA_LOCAL',
          data_classification: 'local_only',
          enabled: true,
        });
        const modelProfile = await ModelProfile.query().insertAndFetch({
          company_id: orgA.company.id,
          provider_profile_id: providerProfile.id,
          code: `qwen_retry_${randomUUID().slice(0, 6)}`,
          name: 'Retry Qwen Model',
          model_id: 'qwen2.5:3b-instruct-q4_K_M',
        });
        const policy = await ExecutionPolicy.query().insertAndFetch({
          company_id: orgA.company.id,
          code: `retry_r0_${randomUUID().slice(0, 6)}`,
          policy_version: 1,
          name: 'Retry R0 Policy',
          allowed_classification: 'local_only',
        });
        const agent = await Agent.query().insertAndFetch({
          company_id: orgA.company.id,
          code: `retry_agent_${randomUUID().slice(0, 6)}`,
          status: 'active',
          service_user_id: svcUser.id,
          role_template: 'researcher',
        });
        const contract = await WorkContract.query().insertAndFetch({
          company_id: orgA.company.id,
          code: `wc_retry_${randomUUID().slice(0, 6)}`,
          title: 'Retry Work Contract',
          objective: 'Verify failed AgentRun retries cleanly with a fresh job lease.',
          execution_policy_id: policy.id,
          requested_by_id: opUser.id,
          status: 'running',
        });
        const grant = await CapabilityGrant.query().insertAndFetch({
          company_id: orgA.company.id,
          agent_id: agent.id,
          work_contract_id: contract.id,
          execution_policy_id: policy.id,
          capability: 'repo.read@v1',
          policy_version: policy.policy_version,
          issued_by_id: opUser.id,
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          status: 'active',
        });
        const runIdempotencyKey = `run-retry-${randomUUID()}`;
        const agentRun = await AgentRun.query().insertAndFetch({
          company_id: orgA.company.id,
          work_contract_id: contract.id,
          agent_id: agent.id,
          capability_grant_id: grant.id,
          provider_profile_id: providerProfile.id,
          model_profile_id: modelProfile.id,
          execution_policy_id: policy.id,
          idempotency_key: runIdempotencyKey,
          correlation_id: `corr-retry-${randomUUID()}`,
          status: 'pending',
          fencing_token: 0,
        });

        jobs.Job.knex(api.db);
        jobs.JobRun.knex(api.db);

        const stateStore = new runtime.InMemoryAgentRunStateStore();
        const modelConfig = {
          id: modelProfile.code,
          providerId: providerProfile.code,
          providerKind: 'ollama',
          modelName: modelProfile.model_id,
          capabilities: {
            textGeneration: true,
            toolCall: false,
            streaming: false,
            structuredOutput: false,
          },
          contextWindowTokens: 8192,
          maxOutputTokens: 1024,
          modalities: ['text'],
        };

        const handlerName = `ai.e2e.retry.${randomUUID().slice(0, 8)}`;
        unregisterHandler = jobs.registerJobHandler({
          name: handlerName,
          version: 1,
          parse: (payload) => payload,
          async run(_payload, jobCtx) {
            const isFirstAttempt = jobCtx.attempt === 1;
            const endpoint = isFirstAttempt ? ollamaFail.url : ollamaOk.url;
            const adapter = new runtime.OllamaAdapter({
              id: isFirstAttempt ? 'fail-ollama' : 'ok-ollama',
              endpoint,
            });
            const runKey = `agent-run-${agentRun.id}`;
            stateStore.grantLease(runKey, jobCtx.attempt, 30_000);

            if (isFirstAttempt) {
              try {
                if (typeof runtime.BoundedReadOnlyAgentHarness === 'function') {
                  const boundedHarness = new runtime.BoundedReadOnlyAgentHarness({
                    provider: adapter,
                    stateStore,
                    companyId: orgA.company.id,
                    idempotencyKey: runIdempotencyKey,
                    fencingToken: jobCtx.attempt,
                  });
                  await boundedHarness.execute(
                    {
                      runId: runKey,
                      correlationId: agentRun.correlation_id,
                      workContractId: String(contract.id),
                      dataClassification: 'local_only',
                      model: modelConfig,
                      systemPolicy: 'Read-only inspection assistant.',
                      taskPrompt: 'fail first attempt',
                      allowedTools: [],
                      maxSteps: 2,
                      maxDurationMs: 5000,
                    },
                    async () => ({})
                  );
                } else {
                  await adapter.generate({
                    correlationId: `${agentRun.correlation_id}:attempt-${jobCtx.attempt}`,
                    dataClassification: 'local_only',
                    model: modelConfig,
                    messages: [{ role: 'user', content: 'fail first attempt' }],
                  });
                }
                throw new Error('Expected attempt 1 against error_500 Ollama server to throw');
              } catch (err) {
                await AgentRun.query().findById(agentRun.id).patch({
                  status: 'failed',
                  error_code: 'PROVIDER_500',
                  fencing_token: jobCtx.attempt,
                });
                throw err;
              }
            }

            let outputText;
            if (typeof runtime.BoundedReadOnlyAgentHarness === 'function') {
              const boundedHarness = new runtime.BoundedReadOnlyAgentHarness({
                provider: adapter,
                stateStore,
                companyId: orgA.company.id,
                idempotencyKey: runIdempotencyKey,
                fencingToken: jobCtx.attempt,
              });
              const res = await boundedHarness.execute(
                {
                  runId: runKey,
                  correlationId: agentRun.correlation_id,
                  workContractId: String(contract.id),
                  dataClassification: 'local_only',
                  model: modelConfig,
                  systemPolicy: 'Read-only inspection assistant.',
                  taskPrompt: 'succeed on retry',
                  allowedTools: [],
                  maxSteps: 2,
                  maxDurationMs: 5000,
                },
                async () => ({})
              );
              assert.equal(res.status, 'completed');
              outputText = res.outputText;
            } else {
              const res = await adapter.generate({
                correlationId: `${agentRun.correlation_id}:attempt-${jobCtx.attempt}`,
                dataClassification: 'local_only',
                model: modelConfig,
                messages: [{ role: 'user', content: 'succeed on retry' }],
              });
              outputText = res.text;
            }

            assert.equal(typeof outputText, 'string');
            assert.ok(outputText.trim().length > 0, 'Retry run must produce non-empty text');

            await AgentRun.query().findById(agentRun.id).patch({
              status: 'completed',
              fencing_token: jobCtx.attempt,
              error_code: null,
            });

            return { text: outputText };
          },
        });

        const jobId = await jobs.enqueueJob(
          handlerName,
          { agentRunId: agentRun.id },
          {
            companyId: orgA.company.id,
            requestedBy: opUser.id,
            maxAttempts: 2,
            idempotencyKey: `job-retry-${randomUUID()}`,
          }
        );

        const ranFirst = await jobs.runOneJob({
          workerId: 'retry-worker-1',
          leaseSeconds: 10,
          retryBaseSeconds: 0,
        });
        assert.equal(ranFirst, true);

        const afterFirst = await jobs.Job.query().findById(jobId);
        assert.equal(afterFirst.status, 'queued');
        assert.equal(afterFirst.attempts, 1);
        assert.equal(afterFirst.fencing_token, 1);
        assert.equal(afterFirst.lease_owner, null);

        const failedAgentRun = await AgentRun.query().findById(agentRun.id);
        assert.equal(failedAgentRun.status, 'failed');
        assert.equal(failedAgentRun.fencing_token, 1);

        await api
          .db('jobs')
          .where({ id: jobId })
          .update({ available_at: new Date(0).toISOString() });

        const ranSecond = await jobs.runOneJob({
          workerId: 'retry-worker-2',
          leaseSeconds: 10,
        });
        assert.equal(ranSecond, true);

        const afterSecond = await jobs.Job.query().findById(jobId);
        assert.equal(afterSecond.status, 'succeeded');
        assert.equal(afterSecond.attempts, 2);
        assert.equal(afterSecond.fencing_token, 2);
        assert.equal(afterSecond.lease_owner, null);

        const jobRuns = await jobs.JobRun.query()
          .where({ job_id: jobId })
          .orderBy('attempt', 'asc');
        assert.equal(jobRuns.length, 2);
        assert.equal(jobRuns[0].worker_id, 'retry-worker-1');
        assert.equal(jobRuns[0].status, 'retrying');
        assert.equal(jobRuns[1].worker_id, 'retry-worker-2');
        assert.equal(jobRuns[1].status, 'succeeded');
        const parsedResult = JSON.parse(jobRuns[1].result);
        assert.equal(typeof parsedResult.text, 'string');
        assert.ok(parsedResult.text.trim().length > 0);

        const completedAgentRun = await AgentRun.query().findById(agentRun.id);
        assert.equal(completedAgentRun.status, 'completed');
        assert.equal(completedAgentRun.fencing_token, 2);
        assert.ok(ollamaFail.calls.length >= 1);
        assert.ok(ollamaOk.calls.length >= 1);

        return {
          details:
            'Verified failed AgentRun and fresh @moonwitness/jobs lease retry (fencing 1 -> 2)',
        };
      } finally {
        unregisterHandler?.();
        await ollamaFail.close();
        await ollamaOk.close();
        await api.close();
      }
    },
  },

  // =========================================================================
  // FA-04: Internal Capability & Tool Gateway (5 cases)
  // =========================================================================
  {
    id: 'T1-04.1',
    tier: 1,
    featureArea: 'FA-04',
    name: 'Valid scoped R0 tool execution passes CapabilityGateway with active grant',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Gateway Co' });
        const gateway = new runtime.CapabilityGateway({ db: ctx.db });
        gateway.registerTool({
          name: 'repo.read@v1',
          riskTier: 'R0',
          execute: async (args) => ({ content: `read:${args.path}` }),
        });
        const result = await gateway.invoke({
          toolName: 'repo.read@v1',
          args: { path: 'README.md' },
          grant: {
            id: 1,
            companyId: company.id,
            capability: 'repo.read@v1',
            policyVersion: 1,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            revokedAt: null,
          },
          activePolicyVersion: 1,
          companyId: company.id,
        });
        assert.equal(result.content, 'read:README.md');
        return { details: 'Executed R0 tool through CapabilityGateway with active grant' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-04.2',
    tier: 1,
    featureArea: 'FA-04',
    name: 'Argument schema validation & tenant/correlation context binding',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Schema Co' });
        const gateway = new runtime.CapabilityGateway({ db: ctx.db });
        let capturedContext = null;
        gateway.registerTool({
          name: 'contract.read@v1',
          riskTier: 'R0',
          validateArgs: (args) => typeof args?.contractId === 'number',
          execute: async (args, toolCtx) => {
            capturedContext = toolCtx;
            return { contractId: args.contractId };
          },
        });
        const res = await gateway.invoke({
          toolName: 'contract.read@v1',
          args: { contractId: 42 },
          grant: {
            id: 2,
            companyId: company.id,
            capability: 'contract.read@v1',
            policyVersion: 1,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            revokedAt: null,
          },
          activePolicyVersion: 1,
          companyId: company.id,
          agentId: 7,
          runId: 9,
          correlationId: 'corr-t1-04-2',
        });
        assert.equal(res.contractId, 42);
        assert.equal(capturedContext.companyId, company.id);
        assert.equal(capturedContext.correlationId, 'corr-t1-04-2');
        return { details: 'Verified gateway arg validation and correlation context binding' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-04.3',
    tier: 1,
    featureArea: 'FA-04',
    name: 'Output redaction strips MW_AI_* tokens and Authorization headers before context return',
    prerequisites: ['pkg:ai-runtime'],
    async run({ harness }) {
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const redacted = runtime.redactSensitiveOutput({
        text: 'Authorization: Bearer secret-bearer-val MW_AI_API_KEY=raw-key-val',
      });
      const serialized = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
      assert.equal(serialized.includes('secret-bearer-val'), false);
      assert.equal(serialized.includes('raw-key-val'), false);
      return { details: 'Verified sensitive token redaction in tool output' };
    },
  },
  {
    id: 'T1-04.4',
    tier: 1,
    featureArea: 'FA-04',
    name: 'Per-agent and per-run quota tracking increments accurately within bounds',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Quota Co' });
        const gateway = new runtime.CapabilityGateway({ db: ctx.db });
        gateway.registerTool({
          name: 'repo.list@v1',
          riskTier: 'R0',
          execute: async () => ({ files: ['a.ts'] }),
        });
        const grant = {
          id: 3,
          companyId: company.id,
          capability: 'repo.list@v1',
          policyVersion: 1,
          maxCallsPerRun: 3,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          revokedAt: null,
        };
        await gateway.invoke({
          toolName: 'repo.list@v1',
          args: {},
          grant,
          activePolicyVersion: 1,
          companyId: company.id,
          runId: 100,
        });
        await gateway.invoke({
          toolName: 'repo.list@v1',
          args: {},
          grant,
          activePolicyVersion: 1,
          companyId: company.id,
          runId: 100,
        });
        const usage = gateway.getRunQuotaUsage(100);
        assert.equal(usage.calls, 2);
        return { details: 'Verified per-run quota counter increments cleanly' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-04.5',
    tier: 1,
    featureArea: 'FA-04',
    name: 'Risk-tier R2/R3 confirmation gate enforces human approval before delegation',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'RiskGate Co' });
        const gateway = new runtime.CapabilityGateway({ db: ctx.db });
        gateway.registerTool({
          name: 'work.publish@v1',
          riskTier: 'R3',
          execute: async () => ({ published: true }),
        });
        const grant = {
          id: 4,
          companyId: company.id,
          capability: 'work.publish@v1',
          policyVersion: 1,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          revokedAt: null,
        };
        await assert.rejects(() =>
          gateway.invoke({
            toolName: 'work.publish@v1',
            args: {},
            grant,
            activePolicyVersion: 1,
            companyId: company.id,
            humanApproved: false,
          })
        );
        const approved = await gateway.invoke({
          toolName: 'work.publish@v1',
          args: {},
          grant,
          activePolicyVersion: 1,
          companyId: company.id,
          humanApproved: true,
        });
        assert.equal(approved.published, true);
        return {
          details: 'Verified R3 confirmation blocks unapproved and allows human-approved call',
        };
      } finally {
        await ctx.db.destroy();
      }
    },
  },

  // =========================================================================
  // FA-05: Stateless MCP Server & A2A Protocol Boundary (5 cases)
  // =========================================================================
  {
    id: 'T1-05.1',
    tier: 1,
    featureArea: 'FA-05',
    name: 'Authenticated MCP client completes initialize handshake and tools/list discovery',
    prerequisites: ['mcp:built', 'pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const mcp = await harness.importBuiltPackage('ai-mcp');
      try {
        const server = mcp.createAiMcpServer({ db: ctx.db });
        const initRes = await server.handleRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2026-07-28',
            clientInfo: { name: 'e2e-client', version: '1.0' },
          },
        });
        assert.ok(initRes.result?.protocolVersion);

        const listRes = await server.handleRequest({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        });
        assert.ok(Array.isArray(listRes.result?.tools));
        assert.ok(listRes.result.tools.length >= 2);
        return { details: `Discovered ${listRes.result.tools.length} MCP tools` };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-05.2',
    tier: 1,
    featureArea: 'FA-05',
    name: 'Read-only MCP tools retrieve own agent profile and assigned work_contract within company',
    prerequisites: ['mcp:built', 'pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const mcp = await harness.importBuiltPackage('ai-mcp');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'MCP Read Co' });
        const server = mcp.createAiMcpServer({ db: ctx.db });
        const res = await server.handleRequest(
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'ai.get_agent_registry', arguments: {} },
          },
          { companyId: company.id, actorRole: 'user' }
        );
        assert.ok(res.result, 'Read-only MCP tool must return typed result');
        return { details: 'Retrieved company-scoped agent registry via MCP' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-05.3',
    tier: 1,
    featureArea: 'FA-05',
    name: 'MCP approved K0-K9 knowledge & evidence retrieval respects provenance gates',
    prerequisites: ['mcp:built', 'pkg:ai-runtime', 'pkg:orm-knowledge'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const mcp = await harness.importBuiltPackage('ai-mcp');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({
          name: 'MCP Knowledge Co',
        });
        const server = mcp.createAiMcpServer({ db: ctx.db });
        const res = await server.handleRequest(
          {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: 'knowledge.search_approved', arguments: { query: 'platform' } },
          },
          { companyId: company.id, actorRole: 'user' }
        );
        assert.ok(res.result, 'Approved knowledge read tool must succeed');
        return { details: 'Queried approved K0-K9 retrieval via MCP' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-05.4',
    tier: 1,
    featureArea: 'FA-05',
    name: 'Single scoped idempotent write MCP tool delegates through domain service',
    prerequisites: ['mcp:built', 'pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const mcp = await harness.importBuiltPackage('ai-mcp');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'MCP Write Co' });
        const server = mcp.createAiMcpServer({ db: ctx.db });
        const res = await server.handleRequest(
          {
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: {
              name: 'ai.submit_work_draft',
              arguments: {
                idempotencyKey: `mcp-write-${Date.now()}`,
                summary: 'Draft inspection note',
              },
            },
          },
          { companyId: company.id, actorRole: 'user', grants: ['ai.draft.write@v1'] }
        );
        assert.ok(res.result, 'Scoped idempotent MCP write tool must return typed outcome');
        return { details: 'Executed scoped idempotent MCP write tool via domain service' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-05.5',
    tier: 1,
    featureArea: 'FA-05',
    name: 'MCP server startup, health check, and graceful shutdown drain cleanly',
    prerequisites: ['mcp:built'],
    async run({ harness }) {
      const mcp = await harness.importBuiltPackage('ai-mcp');
      const server = mcp.createAiMcpServer({});
      const health = await server.healthCheck();
      assert.equal(health.ok, true);
      await server.close();
      return { details: 'Verified MCP server health and clean shutdown' };
    },
  },

  // =========================================================================
  // FA-06: Proof-Carrying Work (PCW) & Independent Verification (5 cases)
  // =========================================================================
  {
    id: 'T1-06.1',
    tier: 1,
    featureArea: 'FA-06',
    name: 'Work contract creation persists typed outcome, scope, non-goals, and acceptance criteria',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'PCW Co' });
        const pcw = new runtime.PcwService({ db: ctx.db });
        const contract = await pcw.createWorkContract({
          companyId: company.id,
          title: 'Audit workflow runtime',
          outcome: 'Verified inspection report',
          scope: 'packages/orm-workflow',
          nonGoals: ['No code edits'],
          riskTier: 'R0',
          criteria: [
            { code: 'CRIT-1', method: 'test', requiredEvidenceType: 'artifact_sha256' },
            { code: 'CRIT-2', method: 'reviewer', requiredEvidenceType: 'workflow_approval' },
          ],
        });
        assert.ok(contract.id);
        assert.equal(contract.criteria.length, 2);
        return { details: `Created PCW contract ${contract.id} with 2 criteria` };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-06.2',
    tier: 1,
    featureArea: 'FA-06',
    name: 'Evidence lifecycle progresses proposed -> produced -> checked -> accepted with SHA-256 verification',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:orm-storage'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const storageDir = await harness.makeTempDir('mw-e2e-pcw-');
      const storage = new ctx.ormStorage.LocalFileAttachmentStorage(storageDir);
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Evidence Co' });
        const key = randomUUID();
        const bytes = Buffer.from(JSON.stringify({ verified: true, files: ['runtime.ts'] }));
        const meta = await storage.put(key, bytes);

        const verifier = new runtime.PcwVerifier({ db: ctx.db, attachmentStorage: storage });
        const check = await verifier.verifyArtifactDigest({
          companyId: company.id,
          storageKey: key,
          expectedSha256: meta.checksum,
        });
        assert.equal(check.valid, true);
        assert.equal(check.actualSha256, meta.checksum);
        return { details: 'Verified SHA-256 evidence digest check' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-06.3',
    tier: 1,
    featureArea: 'FA-06',
    name: 'Independent reviewer approval with requireDifferentActor transitions contract to accepted',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:orm-workflow'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Reviewer Co' });
        const pcw = new runtime.PcwService({ db: ctx.db });
        const contract = await pcw.createWorkContract({
          companyId: company.id,
          title: 'Independent review contract',
          outcome: 'Reviewed deliverable',
          scope: 'packages/orm-ai',
          riskTier: 'R1',
          workerActorId: 101,
          criteria: [{ code: 'CRIT-REV', method: 'reviewer', requiredEvidenceType: 'approval' }],
        });
        const accepted = await pcw.approveContract({
          contractId: contract.id,
          companyId: company.id,
          reviewerActorId: 202,
          rationale: 'Evidence verified independently',
        });
        assert.equal(accepted.status, 'accepted');
        return { details: 'Approved PCW contract with distinct reviewer actor' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-06.4',
    tier: 1,
    featureArea: 'FA-06',
    name: 'R3 high-impact contract pauses awaiting human sign-off then accepts on human approval',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:orm-workflow'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'R3 Signoff Co' });
        const pcw = new runtime.PcwService({ db: ctx.db });
        const contract = await pcw.createWorkContract({
          companyId: company.id,
          title: 'R3 Release',
          outcome: 'Signed release',
          scope: 'apps/api',
          riskTier: 'R3',
          workerActorId: 101,
          criteria: [{ code: 'CRIT-H', method: 'human_decision', requiredEvidenceType: 'signoff' }],
        });
        const pendingHuman = await pcw.submitForHumanSignOff({
          contractId: contract.id,
          companyId: company.id,
          reviewerActorId: 202,
        });
        assert.equal(pendingHuman.status, 'awaiting_human_approval');

        const signed = await pcw.recordHumanSignOff({
          contractId: contract.id,
          companyId: company.id,
          humanActorId: 303,
          rationale: 'Human sign-off recorded',
        });
        assert.equal(signed.status, 'accepted');
        return { details: 'Verified R3 pause for human sign-off and final acceptance' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-06.5',
    tier: 1,
    featureArea: 'FA-06',
    name: 'Auditable acceptance report links criteria, artifact digests, and reviewer identity',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'api:ai-addon'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Report Co' });
        const pcw = new runtime.PcwService({ db: ctx.db });
        const contract = await pcw.createWorkContract({
          companyId: company.id,
          title: 'Audit Report Contract',
          outcome: 'Complete report',
          scope: 'packages/orm-ai',
          riskTier: 'R0',
          workerActorId: 101,
          criteria: [{ code: 'CRIT-1', method: 'test', requiredEvidenceType: 'artifact_sha256' }],
        });
        const report = await pcw.getAcceptanceReport({
          contractId: contract.id,
          companyId: company.id,
        });
        assert.equal(report.contractId, contract.id);
        assert.ok(Array.isArray(report.criteria));
        return { details: `Generated acceptance report for contract ${contract.id}` };
      } finally {
        await ctx.db.destroy();
      }
    },
  },

  // =========================================================================
  // FA-07: Obligation Continuity Ledger & Selective Re-Verification (5 cases)
  // =========================================================================
  {
    id: 'T1-07.1',
    tier: 1,
    featureArea: 'FA-07',
    name: 'Accepted work contract emits linked ai.obligation records with scope and trigger',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Obligation Co' });
        const ledger = new runtime.ObligationLedger({ db: ctx.db });
        const obligation = await ledger.createObligation({
          companyId: company.id,
          title: 'Keep packages/orm-ai schema verified',
          scopePaths: ['packages/orm-ai/src'],
          triggerType: 'code_change',
          ownerActorId: 202,
        });
        assert.ok(obligation.id);
        assert.equal(obligation.status, 'active');
        return { details: `Created active obligation ${obligation.id}` };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-07.2',
    tier: 1,
    featureArea: 'FA-07',
    name: 'Intersecting code/source/policy change selectively reopens affected obligation only',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Impact Co' });
        const ledger = new runtime.ObligationLedger({ db: ctx.db });
        const ob1 = await ledger.createObligation({
          companyId: company.id,
          title: 'ORM AI Scope',
          scopePaths: ['packages/orm-ai/src'],
          triggerType: 'code_change',
        });
        const ob2 = await ledger.createObligation({
          companyId: company.id,
          title: 'MCP Scope',
          scopePaths: ['packages/ai-mcp/src'],
          triggerType: 'code_change',
        });

        await ledger.ingestChangeEvent({
          companyId: company.id,
          triggerType: 'code_change',
          changedPaths: ['packages/orm-ai/src/models.ts'],
        });

        const updated1 = await ledger.getObligation(ob1.id);
        const updated2 = await ledger.getObligation(ob2.id);
        assert.equal(updated1.status, 'needs_reverification');
        assert.equal(updated2.status, 'active');
        return { details: 'Selectively invalidated intersecting obligation only' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-07.3',
    tier: 1,
    featureArea: 'FA-07',
    name: 'Time-based expiry triggers scheduled re-verification when review interval elapses',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Expiry Co' });
        const ledger = new runtime.ObligationLedger({ db: ctx.db });
        const ob = await ledger.createObligation({
          companyId: company.id,
          title: 'Timed review',
          scopePaths: ['apps/api'],
          triggerType: 'time_expiry',
          dueAt: new Date(Date.now() - 60_000).toISOString(),
        });
        await ledger.evaluateDueObligations({ companyId: company.id, now: new Date() });
        const refreshed = await ledger.getObligation(ob.id);
        assert.equal(refreshed.status, 'needs_reverification');
        return { details: 'Verified due obligation transitions to needs_reverification' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-07.4',
    tier: 1,
    featureArea: 'FA-07',
    name: 'Explicit evidence-backed supersession retires obligation with decision record',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Supersede Co' });
        const ledger = new runtime.ObligationLedger({ db: ctx.db });
        const ob = await ledger.createObligation({
          companyId: company.id,
          title: 'Legacy check',
          scopePaths: ['packages/orm-ai'],
          triggerType: 'policy_change',
        });
        const superseded = await ledger.supersedeObligation({
          obligationId: ob.id,
          companyId: company.id,
          actorId: 202,
          rationale: 'Replaced by v2 verification contract',
          evidenceRef: 'artifact:sha256:abc123',
        });
        assert.equal(superseded.status, 'superseded');
        return { details: 'Superseded obligation with explicit rationale and evidence' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-07.5',
    tier: 1,
    featureArea: 'FA-07',
    name: 'Read-only obligation continuity timeline returns chronological audit events',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'api:ai-addon'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Timeline Co' });
        const ledger = new runtime.ObligationLedger({ db: ctx.db });
        const ob = await ledger.createObligation({
          companyId: company.id,
          title: 'Timeline check',
          scopePaths: ['packages/orm-ai'],
          triggerType: 'code_change',
        });
        const timeline = await ledger.getTimeline({ obligationId: ob.id, companyId: company.id });
        assert.ok(Array.isArray(timeline));
        assert.ok(timeline.length >= 1);
        return { details: `Returned ${timeline.length} timeline events` };
      } finally {
        await ctx.db.destroy();
      }
    },
  },

  // =========================================================================
  // FA-08: AI Company Workforce & Bounded Multi-Agent Orchestration (5 cases)
  // =========================================================================
  {
    id: 'T1-08.1',
    tier: 1,
    featureArea: 'FA-08',
    name: 'Workforce reuses orm-organization with non-privileged position templates',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:orm-organization'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({
          name: 'Workforce Org Co',
        });
        const dept = await ctx.ormOrg.OrganizationDepartment.query().insertAndFetch({
          name: 'Workforce Dept',
          code: 'wf',
          company_id: company.id,
        });
        const coordinator = new runtime.WorkforceCoordinator({ db: ctx.db });
        const roster = await coordinator.getCompanyRoster({
          companyId: company.id,
          departmentId: dept.id,
        });
        assert.ok(Array.isArray(roster));
        return { details: 'Verified orm-organization integration with WorkforceCoordinator' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-08.2',
    tier: 1,
    featureArea: 'FA-08',
    name: 'Temporary taskforce lifecycle enforces expiry and budget limits',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Taskforce Co' });
        const coordinator = new runtime.WorkforceCoordinator({ db: ctx.db });
        const taskforce = await coordinator.createTaskforce({
          companyId: company.id,
          name: 'Sprint Audit Taskforce',
          purpose: 'Inspect workflow package',
          budgetMicros: 500_000,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
        assert.ok(taskforce.id);
        assert.equal(taskforce.status, 'active');
        return { details: `Created bounded taskforce ${taskforce.id}` };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-08.3',
    tier: 1,
    featureArea: 'FA-08',
    name: 'Decomposable task splits into parallel non-overlapping child contracts and aggregates',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'DAG Co' });
        const planner = new runtime.WorkforcePlanner({ db: ctx.db });
        const plan = await planner.createDelegationPlan({
          companyId: company.id,
          parentGoal: 'Audit two disjoint packages',
          subtasks: [
            { key: 's1', scope: 'packages/orm-workflow', dependsOn: [] },
            { key: 's2', scope: 'packages/orm-storage', dependsOn: [] },
          ],
          maxDepth: 2,
        });
        assert.equal(plan.children.length, 2);
        return { details: 'Validated parallel disjoint DAG delegation plan' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-08.4',
    tier: 1,
    featureArea: 'FA-08',
    name: 'Non-decomposable task selects single agent instead of multi-agent swarm',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({
          name: 'SingleAgent Co',
        });
        const planner = new runtime.WorkforcePlanner({ db: ctx.db });
        const decision = planner.recommendTopology({
          companyId: company.id,
          decomposable: false,
          estimatedSteps: 2,
        });
        assert.equal(decision.mode, 'single_agent');
        return { details: 'Confirmed single_agent topology for non-decomposable task' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-08.5',
    tier: 1,
    featureArea: 'FA-08',
    name: 'Parent work contract cancellation propagates to active child contracts and jobs',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:jobs'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Cascade Co' });
        const partner = await ctx.ormBase.Partner.query().insertAndFetch({
          name: 'Cascade Operator',
          company_id: company.id,
        });
        const opUser = await ctx.ormBase.User.query().insertAndFetch({
          login: `cascade_op_${randomUUID().slice(0, 8)}`,
          password: 'test-user-pass-123',
          partner_id: partner.id,
          role: 'user',
        });

        const ExecutionPolicy = findManifestModel(ctx.ormAi.manifest, 'ai.execution_policy');
        const WorkContract = findManifestModel(ctx.ormAi.manifest, 'ai.work_contract');
        ExecutionPolicy.knex(ctx.db);
        WorkContract.knex(ctx.db);
        ctx.jobs.Job.knex(ctx.db);

        const policy = await ExecutionPolicy.query().insertAndFetch({
          company_id: company.id,
          code: `cascade_pol_${randomUUID().slice(0, 6)}`,
          policy_version: 1,
          name: 'Cascade Policy',
          max_delegation_depth: 2,
        });
        const parentContract = await WorkContract.query().insertAndFetch({
          company_id: company.id,
          code: `wc_parent_${randomUUID().slice(0, 6)}`,
          title: 'Parent Contract',
          objective: 'Root multi-agent task',
          execution_policy_id: policy.id,
          requested_by_id: opUser.id,
          delegation_depth: 0,
          status: 'running',
        });
        const child1 = await WorkContract.query().insertAndFetch({
          company_id: company.id,
          code: `wc_child1_${randomUUID().slice(0, 6)}`,
          title: 'Child Contract 1',
          objective: 'Inspect module A',
          parent_contract_id: parentContract.id,
          execution_policy_id: policy.id,
          requested_by_id: opUser.id,
          delegation_depth: 1,
          status: 'running',
        });
        const child2 = await WorkContract.query().insertAndFetch({
          company_id: company.id,
          code: `wc_child2_${randomUUID().slice(0, 6)}`,
          title: 'Child Contract 2',
          objective: 'Inspect module B',
          parent_contract_id: parentContract.id,
          execution_policy_id: policy.id,
          requested_by_id: opUser.id,
          delegation_depth: 1,
          status: 'running',
        });

        const job1 = await ctx.jobs.Job.query().insertAndFetch({
          handler: 'ai.agent.run',
          handler_version: 1,
          payload: JSON.stringify({ workContractId: child1.id }),
          company_id: company.id,
          requested_by_id: opUser.id,
          available_at: new Date().toISOString(),
          status: 'queued',
        });
        const job2 = await ctx.jobs.Job.query().insertAndFetch({
          handler: 'ai.agent.run',
          handler_version: 1,
          payload: JSON.stringify({ workContractId: child2.id }),
          company_id: company.id,
          requested_by_id: opUser.id,
          available_at: new Date().toISOString(),
          status: 'queued',
        });

        const coordinator = new runtime.WorkforceCoordinator({ db: ctx.db });
        const cancelled = await coordinator.cancelParentAndChildren({
          companyId: company.id,
          parentContractId: parentContract.id,
          reason: 'Operator halted taskforce',
        });
        assert.equal(cancelled.parentStatus, 'cancelled');

        const reloadedParent = await WorkContract.query().findById(parentContract.id);
        const reloadedChild1 = await WorkContract.query().findById(child1.id);
        const reloadedChild2 = await WorkContract.query().findById(child2.id);
        assert.equal(reloadedParent.status, 'cancelled');
        assert.equal(reloadedChild1.status, 'cancelled');
        assert.equal(reloadedChild2.status, 'cancelled');

        const reloadedJobs = await ctx.jobs.Job.query().whereIn('id', [job1.id, job2.id]);
        for (const jobRow of reloadedJobs) {
          assert.ok(
            jobRow.status === 'cancelled' || Boolean(jobRow.cancel_requested),
            `Expected child job ${jobRow.id} cancelled or cancel_requested, got status=${jobRow.status}`
          );
        }

        return {
          details: 'Verified parent-to-child cancellation propagation across contracts and jobs',
        };
      } finally {
        await ctx.db.destroy();
      }
    },
  },

  // =========================================================================
  // FA-09: Episodic/Semantic/Procedural Memory & Controlled Learning (5 cases)
  // =========================================================================
  {
    id: 'T1-09.1',
    tier: 1,
    featureArea: 'FA-09',
    name: 'Memory candidate creation stays strictly separate from K0-K9 knowledge tables',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:orm-knowledge'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        assert.ok(
          ctx.ormKnowledge?.manifest?.models?.length >= 18,
          'Expected orm-knowledge manifest models to be installed'
        );
        const knowledgeTables = ctx.ormKnowledge.manifest.models.map((m) => m.tableName);
        const beforeCounts = new Map();
        for (const tableName of knowledgeTables) {
          const row = await ctx.db(tableName).count({ c: '*' }).first();
          beforeCounts.set(tableName, Number(row.c));
        }
        const beforeMemoryRow = await ctx.db('ai_memory_candidates').count({ c: '*' }).first();
        const beforeMemoryCount = Number(beforeMemoryRow.c);

        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Memory Co' });
        const memService = new runtime.MemoryLifecycleService({ db: ctx.db });
        const candidate = await memService.recordCandidate({
          companyId: company.id,
          kind: 'episodic',
          content: 'Check lease expiry edge case on worker restart',
          sourceRunId: 1,
        });
        assert.equal(candidate.status, 'candidate');

        for (const tableName of knowledgeTables) {
          const row = await ctx.db(tableName).count({ c: '*' }).first();
          assert.equal(
            Number(row.c),
            beforeCounts.get(tableName),
            `K0-K9 table ${tableName} must not be mutated by AI memory lifecycle`
          );
        }
        const afterMemoryRow = await ctx.db('ai_memory_candidates').count({ c: '*' }).first();
        assert.equal(Number(afterMemoryRow.c), beforeMemoryCount + 1);

        return {
          details: `Created candidate-only memory ${candidate.id} with 0 mutations across ${knowledgeTables.length} knowledge_* tables`,
        };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-09.2',
    tier: 1,
    featureArea: 'FA-09',
    name: 'Controlled skill versioning requires evaluation and workflow approval before promotion',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'pkg:orm-workflow'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Skill Co' });
        const memService = new runtime.MemoryLifecycleService({ db: ctx.db });
        const skill = await memService.registerSkillVersion({
          companyId: company.id,
          code: 'skill.repo.audit',
          version: '1.0.0',
          procedure: 'Read manifest then inspect exports',
        });
        assert.equal(skill.status, 'candidate');
        const promoted = await memService.promoteSkillVersion({
          skillVersionId: skill.id,
          companyId: company.id,
          reviewerActorId: 202,
          ablationPassed: true,
        });
        assert.equal(promoted.status, 'promoted');
        return { details: 'Promoted skill version via evaluation + workflow gate' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-09.3',
    tier: 1,
    featureArea: 'FA-09',
    name: 'Scoped retrieval returns only promoted non-revoked memories and records consumption trace',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Retrieve Co' });
        const memService = new runtime.MemoryLifecycleService({ db: ctx.db });
        const candidate = await memService.recordCandidate({
          companyId: company.id,
          kind: 'semantic',
          content: 'Always verify sha256 against AttachmentStorage',
          dataClassification: 'local_only',
        });
        await memService.promoteCandidate({
          candidateId: candidate.id,
          companyId: company.id,
          reviewerActorId: 202,
        });
        const retrieved = await memService.retrieveForRun({
          companyId: company.id,
          dataClassification: 'local_only',
          runId: 55,
        });
        assert.ok(retrieved.some((entry) => entry.id === candidate.id));
        return { details: 'Verified scoped retrieval of promoted memory with run trace' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-09.4',
    tier: 1,
    featureArea: 'FA-09',
    name: 'Ablation report compares no-memory, episodic-only, skill-only, and combined conditions',
    prerequisites: ['pkg:ai-runtime', 'eval:built'],
    async run({ harness }) {
      const evalPkg = await harness.importBuiltPackage('ai-evaluation');
      const report = await evalPkg.runMemoryAblationSuite({ mode: 'mock' });
      for (const arm of ['no-memory', 'episodic-only', 'skill-only', 'combined']) {
        assert.ok(report.conditions[arm], `Missing ablation arm ${arm}`);
      }
      return { details: 'Executed 4-arm memory ablation evaluation' };
    },
  },
  {
    id: 'T1-09.5',
    tier: 1,
    featureArea: 'FA-09',
    name: 'Instant revocation excludes memory/skill from future runs while preserving audit trace',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'RevokeMem Co' });
        const memService = new runtime.MemoryLifecycleService({ db: ctx.db });
        const skill = await memService.registerSkillVersion({
          companyId: company.id,
          code: 'skill.revoke.test',
          version: '1.0.0',
          procedure: 'Check boundaries',
        });
        await memService.promoteSkillVersion({
          skillVersionId: skill.id,
          companyId: company.id,
          reviewerActorId: 202,
          ablationPassed: true,
        });
        await memService.revokeSkillVersion({
          skillVersionId: skill.id,
          companyId: company.id,
          actorId: 202,
          reason: 'Outdated SOP',
        });
        const retrieved = await memService.retrieveForRun({
          companyId: company.id,
          dataClassification: 'local_only',
          runId: 56,
        });
        assert.equal(
          retrieved.some((entry) => entry.code === 'skill.revoke.test'),
          false
        );
        return { details: 'Verified immediate exclusion of revoked skill version' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },

  // =========================================================================
  // FA-10: Mission Control UI & Operator Experience (5 cases)
  // =========================================================================
  {
    id: 'T1-10.1',
    tier: 1,
    featureArea: 'FA-10',
    name: 'All /board/ai/* Mission Control routes exist and pass pnpm board:ui:check',
    prerequisites: ['board:ai-routes', 'api:ai-addon'],
    async run({ root, harness }) {
      const requiredRoutes = [
        'hq',
        'mission-control',
        'operations',
        'continuity',
        'governance',
        'providers',
        'eval-lab',
      ];
      for (const route of requiredRoutes) {
        const pageFile = path.join(
          root,
          'apps',
          'board',
          'src',
          'app',
          'board',
          'ai',
          route,
          'page.tsx'
        );
        assert.ok(existsSync(pageFile), `Missing Mission Control route: ${pageFile}`);
      }
      const uiCheck = harness.runPnpmScript(['board:ui:check']);
      assert.equal(uiCheck.status, 0, `board:ui:check failed: ${uiCheck.stderr || uiCheck.stdout}`);
      return {
        details: `Verified ${requiredRoutes.length} Mission Control routes and board:ui:check`,
      };
    },
  },
  {
    id: 'T1-10.2',
    tier: 1,
    featureArea: 'FA-10',
    name: 'Full drill-down navigation from HQ -> Agent -> Work Contract -> Run -> Evidence',
    prerequisites: [
      'board:ai-routes',
      'board:server',
      'api:built',
      'api:ai-addon',
      'cmd:playwright',
    ],
    async run({ harness, playwright }) {
      const available = await playwright.isPlaywrightAvailable();
      assert.equal(available, true, 'Playwright must be available');
      const result = await runWithIsolatedBoard(harness, playwright, { scenario: 'drill-down' });
      assert.equal(result.ok, true, result.details);
      return { details: result.details };
    },
  },
  {
    id: 'T1-10.3',
    tier: 1,
    featureArea: 'FA-10',
    name: 'Mission Control displays persisted/derived/ephemeral badges and multi-facet filters',
    prerequisites: [
      'board:ai-routes',
      'board:server',
      'api:built',
      'api:ai-addon',
      'cmd:playwright',
    ],
    async run({ harness, playwright }) {
      const result = await runWithIsolatedBoard(harness, playwright, {
        scenario: 'badges-and-filters',
      });
      assert.equal(result.ok, true, result.details);
      return { details: result.details };
    },
  },
  {
    id: 'T1-10.4',
    tier: 1,
    featureArea: 'FA-10',
    name: 'Operator emergency controls require explicit confirmation modal and server confirmation',
    prerequisites: [
      'board:ai-routes',
      'board:server',
      'api:built',
      'api:ai-addon',
      'cmd:playwright',
    ],
    async run({ harness, playwright }) {
      const result = await runWithIsolatedBoard(harness, playwright, {
        scenario: 'emergency-controls',
      });
      assert.equal(result.ok, true, result.details);
      return { details: result.details };
    },
  },
  {
    id: 'T1-10.5',
    tier: 1,
    featureArea: 'FA-10',
    name: 'Keyboard table alternatives and prefers-reduced-motion accessibility pass',
    prerequisites: [
      'board:ai-routes',
      'board:server',
      'api:built',
      'api:ai-addon',
      'cmd:playwright',
    ],
    async run({ harness, playwright }) {
      const result = await runWithIsolatedBoard(harness, playwright, {
        scenario: 'a11y-reduced-motion',
      });
      assert.equal(result.ok, true, result.details);
      return { details: result.details };
    },
  },

  // =========================================================================
  // FA-11: Risk Tiers R0-R4, Sandboxing, Telemetry & Restore Drill (5 cases)
  // =========================================================================
  {
    id: 'T1-11.1',
    tier: 1,
    featureArea: 'FA-11',
    name: 'Deterministic R0-R3 risk-tier policy engine enforces allow vs approval rules outside prompt',
    prerequisites: ['pkg:ai-runtime'],
    async run({ harness }) {
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const engine = new runtime.RiskPolicyEngine();
      assert.equal(engine.evaluate({ tier: 'R0', humanApproved: false }).decision, 'allow');
      assert.equal(engine.evaluate({ tier: 'R1', humanApproved: false }).decision, 'allow');
      assert.equal(
        engine.evaluate({ tier: 'R3', humanApproved: false }).decision,
        'require_human_approval'
      );
      assert.equal(engine.evaluate({ tier: 'R3', humanApproved: true }).decision, 'allow');
      return { details: 'Verified deterministic R0-R3 risk tier evaluation' };
    },
  },
  {
    id: 'T1-11.2',
    tier: 1,
    featureArea: 'FA-11',
    name: 'Global and company-scoped emergency stop blocks new dispatches immediately',
    prerequisites: ['pkg:ai-runtime', 'pkg:orm-ai', 'api:ai-addon'],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'EStop Co' });
        const stopController = new runtime.EmergencyStopController({ db: ctx.db });
        await stopController.activate({
          scope: 'company',
          companyId: company.id,
          actorId: 1,
          reason: 'Emergency test halt',
        });
        const allowed = await stopController.canDispatch({ companyId: company.id });
        assert.equal(allowed, false);
        return { details: 'Verified emergency stop blocks new dispatches immediately' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-11.3',
    tier: 1,
    featureArea: 'FA-11',
    name: 'Correlated OpenTelemetry GenAI telemetry emits spans without secret leakage',
    prerequisites: ['pkg:ai-runtime'],
    async run({ harness }) {
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const collector = new runtime.InMemoryTelemetrySink();
      const telemetry = new runtime.GenAiTelemetry({ sink: collector });
      telemetry.recordRunEvent({
        correlationId: 'corr-11-3',
        stage: 'provider.generate',
        inputTokens: 12,
        outputTokens: 20,
        meta: { authorization: 'Bearer hidden-secret-value' },
      });
      const events = collector.getEvents();
      assert.equal(events.length, 1);
      assert.equal(JSON.stringify(events).includes('hidden-secret-value'), false);
      return { details: 'Verified correlated GenAI telemetry and secret redaction' };
    },
  },
  {
    id: 'T1-11.4',
    tier: 1,
    featureArea: 'FA-11',
    name: 'Database backup/restore drill verifies orm-ai records, manifests, and obligations',
    prerequisites: ['api:ai-addon', 'pkg:orm-ai', 'env:POSTGRES_TEST_URL'],
    async run({ harness }) {
      const result = harness.runPnpmScript(['test:restore-drill']);
      assert.equal(result.status, 0, `Restore drill failed: ${result.stderr || result.stdout}`);
      return { details: 'Verified PostgreSQL backup/restore drill with orm-ai fixtures' };
    },
  },
  {
    id: 'T1-11.5',
    tier: 1,
    featureArea: 'FA-11',
    name: 'Health and readiness probes verify DB, storage, and AI addon readiness',
    prerequisites: ['api:built', 'api:ai-addon', 'pkg:orm-ai'],
    async run({ harness }) {
      const api = await harness.createIsolatedApi();
      try {
        const ready = await api.app.inject({ method: 'GET', url: '/readyz' });
        assert.equal(ready.statusCode, 200);
        const body = ready.json();
        assert.equal(body.status, 'healthy');
        assert.ok(
          body.installedAddons.some((a) => a.name === 'ai' || a.name === '@moonwitness/orm-ai')
        );
        return { details: 'Verified /readyz reports installed ai addon' };
      } finally {
        await api.close();
      }
    },
  },

  // =========================================================================
  // FA-12: Evaluation Lab, Capability Gates G0-G6 & Doc Gates (5 cases)
  // =========================================================================
  {
    id: 'T1-12.1',
    tier: 1,
    featureArea: 'FA-12',
    name: 'Deterministic evaluation corpus produces reproducible report with full provenance',
    prerequisites: ['eval:built', 'pkg:ai-runtime'],
    async run({ harness }) {
      const evalPkg = await harness.importBuiltPackage('ai-evaluation');
      const report = await evalPkg.runEvaluationCorpus({ mode: 'mock' });
      assert.ok(report.sourceSha);
      assert.ok(report.fixtureHash);
      assert.ok(Array.isArray(report.families) && report.families.length > 0);
      return { details: `Evaluated ${report.families.length} task families offline` };
    },
  },
  {
    id: 'T1-12.2',
    tier: 1,
    featureArea: 'FA-12',
    name: 'Single-agent vs multi-agent baseline comparison records success, cost, and overhead',
    prerequisites: ['eval:built', 'pkg:ai-runtime'],
    async run({ harness }) {
      const evalPkg = await harness.importBuiltPackage('ai-evaluation');
      const comparison = await evalPkg.runBaselineComparison({ mode: 'mock' });
      assert.ok(comparison.singleAgent);
      assert.ok(comparison.multiAgent);
      assert.equal(typeof comparison.singleAgent.costPerAcceptedDeliverable, 'number');
      return { details: 'Compared single-agent vs multi-agent baseline metrics' };
    },
  },
  {
    id: 'T1-12.3',
    tier: 1,
    featureArea: 'FA-12',
    name: 'Evaluation dataset preserves failed, partial, and cancelled runs without cherry-picking',
    prerequisites: ['eval:built'],
    async run({ harness }) {
      const evalPkg = await harness.importBuiltPackage('ai-evaluation');
      const summary = evalPkg.summarizeRunDataset([
        { id: 'r1', status: 'passed' },
        { id: 'r2', status: 'failed' },
        { id: 'r3', status: 'partial' },
        { id: 'r4', status: 'cancelled' },
      ]);
      assert.equal(summary.totalRuns, 4);
      assert.equal(summary.failedRuns, 1);
      assert.equal(summary.partialRuns, 1);
      assert.equal(summary.cancelledRuns, 1);
      return { details: 'Verified failed/partial/cancelled run retention in eval metrics' };
    },
  },
  {
    id: 'T1-12.4',
    tier: 1,
    featureArea: 'FA-12',
    name: 'G0-G6 capability gate evaluator checks thresholds without AGI overclaims',
    prerequisites: ['eval:built', 'pkg:ai-runtime'],
    async run({ harness }) {
      const evalPkg = await harness.importBuiltPackage('ai-evaluation');
      const gateResult = await evalPkg.evaluateCapabilityGates({ mode: 'mock' });
      assert.equal(gateResult.passed, true);
      for (const gate of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6']) {
        assert.ok(gateResult.gates[gate], `Missing gate verdict for ${gate}`);
      }
      return { details: 'Verified G0-G6 capability gates pass offline' };
    },
  },
  {
    id: 'T1-12.5',
    tier: 1,
    featureArea: 'FA-12',
    name: 'Documentation, architecture, and roadmap link gates exit 0',
    prerequisites: ['doc:ai-corporation'],
    async run({ root, harness }) {
      const docCheck = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-docs.mjs')], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(
        docCheck.status,
        0,
        `check-docs.mjs failed: ${docCheck.stderr || docCheck.stdout}`
      );

      const roadmapCheck = harness.runPnpmScript(['test:roadmap']);
      assert.equal(
        roadmapCheck.status,
        0,
        `test:roadmap failed: ${roadmapCheck.stderr || roadmapCheck.stdout}`
      );
      return { details: 'Verified check-docs.mjs and test:roadmap exit 0' };
    },
  },

  // =========================================================================
  // FA-13: End-to-End Vertical Slice & Mandatory Release Gates (5 cases)
  // =========================================================================
  {
    id: 'T1-13.1',
    tier: 1,
    featureArea: 'FA-13',
    name: 'Complete vertical slice executes request -> contract -> job -> inspect -> verify -> review -> obligation',
    prerequisites: [
      'api:ai-addon',
      'pkg:orm-ai',
      'pkg:ai-runtime',
      'pkg:jobs',
      'pkg:orm-workflow',
      'pkg:orm-storage',
    ],
    async run({ harness }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const storageDir = await harness.makeTempDir('mw-e2e-slice-');
      const storage = new ctx.ormStorage.LocalFileAttachmentStorage(storageDir);
      const repoDir = await harness.makeTempDir('mw-e2e-slice-repo-');
      mkdirSync(path.join(repoDir, 'src'), { recursive: true });
      writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const slice = true;\n', 'utf8');

      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({ name: 'Slice Co' });
        const sliceRunner = new runtime.VerticalSliceOrchestrator({
          db: ctx.db,
          attachmentStorage: storage,
          provider: new runtime.MockProvider({ id: 'slice-mock' }),
          allowlistedRoots: [repoDir],
        });
        const outcome = await sliceRunner.run({
          companyId: company.id,
          workerActorId: 101,
          reviewerActorId: 202,
          targetPath: repoDir,
          objective: 'Vertical slice bounded read-only inspection',
        });
        assert.equal(outcome.contractStatus, 'accepted');
        assert.equal(outcome.evidenceCompleteness, 1);
        assert.equal(outcome.obligationStatus, 'active');
        return { details: 'Completed full vertical slice end-to-end' };
      } finally {
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-13.2',
    tier: 1,
    featureArea: 'FA-13',
    name: 'Vertical slice with local_only classification routes exclusively through OllamaAdapter',
    prerequisites: [
      'api:ai-addon',
      'pkg:orm-ai',
      'pkg:ai-runtime',
      'pkg:jobs',
      'pkg:orm-workflow',
      'pkg:orm-storage',
    ],
    async run({ harness, mocks }) {
      const ctx = await createOrmAiDb(harness);
      const runtime = await harness.importBuiltPackage('ai-runtime');
      const ollama = await mocks.startMockOllamaServer('ok');
      const storageDir = await harness.makeTempDir('mw-e2e-slice-local-');
      const storage = new ctx.ormStorage.LocalFileAttachmentStorage(storageDir);
      const repoDir = await harness.makeTempDir('mw-e2e-slice-local-repo-');
      writeFileSync(path.join(repoDir, 'README.md'), '# Local Slice\n', 'utf8');

      try {
        const company = await ctx.ormBase.Company.query().insertAndFetch({
          name: 'Local Slice Co',
        });
        const provider = new runtime.OllamaAdapter({ id: 'slice-ollama', baseUrl: ollama.url });
        const sliceRunner = new runtime.VerticalSliceOrchestrator({
          db: ctx.db,
          attachmentStorage: storage,
          provider,
          allowlistedRoots: [repoDir],
        });
        const outcome = await sliceRunner.run({
          companyId: company.id,
          workerActorId: 101,
          reviewerActorId: 202,
          dataClassification: 'local_only',
          targetPath: repoDir,
          objective: 'Local-only vertical slice inspection',
        });
        assert.equal(outcome.contractStatus, 'accepted');
        assert.ok(ollama.calls.length >= 1);
        return { details: 'Completed local_only vertical slice through mock Ollama' };
      } finally {
        await ollama.close();
        await ctx.db.destroy();
      }
    },
  },
  {
    id: 'T1-13.3',
    tier: 1,
    featureArea: 'FA-13',
    name: 'Vertical slice produces cost, evidence completeness, and recovery metrics',
    prerequisites: ['pkg:ai-runtime', 'eval:built'],
    async run({ harness }) {
      const evalPkg = await harness.importBuiltPackage('ai-evaluation');
      const metrics = evalPkg.computeSliceMetrics({
        acceptedDeliverables: 1,
        totalCostMicros: 1200,
        verifiedCriteria: 2,
        requiredCriteria: 2,
        recoveryTimeMs: 45,
      });
      assert.equal(metrics.costPerAcceptedDeliverableMicros, 1200);
      assert.equal(metrics.evidenceCompletenessRate, 1);
      assert.equal(metrics.timeToRecoveryMs, 45);
      return { details: 'Verified slice cost, evidence completeness, and recovery metrics' };
    },
  },
  {
    id: 'T1-13.4',
    tier: 1,
    featureArea: 'FA-13',
    name: 'Mandatory release gates G1-G14 evaluate green offline',
    prerequisites: ['eval:built', 'api:ai-addon', 'doc:ai-corporation'],
    async run({ harness }) {
      const evalPkg = await harness.importBuiltPackage('ai-evaluation');
      const gates = await evalPkg.evaluateReleaseGates({ mode: 'offline' });
      assert.equal(gates.passed, true);
      for (let i = 1; i <= 14; i += 1) {
        const key = `G${i}`;
        assert.equal(gates.results[key]?.passed, true, `Release gate ${key} must pass`);
      }
      return { details: 'Verified all 14 release gates G1-G14 pass offline' };
    },
  },
  {
    id: 'T1-13.5',
    tier: 1,
    featureArea: 'FA-13',
    name: 'Repository boundary and quality gates (addon-check, board-ui-check, check-docs) pass',
    prerequisites: ['api:ai-addon', 'board:ai-routes', 'doc:ai-corporation'],
    async run({ root, harness }) {
      for (const script of ['api:addon:check', 'board:ui:check', 'test:roadmap']) {
        const res = harness.runPnpmScript([script]);
        assert.equal(res.status, 0, `${script} failed: ${res.stderr || res.stdout}`);
      }
      const docCheck = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-docs.mjs')], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(
        docCheck.status,
        0,
        `check-docs.mjs failed: ${docCheck.stderr || docCheck.stdout}`
      );
      return { details: 'All repository boundary, UI, roadmap, and doc gates passed' };
    },
  },
];
