import { sha256Hex } from './canonical-json.js';
import { createRedactor, type RedactionContext } from './redaction.js';

export interface ProofGateCheckSummary {
  readonly name: string;
  readonly passed: boolean;
  readonly summary?: string;
}

export interface EvolutionSynthesisInput {
  readonly companyId: number;
  readonly runId: string;
  readonly workContractId: string;
  readonly proofGatePassed: boolean;
  readonly checks: readonly ProofGateCheckSummary[];
  readonly diffSummary: string;
  readonly lessons: readonly string[];
  readonly skillSlug?: string;
  readonly scopeKind?: 'company' | 'project' | 'agent';
  readonly scopeRef?: string;
  readonly redactor?: RedactionContext;
  readonly knownSecrets?: readonly string[];
}

export interface EvolutionProposalGuardrails {
  readonly candidateOnly: true;
  readonly requiresHumanApproval: true;
  readonly automatedPromotionAllowed: false;
  readonly contentSha256: string;
}

export interface SkillVersionProposal extends EvolutionProposalGuardrails {
  readonly candidateId: string;
  readonly artifactKind: 'ai.skill_version';
  readonly companyId: number;
  readonly runId: string;
  readonly workContractId: string;
  readonly skillSlug: string;
  readonly title: string;
  readonly content: string;
  readonly verifiedChecks: readonly string[];
}

export interface MemoryCandidateProposal extends EvolutionProposalGuardrails {
  readonly candidateId: string;
  readonly artifactKind: 'ai.memory_candidate';
  readonly companyId: number;
  readonly runId: string;
  readonly workContractId: string;
  readonly scopeKind: 'company' | 'project' | 'agent';
  readonly scopeRef: string;
  readonly title: string;
  readonly content: string;
}

export type EvolutionCandidateProposal = SkillVersionProposal | MemoryCandidateProposal;

export type EvolutionRejectionReason = 'PROOF_GATE_NOT_PASSED';

export interface EvolutionSynthesisResult {
  readonly accepted: boolean;
  readonly reason?: EvolutionRejectionReason;
  readonly candidates: readonly EvolutionCandidateProposal[];
  readonly synthesisSha256: string;
}

function normalizeSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'verified-run-skill';
}

export function synthesizeEvolutionCandidates(
  input: EvolutionSynthesisInput
): EvolutionSynthesisResult {
  if (!input.proofGatePassed || !Number.isInteger(input.companyId) || input.companyId <= 0) {
    const rejectedHash = sha256Hex(
      JSON.stringify({
        accepted: false,
        reason: 'PROOF_GATE_NOT_PASSED',
        companyId: Number.isFinite(input.companyId) ? input.companyId : 0,
      })
    );
    return {
      accepted: false,
      reason: 'PROOF_GATE_NOT_PASSED',
      candidates: [],
      synthesisSha256: rejectedHash,
    };
  }

  const redactor = input.redactor ?? createRedactor();
  if (input.knownSecrets) {
    for (const secret of input.knownSecrets) {
      redactor.registerSecret(secret);
    }
  }

  const safeRunId = redactor.redactString(input.runId.trim());
  const safeWorkContractId = redactor.redactString(input.workContractId.trim());
  const safeDiffSummary = redactor.redactString(input.diffSummary.trim());

  const verifiedChecks = [...input.checks]
    .filter((check) => check.passed)
    .map((check) => {
      const safeName = redactor.redactString(check.name.trim());
      const safeSummary = check.summary ? redactor.redactString(check.summary.trim()) : '';
      return safeSummary.length > 0 ? `${safeName}: ${safeSummary}` : safeName;
    })
    .sort((a, b) => a.localeCompare(b));

  const deduplicatedLessons = Array.from(
    new Set(
      input.lessons
        .map((lesson) => redactor.redactString(lesson.trim()))
        .filter((lesson) => lesson.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  const skillSlug = normalizeSlug(input.skillSlug ?? `contract-${safeWorkContractId}`);
  const skillTitle = `Verified procedure for ${safeWorkContractId}`;
  const skillContentLines = [
    `Work contract: ${safeWorkContractId}`,
    `Source run: ${safeRunId}`,
    `Diff summary: ${safeDiffSummary || 'No diff summary recorded.'}`,
    `Verified checks: ${verifiedChecks.length > 0 ? verifiedChecks.join('; ') : 'None recorded'}`,
    ...(deduplicatedLessons.length > 0
      ? ['Lessons:', ...deduplicatedLessons.map((lesson) => `- ${lesson}`)]
      : []),
  ];
  const skillContent = skillContentLines.join('\n');
  const skillContentSha256 = sha256Hex(
    JSON.stringify({
      artifactKind: 'ai.skill_version',
      companyId: input.companyId,
      runId: safeRunId,
      workContractId: safeWorkContractId,
      skillSlug,
      title: skillTitle,
      content: skillContent,
      verifiedChecks,
    })
  );

  const skillProposal: SkillVersionProposal = {
    candidateId: `skill_cand_${skillContentSha256.slice(0, 16)}`,
    artifactKind: 'ai.skill_version',
    companyId: input.companyId,
    runId: safeRunId,
    workContractId: safeWorkContractId,
    skillSlug,
    title: skillTitle,
    content: skillContent,
    verifiedChecks,
    candidateOnly: true,
    requiresHumanApproval: true,
    automatedPromotionAllowed: false,
    contentSha256: skillContentSha256,
  };

  const scopeKind = input.scopeKind ?? 'project';
  const scopeRef = redactor.redactString((input.scopeRef ?? safeWorkContractId).trim());

  const memorySources =
    deduplicatedLessons.length > 0
      ? deduplicatedLessons
      : [safeDiffSummary || `Verified run ${safeRunId} passed Proof Gate v2.`];

  const memoryProposals: MemoryCandidateProposal[] = memorySources.map((lesson, index) => {
    const memoryTitle = `Lesson ${index + 1} from ${safeWorkContractId}`;
    const memoryContentSha256 = sha256Hex(
      JSON.stringify({
        artifactKind: 'ai.memory_candidate',
        companyId: input.companyId,
        runId: safeRunId,
        workContractId: safeWorkContractId,
        scopeKind,
        scopeRef,
        title: memoryTitle,
        content: lesson,
      })
    );
    return {
      candidateId: `mem_cand_${memoryContentSha256.slice(0, 16)}`,
      artifactKind: 'ai.memory_candidate',
      companyId: input.companyId,
      runId: safeRunId,
      workContractId: safeWorkContractId,
      scopeKind,
      scopeRef,
      title: memoryTitle,
      content: lesson,
      candidateOnly: true,
      requiresHumanApproval: true,
      automatedPromotionAllowed: false,
      contentSha256: memoryContentSha256,
    };
  });

  const candidates: readonly EvolutionCandidateProposal[] = [skillProposal, ...memoryProposals];

  const synthesisSha256 = sha256Hex(
    JSON.stringify({
      accepted: true,
      companyId: input.companyId,
      runId: safeRunId,
      workContractId: safeWorkContractId,
      candidateHashes: candidates.map((candidate) => candidate.contentSha256),
    })
  );

  return {
    accepted: true,
    candidates,
    synthesisSha256,
  };
}
