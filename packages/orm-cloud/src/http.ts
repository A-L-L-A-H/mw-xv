import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AddonHttpPlugin } from '@moonwitness/orm';
import { Subscription } from '@moonwitness/orm-subscription';
import { selectHealthyDeploymentTarget } from './ha.js';
import {
  CloudApp,
  CloudDeployment,
  CloudDeploymentTarget,
  CloudProvider,
  CloudServer,
} from './models/index.js';
import { deployViaCoolify } from './providers/coolify.js';
import { exportCloudTerraformHcl } from './terraform.js';
import { probeCloudTargetsHealth } from './probe.js';
import { controlPlaneAuthHeaders, resolveControlPlaneToken } from './auth.js';

interface GroupGrant {
  readonly model_name: string;
  readonly read: boolean;
  readonly create: boolean;
  readonly write: boolean;
  readonly unlink: boolean;
}

interface RequestAuth {
  readonly userId: number;
  readonly role: string;
  readonly companyId?: number;
  readonly groupPermissions?: readonly GroupGrant[];
}

export interface CloudHttpPluginOptions {
  readonly controlPlaneUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly adminToken?: string;
  readonly jwtSecret?: string;
}

function requestAuth(req: FastifyRequest): RequestAuth | null {
  const auth = (req as { auth?: RequestAuth | null }).auth;
  return auth && typeof auth.userId === 'number' ? auth : null;
}

function hasModelAccess(
  auth: RequestAuth,
  modelName: string,
  op: 'read' | 'create' | 'write' | 'unlink'
): boolean {
  if (auth.role === 'system' || auth.role === 'superadmin') return true;
  if (auth.role !== 'user') return false;
  return (auth.groupPermissions ?? []).some((g) => g.model_name === modelName && g[op] === true);
}

function requireAuthorizedModelAccess(
  req: FastifyRequest,
  reply: FastifyReply,
  modelName: string,
  op: 'read' | 'create' | 'write' | 'unlink'
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
  if (!hasModelAccess(auth, modelName, op)) {
    void reply.code(403).send({ success: false, error: `Access denied for ${modelName}:${op}` });
    return null;
  }
  return { auth, companyId: auth.companyId };
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
  return Object.entries(raw as Record<string, unknown>).map(
    ([key, value]) => `${key}=${String(value)}`
  );
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
    const resolvedToken =
      options.adminToken ?? resolveControlPlaneToken({ jwtSecret: options.jwtSecret });

    async function controlPlaneFetch(input: string, init?: RequestInit): Promise<Response> {
      return fetchImpl(input, {
        ...init,
        headers: {
          ...controlPlaneAuthHeaders(resolvedToken),
          ...init?.headers,
        },
        signal: AbortSignal.timeout(30_000),
      });
    }

    fastify.get('/api/cloud/health', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(req, reply, CloudApp.modelName, 'read');
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
      const ctx = requireAuthorizedModelAccess(req, reply, CloudApp.modelName, 'read');
      if (!ctx) return;
      if (ctx.auth.role !== 'system' && ctx.auth.role !== 'superadmin') {
        return reply.code(403).send({ success: false, error: 'Admin role required' });
      }

      try {
        const res = await controlPlaneFetch(`${defaultAgentUrl}/services`, {
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
      const ctx = requireAuthorizedModelAccess(req, reply, CloudApp.modelName, 'write');
      if (!ctx) return;
      const appId = parsePositiveId(req.params.id);
      if (!appId) return reply.code(400).send({ success: false, error: 'Invalid cloud app ID' });

      const cloudApp = await CloudApp.query().findOne({
        id: appId,
        company_id: ctx.companyId,
        active: true,
      });
      if (!cloudApp) return reply.code(404).send({ success: false, error: 'Cloud app not found' });

      if (cloudApp.subscription_id) {
        const subscription = await Subscription.query().findOne({
          id: cloudApp.subscription_id,
          company_id: ctx.companyId,
          active: true,
        });
        if (!subscription || subscription.state !== 'active') {
          return reply.code(402).send({
            success: false,
            code: 'SUBSCRIPTION_INACTIVE',
            error: `Linked subscription is ${subscription?.state ?? 'missing'}`,
          });
        }
      }

      const assignedTarget = await CloudDeploymentTarget.query().findOne({
        id: cloudApp.deployment_target_id,
        company_id: ctx.companyId,
        active: true,
      });
      let effectiveTarget = assignedTarget;
      if (assignedTarget?.ha_group && assignedTarget.health_status === 'offline') {
        const peers = await CloudDeploymentTarget.query().where({
          company_id: ctx.companyId,
          ha_group: assignedTarget.ha_group,
          active: true,
        });
        effectiveTarget = selectHealthyDeploymentTarget(peers) ?? assignedTarget;
      }

      const server = effectiveTarget?.server_id
        ? await CloudServer.query().findOne({
            id: effectiveTarget.server_id,
            company_id: ctx.companyId,
            active: true,
          })
        : undefined;
      const provider = server
        ? await CloudProvider.query().findOne({
            id: server.provider_id,
            company_id: ctx.companyId,
            active: true,
          })
        : undefined;

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

      if (provider?.type === 'coolify') {
        try {
          const coolifyEndpoint = (
            provider.endpoint ??
            effectiveTarget?.api_url ??
            'https://coolify.moonwitness.local'
          ).replace(/\/+$/u, '');
          const coolifyResult = await deployViaCoolify({
            endpoint: coolifyEndpoint,
            token: provider.secret_key ?? provider.access_key ?? '',
            appUuid: cloudApp.coolify_uuid ?? cloudApp.name,
            fetchImpl,
          });
          const completedAt = new Date().toISOString().slice(0, 19);
          const updated = await CloudDeployment.query().patchAndFetchById(deployment.id, {
            status: 'running',
            container_id: coolifyResult.deploymentUuid ?? null,
            log: coolifyResult.message,
            completed_at: completedAt,
          });
          return reply.code(201).send({
            success: true,
            data: {
              deploymentId: updated.id,
              status: updated.status,
              containerId: updated.container_id,
              provider: 'coolify',
            },
          });
        } catch (err) {
          const completedAt = new Date().toISOString().slice(0, 19);
          const message = err instanceof Error ? err.message : 'Coolify deploy failed';
          await CloudDeployment.query().findById(deployment.id).patch({
            status: 'failed',
            completed_at: completedAt,
            error_message: message,
          });
          return reply.code(502).send({ success: false, error: message });
        }
      }

      const agentUrl = (options.controlPlaneUrl ?? effectiveTarget?.api_url ?? defaultAgentUrl).replace(
        /\/+$/u,
        ''
      );
      const ports =
        cloudApp.host_port && cloudApp.port ? [`${cloudApp.host_port}:${cloudApp.port}`] : [];
      try {
        const res = await controlPlaneFetch(`${agentUrl}/api/deploy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: cloudApp.name,
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
          log: `Deployed ${imageRef} via Docker Agent`,
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

    fastify.post<{ Params: { id: string } }>(
      '/api/cloud/subscriptions/:id/enforce',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, CloudApp.modelName, 'write');
        if (!ctx) return;
        const subscriptionId = parsePositiveId(req.params.id);
        if (!subscriptionId) {
          return reply.code(400).send({ success: false, error: 'Invalid subscription ID' });
        }

        const subscription = await Subscription.query().findOne({
          id: subscriptionId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!subscription) {
          return reply.code(404).send({ success: false, error: 'Subscription not found' });
        }

        if (subscription.state === 'active') {
          return { success: true, data: { suspendedApps: 0, state: subscription.state } };
        }

        const apps = await CloudApp.query().where({
          company_id: ctx.companyId,
          subscription_id: subscription.id,
          is_active: true,
          active: true,
        });

        const nowIso = new Date().toISOString().slice(0, 19);
        for (const app of apps) {
          await CloudApp.query().findById(app.id).patch({ is_active: false });
          await CloudDeployment.query().insert({
            company_id: ctx.companyId,
            app_id: app.id,
            image_tag: app.image_tag ?? 'latest',
            status: 'stopped',
            trigger: 'agent',
            started_at: nowIso,
            completed_at: nowIso,
            log: `Suspended due to subscription ${subscription.state}`,
          });
        }

        return {
          success: true,
          data: { suspendedApps: apps.length, state: subscription.state },
        };
      }
    );

    fastify.get<{ Params: { id: string } }>(
      '/api/cloud/deployments/:id/logs',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, CloudDeployment.modelName, 'read');
        if (!ctx) return;
        const deploymentId = parsePositiveId(req.params.id);
        if (!deploymentId) {
          return reply.code(400).send({ success: false, error: 'Invalid deployment ID' });
        }

        const deployment = await CloudDeployment.query().findOne({
          id: deploymentId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!deployment) {
          return reply.code(404).send({ success: false, error: 'Deployment not found' });
        }

        let liveLog: string | null = null;
        let live = false;
        if (deployment.container_id) {
          try {
            const cloudAppRecord = await CloudApp.query().findById(deployment.app_id);
            const target = cloudAppRecord
              ? await CloudDeploymentTarget.query().findById(cloudAppRecord.deployment_target_id)
              : undefined;
            const server = target?.server_id
              ? await CloudServer.query().findById(target.server_id)
              : undefined;
            const provider = server
              ? await CloudProvider.query().findById(server.provider_id)
              : undefined;
            if (provider?.type !== 'coolify') {
              const agentUrl = (
                options.controlPlaneUrl ??
                process.env.MW_CONTROL_PLANE_URL ??
                defaultAgentUrl
              ).replace(/\/+$/u, '');
              const res = await controlPlaneFetch(
                `${agentUrl}/api/containers/${encodeURIComponent(deployment.container_id)}/logs?tail=200`,
                { signal: AbortSignal.timeout(5_000) }
              );
              if (res.ok) {
                const body = (await res.json()) as { id?: string; logs?: string };
                liveLog = body?.logs ?? null;
                live = true;
              }
            }
          } catch {
            // fall back to stored deployment.log below
          }
        }

        return {
          success: true,
          data: {
            id: deployment.id,
            appId: deployment.app_id,
            status: deployment.status,
            containerId: deployment.container_id ?? null,
            startedAt: deployment.started_at ?? null,
            completedAt: deployment.completed_at ?? null,
            log: liveLog ?? deployment.log ?? '',
            errorMessage: deployment.error_message ?? null,
            live,
          },
        };
      }
    );

    fastify.get<{ Params: { id: string } }>(
      '/api/cloud/deployments/:id/logs/stream',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, CloudDeployment.modelName, 'read');
        if (!ctx) return;
        const deploymentId = parsePositiveId(req.params.id);
        if (!deploymentId) {
          return reply.code(400).send({ success: false, error: 'Invalid deployment ID' });
        }

        const deployment = await CloudDeployment.query().findOne({
          id: deploymentId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!deployment) {
          return reply.code(404).send({ success: false, error: 'Deployment not found' });
        }

        const payload = JSON.stringify({
          id: deployment.id,
          status: deployment.status,
          containerId: deployment.container_id ?? null,
          log: deployment.log ?? '',
          errorMessage: deployment.error_message ?? null,
        });

        let upstream: Response | null = null;
        let upstreamUrl: string | null = null;
        if (deployment.container_id) {
          try {
            const cloudAppRecord = await CloudApp.query().findById(deployment.app_id);
            const target = cloudAppRecord
              ? await CloudDeploymentTarget.query().findById(cloudAppRecord.deployment_target_id)
              : undefined;
            const server = target?.server_id
              ? await CloudServer.query().findById(target.server_id)
              : undefined;
            const provider = server
              ? await CloudProvider.query().findById(server.provider_id)
              : undefined;
            if (provider?.type !== 'coolify') {
              const agentUrl = (
                options.controlPlaneUrl ??
                process.env.MW_CONTROL_PLANE_URL ??
                defaultAgentUrl
              ).replace(/\/+$/u, '');
              upstreamUrl = `${agentUrl}/api/containers/${encodeURIComponent(deployment.container_id)}/logs?follow=true&tail=100`;
              const controller = new AbortController();
              req.raw.once('close', () => controller.abort());
              const res = await fetchImpl(upstreamUrl, {
                headers: controlPlaneAuthHeaders(resolvedToken),
                signal: controller.signal,
              });
              if (res.ok && res.body) upstream = res;
            }
          } catch {
            upstream = null;
          }
        }

        if (!upstream) {
          return reply
            .header('content-type', 'text/event-stream; charset=utf-8')
            .header('cache-control', 'no-cache')
            .send(`event: deployment\ndata: ${payload}\n\n`);
        }

        reply.hijack();
        const raw = reply.raw;
        raw.statusCode = 200;
        raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
        raw.setHeader('cache-control', 'no-cache');
        raw.setHeader('connection', 'keep-alive');
        raw.write(`event: deployment\ndata: ${payload}\n\n`);
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) raw.write(decoder.decode(value, { stream: true }));
          }
        } catch {
          // upstream closed or client disconnected
        } finally {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          raw.end();
        }
        return reply;
      }
    );

    fastify.post('/api/cloud/targets/probe', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(req, reply, CloudDeploymentTarget.modelName, 'write');
      if (!ctx) return;
      const result = await probeCloudTargetsHealth({
        companyId: ctx.companyId,
        adminToken: resolvedToken,
        fetchImpl,
      });
      return { success: true, data: result };
    });

    fastify.get('/api/cloud/export/terraform', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(req, reply, CloudApp.modelName, 'read');
      if (!ctx) return;
      const hcl = await exportCloudTerraformHcl(ctx.companyId);
      return reply.type('text/plain; charset=utf-8').send(hcl);
    });
  };
}

export const cloudHttpPlugin = createCloudHttpPlugin();
