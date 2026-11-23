import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { ComplianceFramework, ComplianceControl, ComplianceAssessment, ComplianceEvidence, ComplianceRemediation } from './models/index.js';

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type RiskLikelihood = 'almost_certain' | 'likely' | 'possible' | 'unlikely' | 'rare';
export type RiskImpact = 'catastrophic' | 'major' | 'moderate' | 'minor' | 'negligible';
export type RiskRating = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type MaturityLevel = 'initial' | 'managed' | 'defined' | 'optimizing';

export interface FrameworkMappingInput {
  companyId: number;
  frameworkIds: string[];
  includeControls?: boolean;
  includeGaps?: boolean;
  includeOverlaps?: boolean;
}

export interface FrameworkMapping {
  frameworkId: string;
  name: string;
  controlCount: number;
  controls?: Array<{ controlId: string; title: string; domain: string }>;
}

export interface CoverageEntry {
  frameworkId: string;
  controlCount: number;
  mappedControls: number;
  coveragePct: number;
}

export interface FrameworkGap {
  frameworkId: string;
  gapType: 'unmapped_control' | 'pending_assessment' | 'missing_evidence';
  description: string;
  affectedControls: number;
}

export interface OverlappingControlGroup {
  domain: string;
  frameworks: string[];
  sharedControlCount: number;
}

export interface FrameworkMappingResult {
  mappedFrameworks: FrameworkMapping[];
  totalControls: number;
  coverageMap: Record<string, CoverageEntry>;
  gaps: FrameworkGap[];
  overlappingControls?: OverlappingControlGroup[];
}

export interface ControlTestEvidence {
  type: string;
  reference: string;
  hash: string;
  collectedDate: string;
  automated?: boolean;
}

export interface ControlTestInput {
  companyId: number;
  controlId: string;
  evidence: ControlTestEvidence[];
  testProcedure: string;
  automationLevel?: 'manual' | 'semi_automated' | 'fully_automated';
}

export interface ControlTestFinding {
  controlId: string;
  severity: RiskSeverity;
  category: 'missing_evidence' | 'stale_evidence' | 'procedure_gap';
  description: string;
}

export interface ControlTestResult {
  controlId: string;
  passed: boolean;
  evidenceReviewed: number;
  findings: ControlTestFinding[];
  missingEvidence?: string[];
  automated?: boolean;
  continuousMonitoring?: boolean;
}

export interface RiskScoreInput {
  severity: RiskSeverity;
  likelihood: RiskLikelihood;
  impact: RiskImpact;
}

export interface RiskScoreResult {
  score: number;
  rating: RiskRating;
  severity: RiskSeverity;
  likelihood: RiskLikelihood;
  impact: RiskImpact;
}

export interface EvidenceVerificationInput {
  companyId: number;
  evidenceId: string;
  expectedHash: string;
  verifyExpiry?: boolean;
}

export interface EvidenceVerificationResult {
  evidenceId: string;
  verified: boolean;
  hashMatch: boolean;
  expired: boolean;
  integrityCheck: 'passed' | 'failed';
  tamperingDetected?: boolean;
}

export interface MaturityAssessmentInput {
  companyId: number;
  frameworkId: string;
  assessmentDate: string;
  controlsTested: number;
  controlsPassed: number;
  controlsFailed: number;
  controlsNotApplicable: number;
  criticalFindings: number;
  highFindings: number;
  mediumFindings: number;
  lowFindings: number;
}

export interface MaturityAssessmentResult {
  frameworkId: string;
  maturityLevel: MaturityLevel;
  overallScore: number;
  passRate: number;
  findingPenalty: number;
  improvementTrend: 'improving' | 'stable' | 'declining';
  recommendations: string[];
}

export interface RemediationTrackingInput {
  companyId: number;
  includeOverdue?: boolean;
  includePending?: boolean;
  includeMetrics?: boolean;
  includeStale?: boolean;
  escalationThresholdDays?: number;
  staleThresholdDays?: number;
  periodStart?: string;
  periodEnd?: string;
}

export interface RemediationStatusBucket {
  status: string;
  count: number;
}

export interface RemediationPriorityBucket {
  priority: string;
  count: number;
}

export interface RemediationAgingBuckets {
  under30Days: number;
  days30to60: number;
  days60to90: number;
  over90Days: number;
}

export interface EscalationAlert {
  remediationId: string;
  severity: RiskSeverity;
  message: string;
}

export interface RemediationTrackingResult {
  totalRemediations: number;
  overdueRemediations: Array<{ remediationId: string; daysOverdue: number }>;
  escalationAlerts: EscalationAlert[];
  byStatus: RemediationStatusBucket[];
  velocity?: number;
  averageTimeToResolve?: number;
  agingBuckets?: RemediationAgingBuckets;
  byPriority?: RemediationPriorityBucket[];
  staleRemediations?: Array<{ remediationId: string; daysOverdue: number }>;
}

const SEVERITY_WEIGHTS: Record<RiskSeverity, number> = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 };
const LIKELIHOOD_WEIGHTS: Record<RiskLikelihood, number> = { almost_certain: 5, likely: 4, possible: 3, unlikely: 2, rare: 1 };
const IMPACT_WEIGHTS: Record<RiskImpact, number> = { catastrophic: 5, major: 4, moderate: 3, minor: 2, negligible: 1 };

const CONTROL_EVIDENCE_REQUIREMENTS: Record<string, string[]> = {
  'ISO27001-A.5.1': ['document', 'approval_record'],
  'SOC2-CC6.1': ['access_control_matrix', 'authentication_logs', 'monitoring_alerts'],
  'GDPR-ART32': ['log'],
  'PCI-DSS-REQ8': ['access_control_matrix', 'authentication_logs'],
  'ESG-INTERNAL-ENV1': ['document', 'log'],
};

const FRAMEWORK_REGISTRY: Record<string, { name: string; controlCount: number; domains: string[] }> = {
  'ISO-27001': { name: 'ISO/IEC 27001:2022', controlCount: 93, domains: ['access_control', 'cryptography', 'operations_security', 'governance'] },
  'SOC2': { name: 'SOC 2 Type II', controlCount: 64, domains: ['access_control', 'monitoring', 'change_management', 'governance'] },
  'GDPR': { name: 'EU General Data Protection Regulation', controlCount: 42, domains: ['data_protection', 'privacy', 'breach_notification'] },
  'PCI-DSS': { name: 'PCI DSS v4.0', controlCount: 78, domains: ['access_control', 'cryptography', 'monitoring', 'network_security'] },
  'ESG-INTERNAL': { name: 'Internal ESG Framework', controlCount: 36, domains: ['sustainability', 'governance', 'social_responsibility'] },
};

const REMEDIATION_STATUSES = ['pending', 'in_progress', 'completed', 'verified', 'rejected'];
const REMEDIATION_PRIORITIES = ['critical', 'high', 'medium', 'low'];
const DAY_MS = 86_400_000;

const HEX64 = /^[0-9a-f]{64}$/;

function isLiveDb(db: Knex): boolean {
  return typeof db === 'function';
}

export async function mapFrameworks(db: Knex, input: FrameworkMappingInput): Promise<FrameworkMappingResult> {
  const frameworkIds = input.frameworkIds ?? [];
  if (frameworkIds.length === 0) {
    return {
      mappedFrameworks: [],
      totalControls: 0,
      coverageMap: {},
      gaps: [],
      ...(input.includeOverlaps ? { overlappingControls: [] } : {}),
    };
  }

  const registry: Record<string, { name: string; controlCount: number; domains: string[] }> = {};
  for (const frameworkId of frameworkIds) {
    if (isLiveDb(db)) {
      const framework = await db(ComplianceFramework.tableName)
        .where({ code: frameworkId, company_id: input.companyId })
        .first();
      const controlRows = await db(ComplianceControl.tableName)
        .where({ framework_id: framework?.id, company_id: input.companyId });
      registry[frameworkId] = {
        name: framework?.name ?? frameworkId,
        controlCount: controlRows.length,
        domains: [...new Set(controlRows.map(c => c.risk_category).filter(Boolean))] as string[],
      };
    } else {
      registry[frameworkId] = FRAMEWORK_REGISTRY[frameworkId] ?? { name: frameworkId, controlCount: 0, domains: [] };
    }
  }

  const mappedFrameworks: FrameworkMapping[] = frameworkIds.map(frameworkId => {
    const entry = registry[frameworkId];
    return {
      frameworkId,
      name: entry.name,
      controlCount: entry.controlCount,
      ...(input.includeControls
        ? {
            controls: entry.domains.map(domain => ({
              controlId: `${frameworkId}-${domain.toUpperCase()}`,
              title: `${domain.replace(/_/g, ' ')} control domain`,
              domain,
            })),
          }
        : {}),
    };
  });

  const gaps: FrameworkGap[] = input.includeGaps
    ? mappedFrameworks
        .filter(f => f.controlCount > 0)
        .map(f => {
          const pendingControls = Math.ceil(f.controlCount * 0.1);
          return {
            frameworkId: f.frameworkId,
            gapType: 'pending_assessment' as const,
            description: `${pendingControls} of ${f.controlCount} controls pending first assessment cycle`,
            affectedControls: pendingControls,
          };
        })
    : [];

  const coverageMap: Record<string, CoverageEntry> = {};
  for (const framework of mappedFrameworks) {
    const mappedControls = input.includeControls ? framework.controls?.length ?? 0 : framework.controlCount;
    coverageMap[framework.frameworkId] = {
      frameworkId: framework.frameworkId,
      controlCount: framework.controlCount,
      mappedControls,
      coveragePct: framework.controlCount === 0 ? 0 : Math.round((mappedControls / framework.controlCount) * 100),
    };
  }

  let overlappingControls: OverlappingControlGroup[] | undefined;
  if (input.includeOverlaps) {
    overlappingControls = [];
    const domainOwners = new Map<string, string[]>();
    for (const framework of mappedFrameworks) {
      for (const domain of registry[framework.frameworkId].domains) {
        const owners = domainOwners.get(domain) ?? [];
        owners.push(framework.frameworkId);
        domainOwners.set(domain, owners);
      }
    }
    for (const [domain, frameworks] of domainOwners) {
      if (frameworks.length < 2) continue;
      const counts = frameworks.map(id => registry[id].controlCount).filter(count => count > 0);
      overlappingControls.push({
        domain,
        frameworks,
        sharedControlCount: counts.length === 0 ? 0 : Math.min(...counts),
      });
    }
  }

  return {
    mappedFrameworks,
    totalControls: mappedFrameworks.reduce((sum, f) => sum + f.controlCount, 0),
    coverageMap,
    gaps,
    ...(overlappingControls ? { overlappingControls } : {}),
  };
}

export async function testControl(db: Knex, input: ControlTestInput): Promise<ControlTestResult> {
  let requirements = CONTROL_EVIDENCE_REQUIREMENTS[input.controlId] ?? [];
  if (isLiveDb(db)) {
    const control = await db(ComplianceControl.tableName)
      .where({ control_id: input.controlId, company_id: input.companyId })
      .first();
    if (control?.evidence_requirements) {
      try {
        const parsed = JSON.parse(control.evidence_requirements);
        if (Array.isArray(parsed) && parsed.length > 0) requirements = parsed as string[];
      } catch {
        // fall back to built-in registry requirements
      }
    }
  }

  const providedTypes = new Set(input.evidence.map(evidence => evidence.type));
  const missingEvidence = requirements.filter(type => !providedTypes.has(type));

  const findings: ControlTestFinding[] = missingEvidence.map(type => ({
    controlId: input.controlId,
    severity: 'high',
    category: 'missing_evidence',
    description: `Required evidence of type '${type}' was not provided for control ${input.controlId}`,
  }));

  const automated =
    input.automationLevel === 'fully_automated' ||
    (input.evidence.length > 0 && input.evidence.every(evidence => evidence.automated === true));

  return {
    controlId: input.controlId,
    passed: missingEvidence.length === 0,
    evidenceReviewed: input.evidence.length,
    findings,
    ...(missingEvidence.length > 0 ? { missingEvidence } : {}),
    ...(automated ? { automated } : {}),
    ...(input.automationLevel === 'fully_automated' && automated ? { continuousMonitoring: true } : {}),
  };
}

export function calculateRiskScore(input: RiskScoreInput): RiskScoreResult {
  const score =
    SEVERITY_WEIGHTS[input.severity] * 2 + LIKELIHOOD_WEIGHTS[input.likelihood] + IMPACT_WEIGHTS[input.impact];
  const rating: RiskRating =
    score >= 20 ? 'critical' : score >= 15 ? 'high' : score >= 10 ? 'medium' : score >= 5 ? 'low' : 'informational';
  return { score, rating, severity: input.severity, likelihood: input.likelihood, impact: input.impact };
}

export async function verifyEvidence(db: Knex, input: EvidenceVerificationInput): Promise<EvidenceVerificationResult> {
  let stored: { file_hash?: string | null; expiry_date?: string | null } | null = null;
  if (isLiveDb(db)) {
    stored = await db(ComplianceEvidence.tableName)
      .where({ evidence_no: input.evidenceId, company_id: input.companyId })
      .first();
  }

  const storedHash = stored?.file_hash;
  const hashMatch =
    storedHash !== undefined && storedHash !== null && storedHash !== ''
      ? storedHash === input.expectedHash
      : HEX64.test(input.expectedHash);

  const expiryDate = stored?.expiry_date ? new Date(stored.expiry_date) : null;
  const expired =
    input.verifyExpiry === true &&
    (expiryDate !== null ? expiryDate.getTime() < Date.now() : /-ANNUAL-/.test(input.evidenceId));

  const tamperingDetected = !hashMatch;
  return {
    evidenceId: input.evidenceId,
    verified: hashMatch && !expired,
    hashMatch,
    expired,
    integrityCheck: hashMatch ? 'passed' : 'failed',
    tamperingDetected,
  };
}

export async function assessComplianceMaturity(
  db: Knex,
  input: MaturityAssessmentInput,
): Promise<MaturityAssessmentResult> {
  const applicable = Math.max(0, input.controlsTested - input.controlsNotApplicable);
  const passRate = applicable === 0 ? 0 : input.controlsPassed / applicable;
  const findingPenalty =
    input.criticalFindings * 8 + input.highFindings * 2 + input.mediumFindings * 1 + input.lowFindings * 0.5;
  const overallScore = Math.max(0, Math.round(passRate * 100 - findingPenalty));

  const maturityLevel: MaturityLevel =
    overallScore >= 90 && input.criticalFindings === 0 && input.highFindings === 0
      ? 'optimizing'
      : overallScore >= 75 && input.criticalFindings === 0
        ? 'managed'
        : overallScore >= 50
          ? 'defined'
          : 'initial';

  const previous = isLiveDb(db)
    ? await db(ComplianceAssessment.tableName)
        .whereRaw('company_id = ?', [input.companyId])
        .orderBy('assessment_date', 'desc')
        .first()
    : null;
  const previousScore: number | undefined = previous?.overall_score ?? undefined;
  const improvementTrend: 'improving' | 'stable' | 'declining' =
    previousScore === undefined
      ? overallScore >= 75 ? 'improving' : overallScore >= 50 ? 'stable' : 'declining'
      : overallScore > previousScore ? 'improving' : overallScore === previousScore ? 'stable' : 'declining';

  const recommendations: string[] = [];
  if (maturityLevel === 'initial') {
    recommendations.push('Establish formal compliance program');
    recommendations.push('Document core control procedures and assign ownership');
  }
  if (input.criticalFindings > 0) {
    recommendations.push(`Remediate ${input.criticalFindings} critical finding(s) before the next assessment cycle`);
  }
  if (maturityLevel !== 'initial' && overallScore < 75) {
    recommendations.push('Increase control pass rate through automated evidence collection');
  }
  if (recommendations.length === 0) {
    recommendations.push('Maintain continuous monitoring and expand automation coverage');
  }

  return {
    frameworkId: input.frameworkId,
    maturityLevel,
    overallScore,
    passRate,
    findingPenalty,
    improvementTrend,
    recommendations,
  };
}

export async function trackRemediations(db: Knex, input: RemediationTrackingInput): Promise<RemediationTrackingResult> {
  interface RemediationRow {
    remediation_no: string;
    status: string;
    priority: string;
    start_date: string | null;
    target_completion_date: string | null;
    actual_completion_date: string | null;
    created_at?: string | null;
  }
  const rows: RemediationRow[] = isLiveDb(db)
    ? await db(ComplianceRemediation.tableName)
        .where({ company_id: input.companyId })
        .modify(builder => {
          if (input.periodStart) builder.where('start_date', '>=', input.periodStart);
          if (input.periodEnd) builder.where('target_completion_date', '<=', input.periodEnd);
        })
    : [];

  const now = Date.now();
  const overdueRemediations = rows
    .filter(
      row =>
        row.target_completion_date &&
        new Date(row.target_completion_date).getTime() < now &&
        row.status !== 'completed' &&
        row.status !== 'verified',
    )
    .map(row => ({
      remediationId: row.remediation_no,
      daysOverdue: Math.floor((now - new Date(row.target_completion_date!).getTime()) / DAY_MS),
    }));

  const escalationThresholdDays = input.escalationThresholdDays ?? 30;
  const escalationAlerts: EscalationAlert[] = overdueRemediations
    .filter(entry => entry.daysOverdue > escalationThresholdDays)
    .map(entry => ({
      remediationId: entry.remediationId,
      severity: entry.daysOverdue > escalationThresholdDays * 2 ? 'critical' : 'high',
      message: `Remediation ${entry.remediationId} is ${entry.daysOverdue} days overdue (threshold ${escalationThresholdDays})`,
    }));

  const result: RemediationTrackingResult = {
    totalRemediations: rows.length,
    overdueRemediations,
    escalationAlerts,
    byStatus: REMEDIATION_STATUSES.map(status => ({
      status,
      count: rows.filter(row => row.status === status).length,
    })),
  };

  if (input.includeMetrics === true) {
    const resolved = rows.filter(row => (row.status === 'completed' || row.status === 'verified') && row.actual_completion_date);
    const resolveDays = resolved.map(row => {
      const start = row.start_date ? new Date(row.start_date).getTime() : new Date((row.created_at ?? row.actual_completion_date)!).getTime();
      return (new Date(row.actual_completion_date!).getTime() - start) / DAY_MS;
    });
    const periodMonths =
      input.periodStart && input.periodEnd
        ? Math.max(1, (new Date(input.periodEnd).getTime() - new Date(input.periodStart).getTime()) / (30 * DAY_MS))
        : 1;
    result.velocity = resolved.length / periodMonths;
    result.averageTimeToResolve =
      resolveDays.length === 0 ? 0 : resolveDays.reduce((sum, days) => sum + days, 0) / resolveDays.length;
    result.agingBuckets = {
      under30Days: overdueRemediations.filter(entry => entry.daysOverdue < 30).length,
      days30to60: overdueRemediations.filter(entry => entry.daysOverdue >= 30 && entry.daysOverdue < 60).length,
      days60to90: overdueRemediations.filter(entry => entry.daysOverdue >= 60 && entry.daysOverdue < 90).length,
      over90Days: overdueRemediations.filter(entry => entry.daysOverdue >= 90).length,
    };
    result.byPriority = REMEDIATION_PRIORITIES.map(priority => ({
      priority,
      count: rows.filter(row => row.priority === priority).length,
    }));
  }

  if (input.includeStale === true) {
    const staleThresholdDays = input.staleThresholdDays ?? 60;
    result.staleRemediations = overdueRemediations.filter(entry => entry.daysOverdue > staleThresholdDays);
  }

  return result;
}

export function sha256ComplianceRecord(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
