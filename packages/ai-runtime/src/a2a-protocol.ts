import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRedactor } from './redaction.js';
import type { DataClassification } from './types.js';

export const A2A_PROTOCOL_VERSION = 'a2a.v1' as const;
export const MAX_A2A_DELEGATION_DEPTH = 3;
export const MAX_A2A_TTL_MS = 300_000;
export const DEFAULT_A2A_CLOCK_SKEW_MS = 30_000;

export type A2AClaimedStatus = 'proposed' | 'in_progress' | 'submitted' | 'rejected' | 'accepted';

export type A2ARejectionReasonCode =
  | 'PUBLIC_ENDPOINT_FORBIDDEN'
  | 'COMPANY_ISOLATION_VIOLATION'
  | 'DELEGATION_DEPTH_EXCEEDED'
  | 'CLASSIFICATION_VIOLATION'
  | 'SERVER_ONLY_ACCEPTED_AUTHORITY'
  | 'INVALID_FENCING_TOKEN'
  | 'STALE_FENCING_TOKEN'
  | 'INVALID_TTL'
  | 'ENVELOPE_EXPIRED'
  | 'ENVELOPE_NOT_YET_VALID'
  | 'REPLAY_NONCE_DETECTED'
  | 'INVALID_NONCE'
  | 'INVALID_SIGNATURE'
  | 'INVALID_SECRET'
  | 'INVALID_PROTOCOL_VERSION';

export interface A2ADelegationPolicyInput {
  readonly targetEndpoint: string;
  readonly sourceEndpoint?: string;
  readonly sourceCompanyId: number;
  readonly targetCompanyId: number;
  readonly delegationDepth: number;
  readonly maxDelegationDepth?: number;
  readonly dataClassification: DataClassification;
  readonly fencingToken: number;
  readonly lastKnownFencingToken?: number;
  readonly ttlMs: number;
  readonly claimedStatus?: A2AClaimedStatus;
}

export interface A2APolicyValidationResult {
  readonly allowed: boolean;
  readonly reasonCode?: A2ARejectionReasonCode;
  readonly reason?: string;
}

export interface CreateA2AEnvelopeInput<TPayload extends Record<string, unknown>> {
  readonly messageId: string;
  readonly sourceAgentId: string;
  readonly targetAgentId: string;
  readonly sourceEndpoint?: string;
  readonly targetEndpoint: string;
  readonly companyId: number;
  readonly targetCompanyId?: number;
  readonly delegationDepth: number;
  readonly maxDelegationDepth?: number;
  readonly dataClassification: DataClassification;
  readonly fencingToken: number;
  readonly lastKnownFencingToken?: number;
  readonly ttlMs: number;
  readonly nowMs?: number;
  readonly nonce?: string;
  readonly claimedStatus?: A2AClaimedStatus;
  readonly payload: TPayload;
}

export interface SignedA2AEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly protocolVersion: typeof A2A_PROTOCOL_VERSION;
  readonly messageId: string;
  readonly sourceAgentId: string;
  readonly targetAgentId: string;
  readonly sourceEndpoint?: string;
  readonly targetEndpoint: string;
  readonly companyId: number;
  readonly delegationDepth: number;
  readonly dataClassification: DataClassification;
  readonly fencingToken: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly nonce: string;
  readonly claimedStatus?: A2AClaimedStatus;
  readonly payload: TPayload;
  readonly signature: string;
}

export interface VerifyA2AEnvelopeOptions {
  readonly signingSecret: string;
  readonly expectedCompanyId: number;
  readonly maxDelegationDepth?: number;
  readonly lastSeenFencingToken?: number;
  readonly seenNonces?: ReadonlySet<string>;
  readonly nowMs?: number;
  readonly maxClockSkewMs?: number;
}

export interface A2AVerificationResult {
  readonly valid: boolean;
  readonly reasonCode?: A2ARejectionReasonCode;
  readonly reason?: string;
}

export class A2AProtocolError extends Error {
  readonly reasonCode: A2ARejectionReasonCode;

  constructor(reasonCode: A2ARejectionReasonCode, message: string) {
    super(message);
    this.name = 'A2AProtocolError';
    this.reasonCode = reasonCode;
  }
}

const VALID_CLASSIFICATIONS: ReadonlySet<string> = new Set<DataClassification>([
  'local_only',
  'cloud_eligible',
  'restricted',
]);

function parseStrictIpv4(host: string): readonly [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part)) {
      return null;
    }
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return null;
    }
    octets.push(num);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function isValidIpv6UlaFd00(rawHost: string): boolean {
  const host =
    rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (!host.includes(':') || host.includes('%') || host.includes('.')) {
    return false;
  }
  const doubleColonParts = host.split('::');
  if (doubleColonParts.length > 2) {
    return false;
  }

  const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
  const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
  const allGroups = [...left, ...right];

  if (doubleColonParts.length === 1) {
    if (allGroups.length !== 8) {
      return false;
    }
  } else if (allGroups.length >= 8) {
    return false;
  }

  for (const group of allGroups) {
    if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) {
      return false;
    }
  }

  const firstGroup = left[0];
  if (!firstGroup) {
    return false;
  }
  const firstValue = Number.parseInt(firstGroup, 16);
  return firstValue >= 0xfd00 && firstValue <= 0xfdff;
}

function extractHost(hostOrUrl: string): string | null {
  const trimmed = hostOrUrl.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes('://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.hostname;
    } catch {
      return null;
    }
  }
  return trimmed;
}

export function isPrivateMeshHost(hostOrUrl: string): boolean {
  const host = extractHost(hostOrUrl);
  if (!host) {
    return false;
  }

  const ipv4 = parseStrictIpv4(host);
  if (ipv4) {
    const [o0, o1] = ipv4;
    if (o0 === 10) return true; // 10.0.0.0/8
    if (o0 === 100 && o1 >= 64 && o1 <= 127) return true; // 100.64.0.0/10
    if (o0 === 172 && o1 >= 16 && o1 <= 31) return true; // 172.16.0.0/12
    if (o0 === 192 && o1 === 168) return true; // 192.168.0.0/16
    return false;
  }

  return isValidIpv6UlaFd00(host);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateA2ADelegationPolicy(
  input: A2ADelegationPolicyInput
): A2APolicyValidationResult {
  if (!VALID_CLASSIFICATIONS.has(input.dataClassification)) {
    return {
      allowed: false,
      reasonCode: 'CLASSIFICATION_VIOLATION',
      reason: 'Unsupported data classification for A2A delegation.',
    };
  }

  if (!isPrivateMeshHost(input.targetEndpoint)) {
    const isSensitive =
      input.dataClassification === 'restricted' || input.dataClassification === 'local_only';
    return {
      allowed: false,
      reasonCode: isSensitive ? 'CLASSIFICATION_VIOLATION' : 'PUBLIC_ENDPOINT_FORBIDDEN',
      reason: isSensitive
        ? `Data classification "${input.dataClassification}" cannot leave the private EasyTier mesh.`
        : 'A2A target endpoint must be a private EasyTier mesh IP.',
    };
  }

  if (input.sourceEndpoint !== undefined && !isPrivateMeshHost(input.sourceEndpoint)) {
    return {
      allowed: false,
      reasonCode: 'PUBLIC_ENDPOINT_FORBIDDEN',
      reason: 'A2A source endpoint must be a private EasyTier mesh IP.',
    };
  }

  if (
    !isPositiveSafeInteger(input.sourceCompanyId) ||
    !isPositiveSafeInteger(input.targetCompanyId) ||
    input.sourceCompanyId !== input.targetCompanyId
  ) {
    return {
      allowed: false,
      reasonCode: 'COMPANY_ISOLATION_VIOLATION',
      reason: 'Cross-company A2A delegation is forbidden.',
    };
  }

  const effectiveMaxDepth = Math.min(
    input.maxDelegationDepth ?? MAX_A2A_DELEGATION_DEPTH,
    MAX_A2A_DELEGATION_DEPTH
  );
  if (
    !Number.isInteger(input.delegationDepth) ||
    input.delegationDepth < 0 ||
    input.delegationDepth > effectiveMaxDepth
  ) {
    return {
      allowed: false,
      reasonCode: 'DELEGATION_DEPTH_EXCEEDED',
      reason: `Delegation depth ${String(input.delegationDepth)} exceeds maximum allowed depth ${String(effectiveMaxDepth)}.`,
    };
  }

  if (input.claimedStatus === 'accepted') {
    return {
      allowed: false,
      reasonCode: 'SERVER_ONLY_ACCEPTED_AUTHORITY',
      reason: 'Peer A2A envelopes cannot self-assert accepted status.',
    };
  }

  if (!isPositiveSafeInteger(input.fencingToken)) {
    return {
      allowed: false,
      reasonCode: 'INVALID_FENCING_TOKEN',
      reason: 'A2A fencingToken must be a positive safe integer.',
    };
  }

  if (
    input.lastKnownFencingToken !== undefined &&
    input.fencingToken <= input.lastKnownFencingToken
  ) {
    return {
      allowed: false,
      reasonCode: 'STALE_FENCING_TOKEN',
      reason: 'A2A fencingToken must be strictly monotonic.',
    };
  }

  if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0 || input.ttlMs > MAX_A2A_TTL_MS) {
    return {
      allowed: false,
      reasonCode: 'INVALID_TTL',
      reason: `A2A ttlMs must be between 1 and ${String(MAX_A2A_TTL_MS)} ms.`,
    };
  }

  return { allowed: true };
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        sorted[key] = canonicalizeValue(entry);
      }
    }
    return sorted;
  }
  return value;
}

function computeEnvelopeSignature<TPayload extends Record<string, unknown>>(
  envelope: Omit<SignedA2AEnvelope<TPayload>, 'signature'>,
  signingSecret: string
): string {
  const canonicalPayload = JSON.stringify(canonicalizeValue(envelope));
  return createHmac('sha256', signingSecret).update(canonicalPayload, 'utf8').digest('hex');
}

export function createSignedA2AEnvelope<TPayload extends Record<string, unknown>>(
  input: CreateA2AEnvelopeInput<TPayload>,
  signingSecret: string
): SignedA2AEnvelope<TPayload> {
  const redactor = createRedactor();
  redactor.registerSecret(signingSecret);

  if (!signingSecret || signingSecret.trim().length < 16) {
    throw new A2AProtocolError(
      'INVALID_SECRET',
      redactor.redactString('A2A signing secret must be at least 16 characters.')
    );
  }

  const policyResult = validateA2ADelegationPolicy({
    targetEndpoint: input.targetEndpoint,
    sourceEndpoint: input.sourceEndpoint,
    sourceCompanyId: input.companyId,
    targetCompanyId: input.targetCompanyId ?? input.companyId,
    delegationDepth: input.delegationDepth,
    maxDelegationDepth: input.maxDelegationDepth,
    dataClassification: input.dataClassification,
    fencingToken: input.fencingToken,
    lastKnownFencingToken: input.lastKnownFencingToken,
    ttlMs: input.ttlMs,
    claimedStatus: input.claimedStatus,
  });

  if (!policyResult.allowed) {
    throw new A2AProtocolError(
      policyResult.reasonCode ?? 'PUBLIC_ENDPOINT_FORBIDDEN',
      redactor.redactString(policyResult.reason ?? 'A2A delegation policy rejected.')
    );
  }

  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  if (nonce.trim().length < 16) {
    throw new A2AProtocolError(
      'INVALID_NONCE',
      redactor.redactString('A2A nonce must be at least 16 characters.')
    );
  }

  const issuedAt = input.nowMs ?? Date.now();
  const expiresAt = issuedAt + input.ttlMs;
  const sanitizedPayload = redactor.redactObject(input.payload);

  const unsignedEnvelope: Omit<SignedA2AEnvelope<TPayload>, 'signature'> = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    messageId: input.messageId,
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    ...(input.sourceEndpoint !== undefined ? { sourceEndpoint: input.sourceEndpoint } : {}),
    targetEndpoint: input.targetEndpoint,
    companyId: input.companyId,
    delegationDepth: input.delegationDepth,
    dataClassification: input.dataClassification,
    fencingToken: input.fencingToken,
    issuedAt,
    expiresAt,
    nonce,
    ...(input.claimedStatus !== undefined ? { claimedStatus: input.claimedStatus } : {}),
    payload: sanitizedPayload,
  };

  const signature = computeEnvelopeSignature(unsignedEnvelope, signingSecret);

  return {
    ...unsignedEnvelope,
    signature,
  };
}

export function verifyA2AEnvelope<TPayload extends Record<string, unknown>>(
  envelope: SignedA2AEnvelope<TPayload>,
  options: VerifyA2AEnvelopeOptions
): A2AVerificationResult {
  const redactor = createRedactor();
  redactor.registerSecret(options.signingSecret);

  const fail = (reasonCode: A2ARejectionReasonCode, reason: string): A2AVerificationResult => ({
    valid: false,
    reasonCode,
    reason: redactor.redactString(reason),
  });

  if (!options.signingSecret || options.signingSecret.trim().length < 16) {
    return fail('INVALID_SECRET', 'A2A verification secret must be at least 16 characters.');
  }

  if (envelope.protocolVersion !== A2A_PROTOCOL_VERSION) {
    return fail('INVALID_PROTOCOL_VERSION', 'Unsupported A2A protocol version.');
  }

  const ttlMs = envelope.expiresAt - envelope.issuedAt;
  const policyResult = validateA2ADelegationPolicy({
    targetEndpoint: envelope.targetEndpoint,
    sourceEndpoint: envelope.sourceEndpoint,
    sourceCompanyId: envelope.companyId,
    targetCompanyId: options.expectedCompanyId,
    delegationDepth: envelope.delegationDepth,
    maxDelegationDepth: options.maxDelegationDepth,
    dataClassification: envelope.dataClassification,
    fencingToken: envelope.fencingToken,
    lastKnownFencingToken: options.lastSeenFencingToken,
    ttlMs,
    claimedStatus: envelope.claimedStatus,
  });

  if (!policyResult.allowed) {
    return fail(
      policyResult.reasonCode ?? 'PUBLIC_ENDPOINT_FORBIDDEN',
      policyResult.reason ?? 'A2A delegation policy rejected.'
    );
  }

  if (!envelope.nonce || envelope.nonce.trim().length < 16) {
    return fail('INVALID_NONCE', 'A2A envelope nonce is missing or too short.');
  }

  if (options.seenNonces?.has(envelope.nonce)) {
    return fail('REPLAY_NONCE_DETECTED', 'A2A envelope nonce has already been processed.');
  }

  const nowMs = options.nowMs ?? Date.now();
  const maxClockSkewMs = options.maxClockSkewMs ?? DEFAULT_A2A_CLOCK_SKEW_MS;

  if (nowMs > envelope.expiresAt) {
    return fail('ENVELOPE_EXPIRED', 'A2A envelope TTL has expired.');
  }

  if (envelope.issuedAt > nowMs + maxClockSkewMs) {
    return fail('ENVELOPE_NOT_YET_VALID', 'A2A envelope issuedAt exceeds allowed clock skew.');
  }

  if (!/^[0-9a-f]{64}$/iu.test(envelope.signature)) {
    return fail('INVALID_SIGNATURE', 'A2A envelope signature format is invalid.');
  }

  const { signature, ...unsignedEnvelope } = envelope;
  const expectedSignature = computeEnvelopeSignature(unsignedEnvelope, options.signingSecret);

  const actualBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return fail('INVALID_SIGNATURE', 'A2A envelope HMAC-SHA256 signature verification failed.');
  }

  return { valid: true };
}
