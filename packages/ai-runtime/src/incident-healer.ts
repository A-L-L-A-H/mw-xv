import { sha256Canonical } from './canonical-json.js';
import { createRedactor } from './redaction.js';
import {
  evaluateExpectedFreeEnergy,
  type ActiveInferenceCandidate,
  type ActiveInferenceDecision,
} from './active-inference.js';
import {
  findCausalDivergencePoint,
  type CausalCheckpoint,
  type CausalDivergencePoint,
} from './causal-replay.js';

export interface StructuredIncidentLog {
  readonly timestamp: string;
  readonly service: string;
  readonly level: 'info' | 'warn' | 'error' | 'fatal';
  readonly errorCode?: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IncidentFaultCluster {
  readonly signature: string;
  readonly service: string;
  readonly errorCode: string;
  readonly occurrenceCount: number;
  readonly sampleMessages: readonly string[];
}

export interface IncidentHealingProposal {
  readonly incidentId: string;
  readonly redactedLogCount: number;
  readonly faultClusters: readonly IncidentFaultCluster[];
  readonly primaryCluster: IncidentFaultCluster | null;
  readonly causalDivergence: CausalDivergencePoint | null;
  readonly efeDecision: ActiveInferenceDecision;
  readonly rcaSummary: string;
  readonly runbookSteps: readonly string[];
  readonly patchCandidateSummary: string;
  readonly requiresHumanApproval: true;
  readonly automatedSelfMerge: false;
  readonly automatedPromotionAllowed: false;
  readonly proposalSha256: string;
}

function normalizeFaultSignature(service: string, errorCode: string, message: string): string {
  const normalizedMsg = message
    .replace(/\b[0-9a-f]{8,}\b/giu, '<hex>')
    .replace(/\b\d+\b/gu, '<num>')
    .slice(0, 80);
  return `${service}:${errorCode}:${normalizedMsg}`;
}

export function synthesizeIncidentHealingProposal(
  incidentId: string,
  logs: readonly StructuredIncidentLog[],
  checkpoints: readonly CausalCheckpoint[] = []
): IncidentHealingProposal {
  const redactor = createRedactor();
  const safeIncidentId = redactor.redactString(incidentId);

  const clusterMap = new Map<
    string,
    { service: string; errorCode: string; count: number; samples: string[] }
  >();

  for (const entry of logs) {
    if (entry.level !== 'error' && entry.level !== 'fatal') {
      continue;
    }
    const safeService = redactor.redactString(entry.service);
    const safeCode = redactor.redactString(entry.errorCode ?? 'UNCLASSIFIED_ERROR');
    const safeMessage = redactor.redactString(entry.message);
    const sig = normalizeFaultSignature(safeService, safeCode, safeMessage);
    const existing = clusterMap.get(sig);
    if (existing) {
      existing.count += 1;
      if (existing.samples.length < 3) {
        existing.samples.push(safeMessage);
      }
    } else {
      clusterMap.set(sig, {
        service: safeService,
        errorCode: safeCode,
        count: 1,
        samples: [safeMessage],
      });
    }
  }

  const faultClusters: IncidentFaultCluster[] = [...clusterMap.entries()]
    .map(([signature, data]) => ({
      signature,
      service: data.service,
      errorCode: data.errorCode,
      occurrenceCount: data.count,
      sampleMessages: data.samples,
    }))
    .sort(
      (a, b) => b.occurrenceCount - a.occurrenceCount || a.signature.localeCompare(b.signature)
    );

  const primaryCluster = faultClusters[0] ?? null;
  const causalDivergence =
    checkpoints.length > 0 ? findCausalDivergencePoint(checkpoints, { redactor }) : null;

  const hasStrongEvidence =
    primaryCluster !== null &&
    (primaryCluster.occurrenceCount >= 2 || Boolean(causalDivergence?.diverged));

  const candidates: ActiveInferenceCandidate[] = [
    {
      actionId: 'propose_targeted_patch_and_runbook',
      kind: 'pragmatic_action',
      label: 'Synthesize targeted patch candidate and operator runbook',
      goalAlignmentBps: hasStrongEvidence ? 9000 : 5000,
      successProbabilityBps: hasStrongEvidence ? 8200 : 4000,
      priorUncertaintyBps: hasStrongEvidence ? 2500 : 7500,
      expectedPosteriorUncertaintyBps: 1500,
      estimatedTokens: 1200,
      estimatedLatencyMs: 1500,
      reversible: true,
    },
    {
      actionId: 'collect_additional_telemetry',
      kind: 'epistemic_action',
      label: 'Collect additional trace and checkpoint telemetry before patching',
      goalAlignmentBps: 7000,
      successProbabilityBps: 9000,
      priorUncertaintyBps: hasStrongEvidence ? 2500 : 8000,
      expectedPosteriorUncertaintyBps: 1200,
      estimatedTokens: 600,
      estimatedLatencyMs: 800,
      reversible: true,
    },
  ];

  const efeDecision = evaluateExpectedFreeEnergy(candidates);

  const rcaSummary = primaryCluster
    ? `Primary fault cluster in ${primaryCluster.service} (${primaryCluster.errorCode}, ${String(primaryCluster.occurrenceCount)} occurrence(s))${
        causalDivergence?.diverged && causalDivergence.rootCause
          ? `; counterfactual replay attributes root cause to ${causalDivergence.rootCause.category}`
          : ''
      }.`
    : 'No recurring error or fatal fault clusters detected in redacted logs.';

  const runbookSteps: string[] = primaryCluster
    ? [
        `Inspect redacted fault signature ${primaryCluster.signature} in service ${primaryCluster.service}.`,
        'Validate candidate patch inside an ephemeral zero-network sandbox before review.',
        'Require explicit human operator sign-off before merging or deploying any remediation.',
      ]
    : ['Continue monitoring redacted telemetry; no immediate remediation required.'];

  const patchCandidateSummary = primaryCluster
    ? `Draft defensive guard and regression test for ${primaryCluster.service}:${primaryCluster.errorCode} (human review required).`
    : 'No patch candidate generated.';

  const core = {
    incidentId: safeIncidentId,
    redactedLogCount: logs.length,
    faultClusters,
    primaryCluster,
    causalDivergence,
    efeDecision,
    rcaSummary,
    runbookSteps,
    patchCandidateSummary,
    requiresHumanApproval: true as const,
    automatedSelfMerge: false as const,
    automatedPromotionAllowed: false as const,
  };

  return {
    ...core,
    proposalSha256: sha256Canonical(core),
  };
}
