import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  setupCompleteHtml,
  setupFormHtml,
  setupPageRoutes,
  setupUnavailableHtml,
  type SetupPageRoutesOptions,
} from './setup-page.js';

async function buildSetupApp(options: SetupPageRoutesOptions) {
  const app = Fastify({ logger: false });
  await app.register(setupPageRoutes, options);
  return app;
}

const readyOptions: SetupPageRoutesOptions = {
  bootstrapDatabase: {
    raw: async () => ({ rows: [{ present: 1 }] }),
  },
  hasPlatformOwner: async () => false,
};

describe('first-install setup page', () => {
  it('renders an accessible form on a fresh install', async () => {
    const app = await buildSetupApp(readyOptions);
    const response = await app.inject({ method: 'GET', url: '/setup' });
    const body = response.body;

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body).toContain('<form method="post" action="/setup"');
    expect(body).toContain('for="setupToken"');
    expect(body).toContain('autofocus');
    expect(body).toContain('id="setup-help"');
    expect(body).not.toContain('<script>');
    await app.close();
  });

  it('is unavailable after bootstrap completion', async () => {
    const app = await buildSetupApp({
      ...readyOptions,
      hasPlatformOwner: async () => true,
    });
    const get = await app.inject({ method: 'GET', url: '/setup' });
    const post = await app.inject({ method: 'POST', url: '/setup', payload: {} });

    expect(get.body).toContain('Setup unavailable');
    expect(get.body).not.toContain('name="password"');
    expect(post.body).toContain('Setup unavailable');
    await app.close();
  });

  it('posts submitted fields to the claim endpoint without URL or storage writes', async () => {
    const app = await buildSetupApp(readyOptions);
    const token = 'bootstrap-token-abcdefghijklmnop';
    const password = 'generated-password-123';
    const response = await app.inject({
      method: 'POST',
      url: '/setup',
      payload: {
        setupToken: token,
        identifierType: 'email',
        identifierValue: 'owner@example.com',
        password,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatch(/action="https?:\/\/[^/]+\/setup\/claim"/);
    expect(response.body).toContain(`name="setupToken" value="${token}"`);
    expect(response.body).toContain(`name="password" value="${password}"`);
    expect(response.body).not.toContain('localStorage');
    expect(response.body).not.toContain('sessionStorage');
    expect(response.headers.location).toBeUndefined();
    await app.close();
  });

  it('renders generic completion and escaped errors', () => {
    expect(setupCompleteHtml()).toContain('Initial setup is complete');
    expect(setupFormHtml('<script>alert(1)</script>')).not.toContain('<script>alert(1)</script>');
    expect(setupFormHtml('<script>alert(1)</script>')).toContain('&lt;script&gt;');
    expect(setupUnavailableHtml()).not.toContain('name="setupToken"');
  });
});
