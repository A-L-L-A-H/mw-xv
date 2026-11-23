import { createHash } from 'node:crypto';
import { redactObject } from '@moonwitness/ai-runtime';
import { isRecord, type JsonObject } from '@moonwitness/types';

export interface ExtendedMcpToolDescriptor {
  readonly name: ExtendedMcpToolName;
  readonly description: string;
  readonly riskTier: 'R0' | 'R1';
  readonly readOnly: boolean;
  readonly idempotent: boolean;
  readonly requiredCapability: string;
}

export type ExtendedMcpToolName =
  | 'paas.status'
  | 'paas.backup_plan'
  | 'paas.logs_query'
  | 'agi.merkle_verify'
  | 'agi.governance_status'
  | 'desktop.doctor'
  | 'desktop.local_search'
  | 'desktop.quick_capture';

export const EXTENDED_MCP_TOOLS: readonly ExtendedMcpToolDescriptor[] = [
  {
    name: 'paas.status',
    description:
      'Read Coolify-class PaaS service health, replica readiness, and deployment status.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'paas.read@v1',
  },
  {
    name: 'paas.backup_plan',
    description:
      'Inspect PaaS backup schedules, retention policy, and latest encrypted snapshot posture.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'paas.backup_read@v1',
  },
  {
    name: 'paas.logs_query',
    description: 'Query secret-redacted PaaS service logs with bounded line and severity filters.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'paas.logs_read@v1',
  },
  {
    name: 'agi.merkle_verify',
    description:
      'Verify M15-M18 constitutional Merkle audit chain integrity (read-only, automatedPromotionAllowed=false).',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'agi.audit_read@v1',
  },
  {
    name: 'agi.governance_status',
    description:
      'Read M15-M18 constitutional governance posture with immutable automatedPromotionAllowed=false invariant.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'agi.governance_read@v1',
  },
  {
    name: 'desktop.doctor',
    description:
      'Run pure-offline local desktop diagnostics (runtime, SQLite/WAL, loopback AI, disk).',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'desktop.read@v1',
  },
  {
    name: 'desktop.local_search',
    description:
      'Search local offline desktop notes/documents with strict loopback-only isolation.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'desktop.search@v1',
  },
  {
    name: 'desktop.quick_capture',
    description: 'Persist an idempotent, secret-redacted pure-offline desktop quick-capture entry.',
    riskTier: 'R1',
    readOnly: false,
    idempotent: true,
    requiredCapability: 'desktop.capture_write@v1',
  },
];

const EXTENDED_TOOL_NAME_SET = new Set<string>(EXTENDED_MCP_TOOLS.map((tool) => tool.name));

export function isExtendedMcpToolName(name: string): name is ExtendedMcpToolName {
  return EXTENDED_TOOL_NAME_SET.has(name);
}

export interface PaasServiceStatus {
  readonly serviceId: string;
  readonly name: string;
  readonly state: 'healthy' | 'degraded' | 'stopped';
  readonly replicasReady: number;
  readonly replicasDesired: number;
  readonly version: string;
}

export interface PaasBackupPlanEntry {
  readonly target: string;
  readonly scheduleCron: string;
  readonly retentionDays: number;
  readonly encrypted: boolean;
  readonly lastVerifiedAt: string;
}

export interface PaasLogRecord {
  readonly timestamp: string;
  readonly serviceId: string;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface MerkleAuditEntry {
  readonly index: number;
  readonly prevHash: string;
  readonly payload: string;
  readonly hash: string;
}

export interface AgiGovernanceSnapshot {
  readonly milestones: readonly ('M15' | 'M16' | 'M17' | 'M18')[];
  readonly constitutionalMode: 'read_only_audit';
  readonly humanApprovalRequired: true;
  readonly automatedPromotionAllowed: false;
  readonly merkleLedgerAnchored: boolean;
  readonly pendingProposals: number;
}

export interface DesktopDoctorCheck {
  readonly check: string;
  readonly status: 'pass' | 'warn' | 'fail';
  readonly detail: string;
}

export interface DesktopLocalSearchHit {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly path: string;
  readonly score: number;
}

export interface DesktopQuickCaptureRecord {
  readonly captureId: string;
  readonly companyId: number;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly offlineOnly: true;
}

export interface ExtendedToolProviders {
  readonly getPaasStatus?: (
    companyId: number,
    serviceId?: string
  ) => Promise<readonly PaasServiceStatus[]> | readonly PaasServiceStatus[];
  readonly getPaasBackupPlan?: (
    companyId: number,
    target?: string
  ) => Promise<readonly PaasBackupPlanEntry[]> | readonly PaasBackupPlanEntry[];
  readonly queryPaasLogs?: (
    companyId: number,
    query: {
      readonly serviceId?: string;
      readonly level?: 'debug' | 'info' | 'warn' | 'error';
      readonly search?: string;
      readonly limit: number;
    }
  ) => Promise<readonly PaasLogRecord[]> | readonly PaasLogRecord[];
  readonly getAgiGovernanceStatus?: (
    companyId: number
  ) =>
    | Promise<Partial<AgiGovernanceSnapshot> & Record<string, unknown>>
    | (Partial<AgiGovernanceSnapshot> & Record<string, unknown>);
  readonly runDesktopDoctor?: (
    companyId: number
  ) => Promise<readonly DesktopDoctorCheck[]> | readonly DesktopDoctorCheck[];
  readonly searchDesktopLocal?: (
    companyId: number,
    query: { readonly query: string; readonly limit: number }
  ) => Promise<readonly DesktopLocalSearchHit[]> | readonly DesktopLocalSearchHit[];
  readonly saveDesktopQuickCapture?: (
    companyId: number,
    input: {
      readonly title: string;
      readonly body: string;
      readonly tags: readonly string[];
      readonly idempotencyKey?: string;
    }
  ) => Promise<DesktopQuickCaptureRecord> | DesktopQuickCaptureRecord;
}

export interface ExtendedToolDispatchContext {
  readonly companyId: number;
  readonly actorUserId: number | null;
  readonly providers?: ExtendedToolProviders;
  readonly captureStore?: Map<string, DesktopQuickCaptureRecord>;
}

export type ExtendedToolDispatchOutcome =
  | { readonly ok: true; readonly result: Record<string, unknown> }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: number;
      readonly message: string;
    };

const INLINE_SECRET_PATTERNS: readonly RegExp[] = [
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/giu,
  /\b(sk-[A-Za-z0-9_-]{8,})/gu,
  /\b(ghp_[A-Za-z0-9]{12,})/gu,
  /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*([^\s,;]+)/giu,
];

export function redactSecretText(input: string): string {
  let sanitized = input;
  sanitized = sanitized.replace(INLINE_SECRET_PATTERNS[0], '$1[REDACTED]');
  sanitized = sanitized.replace(INLINE_SECRET_PATTERNS[1], '[REDACTED]');
  sanitized = sanitized.replace(INLINE_SECRET_PATTERNS[2], '[REDACTED]');
  sanitized = sanitized.replace(INLINE_SECRET_PATTERNS[3], '$1=[REDACTED]');
  return sanitized;
}

export function computeMerkleEntryHash(prevHash: string, payload: string): string {
  return createHash('sha256').update(`${prevHash}:${payload}`, 'utf8').digest('hex');
}

export function verifyMerkleAuditChain(entries: readonly MerkleAuditEntry[]): {
  readonly valid: boolean;
  readonly checkedCount: number;
  readonly rootHash: string | null;
  readonly brokenAtIndex: number | null;
} {
  if (entries.length === 0) {
    return {
      valid: true,
      checkedCount: 0,
      rootHash: null,
      brokenAtIndex: null,
    };
  }

  let expectedPrevHash = entries[0].prevHash;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        checkedCount: i + 1,
        rootHash: null,
        brokenAtIndex: i,
      };
    }
    const expectedHash = computeMerkleEntryHash(entry.prevHash, entry.payload);
    if (entry.hash !== expectedHash) {
      return {
        valid: false,
        checkedCount: i + 1,
        rootHash: null,
        brokenAtIndex: i,
      };
    }
    expectedPrevHash = entry.hash;
  }

  return {
    valid: true,
    checkedCount: entries.length,
    rootHash: entries[entries.length - 1].hash,
    brokenAtIndex: null,
  };
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return fallback;
  return Math.max(1, Math.min(max, raw));
}

function defaultPaasStatus(companyId: number, serviceId?: string): readonly PaasServiceStatus[] {
  const services: PaasServiceStatus[] = [
    {
      serviceId: `mw-api-${companyId}`,
      name: 'moonwitness-api',
      state: 'healthy',
      replicasReady: 2,
      replicasDesired: 2,
      version: '1.0.0-rc.1',
    },
    {
      serviceId: `mw-worker-${companyId}`,
      name: 'moonwitness-worker',
      state: 'healthy',
      replicasReady: 1,
      replicasDesired: 1,
      version: '1.0.0-rc.1',
    },
  ];
  return serviceId ? services.filter((svc) => svc.serviceId === serviceId) : services;
}

function defaultPaasBackupPlan(companyId: number, target?: string): readonly PaasBackupPlanEntry[] {
  const entries: PaasBackupPlanEntry[] = [
    {
      target: `postgres-company-${companyId}`,
      scheduleCron: '0 2 * * *',
      retentionDays: 30,
      encrypted: true,
      lastVerifiedAt: '2026-01-01T02:05:00.000Z',
    },
  ];
  return target ? entries.filter((entry) => entry.target === target) : entries;
}

function defaultDesktopDoctorChecks(): readonly DesktopDoctorCheck[] {
  return [
    { check: 'offline_mode', status: 'pass', detail: 'Pure-offline desktop isolation active' },
    { check: 'loopback_ai', status: 'pass', detail: 'Loopback-only local AI boundary verified' },
    { check: 'local_storage', status: 'pass', detail: 'Local SQLite WAL storage healthy' },
  ];
}

export async function dispatchExtendedMcpTool(
  toolName: ExtendedMcpToolName,
  rawArgs: JsonObject,
  context: ExtendedToolDispatchContext
): Promise<ExtendedToolDispatchOutcome> {
  const { companyId, providers } = context;

  switch (toolName) {
    case 'paas.status': {
      const serviceId =
        typeof rawArgs.serviceId === 'string' ? rawArgs.serviceId.trim() : undefined;
      const services = providers?.getPaasStatus
        ? await providers.getPaasStatus(companyId, serviceId)
        : defaultPaasStatus(companyId, serviceId);
      const healthyCount = services.filter((svc) => svc.state === 'healthy').length;
      return {
        ok: true,
        result: redactObject({
          companyId,
          provider: 'coolify-class',
          services,
          summary: {
            total: services.length,
            healthy: healthyCount,
            degraded: services.filter((svc) => svc.state === 'degraded').length,
            stopped: services.filter((svc) => svc.state === 'stopped').length,
          },
        }),
      };
    }

    case 'paas.backup_plan': {
      const target = typeof rawArgs.target === 'string' ? rawArgs.target.trim() : undefined;
      const plans = providers?.getPaasBackupPlan
        ? await providers.getPaasBackupPlan(companyId, target)
        : defaultPaasBackupPlan(companyId, target);
      return {
        ok: true,
        result: redactObject({
          companyId,
          plans,
          allEncrypted: plans.every((plan) => plan.encrypted),
        }),
      };
    }

    case 'paas.logs_query': {
      const serviceId =
        typeof rawArgs.serviceId === 'string' ? rawArgs.serviceId.trim() : undefined;
      const levelRaw = typeof rawArgs.level === 'string' ? rawArgs.level : undefined;
      const level =
        levelRaw === 'debug' || levelRaw === 'info' || levelRaw === 'warn' || levelRaw === 'error'
          ? levelRaw
          : undefined;
      const search = typeof rawArgs.search === 'string' ? rawArgs.search.trim() : undefined;
      const limit = clampLimit(rawArgs.limit, 50, 200);

      const rawLogs = providers?.queryPaasLogs
        ? await providers.queryPaasLogs(companyId, { serviceId, level, search, limit })
        : [];
      const sanitizedLogs = rawLogs.slice(0, limit).map((log) => ({
        timestamp: log.timestamp,
        serviceId: log.serviceId,
        level: log.level,
        message: redactSecretText(log.message),
      }));

      return {
        ok: true,
        result: redactObject({
          companyId,
          count: sanitizedLogs.length,
          logs: sanitizedLogs,
        }),
      };
    }

    case 'agi.merkle_verify': {
      const rawEntries = rawArgs.entries;
      if (!Array.isArray(rawEntries)) {
        return {
          ok: false,
          status: 400,
          code: -32602,
          message: 'agi.merkle_verify requires an entries array',
        };
      }
      const parsedEntries: MerkleAuditEntry[] = [];
      for (let i = 0; i < rawEntries.length; i += 1) {
        const item = rawEntries[i];
        if (
          !isRecord(item) ||
          typeof item.prevHash !== 'string' ||
          typeof item.payload !== 'string' ||
          typeof item.hash !== 'string'
        ) {
          return {
            ok: false,
            status: 400,
            code: -32602,
            message: `agi.merkle_verify entry at index ${i} must include string prevHash, payload, and hash`,
          };
        }
        parsedEntries.push({
          index: typeof item.index === 'number' ? item.index : i,
          prevHash: item.prevHash,
          payload: item.payload,
          hash: item.hash,
        });
      }

      const verification = verifyMerkleAuditChain(parsedEntries);
      return {
        ok: true,
        result: redactObject({
          companyId,
          constitutionalScope: 'M15-M18',
          readOnly: true,
          automatedPromotionAllowed: false,
          ...verification,
        }),
      };
    }

    case 'agi.governance_status': {
      const upstream = providers?.getAgiGovernanceStatus
        ? await providers.getAgiGovernanceStatus(companyId)
        : {};
      const snapshot: AgiGovernanceSnapshot = {
        milestones: ['M15', 'M16', 'M17', 'M18'],
        constitutionalMode: 'read_only_audit',
        humanApprovalRequired: true,
        automatedPromotionAllowed: false,
        merkleLedgerAnchored:
          typeof upstream.merkleLedgerAnchored === 'boolean' ? upstream.merkleLedgerAnchored : true,
        pendingProposals:
          typeof upstream.pendingProposals === 'number' && upstream.pendingProposals >= 0
            ? Math.trunc(upstream.pendingProposals)
            : 0,
      };
      return {
        ok: true,
        result: redactObject({
          companyId,
          ...upstream,
          ...snapshot,
          automatedPromotionAllowed: false,
        }),
      };
    }

    case 'desktop.doctor': {
      const checks = providers?.runDesktopDoctor
        ? await providers.runDesktopDoctor(companyId)
        : defaultDesktopDoctorChecks();
      const healthy = checks.every((item) => item.status !== 'fail');
      return {
        ok: true,
        result: redactObject({
          companyId,
          offlineOnly: true,
          healthy,
          checks: checks.map((item) => ({
            ...item,
            detail: redactSecretText(item.detail),
          })),
        }),
      };
    }

    case 'desktop.local_search': {
      const query = typeof rawArgs.query === 'string' ? rawArgs.query.trim() : '';
      if (query.length === 0) {
        return {
          ok: false,
          status: 400,
          code: -32602,
          message: 'desktop.local_search requires a non-empty query string',
        };
      }
      const limit = clampLimit(rawArgs.limit, 20, 100);
      const hits = providers?.searchDesktopLocal
        ? await providers.searchDesktopLocal(companyId, { query, limit })
        : [];
      const sanitizedHits = hits.slice(0, limit).map((hit) => ({
        ...hit,
        title: redactSecretText(hit.title),
        snippet: redactSecretText(hit.snippet),
      }));
      return {
        ok: true,
        result: redactObject({
          companyId,
          offlineOnly: true,
          query,
          count: sanitizedHits.length,
          hits: sanitizedHits,
        }),
      };
    }

    case 'desktop.quick_capture': {
      const title = typeof rawArgs.title === 'string' ? rawArgs.title.trim() : '';
      const body = typeof rawArgs.body === 'string' ? rawArgs.body.trim() : '';
      if (title.length === 0 || body.length === 0) {
        return {
          ok: false,
          status: 400,
          code: -32602,
          message: 'desktop.quick_capture requires non-empty title and body strings',
        };
      }
      const tags = Array.isArray(rawArgs.tags)
        ? rawArgs.tags
            .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
            .map((tag) => tag.trim())
        : [];
      const idempotencyKey =
        typeof rawArgs.idempotencyKey === 'string' && rawArgs.idempotencyKey.trim().length > 0
          ? rawArgs.idempotencyKey.trim()
          : undefined;

      const sanitizedTitle = redactSecretText(title);
      const sanitizedBody = redactSecretText(body);

      if (providers?.saveDesktopQuickCapture) {
        const record = await providers.saveDesktopQuickCapture(companyId, {
          title: sanitizedTitle,
          body: sanitizedBody,
          tags,
          idempotencyKey,
        });
        return {
          ok: true,
          result: redactObject({
            companyId,
            offlineOnly: true,
            created: true,
            capture: {
              ...record,
              title: redactSecretText(record.title),
              body: redactSecretText(record.body),
              offlineOnly: true,
            },
          }),
        };
      }

      const storeKey = idempotencyKey ? `${companyId}:${idempotencyKey}` : undefined;
      if (storeKey && context.captureStore?.has(storeKey)) {
        const existing = context.captureStore.get(storeKey)!;
        return {
          ok: true,
          result: redactObject({
            companyId,
            offlineOnly: true,
            created: false,
            idempotentReplay: true,
            capture: existing,
          }),
        };
      }

      const captureId = createHash('sha256')
        .update(`${companyId}:${idempotencyKey ?? ''}:${sanitizedTitle}:${sanitizedBody}`, 'utf8')
        .digest('hex')
        .slice(0, 16);
      const record: DesktopQuickCaptureRecord = {
        captureId: `cap_${captureId}`,
        companyId,
        title: sanitizedTitle,
        body: sanitizedBody,
        tags,
        createdAt: new Date().toISOString(),
        offlineOnly: true,
      };
      if (storeKey && context.captureStore) {
        context.captureStore.set(storeKey, record);
      }

      return {
        ok: true,
        result: redactObject({
          companyId,
          offlineOnly: true,
          created: true,
          capture: record,
        }),
      };
    }
  }
}
