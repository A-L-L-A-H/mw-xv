import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { subscriptionMetricsHttpPlugin } from '../src/http-plugin.js';
import { manifest } from '../src/manifest.js';

interface RecordedResponse {
  statusCode: number;
  payload: unknown;
}

interface ErrorResponse {
  success: false;
  error: string;
}

interface RevenueMetricsResponse {
  success: true;
  data: {
    activeSubscriptions: number;
    mrrCents: number;
    arrCents: number;
  };
}

interface ProrationResponse {
  success: true;
  data: {
    direction: string;
    netProrationCents: number;
  };
}

type PluginApp = Parameters<AddonHttpPlugin>[0];
type RouteHandler = (
  req: AddonHttpRequestBase & { body: unknown; params: unknown; query: unknown },
  reply: AddonHttpReply
) => unknown;

function createHarness() {
  const postRoutes = new Map<string, RouteHandler>();

  const app: PluginApp = {
    get: () => {},
    post: (path: string, handler: unknown) => {
      postRoutes.set(path, handler as RouteHandler);
    },
    put: () => {},
    patch: () => {},
    delete: () => {},
  };

  const hostContext: AddonHttpHostContext = {};

  async function init() {
    await subscriptionMetricsHttpPlugin(app, hostContext);
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

  return { init, invokePost };
}

describe('subscriptionMetricsHttpPlugin (INV-014 manifest.httpPlugins)', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(subscriptionMetricsHttpPlugin);
  });

  it('rejects unauthenticated requests to /api/subscriptions/revenue/metrics', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost('/api/subscriptions/revenue/metrics', {});
    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthenticated requests to /api/subscriptions/prorate', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost('/api/subscriptions/prorate', {});
    expect(res.statusCode).toBe(401);
  });

  it('calculates revenue metrics correctly with valid authentication', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/subscriptions/revenue/metrics',
      {
        records: [
          { customerId: 'c1', interval: 'monthly', intervalPriceCents: 10000, status: 'active' },
          { customerId: 'c2', interval: 'annual', intervalPriceCents: 120000, status: 'active' },
        ],
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(200);
    const body = res.payload as RevenueMetricsResponse;
    expect(body.success).toBe(true);
    expect(body.data.activeSubscriptions).toBe(2);
    expect(body.data.mrrCents).toBe(20000);
    expect(body.data.arrCents).toBe(240000);
  });

  it('calculates proration correctly with valid authentication', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/subscriptions/prorate',
      {
        currentPlanPeriodCents: 10000,
        newPlanPeriodCents: 20000,
        cycleStart: '2026-01-01T00:00:00Z',
        cycleEnd: '2026-01-31T00:00:00Z',
        changeAt: '2026-01-16T00:00:00Z',
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(200);
    const body = res.payload as RevenueMetricsResponse;
    expect(body.success).toBe(true);
    expect(body.data.direction).toBe('upgrade');
    expect(body.data.netProrationCents).toBeGreaterThan(0);
  });

  it('rejects invalid payload on proration', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/subscriptions/prorate',
      {
        currentPlanPeriodCents: 'invalid',
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(400);
  });
});
