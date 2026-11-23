import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { ispHardeningHttpPlugin, manifest } from '../src/index.js';

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
    await ispHardeningHttpPlugin(app, hostContext);
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

describe('ispHardeningHttpPlugin (INV-014 addon HTTP plugin)', () => {
  it('is registered on manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toContain(ispHardeningHttpPlugin);
  });

  it('rejects unauthenticated requests on both endpoints with 401', async () => {
    const harness = createHarness();
    await harness.init();

    const res1 = await harness.invokePost('/api/isp/coa/plan', {});
    expect(res1.statusCode).toBe(401);

    const res2 = await harness.invokePost('/api/isp/accounting/aggregate', {});
    expect(res2.statusCode).toBe(401);
  });

  it('rejects requests without companyId with 403', async () => {
    const harness = createHarness();
    await harness.init();

    const res1 = await harness.invokePost('/api/isp/coa/plan', {}, { userId: 1, role: 'user' });
    expect(res1.statusCode).toBe(403);

    const res2 = await harness.invokePost(
      '/api/isp/accounting/aggregate',
      {},
      { userId: 1, role: 'user' }
    );
    expect(res2.statusCode).toBe(403);
  });

  it('evaluates POST /api/isp/coa/plan successfully with authenticated user', async () => {
    const harness = createHarness();
    await harness.init();

    const planPayload = {
      subscriberStatus: 'active',
      session: {
        sessionId: 'sess-001',
        username: 'alice',
        totalBytesUsed: 9_000_000_000,
      },
      profile: {
        name: 'Fiber 100M',
        downloadKbps: 100_000,
        uploadKbps: 50_000,
      },
      nas: {
        nasIp: '192.168.1.1',
        secret: 'testing-secret',
      },
      policy: {
        quotaBytes: 10_000_000_000,
        throttleThresholdRatio: 0.8,
      },
    };

    const res = await harness.invokePost('/api/isp/coa/plan', planPayload, {
      userId: 1,
      role: 'user',
      companyId: 10,
    });

    expect(res.statusCode).toBe(200);
    const body = res.payload as {
      success: boolean;
      data: {
        plans: Array<{ action: string; valid: boolean }>;
        dispatchable: Array<{ action: string; nasIp: string }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.plans[0]?.action).toBe('throttle');
    expect(body.data.dispatchable[0]?.action).toBe('throttle');
  });

  it('aggregates accounting packets via POST /api/isp/accounting/aggregate', async () => {
    const harness = createHarness();
    await harness.init();

    const now = 1700000000000;
    const aggregatePayload = {
      nowMs: now,
      packets: [
        {
          acctUniqueSessionId: 'uniq-1',
          acctSessionId: 's-1',
          username: 'bob',
          nasIp: '10.0.0.1',
          acctStatusType: 'Start',
          eventTimestampMs: now - 50000,
        },
        {
          acctUniqueSessionId: 'uniq-1',
          acctSessionId: 's-1',
          username: 'bob',
          nasIp: '10.0.0.1',
          acctStatusType: 'Interim-Update',
          eventTimestampMs: now - 10000,
          acctInputOctets: 5000000,
          acctOutputOctets: 15000000,
        },
      ],
      quotas: [
        {
          username: 'bob',
          quotaBytes: 10000000,
          overagePricePerGbMinor: 500,
        },
      ],
    };

    const res = await harness.invokePost('/api/isp/accounting/aggregate', aggregatePayload, {
      userId: 1,
      role: 'user',
      companyId: 10,
    });

    expect(res.statusCode).toBe(200);
    const body = res.payload as {
      success: boolean;
      data: {
        sessions: Array<{ acctUniqueSessionId: string; totalBytes: number }>;
        totalPacketsProcessed: number;
        overages: Array<{ username: string; overageBytes: number }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.totalPacketsProcessed).toBe(2);
    expect(body.data.sessions[0]?.totalBytes).toBe(20000000);
    expect(body.data.overages[0]?.username).toBe('bob');
    expect(body.data.overages[0]?.overageBytes).toBe(10000000);
  });
});
