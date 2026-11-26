import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { accountingHttpPlugin } from '../src/http-plugin.js';
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
    await accountingHttpPlugin(app, hostContext);
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

describe('accountingHttpPlugin', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(accountingHttpPlugin);
  });

  it('rejects unauthenticated requests', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invoke('POST', '/api/accounting/journal/validate', { body: {} });
    expect(res.statusCode).toBe(401);
  });

  it('lists accounts for authenticated company', async () => {
    const harness = createHarness();
    await harness.init();

    const db = createStubDb([{ id: 1, code: '1000', name: 'Cash', type: 'asset', company_id: 10 }]);
    const res = await harness.invoke('GET', '/api/accounting/accounts', { auth: AUTH_CTX, db });
    expect(res.statusCode).toBe(200);
    const body = res.payload as { success: boolean; data: Array<{ code: string }> };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].code).toBe('1000');
  });

  it('validates and posts balanced journal entries and computes trial balance', async () => {
    const harness = createHarness();
    await harness.init();

    const lines = [
      { accountCode: '1000', debitMinor: 50000, creditMinor: 0 },
      { accountCode: '4000', debitMinor: 0, creditMinor: 50000 },
    ];

    const valRes = await harness.invoke('POST', '/api/accounting/journal/validate', {
      auth: AUTH_CTX,
      body: { lines },
    });
    expect(valRes.statusCode).toBe(200);
    expect((valRes.payload as { data: { valid: boolean } }).data.valid).toBe(true);

    const postRes = await harness.invoke('POST', '/api/accounting/journal/post', {
      auth: AUTH_CTX,
      body: { entryNo: 'JE-001', postingDate: '2026-05-01', lines },
    });
    expect(postRes.statusCode).toBe(201);
    const posted = (postRes.payload as { data: { totalDebitMinor: number; postings: unknown[] } })
      .data;
    expect(posted.totalDebitMinor).toBe(50000);
    expect(posted.postings).toHaveLength(2);

    const tbRes = await harness.invoke('POST', '/api/accounting/trial-balance', {
      auth: AUTH_CTX,
      body: { postings: posted.postings },
    });
    expect(tbRes.statusCode).toBe(200);
    expect((tbRes.payload as { data: { balanced: boolean } }).data.balanced).toBe(true);
  });

  it('posts O2C invoices and payment settlements idempotently', async () => {
    const harness = createHarness();
    await harness.init();

    const invPayload = {
      invoiceId: 'INV-100',
      kind: 'sales',
      customerId: 'CUST-1',
      currency: 'USD',
      issueDate: '2026-05-01',
      idempotencyKey: 'idem-inv-100',
      lines: [{ description: 'License', quantity: 2, unitPriceMinor: 10000, taxRateBps: 1000 }],
    };

    const invRes1 = await harness.invoke('POST', '/api/accounting/o2c/invoices', {
      auth: AUTH_CTX,
      body: invPayload,
    });
    expect(invRes1.statusCode).toBe(201);
    const invData = (invRes1.payload as { data: { totalMinor: number; taxMinor: number } }).data;
    expect(invData.totalMinor).toBe(22000);
    expect(invData.taxMinor).toBe(2000);

    const invRes2 = await harness.invoke('POST', '/api/accounting/o2c/invoices', {
      auth: AUTH_CTX,
      body: invPayload,
    });
    expect(invRes2.statusCode).toBe(201);
    expect(invRes2.payload).toEqual(invRes1.payload);

    const setRes = await harness.invoke('POST', '/api/accounting/o2c/settlements', {
      auth: AUTH_CTX,
      body: {
        settlementId: 'SET-100',
        invoiceId: 'INV-100',
        settlementDate: '2026-05-02',
        amountMinor: 22000,
        idempotencyKey: 'idem-set-100',
      },
    });
    expect(setRes.statusCode).toBe(201);
    expect(
      (setRes.payload as { data: { ledgerPosting: { totalDebitMinor: number } } }).data
        .ledgerPosting.totalDebitMinor
    ).toBe(22000);
  });
});
