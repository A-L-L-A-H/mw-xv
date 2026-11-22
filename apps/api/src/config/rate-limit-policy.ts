import type { FastifyRequest } from 'fastify';

export type RateLimitFamily =
  | 'authLogin'
  | 'authRegister'
  | 'authRefresh'
  | 'bulkMutation'
  | 'attachmentUpload'
  | 'jsonrpc'
  | 'whatsapp'
  | 'localAi';

export interface RouteRateLimitPolicy {
  readonly max: number;
  readonly timeWindow: string;
  readonly keyGenerator?: (request: FastifyRequest) => string;
}

/**
 * Generates a composite rate-limit key for authenticated requests (`companyId:userId`)
 * and falls back to client IP (`request.ip`, respecting `trustProxy`) for public routes.
 */
export function authenticatedRateLimitKey(request: FastifyRequest): string {
  const auth = request.auth;
  if (auth) {
    return `${auth.companyId ?? 0}:${auth.userId}`;
  }
  return request.ip;
}

export function publicRateLimitKey(request: FastifyRequest): string {
  return request.ip;
}

export const RATE_LIMIT_POLICIES: Record<RateLimitFamily, RouteRateLimitPolicy> = {
  authLogin: {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: publicRateLimitKey,
  },
  authRegister: {
    max: 5,
    timeWindow: '1 minute',
    keyGenerator: publicRateLimitKey,
  },
  authRefresh: {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: publicRateLimitKey,
  },
  bulkMutation: {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: authenticatedRateLimitKey,
  },
  attachmentUpload: {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: authenticatedRateLimitKey,
  },
  jsonrpc: {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: authenticatedRateLimitKey,
  },
  whatsapp: {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: authenticatedRateLimitKey,
  },
  localAi: {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: authenticatedRateLimitKey,
  },
};

export function routeRateLimitConfig(
  family: RateLimitFamily,
  overrides?: Partial<RouteRateLimitPolicy>
): { rateLimit: RouteRateLimitPolicy } {
  return {
    rateLimit: {
      ...RATE_LIMIT_POLICIES[family],
      ...overrides,
    },
  };
}
