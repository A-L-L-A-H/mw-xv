import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { signalHttpPlugin } from '../src/http-plugin.js';
import { manifest } from '../src/manifest.js';

interface RecordedResponse {
  statusCode: number;
  payload: unknown;
}

interface ErrorResponse {
  success: false;
  error: string;
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
    await signalHttpPlugin(app, hostContext);
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

describe('signalHttpPlugin (manifest.httpPlugins)', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(signalHttpPlugin);
  });

  it('rejects unauthenticated requests to /api/signal/score', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost('/api/signal/score', {});
    expect(res.statusCode).toBe(401);
    expect((res.payload as ErrorResponse).error).toBe('Authentication required');
  });

  it('rejects requests without a valid companyId', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/signal/score',
      { keywordWeight: 1, recencyDecay: 1, sourceAuthority: 1, velocity: 1 },
      { userId: 1, role: 'user' }
    );
    expect(res.statusCode).toBe(403);
    expect((res.payload as ErrorResponse).error).toBe('Active company is required');
  });

  it('scores signal components successfully with valid authentication', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/signal/score',
      { keywordWeight: 1, recencyDecay: 1, sourceAuthority: 1, velocity: 1 },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(200);
    const body = res.payload as { success: true; data: { finalScore: number } };
    expect(body.success).toBe(true);
    expect(body.data.finalScore).toBeCloseTo(1, 10);
  });

  it('rejects non-numeric components', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/signal/score',
      { keywordWeight: 'high', recencyDecay: 1, sourceAuthority: 1, velocity: 1 },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects non-object bodies', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost('/api/signal/score', [1, 2, 3], { userId: 1, role: 'user', companyId: 1 });
    expect(res.statusCode).toBe(400);
  });

  it('accepts custom weights and rejects invalid weight types', async () => {
    const harness = createHarness();
    await harness.init();

    const ok = await harness.invokePost(
      '/api/signal/score',
      {
        keywordWeight: 1,
        recencyDecay: 0,
        sourceAuthority: 0,
        velocity: 0,
        weights: { keywordWeight: 0.5, recencyDecay: 0.5, sourceAuthority: 0, velocity: 0 },
      },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(ok.statusCode).toBe(200);
    const okBody = ok.payload as { success: true; data: { finalScore: number } };
    expect(okBody.data.finalScore).toBeCloseTo(0.5, 10);

    const bad = await harness.invokePost(
      '/api/signal/score',
      { keywordWeight: 1, recencyDecay: 0, sourceAuthority: 0, velocity: 0, weights: { keywordWeight: 'big' } },
      { userId: 1, role: 'user', companyId: 1 }
    );
    expect(bad.statusCode).toBe(400);
  });
});
