import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { crmHttpPlugin } from '../src/http-plugin.js';
import { manifest } from '../src/manifest.js';

interface RecordedResponse {
  statusCode: number;
  payload: unknown;
}

interface ErrorResponse {
  success: false;
  error: string;
}

interface SuccessResponse<T> {
  success: true;
  data: T;
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
    await crmHttpPlugin(app, hostContext);
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

describe('crmHttpPlugin (INV-014 manifest.httpPlugins)', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(crmHttpPlugin);
  });

  it('rejects unauthenticated requests to /api/crm/leads/score', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost('/api/crm/leads/score', {});
    expect(res.statusCode).toBe(401);
    expect((res.payload as ErrorResponse).error).toBe('Authentication required');
  });

  it('rejects unauthenticated requests without valid companyId', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/crm/leads/score',
      {
        signals: {
          firmographicFit: 80,
          engagement: 70,
          buyingIntent: 90,
          budgetFit: 85,
          timelineUrgency: 60,
        },
      },
      { userId: 1, role: 'user' }
    );
    expect(res.statusCode).toBe(403);
    expect((res.payload as ErrorResponse).error).toBe('Active company is required');
  });

  it('scores lead successfully with valid authentication', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/crm/leads/score',
      {
        signals: {
          firmographicFit: 90,
          engagement: 85,
          buyingIntent: 95,
          budgetFit: 80,
          timelineUrgency: 70,
        },
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(200);
    const body = res.payload as SuccessResponse<{
      score: number;
      tier: string;
      breakdown: unknown;
    }>;
    expect(body.success).toBe(true);
    expect(body.data.score).toBeGreaterThan(0);
    expect(['hot', 'warm', 'cold']).toContain(body.data.tier);
  });

  it('rejects invalid signals payload', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/crm/leads/score',
      {
        signals: {
          firmographicFit: 'invalid',
        },
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(400);
  });

  it('forecasts pipeline revenue successfully', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/crm/pipeline/forecast',
      {
        deals: [
          { id: 'deal-1', stage: 'qualified', amountCents: 100000 },
          { id: 'deal-2', stage: 'proposal', amountCents: 200000 },
        ],
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(200);
    const body = res.payload as SuccessResponse<{
      totalDeals: number;
      totalGrossCents: number;
      totalWeightedCents: number;
    }>;
    expect(body.success).toBe(true);
    expect(body.data.totalDeals).toBe(2);
    expect(body.data.totalGrossCents).toBe(300000);
    expect(body.data.totalWeightedCents).toBeGreaterThan(0);
  });

  it('rejects invalid deals in pipeline forecast', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/crm/pipeline/forecast',
      {
        deals: [{ id: 'deal-1', stage: 'qualified', amountCents: -50 }],
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(400);
  });
});
