import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  parsePositiveId,
  requireAuthorizedModelAccess as requireOrmModelAccess,
  type AddonHttpPlugin,
  type RequestAuth,
} from '@moonwitness/orm';
import { Subscription } from '@moonwitness/orm-subscription';
import { DEFAULT_CONTROL_PLANE_URL, trimTrailingSlashes } from '@moonwitness/types';
import { selectHealthyDeploymentTarget } from './ha.js';
import {
  CloudApp,
  CloudDeployment,
  CloudDeploymentTarget,
  CloudProvider,
  CloudServer,
} from './models/index.js';
import {
  applyDeploymentEvent,
  deployViaCoolify,
  planDeploymentRetry,
  reconcileDeploymentOutcome,
  type CloudDeploymentState,
} from './providers/coolify.js';
import {
  controlAgentContainer,
  deployAgentGit,
  fetchAgentContainerStats,
  fetchMeshNodeMetrics,
  listAgentContainers,
  listMeshPaasApps,
  runAgentContainer,
  upAgentCompose,
} from './providers/moonwitness-mesh.js';
import type { PaasQuotaReservationLedger } from './quota.js';
import {
  allocatePreviewPort,
  isValidPublicDomain,
  readPaasInstanceSettings,
  reconcileCaddyWithAgent,
} from './paas-state.js';
import { compileCoolifyCompose } from './coolify-compose-compiler.js';
import {
  listCoolifyTemplates,
  getCoolifyTemplateDetail,
  type CoolifyCompatibility,
} from './coolify-template-pack.js';
import { exportCloudTerraformHcl } from './terraform.js';
import { probeCloudTargetsHealth, assertProbeTarget, readBoundedResponseBody } from './probe.js';
import {
  classifySecret,
  controlPlaneAuthHeaders,
  CloudConfigError,
  normalizeCloudOutcome,
  readCloudReadiness,
  recordCloudOperation,
  redactSecrets,
  resolveControlPlaneToken,
  validateCloudConfig,
  type CloudConfigInput,
  type CloudFeature,
  type CloudOperation,
  type CloudOutcome,
  type CloudProviderLabel,
} from './auth.js';
import type { ProbeTargetPolicy } from './probe.js';
import { registerPaasBackupRoutes } from './routes/paas-backups.js';
import { registerPaasSettingsAndMeshRoutes } from './routes/paas-settings.js';
import { registerSystemUpdateRoutes } from './routes/system-update.js';

export interface CloudHttpPluginOptions extends CloudConfigInput {
  readonly fetchImpl?: typeof fetch;
  /** Throw at plugin construction when an explicitly enabled feature is invalid. */
  readonly strictStartup?: boolean;
  readonly probePolicy?: ProbeTargetPolicy;
  /** Optional reservation authority. Without one, provisioning stays a safe no-op reservation. */
  readonly quotaLedger?: PaasQuotaReservationLedger;
  readonly quotaCapacity?: number;
  readonly quotaUnits?: number;
}

/** Route/model access matrix: every operation declares auth, company, model permission and feature. */
export interface CloudRouteAccessRule {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly operation: CloudOperation;
  readonly model: string;
  readonly permission: 'read' | 'create' | 'write' | 'unlink';
  readonly adminOnly: boolean;
  readonly feature: CloudFeature;
  readonly resourceId: boolean;
}

export const CLOUD_ROUTE_ACCESS_MATRIX: readonly CloudRouteAccessRule[] = Object.freeze([
  {
    method: 'GET',
    path: '/api/cloud/health',
    operation: 'control_plane.health',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'GET',
    path: '/api/cloud/services',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: true,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'GET',
    path: '/api/cloud/readiness',
    operation: 'config.readiness',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/apps/:id/deploy',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: true,
  },
  {
    method: 'DELETE',
    path: '/api/cloud/apps/:id',
    operation: 'app.delete',
    model: 'cloud.app',
    permission: 'unlink',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: true,
  },
  {
    method: 'POST',
    path: '/api/cloud/subscriptions/:id/enforce',
    operation: 'subscription.enforce',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: true,
  },
  {
    method: 'GET',
    path: '/api/cloud/deployments/:id/logs',
    operation: 'deployment.logs',
    model: 'cloud.deployment',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: true,
  },
  {
    method: 'GET',
    path: '/api/cloud/deployments/:id/logs/stream',
    operation: 'deployment.logs.stream',
    model: 'cloud.deployment',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: true,
  },
  {
    method: 'POST',
    path: '/api/cloud/targets/probe',
    operation: 'target.probe',
    model: 'cloud.deployment_target',
    permission: 'write',
    adminOnly: false,
    feature: 'providerProbe',
    resourceId: true,
  },
  {
    method: 'GET',
    path: '/api/cloud/export/terraform',
    operation: 'terraform.export',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'terraformExport',
    resourceId: false,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/metrics',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/apps',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/templates',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/apps/deploy',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/apps/deploy-compose',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/apps/deploy-git',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/webhooks/github/:slug',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: true,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/apps/:slug/:action',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: true,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/apps/:slug/stats',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: true,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/apps/:slug',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: true,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/apps/:slug/env',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: true,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/apps/:slug/domain',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: true,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/apps/:slug/logs/stream',
    operation: 'deployment.logs.stream',
    model: 'cloud.deployment',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: true,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/backups',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/backups/postgres',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/backups/restore',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: false,
    feature: 'provisioning',
    resourceId: false,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/settings',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: true,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/settings/verify-dns',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: true,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/settings/apply',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: true,
    feature: 'provisioning',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/settings/promote-wildcard',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: true,
    feature: 'provisioning',
    resourceId: false,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/mesh/status',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'GET',
    path: '/api/cloud/paas/templates/:id',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: false,
    feature: 'controlPlane',
    resourceId: true,
  },
  {
    method: 'POST',
    path: '/api/cloud/paas/templates/deploy',
    operation: 'app.deploy',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: true,
    feature: 'provisioning',
    resourceId: false,
  },
  {
    method: 'GET',
    path: '/api/cloud/system/update',
    operation: 'control_plane.services',
    model: 'cloud.app',
    permission: 'read',
    adminOnly: true,
    feature: 'controlPlane',
    resourceId: false,
  },
  {
    method: 'POST',
    path: '/api/cloud/system/update/apply',
    operation: 'provisioning.request',
    model: 'cloud.app',
    permission: 'write',
    adminOnly: true,
    feature: 'controlPlane',
    resourceId: false,
  },
]);

const AMBIGUOUS_TIMEOUT_MARKER = 'PROVIDER_TIMEOUT_AMBIGUOUS';

export class CloudIdempotencyError extends Error {
  readonly code: 'INVALID_IDEMPOTENCY_KEY' | 'IDEMPOTENCY_PAYLOAD_CONFLICT';

  constructor(code: 'INVALID_IDEMPOTENCY_KEY' | 'IDEMPOTENCY_PAYLOAD_CONFLICT', message: string) {
    super(message);
    this.name = 'CloudIdempotencyError';
    this.code = code;
  }
}

const keyedLocks = new Map<string, Promise<unknown>>();

/** Serializes in-process duplicates; the deployment row is the shared replay record. */
export function withCloudKeyedLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = keyedLocks.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation) as Promise<T>;
  const settled = result.finally(() => {
    if (keyedLocks.get(key) === settled) keyedLocks.delete(key);
  });
  keyedLocks.set(key, settled);
  return settled;
}

const IDEM_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;

function readIdempotencyKey(req: FastifyRequest): string | undefined {
  const raw = req.headers['idempotency-key'] ?? req.headers['x-idempotency-key'];
  if (raw === undefined) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !IDEM_KEY_PATTERN.test(value.trim())) {
    throw new CloudIdempotencyError(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency key must be 8-128 characters using letters, digits, dot, underscore, colon or dash'
    );
  }
  return value.trim();
}

/** Company is part of the hash, so a key issued for tenant A never matches tenant B. */
export function idempotencyStoreKey(companyId: number, key: string): string {
  return createHash('sha256').update(`${companyId}\u0000${key}`).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function idempotencyPayloadFingerprint(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function findIdempotentDeployment(companyId: number, appId: number, storeKey: string) {
  return CloudDeployment.query()
    .where({ company_id: companyId, app_id: appId })
    .where('version', 'like', `idem:${storeKey}:%`)
    .orderBy('id', 'desc')
    .first();
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

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const message = (error as { message?: unknown }).message;
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    (typeof message === 'string' && /timeout|aborted/iu.test(message))
  );
}

function safeErrorText(
  error: unknown,
  secrets: readonly (string | null | undefined)[],
  fallback: string
): string {
  const text = error instanceof Error ? error.message : fallback;
  return redactSecrets(text, secrets).slice(0, 300) || fallback;
}

function toDeploymentState(status: string | undefined | null): CloudDeploymentState {
  switch (status) {
    case 'building':
    case 'running':
    case 'failed':
    case 'stopped':
      return status;
    default:
      return 'pending';
  }
}

/** The ORM status enum has no 'unknown'; ambiguous outcomes stay pending with a marker. */
function storableDeploymentStatus(
  state: CloudDeploymentState
): 'pending' | 'building' | 'running' | 'failed' | 'stopped' {
  return state === 'unknown' ? 'pending' : state;
}

interface DeployOutcome {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
}

export function createCloudHttpPlugin(options: CloudHttpPluginOptions = {}): AddonHttpPlugin {
  return async (fastifyApp) => {
    // Resolve configuration when the plugin is registered, not when the module is
    // imported, so applications can set environment configuration during bootstrap.
    const validation = validateCloudConfig(options);
    if (options.strictStartup && !validation.ok) throw new CloudConfigError(validation);
    const fastify = fastifyApp as FastifyInstance;
    const features = validation.value?.features;
    const defaultAgentUrl = trimTrailingSlashes(
      options.controlPlaneUrl ?? process.env.MW_CONTROL_PLANE_URL ?? DEFAULT_CONTROL_PLANE_URL
    );
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const resolvedToken =
      validation.value?.adminToken ??
      resolveControlPlaneToken({ adminToken: options.adminToken, jwtSecret: options.jwtSecret });
    const requestPolicy: ProbeTargetPolicy = {
      ...options.probePolicy,
      allowedHosts: [
        ...(options.probePolicy?.allowedHosts ?? []),
        ...(validation.value?.allowedProbeHosts ?? []),
      ],
    };
    const quotaLedger = options.quotaLedger;
    const quotaCapacity = Number.isSafeInteger(options.quotaCapacity)
      ? Number(options.quotaCapacity)
      : 1_000;
    const quotaUnits =
      Number.isSafeInteger(options.quotaUnits) && Number(options.quotaUnits) > 0
        ? Number(options.quotaUnits)
        : 1;

    // Per-route rate limits, activated by @fastify/rate-limit when the host app
    // registers it with `global: false` (see packages/orm-observability/src/http-plugin.ts).
    const READ_RATE_LIMIT = {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    } as const;
    const WRITE_RATE_LIMIT = {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    } as const;

    const mark = (
      operation: CloudOperation,
      outcome: CloudOutcome,
      provider: CloudProviderLabel | string = 'none'
    ) => {
      recordCloudOperation({ operation, outcome, provider });
    };

    const requireAuthorizedModelAccess = (
      req: FastifyRequest,
      reply: FastifyReply,
      rule: CloudRouteAccessRule
    ): { auth: RequestAuth; companyId: number } | null =>
      requireOrmModelAccess(req, reply, rule.model, rule.permission, {
        adminOnly: rule.adminOnly,
        onDenied: () => mark(rule.operation, 'denied'),
      });

    const requireFeature = (reply: FastifyReply, rule: CloudRouteAccessRule): boolean => {
      if (!features?.[rule.feature] || !validation.ok) {
        const code = features?.[rule.feature]
          ? (validation.reasonCodes[0] ?? 'CLOUD_CONFIG_INVALID')
          : 'CLOUD_FEATURE_DISABLED';
        mark(rule.operation, 'denied');
        void reply.code(503).send({
          success: false,
          code,
          error: 'Cloud feature is unavailable with the current configuration',
        });
        return false;
      }
      return true;
    };

    const requireToken = (reply: FastifyReply, rule: CloudRouteAccessRule): boolean => {
      const quality = classifySecret(resolvedToken);
      if (quality !== 'ok') {
        mark(rule.operation, 'denied');
        void reply.code(503).send({
          success: false,
          code:
            quality === 'missing'
              ? 'CLOUD_TOKEN_MISSING'
              : quality === 'weak'
                ? 'CLOUD_TOKEN_WEAK'
                : 'CLOUD_TOKEN_MALFORMED',
          error: 'Privileged cloud operations require valid control-plane credentials',
        });
        return false;
      }
      return true;
    };

    async function controlPlaneFetch(input: string, init?: RequestInit): Promise<Response> {
      assertProbeTarget(input, requestPolicy);
      try {
        const response = await fetchImpl(input, {
          ...init,
          headers: {
            ...controlPlaneAuthHeaders(resolvedToken),
            ...init?.headers,
          },
          signal: init?.signal ?? AbortSignal.timeout(30_000),
        });
        mark('provider.request', normalizeCloudOutcome(response.status), 'docker_agent');
        return response;
      } catch (error) {
        if (isTimeout(error)) mark('provider.request', 'timeout', 'docker_agent');
        else mark('provider.request', 'failed', 'docker_agent');
        throw error;
      }
    }

    const scopedApp = (id: number, companyId: number) =>
      CloudApp.query().findOne({ id, company_id: companyId, active: true });
    const scopedTarget = (id: number | null | undefined, companyId: number) =>
      id
        ? CloudDeploymentTarget.query().findOne({ id, company_id: companyId, active: true })
        : undefined;
    const scopedServer = (id: number | null | undefined, companyId: number) =>
      id ? CloudServer.query().findOne({ id, company_id: companyId, active: true }) : undefined;
    const scopedProvider = (id: number | null | undefined, companyId: number) =>
      id ? CloudProvider.query().findOne({ id, company_id: companyId, active: true }) : undefined;
    const scopedDeployment = (id: number, companyId: number) =>
      CloudDeployment.query().findOne({ id, company_id: companyId, active: true });

    const ruleFor = (path: string): CloudRouteAccessRule => {
      const rule = CLOUD_ROUTE_ACCESS_MATRIX.find((candidate) => candidate.path === path);
      if (!rule) throw new Error(`Missing cloud route access rule for ${path}`);
      return rule;
    };

    fastify.get('/api/cloud/health', READ_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/health');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      let controlPlane: 'connected' | 'unreachable' = 'unreachable';
      let docker = 'unknown';
      try {
        const url = assertProbeTarget(`${defaultAgentUrl}/health`, requestPolicy);
        const res = await controlPlaneFetch(url.toString(), {
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) {
          controlPlane = 'connected';
          const body = await readBoundedResponseBody(res);
          if (body.ok) {
            const payload = JSON.parse(body.text) as { docker?: unknown };
            if (
              typeof payload?.docker === 'string' &&
              /^[a-z0-9_.-]{1,32}$/iu.test(payload.docker)
            ) {
              docker = payload.docker;
            }
          }
        }
      } catch {
        controlPlane = 'unreachable';
      }

      mark(rule.operation, 'success');
      return {
        success: true,
        data: { controlPlane, docker },
      };
    });

    fastify.get('/api/cloud/services', READ_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/services');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      try {
        const res = await controlPlaneFetch(`${defaultAgentUrl}/services`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          mark(rule.operation, 'failed');
          return reply
            .code(502)
            .send({ success: false, error: `Control plane returned ${res.status}` });
        }
        const services = await res.json();
        mark(rule.operation, 'success');
        return { success: true, data: services };
      } catch {
        mark(rule.operation, 'offline');
        return reply.code(502).send({ success: false, error: 'Control plane is unreachable' });
      }
    });

    fastify.get('/api/cloud/readiness', READ_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/readiness');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      mark(rule.operation, 'success');
      return { success: true, data: readCloudReadiness(validation) };
    });

    fastify.post<{ Params: { id: string } }>(
      '/api/cloud/apps/:id/deploy',
      WRITE_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/apps/:id/deploy');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;

        const appId = parsePositiveId(req.params.id);
        if (!appId) {
          mark(rule.operation, 'invalid');
          return reply.code(400).send({ success: false, error: 'Invalid cloud app ID' });
        }
        const cloudApp = await scopedApp(appId, ctx.companyId);
        if (!cloudApp) {
          mark(rule.operation, 'denied');
          return reply.code(404).send({ success: false, error: 'Cloud app not found' });
        }

        let idempotencyKey: string | undefined;
        let storeKey: string | undefined;
        let fingerprint: string | undefined;
        let pendingReservationId: string | undefined;
        try {
          idempotencyKey = readIdempotencyKey(req);
          if (idempotencyKey) {
            storeKey = idempotencyStoreKey(ctx.companyId, idempotencyKey);
            fingerprint = idempotencyPayloadFingerprint({
              appId: cloudApp.id,
              image: cloudApp.image,
              imageTag: cloudApp.image_tag,
              targetId: cloudApp.deployment_target_id,
              env: parseEnvVars(cloudApp.env_vars),
              volumes: parseVolumes(cloudApp.volumes),
              hostPort: cloudApp.host_port,
              port: cloudApp.port,
              domain: cloudApp.domain,
            });
          }
        } catch (error) {
          mark(rule.operation, 'invalid');
          return reply.code(400).send({
            success: false,
            code: error instanceof CloudIdempotencyError ? error.code : 'INVALID_IDEMPOTENCY_KEY',
            error: error instanceof Error ? error.message : 'Invalid idempotency key',
          });
        }

        const performDeploy = async (): Promise<DeployOutcome> => {
          if (cloudApp.subscription_id) {
            const subscription = await Subscription.query().findOne({
              id: cloudApp.subscription_id,
              company_id: ctx.companyId,
              active: true,
            });
            if (!subscription || subscription.state !== 'active') {
              mark(rule.operation, 'denied');
              return {
                statusCode: 402,
                body: {
                  success: false,
                  code: 'SUBSCRIPTION_INACTIVE',
                  error: subscription
                    ? 'Linked subscription is not active'
                    : 'Linked subscription is missing',
                },
              };
            }
          }

          // Reservation boundary: the quota ledger is the capacity authority. A
          // missing ledger is a safe no-op; a configured ledger fails closed.
          if (quotaLedger) {
            const imageRefForQuota = `${cloudApp.image}:${cloudApp.image_tag ?? 'latest'}`;
            const reservationKey =
              storeKey ??
              idempotencyStoreKey(
                ctx.companyId,
                idempotencyPayloadFingerprint({
                  appId: cloudApp.id,
                  imageRef: imageRefForQuota,
                  targetId: cloudApp.deployment_target_id,
                })
              );
            try {
              const outcome = await quotaLedger.reserve({
                scope: { companyId: ctx.companyId, resource: 'cloud.app.deploy' },
                idempotencyKey: reservationKey,
                units: quotaUnits,
                capacity: quotaCapacity,
              });
              if (!outcome.allowed || !outcome.reservation) {
                mark(rule.operation, 'denied');
                return {
                  statusCode: 402,
                  body: {
                    success: false,
                    code: outcome.code ?? 'PAAS_QUOTA_RESERVATION_EXCEEDED',
                    error: 'Provisioning quota exceeded',
                  },
                };
              }
              pendingReservationId = outcome.reservation.id;
            } catch {
              mark(rule.operation, 'denied');
              return {
                statusCode: 503,
                body: {
                  success: false,
                  code: 'CLOUD_QUOTA_UNAVAILABLE',
                  error: 'Provisioning quota is unavailable',
                },
              };
            }
          }

          const assignedTarget = await scopedTarget(cloudApp.deployment_target_id, ctx.companyId);
          let effectiveTarget = assignedTarget;
          if (assignedTarget?.ha_group && assignedTarget.health_status === 'offline') {
            const peers = await CloudDeploymentTarget.query().where({
              company_id: ctx.companyId,
              ha_group: assignedTarget.ha_group,
              active: true,
            });
            effectiveTarget = selectHealthyDeploymentTarget(peers) ?? assignedTarget;
          }

          const server = await scopedServer(effectiveTarget?.server_id, ctx.companyId);
          const provider = await scopedProvider(server?.provider_id, ctx.companyId);
          const imageRef = `${cloudApp.image}:${cloudApp.image_tag ?? 'latest'}`;
          const startedAt = new Date().toISOString().slice(0, 19);
          const deployment = await CloudDeployment.query().insertAndFetch({
            company_id: ctx.companyId,
            app_id: cloudApp.id,
            version: storeKey && fingerprint ? `idem:${storeKey}:${fingerprint}` : undefined,
            image_tag: cloudApp.image_tag ?? 'latest',
            status: 'pending',
            trigger: 'manual',
            started_at: startedAt,
          });

          const finalize = async (patch: Record<string, unknown>, outcome: DeployOutcome) => {
            await CloudDeployment.query().findById(deployment.id).patch(patch);
            return outcome;
          };

          // State transitions go through CLOUD-B's state machine; terminal states
          // cannot be overwritten by late/out-of-order provider events.
          const transitionStatus = (
            kind:
              | 'provider_started'
              | 'provider_succeeded'
              | 'provider_failed'
              | 'provider_timeout'
              | 'provider_cancelled',
            providerCorrelationId?: string
          ) => {
            const transition = applyDeploymentEvent(toDeploymentState(deployment.status), {
              kind,
              observedAt: new Date().toISOString(),
              providerCorrelationId,
            });
            return {
              status: storableDeploymentStatus(transition.to),
              terminalProtected: transition.terminalProtected,
              changed: transition.changed,
            };
          };

          if (provider?.type === 'coolify') {
            const secrets = [provider.secret_key, provider.access_key, resolvedToken];
            const quality = classifySecret(provider.secret_key ?? provider.access_key ?? undefined);
            if (quality !== 'ok') {
              mark(rule.operation, 'denied', 'coolify');
              return finalize(
                {
                  status: transitionStatus('provider_failed').status,
                  error_message: 'COOLIFY_CREDENTIALS_INVALID',
                  completed_at: new Date().toISOString().slice(0, 19),
                },
                {
                  statusCode: 503,
                  body: {
                    success: false,
                    code: 'CLOUD_TOKEN_MISSING',
                    error: 'Provider credentials are missing or invalid',
                  },
                }
              );
            }
            try {
              const coolifyEndpoint = trimTrailingSlashes(
                provider.endpoint ?? effectiveTarget?.api_url ?? 'https://coolify.moonwitness.local'
              );
              assertProbeTarget(coolifyEndpoint, requestPolicy);
              const coolifyResult = await deployViaCoolify({
                endpoint: coolifyEndpoint,
                token: (provider.secret_key ?? provider.access_key)!,
                appUuid: cloudApp.coolify_uuid ?? cloudApp.name,
                fetchImpl,
              });
              mark(rule.operation, 'success', 'coolify');
              const completedAt = new Date().toISOString().slice(0, 19);
              const succeeded = transitionStatus(
                'provider_succeeded',
                coolifyResult.deploymentUuid
              );
              const updated = await CloudDeployment.query().patchAndFetchById(deployment.id, {
                status: succeeded.status,
                container_id: coolifyResult.deploymentUuid ?? null,
                log: redactSecrets(coolifyResult.message, secrets),
                completed_at: completedAt,
              });
              return {
                statusCode: 201,
                body: {
                  success: true,
                  data: {
                    deploymentId: updated.id,
                    status: updated.status,
                    containerId: updated.container_id,
                    provider: 'coolify',
                    ...(idempotencyKey ? { idempotencyKey, replayed: false } : {}),
                  },
                },
              };
            } catch (error) {
              const ambiguous = isTimeout(error);
              mark(rule.operation, ambiguous ? 'timeout' : 'failed', 'coolify');
              const completedAt = new Date().toISOString().slice(0, 19);
              const safeLog = safeErrorText(error, secrets, 'Provider deployment failed');
              if (ambiguous) {
                const timedOut = transitionStatus('provider_timeout');
                const retryPlan = planDeploymentRetry({
                  deploymentId: deployment.id,
                  state: toDeploymentState(timedOut.status),
                  attempts: 0,
                });
                return await finalize(
                  {
                    status: timedOut.status,
                    error_message: AMBIGUOUS_TIMEOUT_MARKER,
                    log: safeLog,
                    completed_at: completedAt,
                  },
                  {
                    statusCode: 202,
                    body: {
                      success: true,
                      ambiguous: true,
                      code: AMBIGUOUS_TIMEOUT_MARKER,
                      error:
                        'Provider outcome is unknown; retry with the same idempotency key to reconcile',
                      retryIdempotencyKey: retryPlan.idempotencyKey,
                      data: { deploymentId: deployment.id, status: timedOut.status },
                    },
                  }
                );
              }
              return await finalize(
                {
                  status: transitionStatus('provider_failed').status,
                  error_message: safeLog,
                  completed_at: completedAt,
                },
                {
                  statusCode: 502,
                  body: { success: false, error: 'Deployment provider request failed' },
                }
              );
            }
          }

          const agentUrl = trimTrailingSlashes(
            options.controlPlaneUrl ?? effectiveTarget?.api_url ?? defaultAgentUrl
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
              mark(rule.operation, 'failed', 'docker_agent');
              return finalize(
                {
                  status: transitionStatus('provider_failed').status,
                  completed_at: new Date().toISOString().slice(0, 19),
                  error_message: `Control plane deploy failed (${res.status})`,
                },
                {
                  statusCode: 502,
                  body: { success: false, error: `Control plane deploy failed (${res.status})` },
                }
              );
            }

            const result = (await res.json()) as { id?: string };
            mark(rule.operation, 'success', 'docker_agent');
            const completedAt = new Date().toISOString().slice(0, 19);
            const succeeded = transitionStatus('provider_succeeded', result.id);
            const updated = await CloudDeployment.query().patchAndFetchById(deployment.id, {
              status: succeeded.status,
              container_id: result.id ?? null,
              log: `Deployed ${imageRef} via Docker Agent`,
              completed_at: completedAt,
            });
            return {
              statusCode: 201,
              body: {
                success: true,
                data: {
                  deploymentId: updated.id,
                  status: updated.status,
                  containerId: updated.container_id,
                  ...(idempotencyKey ? { idempotencyKey, replayed: false } : {}),
                },
              },
            };
          } catch (error) {
            const ambiguous = isTimeout(error);
            mark(rule.operation, ambiguous ? 'timeout' : 'failed', 'docker_agent');
            const completedAt = new Date().toISOString().slice(0, 19);
            const safeLog = safeErrorText(error, [resolvedToken], 'Control plane is unreachable');
            if (ambiguous) {
              const timedOut = transitionStatus('provider_timeout');
              const retryPlan = planDeploymentRetry({
                deploymentId: deployment.id,
                state: toDeploymentState(timedOut.status),
                attempts: 0,
              });
              return await finalize(
                {
                  status: timedOut.status,
                  error_message: AMBIGUOUS_TIMEOUT_MARKER,
                  log: safeLog,
                  completed_at: completedAt,
                },
                {
                  statusCode: 202,
                  body: {
                    success: true,
                    ambiguous: true,
                    code: AMBIGUOUS_TIMEOUT_MARKER,
                    error:
                      'Provider outcome is unknown; retry with the same idempotency key to reconcile',
                    retryIdempotencyKey: retryPlan.idempotencyKey,
                    data: { deploymentId: deployment.id, status: timedOut.status },
                  },
                }
              );
            }
            return await finalize(
              {
                status: transitionStatus('provider_failed').status,
                error_message: safeLog,
                completed_at: completedAt,
              },
              { statusCode: 502, body: { success: false, error: 'Control plane is unreachable' } }
            );
          }
          return {
            statusCode: 502,
            body: { success: false, error: 'Control plane is unreachable' },
          };
        };

        let outcome: DeployOutcome;
        if (storeKey && fingerprint) {
          outcome = await withCloudKeyedLock(storeKey, async () => {
            const existing = await findIdempotentDeployment(ctx.companyId, cloudApp.id, storeKey);
            if (existing) {
              const existingFingerprint = existing.version?.split(':')[2];
              if (existingFingerprint !== fingerprint) {
                mark(rule.operation, 'conflict');
                return {
                  statusCode: 409,
                  body: {
                    success: false,
                    code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                    error: 'Idempotency key was already used with a different payload',
                  },
                };
              }
              const ambiguous = existing.error_message === AMBIGUOUS_TIMEOUT_MARKER;
              const reconciliation = reconcileDeploymentOutcome(
                {
                  state: toDeploymentState(existing.status),
                  providerCorrelationId: existing.container_id ?? undefined,
                  attempts: 1,
                },
                ambiguous ? 'ambiguous' : 'running'
              );
              mark(rule.operation, 'success');
              return {
                statusCode: ambiguous ? 202 : 200,
                body: {
                  success: true,
                  replayed: true,
                  reconciliationRequired:
                    ambiguous &&
                    (reconciliation.state === 'unknown' || reconciliation.needsOperatorReview),
                  ...(ambiguous ? { code: AMBIGUOUS_TIMEOUT_MARKER } : {}),
                  data: {
                    deploymentId: existing.id,
                    status: existing.status,
                    containerId: existing.container_id ?? null,
                    ...(idempotencyKey ? { idempotencyKey } : {}),
                  },
                },
              };
            }
            return performDeploy();
          });
        } else {
          outcome = await performDeploy();
        }

        if (pendingReservationId && quotaLedger) {
          try {
            await quotaLedger.settle(
              pendingReservationId,
              outcome.statusCode === 201 ? 'success' : 'failure'
            );
          } catch {
            mark(rule.operation, 'denied');
            outcome = {
              statusCode: 503,
              body: {
                success: false,
                code: 'CLOUD_QUOTA_SETTLEMENT_FAILED',
                error: 'Provisioning quota could not be settled',
              },
            };
          }
        }
        return reply.code(outcome.statusCode).send(outcome.body);
      }
    );

    fastify.delete<{ Params: { id: string } }>(
      '/api/cloud/apps/:id',
      WRITE_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/apps/:id');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;
        const appId = parsePositiveId(req.params.id);
        if (!appId) {
          mark(rule.operation, 'invalid');
          return reply.code(400).send({ success: false, error: 'Invalid cloud app ID' });
        }
        const cloudApp = await scopedApp(appId, ctx.companyId);
        if (!cloudApp) {
          mark(rule.operation, 'denied');
          return reply.code(404).send({ success: false, error: 'Cloud app not found' });
        }
        const now = new Date().toISOString().slice(0, 19);
        await CloudApp.query().findById(cloudApp.id).patch({ active: false, is_active: false });
        await CloudDeployment.query().insert({
          company_id: ctx.companyId,
          app_id: cloudApp.id,
          image_tag: cloudApp.image_tag ?? 'latest',
          status: 'stopped',
          trigger: 'agent',
          started_at: now,
          completed_at: now,
          log: 'Cloud app deactivated by company administrator',
        });
        mark(rule.operation, 'success');
        return { success: true, data: { id: cloudApp.id, status: 'stopped' } };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      '/api/cloud/subscriptions/:id/enforce',
      WRITE_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/subscriptions/:id/enforce');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;
        const subscriptionId = parsePositiveId(req.params.id);
        if (!subscriptionId) {
          mark(rule.operation, 'invalid');
          return reply.code(400).send({ success: false, error: 'Invalid subscription ID' });
        }

        const subscription = await Subscription.query().findOne({
          id: subscriptionId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!subscription) {
          mark(rule.operation, 'denied');
          return reply.code(404).send({ success: false, error: 'Subscription not found' });
        }

        if (subscription.state === 'active') {
          mark(rule.operation, 'success');
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
          await CloudApp.query()
            .where({ id: app.id, company_id: ctx.companyId })
            .patch({ is_active: false });
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

        mark(rule.operation, 'success');
        return {
          success: true,
          data: { suspendedApps: apps.length, state: subscription.state },
        };
      }
    );

    const scopedLiveLogContext = async (
      deployment: { app_id: number; container_id?: string | null },
      companyId: number
    ): Promise<{ provider?: Awaited<ReturnType<typeof scopedProvider>> } | null> => {
      const cloudAppRecord = await scopedApp(deployment.app_id, companyId);
      if (!cloudAppRecord) return null;
      const target = await scopedTarget(cloudAppRecord.deployment_target_id, companyId);
      if (!target) return null;
      const server = await scopedServer(target.server_id, companyId);
      return { provider: await scopedProvider(server?.provider_id, companyId) };
    };

    fastify.get<{ Params: { id: string } }>(
      '/api/cloud/deployments/:id/logs',
      READ_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/deployments/:id/logs');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;
        const deploymentId = parsePositiveId(req.params.id);
        if (!deploymentId) {
          mark(rule.operation, 'invalid');
          return reply.code(400).send({ success: false, error: 'Invalid deployment ID' });
        }

        const deployment = await scopedDeployment(deploymentId, ctx.companyId);
        if (!deployment) {
          mark(rule.operation, 'denied');
          return reply.code(404).send({ success: false, error: 'Deployment not found' });
        }

        let liveLog: string | null = null;
        let live = false;
        if (deployment.container_id) {
          try {
            const liveContext = await scopedLiveLogContext(deployment, ctx.companyId);
            if (liveContext && liveContext.provider?.type !== 'coolify') {
              const res = await controlPlaneFetch(
                `${defaultAgentUrl}/api/containers/${encodeURIComponent(deployment.container_id)}/logs?tail=200`,
                { signal: AbortSignal.timeout(5_000) }
              );
              if (res.ok) {
                const body = await readBoundedResponseBody(res);
                if (body.ok) {
                  const parsed = JSON.parse(body.text) as { logs?: unknown };
                  if (typeof parsed?.logs === 'string') {
                    liveLog = redactSecrets(parsed.logs, [resolvedToken]);
                    live = true;
                  }
                }
              }
            }
          } catch {
            // fall back to stored deployment.log below
          }
        }

        mark(rule.operation, 'success');
        return {
          success: true,
          data: {
            id: deployment.id,
            appId: deployment.app_id,
            status: deployment.status,
            containerId: deployment.container_id ?? null,
            startedAt: deployment.started_at ?? null,
            completedAt: deployment.completed_at ?? null,
            log: liveLog ?? redactSecrets(deployment.log, [resolvedToken]) ?? '',
            errorMessage: deployment.error_message
              ? redactSecrets(deployment.error_message, [resolvedToken])
              : null,
            live,
          },
        };
      }
    );

    fastify.get<{ Params: { id: string } }>(
      '/api/cloud/deployments/:id/logs/stream',
      READ_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/deployments/:id/logs/stream');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;
        const deploymentId = parsePositiveId(req.params.id);
        if (!deploymentId) {
          mark(rule.operation, 'invalid');
          return reply.code(400).send({ success: false, error: 'Invalid deployment ID' });
        }

        const deployment = await scopedDeployment(deploymentId, ctx.companyId);
        if (!deployment) {
          mark(rule.operation, 'denied');
          return reply.code(404).send({ success: false, error: 'Deployment not found' });
        }

        const payload = JSON.stringify({
          id: deployment.id,
          status: deployment.status,
          containerId: deployment.container_id ?? null,
          log: redactSecrets(deployment.log, [resolvedToken]),
          errorMessage: deployment.error_message
            ? redactSecrets(deployment.error_message, [resolvedToken])
            : null,
        });

        let upstream: Response | null = null;
        if (deployment.container_id) {
          try {
            const liveContext = await scopedLiveLogContext(deployment, ctx.companyId);
            if (liveContext && liveContext.provider?.type !== 'coolify') {
              const controller = new AbortController();
              req.raw.once('close', () => controller.abort());
              const res = await controlPlaneFetch(
                `${defaultAgentUrl}/api/containers/${encodeURIComponent(deployment.container_id)}/logs?follow=true&tail=100`,
                { headers: controlPlaneAuthHeaders(resolvedToken), signal: controller.signal }
              );
              if (res.ok && res.body) upstream = res;
            }
          } catch {
            upstream = null;
          }
        }

        mark(rule.operation, 'success');
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
            if (value)
              raw.write(redactSecrets(decoder.decode(value, { stream: true }), [resolvedToken]));
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

    fastify.post('/api/cloud/targets/probe', WRITE_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/targets/probe');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;
      const result = await probeCloudTargetsHealth({
        companyId: ctx.companyId,
        adminToken: resolvedToken,
        fetchImpl,
        policy: requestPolicy,
      });
      return { success: true, data: result };
    });

    fastify.get('/api/cloud/export/terraform', READ_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/export/terraform');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;
      const providers = await CloudProvider.query().where({
        company_id: ctx.companyId,
        active: true,
      });
      const secrets = providers.flatMap((provider) => [provider.secret_key, provider.access_key]);
      const hcl = redactSecrets(await exportCloudTerraformHcl(ctx.companyId), [
        ...secrets,
        resolvedToken,
      ]);
      mark(rule.operation, 'success');
      return reply.type('text/plain; charset=utf-8').send(hcl);
    });

    const PAAS_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;

    fastify.get('/api/cloud/paas/metrics', READ_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/metrics');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;
      try {
        assertProbeTarget(defaultAgentUrl, requestPolicy);
        const metrics = await fetchMeshNodeMetrics({
          endpoint: defaultAgentUrl,
          token: resolvedToken,
          fetchImpl,
          timeoutMs: 10_000,
        });
        mark(rule.operation, 'success', 'mesh');
        return { success: true, data: metrics };
      } catch (error) {
        mark(rule.operation, 'offline', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeErrorText(error, [resolvedToken], 'Control plane metrics unreachable'),
        });
      }
    });

    fastify.get('/api/cloud/paas/apps', READ_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/apps');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;
      try {
        assertProbeTarget(defaultAgentUrl, requestPolicy);
        const apps = await listMeshPaasApps({
          endpoint: defaultAgentUrl,
          token: resolvedToken,
          fetchImpl,
          timeoutMs: 10_000,
        });
        mark(rule.operation, 'success', 'mesh');
        return { success: true, data: apps };
      } catch (error) {
        mark(rule.operation, 'offline', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeErrorText(error, [resolvedToken], 'Control plane apps list unreachable'),
        });
      }
    });

    fastify.get('/api/cloud/paas/templates', READ_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/templates');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;
      try {
        const query = req.query as {
          q?: string;
          category?: string;
          tag?: string;
          compatibility?: string;
          includeOutdated?: boolean;
          page?: number;
          limit?: number;
        };
        const data = listCoolifyTemplates({
          q: query.q,
          category: query.category,
          tag: query.tag,
          compatibility: (query.compatibility as CoolifyCompatibility) ?? undefined,
          includeOutdated: query.includeOutdated,
          page: query.page,
          limit: query.limit,
        });
        mark(rule.operation, 'success', 'mesh');
        return { success: true, data };
      } catch (error) {
        mark(rule.operation, 'offline', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeErrorText(error, [resolvedToken], 'Coolify template catalog unreachable'),
        });
      }
    });

    fastify.get<{ Params: { id: string } }>(
      '/api/cloud/paas/templates/:id',
      READ_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/paas/templates/:id');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;

        const { id } = req.params;
        const detail = getCoolifyTemplateDetail(id);
        if (!detail) {
          return reply.code(404).send({ success: false, error: `Template ${id} not found` });
        }
        mark(rule.operation, 'success');
        return { success: true, data: detail };
      }
    );

    fastify.post<{
      Body: {
        slug?: string;
        tenantId?: string;
        env?: Record<string, string>;
        domain?: string;
        port?: number;
      };
    }>('/api/cloud/paas/templates/deploy', WRITE_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/templates/deploy');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      const { slug, tenantId, env, domain, port } = req.body ?? {};
      if (!slug) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'slug is required' });
      }

      const detail = getCoolifyTemplateDetail(slug);
      if (!detail) {
        return reply.code(404).send({ success: false, error: `Template ${slug} not found` });
      }
      if (detail.compatibility === 'restricted') {
        mark(rule.operation, 'invalid');
        return reply
          .code(400)
          .send({ success: false, error: `Template ${slug} is restricted and cannot be deployed` });
      }

      const resolvedDomain = domain;
      let previewPort: number | undefined;
      if (!resolvedDomain) {
        previewPort = (await allocatePreviewPort()) ?? undefined;
      }

      try {
        const compiled = compileCoolifyCompose({
          slug,
          tenantId: tenantId ?? 'default',
          composeYaml: detail.composeYaml,
          defaultPort: Number(port ?? detail.port ?? 8080) || 8080,
          primaryDomain: resolvedDomain,
          ...(previewPort !== undefined ? { previewPort } : {}),
          existingEnv: {},
          userEnv: env,
        });

        // Deploy the COMPILED compose (volume prefixes + top-level volumes + inline files),
        // not the raw upstream template which has undeclared named volumes.
        await upAgentCompose({
          endpoint: defaultAgentUrl,
          slug,
          composeSpec: compiled.composeYaml,
          env: { ...compiled.env, ...(env ?? {}) },
          ...(Object.keys(compiled.files).length ? { files: compiled.files } : {}),
          fetchImpl,
        });

        // Persist PaaS metadata in PostgreSQL (single source of truth).
        let target = await CloudDeploymentTarget.query()
          .where({ company_id: ctx.companyId, is_active: true })
          .first();
        if (!target)
          target = await CloudDeploymentTarget.query().findOne({ company_id: ctx.companyId });
        if (!target) target = await CloudDeploymentTarget.query().first();
        if (!target) {
          target = await CloudDeploymentTarget.query().insertAndFetch({
            company_id: ctx.companyId,
            name: 'default-paas-target',
            environment: 'production',
            api_url: defaultAgentUrl,
            is_active: true,
          });
        }

        const appFields = {
          company_id: ctx.companyId,
          deployment_target_id: target.id,
          image: `mw-paas-${slug}:latest`,
          port: Number(port ?? detail.port ?? 8080) || 8080,
          domain: resolvedDomain ?? null,
          host_port: previewPort ?? null,
          env_vars: { ...compiled.env, ...(env ?? {}) },
          compose_spec: compiled.composeYaml,
          template_id: slug,
          managed_by: 'paas' as const,
          deploy_mode: 'compose' as const,
          is_active: true,
          active: true,
        } as Record<string, unknown>;
        let cloudApp = await CloudApp.query().findOne({ name: slug });
        if (cloudApp) {
          await CloudApp.query().findById(cloudApp.id).patch(appFields);
        } else {
          cloudApp = await CloudApp.query().insertAndFetch({ name: slug, ...appFields });
        }
        await CloudDeployment.query().insert({
          company_id: ctx.companyId,
          app_id: cloudApp!.id,
          version: `mw-paas-${slug}:latest`,
          image_tag: 'latest',
          status: 'running',
          container_id: slug,
          trigger: 'agent',
          log: `Deployed Coolify template ${slug} via stateless agent`,
          started_at: new Date().toISOString(),
        });

        await reconcileCaddyWithAgent({ token: resolvedToken });

        mark(rule.operation, 'success');
        return reply.code(201).send({
          success: true,
          data: { slug, image: `mw-paas-${slug}:latest`, domain: resolvedDomain, previewPort },
        });
      } catch (error) {
        mark(rule.operation, 'failed', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeErrorText(error, [resolvedToken], 'Template deploy failed'),
        });
      }
    });

    fastify.post('/api/cloud/paas/apps/deploy', WRITE_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/apps/deploy');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
        slug?: unknown;
        image?: unknown;
        domain?: unknown;
        port?: unknown;
        tenant?: unknown;
        env?: unknown;
      };
      const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
      const image = typeof body.image === 'string' ? body.image.trim() : '';
      if (!PAAS_SLUG_PATTERN.test(slug) || !image) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'Valid slug and image are required' });
      }
      const env =
        body.env && typeof body.env === 'object' && !Array.isArray(body.env)
          ? Object.fromEntries(
              Object.entries(body.env as Record<string, unknown>).map(([k, v]) => [k, String(v)])
            )
          : undefined;

      const resolvedDomain =
        typeof body.domain === 'string' && body.domain.trim() ? body.domain.trim() : undefined;
      let previewPort: number | undefined;
      if (!resolvedDomain) {
        previewPort = (await allocatePreviewPort()) ?? undefined;
      }
      const targetPort =
        typeof body.port === 'number' && Number.isInteger(body.port) ? body.port : 3000;

      try {
        assertProbeTarget(defaultAgentUrl, requestPolicy);
        const result = await runAgentContainer({
          endpoint: defaultAgentUrl,
          token: resolvedToken,
          slug,
          tenantId:
            typeof body.tenant === 'string' && body.tenant.trim()
              ? body.tenant.trim()
              : `company-${ctx.companyId}`,
          image,
          port: targetPort,
          domain: resolvedDomain,
          env,
          fetchImpl,
          timeoutMs: 60_000,
        });

        // Find or create deployment target for the company
        let target = await CloudDeploymentTarget.query()
          .where({ company_id: ctx.companyId, is_active: true })
          .first();
        if (!target) {
          target = await CloudDeploymentTarget.query().where({ company_id: ctx.companyId }).first();
        }
        if (!target) {
          target = await CloudDeploymentTarget.query().first();
        }
        if (!target) {
          target = await CloudDeploymentTarget.query().insertAndFetch({
            company_id: ctx.companyId,
            name: 'default-paas-target',
            environment: 'production',
            api_url: defaultAgentUrl,
            is_active: true,
          });
        }

        let cloudApp = await CloudApp.query().findOne({ name: slug });
        if (cloudApp) {
          cloudApp = await CloudApp.query().patchAndFetchById(cloudApp.id, {
            company_id: ctx.companyId,
            deployment_target_id: target.id,
            image: result.slug,
            port: targetPort,
            domain: resolvedDomain,
            host_port: previewPort ?? null,
            env_vars: env ?? {},
            compose_spec: '',
            git_repo: null,
            managed_by: 'paas',
            deploy_mode: 'image',
            is_active: true,
            active: true,
          });
        } else {
          cloudApp = await CloudApp.query().insertAndFetch({
            company_id: ctx.companyId,
            deployment_target_id: target.id,
            name: slug,
            image: result.slug,
            port: targetPort,
            domain: resolvedDomain,
            host_port: previewPort ?? null,
            env_vars: env ?? {},
            compose_spec: '',
            git_repo: null,
            managed_by: 'paas',
            deploy_mode: 'image',
            is_active: true,
            active: true,
          });
        }

        await CloudDeployment.query().insert({
          company_id: ctx.companyId,
          app_id: cloudApp.id,
          version: result.slug,
          image_tag: 'latest',
          status: 'running',
          container_id: result.containerId,
          trigger: 'agent',
          log: `Container ${result.containerName} started with status ${result.status}`,
          started_at: new Date().toISOString(),
        });

        await reconcileCaddyWithAgent({ token: resolvedToken });

        mark(rule.operation, 'success');
        return reply.code(201).send({
          success: true,
          data: { slug, image: result.slug, domain: resolvedDomain, previewPort },
        });
      } catch (error) {
        mark(rule.operation, 'failed', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeErrorText(
            error,
            [resolvedToken, ...Object.values(env ?? {})],
            'Control plane deploy failed'
          ),
        });
      }
    });

    fastify.post<{
      Body: {
        slug?: string;
        tenantId?: string;
        composeSpec?: string;
        env?: Record<string, string>;
        domain?: string;
        port?: number;
      };
    }>('/api/cloud/paas/apps/deploy-compose', WRITE_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/apps/deploy-compose');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      const { slug, tenantId, composeSpec, env, domain, port } = req.body ?? {};
      if (!slug || !composeSpec) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'slug and composeSpec are required' });
      }
      if (!PAAS_SLUG_PATTERN.test(slug)) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'Invalid slug format' });
      }

      const resolvedDomain =
        typeof domain === 'string' && domain.trim() ? domain.trim() : undefined;
      let previewPort: number | undefined;
      if (!resolvedDomain) {
        previewPort = (await allocatePreviewPort()) ?? undefined;
      }
      const targetPort = typeof port === 'number' && Number.isInteger(port) ? port : 3000;

      try {
        assertProbeTarget(defaultAgentUrl, requestPolicy);
        await compileCoolifyCompose({
          slug,
          tenantId: tenantId ?? 'default',
          composeYaml: composeSpec,
          defaultPort: targetPort,
          primaryDomain: resolvedDomain,
          ...(previewPort !== undefined ? { previewPort } : {}),
          existingEnv: {},
          userEnv: env,
        });

        await upAgentCompose({ endpoint: defaultAgentUrl, slug, composeSpec, env });

        // Find or create deployment target for the company
        let target = await CloudDeploymentTarget.query()
          .where({ company_id: ctx.companyId, is_active: true })
          .first();
        if (!target) {
          target = await CloudDeploymentTarget.query().where({ company_id: ctx.companyId }).first();
        }
        if (!target) {
          target = await CloudDeploymentTarget.query().first();
        }
        if (!target) {
          target = await CloudDeploymentTarget.query().insertAndFetch({
            company_id: ctx.companyId,
            name: 'default-paas-target',
            environment: 'production',
            api_url: defaultAgentUrl,
            is_active: true,
          });
        }

        let cloudApp = await CloudApp.query().findOne({ name: slug });
        if (cloudApp) {
          cloudApp = await CloudApp.query().patchAndFetchById(cloudApp.id, {
            company_id: ctx.companyId,
            deployment_target_id: target.id,
            image: `mw-paas-${slug}:latest`,
            port: targetPort,
            domain: resolvedDomain,
            host_port: previewPort ?? null,
            env_vars: env ?? {},
            compose_spec: composeSpec,
            git_repo: null,
            managed_by: 'paas',
            deploy_mode: 'compose',
            is_active: true,
            active: true,
          });
        } else {
          cloudApp = await CloudApp.query().insertAndFetch({
            company_id: ctx.companyId,
            deployment_target_id: target.id,
            name: slug,
            image: `mw-paas-${slug}:latest`,
            port: targetPort,
            domain: resolvedDomain,
            host_port: previewPort ?? null,
            env_vars: env ?? {},
            compose_spec: composeSpec,
            git_repo: null,
            managed_by: 'paas',
            deploy_mode: 'compose',
            is_active: true,
            active: true,
          });
        }

        await CloudDeployment.query().insert({
          company_id: ctx.companyId,
          app_id: cloudApp.id,
          version: `mw-paas-${slug}:latest`,
          image_tag: 'latest',
          status: 'running',
          container_id: slug,
          trigger: 'agent',
          log: 'Deployed via compose',
          started_at: new Date().toISOString(),
        });

        await reconcileCaddyWithAgent({ token: resolvedToken });

        mark(rule.operation, 'success');
        return reply.code(201).send({
          success: true,
          data: { slug, image: `mw-paas-${slug}:latest`, domain: resolvedDomain, previewPort },
        });
      } catch (error) {
        mark(rule.operation, 'failed', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeErrorText(
            error,
            [resolvedToken, ...Object.values(env ?? {})],
            'Compose deploy failed'
          ),
        });
      }
    });

    fastify.post<{
      Body: {
        slug?: string;
        tenantId?: string;
        gitRepo?: string;
        branch?: string;
        dockerfilePath?: string;
        domain?: string;
        port?: number;
        env?: Record<string, string>;
      };
    }>('/api/cloud/paas/apps/deploy-git', WRITE_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/apps/deploy-git');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      const { slug, tenantId, gitRepo, branch, dockerfilePath, domain, port, env } = req.body ?? {};
      if (!slug || !gitRepo) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'slug and gitRepo are required' });
      }
      if (!PAAS_SLUG_PATTERN.test(slug)) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'Invalid slug format' });
      }
      if (!/^https:\/\/[^\s]+$/iu.test(gitRepo)) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'gitRepo must be a valid HTTPS URL' });
      }

      const resolvedDomain =
        typeof domain === 'string' && domain.trim() ? domain.trim() : undefined;
      let previewPort: number | undefined;
      if (!resolvedDomain) {
        previewPort = (await allocatePreviewPort()) ?? undefined;
      }
      const targetPort = typeof port === 'number' && Number.isInteger(port) ? port : 3000;

      try {
        assertProbeTarget(defaultAgentUrl, requestPolicy);

        // Generate webhook secret only on initial creation
        const existingApp = await CloudApp.query().findOne({ name: slug });
        const isNewApp = !existingApp;
        const webhookSecret = existingApp?.webhook_secret ?? randomBytes(24).toString('hex');

        const result = await deployAgentGit({
          endpoint: defaultAgentUrl,
          token: resolvedToken,
          slug,
          tenantId: tenantId ?? `company-${ctx.companyId}`,
          gitRepo,
          ...(branch ? { branch } : {}),
          ...(dockerfilePath ? { dockerfilePath } : {}),
          port: targetPort,
          domain: resolvedDomain,
          env,
          fetchImpl,
          timeoutMs: 120_000,
        });

        // Find or create deployment target for the company
        let target = await CloudDeploymentTarget.query()
          .where({ company_id: ctx.companyId, is_active: true })
          .first();
        if (!target) {
          target = await CloudDeploymentTarget.query().where({ company_id: ctx.companyId }).first();
        }
        if (!target) {
          target = await CloudDeploymentTarget.query().first();
        }
        if (!target) {
          target = await CloudDeploymentTarget.query().insertAndFetch({
            company_id: ctx.companyId,
            name: 'default-paas-target',
            environment: 'production',
            api_url: defaultAgentUrl,
            is_active: true,
          });
        }

        let cloudApp = await CloudApp.query().findOne({ name: slug });
        if (cloudApp) {
          cloudApp = await CloudApp.query().patchAndFetchById(cloudApp.id, {
            company_id: ctx.companyId,
            deployment_target_id: target.id,
            image: result.image,
            port: targetPort,
            domain: resolvedDomain,
            host_port: previewPort ?? null,
            env_vars: env ?? {},
            compose_spec: '',
            git_repo: gitRepo,
            git_branch: branch ?? null,
            dockerfile_path: dockerfilePath ?? null,
            webhook_secret: webhookSecret,
            managed_by: 'paas',
            deploy_mode: 'git',
            is_active: true,
            active: true,
          });
        } else {
          cloudApp = await CloudApp.query().insertAndFetch({
            company_id: ctx.companyId,
            deployment_target_id: target.id,
            name: slug,
            image: result.image,
            port: targetPort,
            domain: resolvedDomain,
            host_port: previewPort ?? null,
            env_vars: env ?? {},
            compose_spec: '',
            git_repo: gitRepo,
            git_branch: branch ?? null,
            dockerfile_path: dockerfilePath ?? null,
            webhook_secret: webhookSecret,
            managed_by: 'paas',
            deploy_mode: 'git',
            is_active: true,
            active: true,
          });
        }

        await CloudDeployment.query().insert({
          company_id: ctx.companyId,
          app_id: cloudApp.id,
          version: result.commitSha || 'latest',
          image_tag: 'latest',
          status: 'running',
          container_id: result.containerId,
          trigger: 'agent',
          log: `Git deploy from ${gitRepo} (${result.branch || branch || 'default'}@${result.commitSha || 'HEAD'})`,
          started_at: new Date().toISOString(),
        });

        await reconcileCaddyWithAgent({ token: resolvedToken });

        mark(rule.operation, 'success');
        // Return webhookUrl & webhookSecret ONLY on initial creation
        const baseData: Record<string, unknown> = {
          slug,
          image: result.image,
          domain: resolvedDomain,
          previewPort,
          commitSha: result.commitSha,
        };
        if (isNewApp) {
          baseData.webhookUrl = `/api/cloud/paas/webhooks/github/${slug}`;
          baseData.webhookSecret = webhookSecret;
        }
        return reply.code(201).send({ success: true, data: baseData });
      } catch (error) {
        mark(rule.operation, 'failed', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeErrorText(
            error,
            [resolvedToken, ...Object.values(env ?? {})],
            'Git deploy failed'
          ),
        });
      }
    });

    fastify.post<{
      Params: { slug: string };
      Headers: { 'x-hub-signature-256'?: string };
      Body: unknown;
    }>('/api/cloud/paas/webhooks/github/:slug', WRITE_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/webhooks/github/:slug');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;

      const slug = req.params.slug.trim();
      if (!PAAS_SLUG_PATTERN.test(slug)) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'Invalid slug format' });
      }

      const cloudApp = await CloudApp.query().findOne({ name: slug });
      if (!cloudApp || !cloudApp.webhook_secret || !cloudApp.git_repo) {
        mark(rule.operation, 'invalid');
        return reply.code(404).send({
          success: false,
          error: `App ${slug} not found or not configured for git deploys`,
        });
      }

      // Constant-time HMAC-SHA256 verification against stored webhook_secret
      const signatureHeader = req.headers['x-hub-signature-256'];
      if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
        mark(rule.operation, 'denied');
        return reply.code(401).send({ success: false, error: 'Missing or invalid signature' });
      }
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
      const expected = createHmac('sha256', cloudApp.webhook_secret).update(rawBody).digest('hex');
      const received = signatureHeader.slice('sha256='.length);
      const expectedBuf = Buffer.from(expected, 'utf8');
      const receivedBuf = Buffer.from(received, 'utf8');
      if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
        mark(rule.operation, 'denied');
        return reply.code(401).send({ success: false, error: 'Invalid signature' });
      }

      try {
        assertProbeTarget(defaultAgentUrl, requestPolicy);
        const result = await deployAgentGit({
          endpoint: defaultAgentUrl,
          token: resolvedToken,
          slug,
          tenantId: `company-${cloudApp.company_id}`,
          gitRepo: cloudApp.git_repo,
          ...(cloudApp.git_branch ? { branch: cloudApp.git_branch } : {}),
          ...(cloudApp.dockerfile_path ? { dockerfilePath: cloudApp.dockerfile_path } : {}),
          port: cloudApp.port ?? 3000,
          domain: cloudApp.domain ?? undefined,
          fetchImpl,
          timeoutMs: 120_000,
        });

        await CloudDeployment.query().insert({
          company_id: cloudApp.company_id,
          app_id: cloudApp.id,
          version: result.commitSha || 'latest',
          image_tag: 'latest',
          status: 'running',
          container_id: result.containerId,
          trigger: 'webhook',
          log: `Webhook-triggered git deploy from ${cloudApp.git_repo} (${result.commitSha || 'HEAD'})`,
          started_at: new Date().toISOString(),
        });

        mark(rule.operation, 'success');
        return { success: true, data: { slug, commitSha: result.commitSha, status: 'deployed' } };
      } catch (error) {
        mark(rule.operation, 'failed', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeErrorText(
            error,
            [resolvedToken, cloudApp.webhook_secret],
            'Webhook git deploy failed'
          ),
        });
      }
    });

    fastify.post<{ Params: { slug: string; action: string } }>(
      '/api/cloud/paas/apps/:slug/:action',
      WRITE_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/paas/apps/:slug/:action');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;

        const slug = req.params.slug.trim();
        const action = req.params.action.trim();
        if (
          !PAAS_SLUG_PATTERN.test(slug) ||
          !['start', 'restart', 'stop', 'redeploy', 'delete'].includes(action)
        ) {
          mark(rule.operation, 'invalid', 'mesh');
          return reply.code(400).send({ success: false, error: 'Invalid PaaS app slug or action' });
        }

        // Scope check: app must exist in PostgreSQL for this company
        const cloudApp = await CloudApp.query().findOne({
          name: slug,
          company_id: ctx.companyId,
          managed_by: 'paas',
          is_active: true,
        });
        if (!cloudApp) {
          mark(rule.operation, 'invalid', 'mesh');
          return reply.code(404).send({ success: false, error: `App ${slug} not found` });
        }

        try {
          assertProbeTarget(defaultAgentUrl, requestPolicy);

          // Delete: remove container, deactivate Postgres state, reconcile Caddy
          if (action === 'delete') {
            try {
              await controlAgentContainer({
                endpoint: defaultAgentUrl,
                token: resolvedToken,
                slug,
                action: 'delete',
                fetchImpl,
                timeoutMs: 60_000,
              });
            } catch {
              // Container may already be gone; continue cleaning Postgres state.
            }
            await CloudApp.query().findById(cloudApp.id).patch({
              is_active: false,
              active: false,
              domain: null,
              host_port: null,
            });
            await CloudDeployment.query().insert({
              company_id: ctx.companyId,
              app_id: cloudApp.id,
              version: cloudApp.image_tag ?? 'latest',
              image_tag: cloudApp.image_tag ?? 'latest',
              status: 'stopped',
              container_id: slug,
              trigger: 'agent',
              log: `App ${slug} deleted; container removed and Caddy route detached`,
              started_at: new Date().toISOString(),
            });
            await reconcileCaddyWithAgent({ token: resolvedToken });
            mark(rule.operation, 'success', 'mesh');
            return { success: true, data: { slug, action: 'delete', status: 'deleted' } };
          }

          // Redeploy: re-run stored spec based on deploy_mode
          if (action === 'redeploy') {
            if (cloudApp.deploy_mode === 'compose' && cloudApp.compose_spec) {
              await upAgentCompose({
                endpoint: defaultAgentUrl,
                slug,
                composeSpec: cloudApp.compose_spec,
                env:
                  cloudApp.env_vars && typeof cloudApp.env_vars === 'object'
                    ? (cloudApp.env_vars as Record<string, string>)
                    : undefined,
              });
            } else if (cloudApp.deploy_mode === 'git' && cloudApp.git_repo) {
              await deployAgentGit({
                endpoint: defaultAgentUrl,
                token: resolvedToken,
                slug,
                gitRepo: cloudApp.git_repo,
                ...(cloudApp.git_branch ? { branch: cloudApp.git_branch } : {}),
                ...(cloudApp.dockerfile_path ? { dockerfilePath: cloudApp.dockerfile_path } : {}),
                port: cloudApp.port ?? 3000,
                domain: cloudApp.domain ?? undefined,
                fetchImpl,
                timeoutMs: 120_000,
              });
            } else {
              await runAgentContainer({
                endpoint: defaultAgentUrl,
                token: resolvedToken,
                slug,
                image: cloudApp.image,
                port: cloudApp.port ?? 3000,
                domain: cloudApp.domain ?? undefined,
                env:
                  cloudApp.env_vars && typeof cloudApp.env_vars === 'object'
                    ? (cloudApp.env_vars as Record<string, string>)
                    : undefined,
                fetchImpl,
                timeoutMs: 60_000,
              });
            }
            await CloudDeployment.query().insert({
              company_id: ctx.companyId,
              app_id: cloudApp.id,
              version: cloudApp.image_tag ?? 'latest',
              image_tag: cloudApp.image_tag ?? 'latest',
              status: 'running',
              container_id: slug,
              trigger: 'agent',
              log: `App ${slug} redeployed from stored ${cloudApp.deploy_mode} spec`,
              started_at: new Date().toISOString(),
            });
            mark(rule.operation, 'success', 'mesh');
            return { success: true, data: { slug, action: 'redeploy', status: 'running' } };
          }

          // start / restart / stop: forward to stateless agent
          const result = await controlAgentContainer({
            endpoint: defaultAgentUrl,
            token: resolvedToken,
            slug,
            action: action as 'start' | 'stop' | 'restart',
            fetchImpl,
            timeoutMs: 60_000,
          });
          mark(rule.operation, 'success', 'mesh');
          return { success: true, data: result };
        } catch (error) {
          mark(rule.operation, 'failed', 'mesh');
          return reply.code(502).send({
            success: false,
            error: safeErrorText(error, [resolvedToken], `PaaS ${action} failed`),
          });
        }
      }
    );

    fastify.get<{ Params: { slug: string } }>(
      '/api/cloud/paas/apps/:slug/stats',
      READ_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/paas/apps/:slug/stats');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;

        const slug = req.params.slug.trim();
        if (!PAAS_SLUG_PATTERN.test(slug)) {
          mark(rule.operation, 'invalid', 'mesh');
          return reply.code(400).send({ success: false, error: 'Invalid PaaS app slug' });
        }

        const cloudApp = await CloudApp.query().findOne({
          name: slug,
          company_id: ctx.companyId,
          managed_by: 'paas',
          is_active: true,
        });
        if (!cloudApp) {
          mark(rule.operation, 'invalid', 'mesh');
          return reply.code(404).send({ success: false, error: `App ${slug} not found` });
        }

        try {
          assertProbeTarget(defaultAgentUrl, requestPolicy);
          const stats = await fetchAgentContainerStats({
            endpoint: defaultAgentUrl,
            token: resolvedToken,
            slug,
            fetchImpl,
            timeoutMs: 15_000,
          });
          mark(rule.operation, 'success', 'mesh');
          return { success: true, data: stats };
        } catch (error) {
          mark(rule.operation, 'failed', 'mesh');
          return reply.code(502).send({
            success: false,
            error: safeErrorText(error, [resolvedToken], 'PaaS app stats failed'),
          });
        }
      }
    );

    fastify.get<{ Params: { slug: string } }>(
      '/api/cloud/paas/apps/:slug',
      READ_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/paas/apps/:slug');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;

        const { slug } = req.params;
        try {
          const app = await CloudApp.query()
            .where({
              name: slug,
              company_id: ctx.companyId,
              managed_by: 'paas',
              is_active: true,
              active: true,
            })
            .first();
          if (!app) {
            return reply.code(404).send({ success: false, error: `App ${slug} not found` });
          }

          // Fetch live container state from agent
          let containerState: { state: string; status: string; containerId: string } | null = null;
          try {
            const containers = await listAgentContainers({ endpoint: defaultAgentUrl, fetchImpl });
            const found = containers.find((c) => (c.slug ?? c.name) === slug);
            if (found) {
              containerState = {
                state: found.state,
                status: found.status,
                containerId: found.containerId,
              };
            }
          } catch {
            // Swallow agent errors; proceed with PostgreSQL state only
          }

          // Fetch latest 20 deployments
          const deployments = await CloudDeployment.query()
            .where({ app_id: app.id, company_id: ctx.companyId })
            .orderBy('started_at', 'desc')
            .limit(20);

          // Redact secrets: env_vars keys preserved with [REDACTED] values, webhook_secret redacted
          const redactedEnvVars: Record<string, string> = {};
          if (app.env_vars && typeof app.env_vars === 'object') {
            for (const key of Object.keys(app.env_vars)) {
              redactedEnvVars[key] = '[REDACTED]';
            }
          }

          const data = {
            ...app,
            env_vars: redactedEnvVars,
            webhook_secret: app.webhook_secret ? '[REDACTED]' : undefined,
            ingressRoutes: app.ingress_routes ?? [],
            deployMode: app.deploy_mode,
            templateId: app.template_id,
            deployments,
            ...(containerState ? { containerState } : {}),
          };

          mark(rule.operation, 'success');
          return { success: true, data };
        } catch (error) {
          mark(rule.operation, 'failed', 'mesh');
          return reply.code(502).send({
            success: false,
            error: safeErrorText(error, [resolvedToken], 'PaaS app lookup failed'),
          });
        }
      }
    );

    fastify.post<{
      Params: { slug: string };
      Body: { env?: Record<string, string>; merge?: boolean; redeploy?: boolean };
    }>('/api/cloud/paas/apps/:slug/env', WRITE_RATE_LIMIT, async (req, reply) => {
      const rule = ruleFor('/api/cloud/paas/apps/:slug/env');
      const ctx = requireAuthorizedModelAccess(req, reply, rule);
      if (!ctx) return;
      if (!requireFeature(reply, rule)) return;
      if (!requireToken(reply, rule)) return;

      const slug = req.params.slug.trim();
      if (!PAAS_SLUG_PATTERN.test(slug)) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'Invalid PaaS app slug' });
      }
      const body = req.body ?? {};
      const incomingEnv =
        body.env && typeof body.env === 'object' && !Array.isArray(body.env)
          ? Object.fromEntries(
              Object.entries(body.env as Record<string, unknown>).map(([k, v]) => [k, String(v)])
            )
          : null;
      if (!incomingEnv) {
        mark(rule.operation, 'invalid');
        return reply.code(400).send({ success: false, error: 'env must be an object' });
      }

      const cloudApp = await CloudApp.query().findOne({
        name: slug,
        company_id: ctx.companyId,
        managed_by: 'paas',
        is_active: true,
      });
      if (!cloudApp) {
        mark(rule.operation, 'invalid');
        return reply.code(404).send({ success: false, error: `App ${slug} not found` });
      }

      try {
        // Merge env: never overwrite an existing secret with the [REDACTED] placeholder
        const existingEnv: Record<string, string> =
          cloudApp.env_vars &&
          typeof cloudApp.env_vars === 'object' &&
          !Array.isArray(cloudApp.env_vars)
            ? { ...(cloudApp.env_vars as Record<string, string>) }
            : {};
        const merge = body.merge !== false;
        const mergedEnv: Record<string, string> = merge ? { ...existingEnv } : {};
        for (const [key, value] of Object.entries(incomingEnv)) {
          if (value === '[REDACTED]' && existingEnv[key] && existingEnv[key] !== '[REDACTED]') {
            // Preserve the stored secret; the redaction placeholder must never corrupt it
            mergedEnv[key] = existingEnv[key];
          } else {
            mergedEnv[key] = value;
          }
        }

        await CloudApp.query().findById(cloudApp.id).patch({ env_vars: mergedEnv });

        // Trigger redeploy on the stateless agent (unless explicitly disabled)
        if (body.redeploy !== false) {
          assertProbeTarget(defaultAgentUrl, requestPolicy);
          if (cloudApp.deploy_mode === 'compose' && cloudApp.compose_spec) {
            await upAgentCompose({
              endpoint: defaultAgentUrl,
              slug,
              composeSpec: cloudApp.compose_spec,
              env: mergedEnv,
            });
          } else {
            await runAgentContainer({
              endpoint: defaultAgentUrl,
              token: resolvedToken,
              slug,
              image: cloudApp.image,
              port: cloudApp.port ?? 3000,
              domain: cloudApp.domain ?? undefined,
              env: mergedEnv,
              fetchImpl,
              timeoutMs: 60_000,
            });
          }
        }

        // Return redacted env (values replaced with [REDACTED])
        const redactedEnv: Record<string, string> = {};
        for (const key of Object.keys(mergedEnv)) {
          redactedEnv[key] = '[REDACTED]';
        }

        mark(rule.operation, 'success');
        return { success: true, data: { slug, env: redactedEnv } };
      } catch (error) {
        mark(rule.operation, 'failed', 'mesh');
        return reply.code(502).send({
          success: false,
          error: safeErrorText(
            error,
            [resolvedToken, ...Object.values(incomingEnv)],
            'PaaS env update failed'
          ),
        });
      }
    });

    fastify.post<{ Params: { slug: string }; Body: { domain?: string } }>(
      '/api/cloud/paas/apps/:slug/domain',
      WRITE_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/paas/apps/:slug/domain');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;

        const slug = req.params.slug.trim();
        if (!PAAS_SLUG_PATTERN.test(slug)) {
          mark(rule.operation, 'invalid');
          return reply.code(400).send({ success: false, error: 'Invalid PaaS app slug' });
        }
        const domain = typeof req.body?.domain === 'string' ? req.body.domain.trim() : '';
        if (domain && !isValidPublicDomain(domain)) {
          mark(rule.operation, 'invalid');
          return reply.code(400).send({ success: false, error: 'Invalid public domain' });
        }

        const cloudApp = await CloudApp.query().findOne({
          name: slug,
          company_id: ctx.companyId,
          managed_by: 'paas',
          is_active: true,
        });
        if (!cloudApp) {
          mark(rule.operation, 'invalid');
          return reply.code(404).send({ success: false, error: `App ${slug} not found` });
        }

        try {
          if (domain) {
            // Collision checks: instance/whatsapp domains and other active PaaS apps
            const settings = await readPaasInstanceSettings();
            const lowerDomain = domain.toLowerCase();
            if (
              (settings.instanceDomain && lowerDomain === settings.instanceDomain.toLowerCase()) ||
              (settings.whatsappDomain && lowerDomain === settings.whatsappDomain.toLowerCase())
            ) {
              mark(rule.operation, 'invalid');
              return reply.code(400).send({
                success: false,
                error: 'Domain collides with instance or WhatsApp domain',
              });
            }
            const collision = await CloudApp.query()
              .where({ managed_by: 'paas', is_active: true })
              .where('domain', domain)
              .first();
            if (collision && collision.id !== cloudApp.id) {
              mark(rule.operation, 'invalid');
              return reply
                .code(400)
                .send({ success: false, error: 'Domain is already used by another active app' });
            }
          }

          await CloudApp.query()
            .findById(cloudApp.id)
            .patch({
              domain: domain || null,
              ...(domain ? { host_port: null } : {}),
            });

          // Recompile & redeploy compose apps, preserving stored secrets
          if (cloudApp.deploy_mode === 'compose' && cloudApp.compose_spec) {
            const preservedEnv: Record<string, string> =
              cloudApp.env_vars &&
              typeof cloudApp.env_vars === 'object' &&
              !Array.isArray(cloudApp.env_vars)
                ? { ...(cloudApp.env_vars as Record<string, string>) }
                : {};
            await compileCoolifyCompose({
              slug,
              tenantId: `company-${ctx.companyId}`,
              composeYaml: cloudApp.compose_spec,
              defaultPort: cloudApp.port ?? 3000,
              primaryDomain: domain || undefined,
              existingEnv: preservedEnv,
              userEnv: {},
            });
            await upAgentCompose({
              endpoint: defaultAgentUrl,
              slug,
              composeSpec: cloudApp.compose_spec,
              env: preservedEnv,
            });
          }

          await reconcileCaddyWithAgent({ token: resolvedToken });

          mark(rule.operation, 'success');
          return { success: true, data: { slug, domain: domain || null } };
        } catch (error) {
          mark(rule.operation, 'failed', 'mesh');
          return reply.code(502).send({
            success: false,
            error: safeErrorText(error, [resolvedToken], 'PaaS domain update failed'),
          });
        }
      }
    );

    fastify.get<{ Params: { slug: string } }>(
      '/api/cloud/paas/apps/:slug/logs/stream',
      READ_RATE_LIMIT,
      async (req, reply) => {
        const rule = ruleFor('/api/cloud/paas/apps/:slug/logs/stream');
        const ctx = requireAuthorizedModelAccess(req, reply, rule);
        if (!ctx) return;
        if (!requireFeature(reply, rule)) return;
        if (!requireToken(reply, rule)) return;

        const slug = req.params.slug.trim();
        if (!PAAS_SLUG_PATTERN.test(slug)) {
          mark(rule.operation, 'invalid', 'mesh');
          return reply.code(400).send({ success: false, error: 'Invalid PaaS app slug' });
        }
        try {
          const url = assertProbeTarget(
            `${defaultAgentUrl}/agent/containers/${encodeURIComponent(slug)}/logs/stream`,
            requestPolicy
          );
          const res = await controlPlaneFetch(url.toString(), {
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) {
            mark(rule.operation, 'failed', 'mesh');
            return reply
              .code(res.status)
              .send({ success: false, error: 'Logs stream unavailable' });
          }
          const body = await readBoundedResponseBody(res);
          if (!body.ok) {
            mark(rule.operation, 'failed', 'mesh');
            return reply.code(502).send({ success: false, error: 'Logs stream response invalid' });
          }
          mark(rule.operation, 'success', 'mesh');
          return reply
            .header('content-type', 'text/event-stream; charset=utf-8')
            .header('cache-control', 'no-cache')
            .send(redactSecrets(body.text, [resolvedToken]));
        } catch (error) {
          mark(rule.operation, 'offline', 'mesh');
          return reply.code(502).send({
            success: false,
            error: safeErrorText(error, [resolvedToken], 'Logs stream failed'),
          });
        }
      }
    );

    const routeCtx = {
      fastify,
      defaultAgentUrl,
      resolvedToken,
      fetchImpl,
      ruleFor,
      requireAuthorizedModelAccess,
      requireFeature,
      requireToken,
      mark,
      controlPlaneFetch,
    };
    registerPaasBackupRoutes(routeCtx);
    registerPaasSettingsAndMeshRoutes(routeCtx);
    registerSystemUpdateRoutes(routeCtx);
    fastify.addHook('onReady', async () => {
      if (process.env.NODE_ENV === 'production' && process.env.MW_CONTROL_PLANE_URL) {
        // Non-blocking boot reconciliation: reconcile Caddy from PostgreSQL state.
        void reconcileCaddyWithAgent({ token: resolvedToken }).catch(() => {
          // Swallowed intentionally: boot must not fail if the agent is not yet reachable.
        });
      }
    });
  };
}

export const cloudHttpPlugin = createCloudHttpPlugin();
