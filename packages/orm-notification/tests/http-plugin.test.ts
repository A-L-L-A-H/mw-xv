import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { notificationHttpPlugin } from '../src/http-plugin.js';
import { manifest } from '../src/index.js';

interface RecordedResponse {
  statusCode: number;
  payload: unknown;
}

interface RouteResponse {
  success: true;
  data: {
    notificationId: string;
    action: string;
    channels: string[];
    queuedForDigest?: boolean;
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
    await notificationHttpPlugin(app, hostContext);
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

describe('notificationHttpPlugin /api/notifications/route (INV-014 manifest.httpPlugins)', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(notificationHttpPlugin);
  });

  it('rejects unauthenticated requests to /api/notifications/route', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost('/api/notifications/route', {});
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests without active company context', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/notifications/route',
      { notification: {} },
      { userId: 1, role: 'user' }
    );
    expect(res.statusCode).toBe(403);
  });

  it('routes notifications successfully with valid payload', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/notifications/route',
      {
        notification: {
          id: 'notif-1',
          userId: 'user-42',
          severity: 'high',
          category: 'security',
          title: 'Suspicious login detected',
          body: 'A login was observed from unknown IP',
          createdAtMs: Date.now(),
        },
      },
      { userId: 1, role: 'user', companyId: 1 }
    );

    expect(res.statusCode).toBe(200);
    const body = res.payload as RouteResponse;
    expect(body.success).toBe(true);
    expect(body.data.notificationId).toBe('notif-1');
    expect(body.data.action).toBe('deliver');
    expect(body.data.channels).toBeDefined();
  });

  it('respects user policy quiet hours during routing', async () => {
    const harness = createHarness();
    await harness.init();

    const now = new Date('2026-11-23T23:30:00Z').getTime();

    const res = await harness.invokePost(
      '/api/notifications/route',
      {
        notification: {
          id: 'notif-2',
          userId: 'user-42',
          severity: 'low',
          category: 'marketing',
          title: 'Weekly summary',
          body: 'Check out weekly stats',
          createdAtMs: now,
        },
        userPolicy: {
          userId: 'user-42',
          channelsBySeverity: { low: ['desktop'] },
          quietHours: {
            startMinuteOfDay: 22 * 60, // 22:00
            endMinuteOfDay: 7 * 60, // 07:00
            timezoneOffsetMinutes: 0,
          },
        },
        nowMs: now,
      },
      { userId: 1, role: 'user', companyId: 1 }
    );

    expect(res.statusCode).toBe(200);
    const body = res.payload as RouteResponse;
    expect(body.success).toBe(true);
    expect(body.data.action).toBe('suppressed_quiet_hours');
    expect(body.data.queuedForDigest).toBe(true);
  });
});
