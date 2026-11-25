import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type {
  AddonHttpApp,
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
} from '@moonwitness/orm';
import {
  DEFAULT_A2A_CLOCK_SKEW_MS,
  MAX_A2A_TTL_MS,
  createRedactor,
  isPrivateMeshHost,
  verifyA2AEnvelope,
  type SignedA2AEnvelope,
} from '@moonwitness/ai-runtime';
import { Agent } from '@moonwitness/orm-ai';
import { AuditLog, Company } from '@moonwitness/orm-base';
import { isRecord } from '@moonwitness/types';
import {
  createA2aPeerIdentityRegistryFromJson,
  type A2aPeerIdentityRegistry,
} from './peer-identity.js';
import {
  createA2aTransportIdentityConfigFromJson,
  readA2aTransportCertificate,
  verifyA2aTransportIdentity,
  type A2aTransportIdentityConfig,
} from './transport-identity.js';
import {
  A2aIngestionThrottle,
  DEFAULT_A2A_INGESTION_BACKPRESSURE,
  DEFAULT_A2A_INBOX_PAGINATION,
  DEFAULT_A2A_INBOX_RETENTION,
  buildA2aInboxPage,
  parseA2aInboxPageRequest,
  projectA2aReceiptForRetention,
  type A2aInboxPaginationConfig,
  type A2aInboxRetentionPolicy,
  type A2aIngestionBackpressureConfig,
} from './inbox-policy.js';

const A2A_MESSAGE_MODEL = 'ai.a2a_message';
const A2A_FENCING_MODEL = 'ai.a2a_fencing';
const MAX_RECENT_RECEIPTS = 2_000;

/** Optional, explicit service injection. Production defaults stay fail-closed and default-off. */
export interface A2aReceiverServices {
  readonly now?: () => number;
  readonly peerIdentityRegistry?: A2aPeerIdentityRegistry;
  readonly transportIdentityConfig?: A2aTransportIdentityConfig;
  readonly ingestionThrottle?: A2aIngestionThrottle;
  readonly paginationConfig?: A2aInboxPaginationConfig;
  readonly retentionPolicy?: A2aInboxRetentionPolicy;
}

interface A2aPeerIdentityReceiverConfig {
  readonly enabled: boolean;
  readonly registry: A2aPeerIdentityRegistry | null;
}

type A2AApiConfig =
  | { readonly enabled: false; readonly valid: true }
  | { readonly enabled: true; readonly valid: false; readonly error: string }
  | {
      readonly enabled: true;
      readonly valid: true;
      readonly companyId: number;
      readonly signingSecret: string;
      readonly endpointOrigin: string;
      readonly peerIdentity: A2aPeerIdentityReceiverConfig;
      readonly transportIdentity: A2aTransportIdentityConfig;
      readonly backpressure: A2aIngestionBackpressureConfig;
      readonly pagination: A2aInboxPaginationConfig;
      readonly retention: A2aInboxRetentionPolicy;
    };

interface A2AReject {
  readonly statusCode: number;
  readonly reasonCode: string;
  readonly error: string;
}

interface A2AAuditChanges extends Record<string, unknown> {
  readonly companyId: number;
  readonly messageId: string;
  readonly nonce: string;
  readonly sourceAgentId: string;
  readonly targetAgentId: string;
  readonly fencingToken: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly receivedAt: string;
  readonly sourcePeerAddress: string;
  readonly dataClassification: string;
  readonly delegationDepth: number;
  readonly payloadSha256: string;
  readonly payload: Record<string, unknown>;
  readonly peerKeyId?: string;
  readonly peerKeyFingerprintSha256?: string;
}

interface A2APeerIdentityMetadata {
  readonly keyId: string;
  readonly fingerprintSha256: string;
}

type A2AEnvelope = SignedA2AEnvelope<Record<string, unknown>>;

const DEFAULT_THROTTLE = new A2aIngestionThrottle();

function readEnvInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number | null {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readA2AApiConfig(
  env: NodeJS.ProcessEnv = process.env,
  services: A2aReceiverServices = {}
): A2AApiConfig {
  const rawEnabled = env.MW_A2A_API_ENABLED?.trim().toLowerCase();
  if (rawEnabled === undefined || rawEnabled === '' || rawEnabled === 'false') {
    return { enabled: false, valid: true };
  }
  if (rawEnabled !== 'true') {
    return {
      enabled: true,
      valid: false,
      error: 'MW_A2A_API_ENABLED must be true or false',
    };
  }

  const signingSecret = env.MW_A2A_SIGNING_SECRET?.trim() ?? '';
  if (signingSecret.length < 32) {
    return {
      enabled: true,
      valid: false,
      error: 'MW_A2A_SIGNING_SECRET must contain at least 32 characters',
    };
  }

  const companyId = Number(env.MW_A2A_COMPANY_ID);
  if (!Number.isSafeInteger(companyId) || companyId < 1) {
    return {
      enabled: true,
      valid: false,
      error: 'MW_A2A_COMPANY_ID must be a positive safe integer',
    };
  }

  const rawEndpoint = env.MW_A2A_API_ENDPOINT?.trim();
  if (!rawEndpoint) {
    return {
      enabled: true,
      valid: false,
      error: 'MW_A2A_API_ENDPOINT is required when the A2A API receiver is enabled',
    };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== '/' ||
      endpoint.search ||
      endpoint.hash ||
      !isPrivateMeshHost(endpoint.toString())
    ) {
      throw new Error('endpoint must be an origin on a private EasyTier mesh IP');
    }
  } catch {
    return {
      enabled: true,
      valid: false,
      error: 'MW_A2A_API_ENDPOINT must be an http(s) origin on a private EasyTier mesh IP',
    };
  }

  let peerIdentity: A2aPeerIdentityReceiverConfig;
  try {
    let registry = services.peerIdentityRegistry ?? null;
    if (!registry && env.MW_A2A_PEER_KEYS_JSON?.trim()) {
      registry = createA2aPeerIdentityRegistryFromJson(env.MW_A2A_PEER_KEYS_JSON);
    }
    const enabled =
      services.peerIdentityRegistry !== undefined ||
      env.MW_A2A_PEER_IDENTITY_ENABLED?.trim().toLowerCase() === 'true';
    if (enabled && !registry) {
      return {
        enabled: true,
        valid: false,
        error: 'MW_A2A_PEER_KEYS_JSON is required when per-agent peer identity is enabled',
      };
    }
    peerIdentity = { enabled, registry };
  } catch (error) {
    return {
      enabled: true,
      valid: false,
      error: `Invalid MW_A2A_PEER_KEYS_JSON: ${(error as Error).message}`,
    };
  }

  let transportIdentity: A2aTransportIdentityConfig;
  try {
    const enabled = env.MW_A2A_TRANSPORT_IDENTITY_ENABLED?.trim().toLowerCase() === 'true';
    transportIdentity =
      services.transportIdentityConfig ??
      (env.MW_A2A_TRANSPORT_PEERS_JSON?.trim()
        ? createA2aTransportIdentityConfigFromJson(env.MW_A2A_TRANSPORT_PEERS_JSON, enabled)
        : { enabled, peers: [] });
    if (transportIdentity.enabled && transportIdentity.peers.length === 0) {
      return {
        enabled: true,
        valid: false,
        error: 'MW_A2A_TRANSPORT_PEERS_JSON is required when transport identity is enabled',
      };
    }
  } catch (error) {
    return {
      enabled: true,
      valid: false,
      error: `Invalid MW_A2A_TRANSPORT_PEERS_JSON: ${(error as Error).message}`,
    };
  }

  const defaultLimit = readEnvInteger(
    env,
    'MW_A2A_INBOX_DEFAULT_LIMIT',
    DEFAULT_A2A_INBOX_PAGINATION.defaultLimit
  );
  const maxLimit = readEnvInteger(
    env,
    'MW_A2A_INBOX_MAX_LIMIT',
    DEFAULT_A2A_INBOX_PAGINATION.maxLimit
  );
  if (defaultLimit === null || maxLimit === null || defaultLimit < 1 || maxLimit < defaultLimit) {
    return {
      enabled: true,
      valid: false,
      error:
        'MW_A2A_INBOX_DEFAULT_LIMIT and MW_A2A_INBOX_MAX_LIMIT must be positive integers with maxLimit >= defaultLimit',
    };
  }
  const pagination: A2aInboxPaginationConfig = Object.freeze({ defaultLimit, maxLimit });

  const payloadRetentionMs = readEnvInteger(
    env,
    'MW_A2A_PAYLOAD_RETENTION_MS',
    DEFAULT_A2A_INBOX_RETENTION.payloadRetentionMs
  );
  if (payloadRetentionMs === null || payloadRetentionMs < 1) {
    return {
      enabled: true,
      valid: false,
      error: 'MW_A2A_PAYLOAD_RETENTION_MS must be a positive integer',
    };
  }
  const retention: A2aInboxRetentionPolicy = Object.freeze({
    ...DEFAULT_A2A_INBOX_RETENTION,
    payloadRetentionMs,
  });

  return {
    enabled: true,
    valid: true,
    companyId,
    signingSecret,
    endpointOrigin: endpoint.origin,
    peerIdentity,
    transportIdentity,
    backpressure: services.ingestionThrottle?.config ?? DEFAULT_A2A_INGESTION_BACKPRESSURE,
    pagination: services.paginationConfig ?? pagination,
    retention: services.retentionPolicy ?? retention,
  };
}

function normalizeIpAddress(value: string | undefined | null): string | null {
  if (!value) return null;
  let candidate = value.trim();
  if (candidate.startsWith('[') && candidate.endsWith(']')) {
    candidate = candidate.slice(1, -1);
  }
  if (candidate.startsWith('::ffff:')) {
    candidate = candidate.slice('::ffff:'.length);
  }
  if (isIP(candidate) === 0) return null;
  return candidate.toLowerCase();
}

function parseMeshEndpoint(
  value: string
): { readonly host: string; readonly origin: string } | null {
  try {
    const trimmed = value.trim();
    const normalized = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || !isPrivateMeshHost(parsed.toString())) return null;
    const host = normalizeIpAddress(parsed.hostname);
    if (!host) return null;
    return { host, origin: parsed.origin };
  } catch {
    return null;
  }
}

function parseEnvelope(value: unknown): A2AEnvelope | null {
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  const requiredStrings = [
    'protocolVersion',
    'messageId',
    'sourceAgentId',
    'targetAgentId',
    'targetEndpoint',
    'dataClassification',
    'nonce',
    'signature',
  ] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== 'string' || !value[key].trim()) return null;
  }
  if (
    (value.sourceEndpoint !== undefined &&
      (typeof value.sourceEndpoint !== 'string' || !value.sourceEndpoint.trim())) ||
    (value.keyId !== undefined &&
      (typeof value.keyId !== 'string' || !value.keyId.trim() || value.keyId.length > 128)) ||
    !Number.isSafeInteger(value.companyId) ||
    !Number.isSafeInteger(value.delegationDepth) ||
    !Number.isSafeInteger(value.fencingToken) ||
    !Number.isSafeInteger(value.issuedAt) ||
    !Number.isSafeInteger(value.expiresAt)
  ) {
    return null;
  }
  if (
    (value.messageId as string).length > 200 ||
    (value.sourceAgentId as string).length > 128 ||
    (value.targetAgentId as string).length > 128 ||
    (value.nonce as string).length > 256
  ) {
    return null;
  }
  if (
    value.claimedStatus !== undefined &&
    !['proposed', 'in_progress', 'submitted', 'rejected', 'accepted'].includes(
      String(value.claimedStatus)
    )
  ) {
    return null;
  }
  return value as unknown as A2AEnvelope;
}

function parseAuditChanges(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const UNAUTHORIZED_REASON_CODES = new Set([
  'INVALID_SECRET',
  'INVALID_SIGNATURE',
  'PEER_KEY_UNKNOWN',
  'PEER_KEY_REVOKED',
  'PEER_KEY_RETIRED',
  'PEER_KEY_EXPIRED',
  'PEER_KEY_GRACE_EXPIRED',
  'TRANSPORT_TLS_REQUIRED',
  'TRANSPORT_CERT_MISSING',
  'TRANSPORT_CERT_UNTRUSTED',
  'TRANSPORT_CERT_INVALID_VALIDITY',
  'TRANSPORT_CERT_NOT_YET_VALID',
  'TRANSPORT_CERT_EXPIRED',
  'TRANSPORT_CERT_FINGERPRINT_INVALID',
]);

const FORBIDDEN_REASON_CODES = new Set([
  'PUBLIC_ENDPOINT_FORBIDDEN',
  'COMPANY_ISOLATION_VIOLATION',
  'DELEGATION_DEPTH_EXCEEDED',
  'CLASSIFICATION_VIOLATION',
  'SERVER_ONLY_ACCEPTED_AUTHORITY',
  'PEER_KEY_CROSS_COMPANY_REUSE',
  'PEER_KEY_AGENT_MISMATCH',
  'TRANSPORT_CERT_REVOKED',
  'TRANSPORT_CERT_FINGERPRINT_MISMATCH',
  'TRANSPORT_IDENTITY_NOT_ALLOWED',
  'TRANSPORT_IDENTITY_MISMATCH',
]);

const CONFLICT_REASON_CODES = new Set([
  'STALE_FENCING_TOKEN',
  'REPLAY_NONCE_DETECTED',
  'DUPLICATE_MESSAGE_ID',
]);

function verificationReject(reasonCode: string | undefined, reason: string | undefined): A2AReject {
  const code = reasonCode ?? 'INVALID_ENVELOPE';
  const statusCode =
    code === 'A2A_RATE_LIMITED'
      ? 429
      : UNAUTHORIZED_REASON_CODES.has(code)
        ? 401
        : code === 'ENVELOPE_EXPIRED'
          ? 410
          : FORBIDDEN_REASON_CODES.has(code)
            ? 403
            : CONFLICT_REASON_CODES.has(code)
              ? 409
              : code === 'PEER_KEY_ID_REQUIRED' || code === 'INVALID_PEER_KEY_ID'
                ? 400
                : 400;
  return {
    statusCode,
    reasonCode: code,
    error: reason ?? 'A2A envelope rejected',
  };
}

function sendReject(reply: AddonHttpReply, error: A2AReject) {
  return reply.code(error.statusCode).send({
    success: false,
    error: error.error,
    reasonCode: error.reasonCode,
  });
}

async function persistA2AReceipt(
  envelope: A2AEnvelope,
  config: Extract<A2AApiConfig, { readonly enabled: true; readonly valid: true }>,
  nowMs: number,
  sourcePeerAddress: string,
  verificationSecret: string,
  peerIdentity: A2APeerIdentityMetadata | undefined
): Promise<
  | { readonly ok: true; readonly receivedAt: string }
  | { readonly ok: false; readonly error: A2AReject }
> {
  return Company.transaction(async (trx) => {
    // The company-row lock serializes replay/fencing decisions across API replicas.
    const company = await Company.query(trx).findById(config.companyId).forUpdate();
    if (!company || company.active === false) {
      return {
        ok: false,
        error: {
          statusCode: 403,
          reasonCode: 'COMPANY_ISOLATION_VIOLATION',
          error: 'A2A company is missing or inactive',
        },
      };
    }

    const sourceAgent = await Agent.query(trx)
      .findOne({
        company_id: config.companyId,
        code: envelope.sourceAgentId,
        active: true,
      })
      .forUpdate();
    const targetAgent = await Agent.query(trx)
      .findOne({
        company_id: config.companyId,
        code: envelope.targetAgentId,
        active: true,
      })
      .forUpdate();

    if (!sourceAgent || sourceAgent.status !== 'active' || sourceAgent.is_emergency_stopped) {
      return {
        ok: false,
        error: {
          statusCode: 403,
          reasonCode: 'SOURCE_AGENT_NOT_ACTIVE',
          error: 'A2A source agent is not active in the configured company',
        },
      };
    }
    if (!targetAgent || targetAgent.status !== 'active' || targetAgent.is_emergency_stopped) {
      return {
        ok: false,
        error: {
          statusCode: 409,
          reasonCode: 'TARGET_AGENT_NOT_ACTIVE',
          error: 'A2A target agent is not active in the configured company',
        },
      };
    }

    const replayCutoff = new Date(nowMs - MAX_A2A_TTL_MS - DEFAULT_A2A_CLOCK_SKEW_MS).toISOString();
    const recentReceipts = await AuditLog.query(trx)
      .where({
        model: A2A_MESSAGE_MODEL,
        record_id: config.companyId,
        operation: 'received',
      })
      .where('create_date', '>=', replayCutoff)
      .orderBy('id', 'desc')
      .limit(MAX_RECENT_RECEIPTS + 1);

    // Never silently truncate the replay set. Fail closed until the bounded window drains.
    if (recentReceipts.length > MAX_RECENT_RECEIPTS) {
      return {
        ok: false,
        error: {
          statusCode: 503,
          reasonCode: 'A2A_REPLAY_WINDOW_CAPACITY',
          error: 'A2A replay-protection window is at capacity',
        },
      };
    }

    const seenNonces = new Set<string>();
    let duplicateMessageId = false;
    for (const receipt of recentReceipts) {
      const changes = parseAuditChanges(receipt.changes);
      if (!changes) {
        return {
          ok: false,
          error: {
            statusCode: 503,
            reasonCode: 'A2A_AUDIT_INTEGRITY_ERROR',
            error: 'A2A replay ledger contains an unreadable receipt',
          },
        };
      }
      if (
        typeof changes.nonce === 'string' &&
        typeof changes.expiresAt === 'number' &&
        changes.expiresAt >= nowMs
      ) {
        seenNonces.add(changes.nonce);
      }
      if (changes.messageId === envelope.messageId) duplicateMessageId = true;
    }

    const latestFence = await AuditLog.query(trx)
      .where({
        model: A2A_FENCING_MODEL,
        record_id: sourceAgent.id,
        operation: 'advance',
      })
      .orderBy('id', 'desc')
      .first();

    let lastSeenFencingToken: number | undefined;
    if (latestFence) {
      const changes = parseAuditChanges(latestFence.changes);
      if (
        !changes ||
        changes.companyId !== config.companyId ||
        changes.sourceAgentId !== envelope.sourceAgentId ||
        !Number.isSafeInteger(changes.fencingToken) ||
        Number(changes.fencingToken) < 1
      ) {
        return {
          ok: false,
          error: {
            statusCode: 503,
            reasonCode: 'A2A_FENCING_LEDGER_INTEGRITY_ERROR',
            error: 'A2A fencing ledger is inconsistent; refusing delegation',
          },
        };
      }
      lastSeenFencingToken = Number(changes.fencingToken);
    }

    const verification = verifyA2AEnvelope(envelope, {
      signingSecret: verificationSecret,
      expectedCompanyId: config.companyId,
      lastSeenFencingToken,
      seenNonces,
      nowMs,
    });
    if (!verification.valid) {
      return {
        ok: false,
        error: verificationReject(verification.reasonCode, verification.reason),
      };
    }
    if (duplicateMessageId) {
      return {
        ok: false,
        error: {
          statusCode: 409,
          reasonCode: 'DUPLICATE_MESSAGE_ID',
          error: 'A2A messageId has already been received',
        },
      };
    }

    const receivedAt = new Date(nowMs).toISOString();
    const redactor = createRedactor([config.signingSecret, verificationSecret]);
    const safePayload = redactor.redactObject(envelope.payload);
    const payloadSha256 = createHash('sha256')
      .update(JSON.stringify(envelope.payload), 'utf8')
      .digest('hex');

    await AuditLog.query(trx).insert({
      model: A2A_FENCING_MODEL,
      record_id: sourceAgent.id,
      operation: 'advance',
      actor_id: sourceAgent.service_user_id ?? null,
      changes: JSON.stringify({
        companyId: config.companyId,
        sourceAgentId: envelope.sourceAgentId,
        fencingToken: envelope.fencingToken,
        messageId: envelope.messageId,
        receivedAt,
        sourcePeerAddress,
      }),
    });

    await AuditLog.query(trx).insert({
      model: A2A_MESSAGE_MODEL,
      record_id: config.companyId,
      operation: 'received',
      actor_id: sourceAgent.service_user_id ?? null,
      changes: JSON.stringify({
        companyId: config.companyId,
        messageId: envelope.messageId,
        nonce: envelope.nonce,
        sourceAgentId: envelope.sourceAgentId,
        targetAgentId: envelope.targetAgentId,
        delegationDepth: envelope.delegationDepth,
        dataClassification: envelope.dataClassification,
        fencingToken: envelope.fencingToken,
        issuedAt: envelope.issuedAt,
        expiresAt: envelope.expiresAt,
        receivedAt,
        sourcePeerAddress,
        payloadSha256,
        payload: safePayload,
        status: 'queued',
        ...(peerIdentity !== undefined
          ? {
              peerKeyId: peerIdentity.keyId,
              peerKeyFingerprintSha256: peerIdentity.fingerprintSha256,
            }
          : {}),
      } satisfies A2AAuditChanges),
    });

    return { ok: true, receivedAt };
  });
}

/** Optional third argument is for tests and other hosts; the addon uses the default services. */
export async function a2aApiRoutes(
  fastify: AddonHttpApp,
  options: AddonHttpHostContext,
  services: A2aReceiverServices = {}
): Promise<void> {
  const throttle = services.ingestionThrottle ?? DEFAULT_THROTTLE;
  const now = (): number => services.now?.() ?? Date.now();

  fastify.post(
    '/a2a/delegate',
    {
      config: { public: true },
      schema: {
        tags: ['A2A'],
        description:
          'Public signed A2A v1 envelope receiver. Requires X-A2A-Protocol and a valid HMAC envelope; never accepts a bearer token. CF-017/018 gates are default-off and fail closed when enabled.',
      },
    },
    async (request, reply) => {
      const activeConfig = readA2AApiConfig(undefined, services);
      if (!activeConfig.enabled) {
        return reply.code(404).send({ success: false, error: 'A2A API receiver is disabled' });
      }
      if (!activeConfig.valid) {
        return reply.code(503).send({ success: false, error: activeConfig.error });
      }
      if (request.headers['x-a2a-protocol'] !== 'a2a.v1') {
        return reply.code(400).send({
          success: false,
          error: 'X-A2A-Protocol must be a2a.v1',
          reasonCode: 'INVALID_PROTOCOL_VERSION',
        });
      }

      const rawRequest = request as unknown as {
        raw?: { socket?: { remoteAddress?: string | null } };
      };
      const remoteAddress = normalizeIpAddress(rawRequest.raw?.socket?.remoteAddress);
      if (!remoteAddress || !isPrivateMeshHost(remoteAddress)) {
        return reply.code(403).send({
          success: false,
          error: 'A2A requests must originate directly from a private EasyTier mesh IP',
          reasonCode: 'PUBLIC_ENDPOINT_FORBIDDEN',
        });
      }

      const envelope = parseEnvelope(request.body);
      if (!envelope) {
        return reply.code(400).send({
          success: false,
          error: 'Malformed A2A envelope',
          reasonCode: 'INVALID_ENVELOPE',
        });
      }

      if (
        Buffer.byteLength(JSON.stringify(envelope), 'utf8') >
        activeConfig.backpressure.maxEnvelopeBytes
      ) {
        return reply.code(413).send({
          success: false,
          error: 'A2A envelope exceeds the API receiver size limit',
          reasonCode: 'ENVELOPE_TOO_LARGE',
        });
      }

      const nowMs = now();
      const throttleDecision = throttle.tryAcquire(nowMs);
      if (!throttleDecision.allowed) {
        reply.header('Retry-After', String(activeConfig.backpressure.retryAfterSeconds));
        return sendReject(
          reply,
          verificationReject('A2A_RATE_LIMITED', 'A2A ingestion rate limit exceeded')
        );
      }

      const sourceEndpoint =
        envelope.sourceEndpoint === undefined
          ? undefined
          : parseMeshEndpoint(envelope.sourceEndpoint);
      const targetEndpoint = parseMeshEndpoint(envelope.targetEndpoint);
      if (
        envelope.sourceEndpoint !== undefined &&
        (!sourceEndpoint || sourceEndpoint.host !== remoteAddress)
      ) {
        return reply.code(403).send({
          success: false,
          error: 'A2A sourceEndpoint must match the direct private mesh peer address',
          reasonCode: 'SOURCE_ENDPOINT_MISMATCH',
        });
      }
      if (!targetEndpoint || targetEndpoint.origin !== activeConfig.endpointOrigin) {
        return reply.code(403).send({
          success: false,
          error: 'A2A targetEndpoint does not identify this configured API receiver',
          reasonCode: 'TARGET_ENDPOINT_MISMATCH',
        });
      }

      let verificationSecret = activeConfig.signingSecret;
      let peerIdentityMetadata: A2APeerIdentityMetadata | undefined;
      if (activeConfig.peerIdentity.enabled && activeConfig.peerIdentity.registry) {
        const resolved = activeConfig.peerIdentity.registry.resolve({
          keyId: envelope.keyId,
          companyId: envelope.companyId,
          agentCode: envelope.sourceAgentId,
          nowMs,
        });
        if (!resolved.ok) {
          return sendReject(reply, verificationReject(resolved.reasonCode, resolved.error));
        }
        verificationSecret = resolved.key.secret;
        peerIdentityMetadata = {
          keyId: resolved.key.keyId,
          fingerprintSha256: resolved.key.fingerprintSha256,
        };
      }

      if (activeConfig.transportIdentity.enabled) {
        const transportResult = verifyA2aTransportIdentity(
          readA2aTransportCertificate(request, nowMs),
          activeConfig.transportIdentity
        );
        if (!transportResult.ok) {
          return sendReject(
            reply,
            verificationReject(transportResult.reasonCode, transportResult.error)
          );
        }
        const identity = transportResult.identity;
        if (
          !identity ||
          identity.companyId !== envelope.companyId ||
          identity.agentCode !== envelope.sourceAgentId ||
          (peerIdentityMetadata !== undefined &&
            identity.keyId !== undefined &&
            identity.keyId !== peerIdentityMetadata.keyId)
        ) {
          return sendReject(
            reply,
            verificationReject(
              'TRANSPORT_IDENTITY_MISMATCH',
              'Transport-authenticated peer identity does not match the signed envelope'
            )
          );
        }
      }

      const initialVerification = verifyA2AEnvelope(envelope, {
        signingSecret: verificationSecret,
        expectedCompanyId: activeConfig.companyId,
        nowMs,
      });
      if (!initialVerification.valid) {
        return sendReject(
          reply,
          verificationReject(initialVerification.reasonCode, initialVerification.reason)
        );
      }

      const persisted = await persistA2AReceipt(
        envelope,
        activeConfig,
        nowMs,
        remoteAddress,
        verificationSecret,
        peerIdentityMetadata
      );
      if (!persisted.ok) return sendReject(reply, persisted.error);

      return reply.code(202).send({
        status: 'queued',
        messageId: envelope.messageId,
        companyId: envelope.companyId,
        delegationDepth: envelope.delegationDepth,
        fencingToken: envelope.fencingToken,
        receivedAt: persisted.receivedAt,
      });
    }
  );

  fastify.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/api/ai/a2a/inbox',
    {
      schema: {
        tags: ['A2A'],
        description:
          'Administrator-only, bounded and cursor-paginated view of the durable A2A message inbox. Payload minimization preserves verification digests and audit references.',
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }
      if (!auth.companyId) {
        return reply.code(403).send({ success: false, error: 'Active company context required' });
      }

      const role = auth.role === 'system' || auth.role === 'superadmin' ? auth.role : 'user';
      if (!options.hasCompanyAccess) {
        return reply
          .code(503)
          .send({ success: false, error: 'Company access validation unavailable' });
      }
      const hasAccess = await options.hasCompanyAccess(auth.userId, auth.companyId, role);
      if (!hasAccess) {
        return reply.code(403).send({ success: false, error: 'Company access denied' });
      }
      if (role !== 'system' && role !== 'superadmin') {
        return reply
          .code(403)
          .send({ success: false, error: 'A2A inbox access requires an administrator' });
      }

      const inboxConfig = readA2AApiConfig(undefined, services);
      if (!inboxConfig.enabled) {
        return reply.code(404).send({ success: false, error: 'A2A API receiver is disabled' });
      }
      if (!inboxConfig.valid) {
        return reply.code(503).send({ success: false, error: inboxConfig.error });
      }
      if (auth.companyId !== inboxConfig.companyId) {
        return reply
          .code(403)
          .send({ success: false, error: 'A2A inbox is outside the configured company' });
      }

      const pageRequest = parseA2aInboxPageRequest(request.query, inboxConfig.pagination);
      if (!pageRequest.ok) {
        return reply
          .code(400)
          .send({ success: false, error: pageRequest.error, reasonCode: pageRequest.reasonCode });
      }

      let inboxQuery = AuditLog.query().where({
        model: A2A_MESSAGE_MODEL,
        record_id: auth.companyId,
        operation: 'received',
      });
      if (pageRequest.query.beforeId !== undefined) {
        inboxQuery = inboxQuery.where('id', '<', pageRequest.query.beforeId);
      }
      const rows = await inboxQuery.orderBy('id', 'desc').limit(pageRequest.query.limit + 1);

      const page = buildA2aInboxPage(rows, pageRequest.query.limit, inboxConfig.pagination);
      const data = page.items.map((row) =>
        projectA2aReceiptForRetention(
          {
            auditLogId: row.id,
            model: A2A_MESSAGE_MODEL,
            receivedAt: typeof row.create_date === 'string' ? row.create_date : '',
            changes: {
              ...(parseAuditChanges(row.changes) ?? { integrityError: true }),
              createdAt: row.create_date,
            },
          },
          now(),
          inboxConfig.retention
        )
      );

      return {
        success: true,
        data,
        page: {
          limit: page.limit,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
        },
      };
    }
  );
}

// Keep the addon plugin type available to consumers without loosening the
// optional-services signature used by tests and other hosts.
export const a2aApiAddonPlugin: AddonHttpPlugin = a2aApiRoutes;
