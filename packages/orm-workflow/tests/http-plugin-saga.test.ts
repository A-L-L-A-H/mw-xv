import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { workflowHttpPlugin, manifest } from '../src/index.js';

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
    await workflowHttpPlugin(app, hostContext);
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
      header() {
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

describe('workflowHttpPlugin saga and quorum routes (INV-014)', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toContain(workflowHttpPlugin);
  });

  it('rejects unauthenticated requests on saga and quorum routes', async () => {
    const harness = createHarness();
    await harness.init();

    const res1 = await harness.invokePost('/api/workflow/saga/plan', {});
    expect(res1.statusCode).toBe(401);

    const res2 = await harness.invokePost('/api/workflow/quorum/evaluate', {});
    expect(res2.statusCode).toBe(401);
  });

  it('rejects requests missing companyId with 403', async () => {
    const harness = createHarness();
    await harness.init();

    const res1 = await harness.invokePost(
      '/api/workflow/saga/plan',
      {},
      { userId: 1, role: 'user' }
    );
    expect(res1.statusCode).toBe(403);

    const res2 = await harness.invokePost(
      '/api/workflow/quorum/evaluate',
      {},
      { userId: 1, role: 'user' }
    );
    expect(res2.statusCode).toBe(403);
  });

  it('validates and plans saga DAG via POST /api/workflow/saga/plan', async () => {
    const harness = createHarness();
    await harness.init();

    const payload = {
      steps: [
        { id: 'provision_nas', hasCompensator: true },
        { id: 'allocate_ip', dependsOn: ['provision_nas'], hasCompensator: true },
        { id: 'send_welcome_email', dependsOn: ['allocate_ip'] },
      ],
    };

    const res = await harness.invokePost('/api/workflow/saga/plan', payload, {
      userId: 1,
      role: 'user',
      companyId: 10,
    });

    expect(res.statusCode).toBe(200);
    const body = res.payload as {
      success: boolean;
      data: {
        executionOrder: string[];
        stepCount: number;
        compensationPlan: Array<{ stepId: string; hasCompensator: boolean }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.executionOrder).toEqual([
      'provision_nas',
      'allocate_ip',
      'send_welcome_email',
    ]);
    expect(body.data.stepCount).toBe(3);
    expect(body.data.compensationPlan).toHaveLength(3);
  });

  it('detects cycles and returns 400 on invalid saga DAG', async () => {
    const harness = createHarness();
    await harness.init();

    const payload = {
      steps: [
        { id: 'stepA', dependsOn: ['stepB'] },
        { id: 'stepB', dependsOn: ['stepA'] },
      ],
    };

    const res = await harness.invokePost('/api/workflow/saga/plan', payload, {
      userId: 1,
      role: 'user',
      companyId: 10,
    });

    expect(res.statusCode).toBe(400);
    const body = res.payload as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('cycle');
  });

  it('evaluates approval quorum via POST /api/workflow/quorum/evaluate', async () => {
    const harness = createHarness();
    await harness.init();

    const payload = {
      policy: {
        requiredApprovals: 2,
        eligibleApproverIds: ['user-1', 'user-2', 'user-3'],
        requesterId: 'user-0',
        enforceDistinctRoles: true,
      },
      votes: [
        {
          approverId: 'user-1',
          role: 'finance',
          decision: 'approve',
          decidedAt: new Date().toISOString(),
        },
        {
          approverId: 'user-2',
          role: 'security',
          decision: 'approve',
          decidedAt: new Date().toISOString(),
        },
      ],
    };

    const res = await harness.invokePost('/api/workflow/quorum/evaluate', payload, {
      userId: 1,
      role: 'user',
      companyId: 10,
    });

    expect(res.statusCode).toBe(200);
    const body = res.payload as {
      success: boolean;
      data: {
        status: string;
        approved: boolean;
        validApprovalCount: number;
        remainingApprovalsNeeded: number;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('approved');
    expect(body.data.approved).toBe(true);
    expect(body.data.validApprovalCount).toBe(2);
    expect(body.data.remainingApprovalsNeeded).toBe(0);
  });
});
