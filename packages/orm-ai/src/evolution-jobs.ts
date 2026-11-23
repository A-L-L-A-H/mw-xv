import { createHash } from 'node:crypto';
import {
  buildMerkleAuditTree,
  computeEpistemicCalibration,
  DEFAULT_REDTEAM_SCENARIOS,
  deriveDynamicAutonomyPolicy,
  evaluateObligationDrift,
  fuzzPolicyInvariants,
  generateMerkleInclusionProof,
  runAdversarialRedTeamArena,
  runNonRemConsolidation,
  runRemDreamSelfProbe,
  synthesizeEvolutionCandidates,
  synthesizeIncidentHealingProposal,
  type AdversarialRedTeamArenaReport,
  type AutonomyPolicyThresholds,
  type BlueTeamEvaluator,
  type CausalCheckpoint,
  type DreamKnowledgeNode,
  type DreamSkillNode,
  type DynamicAutonomyPolicy,
  type EpistemicCalibrationOptions,
  type EpistemicCalibrationReport,
  type EpistemicPredictionSample,
  type EpisodicMemoryItem,
  type EvaluateObligationDriftOptions,
  type EvolutionSynthesisInput,
  type EvolutionSynthesisResult,
  type IncidentHealingProposal,
  type MerkleAuditTree,
  type MerkleInclusionProof,
  type MonitorObligationRecord,
  type NonRemConsolidationOptions,
  type NonRemConsolidationReport,
  type ObligationDriftReport,
  type PolicyFuzzerOptions,
  type PolicyFuzzReport,
  type PolicyRuleSpec,
  type RedTeamScenario,
  type RemDreamSelfProbeReport,
  type StructuredIncidentLog,
  type WorldStateSnapshot,
} from '@moonwitness/ai-runtime';
import {
  runCandidateAblationGate,
  type AblationCaseResult,
  type CandidateAblationGateReport,
} from '@moonwitness/ai-evaluation';

export const AI_EVOLUTION_CYCLE_JOB = 'ai.evolution_cycle@v1' as const;
export const AI_OBLIGATION_SWEEP_JOB = 'ai.obligation_sweep@v1' as const;
export const AI_M16_SLEEP_DREAM_CONSOLIDATION_JOB = 'ai.m16.sleep_dream_consolidation@v1' as const;
export const AI_M16_REDTEAM_ARENA_SWEEP_JOB = 'ai.m16.redteam_arena_sweep@v1' as const;
export const AI_M15_EPISTEMIC_CALIBRATION_AUDIT_JOB =
  'ai.m15.epistemic_calibration_audit@v1' as const;
export const AI_M17_INCIDENT_HEALER_SWEEP_JOB = 'ai.m17.incident_healer_sweep@v1' as const;

export type AgiScheduledJobName =
  | typeof AI_EVOLUTION_CYCLE_JOB
  | typeof AI_OBLIGATION_SWEEP_JOB
  | typeof AI_M16_SLEEP_DREAM_CONSOLIDATION_JOB
  | typeof AI_M16_REDTEAM_ARENA_SWEEP_JOB
  | typeof AI_M15_EPISTEMIC_CALIBRATION_AUDIT_JOB
  | typeof AI_M17_INCIDENT_HEALER_SWEEP_JOB;

export interface AgiCronScheduleDefinition {
  readonly jobName: AgiScheduledJobName;
  readonly cronExpression: string;
  readonly description: string;
  readonly requiresHumanApproval: true;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
}

export const AGI_CRON_SCHEDULES: readonly AgiCronScheduleDefinition[] = [
  {
    jobName: AI_EVOLUTION_CYCLE_JOB,
    cronExpression: '0 2 * * *',
    description: 'Synthesize bounded evolution candidates and run candidate ablation gates.',
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  },
  {
    jobName: AI_OBLIGATION_SWEEP_JOB,
    cronExpression: '*/30 * * * *',
    description: 'Evaluate obligation drift against current world-state telemetry.',
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  },
  {
    jobName: AI_M16_SLEEP_DREAM_CONSOLIDATION_JOB,
    cronExpression: '0 3 * * *',
    description: 'Run Non-REM episodic memory consolidation and REM dream self-probes.',
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  },
  {
    jobName: AI_M16_REDTEAM_ARENA_SWEEP_JOB,
    cronExpression: '0 4 * * *',
    description:
      'Execute adversarial red-team arena sweep and anchor audit leaf in Merkle transparency log.',
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  },
  {
    jobName: AI_M15_EPISTEMIC_CALIBRATION_AUDIT_JOB,
    cronExpression: '0 */6 * * *',
    description:
      'Compute Brier/ECE epistemic calibration metrics and derive bounded autonomy policy.',
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  },
  {
    jobName: AI_M17_INCIDENT_HEALER_SWEEP_JOB,
    cronExpression: '*/15 * * * *',
    description:
      'Synthesize redacted incident healing proposals and fuzz-verify candidate policy invariants.',
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  },
];

export interface CandidateAblationInputSet {
  readonly baselineResults: readonly AblationCaseResult[];
  readonly candidateResults: readonly AblationCaseResult[];
}

export interface EvolutionCycleJobInput {
  readonly companyId: number;
  readonly synthesis: EvolutionSynthesisInput;
  readonly ablationByCandidateId?: Readonly<Record<string, CandidateAblationInputSet>>;
  readonly defaultAblation?: CandidateAblationInputSet;
}

export interface EvolutionCycleJobResult {
  readonly jobName: typeof AI_EVOLUTION_CYCLE_JOB;
  readonly companyId: number;
  readonly selfPromoted: false;
  readonly requiresHumanApproval: true;
  readonly automatedPromotionAllowed: false;
  readonly synthesis: EvolutionSynthesisResult;
  readonly ablationReports: readonly CandidateAblationGateReport[];
  readonly eligibleCandidateIds: readonly string[];
  readonly cycleSha256: string;
}

export interface ObligationSweepJobInput {
  readonly companyId: number;
  readonly obligations: readonly MonitorObligationRecord[];
  readonly worldSnapshot: WorldStateSnapshot;
  readonly options?: EvaluateObligationDriftOptions;
}

export interface ObligationSweepJobResult {
  readonly jobName: typeof AI_OBLIGATION_SWEEP_JOB;
  readonly companyId: number;
  readonly selfAccepted: false;
  readonly requiresHumanApproval: true;
  readonly automatedAcceptanceAllowed: false;
  readonly report: ObligationDriftReport;
  readonly driftedCount: number;
  readonly proposalCount: number;
  readonly sweepSha256: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertPositiveCompanyId(companyId: number, label: string): void {
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

export function runEvolutionCycleJob(input: EvolutionCycleJobInput): EvolutionCycleJobResult {
  assertPositiveCompanyId(input.companyId, 'companyId');
  if (input.synthesis.companyId !== input.companyId) {
    throw new Error('Cross-company evolution cycle job is forbidden');
  }

  const synthesis = synthesizeEvolutionCandidates(input.synthesis);
  const ablationReports: CandidateAblationGateReport[] = [];

  if (synthesis.accepted) {
    for (const candidate of synthesis.candidates) {
      const ablationInput =
        input.ablationByCandidateId?.[candidate.candidateId] ?? input.defaultAblation;
      if (!ablationInput) continue;

      const report = runCandidateAblationGate({
        candidateId: candidate.candidateId,
        baselineResults: ablationInput.baselineResults,
        candidateResults: ablationInput.candidateResults,
      });
      ablationReports.push(report);
    }
  }

  const eligibleCandidateIds = ablationReports
    .filter((report) => report.eligibleForWorkflowPromotion)
    .map((report) => report.candidateId)
    .sort((a, b) => a.localeCompare(b));

  const cycleSha256 = sha256Hex(
    JSON.stringify({
      jobName: AI_EVOLUTION_CYCLE_JOB,
      companyId: input.companyId,
      synthesisSha256: synthesis.synthesisSha256,
      ablationGateShas: ablationReports.map((report) => report.gateSha256),
      eligibleCandidateIds,
      selfPromoted: false,
    })
  );

  return {
    jobName: AI_EVOLUTION_CYCLE_JOB,
    companyId: input.companyId,
    selfPromoted: false,
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    synthesis,
    ablationReports,
    eligibleCandidateIds,
    cycleSha256,
  };
}

export function runObligationSweepJob(input: ObligationSweepJobInput): ObligationSweepJobResult {
  assertPositiveCompanyId(input.companyId, 'companyId');
  if (input.worldSnapshot.companyId !== input.companyId) {
    throw new Error('Cross-company obligation sweep job is forbidden');
  }

  const report = evaluateObligationDrift(input.obligations, input.worldSnapshot, input.options);
  const driftedCount = report.evaluations.filter(
    (evaluation) => evaluation.status !== 'intact'
  ).length;
  const proposalCount = report.proposals.length;

  const sweepSha256 = sha256Hex(
    JSON.stringify({
      jobName: AI_OBLIGATION_SWEEP_JOB,
      companyId: input.companyId,
      reportSha256: report.reportSha256,
      driftedCount,
      proposalCount,
      selfAccepted: false,
    })
  );

  return {
    jobName: AI_OBLIGATION_SWEEP_JOB,
    companyId: input.companyId,
    selfAccepted: false,
    requiresHumanApproval: true,
    automatedAcceptanceAllowed: false,
    report,
    driftedCount,
    proposalCount,
    sweepSha256,
  };
}

export interface SleepDreamConsolidationJobInput {
  readonly companyId: number;
  readonly nowIso: string;
  readonly memories: readonly EpisodicMemoryItem[];
  readonly knowledgeNodes?: readonly DreamKnowledgeNode[];
  readonly skillNodes?: readonly DreamSkillNode[];
  readonly consolidationOptions?: Omit<NonRemConsolidationOptions, 'companyId' | 'nowIso'>;
}

export interface SleepDreamConsolidationJobResult {
  readonly jobName: typeof AI_M16_SLEEP_DREAM_CONSOLIDATION_JOB;
  readonly companyId: number;
  readonly selfPromoted: false;
  readonly requiresHumanApproval: true;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
  readonly nonRemReport: NonRemConsolidationReport;
  readonly remProbeReport: RemDreamSelfProbeReport;
  readonly survivingCount: number;
  readonly decayedCount: number;
  readonly semanticCandidateCount: number;
  readonly probeCount: number;
  readonly cycleSha256: string;
}

export function runSleepDreamConsolidationJob(
  input: SleepDreamConsolidationJobInput
): SleepDreamConsolidationJobResult {
  assertPositiveCompanyId(input.companyId, 'companyId');

  const nonRemReport = runNonRemConsolidation(input.memories, {
    ...input.consolidationOptions,
    companyId: String(input.companyId),
    nowIso: input.nowIso,
  });

  const remProbeReport = runRemDreamSelfProbe(input.knowledgeNodes ?? [], input.skillNodes ?? []);

  const semanticCandidateCount = nonRemReport.semanticCandidates.length;
  const probeCount = remProbeReport.probes.length;

  const cycleSha256 = sha256Hex(
    JSON.stringify({
      jobName: AI_M16_SLEEP_DREAM_CONSOLIDATION_JOB,
      companyId: input.companyId,
      nonRemReportSha256: nonRemReport.reportSha256,
      probeCount,
      survivingCount: nonRemReport.survivingCount,
      decayedCount: nonRemReport.decayedCount,
      automatedPromotionAllowed: false,
      automatedSelfMerge: false,
    })
  );

  return {
    jobName: AI_M16_SLEEP_DREAM_CONSOLIDATION_JOB,
    companyId: input.companyId,
    selfPromoted: false,
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
    nonRemReport,
    remProbeReport,
    survivingCount: nonRemReport.survivingCount,
    decayedCount: nonRemReport.decayedCount,
    semanticCandidateCount,
    probeCount,
    cycleSha256,
  };
}

export interface RedTeamArenaSweepJobInput {
  readonly companyId: number;
  readonly blueTeamEvaluator: BlueTeamEvaluator;
  readonly scenarios?: readonly RedTeamScenario[];
  readonly priorAuditEvents?: readonly unknown[];
}

export interface RedTeamArenaSweepJobResult {
  readonly jobName: typeof AI_M16_REDTEAM_ARENA_SWEEP_JOB;
  readonly companyId: number;
  readonly selfPromoted: false;
  readonly requiresHumanApproval: true;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
  readonly arenaReport: AdversarialRedTeamArenaReport;
  readonly merkleAuditTree: MerkleAuditTree;
  readonly inclusionProof: MerkleInclusionProof;
  readonly merkleRootHash: string;
  readonly breachCount: number;
  readonly defensePassRateBps: number;
  readonly sweepSha256: string;
}

export function runRedTeamArenaSweepJob(
  input: RedTeamArenaSweepJobInput
): RedTeamArenaSweepJobResult {
  assertPositiveCompanyId(input.companyId, 'companyId');

  const scenarios = input.scenarios ?? DEFAULT_REDTEAM_SCENARIOS;
  const arenaReport = runAdversarialRedTeamArena(scenarios, input.blueTeamEvaluator);

  const auditLeaf = {
    jobName: AI_M16_REDTEAM_ARENA_SWEEP_JOB,
    companyId: input.companyId,
    arenaSha256: arenaReport.arenaSha256,
    totalScenarios: arenaReport.totalScenarios,
    blockedCount: arenaReport.blockedCount,
    breachCount: arenaReport.breachCount,
    defensePassRateBps: arenaReport.defensePassRateBps,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  };

  const allAuditEvents: readonly unknown[] = [...(input.priorAuditEvents ?? []), auditLeaf];
  const merkleAuditTree = buildMerkleAuditTree(allAuditEvents);
  const inclusionProof = generateMerkleInclusionProof(
    merkleAuditTree,
    merkleAuditTree.leafCount - 1
  );

  const sweepSha256 = sha256Hex(
    JSON.stringify({
      jobName: AI_M16_REDTEAM_ARENA_SWEEP_JOB,
      companyId: input.companyId,
      arenaSha256: arenaReport.arenaSha256,
      merkleRootHash: merkleAuditTree.rootHash,
      proofSha256: inclusionProof.proofSha256,
      automatedPromotionAllowed: false,
      automatedSelfMerge: false,
    })
  );

  return {
    jobName: AI_M16_REDTEAM_ARENA_SWEEP_JOB,
    companyId: input.companyId,
    selfPromoted: false,
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
    arenaReport,
    merkleAuditTree,
    inclusionProof,
    merkleRootHash: merkleAuditTree.rootHash,
    breachCount: arenaReport.breachCount,
    defensePassRateBps: arenaReport.defensePassRateBps,
    sweepSha256,
  };
}

export interface EpistemicCalibrationAuditJobInput {
  readonly companyId: number;
  readonly predictions: readonly EpistemicPredictionSample[];
  readonly calibrationOptions?: EpistemicCalibrationOptions;
  readonly policyThresholds?: AutonomyPolicyThresholds;
}

export interface EpistemicCalibrationAuditJobResult {
  readonly jobName: typeof AI_M15_EPISTEMIC_CALIBRATION_AUDIT_JOB;
  readonly companyId: number;
  readonly selfPromoted: false;
  readonly requiresHumanApproval: true;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
  readonly r4HumanGateLocked: true;
  readonly calibrationReport: EpistemicCalibrationReport;
  readonly autonomyPolicy: DynamicAutonomyPolicy;
  readonly driftDetected: boolean;
  readonly auditSha256: string;
}

export function runEpistemicCalibrationAuditJob(
  input: EpistemicCalibrationAuditJobInput
): EpistemicCalibrationAuditJobResult {
  assertPositiveCompanyId(input.companyId, 'companyId');

  const calibrationReport = computeEpistemicCalibration(
    input.predictions,
    input.calibrationOptions
  );
  const autonomyPolicy = deriveDynamicAutonomyPolicy(calibrationReport, input.policyThresholds);
  const driftDetected = autonomyPolicy.mode !== 'standard';

  const auditSha256 = sha256Hex(
    JSON.stringify({
      jobName: AI_M15_EPISTEMIC_CALIBRATION_AUDIT_JOB,
      companyId: input.companyId,
      calibrationSha256: calibrationReport.calibrationSha256,
      policySha256: autonomyPolicy.policySha256,
      driftDetected,
      automatedPromotionAllowed: false,
      automatedSelfMerge: false,
    })
  );

  return {
    jobName: AI_M15_EPISTEMIC_CALIBRATION_AUDIT_JOB,
    companyId: input.companyId,
    selfPromoted: false,
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
    r4HumanGateLocked: true,
    calibrationReport,
    autonomyPolicy,
    driftDetected,
    auditSha256,
  };
}

export interface IncidentHealerSweepJobInput {
  readonly companyId: number;
  readonly incidentId: string;
  readonly logs: readonly StructuredIncidentLog[];
  readonly checkpoints?: readonly CausalCheckpoint[];
  readonly baselinePolicyRules: readonly PolicyRuleSpec[];
  readonly candidatePolicyRules: readonly PolicyRuleSpec[];
  readonly fuzzerOptions?: PolicyFuzzerOptions;
}

export interface IncidentHealerSweepJobResult {
  readonly jobName: typeof AI_M17_INCIDENT_HEALER_SWEEP_JOB;
  readonly companyId: number;
  readonly selfPromoted: false;
  readonly requiresHumanApproval: true;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
  readonly healingProposal: IncidentHealingProposal;
  readonly policyFuzzReport: PolicyFuzzReport;
  readonly policyFuzzPassed: boolean;
  readonly faultClusterCount: number;
  readonly sweepSha256: string;
}

export function runIncidentHealerSweepJob(
  input: IncidentHealerSweepJobInput
): IncidentHealerSweepJobResult {
  assertPositiveCompanyId(input.companyId, 'companyId');

  const healingProposal = synthesizeIncidentHealingProposal(
    input.incidentId,
    input.logs,
    input.checkpoints ?? []
  );

  const policyFuzzReport = fuzzPolicyInvariants(
    input.baselinePolicyRules,
    input.candidatePolicyRules,
    input.fuzzerOptions
  );

  const sweepSha256 = sha256Hex(
    JSON.stringify({
      jobName: AI_M17_INCIDENT_HEALER_SWEEP_JOB,
      companyId: input.companyId,
      proposalSha256: healingProposal.proposalSha256,
      fuzzReportSha256: policyFuzzReport.fuzzReportSha256,
      policyFuzzPassed: policyFuzzReport.passed,
      automatedPromotionAllowed: false,
      automatedSelfMerge: false,
    })
  );

  return {
    jobName: AI_M17_INCIDENT_HEALER_SWEEP_JOB,
    companyId: input.companyId,
    selfPromoted: false,
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
    healingProposal,
    policyFuzzReport,
    policyFuzzPassed: policyFuzzReport.passed,
    faultClusterCount: healingProposal.faultClusters.length,
    sweepSha256,
  };
}
