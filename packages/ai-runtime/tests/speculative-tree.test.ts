import { describe, expect, it } from 'vitest';
import {
  compressTrajectorySummary,
  runRecursiveTournamentVoting,
  selectWinningSpeculativeBranch,
  type SpeculativeBranchInput,
} from '../src/speculative-tree.js';

const SHA256_REGEX = /^[a-f0-9]{64}$/u;

describe('speculative-tree (M15.01 RTV)', () => {
  it('compressTrajectorySummary redacts secrets and produces deterministic SHA-256', () => {
    const events = [
      {
        stepIndex: 2,
        kind: 'tool_result' as const,
        toolName: 'vitest',
        summary: 'Passed with token=supersecretvalue12345 and Bearer abcdefghij1234',
        succeeded: true,
      },
      {
        stepIndex: 1,
        kind: 'tool_call' as const,
        toolName: 'edit_file',
        summary: 'Patched handler using api_key=sk-proj-1234567890abcdef',
      },
      {
        stepIndex: 3,
        kind: 'error' as const,
        summary: 'Transient retry on branch',
        succeeded: false,
      },
    ];

    const first = compressTrajectorySummary('branch-alpha', events, {
      secrets: ['supersecretvalue12345'],
    });
    const second = compressTrajectorySummary('branch-alpha', [...events].reverse(), {
      secrets: ['supersecretvalue12345'],
    });

    expect(first.totalEvents).toBe(3);
    expect(first.toolCallCount).toBe(1);
    expect(first.errorCount).toBe(1);
    expect(first.summaryText).not.toContain('supersecretvalue12345');
    expect(first.summaryText).not.toContain('sk-proj-1234567890abcdef');
    expect(first.summaryText).not.toContain('abcdefghij1234');
    expect(first.compressedSha256).toMatch(SHA256_REGEX);
    expect(first.compressedSha256).toBe(second.compressedSha256);
  });

  it('disqualifies branches failing Proof Gate v2 or scopeClean fail-closed', () => {
    const branches: SpeculativeBranchInput[] = [
      {
        branchId: 'branch-fail-proof',
        proofGatePassed: false,
        scopeClean: true,
        testsPassed: 10,
        testsTotal: 10,
        latencyMs: 100,
        costUsd: 0.01,
      },
      {
        branchId: 'branch-dirty-scope',
        proofGatePassed: true,
        scopeClean: false,
        testsPassed: 10,
        testsTotal: 10,
        latencyMs: 50,
        costUsd: 0.005,
      },
      {
        branchId: 'branch-invalid-metrics',
        proofGatePassed: true,
        scopeClean: true,
        testsPassed: 12,
        testsTotal: 10,
        latencyMs: 100,
        costUsd: 0.01,
      },
    ];

    const report = selectWinningSpeculativeBranch(branches);

    expect(report.status).toBe('no_eligible_branch');
    expect(report.winningBranchId).toBeNull();
    expect(report.automatedSelfAccept).toBe(false);
    expect(report.eligibleBranches).toHaveLength(0);
    expect(report.disqualifiedBranches).toHaveLength(3);
    expect(
      report.disqualifiedBranches.find((b) => b.branchId === 'branch-fail-proof')?.reasons
    ).toContain('proof_gate_v2_failed');
    expect(
      report.disqualifiedBranches.find((b) => b.branchId === 'branch-dirty-scope')?.reasons
    ).toContain('scope_not_clean');
    expect(
      report.disqualifiedBranches.find((b) => b.branchId === 'branch-invalid-metrics')?.reasons
    ).toContain('invalid_test_metrics');
    expect(report.reportSha256).toMatch(SHA256_REGEX);
  });

  it('selects winner via deterministic RTV with test pass rate + latency/cost tie-breaker', () => {
    const branches: SpeculativeBranchInput[] = [
      {
        branchId: 'branch-slow',
        proofGatePassed: true,
        scopeClean: true,
        testsPassed: 20,
        testsTotal: 20,
        qualityScoreBps: 9000,
        latencyMs: 2400,
        costUsd: 0.12,
      },
      {
        branchId: 'branch-fast-cheap',
        proofGatePassed: true,
        scopeClean: true,
        testsPassed: 20,
        testsTotal: 20,
        qualityScoreBps: 9000,
        latencyMs: 1100,
        costUsd: 0.04,
      },
      {
        branchId: 'branch-fast-expensive',
        proofGatePassed: true,
        scopeClean: true,
        testsPassed: 20,
        testsTotal: 20,
        qualityScoreBps: 9000,
        latencyMs: 1100,
        costUsd: 0.18,
      },
      {
        branchId: 'branch-lower-pass',
        proofGatePassed: true,
        scopeClean: true,
        testsPassed: 18,
        testsTotal: 20,
        qualityScoreBps: 9500,
        latencyMs: 500,
        costUsd: 0.01,
      },
    ];

    const reportA = selectWinningSpeculativeBranch(branches);
    const reportB = selectWinningSpeculativeBranch([...branches].reverse());

    expect(reportA.status).toBe('winner_selected');
    expect(reportA.automatedSelfAccept).toBe(false);
    expect(reportA.winningBranchId).toBe('branch-fast-cheap');
    expect(reportA.tournament.rounds.length).toBeGreaterThanOrEqual(2);
    expect(reportA.reportSha256).toMatch(SHA256_REGEX);
    expect(reportA.reportSha256).toBe(reportB.reportSha256);
    expect(reportA.tournament.tournamentSha256).toBe(reportB.tournament.tournamentSha256);
  });

  it('runRecursiveTournamentVoting handles empty and single candidate pools deterministically', () => {
    const empty = runRecursiveTournamentVoting([]);
    expect(empty.winnerBranchId).toBeNull();
    expect(empty.rankedBranchIds).toEqual([]);
    expect(empty.tournamentSha256).toMatch(SHA256_REGEX);

    const report = selectWinningSpeculativeBranch([
      {
        branchId: 'solo-branch',
        proofGatePassed: true,
        scopeClean: true,
        testsPassed: 5,
        testsTotal: 5,
        latencyMs: 300,
        costUsd: 0.02,
      },
    ]);
    expect(report.winningBranchId).toBe('solo-branch');
    expect(report.tournament.rankedBranchIds).toEqual(['solo-branch']);
    expect(report.automatedSelfAccept).toBe(false);
  });
});
