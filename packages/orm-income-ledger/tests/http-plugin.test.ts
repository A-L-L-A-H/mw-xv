import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { incomeHttpPlugin } from '../src/http-plugin.js';
import { manifest } from '../src/manifest.js';
import { createIncomeLedgerContext } from '../src/context.js';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';

interface RecordedResponse {
  statusCode: number;
  payload: unknown;
}

interface ErrorResponse {
  error: string;
}

type PluginApp = Parameters<AddonHttpPlugin>[0];
type RouteHandler = (
  req: AddonHttpRequestBase & { body: unknown; params: unknown; query: unknown },
  reply: AddonHttpReply
) => unknown;

async function createHarness() {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  Model.knex(db);
  await installAddons(db, [baseManifest, manifest]);
  // Get company ID from base seed
  const company = await db('companies').first('id');
  const companyId = company?.id ?? 1;

  const postRoutes = new Map<string, RouteHandler>();

  const app: PluginApp = {
    get: () => {},
    post: (path: string, ...args: unknown[]) => {
      const handler = args[args.length - 1];
      postRoutes.set(path, handler as RouteHandler);
    },
    put: () => {},
    patch: () => {},
    delete: () => {},
    db,
  };

  const hostContext: AddonHttpHostContext = {};

  async function init() {
    await incomeHttpPlugin(app, hostContext);
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

  return { init, invokePost, db };
}

describe('incomeHttpPlugin (manifest.httpPlugins)', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(incomeHttpPlugin);
  });

  describe('POST /income/streams', () => {
    it('rejects unauthenticated requests', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const res = await invokePost('/income/streams', {
        kind: 'saas',
        status: 'live',
        goalMonthlyMinor: 500_000,
        currency: 'USD',
      });

      expect(res.statusCode).toBe(401);
      expect((res.payload as ErrorResponse).error).toBe('Unauthorized');
    });

    it('rejects requests without companyId', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const res = await invokePost(
        '/income/streams',
        {
          kind: 'saas',
          status: 'live',
          goalMonthlyMinor: 500_000,
          currency: 'USD',
        },
        { userId: 1, role: 'user' }
      );

      expect(res.statusCode).toBe(403);
      expect((res.payload as ErrorResponse).error).toBe('Forbidden');
    });

    it('creates stream successfully with valid input', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const res = await invokePost(
        '/income/streams',
        {
          kind: 'saas',
          platform: 'subscription',
          status: 'live',
          goalMonthlyMinor: 500_000,
          currency: 'USD',
          tags: { source: 'test' },
        },
        { userId: 1, role: 'user', companyId: 1 }
      );

      expect(res.statusCode).toBe(201);
      expect(res.payload).toBeDefined();
      expect((res.payload as Record<string, unknown>).kind).toBe('saas');
      expect((res.payload as Record<string, unknown>).status).toBe('live');
      expect((res.payload as Record<string, unknown>).goal_monthly_minor).toBe(500_000);
      expect((res.payload as Record<string, unknown>).currency).toBe('USD');
    });

    it('creates stream with optional platform null', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const res = await invokePost(
        '/income/streams',
        {
          kind: 'other',
          platform: null,
          status: 'idea',
          goalMonthlyMinor: 0,
          currency: 'USD',
        },
        { userId: 1, role: 'user', companyId: 1 }
      );

      expect(res.statusCode).toBe(201);
      expect((res.payload as Record<string, unknown>).platform).toBeNull();
    });

    it('creates stream with all valid kinds', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const kinds = ['saas', 'marketplace', 'ads', 'affiliate', 'content_royalty', 'digital_product', 'service', 'donation', 'other'];

      for (const kind of kinds) {
        const res = await invokePost(
          '/income/streams',
          {
            kind,
            status: 'idea',
            goalMonthlyMinor: 100_000,
            currency: 'USD',
          },
          { userId: 1, role: 'user', companyId: 1 }
        );
        expect(res.statusCode).toBe(201);
        expect((res.payload as Record<string, unknown>).kind).toBe(kind);
      }
    });

    it('creates stream with all valid statuses', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const statuses = ['idea', 'building', 'live', 'paused', 'dead'];

      for (const status of statuses) {
        const res = await invokePost(
          '/income/streams',
          {
            kind: 'saas',
            status,
            goalMonthlyMinor: 100_000,
            currency: 'USD',
          },
          { userId: 1, role: 'user', companyId: 1 }
        );
        expect(res.statusCode).toBe(201);
        expect((res.payload as Record<string, unknown>).status).toBe(status);
      }
    });
  });

  describe('POST /income/entries', () => {
    it('rejects unauthenticated requests', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const res = await invokePost('/income/entries', {
        streamId: '1',
        occurred_at: '2026-01-15T00:00:00.000Z',
        amountMinor: 10000,
        currency: 'USD',
        kind: 'revenue',
        sourceModel: 'test',
        sourceId: 'test-1',
        netMinor: 10000,
      });

      expect(res.statusCode).toBe(401);
      expect((res.payload as ErrorResponse).error).toBe('Unauthorized');
    });

    it('creates entry successfully with valid input', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      // First create a stream
      const streamRes = await invokePost(
        '/income/streams',
        {
          kind: 'saas',
          status: 'live',
          goalMonthlyMinor: 500_000,
          currency: 'USD',
        },
        { userId: 1, role: 'user', companyId: 1 }
      );
      const streamId = (streamRes.payload as Record<string, unknown>).id as number;

      const res = await invokePost(
        '/income/entries',
        {
          streamId: String(streamId),
          occurredAt: '2026-01-15T00:00:00.000Z',
          amountMinor: 10000,
          currency: 'USD',
          kind: 'revenue',
          sourceModel: 'ecom.marketplace_order',
          sourceId: 'order-123',
          externalRef: 'ext-ref-456',
          netMinor: 8500,
        },
        { userId: 1, role: 'user' }
      );

      expect(res.statusCode).toBe(201);
      expect(res.payload).toBeDefined();
      expect((res.payload as Record<string, unknown>).stream_id).toBe(streamId);
      expect((res.payload as Record<string, unknown>).amount_minor).toBe(10000);
      expect((res.payload as Record<string, unknown>).currency).toBe('USD');
      expect((res.payload as Record<string, unknown>).kind).toBe('revenue');
      expect((res.payload as Record<string, unknown>).net_minor).toBe(8500);
    });

    it('creates entry with all valid entry kinds', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const streamRes = await invokePost(
        '/income/streams',
        {
          kind: 'saas',
          status: 'live',
          goalMonthlyMinor: 500_000,
          currency: 'USD',
        },
        { userId: 1, role: 'user', companyId: 1 }
      );
      const streamId = (streamRes.payload as Record<string, unknown>).id as number;

      const kinds = ['revenue', 'cost', 'payout', 'refund', 'fee', 'tax'];

      for (const kind of kinds) {
        const res = await invokePost(
          '/income/entries',
          {
            streamId: String(streamId),
            occurredAt: '2026-01-15T00:00:00.000Z',
            amountMinor: 10000,
            currency: 'USD',
            kind,
            sourceModel: 'test',
            sourceId: `test-${kind}`,
            netMinor: 10000,
          },
          { userId: 1, role: 'user' }
        );
        expect(res.statusCode).toBe(201);
        expect((res.payload as Record<string, unknown>).kind).toBe(kind);
      }
    });

    it('handles null external_ref', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const streamRes = await invokePost(
        '/income/streams',
        {
          kind: 'saas',
          status: 'live',
          goalMonthlyMinor: 500_000,
          currency: 'USD',
        },
        { userId: 1, role: 'user', companyId: 1 }
      );
      const streamId = (streamRes.payload as Record<string, unknown>).id as number;

      const res = await invokePost(
        '/income/entries',
        {
          streamId: String(streamId),
          occurredAt: '2026-01-15T00:00:00.000Z',
          amountMinor: 10000,
          currency: 'USD',
          kind: 'revenue',
          sourceModel: 'test',
          sourceId: 'test-1',
          externalRef: null,
          netMinor: 10000,
        },
        { userId: 1, role: 'user' }
      );

      expect(res.statusCode).toBe(201);
    });
  });

  describe('POST /income/allocations', () => {
    it('rejects unauthenticated requests', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const res = await invokePost('/income/allocations', {
        streamId: '123e4567-e89b-12d3-a456-426614174000',
        target: 'reinvest',
        percentage: 50,
        isActive: true,
      });

      expect(res.statusCode).toBe(401);
      expect((res.payload as ErrorResponse).error).toBe('Unauthorized');
    });

    it('creates allocation successfully with valid input', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      // First create a stream
      const streamRes = await invokePost(
        '/income/streams',
        {
          kind: 'saas',
          status: 'live',
          goalMonthlyMinor: 500_000,
          currency: 'USD',
        },
        { userId: 1, role: 'user', companyId: 1 }
      );
      const streamId = (streamRes.payload as Record<string, unknown>).id as number;

      const res = await invokePost(
        '/income/allocations',
        {
          streamId: String(streamId),
          target: 'reinvest',
          percentage: 40,
          isActive: true,
        },
        { userId: 1, role: 'user' }
      );

      expect(res.statusCode).toBe(201);
      expect(res.payload).toBeDefined();
      expect((res.payload as Record<string, unknown>).stream_id).toBe(streamId);
      expect((res.payload as Record<string, unknown>).target).toBe('reinvest');
      expect((res.payload as Record<string, unknown>).percentage).toBe(40);
      expect((res.payload as Record<string, unknown>).is_active).toBe(true);
    });

    it('creates allocation with all valid targets', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const streamRes = await invokePost(
        '/income/streams',
        {
          kind: 'saas',
          status: 'live',
          goalMonthlyMinor: 500_000,
          currency: 'USD',
        },
        { userId: 1, role: 'user', companyId: 1 }
      );
      const streamId = (streamRes.payload as Record<string, unknown>).id as number;

      const targets = ['reinvest', 'savings', 'charity', 'personal', 'tax'];

      for (const target of targets) {
        const res = await invokePost(
          '/income/allocations',
          {
            streamId: String(streamId),
            target,
            percentage: 20,
            isActive: true,
          },
          { userId: 1, role: 'user' }
        );
        expect(res.statusCode).toBe(201);
        expect((res.payload as Record<string, unknown>).target).toBe(target);
      }
    });

    it('creates inactive allocation', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const streamRes = await invokePost(
        '/income/streams',
        {
          kind: 'saas',
          status: 'live',
          goalMonthlyMinor: 500_000,
          currency: 'USD',
        },
        { userId: 1, role: 'user', companyId: 1 }
      );
      const streamId = (streamRes.payload as Record<string, unknown>).id as number;

      const res = await invokePost(
        '/income/allocations',
        {
          streamId: String(streamId),
          target: 'charity',
          percentage: 10,
          isActive: false,
        },
        { userId: 1, role: 'user' }
      );

      expect(res.statusCode).toBe(201);
      expect((res.payload as Record<string, unknown>).is_active).toBe(false);
    });

    it('accepts decimal percentages', async () => {
      const { init, invokePost } = await createHarness();
      await init();

      const streamRes = await invokePost(
        '/income/streams',
        {
          kind: 'saas',
          status: 'live',
          goalMonthlyMinor: 500_000,
          currency: 'USD',
        },
        { userId: 1, role: 'user', companyId: 1 }
      );
      const streamId = (streamRes.payload as Record<string, unknown>).id as number;

      const res = await invokePost(
        '/income/allocations',
        {
          streamId: String(streamId),
          target: 'reinvest',
          percentage: 33.33,
          isActive: true,
        },
        { userId: 1, role: 'user' }
      );

      expect(res.statusCode).toBe(201);
      expect((res.payload as Record<string, unknown>).percentage).toBe(33.33);
    });
  });
});