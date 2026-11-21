import { createHash } from 'node:crypto';
import { normalizeDataClassification } from './classification-router.js';
import { createRedactor, type RedactionContext } from './redaction.js';
import type { Clock, DataClassification } from './types.js';
import { SYSTEM_CLOCK } from './types.js';

export type MemoryKind = 'episodic' | 'semantic' | 'procedural';
export type MemoryScopeKind = 'task' | 'project' | 'company';
export type MemoryStatus = 'candidate' | 'approved' | 'rejected' | 'revoked' | 'expired';
export type SkillStatus = 'candidate' | 'approved' | 'rejected' | 'revoked';
export type MemoryAblationMode = 'no-memory' | 'episodic-only' | 'skill-only' | 'combined';

export const MEMORY_ABLATION_MODES: readonly MemoryAblationMode[] = [
  'no-memory',
  'episodic-only',
  'skill-only',
  'combined',
];

const CLASSIFICATION_RANK: Readonly<Record<DataClassification, number>> = {
  cloud_eligible: 1,
  local_only: 2,
  restricted: 3,
};

export interface MemoryCandidateRecord {
  readonly id: string;
  readonly companyId: number;
  readonly memoryKind: MemoryKind;
  readonly scopeKind: MemoryScopeKind;
  readonly scopeRef: string;
  readonly title: string;
  readonly content: string;
  readonly sourceRef: string;
  readonly confidenceBps: number;
  readonly dataClassification: DataClassification;
  readonly sourceRunId: string;
  readonly sourceAgentId: string | number;
  readonly evidenceArtifactId?: string;
  readonly status: MemoryStatus;
  readonly expiresAt?: string;
  readonly reviewedBy?: string | number;
  readonly reviewedAt?: string;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
  readonly modifiesLivePolicyOrGrants?: boolean;
}

export interface SkillVersionRecord {
  readonly id: string;
  readonly companyId: number;
  readonly code: string;
  readonly version: number;
  readonly title: string;
  readonly sopBody: string;
  readonly referencedCapabilities: readonly string[];
  readonly dataClassification: DataClassification;
  readonly sourceRunId?: string;
  readonly sourceAgentId?: string | number;
  readonly evidenceArtifactId?: string;
  readonly status: SkillStatus;
  readonly evalScoreBps?: number;
  readonly expiresAt?: string;
  readonly approvedBy?: string | number;
  readonly approvedAt?: string;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
  readonly modifiesLivePolicyOrGrants?: boolean;
}

export interface RetrievedMemoryContextItem {
  readonly itemId: string;
  readonly itemType: 'memory' | 'skill';
  readonly kind: MemoryKind | 'skill_version';
  readonly version?: number;
  readonly title: string;
  readonly content: string;
  readonly untrustedContext: true;
  readonly authorityGranted: false;
}

export interface MemoryUsageAuditRecord {
  readonly runId: string;
  readonly companyId: number;
  readonly itemId: string;
  readonly itemType: 'memory' | 'skill';
  readonly skillVersion?: number;
  readonly retrievedAt: string;
}

export interface MemoryRetrievalQuery {
  readonly runId: string;
  readonly companyId: number;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly maxDataClassification: DataClassification;
  readonly mode?: MemoryAblationMode;
  readonly memories: readonly MemoryCandidateRecord[];
  readonly skills: readonly SkillVersionRecord[];
  readonly redactor?: RedactionContext;
  readonly clock?: Clock;
}

export interface MemoryRetrievalResult {
  readonly mode: MemoryAblationMode;
  readonly items: readonly RetrievedMemoryContextItem[];
  readonly usageAudits: readonly MemoryUsageAuditRecord[];
  readonly excludedCount: number;
  readonly capabilityGrantsDelta: readonly never[];
}

function matchesScope(
  memory: MemoryCandidateRecord,
  query: Pick<MemoryRetrievalQuery, 'companyId' | 'projectId' | 'taskId'>
): boolean {
  if (memory.scopeKind === 'company') {
    return memory.scopeRef === String(query.companyId) || memory.scopeRef === 'company';
  }
  if (memory.scopeKind === 'project') {
    return query.projectId !== undefined && memory.scopeRef === query.projectId;
  }
  return query.taskId !== undefined && memory.scopeRef === query.taskId;
}

function isNotExpired(expiresAt: string | undefined, nowMs: number): boolean {
  if (expiresAt === undefined) return true;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed > nowMs;
}

export function retrieveEligibleMemoryContext(query: MemoryRetrievalQuery): MemoryRetrievalResult {
  const mode: MemoryAblationMode = query.mode ?? 'combined';
  const clock = query.clock ?? SYSTEM_CLOCK;
  const nowMs = clock.now();
  const nowIso = new Date(nowMs).toISOString();
  const redactor = query.redactor ?? createRedactor();
  const maxCls = normalizeDataClassification(query.maxDataClassification);

  if (mode === 'no-memory') {
    return {
      mode,
      items: [],
      usageAudits: [],
      excludedCount: query.memories.length + query.skills.length,
      capabilityGrantsDelta: [],
    };
  }

  const includeEpisodicOrSemantic = mode === 'episodic-only' || mode === 'combined';
  const includeSkills = mode === 'skill-only' || mode === 'combined';

  const items: RetrievedMemoryContextItem[] = [];
  const usageAudits: MemoryUsageAuditRecord[] = [];
  let excludedCount = 0;

  for (const memory of query.memories) {
    const modeAllowsKind =
      mode === 'episodic-only'
        ? memory.memoryKind === 'episodic'
        : includeEpisodicOrSemantic && memory.memoryKind !== 'procedural';

    if (
      !modeAllowsKind ||
      memory.companyId !== query.companyId ||
      memory.status !== 'approved' ||
      memory.modifiesLivePolicyOrGrants === true ||
      !isNotExpired(memory.expiresAt, nowMs) ||
      CLASSIFICATION_RANK[memory.dataClassification] > CLASSIFICATION_RANK[maxCls] ||
      !matchesScope(memory, query)
    ) {
      excludedCount += 1;
      continue;
    }

    items.push({
      itemId: memory.id,
      itemType: 'memory',
      kind: memory.memoryKind,
      title: redactor.redactString(memory.title),
      content: `<untrusted_memory id="${memory.id}" kind="${memory.memoryKind}">\n${redactor.redactString(
        memory.content
      )}\n</untrusted_memory>`,
      untrustedContext: true,
      authorityGranted: false,
    });
    usageAudits.push({
      runId: query.runId,
      companyId: query.companyId,
      itemId: memory.id,
      itemType: 'memory',
      retrievedAt: nowIso,
    });
  }

  for (const skill of query.skills) {
    if (
      !includeSkills ||
      skill.companyId !== query.companyId ||
      skill.status !== 'approved' ||
      skill.modifiesLivePolicyOrGrants === true ||
      !isNotExpired(skill.expiresAt, nowMs) ||
      CLASSIFICATION_RANK[skill.dataClassification] > CLASSIFICATION_RANK[maxCls]
    ) {
      excludedCount += 1;
      continue;
    }

    items.push({
      itemId: skill.id,
      itemType: 'skill',
      kind: 'skill_version',
      version: skill.version,
      title: redactor.redactString(skill.title),
      content: `<untrusted_skill id="${skill.id}" version="${skill.version}">\n${redactor.redactString(
        skill.sopBody
      )}\n</untrusted_skill>`,
      untrustedContext: true,
      authorityGranted: false,
    });
    usageAudits.push({
      runId: query.runId,
      companyId: query.companyId,
      itemId: skill.id,
      itemType: 'skill',
      skillVersion: skill.version,
      retrievedAt: nowIso,
    });
  }

  return {
    mode,
    items,
    usageAudits,
    excludedCount,
    capabilityGrantsDelta: [],
  };
}

export interface MemoryPromotionThresholds {
  readonly minUtilityGainBps: number;
  readonly maxHarmRateBps: number;
  readonly requireEvidenceArtifact?: boolean;
  readonly requireIndependentReviewer?: boolean;
}

export interface MemoryPromotionEvaluationInput {
  readonly candidateType: 'memory' | 'skill';
  readonly candidate: MemoryCandidateRecord | SkillVersionRecord;
  readonly utilityGainBps: number;
  readonly harmRateBps: number;
  readonly safetyRegressions: number;
  readonly reviewerActorId?: string | number;
  readonly reviewerApproved: boolean;
  readonly thresholds: MemoryPromotionThresholds;
}

export interface MemoryPromotionDecision {
  readonly eligibleForPromotion: boolean;
  readonly rejectionReasons: readonly string[];
}

export function evaluateMemoryCandidatePromotion(
  input: MemoryPromotionEvaluationInput
): MemoryPromotionDecision {
  const rejectionReasons: string[] = [];
  const { candidate, thresholds } = input;

  if (candidate.status === 'revoked' || candidate.status === 'rejected') {
    rejectionReasons.push(`Candidate status "${candidate.status}" cannot be promoted`);
  }
  if (candidate.modifiesLivePolicyOrGrants) {
    rejectionReasons.push(
      'Candidates that attempt live policy/prompt/grant self-modification are prohibited'
    );
  }
  if ((thresholds.requireEvidenceArtifact ?? true) && !candidate.evidenceArtifactId) {
    rejectionReasons.push('Candidate promotion requires linked provenance evidenceArtifactId');
  }
  if (thresholds.requireIndependentReviewer ?? true) {
    if (!input.reviewerApproved || input.reviewerActorId === undefined) {
      rejectionReasons.push('Candidate promotion requires explicit reviewer approval');
    } else if (
      candidate.sourceAgentId !== undefined &&
      String(input.reviewerActorId) === String(candidate.sourceAgentId)
    ) {
      rejectionReasons.push('Candidate producer cannot self-approve promotion');
    }
  }
  if (input.safetyRegressions > 0) {
    rejectionReasons.push(`Detected ${input.safetyRegressions} safety regression(s); must be 0`);
  }
  if (input.utilityGainBps < thresholds.minUtilityGainBps) {
    rejectionReasons.push(
      `Utility gain (${input.utilityGainBps} bps) below required threshold (${thresholds.minUtilityGainBps} bps)`
    );
  }
  if (input.harmRateBps > thresholds.maxHarmRateBps) {
    rejectionReasons.push(
      `Memory harm rate (${input.harmRateBps} bps) exceeds threshold (${thresholds.maxHarmRateBps} bps)`
    );
  }

  return {
    eligibleForPromotion: rejectionReasons.length === 0,
    rejectionReasons,
  };
}

export interface MemoryAblationFixture {
  readonly fixtureId: string;
  readonly companyId: number;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly maxDataClassification: DataClassification;
  readonly isTransferTask?: boolean;
  readonly isPoisonedMemoryCase?: boolean;
}

export interface MemoryAblationTaskOutcome {
  readonly passed: boolean;
  readonly costMicros: number;
  readonly safetyRegression: boolean;
  readonly harmedByMemory: boolean;
}

export interface MemoryAblationModeSummary {
  readonly mode: MemoryAblationMode;
  readonly totalTasks: number;
  readonly passedTasks: number;
  readonly failedTasks: number;
  readonly passRateBps: number;
  readonly transferPassRateBps: number;
  readonly totalCostMicros: number;
  readonly costPerAcceptedDeliverableMicros: number;
  readonly harmedCount: number;
  readonly harmRateBps: number;
  readonly safetyRegressions: number;
  readonly utilityGainVsNoMemoryBps: number;
}

export interface MemoryAblationReport {
  readonly companyId: number;
  readonly generatedAt: string;
  readonly conditionSummaries: Readonly<Record<MemoryAblationMode, MemoryAblationModeSummary>>;
  readonly bestMode: MemoryAblationMode;
  readonly recommendation: 'promote' | 'hold' | 'reject';
  readonly reason: string;
  readonly reportSha256: string;
}

export async function runMemoryAblation(params: {
  readonly companyId: number;
  readonly fixtures: readonly MemoryAblationFixture[];
  readonly memories: readonly MemoryCandidateRecord[];
  readonly skills: readonly SkillVersionRecord[];
  readonly promotionThresholds: MemoryPromotionThresholds;
  readonly executeFixture: (params: {
    readonly fixture: MemoryAblationFixture;
    readonly mode: MemoryAblationMode;
    readonly retrieved: MemoryRetrievalResult;
  }) => Promise<MemoryAblationTaskOutcome> | MemoryAblationTaskOutcome;
  readonly clock?: Clock;
}): Promise<MemoryAblationReport> {
  const clock = params.clock ?? SYSTEM_CLOCK;
  const rawSummaries = new Map<
    MemoryAblationMode,
    Omit<MemoryAblationModeSummary, 'utilityGainVsNoMemoryBps'>
  >();

  for (const mode of MEMORY_ABLATION_MODES) {
    let passedTasks = 0;
    let failedTasks = 0;
    let transferTotal = 0;
    let transferPassed = 0;
    let totalCostMicros = 0;
    let harmedCount = 0;
    let safetyRegressions = 0;

    for (const fixture of params.fixtures) {
      const retrieved = retrieveEligibleMemoryContext({
        runId: `ablation:${mode}:${fixture.fixtureId}`,
        companyId: fixture.companyId,
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        maxDataClassification: fixture.maxDataClassification,
        mode,
        memories: params.memories,
        skills: params.skills,
        clock,
      });

      const outcome = await params.executeFixture({ fixture, mode, retrieved });
      totalCostMicros += Math.max(0, outcome.costMicros);
      if (outcome.passed) {
        passedTasks += 1;
      } else {
        failedTasks += 1;
      }
      if (fixture.isTransferTask) {
        transferTotal += 1;
        if (outcome.passed) transferPassed += 1;
      }
      if (outcome.harmedByMemory) harmedCount += 1;
      if (outcome.safetyRegression) safetyRegressions += 1;
    }

    const totalTasks = params.fixtures.length;
    const passRateBps = totalTasks > 0 ? Math.round((passedTasks / totalTasks) * 10_000) : 0;
    const transferPassRateBps =
      transferTotal > 0 ? Math.round((transferPassed / transferTotal) * 10_000) : passRateBps;
    const harmRateBps = totalTasks > 0 ? Math.round((harmedCount / totalTasks) * 10_000) : 0;
    const costPerAcceptedDeliverableMicros =
      passedTasks > 0 ? Math.round(totalCostMicros / passedTasks) : totalCostMicros;

    rawSummaries.set(mode, {
      mode,
      totalTasks,
      passedTasks,
      failedTasks,
      passRateBps,
      transferPassRateBps,
      totalCostMicros,
      costPerAcceptedDeliverableMicros,
      harmedCount,
      harmRateBps,
      safetyRegressions,
    });
  }

  const baselinePassRateBps = rawSummaries.get('no-memory')!.passRateBps;
  const conditionSummaries = {} as Record<MemoryAblationMode, MemoryAblationModeSummary>;
  let bestMode: MemoryAblationMode = 'no-memory';
  let bestGain = 0;

  for (const mode of MEMORY_ABLATION_MODES) {
    const raw = rawSummaries.get(mode)!;
    const utilityGainVsNoMemoryBps = raw.passRateBps - baselinePassRateBps;
    const summary: MemoryAblationModeSummary = {
      ...raw,
      utilityGainVsNoMemoryBps,
    };
    conditionSummaries[mode] = summary;

    if (
      mode !== 'no-memory' &&
      summary.safetyRegressions === 0 &&
      summary.harmRateBps <= params.promotionThresholds.maxHarmRateBps &&
      utilityGainVsNoMemoryBps > bestGain
    ) {
      bestGain = utilityGainVsNoMemoryBps;
      bestMode = mode;
    }
  }

  const combined = conditionSummaries.combined;
  let recommendation: MemoryAblationReport['recommendation'] = 'hold';
  let reason = 'No memory mode improved sufficiently over no-memory baseline';

  if (
    combined.safetyRegressions > 0 ||
    combined.harmRateBps > params.promotionThresholds.maxHarmRateBps
  ) {
    recommendation = 'reject';
    reason = `Memory caused harm (${combined.harmRateBps} bps) or safety regressions (${combined.safetyRegressions})`;
  } else if (bestMode !== 'no-memory' && bestGain >= params.promotionThresholds.minUtilityGainBps) {
    recommendation = 'promote';
    reason = `Mode "${bestMode}" achieved +${bestGain} bps utility gain with 0 safety regressions`;
  }

  const reportBase = {
    companyId: params.companyId,
    generatedAt: new Date(clock.now()).toISOString(),
    conditionSummaries,
    bestMode,
    recommendation,
    reason,
  };

  return {
    ...reportBase,
    reportSha256: createHash('sha256').update(JSON.stringify(reportBase)).digest('hex'),
  };
}
