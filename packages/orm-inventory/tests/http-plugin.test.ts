import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { inventoryHttpPlugin } from '../src/http-plugin.js';
import { manifest } from '../src/manifest.js';

interface RecordedResponse {
  statusCode: number;
  payload: unknown;
}

type PluginApp = Parameters<AddonHttpPlugin>[0];
type RouteHandler = (
  req: AddonHttpRequestBase & { body: unknown; params: unknown; query: unknown; db?: unknown },
  reply: AddonHttpReply
) => unknown;

const AUTH_CTX: NonNullable<AddonHttpRequestBase['auth']> = {
  userId: 1,
  companyId: 10,
  roles: ['admin'],
};

function createStubDb(rows: Record<string, unknown>[]) {
  return (table: string) => ({
    where: () => ({
      orderBy: () => ({
        select: async () => rows.map((row) => ({ ...row, _table: table })),
      }),
    }),
  });
}

function createHarness() {
  const getRoutes = new Map<string, RouteHandler>();
  const postRoutes = new Map<string, RouteHandler>();

  const app: PluginApp = {
    get: (path: string, handler: unknown) => {
      getRoutes.set(path, handler as RouteHandler);
    },
    post: (path: string, handler: unknown) => {
      postRoutes.set(path, handler as RouteHandler);
    },
    put: () => {},
    patch: () => {},
    delete: () => {},
  };

  const hostContext: AddonHttpHostContext = {};

  async function init() {
    await inventoryHttpPlugin(app, hostContext);
  }

  async function invoke(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; auth?: AddonHttpRequestBase['auth']; db?: unknown } = {}
  ): Promise<RecordedResponse> {
    const handler = method === 'GET' ? getRoutes.get(path) : postRoutes.get(path);
    if (!handler) {
      throw new Error(`Route not registered: ${method} ${path}`);
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

    const req = {
      auth: opts.auth,
      body: opts.body,
      params: {},
      query: {},
      server: { db: opts.db },
    } as AddonHttpRequestBase & {
      body: unknown;
      params: unknown;
      query: unknown;
      server?: { db?: unknown };
    };

    const returned = await handler(req, reply);
    if (payload === undefined && returned !== undefined && returned !== reply) {
      payload = returned;
    }

    return { statusCode, payload };
  }

  return { init, invoke };
}

describe('inventoryHttpPlugin', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(inventoryHttpPlugin);
  });

  it('rejects unauthenticated requests', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invoke('POST', '/api/inventory/moves/validate', { body: {} });
    expect(res.statusCode).toBe(401);
  });

  it('lists warehouses for authenticated company', async () => {
    const harness = createHarness();
    await harness.init();

    const db = createStubDb([{ id: 1, code: 'WH-MAIN', name: 'Main Warehouse', company_id: 10 }]);
    const res = await harness.invoke('GET', '/api/inventory/warehouses', { auth: AUTH_CTX, db });
    expect(res.statusCode).toBe(200);
    const body = res.payload as { success: boolean; data: Array<{ code: string }> };
    expect(body.success).toBe(true);
    expect(body.data[0].code).toBe('WH-MAIN');
  });

  it('validates and applies stock moves and computes stock valuation', async () => {
    const harness = createHarness();
    await harness.init();

    const move = {
      moveNo: 'SM-001',
      sku: 'SKU-WIDGET',
      moveType: 'receipt',
      quantity: 25,
      destWarehouseCode: 'WH-MAIN',
    };

    const valRes = await harness.invoke('POST', '/api/inventory/moves/validate', {
      auth: AUTH_CTX,
      body: move,
    });
    expect(valRes.statusCode).toBe(200);
    expect((valRes.payload as { data: { valid: boolean } }).data.valid).toBe(true);

    const applyRes = await harness.invoke('POST', '/api/inventory/moves/apply', {
      auth: AUTH_CTX,
      body: { levels: [], move },
    });
    expect(applyRes.statusCode).toBe(200);
    const updatedLevels = (
      applyRes.payload as { data: { levels: Array<{ sku: string; quantityOnHand: number }> } }
    ).data.levels;
    expect(updatedLevels).toHaveLength(1);
    expect(updatedLevels[0].quantityOnHand).toBe(25);

    const valuationRes = await harness.invoke('POST', '/api/inventory/valuation', {
      auth: AUTH_CTX,
      body: {
        levels: [{ sku: 'SKU-WIDGET', quantityOnHand: 25, unitCostMinor: 400 }],
      },
    });
    expect(valuationRes.statusCode).toBe(200);
    expect((valuationRes.payload as { data: { totalValueMinor: number } }).data.totalValueMinor).toBe(
      10000
    );
  });
});
