import { randomUUID } from 'node:crypto';
import {
  A2AProtocolError,
  createSignedA2AEnvelope,
  isPrivateMeshHost,
  type A2AClaimedStatus,
  type SignedA2AEnvelope,
} from '@moonwitness/ai-runtime';
import { DesktopRiskGate, redactSensitiveText } from './risk-gate.js';
import type {
  DataClassification,
  DesktopCapabilityGrant,
  HumanApprovalToken,
  RiskEvaluationDecision,
} from './types.js';

export type A2AFetchFn = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

export interface A2AMeshClientOptions {
  readonly signingSecret: string;
  readonly riskGate?: DesktopRiskGate;
  readonly fetchFn?: A2AFetchFn;
  readonly defaultTtlMs?: number;
}

export interface DelegateToMeshNodeInput<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly runId: string;
  readonly agentId: number;
  readonly messageId?: string;
  readonly sourceAgentId: string;
  readonly targetAgentId: string;
  readonly sourceEndpoint?: string;
  readonly targetEndpoint: string;
  readonly companyId: number;
  readonly targetCompanyId?: number;
  readonly delegationDepth: number;
  readonly dataClassification: DataClassification;
  readonly fencingToken: number;
  readonly lastKnownFencingToken?: number;
  readonly ttlMs?: number;
  readonly claimedStatus?: A2AClaimedStatus;
  readonly payload: TPayload;
  readonly grant: DesktopCapabilityGrant;
  readonly expectedPolicyVersion: number;
  readonly workContractId?: number;
  readonly requireHumanApproval?: boolean;
  readonly humanApproval?: HumanApprovalToken;
  readonly nowMs?: number;
  readonly nonce?: string;
}

export interface A2ADelegationReceipt {
  readonly status: string;
  readonly messageId: string;
  readonly companyId: number;
  readonly delegationDepth: number;
  readonly fencingToken: number;
  readonly receivedAt: string;
}

export interface DelegateToMeshNodeResult<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly ok: boolean;
  readonly statusCode: number;
  readonly envelope: SignedA2AEnvelope<TPayload>;
  readonly riskDecision: RiskEvaluationDecision;
  readonly receipt?: A2ADelegationReceipt;
  readonly error?: string;
  readonly reasonCode?: string;
}

const ALLOWED_DELEGATE_PATHS: Readonly<Record<string, '/a2a/delegate' | '/a2a'>> = {
  '': '/a2a/delegate',
  '/': '/a2a/delegate',
  '/a2a/delegate': '/a2a/delegate',
  '/a2a': '/a2a',
};

function parseAndNormalizeIpv4Host(hostname: string): string | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/u.test(part)) return null;
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }
  return `${octets[0]}.${octets[1]}.${octets[2]}.${octets[3]}`;
}

function parseAndNormalizeIpv6Host(hostname: string): string | null {
  if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null;
  const raw = hostname.slice(1, -1);
  if (!raw.includes(':') || raw.includes('%') || raw.includes('.')) return null;
  const doubleColonParts = raw.split('::');
  if (doubleColonParts.length > 2) return null;

  const leftParts = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
  const rightParts = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
  const totalProvided = leftParts.length + rightParts.length;
  if (doubleColonParts.length === 1) {
    if (totalProvided !== 8) return null;
  } else if (totalProvided >= 8) {
    return null;
  }

  const parseHexGroup = (group: string): number | null => {
    if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) return null;
    const value = Number.parseInt(group, 16);
    return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : null;
  };

  const groups: number[] = [];
  for (const part of leftParts) {
    const parsed = parseHexGroup(part);
    if (parsed === null) return null;
    groups.push(parsed);
  }
  for (let i = 0; i < 8 - totalProvided; i += 1) {
    groups.push(0);
  }
  for (const part of rightParts) {
    const parsed = parseHexGroup(part);
    if (parsed === null) return null;
    groups.push(parsed);
  }
  if (groups.length !== 8) return null;

  // Compress the longest run of >= 2 zero groups (RFC 5952) from validated numeric groups.
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i += 1) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen += 1;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen >= 2) {
    const leftHex = groups
      .slice(0, bestStart)
      .map((g) => g.toString(16))
      .join(':');
    const rightHex = groups
      .slice(bestStart + bestLen)
      .map((g) => g.toString(16))
      .join(':');
    return `[${leftHex}::${rightHex}]`;
  }
  return `[${groups.map((g) => g.toString(16)).join(':')}]`;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function resolveDelegateUrl(targetEndpoint: string): string {
  const trimmed = targetEndpoint.trim();
  if (!trimmed || /\s/u.test(trimmed) || hasControlChar(trimmed)) {
    throw new A2AProtocolError(
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'A2A target endpoint must not contain whitespace or control characters.'
    );
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('@') ||
    lower.includes('\\') ||
    lower.includes('..') ||
    lower.includes('%2e') ||
    lower.includes('%2f') ||
    lower.includes('%5c') ||
    lower.includes('?') ||
    lower.includes('#')
  ) {
    throw new A2AProtocolError(
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'A2A target endpoint contains forbidden URL characters or traversal sequences.'
    );
  }

  const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new A2AProtocolError(
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'A2A target endpoint must be a valid HTTP(S) private EasyTier mesh URL.'
    );
  }

  const protocol =
    parsed.protocol === 'https:' ? 'https' : parsed.protocol === 'http:' ? 'http' : null;
  if (!protocol) {
    throw new A2AProtocolError(
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'A2A target endpoint must use http or https.'
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new A2AProtocolError(
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'A2A target endpoint must not contain embedded credentials.'
    );
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new A2AProtocolError(
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'A2A target endpoint must not contain query parameters or fragments.'
    );
  }

  if (!isPrivateMeshHost(parsed.hostname)) {
    throw new A2AProtocolError(
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'A2A target endpoint must be a private EasyTier mesh IP.'
    );
  }

  const normalizedHost =
    parseAndNormalizeIpv4Host(parsed.hostname) ?? parseAndNormalizeIpv6Host(parsed.hostname);
  if (!normalizedHost) {
    throw new A2AProtocolError(
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'A2A target endpoint host must be a valid IPv4 or IPv6 literal.'
    );
  }

  let portSuffix = '';
  if (parsed.port !== '') {
    if (!/^\d{1,5}$/u.test(parsed.port)) {
      throw new A2AProtocolError(
        'PUBLIC_ENDPOINT_FORBIDDEN',
        'A2A target endpoint port must be a valid TCP port.'
      );
    }
    const portNum = Number.parseInt(parsed.port, 10);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new A2AProtocolError(
        'PUBLIC_ENDPOINT_FORBIDDEN',
        'A2A target endpoint port must be between 1 and 65535.'
      );
    }
    portSuffix = `:${portNum}`;
  }

  const normalizedPath = Object.prototype.hasOwnProperty.call(
    ALLOWED_DELEGATE_PATHS,
    parsed.pathname
  )
    ? ALLOWED_DELEGATE_PATHS[parsed.pathname]
    : undefined;
  if (!normalizedPath) {
    throw new A2AProtocolError(
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'A2A target endpoint path is not allowlisted.'
    );
  }

  return `${protocol}://${normalizedHost}${portSuffix}${normalizedPath}`;
}

export class A2AMeshClient {
  private readonly signingSecret: string;
  private readonly riskGate: DesktopRiskGate;
  private readonly fetchFn: A2AFetchFn;
  private readonly defaultTtlMs: number;

  constructor(options: A2AMeshClientOptions) {
    this.signingSecret = options.signingSecret;
    this.riskGate = options.riskGate ?? new DesktopRiskGate();
    this.fetchFn =
      options.fetchFn ??
      ((input, init) => fetch(resolveDelegateUrl(input), { ...init, redirect: 'manual' }));
    this.defaultTtlMs = options.defaultTtlMs ?? 60_000;
  }

  async delegateToMeshNode<TPayload extends Record<string, unknown>>(
    input: DelegateToMeshNodeInput<TPayload>
  ): Promise<DelegateToMeshNodeResult<TPayload>> {
    if (!isPrivateMeshHost(input.targetEndpoint)) {
      throw new A2AProtocolError(
        'PUBLIC_ENDPOINT_FORBIDDEN',
        'A2A target endpoint must be a private EasyTier mesh IP.'
      );
    }
    const url = resolveDelegateUrl(input.targetEndpoint);
    if (input.sourceEndpoint !== undefined && !isPrivateMeshHost(input.sourceEndpoint)) {
      throw new A2AProtocolError(
        'PUBLIC_ENDPOINT_FORBIDDEN',
        'A2A source endpoint must be a private EasyTier mesh IP.'
      );
    }

    const action = input.requireHumanApproval ? 'network.egress' : 'sidecar.sync_local';
    const riskDecision = this.riskGate.assertAllowed({
      runId: input.runId,
      action,
      companyId: input.companyId,
      agentId: input.agentId,
      ...(input.workContractId !== undefined ? { workContractId: input.workContractId } : {}),
      dataClassification: input.dataClassification,
      grant: input.grant,
      expectedPolicyVersion: input.expectedPolicyVersion,
      ...(input.humanApproval !== undefined ? { humanApproval: input.humanApproval } : {}),
      ...(input.nowMs !== undefined ? { now: new Date(input.nowMs) } : {}),
    });

    const envelope = createSignedA2AEnvelope<TPayload>(
      {
        messageId: input.messageId ?? `a2a-${randomUUID()}`,
        sourceAgentId: input.sourceAgentId,
        targetAgentId: input.targetAgentId,
        ...(input.sourceEndpoint !== undefined ? { sourceEndpoint: input.sourceEndpoint } : {}),
        targetEndpoint: input.targetEndpoint,
        companyId: input.companyId,
        ...(input.targetCompanyId !== undefined ? { targetCompanyId: input.targetCompanyId } : {}),
        delegationDepth: input.delegationDepth,
        dataClassification: input.dataClassification,
        fencingToken: input.fencingToken,
        ...(input.lastKnownFencingToken !== undefined
          ? { lastKnownFencingToken: input.lastKnownFencingToken }
          : {}),
        ttlMs: input.ttlMs ?? this.defaultTtlMs,
        ...(input.nowMs !== undefined ? { nowMs: input.nowMs } : {}),
        ...(input.nonce !== undefined ? { nonce: input.nonce } : {}),
        ...(input.claimedStatus !== undefined ? { claimedStatus: input.claimedStatus } : {}),
        payload: input.payload,
      },
      this.signingSecret
    );

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-A2A-Protocol': envelope.protocolVersion,
      },
      body: JSON.stringify(envelope),
      redirect: 'manual',
    });

    const rawText = await response.text();
    const safeText = redactSensitiveText(rawText, [this.signingSecret]).text;

    if (!response.ok) {
      let parsedError: { readonly error?: string; readonly reasonCode?: string } = {};
      try {
        parsedError = JSON.parse(safeText) as {
          readonly error?: string;
          readonly reasonCode?: string;
        };
      } catch {
        // Non-JSON error body
      }
      return {
        ok: false,
        statusCode: response.status,
        envelope,
        riskDecision,
        error: parsedError.error ?? safeText,
        ...(parsedError.reasonCode !== undefined ? { reasonCode: parsedError.reasonCode } : {}),
      };
    }

    const receipt = JSON.parse(safeText) as A2ADelegationReceipt;
    return {
      ok: true,
      statusCode: response.status,
      envelope,
      riskDecision,
      receipt,
    };
  }
}
