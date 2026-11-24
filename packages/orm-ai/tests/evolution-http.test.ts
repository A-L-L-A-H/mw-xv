import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { evolutionHttpPlugin, manifest } from '../src/index.js';

interface RecordedResponse {
  statusCode: number;
  payload: unknown;
}

type PluginApp = Parameters<AddonHttpPlugin>[0];
type PostHandler = (
  req: AddonHttpRequestBase & { body: unknown; params: unknown; query: unknown },
  reply: AddonHttpReply
) => unknown;

function createHarness() {
  const postRoutes = new Map<string, PostHandler>();

  const app: PluginApp = {
    get: () => {},
    post: (path, handler) => {
      postRoutes.set(path, handler as unknown as PostHandler);
    },
    put: () => {},
    patch: () => {},
    delete: () => {},
  };

  const hostContext: AddonHttpHostContext = {};

  async function init() {
    await evolutionHttpPlugin(app, hostContext);
  }

  async function invokePost(
    path: string,
    body: unknown,
    auth?: AddonHttpRequestBase['auth']
  ): Promise<RecordedResponse> {
    const handler = postRoutes.get(path);
    if (!handler) {
      throw new Error(`Route not registered: POST ${path}`);
    }

    let statusCode = 200;
    let payload: unknown;

    const reply: AddonHttpReply = {
      code(status: number) {
        statusCode = status;
        return reply;
      },
      send(value: unknown) {
        payload = value;
        return reply;
      },
    };

    const req: AddonHttpRequestBase & { body: unknown; params: unknown; query: unknown } = {
      auth,
      body,
      params: {},
      query: {},
    };

    const returned = await handler(req, reply);
    if (payload === undefined && returned !== undefined && returned !== reply) {
      payload = returned;
    }

    return { statusCode, payload };
  }

  return { init, invokePost, postRoutes };
}

describe('evolutionHttpPlugin (INV-014 addon HTTP plugin)', () => {
  it('is mounted in orm-ai manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toContain(evolutionHttpPlugin);
  });

  it('rejects unauthenticated and company-less requests with 401/403', async () => {
    const harness = createHarness();
    await harness.init();

    const unauth = await harness.invokePost('/ai/evolution/synthesize', {});
    expect(unauth.statusCode).toBe(401);

    const noCompany = await harness.invokePost(
      '/ai/evolution/synthesize',
      {},
      {
        userId: 1,
        role: 'user',
      }
    );
    expect(noCompany.statusCode).toBe(403);
  });

  it('synthesizes candidate-only evolution proposals on verified Proof Gate runs', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/ai/evolution/synthesize',
      {
        runId: 'run-42',
        workContractId: 'wc-99',
        proofGatePassed: true,
        checks: [{ name: 'vitest', passed: true, summary: '12/12 passed' }],
        diffSummary: 'Added deterministic drift check',
        lessons: ['Always verify SHA-256 digests before approval'],
      },
      { userId: 7, role: 'user', companyId: 10 }
    );

    expect(res.statusCode).toBe(200);
    const body = res.payload as {
      success: boolean;
      data: {
        accepted: boolean;
        candidates: Array<{
          candidateOnly: boolean;
          requiresHumanApproval: boolean;
          automatedPromotionAllowed: boolean;
          companyId: number;
        }>;
        synthesisSha256: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.accepted).toBe(true);
    expect(body.data.candidates.length).toBeGreaterThan(0);
    expect(body.data.synthesisSha256).toMatch(/^[a-f0-9]{64}$/u);
    for (const candidate of body.data.candidates) {
      expect(candidate.companyId).toBe(10);
      expect(candidate.candidateOnly).toBe(true);
      expect(candidate.requiresHumanApproval).toBe(true);
      expect(candidate.automatedPromotionAllowed).toBe(false);
    }
  });

  it('fails closed on unverified Proof Gate runs and blocks cross-company synthesis', async () => {
    const harness = createHarness();
    await harness.init();

    const failedGate = await harness.invokePost(
      '/ai/evolution/synthesize',
      {
        runId: 'run-43',
        workContractId: 'wc-100',
        proofGatePassed: false,
        checks: [{ name: 'vitest', passed: false }],
        diffSummary: 'Broken patch',
        lessons: ['Do not promote'],
      },
      { userId: 7, role: 'user', companyId: 10 }
    );
    expect(failedGate.statusCode).toBe(200);
    const failedBody = failedGate.payload as {
      success: boolean;
      data: { accepted: boolean; reason?: string; candidates: unknown[] };
    };
    expect(failedBody.data.accepted).toBe(false);
    expect(failedBody.data.reason).toBe('PROOF_GATE_NOT_PASSED');
    expect(failedBody.data.candidates).toEqual([]);

    const crossCompany = await harness.invokePost(
      '/ai/evolution/synthesize',
      {
        companyId: 999,
        runId: 'run-44',
        workContractId: 'wc-101',
        proofGatePassed: true,
        checks: [],
        diffSummary: 'Cross tenant attempt',
        lessons: [],
      },
      { userId: 7, role: 'user', companyId: 10 }
    );
    expect(crossCompany.statusCode).toBe(403);
  });

  it('evaluates candidate ablation gate deterministically with human workflow approval required', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/ai/evolution/evaluate-ablation',
      {
        candidateId: 'cand-skill-01',
        baselineResults: [
          { caseId: 'c1', passed: true },
          { caseId: 'c2', passed: false },
        ],
        candidateResults: [
          { caseId: 'c1', passed: true },
          { caseId: 'c2', passed: true },
        ],
      },
      { userId: 7, role: 'user', companyId: 10 }
    );

    expect(res.statusCode).toBe(200);
    const body = res.payload as {
      success: boolean;
      data: {
        eligibleForWorkflowPromotion: boolean;
        passRateDelta: number;
        regressionCount: number;
        harmCount: number;
        gateSha256: string;
        requiresHumanWorkflowApproval: boolean;
        automatedPromotionAllowed: boolean;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.eligibleForWorkflowPromotion).toBe(true);
    expect(body.data.passRateDelta).toBeGreaterThan(0);
    expect(body.data.regressionCount).toBe(0);
    expect(body.data.harmCount).toBe(0);
    expect(body.data.gateSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(body.data.requiresHumanWorkflowApproval).toBe(true);
    expect(body.data.automatedPromotionAllowed).toBe(false);
  });

  it('scans company-scoped obligations against world/PaaS snapshot and emits advisory proposals', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/ai/obligations/scan',
      {
        obligations: [
          {
            id: 'ob-1',
            companyId: 10,
            title: 'Production mesh node health',
            expectedRepoGitSha: 'abc123',
            expectedPaasNodeIds: ['node-prod-1'],
          },
          {
            id: 'ob-other',
            companyId: 20,
            title: 'Other company obligation',
            expectedRepoGitSha: 'def456',
          },
        ],
        worldSnapshot: {
          observedAt: '2026-11-23T09:00:00.000Z',
          repoGitSha: 'xyz999',
          paasNodes: [
            {
              nodeId: 'node-prod-1',
              dockerStatus: 'degraded',
              easyTierMeshOnline: false,
            },
          ],
        },
      },
      { userId: 7, role: 'user', companyId: 10 }
    );

    expect(res.statusCode).toBe(200);
    const body = res.payload as {
      success: boolean;
      data: {
        companyId: number;
        reportSha256: string;
        summary: { breached: number; skippedCrossCompany: number };
        proposals: Array<{ advisoryOnly: boolean; automatedSelfAccept: boolean }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.companyId).toBe(10);
    expect(body.data.reportSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(body.data.summary.breached).toBe(1);
    expect(body.data.summary.skippedCrossCompany).toBe(1);
    expect(body.data.proposals).toHaveLength(1);
    expect(body.data.proposals[0]?.advisoryOnly).toBe(true);
    expect(body.data.proposals[0]?.automatedSelfAccept).toBe(false);
  });
});
