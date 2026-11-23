import { describe, expect, it } from 'vitest';
import {
  reconsolidateMemoryFeedback,
  runNonRemConsolidation,
  runRemDreamSelfProbe,
  type DreamKnowledgeNode,
  type DreamSkillNode,
  type EpisodicMemoryItem,
} from '../src/sleep-dream.js';

describe('M16.01 Sleep-Dream Memory Consolidation', () => {
  describe('runNonRemConsolidation (SleepGate/SCM)', () => {
    const nowIso = '2026-11-23T00:00:00.000Z';

    it('detects proactive interference conflicts within company scope, applies reversible soft-decay without deletion, and compresses survivors', () => {
      const memories: EpisodicMemoryItem[] = [
        {
          memoryId: 'mem-new',
          companyId: 'co-alpha',
          topicKey: 'billing.retry-policy',
          content: 'Retry billing webhooks 3 times with exponential backoff.',
          provenance: 'run:102',
          createdAtIso: '2026-11-20T00:00:00.000Z',
          importanceBps: 8500,
          retrievalConfidenceBps: 9000,
        },
        {
          memoryId: 'mem-old-conflict',
          companyId: 'co-alpha',
          topicKey: 'billing.retry-policy',
          content: 'Retry billing webhooks 10 times with linear delay.',
          provenance: 'run:045',
          originalSha256: 'abc123originalhash',
          createdAtIso: '2026-10-01T00:00:00.000Z',
          importanceBps: 5000,
          retrievalConfidenceBps: 4500,
        },
        {
          memoryId: 'mem-stale',
          companyId: 'co-alpha',
          topicKey: 'ui.banner-copy',
          content: 'Temporary Q3 banner wording.',
          provenance: 'run:012',
          createdAtIso: '2026-08-01T00:00:00.000Z',
          importanceBps: 1500,
          retrievalConfidenceBps: 2000,
        },
        {
          memoryId: 'mem-other-company',
          companyId: 'co-beta',
          topicKey: 'billing.retry-policy',
          content: 'Beta tenant secret policy.',
          provenance: 'run:999',
          createdAtIso: '2026-11-22T00:00:00.000Z',
          importanceBps: 9500,
          retrievalConfidenceBps: 9500,
        },
      ];

      const report = runNonRemConsolidation(memories, {
        companyId: 'co-alpha',
        nowIso,
      });

      expect(report.companyId).toBe('co-alpha');
      expect(report.outOfScopeIgnoredCount).toBe(1);
      // Never deletes in-scope memories: all 3 co-alpha items are preserved
      expect(report.consolidatedMemories).toHaveLength(3);
      expect(report.survivingCount).toBe(1);
      expect(report.decayedCount).toBe(2);
      expect(report.conflictCount).toBe(1);
      expect(report.staleCount).toBe(1);
      expect(report.automatedPromotionAllowed).toBe(false);
      expect(report.automatedSelfAccept).toBe(false);
      expect(report.reportSha256).toMatch(/^[a-f0-9]{64}$/u);

      const decayedConflict = report.consolidatedMemories.find(
        (m) => m.memoryId === 'mem-old-conflict'
      );
      expect(decayedConflict).toBeDefined();
      expect(decayedConflict?.status).toBe('decayed');
      expect(decayedConflict?.decayReason).toBe('proactive_interference_conflict');
      expect(decayedConflict?.supersededByMemoryId).toBe('mem-new');
      expect(decayedConflict?.originalProvenance).toBe('run:045');
      expect(decayedConflict?.originalSha256).toBe('abc123originalhash');
      expect(decayedConflict?.reversible).toBe(true);

      const decayedStale = report.consolidatedMemories.find((m) => m.memoryId === 'mem-stale');
      expect(decayedStale?.status).toBe('decayed');
      expect(decayedStale?.decayReason).toBe('stale_low_salience');
      expect(decayedStale?.reversible).toBe(true);

      expect(report.semanticCandidates).toHaveLength(1);
      const candidate = report.semanticCandidates[0]!;
      expect(candidate.topicKey).toBe('billing.retry-policy');
      expect(candidate.sourceMemoryIds).toEqual(['mem-new']);
      expect(candidate.automatedPromotionAllowed).toBe(false);
      expect(candidate.automatedSelfAccept).toBe(false);
      expect(candidate.candidateSha256).toMatch(/^[a-f0-9]{64}$/u);
    });

    it('redacts secrets in content and provenance and produces deterministic SHA-256 digests', () => {
      const memories: EpisodicMemoryItem[] = [
        {
          memoryId: 'mem-secret',
          companyId: 'co-alpha',
          topicKey: 'auth.config',
          content: 'Use Bearer sk-proj-supersecret1234567890 for staging.',
          provenance: 'header authorization=Bearer secretvalue12345',
          createdAtIso: '2026-11-22T00:00:00.000Z',
          importanceBps: 7000,
          retrievalConfidenceBps: 8000,
        },
      ];

      const reportA = runNonRemConsolidation(memories, {
        companyId: 'co-alpha',
        nowIso,
      });
      const reportB = runNonRemConsolidation(memories, {
        companyId: 'co-alpha',
        nowIso,
      });

      expect(reportA.reportSha256).toBe(reportB.reportSha256);
      expect(reportA.consolidatedMemories[0]?.content).not.toContain(
        'sk-proj-supersecret1234567890'
      );
      expect(reportA.semanticCandidates[0]?.summaryText).not.toContain(
        'sk-proj-supersecret1234567890'
      );
    });
  });

  describe('runRemDreamSelfProbe (MemDream)', () => {
    it('synthesizes deterministic probes for unverified assumptions and weak cross-domain skill links', () => {
      const knowledgeNodes: DreamKnowledgeNode[] = [
        {
          nodeId: 'kn-1',
          companyId: 'co-alpha',
          domain: 'payments',
          claim: 'Idempotency keys expire after 24h without exception.',
          verified: false,
          confidenceBps: 4500,
          evidenceCount: 0,
          linkedSkillIds: ['sk-1'],
        },
        {
          nodeId: 'kn-2',
          companyId: 'co-alpha',
          domain: 'security',
          claim: 'JWT rotation is enforced every 15m.',
          verified: true,
          confidenceBps: 9000,
          evidenceCount: 4,
          linkedSkillIds: ['sk-2'],
        },
      ];

      const skillNodes: DreamSkillNode[] = [
        {
          skillId: 'sk-1',
          companyId: 'co-alpha',
          domain: 'orchestration',
          name: 'Retry Scheduler',
          proficiencyBps: 5000,
          linkedKnowledgeIds: ['kn-1'],
        },
        {
          skillId: 'sk-2',
          companyId: 'co-alpha',
          domain: 'security',
          name: 'Token Verifier',
          proficiencyBps: 9200,
        },
      ];

      const reportA = runRemDreamSelfProbe(knowledgeNodes, skillNodes);
      const reportB = runRemDreamSelfProbe(knowledgeNodes, skillNodes);

      expect(reportA.probeSha256).toBe(reportB.probeSha256);
      expect(reportA.probeSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(reportA.automatedPromotionAllowed).toBe(false);
      expect(reportA.automatedSelfAccept).toBe(false);
      expect(reportA.unverifiedAssumptionCount).toBe(1);
      expect(reportA.weakCrossDomainLinkCount).toBe(1);
      expect(reportA.probes).toHaveLength(2);
      expect(reportA.probes[0]?.probeType).toBe('unverified_assumption');
      expect(reportA.probes[1]?.probeType).toBe('weak_cross_domain_link');
      expect(reportA.probes[1]?.targetSkillId).toBe('sk-1');
    });
  });

  describe('reconsolidateMemoryFeedback (REALM)', () => {
    it('updates weights deterministically, enforces company isolation, and reactivates decayed memories on strong hits', () => {
      const memories: EpisodicMemoryItem[] = [
        {
          memoryId: 'mem-1',
          companyId: 'co-alpha',
          topicKey: 'ops.runbook',
          content: 'Restart worker pool after schema migration.',
          provenance: 'run:200',
          originalSha256: 'hash-mem-1',
          createdAtIso: '2026-11-10T00:00:00.000Z',
          importanceBps: 4000,
          retrievalConfidenceBps: 4500,
          status: 'decayed',
        },
        {
          memoryId: 'mem-2',
          companyId: 'co-alpha',
          topicKey: 'ops.cache',
          content: 'Flush Redis before deploy.',
          provenance: 'run:201',
          createdAtIso: '2026-11-11T00:00:00.000Z',
          importanceBps: 6000,
          retrievalConfidenceBps: 7000,
          status: 'active',
        },
      ];

      const report = reconsolidateMemoryFeedback(memories, [
        {
          memoryId: 'mem-1',
          companyId: 'co-alpha',
          outcome: 'hit',
          weightBps: 2000,
        },
        {
          memoryId: 'mem-2',
          companyId: 'co-alpha',
          outcome: 'contradiction',
          weightBps: 2000,
        },
        {
          memoryId: 'mem-1',
          companyId: 'co-beta',
          outcome: 'contradiction',
          weightBps: 5000,
        },
      ]);

      expect(report.appliedFeedbackCount).toBe(2);
      expect(report.ignoredFeedbackCount).toBe(1);
      expect(report.reactivatedCount).toBe(1);
      expect(report.automatedPromotionAllowed).toBe(false);
      expect(report.automatedSelfAccept).toBe(false);
      expect(report.reconsolidationSha256).toMatch(/^[a-f0-9]{64}$/u);

      const mem1 = report.memories.find((m) => m.memoryId === 'mem-1');
      expect(mem1?.status).toBe('active');
      expect(mem1?.reactivated).toBe(true);
      expect(mem1?.retrievalConfidenceBps).toBe(5500);
      expect(mem1?.importanceBps).toBe(4500);
      expect(mem1?.originalSha256).toBe('hash-mem-1');

      const mem2 = report.memories.find((m) => m.memoryId === 'mem-2');
      expect(mem2?.retrievalConfidenceBps).toBe(5400);
      expect(mem2?.importanceBps).toBe(5400);
    });
  });
});
