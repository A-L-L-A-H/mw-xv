import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { canonicalizeValue } from './canonical-json.js';
import { createRedactor } from './redaction.js';
import type { DataClassification } from './types.js';
import { PRIVATE_MESH_CIDRS, isPrivateMeshHost, type PrivateMeshCidr } from '@moonwitness/types';

export const A2A_PROTOCOL_VERSION = 'a2a.v1' as const;
export const MAX_A2A_DELEGATION_DEPTH = 3;
export const MAX_A2A_TTL_MS = 300_000;
export const DEFAULT_A2A_CLOCK_SKEW_MS = 30_000;

/**
 * Canonical private-mesh address ranges (issue #203 / audit finding).
 *
 * Re-exported from @moonwitness/types for backward compatibility.
 * The authoritative list lives in @moonwitness/types/network.ts.
 */
export { PRIVATE_MESH_CIDRS, isPrivateMeshHost, type PrivateMeshCidr } from '@moonwitness/types';

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
  | 'INVALID_PROTOCOL_VERSION'
  | 'INVALID_PEER_KEY_ID';

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
  /** Key ID bound to an explicitly registered peer identity (CF-017). Signed with the envelope. */
  readonly keyId?: string;
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
  /** Key ID bound to an explicitly registered peer identity (CF-017). Covered by the HMAC. */
  readonly keyId?: string;
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
  if (
    input.keyId !== undefined &&
    (typeof input.keyId !== 'string' || input.keyId.trim().length < 1 || input.keyId.length > 128)
  ) {
    throw new A2AProtocolError(
      'INVALID_PEER_KEY_ID',
      redactor.redactString('A2A keyId must be a non-empty string of at most 128 characters.')
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
    ...(input.keyId !== undefined ? { keyId: input.keyId } : {}),
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

  if (
    envelope.keyId !== undefined &&
    (typeof envelope.keyId !== 'string' ||
      envelope.keyId.trim().length < 1 ||
      envelope.keyId.length > 128)
  ) {
    return fail(
      'INVALID_PEER_KEY_ID',
      'A2A keyId must be a non-empty string of at most 128 characters.'
    );
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
