import { describe, expect, it } from 'vitest';

import { digestClientSecret, OAuthClient } from './oauth-client.js';

function publicClient(overrides: Record<string, unknown> = {}): OAuthClient {
  const client = OAuthClient.fromJson({
    client_id: 'board',
    type: 'public',
    grant_types: ['authorization_code', 'refresh_token'],
    redirect_uris: ['http://localhost:3000/callback'],
    scopes: ['openid', 'offline_access'],
    ...overrides,
  });
  client.$beforeInsert({} as never);
  return client;
}

describe('OAuth client registry', () => {
  it('allows public clients without secrets and enforces exact allowlists', () => {
    const client = publicClient();
    expect(
      client.canAuthorize('authorization_code', 'http://localhost:3000/callback', 'openid offline_access')
    ).toBe(true);
    expect(
      client.canAuthorize('authorization_code', 'http://localhost:3000/callback/', 'openid')
    ).toBe(false);
    expect(client.canAuthorize('authorization_code', 'http://localhost:3000/callback', 'admin')).toBe(false);
    expect(JSON.stringify(client.toJSON())).not.toContain('secret_digest');
  });

  it('rejects wildcard redirects and public confidential escalation', () => {
    expect(() => publicClient({ redirect_uris: ['https://*/callback'] })).toThrow();
    expect(() => publicClient({ secret_digest: digestClientSecret('secret') })).toThrow();
    expect(() => publicClient({ grant_types: ['client_credentials'] })).toThrow();
  });

  it('stores deterministic allowlists and blocks disabled clients', () => {
    const client = publicClient({
      redirect_uris: ['http://localhost:3000/b', 'http://localhost:3000/a', 'http://localhost:3000/a'],
      scopes: ['openid', 'openid', 'offline_access'],
    });
    expect(client.redirect_uris).toEqual(['http://localhost:3000/a', 'http://localhost:3000/b']);
    expect(client.scopes).toEqual(['offline_access', 'openid']);
    client.status = 'disabled';
    expect(
      client.canAuthorize('authorization_code', 'http://localhost:3000/a', 'openid')
    ).toBe(false);
  });

  it('allows confidential machine clients with a secret digest only', () => {
    const client = OAuthClient.fromJson({
      client_id: 'machine',
      type: 'confidential',
      grant_types: ['client_credentials'],
      redirect_uris: [],
      scopes: ['telemetry.read'],
      secret_digest: 'secret-plaintext',
    });
    client.$beforeInsert({} as never);
    expect(client.secret_digest).toBe('secret-plaintext');
    expect(JSON.stringify(client.toJSON())).not.toContain('secret-plaintext');
  });
});
