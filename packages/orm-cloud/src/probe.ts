import type { Knex } from 'knex';
import { controlPlaneAuthHeaders, resolveControlPlaneToken } from './auth.js';
import { CloudDeploymentTarget } from './models/index.js';

const DEFAULT_HEALTH_TIMEOUT_MS = 3_000;

function statusFromHealthPayload(payload: unknown): 'healthy' | 'degraded' | 'offline' {
  const obj = payload as Record<string, unknown> | undefined;
  if (!obj || typeof obj !== 'object') return 'offline';
  const status = obj.status;
  const docker = obj.docker;
  if (status === 'ok' && docker !== 'error') return 'healthy';
  if (status === 'degraded' || status === 'error') return 'degraded';
  if (status === 'offline') return 'offline';
  return 'offline';
}

export interface ProbeCloudTargetsHealthOptions {
  readonly companyId?: number;
  readonly adminToken?: string;
  readonly jwtSecret?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface ProbeCloudTargetsHealthResult {
  readonly probed: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly offline: number;
}

export async function probeCloudTargetsHealth(
  options: ProbeCloudTargetsHealthOptions = {}
): Promise<ProbeCloudTargetsHealthResult> {
  const resolvedToken =
    options.adminToken ??
    resolveControlPlaneToken({ jwtSecret: options.jwtSecret });
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const targets = await CloudDeploymentTarget.query()
    .where({ is_active: true, active: true })
    .modify((builder) => {
      if (typeof options.companyId === 'number') builder.where('company_id', options.companyId);
    });

  let healthy = 0;
  let degraded = 0;
  let offline = 0;

  for (const target of targets) {
    const url = target.api_url ?? 'http://127.0.0.1:3003';
    let resolvedStatus: 'healthy' | 'degraded' | 'offline' = 'offline';
    try {
      const res = await fetchImpl(`${url.replace(/\/+$/u, '')}/health`, {
        headers: controlPlaneAuthHeaders(resolvedToken),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const payload = (await res.json()) as unknown;
        resolvedStatus = statusFromHealthPayload(payload);
      } else if (res.status >= 500) {
        resolvedStatus = 'degraded';
      } else {
        resolvedStatus = 'offline';
      }
    } catch {
      resolvedStatus = 'offline';
    }

    if (target.health_status !== resolvedStatus) {
      await CloudDeploymentTarget.query().findById(target.id).patch({ health_status: resolvedStatus });
    }

    switch (resolvedStatus) {
      case 'healthy': healthy += 1; break;
      case 'degraded': degraded += 1; break;
      default: offline += 1; break;
    }
  }

  return { probed: targets.length, healthy, degraded, offline };
}

