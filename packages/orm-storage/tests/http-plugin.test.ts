import { describe, expect, it } from 'vitest';
import type {
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequestBase,
} from '@moonwitness/orm';
import { buildChunkManifest } from '../src/encrypted-vault.js';
import { storageVaultHttpPlugin } from '../src/http-plugin.js';
import { manifest } from '../src/index.js';

interface RecordedResponse {
  statusCode: number;
  payload: unknown;
}

interface ErrorResponse {
  success: false;
  error: string;
}

interface VerifyResponse {
  success: true;
  data: {
    valid: boolean;
    verifiedChunks: number;
    totalBytes: number;
    errors: unknown[];
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
    await storageVaultHttpPlugin(app, hostContext);
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

describe('storageVaultHttpPlugin (INV-014 manifest.httpPlugins)', () => {
  it('is registered in manifest.httpPlugins', () => {
    expect(manifest.httpPlugins).toBeDefined();
    expect(manifest.httpPlugins).toContain(storageVaultHttpPlugin);
  });

  it('rejects unauthenticated requests to /api/storage/vault/manifest/verify', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost('/api/storage/vault/manifest/verify', {});
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests without active company context', async () => {
    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/storage/vault/manifest/verify',
      { manifest: {} },
      { userId: 1, role: 'user' }
    );
    expect(res.statusCode).toBe(403);
  });

  it('verifies valid chunk manifest successfully', async () => {
    const payload = Buffer.from('MoonWitness Encrypted Vault Payload Test Data 2026', 'utf8');
    const built = buildChunkManifest(payload, { tenantId: '1', chunkSize: 16 });

    const chunksRecord: Record<string, string> = {};
    for (const [hash, buf] of built.chunkStore.entries()) {
      chunksRecord[hash] = buf.toString('base64');
    }

    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/storage/vault/manifest/verify',
      {
        manifest: built.manifest,
        chunks: chunksRecord,
      },
      { userId: 1, role: 'user', companyId: 1 }
    );

    expect(res.statusCode).toBe(200);
    const body = res.payload as VerifyResponse;
    expect(body.success).toBe(true);
    expect(body.data.valid).toBe(true);
    expect(body.data.verifiedChunks).toBe(built.manifest.chunks.length);
    expect(body.data.totalBytes).toBe(payload.byteLength);
    expect(body.data.errors).toHaveLength(0);
  });

  it('detects corrupted or missing chunks without throwing unhandled error', async () => {
    const payload = Buffer.from('Test Data', 'utf8');
    const built = buildChunkManifest(payload, { tenantId: '1' });

    const harness = createHarness();
    await harness.init();

    const res = await harness.invokePost(
      '/api/storage/vault/manifest/verify',
      {
        manifest: built.manifest,
        chunks: {}, // Missing chunks
      },
      { userId: 1, role: 'user', companyId: 1 }
    );

    expect(res.statusCode).toBe(200);
    const body = res.payload as VerifyResponse;
    expect(body.success).toBe(true);
    expect(body.data.valid).toBe(false);
    expect(body.data.errors.length).toBeGreaterThan(0);
  });
});
