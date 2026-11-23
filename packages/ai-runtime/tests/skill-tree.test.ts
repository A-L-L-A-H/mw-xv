import { describe, expect, it } from 'vitest';
import {
  buildCollectiveSkillTree,
  pruneDegradedSkillNodes,
  scoreSkillTransferability,
  SKILL_DOMAINS,
  type SkillNodeInput,
} from '../src/skill-tree.js';

const SHA256_REGEX = /^[a-f0-9]{64}$/u;

describe('skill-tree (M15.02 CSTS / CSN-Assess)', () => {
  it('scoreSkillTransferability detects positive, negative, and severe negative transfer', () => {
    const positive = scoreSkillTransferability({
      skillId: 'orm-query-batching',
      sourceDomain: 'orm',
      baselineSuccessRateBps: 7000,
      withSkillSuccessRateBps: 8600,
      sampleCount: 10,
    });
    expect(positive.transferDeltaBps).toBe(1600);
    expect(positive.negativeTransferDetected).toBe(false);
    expect(positive.status).toBe('transferable');
    expect(positive.automatedPromotionAllowed).toBe(false);
    expect(positive.assessmentSha256).toMatch(SHA256_REGEX);

    const mildNegative = scoreSkillTransferability({
      skillId: 'board-auto-triage',
      sourceDomain: 'board',
      baselineSuccessRateBps: 8000,
      withSkillSuccessRateBps: 7800,
      sampleCount: 8,
    });
    expect(mildNegative.transferDeltaBps).toBe(-200);
    expect(mildNegative.negativeTransferDetected).toBe(true);
    expect(mildNegative.status).toBe('prune_recommended');
    expect(mildNegative.automatedPromotionAllowed).toBe(false);

    const severeNegative = scoreSkillTransferability({
      skillId: 'paas-cold-deploy',
      sourceDomain: 'paas',
      baselineSuccessRateBps: 8200,
      withSkillSuccessRateBps: 7400,
      sampleCount: 6,
    });
    expect(severeNegative.transferDeltaBps).toBe(-800);
    expect(severeNegative.negativeTransferDetected).toBe(true);
    expect(severeNegative.status).toBe('revocation_candidate');
    expect(severeNegative.automatedPromotionAllowed).toBe(false);
  });

  it('builds hierarchical multi-domain collective skill tree with deterministic SHA-256 and redaction', () => {
    const inputs: SkillNodeInput[] = [
      {
        id: 'root-knowledge',
        parentId: null,
        domain: 'knowledge',
        name: 'Knowledge Retrieval',
        description: 'Indexes docs without exposing password=topsecretpassword99',
        baselineSuccessRateBps: 6500,
        withSkillSuccessRateBps: 8100,
        sampleCount: 12,
      },
      {
        id: 'child-orm',
        parentId: 'root-knowledge',
        domain: 'orm',
        name: 'ORM Migration Helper',
        description: 'Generates typed migrations',
        baselineSuccessRateBps: 7000,
        withSkillSuccessRateBps: 7500,
        sampleCount: 8,
      },
      {
        id: 'child-desktop-degraded',
        parentId: 'root-knowledge',
        domain: 'desktop',
        name: 'Desktop Window Snap',
        description: 'Degraded heuristic',
        baselineSuccessRateBps: 8500,
        withSkillSuccessRateBps: 8200,
        sampleCount: 10,
      },
      {
        id: 'grandchild-board',
        parentId: 'child-desktop-degraded',
        domain: 'board',
        name: 'Board Quick Card',
        description: 'Inherits degraded parent',
        baselineSuccessRateBps: 7000,
        withSkillSuccessRateBps: 7300,
        sampleCount: 6,
      },
      {
        id: 'root-paas-revoked',
        parentId: null,
        domain: 'paas',
        name: 'PaaS Aggressive Scale',
        description: 'Causes regression',
        baselineSuccessRateBps: 9000,
        withSkillSuccessRateBps: 8100,
        sampleCount: 10,
      },
    ];

    const treeA = buildCollectiveSkillTree(inputs, { secrets: ['topsecretpassword99'] });
    const treeB = buildCollectiveSkillTree([...inputs].reverse(), {
      secrets: ['topsecretpassword99'],
    });

    expect(SKILL_DOMAINS).toEqual(['orm', 'board', 'paas', 'desktop', 'knowledge']);
    expect(treeA.automatedPromotionAllowed).toBe(false);
    expect(treeA.treeSha256).toMatch(SHA256_REGEX);
    expect(treeA.treeSha256).toBe(treeB.treeSha256);
    expect(treeA.domainCounts).toEqual({
      orm: 1,
      board: 1,
      paas: 1,
      desktop: 1,
      knowledge: 1,
    });
    expect(treeA.degradedNodeIds).toEqual(['child-desktop-degraded', 'root-paas-revoked']);

    const knowledgeNode = treeA.nodes.find((n) => n.id === 'root-knowledge');
    expect(knowledgeNode?.description).not.toContain('topsecretpassword99');
    expect(knowledgeNode?.childrenIds).toEqual(['child-desktop-degraded', 'child-orm']);

    const grandchild = treeA.nodes.find((n) => n.id === 'grandchild-board');
    expect(grandchild?.depth).toBe(2);
  });

  it('pruneDegradedSkillNodes marks degraded nodes without auto-promoting and tracks affected descendants', () => {
    const tree = buildCollectiveSkillTree([
      {
        id: 'skill-root',
        parentId: null,
        domain: 'knowledge',
        name: 'Root',
        description: 'Healthy root',
        baselineSuccessRateBps: 7000,
        withSkillSuccessRateBps: 8000,
        sampleCount: 10,
      },
      {
        id: 'skill-degraded-parent',
        parentId: 'skill-root',
        domain: 'orm',
        name: 'Degraded Parent',
        description: 'Mild negative transfer',
        baselineSuccessRateBps: 8000,
        withSkillSuccessRateBps: 7750,
        sampleCount: 10,
      },
      {
        id: 'skill-child',
        parentId: 'skill-degraded-parent',
        domain: 'board',
        name: 'Child',
        description: 'Child of degraded parent',
        baselineSuccessRateBps: 7000,
        withSkillSuccessRateBps: 7400,
        sampleCount: 10,
      },
      {
        id: 'skill-revoked',
        parentId: null,
        domain: 'paas',
        name: 'Revoked Skill',
        description: 'Severe negative transfer',
        baselineSuccessRateBps: 9000,
        withSkillSuccessRateBps: 8000,
        sampleCount: 10,
      },
    ]);

    const pruneReport = pruneDegradedSkillNodes(tree);

    expect(pruneReport.automatedPromotionAllowed).toBe(false);
    expect(pruneReport.degradedCount).toBe(2);
    expect(pruneReport.pruneRecommendedIds).toEqual(['skill-degraded-parent']);
    expect(pruneReport.revocationCandidateIds).toEqual(['skill-revoked']);
    expect(pruneReport.retainedNodeIds).toEqual(['skill-child', 'skill-root']);
    expect(
      pruneReport.prunedNodes.find((n) => n.id === 'skill-degraded-parent')?.descendantIdsAffected
    ).toEqual(['skill-child']);
    expect(pruneReport.treeSha256).toMatch(SHA256_REGEX);
  });

  it('handles cyclic parent references fail-closed without infinite recursion', () => {
    const tree = buildCollectiveSkillTree([
      {
        id: 'cycle-a',
        parentId: 'cycle-b',
        domain: 'orm',
        name: 'Cycle A',
        description: 'Points to B',
        baselineSuccessRateBps: 7000,
        withSkillSuccessRateBps: 7500,
        sampleCount: 6,
      },
      {
        id: 'cycle-b',
        parentId: 'cycle-a',
        domain: 'orm',
        name: 'Cycle B',
        description: 'Points to A',
        baselineSuccessRateBps: 7000,
        withSkillSuccessRateBps: 7500,
        sampleCount: 6,
      },
    ]);

    expect(tree.cycleDetectedNodeIds).toEqual(['cycle-a', 'cycle-b']);
    expect(tree.rootNodeIds).toEqual(['cycle-a', 'cycle-b']);
    expect(tree.automatedPromotionAllowed).toBe(false);
  });
});
