import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { Role } from '@moonwitness/auth';
import {
  AccessGroup,
  Company,
  CompanyMembership,
  GroupMembership,
  ModelAccess,
} from '@moonwitness/orm-base';
import type { AuthContext, GroupModelGrant } from '../auth/policy.js';
import { createAuthCacheBus, type AuthCacheBus } from './auth-cache-bus.js';

export type { AuthContext };

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook on every non-public route; null on public ones. */
    auth: AuthContext | null;
  }
}

export interface AuthPluginOptions {
  jwtSecret?: string;
  accessTtlSeconds: number;
  cacheTtlMs?: number;
}

export const AUTH_INVALIDATING_MODELS = new Set([
  'base.user',
  'base.company_membership',
  'base.group_membership',
  'base.model_access',
  'base.access_group',
  'base.company',
  'base.partner',
]);

interface CachedCompanyMembership {
  company_id: number;
  is_default: boolean | number;
  company_active: boolean | number | null;
}

interface CachedAuthRecord {
  epoch: number;
  expiresAt: number;
  active: boolean;
  role: Role;
  partnerId?: number;
  partnerCompanyId?: number;
  tokenVersion?: number;
  companyMemberships: readonly CachedCompanyMembership[];
  groupPermissions: readonly GroupModelGrant[];
  groupNames: readonly string[];
}

const DEFAULT_AUTH_CACHE_TTL_MS = 5_000;
const MAX_AUTH_CACHE_ENTRIES = 2_000;

let authCacheEpoch = 1;
const authCache = new Map<number, CachedAuthRecord>();
let authCacheBus: AuthCacheBus | null = null;

/**
 * Broadcast every invalidation to other API replicas over PG NOTIFY. Test
 * backends (SQLite) get an inert bus, so behavior there is unchanged.
 */
export function setAuthCacheBus(bus: AuthCacheBus | null): void {
  authCacheBus = bus;
}

function clearLocalAuthCache(userId?: number): void {
  if (userId !== undefined) {
    authCache.delete(userId);
  } else {
    authCacheEpoch += 1;
    authCache.clear();
  }
}

/** Testing hook: handle an invalidation that arrived from another replica. */
export function handleRemoteAuthCacheInvalidation(userId?: number): void {
  // Apply locally ONLY — never re-broadcast back onto the PG NOTIFY bus.
  clearLocalAuthCache(userId);
}

export function getAuthCacheEpoch(): number {
  return authCacheEpoch;
}

/**
 * Immediately invalidates cached auth state for a specific user or all users.
 * Called on role, password, group membership, model access, company membership, or session revocation.
 * Also broadcasts the invalidation to other API replicas via PG NOTIFY.
 */
export function invalidateAuthCache(userId?: number): void {
  clearLocalAuthCache(userId);
  void authCacheBus?.broadcast(userId);
}

export function invalidateAuthCacheForModel(modelName: string, userId?: number): void {
  if (AUTH_INVALIDATING_MODELS.has(modelName)) {
    invalidateAuthCache(userId);
  }
}

function resolveCacheTtlMs(option?: number): number {
  if (option !== undefined) return Math.max(0, option);
  const envVal = process.env.AUTH_CACHE_TTL_MS;
  if (envVal !== undefined) {
    const parsed = Number(envVal);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return 0;
  return DEFAULT_AUTH_CACHE_TTL_MS;
}

const ROLES: readonly string[] = ['system', 'superadmin', 'user'];
const ISSUER = 'moonwitness';

/** Routes reachable without a token. Logout is public: the refresh token is its credential. */
function isPublic(url: string): boolean {
  return (
    url === '/' ||
    url === '/health' ||
    url === '/livez' ||
    url === '/readyz' ||
    url === '/whatsapp/readyz' ||
    url === '/whatsapp/gowa/webhook/:deviceId' ||
    url === '/metrics' ||
    url.startsWith('/docs') ||
    url === '/auth/register' ||
    url === '/auth/login' ||
    url === '/auth/refresh' ||
    url === '/auth/logout' ||
    url === '/auth/setup-status' ||
    url === '/auth/setup-claim'
  );
}

export function validateJwtSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error(
      'JWT_SECRET is required. Generate a persistent value with node:crypto and set it in the repository .env.'
    );
  }
  if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  return secret;
}

/**
 * Registers JWT support and a global guard that authenticates every request except the
 * public routes. Must be registered after the ORM plugin: it enriches `request.env`.
 */
const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  invalidateAuthCache();
  const cacheTtlMs = resolveCacheTtlMs(options.cacheTtlMs);

  // Cross-replica invalidation: on PostgreSQL, listen for invalidations from
  // other replicas and apply them to the local cache. No-ops on test backends.
  if (!authCacheBus && process.env.DATABASE_URL) {
    const bus = createAuthCacheBus({
      connectionString: process.env.DATABASE_URL,
      logger: { warn: (message: string) => fastify.log.warn(message) },
      onNotification: handleRemoteAuthCacheInvalidation,
    });
    setAuthCacheBus(bus);
    fastify.addHook('onClose', async () => {
      await bus.close();
      setAuthCacheBus(null);
    });
  }

  await fastify.register(jwt, {
    secret: validateJwtSecret(options.jwtSecret),
    // fast-jwt interprets numeric durations as milliseconds.
    sign: { algorithm: 'HS256', iss: ISSUER, expiresIn: options.accessTtlSeconds * 1000 },
    verify: { algorithms: ['HS256'], allowedIss: ISSUER },
  });

  fastify.decorateRequest('auth', null as unknown as AuthContext | null);

  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.routeOptions.url;
    const routeConfig = request.routeOptions.config as { public?: boolean } | undefined;
    // Unmatched URLs fall through so they get a normal 404; CORS preflights carry no token.
    if (
      request.method === 'OPTIONS' ||
      url === undefined ||
      routeConfig?.public === true ||
      isPublic(url)
    )
      return;
    let userId: number;
    let payloadTokenVersion: number | undefined;
    try {
      const payload = await request.jwtVerify<{ sub: string; role: string; tkv?: number }>();
      userId = Number(payload.sub);
      payloadTokenVersion = payload.tkv;
      if (!Number.isInteger(userId) || userId < 1 || !ROLES.includes(payload.role)) {
        throw new Error('Malformed token claims');
      }
    } catch {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer')
        .send({ success: false, error: 'Authentication required' });
    }

    const now = Date.now();
    let cached = cacheTtlMs > 0 ? authCache.get(userId) : undefined;
    if (cached && (cached.epoch !== authCacheEpoch || cached.expiresAt <= now)) {
      authCache.delete(userId);
      cached = undefined;
    }

    if (cached) {
      // Enforce token_version on cache hits too: a stale token must be rejected
      // even within the cache TTL window (defense in depth beyond PG NOTIFY).
      if (payloadTokenVersion !== undefined && cached.tokenVersion !== undefined) {
        if (payloadTokenVersion < cached.tokenVersion) {
          return reply
            .code(401)
            .header('WWW-Authenticate', 'Bearer')
            .send({ success: false, error: 'Token revoked' });
        }
      }
    }

    if (!cached) {
      const UserModel = request.env.get('base.user');
      const user = (await UserModel.query()
        .findById(userId)
        .withGraphFetched('partner')) as unknown as
        | (InstanceType<typeof UserModel> & {
            role: Role;
            partner_id?: number;
            partner?: { id?: number; active?: boolean; company_id?: number };
            token_version?: number;
          })
        | undefined;
      const partner = user?.partner;
      if (!user || user.active === false || !partner || partner.active === false) {
        return reply
          .code(401)
          .header('WWW-Authenticate', 'Bearer')
          .send({ success: false, error: 'Authentication required' });
      }

      // Cross-replica token_version check: reject tokens issued before the current token_version
      if (payloadTokenVersion !== undefined && user.token_version !== undefined) {
        if (payloadTokenVersion < user.token_version) {
          return reply
            .code(401)
            .header('WWW-Authenticate', 'Bearer')
            .send({ success: false, error: 'Token revoked' });
        }
      }

      const role = String(user.role) as Role;
      if (!ROLES.includes(role)) {
        return reply
          .code(401)
          .header('WWW-Authenticate', 'Bearer')
          .send({ success: false, error: 'Authentication required' });
      }

      const partnerId = user.partner_id ?? partner.id;
      const membershipTable = CompanyMembership.tableName;
      const companyTable = Company.tableName;
      const companyMemberships = (await CompanyMembership.query()
        .leftJoin(companyTable, `${membershipTable}.company_id`, `${companyTable}.id`)
        .where(`${membershipTable}.user_id`, userId)
        .where(`${membershipTable}.active`, true)
        .orderBy(`${membershipTable}.is_default`, 'desc')
        .orderBy(`${membershipTable}.company_id`, 'asc')
        .select(
          `${membershipTable}.company_id as company_id`,
          `${membershipTable}.is_default as is_default`,
          `${companyTable}.active as company_active`
        )) as unknown as CachedCompanyMembership[];

      let groupPermissions: GroupModelGrant[] = [];
      let groupNames: string[] = [];
      if (role === 'user') {
        const modelAccessTable = ModelAccess.tableName;
        const accessGroupTable = AccessGroup.tableName;
        const groupMembershipTable = GroupMembership.tableName;
        const grants = (await ModelAccess.query()
          .join(accessGroupTable, `${modelAccessTable}.group_id`, `${accessGroupTable}.id`)
          .join(groupMembershipTable, `${accessGroupTable}.id`, `${groupMembershipTable}.group_id`)
          .where(`${groupMembershipTable}.user_id`, userId)
          .where(`${groupMembershipTable}.active`, true)
          .where(`${accessGroupTable}.active`, true)
          .where(`${modelAccessTable}.active`, true)
          .select(
            `${modelAccessTable}.model_name as model_name`,
            `${modelAccessTable}.read as read`,
            `${modelAccessTable}.create as create`,
            `${modelAccessTable}.write as write`,
            `${modelAccessTable}.unlink as unlink`,
            `${accessGroupTable}.name as group_name`
          )) as unknown as (GroupModelGrant & { group_name?: string })[];
        groupPermissions = grants.map((grant) => ({
          model_name: grant.model_name,
          read: Boolean(grant.read),
          create: Boolean(grant.create),
          write: Boolean(grant.write),
          unlink: Boolean(grant.unlink),
        }));
        groupNames = Array.from(
          new Set(
            grants
              .map((grant) => grant.group_name)
              .filter((name): name is string => typeof name === 'string' && name.length > 0)
          )
        );
      }

      cached = {
        epoch: authCacheEpoch,
        expiresAt: now + cacheTtlMs,
        active: true,
        role,
        partnerId,
        partnerCompanyId: partner.company_id,
        tokenVersion: user.token_version ?? 1,
        companyMemberships,
        groupPermissions,
        groupNames,
      };

      if (cacheTtlMs > 0) {
        if (authCache.size >= MAX_AUTH_CACHE_ENTRIES) {
          authCache.clear();
        }
        authCache.set(userId, cached);
      }
    }

    const requestedCompanyHeader = request.headers['x-company-id'];
    const parsedCompanyHeader =
      typeof requestedCompanyHeader === 'string' && /^\d+$/.test(requestedCompanyHeader)
        ? Number(requestedCompanyHeader)
        : undefined;
    if (requestedCompanyHeader !== undefined && parsedCompanyHeader === undefined) {
      return reply.code(403).send({ success: false, error: 'Company access denied' });
    }

    if (cached.companyMemberships.length === 0) {
      return reply.code(403).send({ success: false, error: 'No active company membership' });
    }
    const selectedMembership =
      parsedCompanyHeader !== undefined
        ? cached.companyMemberships.find(({ company_id }) => company_id === parsedCompanyHeader)
        : (cached.companyMemberships.find(({ is_default }) => Boolean(is_default)) ??
          cached.companyMemberships.find(
            ({ company_id }) => company_id === cached.partnerCompanyId
          ) ??
          cached.companyMemberships[0]);
    if (parsedCompanyHeader !== undefined && !selectedMembership) {
      return reply.code(403).send({ success: false, error: 'Company access denied' });
    }
    const companyId = selectedMembership?.company_id;
    if (
      companyId !== undefined &&
      (selectedMembership?.company_active === null ||
        selectedMembership?.company_active === false ||
        selectedMembership?.company_active === 0)
    ) {
      return reply.code(403).send({ success: false, error: 'Company access denied' });
    }

    request.auth = {
      userId,
      role: cached.role,
      partnerId: cached.partnerId,
      companyId,
      groupPermissions: cached.groupPermissions,
      groupNames: cached.groupNames,
    };
    request.env = request.env.withContext({ userId, role: cached.role, companyId });
  });
};

export default fp(authPlugin, { name: 'moonwitness-auth' });
