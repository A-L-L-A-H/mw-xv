import { describe, expect, it } from 'vitest';
import { generateMemoryDocProposals } from '../src/memory-doc-proposal.js';
import type { MemoryCandidateRecord, SkillVersionRecord } from '../src/memory-evaluator.js';

const FIXED_CLOCK = { now: () => Date.parse('2026-11-22T12:00:00.000Z') };

function makeMemory(overrides: Partial<MemoryCandidateRecord> = {}): MemoryCandidateRecord {
  return {
    id: 'mem-1',
    companyId: 10,
    memoryKind: 'semantic',
    scopeKind: 'company',
    scopeRef: '10',
    title: 'Use strict diff scope',
    content: 'Always validate diff scope before accepting work contracts.',
    sourceRef: 'wc-1',
    confidenceBps: 9500,
    dataClassification: 'local_only',
    sourceRunId: 'run-1',
    sourceAgentId: 'agent-1',
    evidenceArtifactId: 'art-1',
    status: 'approved',
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillVersionRecord> = {}): SkillVersionRecord {
  return {
    id: 'skill-1',
    companyId: 10,
    code: 'SOP-DIFF',
    version: 1,
    title: 'Diff Verification SOP',
    sopBody: 'Run validateDiffScope with token=secretvalue999 redacted.',
    referencedCapabilities: ['repo.read'],
    dataClassification: 'cloud_eligible',
    status: 'approved',
    ...overrides,
  };
}

describe('generateMemoryDocProposals', () => {
  it('generates redacted advisory proposals with unified diffs and deterministic hash', () => {
    const bundleA = generateMemoryDocProposals({
      companyId: 10,
      targetPath: 'docs/ENGINEERING_MEMORY.md',
      allowedTargetPaths: ['docs/ENGINEERING_MEMORY.md'],
      maxDataClassification: 'local_only',
      existingDocs: {
        'docs/ENGINEERING_MEMORY.md': '# Engineering Memory\n',
      },
      memories: [makeMemory()],
      skills: [makeSkill()],
      clock: FIXED_CLOCK,
    });
    const bundleB = generateMemoryDocProposals({
      companyId: 10,
      targetPath: 'docs/ENGINEERING_MEMORY.md',
      allowedTargetPaths: ['docs/ENGINEERING_MEMORY.md'],
      maxDataClassification: 'local_only',
      existingDocs: {
        'docs/ENGINEERING_MEMORY.md': '# Engineering Memory\n',
      },
      memories: [makeMemory()],
      skills: [makeSkill()],
      clock: FIXED_CLOCK,
    });

    expect(bundleA.targetPathValid).toBe(true);
    expect(bundleA.advisoryOnly).toBe(true);
    expect(bundleA.requiresHumanApproval).toBe(true);
    expect(bundleA.automatedWritesAllowed).toBe(false);
    expect(bundleA.proposals).toHaveLength(2);
    expect(bundleA.skipped).toHaveLength(0);
    expect(bundleA.contentSha256).toBe(bundleB.contentSha256);

    const skillProposal = bundleA.proposals.find((p) => p.sourceId === 'skill-1');
    expect(skillProposal?.proposedBlock).toContain('token=[REDACTED]');
    expect(skillProposal?.proposedBlock).not.toContain('secretvalue999');
    expect(skillProposal?.unifiedDiff).toContain('--- a/docs/ENGINEERING_MEMORY.md');
    expect(skillProposal?.unifiedDiff).toContain('+++ b/docs/ENGINEERING_MEMORY.md');
  });

  it('rejects unsafe or non-allowlisted target paths', () => {
    for (const badPath of [
      '../outside.md',
      '/abs/doc.md',
      '.git/HEAD.md',
      '.env.md',
      'docs/notes.txt',
    ]) {
      const bundle = generateMemoryDocProposals({
        companyId: 10,
        targetPath: badPath,
        maxDataClassification: 'restricted',
        existingDocs: {},
        memories: [makeMemory()],
        clock: FIXED_CLOCK,
      });
      expect(bundle.targetPathValid).toBe(false);
      expect(bundle.proposals).toHaveLength(0);
      expect(bundle.skipped[0]?.reasonCode).toBe('INVALID_TARGET_PATH');
    }
  });

  it('filters cross-company, revoked, unapproved, expired, policy-modifying, and over-classified items', () => {
    const bundle = generateMemoryDocProposals({
      companyId: 10,
      targetPath: 'docs/MEMORY.md',
      maxDataClassification: 'local_only',
      existingDocs: {},
      memories: [
        makeMemory({ id: 'm-cross', companyId: 99 }),
        makeMemory({ id: 'm-revoked', status: 'revoked' }),
        makeMemory({ id: 'm-revoked-ts', revokedAt: '2026-11-22T10:00:00.000Z' }),
        makeMemory({ id: 'm-cand', status: 'candidate' }),
        makeMemory({ id: 'm-exp', expiresAt: '2026-11-22T11:00:00.000Z' }),
        makeMemory({ id: 'm-policy', modifiesLivePolicyOrGrants: true }),
        makeMemory({ id: 'm-cls', dataClassification: 'restricted' }),
      ],
      clock: FIXED_CLOCK,
    });

    expect(bundle.proposals).toHaveLength(0);
    const reasonsById = Object.fromEntries(bundle.skipped.map((s) => [s.sourceId, s.reasonCode]));
    expect(reasonsById).toEqual({
      'm-cross': 'CROSS_COMPANY',
      'm-revoked': 'REVOKED',
      'm-revoked-ts': 'REVOKED',
      'm-cand': 'NOT_APPROVED',
      'm-exp': 'EXPIRED',
      'm-policy': 'MODIFIES_POLICY_OR_GRANTS',
      'm-cls': 'CLASSIFICATION_EXCEEDED',
    });
  });

  it('deduplicates against existing doc content and within the same batch', () => {
    const bundle = generateMemoryDocProposals({
      companyId: 10,
      targetPath: 'docs/MEMORY.md',
      maxDataClassification: 'local_only',
      existingDocs: {
        'docs/MEMORY.md': '# Memory\nAlways validate diff scope before accepting work contracts.\n',
      },
      memories: [
        makeMemory({ id: 'm-existing' }),
        makeMemory({ id: 'm-batch-1', title: 'Batch Item', content: 'Unique guidance line.' }),
        makeMemory({ id: 'm-batch-2', title: 'Batch Item', content: '  Unique   guidance line. ' }),
      ],
      clock: FIXED_CLOCK,
    });

    expect(bundle.proposals.map((p) => p.sourceId)).toEqual(['m-batch-1']);
    const reasonsById = Object.fromEntries(bundle.skipped.map((s) => [s.sourceId, s.reasonCode]));
    expect(reasonsById).toEqual({
      'm-existing': 'DUPLICATE_IN_DOC',
      'm-batch-2': 'DUPLICATE_IN_BATCH',
    });
  });
});
