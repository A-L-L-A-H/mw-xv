import { createHash } from 'node:crypto';

export interface AblationCaseResult {
  readonly caseId: string;
  readonly passed: boolean;
  readonly harmed?: boolean;
  readonly score?: number;
  readonly notes?: string;
}

export interface CandidateAblationGateInput {
  readonly candidateId: string;
  readonly baselineResults: readonly AblationCaseResult[];
  readonly candidateResults: readonly AblationCaseResult[];
}

export type AblationCaseOutcome =
  'improved' | 'regressed' | 'harmed' | 'unchanged_pass' | 'unchanged_fail';

export interface AblationCaseDelta {
  readonly caseId: string;
  readonly baselinePassed: boolean;
  readonly candidatePassed: boolean;
  readonly candidateHarmed: boolean;
  readonly outcome: AblationCaseOutcome;
}

export interface CandidateAblationGateReport {
  readonly candidateId: string;
  readonly totalCases: number;
  readonly baselinePassRate: number;
  readonly candidatePassRate: number;
  readonly passRateDelta: number;
  readonly improvementCount: number;
  readonly regressionCount: number;
  readonly harmCount: number;
  readonly eligibleForWorkflowPromotion: boolean;
  readonly caseDeltas: readonly AblationCaseDelta[];
  readonly gateSha256: string;
}

function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function runCandidateAblationGate(
  input: CandidateAblationGateInput
): CandidateAblationGateReport {
  const baselineById = new Map<string, AblationCaseResult>();
  for (const result of input.baselineResults) {
    baselineById.set(result.caseId, result);
  }

  const candidateById = new Map<string, AblationCaseResult>();
  for (const result of input.candidateResults) {
    candidateById.set(result.caseId, result);
  }

  const allCaseIds = Array.from(
    new Set<string>([...baselineById.keys(), ...candidateById.keys()])
  ).sort((a, b) => a.localeCompare(b));

  let baselinePassedCount = 0;
  let candidatePassedCount = 0;
  let improvementCount = 0;
  let regressionCount = 0;
  let harmCount = 0;

  const caseDeltas: AblationCaseDelta[] = [];

  for (const caseId of allCaseIds) {
    const baseline = baselineById.get(caseId);
    const candidate = candidateById.get(caseId);

    const baselinePassed = baseline?.passed === true;
    const candidatePassed = candidate?.passed === true;
    const candidateHarmed = candidate?.harmed === true;

    if (baselinePassed) {
      baselinePassedCount += 1;
    }
    if (candidatePassed) {
      candidatePassedCount += 1;
    }

    let outcome: AblationCaseOutcome;
    if (candidateHarmed) {
      harmCount += 1;
      if (baselinePassed && !candidatePassed) {
        regressionCount += 1;
      }
      outcome = 'harmed';
    } else if (baselinePassed && !candidatePassed) {
      regressionCount += 1;
      outcome = 'regressed';
    } else if (!baselinePassed && candidatePassed) {
      improvementCount += 1;
      outcome = 'improved';
    } else if (baselinePassed && candidatePassed) {
      outcome = 'unchanged_pass';
    } else {
      outcome = 'unchanged_fail';
    }

    caseDeltas.push({
      caseId,
      baselinePassed,
      candidatePassed,
      candidateHarmed,
      outcome,
    });
  }

  const totalCases = allCaseIds.length;
  const baselinePassRate = totalCases > 0 ? roundRate(baselinePassedCount / totalCases) : 0;
  const candidatePassRate = totalCases > 0 ? roundRate(candidatePassedCount / totalCases) : 0;
  const passRateDelta = roundRate(candidatePassRate - baselinePassRate);

  const eligibleForWorkflowPromotion =
    totalCases > 0 && passRateDelta > 0 && regressionCount === 0 && harmCount === 0;

  const gateSha256 = sha256Hex(
    JSON.stringify({
      candidateId: input.candidateId,
      totalCases,
      baselinePassRate,
      candidatePassRate,
      passRateDelta,
      improvementCount,
      regressionCount,
      harmCount,
      eligibleForWorkflowPromotion,
      caseDeltas,
    })
  );

  return {
    candidateId: input.candidateId,
    totalCases,
    baselinePassRate,
    candidatePassRate,
    passRateDelta,
    improvementCount,
    regressionCount,
    harmCount,
    eligibleForWorkflowPromotion,
    caseDeltas,
    gateSha256,
  };
}
