import { describe, expect, it } from 'vitest';
import type {
  AddonHttpApp,
  AddonHttpReply,
  AddonHttpRequestBase,
  AddonHttpRouteHandler,
} from '@moonwitness/orm';
import type { Knex } from 'knex';
import {
  corpusHttpPlugin,
  evidenceHttpPlugin,
  localAiSuggestionHttpPlugin,
  localRetrievalHttpPlugin,
  manifest,
  researchActorIdentityHttpPlugin,
  researchDuplicateCandidateHttpPlugin,
  researchExplanationHttpPlugin,
  researchPrivacyHttpPlugin,
  researchReviewHttpPlugin,
  researchWitnessHttpPlugin,
} from '../src/index.js';

interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly handler: AddonHttpRouteHandler;
}

function createFakeApp(db: Knex = {} as Knex): {
  readonly app: AddonHttpApp;
  readonly routes: RegisteredRoute[];
} {
  const routes: RegisteredRoute[] = [];
  const register = (method: string) => (path: string, arg2: unknown, arg3?: unknown) => {
    if (typeof arg2 === 'function') {
      routes.push({ method, path, handler: arg2 as AddonHttpRouteHandler });
    } else {
      routes.push({
        method,
        path,
        options: arg2 as Readonly<Record<string, unknown>>,
        handler: arg3 as AddonHttpRouteHandler,
      });
    }
  };

  const app = {
    db,
    get: register('GET'),
    post: register('POST'),
    put: register('PUT'),
    patch: register('PATCH'),
    delete: register('DELETE'),
  } as unknown as AddonHttpApp;

  return { app, routes };
}

function createFakeReply(): {
  readonly reply: AddonHttpReply;
  readonly state: { statusCode: number; headers: Record<string, string>; payload: unknown };
} {
  const state = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    payload: undefined as unknown,
  };
  const reply: AddonHttpReply = {
    code(statusCode: number) {
      state.statusCode = statusCode;
      return reply;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return reply;
    },
    header(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return reply;
    },
    type(contentType: string) {
      state.headers['content-type'] = contentType;
      return reply;
    },
    send(payload: unknown) {
      state.payload = payload;
      return reply;
    },
  };
  return { reply, state };
}

describe('orm-knowledge Wave B.8/B.9/B.10 HTTP plugins', () => {
  it('registers all 10 ported HTTP plugins in manifest.httpPlugins', () => {
    const plugins = manifest.httpPlugins ?? [];
    expect(plugins).toContain(corpusHttpPlugin);
    expect(plugins).toContain(evidenceHttpPlugin);
    expect(plugins).toContain(localAiSuggestionHttpPlugin);
    expect(plugins).toContain(localRetrievalHttpPlugin);
    expect(plugins).toContain(researchActorIdentityHttpPlugin);
    expect(plugins).toContain(researchDuplicateCandidateHttpPlugin);
    expect(plugins).toContain(researchExplanationHttpPlugin);
    expect(plugins).toContain(researchPrivacyHttpPlugin);
    expect(plugins).toContain(researchReviewHttpPlugin);
    expect(plugins).toContain(researchWitnessHttpPlugin);
  });

  it('registers all expected legacy HTTP routes without path regressions', async () => {
    const { app, routes } = createFakeApp();
    const tenPlugins = [
      corpusHttpPlugin,
      evidenceHttpPlugin,
      researchExplanationHttpPlugin,
      researchActorIdentityHttpPlugin,
      researchDuplicateCandidateHttpPlugin,
      researchReviewHttpPlugin,
      researchPrivacyHttpPlugin,
      researchWitnessHttpPlugin,
      localRetrievalHttpPlugin,
      localAiSuggestionHttpPlugin,
    ];
    for (const plugin of tenPlugins) {
      await plugin(app);
    }

    const registered = routes.map((route) => `${route.method} ${route.path}`);
    expect(registered).toEqual([
      'GET /api/corpus/sources/:sourceId',
      'GET /api/corpus/passages/:editionId/:locator',
      'POST /api/research/evidence/resolve',
      'GET /api/research/graph/search',
      'GET /api/research/relations/:relationId/explanation',
      'POST /api/research/actor-identities',
      'GET /api/research/duplicate-candidates',
      'POST /api/research/reviews',
      'POST /api/research/reviews/:id/decision',
      'GET /api/research/reviews/:subjectId/history',
      'GET /api/research/privacy/projections',
      'POST /api/research/privacy/revocations',
      'GET /api/research/witnesses/:witnessId',
      'POST /api/research/retrieval/chunk',
      'GET /api/research/suggestions',
      'GET /api/research/suggestions/:suggestionId',
      'POST /api/research/suggestions/generate',
    ]);
  });

  it('returns 404 for unknown corpus source and passage', async () => {
    const { app, routes } = createFakeApp();
    await corpusHttpPlugin(app);

    const sourceRoute = routes.find((r) => r.path === '/api/corpus/sources/:sourceId')!;
    const sourceReply = createFakeReply();
    await sourceRoute.handler(
      {
        params: { sourceId: 'mw:source:unknown' },
        query: {},
        body: undefined,
      } as AddonHttpRequestBase,
      sourceReply.reply
    );
    expect(sourceReply.state.statusCode).toBe(404);
    expect(sourceReply.state.payload).toEqual({ success: false, error: 'Source not found' });

    const passageRoute = routes.find((r) => r.path === '/api/corpus/passages/:editionId/:locator')!;
    const passageReply = createFakeReply();
    await passageRoute.handler(
      {
        params: { editionId: 'mw:edition:unknown', locator: 'X1:1' },
        query: {},
        body: undefined,
      } as AddonHttpRequestBase,
      passageReply.reply
    );
    expect(passageReply.state.statusCode).toBe(404);
    expect(passageReply.state.payload).toEqual({ success: false, error: 'Passage not found' });
  });

  it('enforces 401 authentication guard on protected research routes', async () => {
    const { app, routes } = createFakeApp();
    await researchActorIdentityHttpPlugin(app);
    await researchDuplicateCandidateHttpPlugin(app);
    await researchExplanationHttpPlugin(app);
    await researchPrivacyHttpPlugin(app);
    await researchReviewHttpPlugin(app);
    await researchWitnessHttpPlugin(app);
    await localRetrievalHttpPlugin(app);
    await localAiSuggestionHttpPlugin(app);

    for (const route of routes) {
      const { reply, state } = createFakeReply();
      await route.handler({ params: {}, query: {}, body: {} } as AddonHttpRequestBase, reply);
      expect(state.statusCode, `${route.method} ${route.path}`).toBe(401);
      expect(state.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('enforces 403 superadmin guard on actor-identities and privacy routes', async () => {
    const { app, routes } = createFakeApp();
    await researchActorIdentityHttpPlugin(app);
    await researchPrivacyHttpPlugin(app);

    for (const route of routes) {
      const { reply, state } = createFakeReply();
      await route.handler(
        {
          auth: { userId: 2, role: 'user', companyId: 1 },
          params: {},
          query: {},
          body: {},
        } as AddonHttpRequestBase,
        reply
      );
      expect(state.statusCode, `${route.method} ${route.path}`).toBe(403);
    }
  });
});
