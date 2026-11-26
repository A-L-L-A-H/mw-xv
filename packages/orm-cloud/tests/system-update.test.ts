import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createCloudHttpPlugin } from '../src/index.js';

const TEST_ADMIN_TOKEN = 'test-self-update-admin-token-987654';

interface RecordedRequest {
  url: string;
  method: string;
  authorization?: string;
  body?: string;
}

async function createUpdateTestServer(
  handler: (req: RecordedRequest) => Response | Promise<Response>
) {
  const requests: RecordedRequest[] = [];
  let activeAuth: Record<string, unknown> | null = {
    userId: 1,
    role: 'superadmin',
    companyId: 1,
  };
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    (request as { auth?: unknown }).auth = activeAuth;
  });
  await app.register(
    createCloudHttpPlugin({
      controlPlaneUrl: 'http://127.0.0.1:3003',
      adminToken: TEST_ADMIN_TOKEN,
      fetchImpl: async (input, init) => {
        const record: RecordedRequest = {
          url: String(input),
          method: init?.method ?? 'GET',
          authorization: new Headers(init?.headers).get('authorization') ?? undefined,
          body: init?.body ? String(init.body) : undefined,
        };
        requests.push(record);
        return handler(record);
      },
    })
  );
  await app.ready();
  return {
    app,
    requests,
    setAuth: (nextAuth: Record<string, unknown> | null) => {
      activeAuth = nextAuth;
    },
  };
}

describe('cloud platform self-update routes', () => {
  it('enforces admin-only auth on check and apply routes', async () => {
    const server = await createUpdateTestServer(
      () => new Response(JSON.stringify({ status: 'idle' }), { status: 200 })
    );
    try {
      server.setAuth(null);
      const unauthCheck = await server.app.inject({
        method: 'GET',
        url: '/api/cloud/system/update',
      });
      expect(unauthCheck.statusCode).toBe(401);

      server.setAuth({ userId: 7, role: 'member', companyId: 1 });
      const memberCheck = await server.app.inject({
        method: 'GET',
        url: '/api/cloud/system/update',
      });
      expect(memberCheck.statusCode).toBe(403);

      const memberApply = await server.app.inject({
        method: 'POST',
        url: '/api/cloud/system/update/apply',
        payload: { version: 'v1.1.0' },
      });
      expect(memberApply.statusCode).toBe(403);
      expect(server.requests).toHaveLength(0);
    } finally {
      await server.app.close();
    }
  });

  it('forwards check, force refresh, apply 202, and conflict 409 with secret redaction', async () => {
    const server = await createUpdateTestServer((recorded) => {
      if (recorded.url.includes('/paas/system/update/apply')) {
        if (recorded.body?.includes('v9.9.9')) {
          return new Response(
            JSON.stringify({
              error: `already updating with ${TEST_ADMIN_TOKEN}`,
              status: { status: 'updating', targetVersion: 'v1.1.0' },
            }),
            { status: 409 }
          );
        }
        return new Response(
          JSON.stringify({
            currentVersion: 'v1.0.0-rc.1',
            latestVersion: 'v1.1.0',
            targetVersion: 'v1.1.0',
            status: 'updating',
            canApply: false,
          }),
          { status: 202 }
        );
      }
      return new Response(
        JSON.stringify({
          currentVersion: 'v1.0.0-rc.1',
          latestVersion: 'v1.1.0',
          updateAvailable: true,
          status: 'idle',
          canApply: true,
        }),
        { status: 200 }
      );
    });

    try {
      const checkResponse = await server.app.inject({
        method: 'GET',
        url: '/api/cloud/system/update?force=true',
      });
      expect(checkResponse.statusCode).toBe(200);
      expect(checkResponse.json()).toMatchObject({
        success: true,
        data: { currentVersion: 'v1.0.0-rc.1', latestVersion: 'v1.1.0', updateAvailable: true },
      });
      expect(server.requests[0]).toMatchObject({
        url: 'http://127.0.0.1:3003/paas/system/update?force=true',
        authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
      });

      const applyResponse = await server.app.inject({
        method: 'POST',
        url: '/api/cloud/system/update/apply',
        payload: { version: 'v1.1.0' },
      });
      expect(applyResponse.statusCode).toBe(202);
      expect(applyResponse.json()).toMatchObject({
        success: true,
        data: { status: 'updating', targetVersion: 'v1.1.0' },
      });

      const conflictResponse = await server.app.inject({
        method: 'POST',
        url: '/api/cloud/system/update/apply',
        payload: { version: 'v9.9.9' },
      });
      expect(conflictResponse.statusCode).toBe(409);
      const conflictJson = conflictResponse.json() as {
        success: boolean;
        error: string;
        data: { status: string };
      };
      expect(conflictJson.success).toBe(false);
      expect(conflictJson.error).not.toContain(TEST_ADMIN_TOKEN);
      expect(conflictJson.data.status).toBe('updating');
    } finally {
      await server.app.close();
    }
  });
});
