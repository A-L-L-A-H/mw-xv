import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AddonHttpPlugin } from '@moonwitness/orm';
import { AuditLog } from '@moonwitness/orm-base';
import { Subscription } from '@moonwitness/orm-subscription';
import { ispAuthHeaders, resolveIspAdminToken } from './auth.js';
import { meterSessionsToSubscriptionInvoices } from './metering.js';
import {
  probeIspNasHealth,
  processIspRadiusOutbox,
  syncIspRuntimeSessions,
  type NasHealthStatus,
} from './reconcile.js';
import {
  ISPBandwidthProfile,
  ISPNAS,
  ISPRadiusOutbox,
  ISPRadiusSession,
  ISPSubscriber,
} from './models/index.js';

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

export interface IspHttpPluginOptions {
  readonly ispServiceUrl?: string;
  readonly adminToken?: string;
  readonly jwtSecret?: string;
  readonly fetchImpl?: typeof fetch;
}

function requestAuth(req: FastifyRequest): RequestAuth | null {
  const auth = (req as { auth?: RequestAuth | null }).auth;
  return auth && typeof auth.userId === 'number' ? auth : null;
}

function parsePositiveId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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
  modelNames: readonly string[],
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
  const allowed = modelNames.some((modelName) => hasModelAccess(auth, modelName, op));
  if (!allowed) {
    void reply
      .code(403)
      .send({ success: false, error: `Access denied for ${modelNames.join('|')}:${op}` });
    return null;
  }
  return { auth, companyId: auth.companyId };
}

export function createIspHttpPlugin(options: IspHttpPluginOptions = {}): AddonHttpPlugin {
  return async (fastifyApp) => {
    const fastify = fastifyApp as FastifyInstance;
    const baseUrl = (options.ispServiceUrl ?? process.env.MW_ISP_URL ?? 'http://127.0.0.1:3002').replace(
      /\/+$/u,
      ''
    );
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const adminToken = resolveIspAdminToken({
      adminToken: options.adminToken,
      jwtSecret: options.jwtSecret,
    });

    fastify.get('/api/isp/health', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(req, reply, [ISPNAS.modelName], 'read');
      if (!ctx) return;

      let runtime: 'connected' | 'unreachable' = 'unreachable';
      try {
        const res = await fetchImpl(`${baseUrl}/health`, {
          headers: ispAuthHeaders(adminToken),
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) runtime = 'connected';
      } catch {
        runtime = 'unreachable';
      }

      const [nasCount, subscriberCount] = await Promise.all([
        ISPNAS.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
        ISPSubscriber.query().where({ company_id: ctx.companyId, active: true }).resultSize(),
      ]);

      return {
        success: true,
        data: {
          runtime,
          nasCount,
          subscriberCount,
        },
      };
    });

    fastify.post<{ Params: { id: string } }>('/api/isp/nas/:id/sync', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(req, reply, [ISPNAS.modelName], 'write');
      if (!ctx) return;
      const nasId = parsePositiveId(req.params.id);
      if (!nasId) return reply.code(400).send({ success: false, error: 'Invalid NAS ID' });

      const nas = await ISPNAS.query().findOne({
        id: nasId,
        company_id: ctx.companyId,
        active: true,
      });
      if (!nas) return reply.code(404).send({ success: false, error: 'NAS device not found' });

      const response = await fetchImpl(`${baseUrl}/api/clients`, {
        method: 'POST',
        headers: ispAuthHeaders(adminToken, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          name: nas.name,
          ip_address: nas.ip_address,
          secret: nas.secret,
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        return reply.code(502).send({
          success: false,
          error: `ISP runtime sync failed (${response.status})`,
        });
      }

      return {
        success: true,
        data: {
          nasId: nas.id,
          name: nas.name,
          ipAddress: nas.ip_address,
          synced: true,
        },
      };
    });

    fastify.post<{ Params: { id: string }; Body: { reason?: string } | undefined }>(
      '/api/isp/nas/:id/rotate-secret',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, [ISPNAS.modelName], 'write');
        if (!ctx) return;
        const nasId = parsePositiveId(req.params.id);
        if (!nasId) return reply.code(400).send({ success: false, error: 'Invalid NAS ID' });

        const nas = await ISPNAS.query().findOne({
          id: nasId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!nas) return reply.code(404).send({ success: false, error: 'NAS device not found' });

        const newSecret = randomBytes(24).toString('base64url');
        const reason = req.body?.reason?.trim() || 'manual_rotation';

        await ISPNAS.query().findById(nas.id).patch({ secret: newSecret });
        await AuditLog.query().insert({
          model: ISPNAS.modelName,
          record_id: nas.id,
          operation: 'rotate_secret',
          actor_id: ctx.auth.userId,
          changes: JSON.stringify({ reason, secret: '[redacted]' }),
        });

        let runtimeSynced = false;
        try {
          const res = await fetchImpl(
            `${baseUrl}/api/clients/${encodeURIComponent(nas.ip_address)}/rotate-secret`,
            {
              method: 'POST',
              headers: ispAuthHeaders(adminToken, { 'content-type': 'application/json' }),
              body: JSON.stringify({ secret: newSecret, reason }),
              signal: AbortSignal.timeout(5_000),
            }
          );
          runtimeSynced = res.ok;
        } catch {
          runtimeSynced = false;
        }

        return {
          success: true,
          data: {
            nasId: nas.id,
            ipAddress: nas.ip_address,
            rotated: true,
            runtimeSynced,
          },
        };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      '/api/isp/subscribers/:id/sync',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, [ISPSubscriber.modelName], 'write');
        if (!ctx) return;
        const subscriberId = parsePositiveId(req.params.id);
        if (!subscriberId) {
          return reply.code(400).send({ success: false, error: 'Invalid subscriber ID' });
        }

        const subscriber = await ISPSubscriber.query().findOne({
          id: subscriberId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!subscriber) {
          return reply.code(404).send({ success: false, error: 'Subscriber not found' });
        }

        if (subscriber.subscription_id) {
          const subscription = await Subscription.query().findOne({
            id: subscriber.subscription_id,
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

        const profile = subscriber.profile_id
          ? await ISPBandwidthProfile.query().findById(subscriber.profile_id)
          : undefined;

        const response = await fetchImpl(`${baseUrl}/api/subscribers`, {
          method: 'POST',
          headers: ispAuthHeaders(adminToken, { 'content-type': 'application/json' }),
          body: JSON.stringify({
            username: subscriber.username,
            password: subscriber.password,
            connection_type: subscriber.type,
            framed_ip: subscriber.ip_address ?? null,
            download_kbps: profile?.download_kbps ?? 20480,
            upload_kbps: profile?.upload_kbps ?? 10240,
            status: subscriber.status,
          }),
          signal: AbortSignal.timeout(5_000),
        });

        if (!response.ok) {
          return reply.code(502).send({
            success: false,
            error: `ISP subscriber sync failed (${response.status})`,
          });
        }

        return {
          success: true,
          data: {
            id: subscriber.id,
            username: subscriber.username,
            status: subscriber.status,
            synced: true,
          },
        };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      '/api/isp/subscribers/:id/suspend',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, [ISPSubscriber.modelName], 'write');
        if (!ctx) return;
        const subscriberId = parsePositiveId(req.params.id);
        if (!subscriberId) {
          return reply.code(400).send({ success: false, error: 'Invalid subscriber ID' });
        }

        const subscriber = await ISPSubscriber.query().findOne({
          id: subscriberId,
          company_id: ctx.companyId,
          active: true,
        });
        if (!subscriber) {
          return reply.code(404).send({ success: false, error: 'Subscriber not found' });
        }

        await ISPSubscriber.query().findById(subscriber.id).patch({ status: 'suspended' });
        const outboxRow = await ISPRadiusOutbox.query().insertAndFetch({
          company_id: ctx.companyId,
          username: subscriber.username,
          type: 'disconnect',
          status: 'pending',
          framed_ip_address: subscriber.ip_address ?? null,
          created_at: new Date().toISOString().slice(0, 19),
        });

        let dispatched = false;
        try {
          const suspendRes = await fetchImpl(
            `${baseUrl}/api/subscribers/${encodeURIComponent(subscriber.username)}/suspend`,
            {
              method: 'POST',
              headers: ispAuthHeaders(adminToken),
              signal: AbortSignal.timeout(5_000),
            }
          );
          if (suspendRes.ok) {
            const disconnectRes = await fetchImpl(`${baseUrl}/api/sessions/disconnect`, {
              method: 'POST',
              headers: ispAuthHeaders(adminToken, { 'content-type': 'application/json' }),
              body: JSON.stringify({
                username: subscriber.username,
                nas_ip: undefined,
                acct_session_id: undefined,
                framed_ip: subscriber.ip_address ?? undefined,
              }),
              signal: AbortSignal.timeout(5_000),
            });
            dispatched = disconnectRes.ok || disconnectRes.status === 404;
          }
        } catch {
          dispatched = false;
        }

        if (dispatched) {
          await ISPRadiusOutbox.query().findById(outboxRow.id).patch({
            status: 'sent',
            sent_at: new Date().toISOString().slice(0, 19),
            response: JSON.stringify({ immediateDispatch: true }),
            error_message: null,
          });
        }

        return {
          success: true,
          data: {
            id: subscriber.id,
            username: subscriber.username,
            status: 'suspended',
            dispatched,
          },
        };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      '/api/isp/subscriptions/:id/enforce',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, [ISPSubscriber.modelName], 'write');
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
          return { success: true, data: { suspendedCount: 0, state: subscription.state } };
        }

        const affected = await ISPSubscriber.query().where({
          company_id: ctx.companyId,
          subscription_id: subscription.id,
          status: 'active',
          active: true,
        });

        for (const sub of affected) {
          await ISPSubscriber.query().findById(sub.id).patch({ status: 'suspended' });
          await ISPRadiusOutbox.query().insert({
            company_id: ctx.companyId,
            username: sub.username,
            type: 'disconnect',
            status: 'pending',
            framed_ip_address: sub.ip_address ?? null,
            created_at: new Date().toISOString().slice(0, 19),
          });
          try {
            await fetchImpl(
              `${baseUrl}/api/subscribers/${encodeURIComponent(sub.username)}/suspend`,
              {
                method: 'POST',
                headers: ispAuthHeaders(adminToken),
                signal: AbortSignal.timeout(3_000),
              }
            );
          } catch {
            // Outbox retains disconnect intent if runtime is temporarily offline.
          }
        }

        return {
          success: true,
          data: { suspendedCount: affected.length, state: subscription.state },
        };
      }
    );

    fastify.get('/api/isp/sessions/live', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(req, reply, [ISPRadiusSession.modelName], 'read');
      if (!ctx) return;

      const dbSessions = await ISPRadiusSession.query()
        .where({ company_id: ctx.companyId, active: true })
        .orderBy('id', 'desc')
        .limit(50);

      let runtimeSessions: unknown[] = [];
      try {
        const res = await fetchImpl(`${baseUrl}/api/sessions`, {
          headers: ispAuthHeaders(adminToken),
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) {
          const parsed = await res.json();
          if (Array.isArray(parsed)) runtimeSessions = parsed;
        }
      } catch {
        runtimeSessions = [];
      }

      return {
        success: true,
        data: {
          dbSessions,
          runtimeSessions,
        },
      };
    });

    fastify.post<{ Body: { pricePerGbMinor?: number } | undefined }>(
      '/api/isp/sessions/sync',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, [ISPRadiusSession.modelName], 'write');
        if (!ctx) return;

        try {
          const result = await syncIspRuntimeSessions({
            companyId: ctx.companyId,
            ispServiceUrl: baseUrl,
            adminToken,
            pricePerGbMinor: req.body?.pricePerGbMinor,
            fetchImpl,
          });
          return { success: true, data: result };
        } catch (error) {
          return reply.code(502).send({
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'ISP runtime session sync failed unexpectedly',
          });
        }
      }
    );

    fastify.post('/api/isp/outbox/process', async (req, reply) => {
      const ctx = requireAuthorizedModelAccess(
        req,
        reply,
        [ISPRadiusOutbox.modelName, ISPSubscriber.modelName],
        'write'
      );
      if (!ctx) return;

      try {
        const result = await processIspRadiusOutbox({
          companyId: ctx.companyId,
          ispServiceUrl: baseUrl,
          adminToken,
          fetchImpl,
        });
        return { success: true, data: result };
      } catch (error) {
        return reply.code(502).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'ISP RADIUS outbox processing failed unexpectedly',
        });
      }
    });

    fastify.post<{ Body: { timeoutMs?: number } | undefined }>(
      '/api/isp/nas/probe',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, [ISPNAS.modelName], 'write');
        if (!ctx) return;

        const result = await probeIspNasHealth({
          companyId: ctx.companyId,
          timeoutMs: req.body?.timeoutMs,
          probeFn: async (nas): Promise<NasHealthStatus> => {
            try {
              const res = await fetchImpl(
                `${baseUrl}/api/clients/${encodeURIComponent(nas.ip_address)}`,
                {
                  headers: ispAuthHeaders(adminToken),
                  signal: AbortSignal.timeout(req.body?.timeoutMs ?? 2_000),
                }
              );
              return res.ok ? 'healthy' : res.status === 503 ? 'degraded' : 'offline';
            } catch {
              return 'offline';
            }
          },
        });
        return { success: true, data: result };
      }
    );

    fastify.post<{ Body: { pricePerGbMinor?: number } | undefined }>(
      '/api/isp/metering/run',
      async (req, reply) => {
        const ctx = requireAuthorizedModelAccess(req, reply, [ISPRadiusSession.modelName], 'write');
        if (!ctx) return;
        const result = await meterSessionsToSubscriptionInvoices({
          companyId: ctx.companyId,
          pricePerGbMinor: req.body?.pricePerGbMinor,
        });
        return { success: true, data: result };
      }
    );
  };
}

export const ispHttpPlugin = createIspHttpPlugin();
