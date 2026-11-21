import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FEATURE_AREAS, TIER_THRESHOLDS } from '../lib/catalog.mjs';
import { BUILTIN_SECRET_PATTERNS, resolveScenarioConfig } from '../lib/playwright-helper.mjs';

export const tierInfo = {
  tier: 0,
  name: 'Harness & Baseline Platform Contracts',
  description:
    'Opaque-box self-tests for isolated SQLite Fastify boot, multi-company x-company-id isolation, INTERNAL_PREFIXES enforcement, orm-storage SHA-256, jobs/workflow/local-ai smoke, and catalog integrity.',
};

export const cases = [
  {
    id: 'T0-01',
    tier: 0,
    featureArea: 'FA-01',
    name: 'Isolated API boots Fastify buildApp on :memory: SQLite with healthy probes and auth guard',
    prerequisites: ['api:built', 'pkg:orm-storage', 'pkg:orm-base'],
    async run({ harness }) {
      const api = await harness.createIsolatedApi();
      try {
        const livez = await api.app.inject({ method: 'GET', url: '/livez' });
        assert.equal(livez.statusCode, 200);
        assert.equal(livez.json().status, 'alive');

        const readyz = await api.app.inject({ method: 'GET', url: '/readyz' });
        assert.equal(readyz.statusCode, 200);
        const readyBody = readyz.json();
        assert.equal(readyBody.status, 'healthy');
        assert.equal(readyBody.database, 'connected');
        assert.equal(readyBody.attachmentStorage, 'connected');
        assert.ok(Array.isArray(readyBody.installedAddons));
        assert.ok(readyBody.installedAddons.length > 0);

        const health = await api.app.inject({ method: 'GET', url: '/health' });
        assert.equal(health.statusCode, 200);
        assert.equal(health.json().status, 'healthy');

        const unauthModels = await api.app.inject({ method: 'GET', url: '/api/models' });
        assert.equal(unauthModels.statusCode, 401);

        const authedModels = await api.app.inject({
          method: 'GET',
          url: '/api/models',
          headers: api.authHeaders(api.superadminToken),
        });
        assert.equal(authedModels.statusCode, 200);
        assert.equal(authedModels.json().success, true);

        return {
          details: `Booted API with ${readyBody.installedAddons.length} installed addons`,
        };
      } finally {
        await api.close();
      }
    },
  },
  {
    id: 'T0-02',
    tier: 0,
    featureArea: 'FA-01',
    name: 'Multi-company x-company-id isolation & CompanyMembership enforcement',
    prerequisites: ['api:built', 'pkg:orm-storage', 'pkg:orm-base'],
    async run({ harness }) {
      const api = await harness.createIsolatedApi();
      try {
        const orgA = await api.createCompanyAndUsers({
          companyName: 'E2E Company A',
          users: [{ login: 'alice_a', password: 'test-user-pass-123', role: 'user' }],
        });
        const orgB = await api.createCompanyAndUsers({
          companyName: 'E2E Company B',
          users: [{ login: 'bob_b', password: 'test-user-pass-123', role: 'user' }],
        });

        const aliceA = orgA.users.alice_a;
        const bobB = orgB.users.bob_b;

        const meOwn = await api.app.inject({
          method: 'GET',
          url: '/auth/me',
          headers: api.authHeaders(aliceA.token, orgA.company.id),
        });
        assert.equal(meOwn.statusCode, 200);
        assert.equal(meOwn.json().data.company_id, orgA.company.id);

        const meCross = await api.app.inject({
          method: 'GET',
          url: '/auth/me',
          headers: api.authHeaders(aliceA.token, orgB.company.id),
        });
        assert.equal(meCross.statusCode, 403);
        assert.equal(meCross.json().error, 'Company access denied');

        const bobListPartners = await api.app.inject({
          method: 'GET',
          url: '/api/base.partner',
          headers: api.authHeaders(bobB.token, orgB.company.id),
        });
        assert.equal(bobListPartners.statusCode, 200);
        const bobRows = bobListPartners.json().data ?? [];
        assert.equal(
          bobRows.some((row) => row.id === aliceA.partner.id || row.company_id === orgA.company.id),
          false,
          'Company B user must not see Company A partners'
        );

        const crossPartnerRead = await api.app.inject({
          method: 'GET',
          url: `/api/base.partner/${aliceA.partner.id}`,
          headers: api.authHeaders(bobB.token, orgB.company.id),
        });
        assert.ok(
          crossPartnerRead.statusCode === 403 || crossPartnerRead.statusCode === 404,
          `Expected 403 or 404 for cross-company read, got ${crossPartnerRead.statusCode}`
        );

        return {
          details: `Verified company ${orgA.company.id} vs ${orgB.company.id} isolation`,
        };
      } finally {
        await api.close();
      }
    },
  },
  {
    id: 'T0-03',
    tier: 0,
    featureArea: 'FA-01',
    name: 'Generic REST and JSON-RPC INTERNAL_PREFIXES block even for superadmin',
    prerequisites: ['api:built', 'pkg:orm-storage', 'pkg:orm-base'],
    async run({ harness }) {
      const api = await harness.createIsolatedApi();
      try {
        const headers = api.authHeaders(api.superadminToken);

        const modelsRes = await api.app.inject({
          method: 'GET',
          url: '/api/models',
          headers,
        });
        assert.equal(modelsRes.statusCode, 200);
        const modelNames = (modelsRes.json().models ?? []).map((entry) => entry.model);
        for (const blockedPrefix of ['auth.', 'base.job', 'workflow.', 'knowledge.']) {
          assert.equal(
            modelNames.some((name) => name.startsWith(blockedPrefix)),
            false,
            `/api/models must omit internal prefix "${blockedPrefix}"`
          );
        }

        const internalEndpoints = [
          { method: 'GET', url: '/api/auth.refresh_token' },
          { method: 'GET', url: '/api/base.job' },
          { method: 'POST', url: '/api/workflow.instance', payload: {} },
          { method: 'GET', url: '/api/knowledge.bug_case' },
        ];
        for (const req of internalEndpoints) {
          const res = await api.app.inject({
            method: req.method,
            url: req.url,
            headers,
            ...(req.payload ? { payload: req.payload } : {}),
          });
          assert.equal(
            res.statusCode,
            403,
            `Expected 403 for ${req.method} ${req.url}, got ${res.statusCode}`
          );
        }

        for (const modelName of ['base.job', 'workflow.definition', 'knowledge.bug_case']) {
          const rpcRes = await api.app.inject({
            method: 'POST',
            url: '/jsonrpc',
            headers,
            payload: {
              jsonrpc: '2.0',
              id: 1,
              method: 'call',
              params: {
                service: 'object',
                method: 'execute_kw',
                args: [modelName, 'search_read', [[]], {}],
              },
            },
          });
          assert.equal(rpcRes.statusCode, 403);
          assert.equal(rpcRes.json().error.code, -32003);
        }

        return { details: 'Verified INTERNAL_PREFIXES denial on REST and JSON-RPC' };
      } finally {
        await api.close();
      }
    },
  },
  {
    id: 'T0-04',
    tier: 0,
    featureArea: 'FA-03',
    name: 'LocalFileAttachmentStorage temp dir write, read, list, delete and SHA-256 verification',
    prerequisites: ['pkg:orm-storage'],
    async run({ harness }) {
      const ormStorage = await harness.importBuiltPackage('orm-storage');
      assert.ok(ormStorage, 'orm-storage built package must load');
      const dir = await harness.makeTempDir('mw-e2e-t0-storage-');
      const storage = new ormStorage.LocalFileAttachmentStorage(dir);
      await storage.checkReady?.();

      const key = randomUUID();
      const payload = Buffer.from('MoonWitness AI Corporation deterministic artifact payload\n');
      const expectedSha256 = harness.createDeterministicHash(payload);

      const meta = await storage.put(key, payload);
      assert.equal(meta.key, key.toLowerCase());
      assert.equal(meta.sizeBytes, payload.byteLength);
      assert.equal(meta.checksum, expectedSha256);

      const readBack = await storage.get(key);
      assert.ok(readBack, 'Stored blob must be readable');
      assert.equal(harness.createDeterministicHash(readBack), expectedSha256);
      assert.deepEqual(readBack, payload);

      const listed = [];
      for await (const entry of storage.list()) {
        listed.push(entry.key);
      }
      assert.ok(listed.includes(key.toLowerCase()));

      await storage.delete(key);
      const afterDelete = await storage.get(key);
      assert.equal(afterDelete, null);

      return { details: `Verified SHA-256 ${expectedSha256.slice(0, 12)}... round-trip` };
    },
  },
  {
    id: 'T0-05',
    tier: 0,
    featureArea: 'FA-02',
    name: 'Baseline @moonwitness/jobs, @moonwitness/orm-workflow, @moonwitness/local-ai & mock provider servers',
    prerequisites: [
      'pkg:orm',
      'pkg:orm-base',
      'pkg:orm-notification',
      'pkg:jobs',
      'pkg:orm-workflow',
      'pkg:local-ai',
    ],
    async run({ harness, mocks }) {
      const requireFromApi = harness.createApiRequire();
      const knex = requireFromApi('knex');
      const orm = await harness.importBuiltPackage('orm');
      const ormBase = await harness.importBuiltPackage('orm-base');
      const ormNotification = await harness.importBuiltPackage('orm-notification');
      const jobs = await harness.importBuiltPackage('jobs');
      const ormWorkflow = await harness.importBuiltPackage('orm-workflow');
      const localAi = await harness.importBuiltPackage('local-ai');

      const db = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });

      const handlerName = `test.e2e.echo.${Date.now()}`;
      let unregisterHandler = null;
      const ollama = await mocks.startMockOllamaServer('ok');
      const cloud = await mocks.startMockCloudServer('ok');

      try {
        await orm.installAddons(db, [
          ormBase.manifest,
          jobs.jobsManifest,
          ormNotification.manifest,
          ormWorkflow.manifest,
        ]);

        // 1. Jobs smoke + idempotency
        unregisterHandler = jobs.registerJobHandler({
          name: handlerName,
          version: 1,
          parse: (payload) => payload,
          run: async (payload) => ({ ok: true, payload }),
        });
        const jobId1 = await jobs.enqueueJob(
          handlerName,
          { task: 'tier0-smoke' },
          { idempotencyKey: `tier0-idem-${Date.now()}` }
        );
        const jobId2 = await jobs.enqueueJob(
          handlerName,
          { task: 'tier0-smoke' },
          { idempotencyKey: (await jobs.Job.query().findById(jobId1)).idempotency_key }
        );
        assert.equal(jobId2, jobId1);

        const ran = await jobs.runOneJob({ workerId: 'tier0-worker', leaseSeconds: 10 });
        assert.equal(ran, true);
        const finishedJob = await jobs.Job.query().findById(jobId1);
        assert.equal(finishedJob.status, 'succeeded');

        // 2. Workflow requireDifferentActor smoke
        const company = await ormBase.Company.query().insertAndFetch({ name: 'Workflow Co' });
        const partnerA = await ormBase.Partner.query().insertAndFetch({
          name: 'Actor A',
          company_id: company.id,
        });
        const partnerB = await ormBase.Partner.query().insertAndFetch({
          name: 'Actor B',
          company_id: company.id,
        });
        const userA = await ormBase.User.query().insertAndFetch({
          login: 'wf_actor_a',
          password: 'test-user-pass-123',
          partner_id: partnerA.id,
          role: 'user',
        });
        const userB = await ormBase.User.query().insertAndFetch({
          login: 'wf_actor_b',
          password: 'test-user-pass-123',
          partner_id: partnerB.id,
          role: 'user',
        });

        await ormWorkflow.WorkflowDefinition.query().insert({
          code: 'test.tier0.review',
          name: 'Tier 0 Review',
          version: 1,
          enabled: true,
          config: JSON.stringify({
            startState: 'pending_review',
            startRoles: ['user'],
            timeoutMinutes: 60,
            resourceModels: ['base.partner'],
            transitions: [
              {
                action: 'approve',
                from: 'pending_review',
                to: 'approved',
                roles: ['user'],
                requiredApprovals: 1,
                requireDifferentActor: true,
              },
            ],
          }),
        });

        const instance = await ormWorkflow.startWorkflow(db, {
          code: 'test.tier0.review',
          companyId: company.id,
          actorId: userA.id,
          role: 'user',
          resourceModel: 'base.partner',
          resourceId: partnerA.id,
          idempotencyKey: 'tier0-wf-start-001',
        });
        assert.equal(instance.currentState, 'pending_review');

        await assert.rejects(
          () =>
            ormWorkflow.transitionWorkflow(db, {
              instanceId: instance.id,
              companyId: company.id,
              actorId: userA.id,
              role: 'user',
              action: 'approve',
              expectedRevision: instance.revision,
              idempotencyKey: 'tier0-wf-self-001',
            }),
          (err) => err instanceof ormWorkflow.WorkflowError
        );

        const approved = await ormWorkflow.transitionWorkflow(db, {
          instanceId: instance.id,
          companyId: company.id,
          actorId: userB.id,
          role: 'user',
          action: 'approve',
          expectedRevision: instance.revision,
          idempotencyKey: 'tier0-wf-peer-001',
        });
        assert.equal(approved.currentState, 'approved');
        assert.equal(approved.status, 'completed');

        // 3. local-ai + mock Ollama & Cloud server smoke
        const localConfig = localAi.readLocalAiConfig({
          AI_MODE: 'local',
          LOCAL_AI_ENDPOINT: ollama.url,
          LOCAL_AI_PROVIDER: 'ollama',
          LOCAL_AI_TIMEOUT_MS: '2000',
        });
        const localRuntime = localAi.createLocalAiRuntime(localConfig);
        const localRes = await localRuntime.generate({ prompt: 'Tier 0 local-ai smoke' });
        assert.equal(localRes.status, 'generated');
        assert.ok(ollama.calls.some((call) => call.url === '/api/generate'));

        const cloudRes = await globalThis.fetch(`${cloud.url}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'mock-cloud-model',
            messages: [{ role: 'user', content: 'hi' }],
          }),
        });
        assert.equal(cloudRes.status, 200);
        const cloudBody = await cloudRes.json();
        assert.equal(cloudBody.choices[0].finish_reason, 'stop');
        assert.equal(cloud.calls.length, 1);

        return {
          details: 'Verified jobs, workflow independence, local-ai, and mock HTTP servers',
        };
      } finally {
        unregisterHandler?.();
        await ollama.close();
        await cloud.close();
        await db.destroy();
      }
    },
  },
  {
    id: 'T0-06',
    tier: 0,
    featureArea: 'FA-12',
    name: 'E2E catalog covers all 13 feature areas and existing tier files meet coverage thresholds',
    prerequisites: [],
    async run({ root, harness }) {
      assert.equal(FEATURE_AREAS.length, 13, 'Catalog must define exactly 13 Feature Areas');
      const ids = new Set(FEATURE_AREAS.map((area) => area.id));
      assert.equal(ids.size, 13);
      for (let i = 1; i <= 13; i += 1) {
        const expectedId = `FA-${String(i).padStart(2, '0')}`;
        assert.ok(ids.has(expectedId), `Missing feature area ${expectedId}`);
      }
      assert.deepEqual(TIER_THRESHOLDS, {
        tier1PerFeature: 5,
        tier2PerFeature: 5,
        tier3Min: 13,
        tier4Min: 7,
      });

      // Pure unit assertions for Playwright helper secret patterns & scenario dispatch (no browser needed)
      assert.ok(Array.isArray(BUILTIN_SECRET_PATTERNS) && BUILTIN_SECRET_PATTERNS.length >= 3);
      const matchesAnySecret = (sample) => BUILTIN_SECRET_PATTERNS.some((re) => re.test(sample));
      assert.equal(matchesAnySecret('leaked token sk-live-abcd1234 in html'), true);
      assert.equal(matchesAnySecret('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload'), true);
      assert.equal(matchesAnySecret('MW_AI_OPENAI_API_KEY=rawsecretvalue99'), true);
      assert.equal(matchesAnySecret('Configured provider ref: MW_AI_OPENAI_API_KEY'), false);

      const drillDownCfg = resolveScenarioConfig({ scenario: 'drill-down' });
      assert.deepEqual(drillDownCfg.routes, [
        '/board/ai/hq',
        '/board/ai/mission-control',
        '/board/ai/operations',
        '/board/ai/continuity',
      ]);
      assert.equal(drillDownCfg.verifyDrillDownLinks, true);
      assert.deepEqual(drillDownCfg.requiredBadges, ['persisted', 'derived', 'ephemeral']);

      const filtersCfg = resolveScenarioConfig({ scenario: 'badges-and-filters' });
      assert.deepEqual(filtersCfg.routes, ['/board/ai/mission-control', '/board/ai/operations']);
      assert.equal(filtersCfg.verifyFilters, true);
      assert.deepEqual(filtersCfg.requiredBadges, ['persisted', 'derived', 'ephemeral']);

      const emergencyCfg = resolveScenarioConfig({ scenario: 'emergency-controls' });
      assert.equal(emergencyCfg.nonOptimisticCheck?.status, 403);
      assert.equal(emergencyCfg.nonOptimisticCheck?.apiPattern, '**/api/ai/**');

      const a11yCfg = resolveScenarioConfig({ scenario: 'a11y-reduced-motion' });
      assert.equal(a11yCfg.checkColorSchemes, true);
      assert.equal(a11yCfg.checkMobileOverflow, true);
      assert.equal(a11yCfg.verifyA11yReducedMotion, true);

      const tiersDir = path.join(root, 'tests', 'ai-e2e', 'tiers');
      const summary = {};

      const tier1Path = path.join(tiersDir, 'tier1-feature-coverage.test.mjs');
      if (existsSync(tier1Path)) {
        const mod = await import(pathToFileURL(harness.canonicalizePath(tier1Path)).href);
        assert.ok(Array.isArray(mod.cases));
        for (const area of FEATURE_AREAS) {
          const count = mod.cases.filter((c) => c.featureArea === area.id).length;
          assert.ok(
            count >= TIER_THRESHOLDS.tier1PerFeature,
            `Tier 1 ${area.id} has ${count} cases (< ${TIER_THRESHOLDS.tier1PerFeature})`
          );
        }
        summary.tier1 = mod.cases.length;
      }

      const tier2Path = path.join(tiersDir, 'tier2-boundary-cases.test.mjs');
      if (existsSync(tier2Path)) {
        const mod = await import(pathToFileURL(harness.canonicalizePath(tier2Path)).href);
        assert.ok(Array.isArray(mod.cases));
        for (const area of FEATURE_AREAS) {
          const count = mod.cases.filter((c) => c.featureArea === area.id).length;
          assert.ok(
            count >= TIER_THRESHOLDS.tier2PerFeature,
            `Tier 2 ${area.id} has ${count} cases (< ${TIER_THRESHOLDS.tier2PerFeature})`
          );
        }
        summary.tier2 = mod.cases.length;
      }

      const tier3Path = path.join(tiersDir, 'tier3-cross-feature.test.mjs');
      if (existsSync(tier3Path)) {
        const mod = await import(pathToFileURL(harness.canonicalizePath(tier3Path)).href);
        assert.ok(mod.cases.length >= TIER_THRESHOLDS.tier3Min);
        summary.tier3 = mod.cases.length;
      }

      const tier4Path = path.join(tiersDir, 'tier4-real-world.test.mjs');
      if (existsSync(tier4Path)) {
        const mod = await import(pathToFileURL(harness.canonicalizePath(tier4Path)).href);
        assert.ok(mod.cases.length >= TIER_THRESHOLDS.tier4Min);
        summary.tier4 = mod.cases.length;
      }

      return { details: 'Catalog and existing tier thresholds verified', metrics: summary };
    },
  },
];
