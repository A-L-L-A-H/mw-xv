import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AddonHttpPlugin } from '@moonwitness/orm';
import { CloudApp, CloudDeployment, CloudDeploymentTarget } from './models/index.js';

interface RequestAuth {
  readonly userId: number;
  readonly role: string;
  readonly companyId?: number;
}

export interface CloudHttpPluginOptions {
  readonly controlPlaneUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

function requestAuth(req: FastifyRequest): RequestAuth | null {
  const auth = (req as { auth?: RequestAuth | null }).auth;
  return auth && typeof auth.userId === 'number' ? auth : null;
}

function requireAuthorizedCompany(
  req: FastifyRequest,
  reply: FastifyReply
): { auth: RequestAuth; companyId: number } | null {
  const auth = requestAuth(req);
  if (!auth) {
    void reply.code(401).send({ success: false, error: 'Authentication required' });
    return null;
  }
  if (!auth.companyId) {
    void reply.code(403).send({ success: false, error: 'Active company context required' });
    return null;
  }
  return { auth, companyId: auth.companyId };
}

function isAdminRole(role: string): boolean {
  return role === 'system' || role === 'superadmin';
}

function parsePositiveId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseVolumes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\r\n,]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseEnvVars(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([key, value]) => `${key}=${String(value)}`);
}

export function createCloudHttpPlugin(options: CloudHttpPluginOptions = {}): AddonHttpPlugin {
  return async (fastifyApp) => {
    const fastify = fastifyApp as FastifyInstance;
    const defaultAgentUrl = (
      options.controlPlaneUrl ??
      process.env.MW_CONTROL_PLANE_URL ??
      'http://127.0.0.1:3003'
    ).replace(/\/+$/u, '');
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;

    fastify.get('/api/cloud/health', async (req, reply) => {
      const ctx = requireAuthorizedCompany(req, reply);
      if (!ctx) return;

      let controlPlane: 'connected' | 'unreachable' = 'unreachable';
      let docker = 'unknown';
      try {
        const res = await fetchImpl(`${defaultAgentUrl}/health`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) {
          controlPlane = 'connected';
          const payload = (await res.json()) as { docker?: string };
          if (typeof payload.docker === 'string') docker = payload.docker;
        }
      } catch {
        controlPlane = 'unreachable';
      }

      return {
        success: true,
        data: {
          controlPlane,
          docker,
        },
      };
    });

    fastify.get('/api/cloud/services', async (req, reply) => {
      const ctx = requireAuthorizedCompany(req, reply);
      if (!ctx) return;
      if (!isAdminRole(ctx.auth.role)) {
        return reply.code(403).send({ success: false, error: 'Admin role required' });
      }

      try {
        const res = await fetchImpl(`${defaultAgentUrl}/services`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          return reply.code(502).send({
            success: false,
            error: `Control plane returned ${res.status}`,
          });
        }
        const services = await res.json();
        return { success: true, data: services };
      } catch {
        return reply.code(502).send({
          success: false,
          error: 'Control plane is unreachable',
        });
      }
    });

    fastify.post<{ Params: { id: string } }>('/api/cloud/apps/:id/deploy', async (req, reply) => {
      const ctx = requireAuthorizedCompany(req, reply);
      if (!ctx) return;
      if (!isAdminRole(ctx.auth.role)) {
        return reply.code(403).send({ success: false, error: 'Admin role required to deploy apps' });
      }
      const appId = parsePositiveId(req.params.id);
      if (!appId) return reply.code(400).send({ success: false, error: 'Invalid cloud app ID' });

      const cloudApp = await CloudApp.query().findOne({
        id: appId,
        company_id: ctx.companyId,
        active: true,
      });
      if (!cloudApp) return reply.code(404).send({ success: false, error: 'Cloud app not found' });

      const target = await CloudDeploymentTarget.query().findOne({
        id: cloudApp.deployment_target_id,
        company_id: ctx.companyId,
        active: true,
      });
      const agentUrl = (options.controlPlaneUrl ?? target?.api_url ?? defaultAgentUrl).replace(
        /\/+$/u,
        ''
      );

      const imageRef = `${cloudApp.image}:${cloudApp.image_tag ?? 'latest'}`;
      const startedAt = new Date().toISOString().slice(0, 19);
      const deployment = await CloudDeployment.query().insertAndFetch({
        company_id: ctx.companyId,
        app_id: cloudApp.id,
        image_tag: cloudApp.image_tag ?? 'latest',
        status: 'pending',
        trigger: 'manual',
        started_at: startedAt,
      });

      const ports =
        cloudApp.host_port && cloudApp.port ? [`${cloudApp.host_port}:${cloudApp.port}`] : [];
      try {
        const res = await fetchImpl(`${agentUrl}/api/deploy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            image: imageRef,
            ports,
            volumes: parseVolumes(cloudApp.volumes),
            env: parseEnvVars(cloudApp.env_vars),
            restart: 'unless-stopped',
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          const completedAt = new Date().toISOString().slice(0, 19);
          await CloudDeployment.query().findById(deployment.id).patch({
            status: 'failed',
            completed_at: completedAt,
            error_message: `Control plane deploy failed (${res.status})`,
          });
          return reply.code(502).send({
            success: false,
            error: `Control plane deploy failed (${res.status})`,
          });
        }

        const result = (await res.json()) as { id?: string };
        const completedAt = new Date().toISOString().slice(0, 19);
        const updated = await CloudDeployment.query().patchAndFetchById(deployment.id, {
          status: 'running',
          container_id: result.id ?? null,
          completed_at: completedAt,
        });

        return reply.code(201).send({
          success: true,
          data: {
            deploymentId: updated.id,
            status: updated.status,
            containerId: updated.container_id,
          },
        });
      } catch {
        const completedAt = new Date().toISOString().slice(0, 19);
        await CloudDeployment.query().findById(deployment.id).patch({
          status: 'failed',
          completed_at: completedAt,
          error_message: 'Control plane is unreachable',
        });
        return reply.code(502).send({
          success: false,
          error: 'Control plane is unreachable',
        });
      }
    });
  };
}

export const cloudHttpPlugin = createCloudHttpPlugin();
