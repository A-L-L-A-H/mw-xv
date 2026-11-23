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

function resolveDelegateUrl(targetEndpoint: string): string {
  const trimmed = targetEndpoint.trim();
  const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withScheme);
  if (parsed.pathname === '/' || parsed.pathname === '') {
    parsed.pathname = '/a2a/delegate';
  }
  return parsed.toString();
}

export class A2AMeshClient {
  private readonly signingSecret: string;
  private readonly riskGate: DesktopRiskGate;
  private readonly fetchFn: A2AFetchFn;
  private readonly defaultTtlMs: number;

  constructor(options: A2AMeshClientOptions) {
    this.signingSecret = options.signingSecret;
    this.riskGate = options.riskGate ?? new DesktopRiskGate();
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
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

    const url = resolveDelegateUrl(input.targetEndpoint);
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-A2A-Protocol': envelope.protocolVersion,
      },
      body: JSON.stringify(envelope),
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
