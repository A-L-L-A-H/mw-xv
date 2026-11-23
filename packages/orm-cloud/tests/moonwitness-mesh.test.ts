import { describe, expect, it, vi } from 'vitest';
import {
  assertPrivateMeshEndpoint,
  controlMeshPaasApp,
  deployViaMoonWitnessMesh,
  fetchMeshNodeMetrics,
  isPrivateMeshIp,
  listMeshPaasApps,
  redactMeshSecrets,
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
});
