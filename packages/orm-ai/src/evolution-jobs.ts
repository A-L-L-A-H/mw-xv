import { createHash } from 'node:crypto';
import {
  evaluateObligationDrift,
  synthesizeEvolutionCandidates,
  type EvaluateObligationDriftOptions,
  type EvolutionSynthesisInput,
  type EvolutionSynthesisResult,
  type MonitorObligationRecord,
  type ObligationDriftReport,
  type WorldStateSnapshot,
} from '@moonwitness/ai-runtime';
import {
  runCandidateAblationGate,
  type AblationCaseResult,
  type CandidateAblationGateReport,
} from '@moonwitness/ai-evaluation';

export const AI_EVOLUTION_CYCLE_JOB = 'ai.evolution_cycle@v1' as const;
export const AI_OBLIGATION_SWEEP_JOB = 'ai.obligation_sweep@v1' as const;

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

export function runEvolutionCycleJob(
  input: EvolutionCycleJobInput
): EvolutionCycleJobResult {
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

export function runObligationSweepJob(
  input: ObligationSweepJobInput
): ObligationSweepJobResult {
  assertPositiveCompanyId(input.companyId, 'companyId');
  if (input.worldSnapshot.companyId !== input.companyId) {
    throw new Error('Cross-company obligation sweep job is forbidden');
  }

  const report = evaluateObligationDrift(
    input.obligations,
    input.worldSnapshot,
    input.options
  );
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
