import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { AccessDeniedError } from '@moonwitness/types';
import type {
  DataClassification,
  DesktopActionKind,
  DesktopCapabilityGrant,
  HumanApprovalToken,
  RiskAuditRecord,
  RiskEvaluationDecision,
  RiskEvaluationRequest,
  RiskTier,
} from './types.js';

const CAPABILITY_REGEX = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@v[1-9][0-9]*$/u;

const RISK_TIER_ORDER: Readonly<Record<RiskTier, number>> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
};

const BASE_ACTION_TIER: Readonly<Record<DesktopActionKind, RiskTier>> = {
  'repo.read': 'R0',
  'repo.search': 'R0',
  'git.status': 'R0',
  'git.diff': 'R0',
  'sidecar.read': 'R0',
  'mcp.read': 'R0',
  'worktree.create': 'R1',
  'worktree.write': 'R1',
  'worktree.test': 'R1',
  'pty.exec_local': 'R1',
  'mcp.local_write': 'R1',
  'git.commit_local': 'R2',
  'sidecar.sync_local': 'R2',
  'service.local_start': 'R2',
  'git.push_remote': 'R3',
  'network.egress': 'R3',
  'cloud.provider_call': 'R3',
  'upstream.sync_push': 'R3',
  'secret.read': 'R4',
  'system.destructive': 'R4',
  'worktree.escape': 'R4',
  'privilege.escalate': 'R4',
};

const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|[/\\])\.env(?:\.[^/\\]+)?$/iu,
  /(?:^|[/\\])\.git(?:[/\\]|$)/iu,
  /(?:^|[/\\])\.ssh(?:[/\\]|$)/iu,
  /(?:^|[/\\])\.aws(?:[/\\]|$)/iu,
  /(?:^|[/\\])(?:\.npmrc|\.netrc|id_rsa|id_ed25519|credentials\.json)$/iu,
  /\.(?:pem|key|p12|pfx)$/iu,
];

const DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(?:\/|~|\.\.)/iu,
  /\b(?:mkfs|dd|fdisk|format|del\s+\/[sq]|rmdir\s+\/s)\b/iu,
  /\b(?:sudo|su|runas|chmod\s+777)\b/iu,
  /\bgit\s+push\s+(?:--force|-f)\b/iu,
  /(?:^|[\s'"/\\(])\.env(?:\.[a-z0-9_.-]+)?(?:$|[\s'"/)])/iu,
  /(?:^|[;&|]\s*)(?:printenv|env)(?:\s|$)/iu,
];

const REMOTE_EGRESS_COMMAND_PATTERNS: readonly RegExp[] = [
  /\bgit\s+push\b/iu,
  /\bgit\s+remote\s+(?:add|set-url)\b/iu,
  /\b(?:curl|wget|Invoke-WebRequest|iwr|ssh|scp|rsync)\b/iu,
];

const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/giu;
const PROVIDER_KEY_PATTERN = /\b(?:sk|ghp|gho|glpat|xoxb|xoxp)-[A-Za-z0-9_-]{10,}\b/gu;
const URL_USERINFO_PATTERN = /(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/giu;
const KV_SECRET_PATTERN =
  /\b(password|passwd|secret|token|credential|api_key|apikey|authorization|x-api-key)\s*[:=]\s*["']?[^\s,;'"}\]]+["']?/giu;
const SENSITIVE_OBJECT_KEY_PATTERN =
  /^(?:authorization|proxy-authorization|x-api-key|api[-_]?key|secret|password|passwd|token|access_token|refresh_token|cookie|set-cookie|credential|credentials)$/iu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function redactSensitiveText(
  input: string,
  knownSecrets: readonly string[] = []
): { readonly text: string; readonly redacted: boolean } {
  let output = input;
  for (const secret of knownSecrets) {
    const trimmed = secret.trim();
    if (trimmed.length >= 6) {
      output = output.replace(new RegExp(escapeRegExp(trimmed), 'g'), '[REDACTED_SECRET]');
    }
  }
  output = output.replace(AUTH_SCHEME_PATTERN, '$1 [REDACTED]');
  output = output.replace(PROVIDER_KEY_PATTERN, '[REDACTED_API_KEY]');
  output = output.replace(URL_USERINFO_PATTERN, '$1[REDACTED]:[REDACTED]@');
  output = output.replace(KV_SECRET_PATTERN, '$1=[REDACTED]');
  return { text: output, redacted: output !== input };
}

export function redactSensitiveValue<T>(
  value: T,
  knownSecrets: readonly string[] = [],
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>()
): { readonly value: T; readonly redacted: boolean } {
  if (typeof value === 'string') {
    const res = redactSensitiveText(value, knownSecrets);
    return { value: res.text as T, redacted: res.redacted };
  }
  if (value === null || typeof value !== 'object') {
    return { value, redacted: false };
  }
  if (depth > 12) {
    return { value: '[MAX_DEPTH]' as T, redacted: true };
  }
  if (seen.has(value)) {
    return { value: '[Circular]' as T, redacted: false };
  }
  seen.add(value);
  let anyRedacted = false;
  if (Array.isArray(value)) {
    const mapped = value.map((item) => {
      const child = redactSensitiveValue(item, knownSecrets, depth + 1, seen);
      if (child.redacted) anyRedacted = true;
      return child.value;
    });
    return { value: mapped as T, redacted: anyRedacted };
  }
  const out: Record<string, unknown> = {};
  for (const [key, propVal] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_OBJECT_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
      anyRedacted = true;
    } else {
      const child = redactSensitiveValue(propVal, knownSecrets, depth + 1, seen);
      if (child.redacted) anyRedacted = true;
      out[key] = child.value;
    }
  }
  return { value: out as T, redacted: anyRedacted };
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === 'ipc.localhost'
  );
}

export function isLoopbackEndpointUrl(endpointUrl: string): boolean {
  try {
    const parsed = new URL(endpointUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ws:') {
      return false;
    }
    if (parsed.username || parsed.password || parsed.hash) return false;
    const host = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (isLoopbackHostname(host)) return true;
    return isIP(host) === 4 && host.startsWith('127.');
  } catch {
    return false;
  }
}

export function isSecretOrSensitivePath(targetPath: string): boolean {
  const normalized = targetPath.replaceAll('\\', '/').trim();
  if (!normalized) return false;
  if (normalized.split('/').includes('..')) return true;
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolveRiskTierForAction(request: {
  readonly action: DesktopActionKind;
  readonly targetPath?: string;
  readonly targetCommand?: string;
  readonly targetEndpointUrl?: string;
}): { readonly requestedTier: RiskTier; readonly resolvedTier: RiskTier } {
  const requestedTier = BASE_ACTION_TIER[request.action];
  let resolvedTier: RiskTier = requestedTier;

  const escalateTo = (tier: RiskTier): void => {
    if (RISK_TIER_ORDER[tier] > RISK_TIER_ORDER[resolvedTier]) {
      resolvedTier = tier;
    }
  };

  if (request.targetPath && isSecretOrSensitivePath(request.targetPath)) {
    escalateTo('R4');
  }

  if (request.targetCommand) {
    if (DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(request.targetCommand ?? ''))) {
      escalateTo('R4');
    } else if (
      REMOTE_EGRESS_COMMAND_PATTERNS.some((pattern) => pattern.test(request.targetCommand ?? ''))
    ) {
      escalateTo('R3');
    }
  }

  if (request.targetEndpointUrl && !isLoopbackEndpointUrl(request.targetEndpointUrl)) {
    escalateTo('R3');
  }

  return { requestedTier, resolvedTier };
}

function isClassificationAllowed(
  requested: DataClassification,
  grantAllowed: DataClassification,
  action: DesktopActionKind,
  targetEndpointUrl?: string
): boolean {
  if (requested === 'restricted') {
    if (grantAllowed !== 'restricted') return false;
    if (action === 'cloud.provider_call' || action === 'network.egress') return false;
    if (targetEndpointUrl && !isLoopbackEndpointUrl(targetEndpointUrl)) return false;
    return true;
  }
  if (requested === 'local_only') {
    if (grantAllowed === 'cloud_eligible') return false;
    if (action === 'cloud.provider_call') return false;
    if (
      action === 'network.egress' &&
      targetEndpointUrl &&
      !isLoopbackEndpointUrl(targetEndpointUrl)
    ) {
      return false;
    }
    return true;
  }
  // cloud_eligible
  return true;
}

function validateGrant(
  grant: DesktopCapabilityGrant,
  request: RiskEvaluationRequest,
  now: Date
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly reason: string } {
  if (grant.status !== 'active') {
    return {
      ok: false,
      code: 'GRANT_INACTIVE',
      reason: `Capability grant '${grant.grantId}' is ${grant.status}`,
    };
  }
  if (grant.revokedAt !== undefined && grant.revokedAt !== null && grant.revokedAt !== '') {
    return {
      ok: false,
      code: 'GRANT_REVOKED',
      reason: `Capability grant '${grant.grantId}' has been revoked`,
    };
  }
  if (grant.companyId !== request.companyId || grant.agentId !== request.agentId) {
    return {
      ok: false,
      code: 'GRANT_SCOPE_MISMATCH',
      reason: 'Capability grant companyId/agentId does not match request context',
    };
  }
  if (
    grant.workContractId !== undefined &&
    grant.workContractId !== null &&
    grant.workContractId !== request.workContractId
  ) {
    return {
      ok: false,
      code: 'GRANT_CONTRACT_MISMATCH',
      reason: 'Capability grant workContractId does not match request context',
    };
  }
  if (!CAPABILITY_REGEX.test(grant.capability)) {
    return {
      ok: false,
      code: 'GRANT_INVALID_CAPABILITY',
      reason: `Capability '${grant.capability}' does not match <domain>.<action>@v<major>`,
    };
  }
  if (grant.policyVersion !== request.expectedPolicyVersion) {
    return {
      ok: false,
      code: 'POLICY_VERSION_MISMATCH',
      reason: `Grant policyVersion ${grant.policyVersion} != expected ${request.expectedPolicyVersion}`,
    };
  }
  const expiresMs = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= now.getTime()) {
    return {
      ok: false,
      code: 'GRANT_EXPIRED',
      reason: `Capability grant '${grant.grantId}' expired at ${grant.expiresAt}`,
    };
  }
  if (!Number.isSafeInteger(grant.maxCallsPerRun) || grant.maxCallsPerRun < 1) {
    return {
      ok: false,
      code: 'GRANT_INVALID_QUOTA',
      reason: 'Capability grant maxCallsPerRun must be a positive integer',
    };
  }
  return { ok: true };
}

export class DesktopRiskGate {
  private readonly quotaUsage = new Map<string, number>();
  private readonly consumedApprovalTokens = new Set<string>();
  private readonly auditLog: RiskAuditRecord[] = [];
  private readonly maxAuditEntries: number;
  private readonly onAudit?: (entry: RiskAuditRecord) => void;

  constructor(options?: {
    readonly maxAuditEntries?: number;
    readonly onAudit?: (entry: RiskAuditRecord) => void;
  }) {
    this.maxAuditEntries = options?.maxAuditEntries ?? 1000;
    this.onAudit = options?.onAudit;
  }

  evaluate(request: RiskEvaluationRequest): RiskEvaluationDecision {
    const now = request.now ?? new Date();
    const { requestedTier, resolvedTier } = resolveRiskTierForAction(request);

    const recordDecision = (
      allowed: boolean,
      reasonCode: string,
      reason: string,
      remainingQuota: number
    ): RiskEvaluationDecision => {
      const entry: RiskAuditRecord = {
        auditId: randomUUID(),
        runId: request.runId,
        action: request.action,
        requestedTier,
        resolvedTier,
        allowed,
        reasonCode,
        reason,
        companyId: request.companyId,
        agentId: request.agentId,
        grantId: request.grant.grantId,
        timestamp: now.toISOString(),
      };
      this.auditLog.push(entry);
      if (this.auditLog.length > this.maxAuditEntries) {
        this.auditLog.shift();
      }
      this.onAudit?.(entry);

      return {
        allowed,
        resolvedTier,
        reasonCode,
        reason,
        requiresHumanApproval: resolvedTier === 'R3',
        remainingQuota,
        auditEntry: entry,
      };
    };

    if (resolvedTier === 'R4') {
      return recordDecision(
        false,
        'RISK_R4_PROHIBITED',
        `Action '${request.action}' resolved to prohibited tier R4`,
        0
      );
    }

    const grantCheck = validateGrant(request.grant, request, now);
    if (!grantCheck.ok) {
      return recordDecision(false, grantCheck.code, grantCheck.reason, 0);
    }

    if (RISK_TIER_ORDER[resolvedTier] > RISK_TIER_ORDER[request.grant.allowedRiskTier]) {
      return recordDecision(
        false,
        'RISK_TIER_EXCEEDED',
        `Resolved risk tier ${resolvedTier} exceeds grant ceiling ${request.grant.allowedRiskTier}`,
        0
      );
    }

    if (
      !isClassificationAllowed(
        request.dataClassification,
        request.grant.allowedClassification,
        request.action,
        request.targetEndpointUrl
      )
    ) {
      return recordDecision(
        false,
        'DATA_CLASSIFICATION_VIOLATION',
        `Data classification '${request.dataClassification}' blocks action '${request.action}' under grant classification '${request.grant.allowedClassification}'`,
        0
      );
    }

    if (request.targetPath && request.grant.allowedPaths && request.grant.allowedPaths.length > 0) {
      const normalizedTarget = request.targetPath.replaceAll('\\', '/').replace(/^\.\//u, '');
      const allowedByPrefix = request.grant.allowedPaths.some((prefix) => {
        const normalizedPrefix = prefix
          .replaceAll('\\', '/')
          .replace(/^\.\//u, '')
          .replace(/\/+$/u, '');
        return (
          normalizedTarget === normalizedPrefix ||
          normalizedTarget.startsWith(`${normalizedPrefix}/`)
        );
      });
      if (!allowedByPrefix) {
        return recordDecision(
          false,
          'GRANT_PATH_SCOPE_DENIED',
          `Path '${request.targetPath}' is outside capability grant allowedPaths`,
          0
        );
      }
    }

    if (resolvedTier === 'R3') {
      const approvalCheck = this.validateHumanApproval(request.humanApproval, request, now);
      if (!approvalCheck.ok) {
        return recordDecision(false, approvalCheck.code, approvalCheck.reason, 0);
      }
    }

    const quotaKey = `${request.runId}::${request.grant.grantId}`;
    const used = this.quotaUsage.get(quotaKey) ?? 0;
    if (used >= request.grant.maxCallsPerRun) {
      return recordDecision(
        false,
        'RUN_QUOTA_EXCEEDED',
        `Run '${request.runId}' exceeded maxCallsPerRun (${request.grant.maxCallsPerRun}) for grant '${request.grant.grantId}'`,
        0
      );
    }

    if (
      resolvedTier === 'R3' &&
      request.humanApproval &&
      request.humanApproval.singleUse !== false
    ) {
      this.consumedApprovalTokens.add(request.humanApproval.tokenId);
    }

    const nextUsed = used + 1;
    this.quotaUsage.set(quotaKey, nextUsed);
    const remaining = Math.max(0, request.grant.maxCallsPerRun - nextUsed);

    return recordDecision(
      true,
      'ALLOWED',
      `Action '${request.action}' authorized at risk tier ${resolvedTier}`,
      remaining
    );
  }

  assertAllowed(request: RiskEvaluationRequest): RiskEvaluationDecision {
    const decision = this.evaluate(request);
    if (!decision.allowed) {
      throw new AccessDeniedError(decision.reason, {
        code: 'access_denied',
        details: {
          reasonCode: decision.reasonCode,
          resolvedTier: decision.resolvedTier,
          action: request.action,
          runId: request.runId,
        },
      });
    }
    return decision;
  }

  getAuditLog(limit = 100): readonly RiskAuditRecord[] {
    if (limit <= 0) return [];
    return this.auditLog.slice(-limit);
  }

  getUsageCount(runId: string, grantId: string): number {
    return this.quotaUsage.get(`${runId}::${grantId}`) ?? 0;
  }

  private validateHumanApproval(
    token: HumanApprovalToken | undefined,
    request: RiskEvaluationRequest,
    now: Date
  ):
    { readonly ok: true } | { readonly ok: false; readonly code: string; readonly reason: string } {
    if (!token) {
      return {
        ok: false,
        code: 'HUMAN_APPROVAL_REQUIRED',
        reason: `Risk tier R3 action '${request.action}' requires a HumanApprovalToken`,
      };
    }
    if (this.consumedApprovalTokens.has(token.tokenId)) {
      return {
        ok: false,
        code: 'HUMAN_APPROVAL_REPLAYED',
        reason: `Human approval token '${token.tokenId}' has already been consumed`,
      };
    }
    if (!Number.isSafeInteger(token.approvedByUserId) || token.approvedByUserId <= 0) {
      return {
        ok: false,
        code: 'HUMAN_APPROVAL_INVALID_ACTOR',
        reason: 'Human approval token must identify an approving userId',
      };
    }
    if (token.action !== request.action || token.runId !== request.runId) {
      return {
        ok: false,
        code: 'HUMAN_APPROVAL_SCOPE_MISMATCH',
        reason: `Human approval token scope (${token.action}/${token.runId}) does not match request (${request.action}/${request.runId})`,
      };
    }
    const expiresMs = Date.parse(token.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= now.getTime()) {
      return {
        ok: false,
        code: 'HUMAN_APPROVAL_EXPIRED',
        reason: `Human approval token '${token.tokenId}' is expired`,
      };
    }
    return { ok: true };
  }
}
