import type { JsonObject } from '@moonwitness/types';
import { createRedactor, type RedactionContext } from './redaction.js';
import type { Clock, TokenUsage } from './types.js';
import { SYSTEM_CLOCK } from './types.js';

export type RiskTier = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export const RISK_TIER_ORDER: Readonly<Record<RiskTier, number>> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
};

export type RiskAutonomyLevel =
  | 'autonomous'
  | 'bounded_internal_write'
  | 'verified_internal_mutation'
  | 'human_approved_external_effect'
  | 'prohibited';

export interface RiskTierPolicyRule {
  readonly tier: RiskTier;
  readonly autonomy: RiskAutonomyLevel;
  readonly requiresHumanApproval: boolean;
  readonly requiresIndependentVerification: boolean;
  readonly prohibited: boolean;
  readonly allowedInReadOnly: boolean;
  readonly description: string;
  readonly examples: readonly string[];
}

export const RISK_TIER_POLICY_MATRIX: Readonly<Record<RiskTier, RiskTierPolicyRule>> = {
  R0: {
    tier: 'R0',
    autonomy: 'autonomous',
    requiresHumanApproval: false,
    requiresIndependentVerification: false,
    prohibited: false,
    allowedInReadOnly: true,
    description: 'Read-only inspection, retrieval, and analysis within allowlisted scope.',
    examples: ['repo_read_file', 'repo_list_files', 'mw_work_contract_read'],
  },
  R1: {
    tier: 'R1',
    autonomy: 'bounded_internal_write',
    requiresHumanApproval: false,
    requiresIndependentVerification: true,
    prohibited: false,
    allowedInReadOnly: false,
    description: 'Reversible internal write within isolated worktree or append-only domain note.',
    examples: ['mw_work_contract_append_note', 'worktree_file_edit', 'unit_test_run'],
  },
  R2: {
    tier: 'R2',
    autonomy: 'verified_internal_mutation',
    requiresHumanApproval: false,
    requiresIndependentVerification: true,
    prohibited: false,
    allowedInReadOnly: false,
    description: 'Significant internal workflow mutation, local commit, or multi-agent plan.',
    examples: ['worktree_git_commit', 'workflow_transition', 'memory_candidate_promote'],
  },
  R3: {
    tier: 'R3',
    autonomy: 'human_approved_external_effect',
    requiresHumanApproval: true,
    requiresIndependentVerification: true,
    prohibited: false,
    allowedInReadOnly: false,
    description:
      'External side effect, remote network egress, or destructive mutation requiring human sign-off.',
    examples: ['git_remote_push', 'external_webhook_dispatch', 'production_deploy'],
  },
  R4: {
    tier: 'R4',
    autonomy: 'prohibited',
    requiresHumanApproval: true,
    requiresIndependentVerification: true,
    prohibited: true,
    allowedInReadOnly: false,
    description:
      'Prohibited action: secret exfiltration, live policy/grant self-modification, superadmin escalation, unrestricted shell.',
    examples: [
      'secret_read',
      'live_policy_self_modify',
      'superadmin_impersonation',
      'unrestricted_shell',
    ],
  },
};

export interface HumanApprovalToken {
  readonly tokenId: string;
  readonly companyId: number;
  readonly runId: string;
  readonly actionDigest: string;
  readonly approvedByUserId: number | string;
  readonly approvedByRole: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revoked?: boolean;
}

export interface EmergencyStopRecord {
  readonly scope: 'global' | 'company' | 'agent' | 'provider';
  readonly targetKey: string;
  readonly reason: string;
  readonly activatedBy: string;
  readonly activatedAt: string;
  readonly active: boolean;
  readonly clearedAt?: string;
  readonly clearedBy?: string;
}

export class EmergencyStopController {
  private readonly clock: Clock;
  private readonly activeStops = new Map<string, EmergencyStopRecord>();
  private readonly history: EmergencyStopRecord[] = [];

  constructor(clock: Clock = SYSTEM_CLOCK) {
    this.clock = clock;
  }

  private static makeKey(scope: EmergencyStopRecord['scope'], targetId: string | number): string {
    return `${scope}:${String(targetId)}`;
  }

  activateStop(params: {
    readonly scope: EmergencyStopRecord['scope'];
    readonly targetId?: string | number;
    readonly reason: string;
    readonly activatedBy: string;
  }): EmergencyStopRecord {
    const key =
      params.scope === 'global'
        ? 'global:*'
        : EmergencyStopController.makeKey(params.scope, params.targetId ?? '');
    const record: EmergencyStopRecord = {
      scope: params.scope,
      targetKey: key,
      reason: params.reason,
      activatedBy: params.activatedBy,
      activatedAt: new Date(this.clock.now()).toISOString(),
      active: true,
    };
    this.activeStops.set(key, record);
    this.history.push(record);
    return record;
  }

  clearStop(params: {
    readonly scope: EmergencyStopRecord['scope'];
    readonly targetId?: string | number;
    readonly clearedBy: string;
  }): boolean {
    const key =
      params.scope === 'global'
        ? 'global:*'
        : EmergencyStopController.makeKey(params.scope, params.targetId ?? '');
    const existing = this.activeStops.get(key);
    if (!existing) return false;
    this.activeStops.delete(key);
    this.history.push({
      ...existing,
      active: false,
      clearedAt: new Date(this.clock.now()).toISOString(),
      clearedBy: params.clearedBy,
    });
    return true;
  }

  checkStopped(params: {
    readonly companyId?: number;
    readonly agentId?: number | string;
    readonly providerId?: string;
  }): { readonly stopped: boolean; readonly record?: EmergencyStopRecord } {
    const globalStop = this.activeStops.get('global:*');
    if (globalStop) return { stopped: true, record: globalStop };

    if (params.companyId !== undefined) {
      const companyStop = this.activeStops.get(
        EmergencyStopController.makeKey('company', params.companyId)
      );
      if (companyStop) return { stopped: true, record: companyStop };
    }
    if (params.agentId !== undefined) {
      const agentStop = this.activeStops.get(
        EmergencyStopController.makeKey('agent', params.agentId)
      );
      if (agentStop) return { stopped: true, record: agentStop };
    }
    if (params.providerId !== undefined) {
      const providerStop = this.activeStops.get(
        EmergencyStopController.makeKey('provider', params.providerId)
      );
      if (providerStop) return { stopped: true, record: providerStop };
    }
    return { stopped: false };
  }

  getHistory(): readonly EmergencyStopRecord[] {
    return [...this.history];
  }
}

export interface RiskPolicyCheckInput {
  readonly companyId: number;
  readonly runId: string;
  readonly agentId?: number | string;
  readonly providerId?: string;
  readonly requestedTier: RiskTier;
  readonly policyMaxRiskTier: RiskTier;
  readonly actionDigest: string;
  readonly readOnlyMode?: boolean;
  readonly requireConfirmationForR2?: boolean;
  readonly humanApprovalToken?: HumanApprovalToken;
  readonly emergencyStopController?: EmergencyStopController;
  readonly nowMs?: number;
}

export type RiskPolicyDecision =
  | {
      readonly allowed: true;
      readonly tier: RiskTier;
      readonly rule: RiskTierPolicyRule;
      readonly verifiedHumanTokenId?: string;
    }
  | {
      readonly allowed: false;
      readonly tier: RiskTier;
      readonly reasonCode:
        | 'EMERGENCY_STOP_ACTIVE'
        | 'PROHIBITED_RISK_TIER_R4'
        | 'RISK_TIER_EXCEEDS_POLICY'
        | 'READ_ONLY_MODE_DENIED'
        | 'HUMAN_APPROVAL_REQUIRED'
        | 'INVALID_HUMAN_APPROVAL_TOKEN';
      readonly message: string;
    };

export function validateHumanApprovalToken(
  token: HumanApprovalToken,
  expected: {
    readonly companyId: number;
    readonly runId: string;
    readonly actionDigest: string;
    readonly nowMs: number;
  }
): { readonly valid: true } | { readonly valid: false; readonly message: string } {
  if (token.revoked) {
    return { valid: false, message: `Human approval token "${token.tokenId}" has been revoked` };
  }
  if (token.companyId !== expected.companyId) {
    return { valid: false, message: 'Human approval token company mismatch' };
  }
  if (token.runId !== expected.runId) {
    return { valid: false, message: 'Human approval token runId mismatch' };
  }
  if (token.actionDigest !== expected.actionDigest) {
    return { valid: false, message: 'Human approval token actionDigest mismatch' };
  }
  const roleLower = token.approvedByRole.trim().toLowerCase();
  if (
    !roleLower ||
    roleLower === 'agent' ||
    roleLower === 'service_account' ||
    roleLower === 'system'
  ) {
    return {
      valid: false,
      message: `Human approval requires a human role, got "${token.approvedByRole}"`,
    };
  }
  const expiresMs = Date.parse(token.expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= expected.nowMs) {
    return { valid: false, message: `Human approval token "${token.tokenId}" is expired` };
  }
  return { valid: true };
}

export function evaluateRiskTierPolicy(input: RiskPolicyCheckInput): RiskPolicyDecision {
  const nowMs = input.nowMs ?? Date.now();
  const stopCheck = input.emergencyStopController?.checkStopped({
    companyId: input.companyId,
    agentId: input.agentId,
    providerId: input.providerId,
  });
  if (stopCheck?.stopped && stopCheck.record) {
    return {
      allowed: false,
      tier: input.requestedTier,
      reasonCode: 'EMERGENCY_STOP_ACTIVE',
      message: `Emergency stop active (${stopCheck.record.scope}): ${stopCheck.record.reason}`,
    };
  }

  const rule = RISK_TIER_POLICY_MATRIX[input.requestedTier];
  if (rule.prohibited) {
    return {
      allowed: false,
      tier: input.requestedTier,
      reasonCode: 'PROHIBITED_RISK_TIER_R4',
      message: `Risk tier R4 actions are unconditionally prohibited: ${rule.description}`,
    };
  }

  if (input.readOnlyMode && !rule.allowedInReadOnly) {
    return {
      allowed: false,
      tier: input.requestedTier,
      reasonCode: 'READ_ONLY_MODE_DENIED',
      message: `Risk tier ${input.requestedTier} is blocked in read-only execution mode`,
    };
  }

  if (RISK_TIER_ORDER[input.requestedTier] > RISK_TIER_ORDER[input.policyMaxRiskTier]) {
    return {
      allowed: false,
      tier: input.requestedTier,
      reasonCode: 'RISK_TIER_EXCEEDS_POLICY',
      message: `Requested risk tier ${input.requestedTier} exceeds execution policy ceiling ${input.policyMaxRiskTier}`,
    };
  }

  const needsHumanToken =
    rule.requiresHumanApproval ||
    (input.requestedTier === 'R2' && input.requireConfirmationForR2 === true);

  if (needsHumanToken) {
    if (!input.humanApprovalToken) {
      return {
        allowed: false,
        tier: input.requestedTier,
        reasonCode: 'HUMAN_APPROVAL_REQUIRED',
        message: `Risk tier ${input.requestedTier} requires a valid human approval token`,
      };
    }
    const tokenCheck = validateHumanApprovalToken(input.humanApprovalToken, {
      companyId: input.companyId,
      runId: input.runId,
      actionDigest: input.actionDigest,
      nowMs,
    });
    if (!tokenCheck.valid) {
      return {
        allowed: false,
        tier: input.requestedTier,
        reasonCode: 'INVALID_HUMAN_APPROVAL_TOKEN',
        message: tokenCheck.message,
      };
    }
    return {
      allowed: true,
      tier: input.requestedTier,
      rule,
      verifiedHumanTokenId: input.humanApprovalToken.tokenId,
    };
  }

  return {
    allowed: true,
    tier: input.requestedTier,
    rule,
  };
}

export type GenAiEventStage =
  'request' | 'job' | 'run' | 'provider' | 'tool' | 'artifact' | 'verifier';

export interface GenAiTelemetryEvent {
  readonly stage: GenAiEventStage;
  readonly eventName: string;
  readonly timestamp: string;
  readonly companyId: number;
  readonly correlationId: string;
  readonly requestId?: string;
  readonly jobId?: number | string;
  readonly runId?: string;
  readonly providerId?: string;
  readonly toolName?: string;
  readonly artifactId?: string;
  readonly status?: 'ok' | 'denied' | 'failed' | 'retrying' | 'cancelled' | 'in_progress';
  readonly durationMs?: number;
  readonly queueWaitMs?: number;
  readonly retryCount?: number;
  readonly failureClass?: string;
  readonly usage?: TokenUsage;
  readonly metadata?: JsonObject;
}

export interface GenAiAlertRuleThresholds {
  readonly maxQueueWaitMs?: number;
  readonly maxRetryCount?: number;
  readonly maxTotalCostMicros?: number;
  readonly maxProviderOutages?: number;
  readonly maxDeniedTools?: number;
}

export interface GenAiAlert {
  readonly code:
    'STUCK_JOB' | 'RETRY_STORM' | 'BUDGET_EXHAUSTION' | 'PROVIDER_OUTAGE' | 'POLICY_DENIAL_SPIKE';
  readonly severity: 'warning' | 'critical';
  readonly message: string;
  readonly observedValue: number;
  readonly thresholdValue: number;
}

export interface GenAiTelemetryMetrics {
  readonly totalEvents: number;
  readonly deniedToolCalls: number;
  readonly retryEvents: number;
  readonly providerOutages: number;
  readonly maxQueueWaitMs: number;
  readonly totalEstimatedCostMicros: number;
  readonly providerReportedTokens: number;
  readonly estimatedTokens: number;
  readonly avgProviderLatencyMs: number;
}

export class GenAiTelemetryCollector {
  private readonly events: GenAiTelemetryEvent[] = [];
  private readonly redactor: RedactionContext;
  private readonly clock: Clock;

  constructor(options?: { readonly redactor?: RedactionContext; readonly clock?: Clock }) {
    this.redactor = options?.redactor ?? createRedactor();
    this.clock = options?.clock ?? SYSTEM_CLOCK;
  }

  record(
    event: Omit<GenAiTelemetryEvent, 'timestamp'> & { readonly timestamp?: string }
  ): GenAiTelemetryEvent {
    const sanitized: GenAiTelemetryEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date(this.clock.now()).toISOString(),
      eventName: this.redactor.redactString(event.eventName),
      failureClass: event.failureClass ? this.redactor.redactString(event.failureClass) : undefined,
      metadata: event.metadata ? this.redactor.redactObject(event.metadata) : undefined,
    };
    this.events.push(sanitized);
    return sanitized;
  }

  getEvents(): readonly GenAiTelemetryEvent[] {
    return [...this.events];
  }

  computeMetrics(): GenAiTelemetryMetrics {
    let deniedToolCalls = 0;
    let retryEvents = 0;
    let providerOutages = 0;
    let maxQueueWaitMs = 0;
    let totalEstimatedCostMicros = 0;
    let providerReportedTokens = 0;
    let estimatedTokens = 0;
    let providerLatencySum = 0;
    let providerLatencyCount = 0;

    for (const event of this.events) {
      if (event.stage === 'tool' && event.status === 'denied') deniedToolCalls += 1;
      if (event.status === 'retrying' || (event.retryCount !== undefined && event.retryCount > 0)) {
        retryEvents += 1;
      }
      if (event.stage === 'provider' && event.failureClass === 'outage') {
        providerOutages += 1;
      }
      if (event.queueWaitMs !== undefined && event.queueWaitMs > maxQueueWaitMs) {
        maxQueueWaitMs = event.queueWaitMs;
      }
      if (event.usage) {
        totalEstimatedCostMicros += event.usage.estimatedCostMicros;
        if (event.usage.source === 'provider_reported') {
          providerReportedTokens += event.usage.totalTokens;
        } else {
          estimatedTokens += event.usage.totalTokens;
        }
      }
      if (event.stage === 'provider' && event.durationMs !== undefined) {
        providerLatencySum += event.durationMs;
        providerLatencyCount += 1;
      }
    }

    return {
      totalEvents: this.events.length,
      deniedToolCalls,
      retryEvents,
      providerOutages,
      maxQueueWaitMs,
      totalEstimatedCostMicros,
      providerReportedTokens,
      estimatedTokens,
      avgProviderLatencyMs:
        providerLatencyCount > 0 ? Math.round(providerLatencySum / providerLatencyCount) : 0,
    };
  }

  evaluateAlerts(thresholds: GenAiAlertRuleThresholds): readonly GenAiAlert[] {
    const metrics = this.computeMetrics();
    const alerts: GenAiAlert[] = [];

    if (
      thresholds.maxQueueWaitMs !== undefined &&
      metrics.maxQueueWaitMs > thresholds.maxQueueWaitMs
    ) {
      alerts.push({
        code: 'STUCK_JOB',
        severity: 'warning',
        message: `Queue wait ${metrics.maxQueueWaitMs}ms exceeded threshold ${thresholds.maxQueueWaitMs}ms`,
        observedValue: metrics.maxQueueWaitMs,
        thresholdValue: thresholds.maxQueueWaitMs,
      });
    }
    if (thresholds.maxRetryCount !== undefined && metrics.retryEvents > thresholds.maxRetryCount) {
      alerts.push({
        code: 'RETRY_STORM',
        severity: 'critical',
        message: `Retry events (${metrics.retryEvents}) exceeded threshold (${thresholds.maxRetryCount})`,
        observedValue: metrics.retryEvents,
        thresholdValue: thresholds.maxRetryCount,
      });
    }
    if (
      thresholds.maxTotalCostMicros !== undefined &&
      metrics.totalEstimatedCostMicros > thresholds.maxTotalCostMicros
    ) {
      alerts.push({
        code: 'BUDGET_EXHAUSTION',
        severity: 'critical',
        message: `Estimated cost ${metrics.totalEstimatedCostMicros} micros exceeded budget ${thresholds.maxTotalCostMicros}`,
        observedValue: metrics.totalEstimatedCostMicros,
        thresholdValue: thresholds.maxTotalCostMicros,
      });
    }
    if (
      thresholds.maxProviderOutages !== undefined &&
      metrics.providerOutages > thresholds.maxProviderOutages
    ) {
      alerts.push({
        code: 'PROVIDER_OUTAGE',
        severity: 'critical',
        message: `Provider outages (${metrics.providerOutages}) exceeded threshold (${thresholds.maxProviderOutages})`,
        observedValue: metrics.providerOutages,
        thresholdValue: thresholds.maxProviderOutages,
      });
    }
    if (
      thresholds.maxDeniedTools !== undefined &&
      metrics.deniedToolCalls > thresholds.maxDeniedTools
    ) {
      alerts.push({
        code: 'POLICY_DENIAL_SPIKE',
        severity: 'warning',
        message: `Denied tool calls (${metrics.deniedToolCalls}) exceeded threshold (${thresholds.maxDeniedTools})`,
        observedValue: metrics.deniedToolCalls,
        thresholdValue: thresholds.maxDeniedTools,
      });
    }

    return alerts;
  }
}
