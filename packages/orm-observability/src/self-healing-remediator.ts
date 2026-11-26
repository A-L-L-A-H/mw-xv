export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RemediationActionType =
  | 'restart_worker'
  | 'drain_node'
  | 'scale_up'
  | 'circuit_break'
  | 'rollback_release'
  | 'notify_only';

export type RemediationDecisionStatus =
  | 'executed'
  | 'skipped_cooldown'
  | 'blocked_blast_radius'
  | 'no_matching_rule';

export interface IncidentSignal {
  readonly incidentId: string;
  readonly service: string;
  readonly signalType: string;
  readonly severity: IncidentSeverity;
  readonly affectedInstances: number;
  readonly totalInstances: number;
  readonly metricValue: number;
  readonly timestampMs: number;
}

export interface RemediationRule {
  readonly ruleId: string;
  readonly signalType: string;
  readonly minSeverity: IncidentSeverity;
  readonly threshold: number;
  readonly action: RemediationActionType;
  readonly cooldownMs: number;
  readonly maxBlastRadiusRatio: number;
}

export interface RemediationAuditEntry {
  readonly auditId: string;
  readonly incidentId: string;
  readonly service: string;
  readonly ruleId: string | null;
  readonly action: RemediationActionType | null;
  readonly status: RemediationDecisionStatus;
  readonly reason: string;
  readonly timestampMs: number;
}

export type RemediationExecutor = (incident: IncidentSignal, rule: RemediationRule) => void;

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Self-healing incident remediation engine with rule evaluation, cooldown
 * enforcement, blast-radius guards, and an immutable audit trail.
 */
export class SelfHealingRemediator {
  private readonly rules: readonly RemediationRule[];
  private readonly executor?: RemediationExecutor;
  private readonly lastExecutedByKey = new Map<string, number>();
  private readonly auditTrail: RemediationAuditEntry[] = [];
  private auditSequence = 0;

  public constructor(rules: readonly RemediationRule[], executor?: RemediationExecutor) {
    this.rules = [...rules];
    this.executor = executor;
  }

  public evaluate(incident: IncidentSignal): RemediationAuditEntry {
    const matchedRule = this.rules.find(
      (rule) =>
        rule.signalType === incident.signalType &&
        SEVERITY_RANK[incident.severity] >= SEVERITY_RANK[rule.minSeverity] &&
        incident.metricValue >= rule.threshold
    );

    if (!matchedRule) {
      return this.recordAudit({
        incidentId: incident.incidentId,
        service: incident.service,
        ruleId: null,
        action: null,
        status: 'no_matching_rule',
        reason: `No remediation rule matched signal '${incident.signalType}'`,
        timestampMs: incident.timestampMs,
      });
    }

    const cooldownKey = `${incident.service}:${matchedRule.ruleId}`;
    const lastExecutedAt = this.lastExecutedByKey.get(cooldownKey);
    if (
      lastExecutedAt !== undefined &&
      incident.timestampMs - lastExecutedAt < matchedRule.cooldownMs
    ) {
      return this.recordAudit({
        incidentId: incident.incidentId,
        service: incident.service,
        ruleId: matchedRule.ruleId,
        action: matchedRule.action,
        status: 'skipped_cooldown',
        reason: `Cooldown active for rule '${matchedRule.ruleId}' on service '${incident.service}'`,
        timestampMs: incident.timestampMs,
      });
    }

    const blastRadiusRatio =
      incident.totalInstances > 0 ? incident.affectedInstances / incident.totalInstances : 1;
    if (incident.totalInstances <= 0 || blastRadiusRatio > matchedRule.maxBlastRadiusRatio) {
      return this.recordAudit({
        incidentId: incident.incidentId,
        service: incident.service,
        ruleId: matchedRule.ruleId,
        action: matchedRule.action,
        status: 'blocked_blast_radius',
        reason: `Blast radius ${blastRadiusRatio.toFixed(2)} exceeds limit ${matchedRule.maxBlastRadiusRatio.toFixed(2)}`,
        timestampMs: incident.timestampMs,
      });
    }

    if (this.executor) {
      this.executor(incident, matchedRule);
    }
    this.lastExecutedByKey.set(cooldownKey, incident.timestampMs);

    return this.recordAudit({
      incidentId: incident.incidentId,
      service: incident.service,
      ruleId: matchedRule.ruleId,
      action: matchedRule.action,
      status: 'executed',
      reason: `Executed '${matchedRule.action}' for rule '${matchedRule.ruleId}'`,
      timestampMs: incident.timestampMs,
    });
  }

  public getAuditTrail(): readonly RemediationAuditEntry[] {
    return [...this.auditTrail];
  }

  private recordAudit(entry: Omit<RemediationAuditEntry, 'auditId'>): RemediationAuditEntry {
    this.auditSequence += 1;
    const record: RemediationAuditEntry = {
      auditId: `rem-audit-${this.auditSequence}`,
      ...entry,
    };
    this.auditTrail.push(record);
    return record;
  }
}
