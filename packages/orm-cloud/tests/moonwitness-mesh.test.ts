import { describe, expect, it, vi } from 'vitest';
import {
  assertPrivateMeshEndpoint,
  controlMeshPaasApp,
  deployComposeViaMoonWitnessMesh,
  deployViaMoonWitnessMesh,
  fetchMeshNodeMetrics,
  isPrivateMeshIp,
  listMeshPaasAppDeployments,
  listMeshPaasApps,
  listMeshPaasTemplates,
  redactMeshSecrets,
  updateMeshPaasAppDomain,
  updateMeshPaasAppEnv,
} from '../src/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MoonWitness Mesh PaaS provider', () => {
  it('allows private mesh IP ranges and 127.0.0.1 for tests', () => {
    expect(isPrivateMeshIp('10.0.0.12')).toBe(true);
    expect(isPrivateMeshIp('100.64.0.5')).toBe(true);
    expect(isPrivateMeshIp('100.127.255.254')).toBe(true);
    expect(isPrivateMeshIp('172.16.4.10')).toBe(true);
    expect(isPrivateMeshIp('172.31.255.1')).toBe(true);
    expect(isPrivateMeshIp('192.168.1.50')).toBe(true);
    expect(isPrivateMeshIp('[fd7a:115c:a1e0::1]')).toBe(true);
    expect(isPrivateMeshIp('127.0.0.1')).toBe(true);
  });

  it('blocks public IPs and external hostnames to prevent SSRF', async () => {
    const blockedEndpoints = [
      'http://8.8.8.8:3003',
      'https://1.1.1.1:443',
      'http://172.32.0.1:3003',
      'http://100.63.255.255:3003',
      'https://evil.example.com',
      'http://169.254.169.254/latest/meta-data',
    ];

    const fetchSpy = vi.fn<typeof fetch>();

    for (const endpoint of blockedEndpoints) {
      expect(() => assertPrivateMeshEndpoint(endpoint)).toThrow(/SSRF blocked/u);
      await expect(
        deployViaMoonWitnessMesh({
          endpoint,
          token: 'mesh-secret-token',
          slug: 'billing-api',
          image: 'ghcr.io/moonwitness/billing:latest',
          fetchImpl: fetchSpy,
        })
      ).rejects.toThrow(/SSRF blocked/u);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deploys an app over private mesh IP with control-plane auth headers', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        appId: 'app_123',
        slug: 'billing-api',
        status: 'running',
        url: 'https://billing.mesh.local',
        deploymentId: 'dep_999',
        message: 'Deployed billing-api',
      })
    );

    const result = await deployViaMoonWitnessMesh({
      endpoint: 'http://100.64.0.10:3003/',
      token: 'cp-admin-token-xyz',
      slug: 'billing-api',
      image: 'ghcr.io/moonwitness/billing:1.2.0',
      domain: 'billing.mesh.local',
      port: 8080,
      tenant: 'acme',
      fetchImpl: fetchSpy,
    });

    expect(result).toEqual({
      appId: 'app_123',
      slug: 'billing-api',
      status: 'running',
      url: 'https://billing.mesh.local',
      deploymentId: 'dep_999',
      message: 'Deployed billing-api',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://100.64.0.10:3003/paas/apps');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer cp-admin-token-xyz',
      'content-type': 'application/json',
    });
  });

  it('lists deployed PaaS apps with auth headers', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        apps: [
          {
            id: 'app_1',
            slug: 'storefront',
            image: 'nginx:alpine',
            status: 'running',
            domain: 'shop.local',
            port: 3000,
            tenant: 'default',
          },
        ],
      })
    );

    const apps = await listMeshPaasApps({
      endpoint: 'http://10.10.0.5:3003',
      token: 'list-token',
      fetchImpl: fetchSpy,
    });

    expect(apps).toHaveLength(1);
    expect(apps[0]?.slug).toBe('storefront');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://10.10.0.5:3003/paas/apps');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer list-token' });
  });

  it('fetches mesh node CPU, RAM, and mesh IP metrics', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        nodeId: 'vps-sg-01',
        meshIp: '100.64.0.10',
        cpuPercent: 27.5,
        memoryUsedMb: 2048,
        memoryTotalMb: 8192,
        runningApps: 4,
        uptimeSeconds: 86400,
      })
    );

    const metrics = await fetchMeshNodeMetrics({
      endpoint: 'http://100.64.0.10:3003',
      token: 'metrics-token',
      fetchImpl: fetchSpy,
    });

    expect(metrics).toEqual({
      nodeId: 'vps-sg-01',
      meshIp: '100.64.0.10',
      cpuPercent: 27.5,
      memoryUsedMb: 2048,
      memoryTotalMb: 8192,
      memoryPercent: 25,
      runningApps: 4,
      uptimeSeconds: 86400,
    });

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://100.64.0.10:3003/paas/metrics');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer metrics-token' });
  });

  it('controls PaaS apps: restart, stop, logs, and delete', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/restart')) {
        return jsonResponse({ ok: true, status: 'running', message: 'Restarted' });
      }
      if (url.endsWith('/stop')) {
        return jsonResponse({ ok: true, status: 'stopped', message: 'Stopped' });
      }
      if (url.endsWith('/logs')) {
        return jsonResponse({
          ok: true,
          logs: '2026-11-23 INFO started with token=supersecret123',
          message: 'Logs fetched',
        });
      }
      return jsonResponse({ ok: true, status: 'deleted', message: 'Deleted' });
    });

    const restartRes = await controlMeshPaasApp({
      endpoint: 'http://127.0.0.1:3003',
      token: 'ctrl-token',
      appIdOrSlug: 'billing-api',
      action: 'restart',
      fetchImpl: fetchSpy,
    });
    expect(restartRes).toMatchObject({ ok: true, action: 'restart', status: 'running' });

    const stopRes = await controlMeshPaasApp({
      endpoint: 'http://127.0.0.1:3003',
      token: 'ctrl-token',
      appIdOrSlug: 'billing-api',
      action: 'stop',
      fetchImpl: fetchSpy,
    });
    expect(stopRes).toMatchObject({ ok: true, action: 'stop', status: 'stopped' });

    const logsRes = await controlMeshPaasApp({
      endpoint: 'http://127.0.0.1:3003',
      token: 'ctrl-token',
      appIdOrSlug: 'billing-api',
      action: 'logs',
      fetchImpl: fetchSpy,
    });
    expect(logsRes.logs).toContain('[REDACTED]');
    expect(logsRes.logs).not.toContain('supersecret123');

    const deleteRes = await controlMeshPaasApp({
      endpoint: 'http://127.0.0.1:3003',
      token: 'ctrl-token',
      appIdOrSlug: 'billing-api',
      action: 'delete',
      fetchImpl: fetchSpy,
    });
    expect(deleteRes).toMatchObject({ ok: true, action: 'delete', status: 'deleted' });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3003/paas/apps/billing-api/restart');
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3003/paas/apps/billing-api/stop');
    expect(fetchSpy.mock.calls[2]?.[0]).toBe('http://127.0.0.1:3003/paas/apps/billing-api/logs');
    expect(fetchSpy.mock.calls[3]?.[0]).toBe('http://127.0.0.1:3003/paas/apps/billing-api');
    expect(fetchSpy.mock.calls[3]?.[1]?.method).toBe('DELETE');
  });

  it('redacts secrets in error responses', async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response('Auth failed for Bearer top-secret-token password=hunter2', { status: 401 })
    );

    await expect(
      deployViaMoonWitnessMesh({
        endpoint: 'http://192.168.1.20:3003',
        token: 'top-secret-token',
        slug: 'api',
        image: 'node:24-alpine',
        fetchImpl: fetchSpy,
      })
    ).rejects.toThrow(/\[REDACTED\]/u);

    const redacted = redactMeshSecrets('Authorization: Bearer abc.def.ghi secret=xyz', ['xyz']);
    expect(redacted).not.toContain('abc.def.ghi');
    expect(redacted).not.toContain('xyz');
  });

  it('includes volumes, memoryLimit, and cpuLimit when provided to deployViaMoonWitnessMesh', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        appId: 'app_pg',
        slug: 'pg-primary',
        status: 'running',
        url: 'https://pg.mesh.local',
        deploymentId: 'dep_pg_1',
        message: 'Deployed pg-primary',
      })
    );

    await deployViaMoonWitnessMesh({
      endpoint: 'http://100.64.0.10:3003',
      token: 'cp-admin-token-xyz',
      slug: 'pg-primary',
      image: 'postgres:16-alpine',
      port: 5432,
      volumes: ['pgdata:/var/lib/postgresql/data'],
      memoryLimit: '512m',
      cpuLimit: '1.5',
      fetchImpl: fetchSpy,
    });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const parsedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(parsedBody).toMatchObject({
      slug: 'pg-primary',
      image: 'postgres:16-alpine',
      port: 5432,
      volumes: ['pgdata:/var/lib/postgresql/data'],
      memoryLimit: '512m',
      cpuLimit: '1.5',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('controls PaaS apps with start and redeploy actions', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/start')) {
        return jsonResponse({ ok: true, status: 'running', message: 'Started' });
      }
      return jsonResponse({
        ok: true,
        status: 'running',
        deploymentId: 'dep_redeploy_1',
        message: 'Redeployed with token=redeploy-secret',
      });
    });

    const startRes = await controlMeshPaasApp({
      endpoint: 'http://127.0.0.1:3003',
      token: 'ctrl-token',
      appIdOrSlug: 'billing-api',
      action: 'start',
      fetchImpl: fetchSpy,
    });
    expect(startRes).toMatchObject({ ok: true, action: 'start', status: 'running' });

    const redeployRes = await controlMeshPaasApp({
      endpoint: 'http://127.0.0.1:3003',
      token: 'ctrl-token',
      appIdOrSlug: 'billing-api',
      action: 'redeploy',
      fetchImpl: fetchSpy,
    });
    expect(redeployRes).toMatchObject({
      ok: true,
      action: 'redeploy',
      status: 'running',
      deploymentId: 'dep_redeploy_1',
    });
    expect(redeployRes.message).toContain('[REDACTED]');
    expect(redeployRes.message).not.toContain('redeploy-secret');

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3003/paas/apps/billing-api/start');
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      'http://127.0.0.1:3003/paas/apps/billing-api/redeploy'
    );
    expect(fetchSpy.mock.calls[1]?.[1]?.method).toBe('POST');
  });

  it('updates app env variables via PUT /paas/apps/:slug/env and redacts secrets', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        ok: true,
        slug: 'billing-api',
        env: { PORT: '8080', API_KEY: '[REDACTED]' },
        message: 'Updated env for Bearer env-token-xyz with super-secret-db-pass',
      })
    );

    const res = await updateMeshPaasAppEnv({
      endpoint: 'http://100.64.0.12:3003',
      token: 'env-token-xyz',
      appIdOrSlug: 'billing-api',
      env: { PORT: '8080', DB_PASS: 'super-secret-db-pass' },
      merge: true,
      timeoutMs: 5000,
      fetchImpl: fetchSpy,
    });

    expect(res).toEqual({
      ok: true,
      appIdOrSlug: 'billing-api',
      slug: 'billing-api',
      env: { PORT: '8080', API_KEY: '[REDACTED]' },
      message: 'Updated env for Bearer [REDACTED] with [REDACTED]',
    });

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://100.64.0.12:3003/paas/apps/billing-api/env');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer env-token-xyz',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      env: { PORT: '8080', DB_PASS: 'super-secret-db-pass' },
      merge: true,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('updates app domain via PUT /paas/apps/:slug/domain', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        ok: true,
        slug: 'billing-api',
        domain: 'api.example.mesh',
        port: 8080,
        url: 'https://api.example.mesh',
        message: 'Domain updated',
      })
    );

    const res = await updateMeshPaasAppDomain({
      endpoint: 'http://10.0.0.5:3003',
      token: 'domain-token',
      appIdOrSlug: 'billing-api',
      domain: 'api.example.mesh',
      port: 8080,
      fetchImpl: fetchSpy,
    });

    expect(res).toEqual({
      ok: true,
      appIdOrSlug: 'billing-api',
      slug: 'billing-api',
      domain: 'api.example.mesh',
      port: 8080,
      url: 'https://api.example.mesh',
      message: 'Domain updated',
    });

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://10.0.0.5:3003/paas/apps/billing-api/domain');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer domain-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      domain: 'api.example.mesh',
      port: 8080,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('lists PaaS templates via GET /paas/templates', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        templates: [
          {
            id: 'postgres-16',
            name: 'PostgreSQL 16',
            category: 'database',
            image: 'postgres:16-alpine',
            defaultPort: 5432,
          },
        ],
      })
    );

    const templates = await listMeshPaasTemplates({
      endpoint: 'http://100.64.0.10:3003',
      token: 'tpl-token',
      fetchImpl: fetchSpy,
    });

    expect(templates).toHaveLength(1);
    expect(templates[0]?.id).toBe('postgres-16');

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://100.64.0.10:3003/paas/templates');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer tpl-token' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('deploys a Docker Compose stack via POST /paas/apps/deploy-compose', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        appId: 'app_stack',
        slug: 'web-stack',
        status: 'running',
        url: 'https://stack.mesh.local',
        deploymentId: 'dep_compose_1',
        message: 'Compose deployed for Bearer compose-token-123',
      })
    );

    const res = await deployComposeViaMoonWitnessMesh({
      endpoint: 'http://192.168.10.20:3003',
      token: 'compose-token-123',
      slug: 'web-stack',
      composeSpec: 'services:\n  web:\n    image: nginx:alpine\n',
      primaryService: 'web',
      port: 80,
      domain: 'stack.mesh.local',
      tenant: 'acme',
      env: { APP_SECRET: 'compose-env-secret' },
      fetchImpl: fetchSpy,
    });

    expect(res).toEqual({
      appId: 'app_stack',
      slug: 'web-stack',
      status: 'running',
      url: 'https://stack.mesh.local',
      deploymentId: 'dep_compose_1',
      message: 'Compose deployed for Bearer [REDACTED]',
    });

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://192.168.10.20:3003/paas/apps/deploy-compose');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer compose-token-123',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      slug: 'web-stack',
      composeSpec: 'services:\n  web:\n    image: nginx:alpine\n',
      primaryService: 'web',
      port: 80,
      domain: 'stack.mesh.local',
      tenant: 'acme',
      env: { APP_SECRET: 'compose-env-secret' },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('lists app deployments via GET /paas/apps/:slug/deployments and redacts messages', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        deployments: [
          {
            id: 'dep_1',
            slug: 'billing-api',
            action: 'deploy',
            image: 'node:24-alpine',
            status: 'running',
            message: 'Deployed with token=leak-me-123',
            createdAt: '2026-11-25T10:00:00Z',
          },
        ],
      })
    );

    const deployments = await listMeshPaasAppDeployments({
      endpoint: 'http://100.64.0.10:3003',
      token: 'dep-list-token',
      appIdOrSlug: 'billing-api',
      fetchImpl: fetchSpy,
    });

    expect(deployments).toHaveLength(1);
    expect(deployments[0]?.id).toBe('dep_1');
    expect(deployments[0]?.message).toContain('[REDACTED]');
    expect(deployments[0]?.message).not.toContain('leak-me-123');

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://100.64.0.10:3003/paas/apps/billing-api/deployments');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer dep-list-token' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('enforces SSRF blocking and error secret redaction across all new PaaS helpers', async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response('Failure with Bearer secret-bearer-999 password=dbpass-secret', {
          status: 500,
        })
    );

    const blockedEndpoint = 'https://evil.example.com';

    await expect(
      updateMeshPaasAppEnv({
        endpoint: blockedEndpoint,
        token: 'secret-bearer-999',
        appIdOrSlug: 'api',
        env: { A: '1' },
        fetchImpl: fetchSpy,
      })
    ).rejects.toThrow(/SSRF blocked/u);

    await expect(
      updateMeshPaasAppDomain({
        endpoint: blockedEndpoint,
        token: 'secret-bearer-999',
        appIdOrSlug: 'api',
        domain: 'app.local',
        fetchImpl: fetchSpy,
      })
    ).rejects.toThrow(/SSRF blocked/u);

    await expect(
      listMeshPaasTemplates({
        endpoint: blockedEndpoint,
        token: 'secret-bearer-999',
        fetchImpl: fetchSpy,
      })
    ).rejects.toThrow(/SSRF blocked/u);

    await expect(
      deployComposeViaMoonWitnessMesh({
        endpoint: blockedEndpoint,
        token: 'secret-bearer-999',
        slug: 'stack',
        composeSpec: 'services: {}',
        primaryService: 'app',
        port: 3000,
        fetchImpl: fetchSpy,
      })
    ).rejects.toThrow(/SSRF blocked/u);

    await expect(
      listMeshPaasAppDeployments({
        endpoint: blockedEndpoint,
        token: 'secret-bearer-999',
        appIdOrSlug: 'api',
        fetchImpl: fetchSpy,
      })
    ).rejects.toThrow(/SSRF blocked/u);

    expect(fetchSpy).not.toHaveBeenCalled();

    const privateEndpoint = 'http://100.64.0.10:3003';
    const errorCases = [
      () =>
        updateMeshPaasAppEnv({
          endpoint: privateEndpoint,
          token: 'secret-bearer-999',
          appIdOrSlug: 'api',
          env: { DB_PASS: 'dbpass-secret' },
          fetchImpl: fetchSpy,
        }),
      () =>
        updateMeshPaasAppDomain({
          endpoint: privateEndpoint,
          token: 'secret-bearer-999',
          appIdOrSlug: 'api',
          domain: 'app.local',
          fetchImpl: fetchSpy,
        }),
      () =>
        listMeshPaasTemplates({
          endpoint: privateEndpoint,
          token: 'secret-bearer-999',
          fetchImpl: fetchSpy,
        }),
      () =>
        deployComposeViaMoonWitnessMesh({
          endpoint: privateEndpoint,
          token: 'secret-bearer-999',
          slug: 'stack',
          composeSpec: 'services: {}',
          primaryService: 'app',
          port: 3000,
          env: { DB_PASS: 'dbpass-secret' },
          fetchImpl: fetchSpy,
        }),
      () =>
        listMeshPaasAppDeployments({
          endpoint: privateEndpoint,
          token: 'secret-bearer-999',
          appIdOrSlug: 'api',
          fetchImpl: fetchSpy,
        }),
    ];

    for (const run of errorCases) {
      const pending = run();
      await expect(pending).rejects.toThrow(/\[REDACTED\]/u);
      await expect(pending).rejects.not.toThrow(/secret-bearer-999|dbpass-secret/u);
    }
  });
});
