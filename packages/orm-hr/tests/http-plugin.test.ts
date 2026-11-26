import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { hrHttpPlugin } from '../src/http-plugin.js';
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
    await hrHttpPlugin(app, hostContext);
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

describe('hrHttpPlugin', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(hrHttpPlugin);
  });

  it('rejects unauthenticated requests', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invoke('POST', '/api/hr/leave/validate', { body: {} });
    expect(res.statusCode).toBe(401);
  });

  it('lists departments for authenticated company', async () => {
    const harness = createHarness();
    await harness.init();

    const db = createStubDb([{ id: 1, code: 'DEPT-GEN', name: 'General Operations', company_id: 10 }]);
    const res = await harness.invoke('GET', '/api/hr/departments', { auth: AUTH_CTX, db });
    expect(res.statusCode).toBe(200);
    const body = res.payload as { success: boolean; data: Array<{ code: string }> };
    expect(body.success).toBe(true);
    expect(body.data[0].code).toBe('DEPT-GEN');
  });

  it('calculates leave days, validates leave requests, and calculates payroll', async () => {
    const harness = createHarness();
    await harness.init();

    const daysRes = await harness.invoke('POST', '/api/hr/leave/days', {
      auth: AUTH_CTX,
      body: { startDate: '2026-06-01', endDate: '2026-06-05' },
    });
    expect(daysRes.statusCode).toBe(200);
    expect((daysRes.payload as { data: { daysCount: number } }).data.daysCount).toBe(5);

    const valRes = await harness.invoke('POST', '/api/hr/leave/validate', {
      auth: AUTH_CTX,
      body: {
        employeeNo: 'EMP-001',
        leaveType: 'annual',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        availableBalanceDays: 12,
      },
    });
    expect(valRes.statusCode).toBe(200);
    expect((valRes.payload as { data: { valid: boolean; daysCount: number } }).data).toEqual({
      valid: true,
      daysCount: 5,
      errors: [],
    });

    const payrollRes = await harness.invoke('POST', '/api/hr/payroll/calculate', {
      auth: AUTH_CTX,
      body: {
        employees: [
          {
            employeeNo: 'EMP-001',
            baseSalaryMinor: 500000,
            allowanceMinor: 50000,
            deductionMinor: 25000,
          },
        ],
      },
    });
    expect(payrollRes.statusCode).toBe(200);
    const payroll = (
      payrollRes.payload as {
        data: { totalGrossMinor: number; totalDeductionsMinor: number; totalNetMinor: number };
      }
    ).data;
    expect(payroll.totalGrossMinor).toBe(550000);
    expect(payroll.totalDeductionsMinor).toBe(25000);
    expect(payroll.totalNetMinor).toBe(525000);
  });
});
