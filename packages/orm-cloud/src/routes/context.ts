import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RequestAuth } from '@moonwitness/orm';
import {
  redactSecrets,
  type CloudOperation,
  type CloudOutcome,
  type CloudProviderLabel,
} from '../auth.js';
import type { CloudRouteAccessRule } from '../http.js';

export const CLOUD_READ_RATE_LIMIT = {
  config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
} as const;

export const CLOUD_WRITE_RATE_LIMIT = {
  config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
} as const;

export interface CloudRouteContext {
  readonly fastify: FastifyInstance;
  readonly defaultAgentUrl: string;
  readonly resolvedToken: string | undefined;
  readonly fetchImpl: typeof fetch;
  readonly ruleFor: (routePath: string) => CloudRouteAccessRule;
  readonly requireAuthorizedModelAccess: (
    request: FastifyRequest,
    reply: FastifyReply,
    rule: CloudRouteAccessRule
  ) => { auth: RequestAuth; companyId: number } | null;
  readonly requireFeature: (reply: FastifyReply, rule: CloudRouteAccessRule) => boolean;
  readonly requireToken: (reply: FastifyReply, rule: CloudRouteAccessRule) => boolean;
  readonly mark: (
    operation: CloudOperation,
    outcome: CloudOutcome,
    provider?: CloudProviderLabel | string
  ) => void;
  readonly controlPlaneFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export function safeCloudErrorText(
  error: unknown,
  secrets: readonly (string | null | undefined)[],
  fallback: string
): string {
  const message = error instanceof Error ? error.message : fallback;
  return redactSecrets(message, secrets).slice(0, 300) || fallback;
}

export function normalizeBackupRecord(raw: unknown) {
  const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sizeBytes = typeof entry.sizeBytes === 'number' ? entry.sizeBytes : 0;
  return {
    id: String(entry.id ?? ''),
    filename: String(entry.filename ?? `${String(entry.id ?? 'backup')}.dump`),
    createdAt: String(entry.createdAt ?? new Date().toISOString()),
    sizeMb: Math.max(0.01, Number((sizeBytes / 1_048_576).toFixed(2))),
    sha256: String(entry.sha256 ?? ''),
    verified: true,
  };
}
