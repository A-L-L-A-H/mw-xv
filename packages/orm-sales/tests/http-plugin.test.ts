import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { quoteHttpPlugin } from '../src/http-plugin.js';
import { manifest } from '../src/manifest.js';

interface RecordedResponse {
  statusCode: number;
  payload: unknown;
}

interface ErrorResponse {
  success: false;
  error: string;
}

interface QuoteResponse {
  success: true;
  data: {
    quoteId: string;
    grossSubtotalCents: number;
    grandTotalCents: number;
    lines: unknown[];
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
    await quoteHttpPlugin(app, hostContext);
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

describe('quoteHttpPlugin (INV-014 manifest.httpPlugins)', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(quoteHttpPlugin);
  });

  it('rejects unauthenticated requests to /api/sales/quotes/compile', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost('/api/sales/quotes/compile', {});
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests without active company context', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/sales/quotes/compile',
      {
        quoteId: 'Q-001',
        customerId: 'cust-1',
        currency: 'USD',
        lines: [],
      },
      { userId: 1, role: 'user' }
    );
    expect(res.statusCode).toBe(403);
  });

  it('compiles quote successfully with valid auth and payload', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/sales/quotes/compile',
      {
        quoteId: 'Q-001',
        customerId: 'cust-1',
        currency: 'USD',
        lines: [
          {
            lineId: 'line-1',
            sku: 'SKU-A',
            quantity: 5,
            unitPriceCents: 2000,
            unitCostCents: 1000,
          },
        ],
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(200);
    const body = res.payload as QuoteResponse;
    expect(body.success).toBe(true);
    expect(body.data.quoteId).toBe('Q-001');
    expect(body.data.grossSubtotalCents).toBe(10000);
    expect(body.data.grandTotalCents).toBe(10000);
    expect(body.data.lines).toHaveLength(1);
  });

  it('rejects invalid quote lines payload', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/sales/quotes/compile',
      {
        quoteId: 'Q-001',
        customerId: 'cust-1',
        currency: 'USD',
        lines: [{ lineId: 'line-1' }],
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(400);
  });
});
