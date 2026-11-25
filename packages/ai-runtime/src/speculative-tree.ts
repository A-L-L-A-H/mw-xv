import { sha256Canonical } from './canonical-json.js';
import { clampBps } from './sort-utils.js';
import { createRedactor, type RedactionContext } from './redaction.js';

export type SpeculativeBranchDisqualificationReason =
  'proof_gate_v2_failed' | 'scope_not_clean' | 'invalid_test_metrics' | 'invalid_cost_or_latency';

export interface TrajectoryEventInput {
  readonly stepIndex: number;
  readonly kind: 'thought' | 'tool_call' | 'tool_result' | 'verification' | 'error';
  readonly summary: string;
  readonly toolName?: string;
  readonly succeeded?: boolean;
}

export interface CompressedTrajectorySummary {
  readonly branchId: string;
  readonly totalEvents: number;
  readonly toolCallCount: number;
  readonly errorCount: number;
  readonly highlights: readonly string[];
  readonly summaryText: string;
  readonly compressedSha256: string;
}

export interface SpeculativeBranchInput {
  readonly branchId: string;
  readonly worktreeRef?: string;
  readonly proofGatePassed: boolean;
  readonly scopeClean: boolean;
  readonly testsPassed: number;
  readonly testsTotal: number;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly qualityScoreBps?: number;
  readonly trajectoryEvents?: readonly TrajectoryEventInput[];
  readonly notes?: string;
}

export interface EligibleSpeculativeBranch {
  readonly branchId: string;
  readonly worktreeRef?: string;
  readonly testPassRateBps: number;
  readonly qualityScoreBps: number;
  readonly compositeScoreBps: number;
  readonly latencyMs: number;
  readonly costUsdMicros: number;
  readonly trajectorySummary: CompressedTrajectorySummary;
  readonly notes?: string;
}

export interface DisqualifiedSpeculativeBranch {
  readonly branchId: string;
  readonly reasons: readonly SpeculativeBranchDisqualificationReason[];
  readonly trajectorySummary: CompressedTrajectorySummary;
}

export interface TournamentMatch {
  readonly round: number;
  readonly matchIndex: number;
  readonly contestantBranchIds: readonly string[];
  readonly winnerBranchId: string;
  readonly rationale: string;
}

export interface TournamentRound {
  readonly round: number;
  readonly matches: readonly TournamentMatch[];
  readonly advancingBranchIds: readonly string[];
}

export interface RecursiveTournamentOptions {
  readonly groupSize?: number;
  readonly secrets?: readonly string[];
}

export interface RecursiveTournamentResult {
  readonly winnerBranchId: string | null;
  readonly rankedBranchIds: readonly string[];
  readonly rounds: readonly TournamentRound[];
  readonly voteCounts: Readonly<Record<string, number>>;
  readonly tournamentSha256: string;
}

export interface SpeculativeTournamentReport {
  readonly status: 'winner_selected' | 'no_eligible_branch';
  readonly automatedSelfAccept: false;
  readonly winningBranchId: string | null;
  readonly totalBranchesEvaluated: number;
  readonly eligibleBranches: readonly EligibleSpeculativeBranch[];
  readonly disqualifiedBranches: readonly DisqualifiedSpeculativeBranch[];
  readonly tournament: RecursiveTournamentResult;
  readonly reportSha256: string;
}

const DEFAULT_MAX_HIGHLIGHTS = 8;
const DEFAULT_MAX_SUMMARY_CHARS = 1_200;

function buildRedactor(secrets?: readonly string[]): RedactionContext {
  const redactor = createRedactor();
  if (secrets) {
    for (const secret of secrets) {
      redactor.registerSecret(secret);
    }
  }
  return redactor;
}

function toCostUsdMicros(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.round(costUsd * 1_000_000);
}

export function compressTrajectorySummary(
  branchId: string,
  events: readonly TrajectoryEventInput[] = [],
  options?: {
    readonly maxHighlights?: number;
    readonly maxSummaryChars?: number;
    readonly redactor?: RedactionContext;
    readonly secrets?: readonly string[];
  }
): CompressedTrajectorySummary {
  const redactor = options?.redactor ?? buildRedactor(options?.secrets);
  const maxHighlights = Math.max(1, options?.maxHighlights ?? DEFAULT_MAX_HIGHLIGHTS);
  const maxSummaryChars = Math.max(64, options?.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS);

  const sortedEvents = [...events].sort((left, right) => left.stepIndex - right.stepIndex);
  let toolCallCount = 0;
  let errorCount = 0;
  const highlights: string[] = [];

  for (const event of sortedEvents) {
    if (event.kind === 'tool_call') {
      toolCallCount += 1;
    }
    if (event.kind === 'error' || event.succeeded === false) {
      errorCount += 1;
    }
    if (highlights.length < maxHighlights) {
      const toolTag = event.toolName ? `[${redactor.redactString(event.toolName)}]` : '';
      const cleanSummary = redactor.redactString(event.summary).replace(/\s+/gu, ' ').trim();
      highlights.push(`#${event.stepIndex} ${event.kind}${toolTag}: ${cleanSummary}`);
    }
  }

  const rawSummary =
    highlights.length > 0
      ? highlights.join(' | ')
      : `branch=${redactor.redactString(branchId)} events=0`;
  const summaryText =
    rawSummary.length > maxSummaryChars
      ? `${rawSummary.slice(0, maxSummaryChars - 3)}...`
      : rawSummary;

  const cleanBranchId = redactor.redactString(branchId);
  const corePayload = {
    branchId: cleanBranchId,
    totalEvents: sortedEvents.length,
    toolCallCount,
    errorCount,
    highlights,
    summaryText,
  };

  return {
    ...corePayload,
    compressedSha256: sha256Canonical(corePayload),
  };
}

function compareEligibleBranches(
  left: EligibleSpeculativeBranch,
  right: EligibleSpeculativeBranch
): number {
  if (left.compositeScoreBps !== right.compositeScoreBps) {
    return right.compositeScoreBps - left.compositeScoreBps;
  }
  if (left.testPassRateBps !== right.testPassRateBps) {
    return right.testPassRateBps - left.testPassRateBps;
  }
  if (left.latencyMs !== right.latencyMs) {
    return left.latencyMs - right.latencyMs;
  }
  if (left.costUsdMicros !== right.costUsdMicros) {
    return left.costUsdMicros - right.costUsdMicros;
  }
  return left.branchId.localeCompare(right.branchId);
}

export function runRecursiveTournamentVoting(
  candidates: readonly EligibleSpeculativeBranch[],
  options?: RecursiveTournamentOptions
): RecursiveTournamentResult {
  const redactor = buildRedactor(options?.secrets);
  const groupSize = Math.max(2, Math.floor(options?.groupSize ?? 2));

  if (candidates.length === 0) {
    const emptyPayload = {
      winnerBranchId: null,
      rankedBranchIds: [] as string[],
      rounds: [] as TournamentRound[],
      voteCounts: {} as Record<string, number>,
    };
    return {
      ...emptyPayload,
      tournamentSha256: sha256Canonical(emptyPayload),
    };
  }

  // Deterministic initial bracket seeding by branchId
  let currentPool = [...candidates].sort((left, right) =>
    left.branchId.localeCompare(right.branchId)
  );
  const voteCounts: Record<string, number> = {};
  for (const candidate of currentPool) {
    voteCounts[candidate.branchId] = 0;
  }

  const rounds: TournamentRound[] = [];
  let roundNumber = 1;

  while (currentPool.length > 1) {
    const matches: TournamentMatch[] = [];
    const nextPool: EligibleSpeculativeBranch[] = [];

    for (let offset = 0; offset < currentPool.length; offset += groupSize) {
      const group = currentPool.slice(offset, offset + groupSize);
      const sortedGroup = [...group].sort(compareEligibleBranches);
      const winner = sortedGroup[0];
      if (!winner) {
        continue;
      }

      voteCounts[winner.branchId] = (voteCounts[winner.branchId] ?? 0) + 1;
      nextPool.push(winner);

      const contestantBranchIds = group.map((entry) => entry.branchId);
      const rationale = redactor.redactString(
        `winner=${winner.branchId} composite=${winner.compositeScoreBps}bps passRate=${winner.testPassRateBps}bps latency=${winner.latencyMs}ms costMicros=${winner.costUsdMicros}`
      );

      matches.push({
        round: roundNumber,
        matchIndex: matches.length,
        contestantBranchIds,
        winnerBranchId: winner.branchId,
        rationale,
      });
    }

    rounds.push({
      round: roundNumber,
      matches,
      advancingBranchIds: nextPool.map((entry) => entry.branchId),
    });

    currentPool = nextPool;
    roundNumber += 1;
  }

  const winnerBranchId = currentPool[0]?.branchId ?? null;
  const rankedBranchIds = [...candidates]
    .sort((left, right) => {
      const leftVotes = voteCounts[left.branchId] ?? 0;
      const rightVotes = voteCounts[right.branchId] ?? 0;
      if (leftVotes !== rightVotes) {
        return rightVotes - leftVotes;
      }
      return compareEligibleBranches(left, right);
    })
    .map((entry) => entry.branchId);

  const corePayload = {
    winnerBranchId,
    rankedBranchIds,
    rounds,
    voteCounts,
  };

  return {
    ...corePayload,
    tournamentSha256: sha256Canonical(corePayload),
  };
}

export function selectWinningSpeculativeBranch(
  branches: readonly SpeculativeBranchInput[],
  options?: RecursiveTournamentOptions
): SpeculativeTournamentReport {
  const redactor = buildRedactor(options?.secrets);
  const eligibleBranches: EligibleSpeculativeBranch[] = [];
  const disqualifiedBranches: DisqualifiedSpeculativeBranch[] = [];

  for (const branch of branches) {
    const cleanBranchId = redactor.redactString(branch.branchId);
    const trajectorySummary = compressTrajectorySummary(cleanBranchId, branch.trajectoryEvents, {
      redactor,
    });

    const reasons: SpeculativeBranchDisqualificationReason[] = [];
    if (branch.proofGatePassed !== true) {
      reasons.push('proof_gate_v2_failed');
    }
    if (branch.scopeClean !== true) {
      reasons.push('scope_not_clean');
    }
    if (
      !Number.isInteger(branch.testsPassed) ||
      !Number.isInteger(branch.testsTotal) ||
      branch.testsPassed < 0 ||
      branch.testsTotal < 0 ||
      branch.testsPassed > branch.testsTotal
    ) {
      reasons.push('invalid_test_metrics');
    }
    if (
      !Number.isFinite(branch.latencyMs) ||
      branch.latencyMs < 0 ||
      !Number.isFinite(branch.costUsd) ||
      branch.costUsd < 0
    ) {
      reasons.push('invalid_cost_or_latency');
    }

    if (reasons.length > 0) {
      disqualifiedBranches.push({
        branchId: cleanBranchId,
        reasons,
        trajectorySummary,
      });
      continue;
    }

    const testPassRateBps =
      branch.testsTotal === 0 ? 0 : clampBps((branch.testsPassed / branch.testsTotal) * 10_000);
    const qualityScoreBps = clampBps(branch.qualityScoreBps ?? testPassRateBps);
    // Deterministic 70% objective test pass rate + 30% quality score
    const compositeScoreBps = clampBps(testPassRateBps * 0.7 + qualityScoreBps * 0.3);

    eligibleBranches.push({
      branchId: cleanBranchId,
      ...(branch.worktreeRef !== undefined
        ? { worktreeRef: redactor.redactString(branch.worktreeRef) }
        : {}),
      testPassRateBps,
      qualityScoreBps,
      compositeScoreBps,
      latencyMs: Math.round(branch.latencyMs),
      costUsdMicros: toCostUsdMicros(branch.costUsd),
      trajectorySummary,
      ...(branch.notes !== undefined ? { notes: redactor.redactString(branch.notes) } : {}),
    });
  }

  eligibleBranches.sort(compareEligibleBranches);
  disqualifiedBranches.sort((left, right) => left.branchId.localeCompare(right.branchId));

  const tournament = runRecursiveTournamentVoting(eligibleBranches, options);
  const status: SpeculativeTournamentReport['status'] =
    tournament.winnerBranchId !== null ? 'winner_selected' : 'no_eligible_branch';

  const coreReport = {
    status,
    automatedSelfAccept: false as const,
    winningBranchId: tournament.winnerBranchId,
    totalBranchesEvaluated: branches.length,
    eligibleBranches,
    disqualifiedBranches,
    tournament,
  };

  return {
    ...coreReport,
    reportSha256: sha256Canonical(coreReport),
  };
}
