import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { AddonHttpApp, AddonHttpReply, AddonHttpRequestBase } from '@moonwitness/orm';
import {
  AI_CORPORATION_ROUTE_PREFIXES,
  AI_DESKTOP_SYNC_ROUTE_PREFIXES,
  aiCorporationHttpPlugin,
  aiDesktopSyncHttpPlugin,
  interactiveSessionsHttpPlugin,
  INTERACTIVE_SESSION_ROUTE_PREFIXES,
  evaluateProofGateV2,
  manifest,
} from '../src/index.js';

interface RecordedRoute {
  method: string;
  path: string;
  handler: (req: AddonHttpRequestBase, reply: AddonHttpReply) => Promise<unknown> | unknown;
}

function createFakeHttpApp(): { app: AddonHttpApp; routes: RecordedRoute[] } {
  const routes: RecordedRoute[] = [];
  const register =
    (method: string) =>
    (
      path: string,
      handler: (req: AddonHttpRequestBase, reply: AddonHttpReply) => Promise<unknown> | unknown
    ) => {
      routes.push({ method, path, handler });
    };

  const app = {
    get: register('GET'),
    post: register('POST'),
    patch: register('PATCH'),
    put: register('PUT'),
    delete: register('DELETE'),
  } as unknown as AddonHttpApp;

  return { app, routes };
}

function createFakeReply() {
  let statusCode = 200;
  let body: unknown = undefined;
  const headers: Record<string, string> = {};
  const reply: AddonHttpReply = {
    code(status: number) {
      statusCode = status;
      return reply;
    },
    send(payload: unknown) {
      body = payload;
      return reply;
    },
    header(name: string, value: string) {
      headers[name] = value;
      return reply;
    },
  };
  return {
    reply,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    headers,
  };
}

describe('orm-ai manifest HTTP plugins (INV-014)', () => {
  it('registers evolution, corporation, and desktop-sync plugins on manifest.httpPlugins', () => {
    assert.ok(Array.isArray(manifest.httpPlugins));
    assert.equal(manifest.httpPlugins.length, 4);
    assert.ok(manifest.httpPlugins.includes(aiCorporationHttpPlugin));
    assert.ok(manifest.httpPlugins.includes(aiDesktopSyncHttpPlugin));
    assert.ok(manifest.httpPlugins.includes(interactiveSessionsHttpPlugin));
  });

  it('mounts all aiCorporationHttpPlugin routes on /api/ai and /ai prefixes and enforces auth', async () => {
    const { app, routes } = createFakeHttpApp();
    await aiCorporationHttpPlugin(app, {});

    for (const prefix of AI_CORPORATION_ROUTE_PREFIXES) {
      const expectedPaths = [
        `GET ${prefix}/agents`,
        `GET ${prefix}/agents/:id`,
        `POST ${prefix}/agents`,
        `PATCH ${prefix}/agents/:id`,
        `GET ${prefix}/grants`,
        `POST ${prefix}/grants`,
        `POST ${prefix}/grants/:id/revoke`,
        `GET ${prefix}/providers`,
        `POST ${prefix}/providers`,
        `PATCH ${prefix}/providers/:id`,
        `GET ${prefix}/work-contracts`,
        `GET ${prefix}/work-contracts/:id`,
        `POST ${prefix}/work-contracts`,
        `POST ${prefix}/work-contracts/:id/verify`,
        `GET ${prefix}/runs`,
        `GET ${prefix}/runs/:id`,
        `POST ${prefix}/runs`,
        `POST ${prefix}/runs/:id/cancel`,
        `GET ${prefix}/artifacts`,
        `POST ${prefix}/artifacts`,
        `GET ${prefix}/obligations`,
        `POST ${prefix}/obligations`,
        `PATCH ${prefix}/obligations/:id`,
        `GET ${prefix}/memory`,
        `POST ${prefix}/memory`,
        `POST ${prefix}/memory/:id/revoke`,
        `POST ${prefix}/emergency-stop`,
        `GET ${prefix}/governance/approvals`,
        `POST ${prefix}/governance/approvals`,
        `POST ${prefix}/governance/approvals/:id/decide`,
        `GET ${prefix}/eval-summary`,
      ];
      for (const expected of expectedPaths) {
        assert.ok(
          routes.some((r) => `${r.method} ${r.path}` === expected),
          `Missing route ${expected}`
        );
      }
    }

    const getAgents = routes.find((r) => r.method === 'GET' && r.path === '/api/ai/agents');
    assert.ok(getAgents);
    const res = createFakeReply();
    await getAgents.handler({ params: {}, query: {}, body: undefined }, res.reply);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  });

  it('mounts all aiDesktopSyncHttpPlugin routes on /api/ai and /ai prefixes and enforces auth', async () => {
    const { app, routes } = createFakeHttpApp();
    await aiDesktopSyncHttpPlugin(app, {});

    for (const prefix of AI_DESKTOP_SYNC_ROUTE_PREFIXES) {
      const expectedPaths = [
        `POST ${prefix}/desktop/lease`,
        `GET ${prefix}/desktop/pull`,
        `POST ${prefix}/desktop/artifacts/upload`,
        `POST ${prefix}/desktop/pcw-sync`,
      ];
      for (const expected of expectedPaths) {
        assert.ok(
          routes.some((r) => `${r.method} ${r.path}` === expected),
          `Missing route ${expected}`
        );
      }
    }

    const pcwSync = routes.find(
      (r) => r.method === 'POST' && r.path === '/api/ai/desktop/pcw-sync'
    );
    assert.ok(pcwSync);
    const res = createFakeReply();
    await pcwSync.handler({ params: {}, query: {}, body: {} }, res.reply);
    assert.equal(res.statusCode, 401);
  });

  it('registers the stable interactive lane and rejects unauthenticated ownership', async () => {
    const { app, routes } = createFakeHttpApp();
    await interactiveSessionsHttpPlugin(app, {});
    for (const prefix of INTERACTIVE_SESSION_ROUTE_PREFIXES) {
      for (const route of [
        `POST ${prefix}/interactive-sessions`,
        `GET ${prefix}/interactive-sessions`,
        `GET ${prefix}/interactive-sessions/:id`,
        `POST ${prefix}/interactive-sessions/:id/commands`,
        `GET ${prefix}/interactive-sessions/:id/events`,
      ])
        assert.ok(
          routes.some((entry) => `${entry.method} ${entry.path}` === route),
          route
        );
    }
    for (const route of routes.filter(
      (entry) => entry.path === '/api/ai/interactive-sessions' || entry.path.includes(':id')
    )) {
      const response = createFakeReply();
      await route.handler({ params: { id: '1' }, query: {}, body: {} }, response.reply);
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers['Cache-Control'], 'private, no-store');
    }
  });

  it('evaluateProofGateV2 enforces check matrix and diff-scope drift guard', () => {
    const failed = evaluateProofGateV2({ checks: [{ code: 'unit', status: 'fail' }] }, undefined);
    assert.equal(failed?.code, 'PROOF_CHECK_FAILED');

    const outOfScope = evaluateProofGateV2(
      { changed_files: ['apps/api/src/app.ts'] },
      JSON.stringify({ allowedPaths: ['packages/orm-ai/**'] })
    );
    assert.equal(outOfScope?.code, 'OUT_OF_SCOPE_DIFF_DETECTED');

    const clean = evaluateProofGateV2(
      {
        checks: [{ code: 'unit', status: 'pass' }],
        changed_files: ['packages/orm-ai/src/index.ts'],
      },
      JSON.stringify({ allowedPaths: ['packages/orm-ai'] })
    );
    assert.equal(clean, null);
  });
});
