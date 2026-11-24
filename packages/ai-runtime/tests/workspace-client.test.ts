import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceHttpClient } from '../src/workspace-contract.js';

describe('workspace sandbox HTTP client', () => {
  it('requires an exact origin and a credential', () => {
    expect(() =>
      createWorkspaceHttpClient({ origin: 'http://agent-sandbox:3020/v1', token: 't' })
    ).toThrow();
    expect(() =>
      createWorkspaceHttpClient({ origin: 'http://agent-sandbox:3020?x=1', token: 't' })
    ).toThrow();
    expect(() =>
      createWorkspaceHttpClient({ origin: 'http://user:pass@agent-sandbox:3020', token: 't' })
    ).toThrow();
    expect(() =>
      createWorkspaceHttpClient({ origin: 'http://agent-sandbox:3020', token: '' })
    ).toThrow();
  });

  it('posts typed RPC with a bearer token and maps failures', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer test-token');
      expect(init?.redirect).toBe('error');
      const body = JSON.parse(String(init?.body)) as { method: string };
      expect(body.method).toBe('workspace.get');
      return new Response(JSON.stringify({ ok: true, result: { runId: 'run-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createWorkspaceHttpClient({
      origin: 'http://agent-sandbox:3020',
      token: 'test-token',
      fetch: fetchMock as never,
    });
    expect(await client.getWorkspace({ runId: 'run-1' })).toEqual({ runId: 'run-1' });
    expect(fetchMock).toHaveBeenCalledOnce();

    const failingFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'FORBIDDEN', message: 'denied', retryable: false },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } }
        )
    );
    const failingClient = createWorkspaceHttpClient({
      origin: 'http://agent-sandbox:3020',
      token: 'test-token',
      fetch: failingFetch as never,
    });
    await expect(failingClient.getWorkspace({ runId: 'run-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      retryable: false,
    });
  });
});
