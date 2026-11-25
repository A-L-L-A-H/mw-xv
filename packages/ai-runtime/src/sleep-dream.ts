import { sha256Canonical } from './canonical-json.js';
import { clampBps } from './sort-utils.js';
import { createRedactor } from './redaction.js';

export type SleepMemoryStatus = 'active' | 'decayed';

export type NonRemDecayReason =
  'proactive_interference_conflict' | 'stale_low_salience' | 'already_decayed';

export interface EpisodicMemoryItem {
  readonly memoryId: string;
  readonly companyId: string;
  readonly topicKey: string;
  readonly content: string;
  readonly provenance: string;
  readonly originalSha256?: string;
  readonly createdAtIso: string;
  readonly lastAccessedAtIso?: string;
  readonly importanceBps: number;
  readonly retrievalConfidenceBps: number;
  readonly status?: SleepMemoryStatus;
  readonly tags?: readonly string[];
}

export interface NonRemConsolidationOptions {
  readonly companyId: string;
  readonly nowIso: string;
  readonly maxAgeMs?: number;
  readonly minImportanceBps?: number;
  readonly minConfidenceBps?: number;
  readonly maxSummaryItemsPerTopic?: number;
}

export interface ConsolidatedMemoryRecord {
  readonly memoryId: string;
  readonly companyId: string;
  readonly topicKey: string;
  readonly content: string;
  readonly originalProvenance: string;
  readonly originalSha256: string;
  readonly createdAtIso: string;
  readonly lastAccessedAtIso: string;
  readonly importanceBps: number;
  readonly retrievalConfidenceBps: number;
  readonly status: SleepMemoryStatus;
  readonly decayReason?: NonRemDecayReason;
  readonly supersededByMemoryId?: string;
  readonly reversible: true;
  readonly tags: readonly string[];
}

export interface SemanticSummaryCandidate {
  readonly candidateId: string;
  readonly companyId: string;
  readonly topicKey: string;
  readonly sourceMemoryIds: readonly string[];
  readonly sourceHashes: readonly string[];
  readonly summaryText: string;
  readonly averageConfidenceBps: number;
  readonly averageImportanceBps: number;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfAccept: false;
  readonly candidateSha256: string;
}

export interface NonRemConsolidationReport {
  readonly companyId: string;
  readonly evaluatedAtIso: string;
  readonly consolidatedMemories: readonly ConsolidatedMemoryRecord[];
  readonly semanticCandidates: readonly SemanticSummaryCandidate[];
  readonly survivingCount: number;
  readonly decayedCount: number;
  readonly conflictCount: number;
  readonly staleCount: number;
  readonly outOfScopeIgnoredCount: number;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfAccept: false;
  readonly reportSha256: string;
}

export interface DreamKnowledgeNode {
  readonly nodeId: string;
  readonly companyId: string;
  readonly domain: string;
  readonly claim: string;
  readonly verified: boolean;
  readonly confidenceBps: number;
  readonly evidenceCount: number;
  readonly linkedSkillIds?: readonly string[];
}

export interface DreamSkillNode {
  readonly skillId: string;
  readonly companyId: string;
  readonly domain: string;
  readonly name: string;
  readonly proficiencyBps: number;
  readonly linkedKnowledgeIds?: readonly string[];
}

export type DreamProbeType = 'unverified_assumption' | 'weak_cross_domain_link';

export interface RemDreamSelfProbe {
  readonly probeId: string;
  readonly companyId: string;
  readonly probeType: DreamProbeType;
  readonly priorityBps: number;
  readonly sourceNodeId: string;
  readonly targetSkillId?: string;
  readonly sourceDomain: string;
  readonly targetDomain?: string;
  readonly query: string;
  readonly rationale: string;
}

export interface RemDreamSelfProbeReport {
  readonly probes: readonly RemDreamSelfProbe[];
  readonly unverifiedAssumptionCount: number;
  readonly weakCrossDomainLinkCount: number;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfAccept: false;
  readonly probeSha256: string;
}

export type MemoryFeedbackOutcome = 'hit' | 'miss' | 'contradiction';

export interface MemoryFeedbackEvent {
  readonly memoryId: string;
  readonly companyId: string;
  readonly outcome: MemoryFeedbackOutcome;
  readonly weightBps?: number;
  readonly reason?: string;
}

export interface ReconsolidatedMemoryRecord {
  readonly memoryId: string;
  readonly companyId: string;
  readonly topicKey: string;
  readonly content: string;
  readonly originalProvenance: string;
  readonly originalSha256: string;
  readonly previousImportanceBps: number;
  readonly importanceBps: number;
  readonly previousRetrievalConfidenceBps: number;
  readonly retrievalConfidenceBps: number;
  readonly status: SleepMemoryStatus;
  readonly reactivated: boolean;
  readonly appliedFeedbackCount: number;
  readonly reversible: true;
}

export interface ReconsolidatedMemoryReport {
  readonly memories: readonly ReconsolidatedMemoryRecord[];
  readonly appliedFeedbackCount: number;
  readonly ignoredFeedbackCount: number;
  readonly reactivatedCount: number;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfAccept: false;
  readonly reconsolidationSha256: string;
}

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MIN_IMPORTANCE_BPS = 2500;
const DEFAULT_MIN_CONFIDENCE_BPS = 3000;
const DEFAULT_MAX_SUMMARY_ITEMS_PER_TOPIC = 5;
const DEFAULT_FEEDBACK_WEIGHT_BPS = 1000;

function parseIsoMs(iso: string | undefined): number {
  if (!iso) {
    return 0;
  }
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTopicKey(topicKey: string): string {
  return topicKey.trim().toLowerCase();
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function computeOriginalMemorySha256(
  memoryId: string,
  companyId: string,
  redactedContent: string,
  redactedProvenance: string
): string {
  return sha256Canonical({
    memoryId,
    companyId,
    content: redactedContent,
    provenance: redactedProvenance,
  });
}

function compareSalienceDesc(
  left: {
    readonly retrievalConfidenceBps: number;
    readonly importanceBps: number;
    readonly createdAtMs: number;
    readonly memoryId: string;
  },
  right: {
    readonly retrievalConfidenceBps: number;
    readonly importanceBps: number;
    readonly createdAtMs: number;
    readonly memoryId: string;
  }
): number {
  if (right.retrievalConfidenceBps !== left.retrievalConfidenceBps) {
    return right.retrievalConfidenceBps - left.retrievalConfidenceBps;
  }
  if (right.importanceBps !== left.importanceBps) {
    return right.importanceBps - left.importanceBps;
  }
  if (right.createdAtMs !== left.createdAtMs) {
    return right.createdAtMs - left.createdAtMs;
  }
  return left.memoryId.localeCompare(right.memoryId);
}

export function runNonRemConsolidation(
  memories: readonly EpisodicMemoryItem[],
  options: NonRemConsolidationOptions
): NonRemConsolidationReport {
  const redactor = createRedactor();
  const targetCompanyId = options.companyId.trim();
  const nowMs = parseIsoMs(options.nowIso);
  const maxAgeMs = Math.max(0, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
  const minImportanceBps = clampBps(options.minImportanceBps ?? DEFAULT_MIN_IMPORTANCE_BPS);
  const minConfidenceBps = clampBps(options.minConfidenceBps ?? DEFAULT_MIN_CONFIDENCE_BPS);
  const maxSummaryItemsPerTopic = Math.max(
    1,
    Math.floor(options.maxSummaryItemsPerTopic ?? DEFAULT_MAX_SUMMARY_ITEMS_PER_TOPIC)
  );

  let outOfScopeIgnoredCount = 0;

  interface NormalizedMemory {
    readonly memoryId: string;
    readonly companyId: string;
    readonly topicKey: string;
    readonly content: string;
    readonly contentSha256: string;
    readonly originalProvenance: string;
    readonly originalSha256: string;
    readonly createdAtIso: string;
    readonly createdAtMs: number;
    readonly lastAccessedAtIso: string;
    readonly lastAccessedAtMs: number;
    readonly importanceBps: number;
    readonly retrievalConfidenceBps: number;
    readonly initialStatus: SleepMemoryStatus;
    readonly tags: readonly string[];
  }

  const inScope: NormalizedMemory[] = [];

  for (const item of memories) {
    if (item.companyId.trim() !== targetCompanyId) {
      outOfScopeIgnoredCount += 1;
      continue;
    }

    const redactedContent = redactor.redactString(item.content.trim());
    const redactedProvenance = redactor.redactString(item.provenance.trim());
    const originalSha256 =
      item.originalSha256 && item.originalSha256.trim().length > 0
        ? item.originalSha256.trim()
        : computeOriginalMemorySha256(
            item.memoryId,
            targetCompanyId,
            redactedContent,
            redactedProvenance
          );
    const lastAccessedAtIso = item.lastAccessedAtIso ?? item.createdAtIso;
    const tags = [
      ...new Set(
        (item.tags ?? [])
          .map((tag) => redactor.redactString(tag.trim()))
          .filter((tag) => tag.length > 0)
      ),
    ].sort();

    inScope.push({
      memoryId: item.memoryId,
      companyId: targetCompanyId,
      topicKey: normalizeTopicKey(item.topicKey),
      content: redactedContent,
      contentSha256: sha256Canonical({ content: redactedContent }),
      originalProvenance: redactedProvenance,
      originalSha256,
      createdAtIso: item.createdAtIso,
      createdAtMs: parseIsoMs(item.createdAtIso),
      lastAccessedAtIso,
      lastAccessedAtMs: parseIsoMs(lastAccessedAtIso),
      importanceBps: clampBps(item.importanceBps),
      retrievalConfidenceBps: clampBps(item.retrievalConfidenceBps),
      initialStatus: item.status === 'decayed' ? 'decayed' : 'active',
      tags,
    });
  }

  const byTopic = new Map<string, NormalizedMemory[]>();
  for (const item of inScope) {
    const existing = byTopic.get(item.topicKey);
    if (existing) {
      existing.push(item);
    } else {
      byTopic.set(item.topicKey, [item]);
    }
  }

  const consolidatedMemories: ConsolidatedMemoryRecord[] = [];
  const semanticCandidates: SemanticSummaryCandidate[] = [];
  let survivingCount = 0;
  let decayedCount = 0;
  let conflictCount = 0;
  let staleCount = 0;

  const sortedTopics = [...byTopic.keys()].sort();

  for (const topicKey of sortedTopics) {
    const topicItems = byTopic.get(topicKey) ?? [];
    const activeItems = topicItems
      .filter((item) => item.initialStatus === 'active')
      .sort(compareSalienceDesc);
    const alreadyDecayedItems = topicItems
      .filter((item) => item.initialStatus === 'decayed')
      .sort((a, b) => a.memoryId.localeCompare(b.memoryId));

    for (const item of alreadyDecayedItems) {
      decayedCount += 1;
      consolidatedMemories.push({
        memoryId: item.memoryId,
        companyId: item.companyId,
        topicKey: item.topicKey,
        content: item.content,
        originalProvenance: item.originalProvenance,
        originalSha256: item.originalSha256,
        createdAtIso: item.createdAtIso,
        lastAccessedAtIso: item.lastAccessedAtIso,
        importanceBps: item.importanceBps,
        retrievalConfidenceBps: item.retrievalConfidenceBps,
        status: 'decayed',
        decayReason: 'already_decayed',
        reversible: true,
        tags: item.tags,
      });
    }

    const distinctContentHashes = new Set(activeItems.map((item) => item.contentSha256));
    const hasConflict = distinctContentHashes.size > 1;
    const dominantItem = activeItems[0];
    const survivingForTopic: ConsolidatedMemoryRecord[] = [];

    for (const item of activeItems) {
      const ageMs = Math.max(0, nowMs - item.lastAccessedAtMs);
      const isConflicting =
        hasConflict &&
        dominantItem !== undefined &&
        item.contentSha256 !== dominantItem.contentSha256;
      const isStale =
        ageMs > maxAgeMs &&
        (item.importanceBps < minImportanceBps || item.retrievalConfidenceBps < minConfidenceBps);

      if (isConflicting) {
        decayedCount += 1;
        conflictCount += 1;
        consolidatedMemories.push({
          memoryId: item.memoryId,
          companyId: item.companyId,
          topicKey: item.topicKey,
          content: item.content,
          originalProvenance: item.originalProvenance,
          originalSha256: item.originalSha256,
          createdAtIso: item.createdAtIso,
          lastAccessedAtIso: item.lastAccessedAtIso,
          importanceBps: clampBps(Math.round(item.importanceBps * 0.5)),
          retrievalConfidenceBps: clampBps(Math.round(item.retrievalConfidenceBps * 0.5)),
          status: 'decayed',
          decayReason: 'proactive_interference_conflict',
          supersededByMemoryId: dominantItem.memoryId,
          reversible: true,
          tags: item.tags,
        });
        continue;
      }

      if (isStale) {
        decayedCount += 1;
        staleCount += 1;
        consolidatedMemories.push({
          memoryId: item.memoryId,
          companyId: item.companyId,
          topicKey: item.topicKey,
          content: item.content,
          originalProvenance: item.originalProvenance,
          originalSha256: item.originalSha256,
          createdAtIso: item.createdAtIso,
          lastAccessedAtIso: item.lastAccessedAtIso,
          importanceBps: clampBps(Math.round(item.importanceBps * 0.7)),
          retrievalConfidenceBps: clampBps(Math.round(item.retrievalConfidenceBps * 0.7)),
          status: 'decayed',
          decayReason: 'stale_low_salience',
          reversible: true,
          tags: item.tags,
        });
        continue;
      }

      survivingCount += 1;
      const survivor: ConsolidatedMemoryRecord = {
        memoryId: item.memoryId,
        companyId: item.companyId,
        topicKey: item.topicKey,
        content: item.content,
        originalProvenance: item.originalProvenance,
        originalSha256: item.originalSha256,
        createdAtIso: item.createdAtIso,
        lastAccessedAtIso: item.lastAccessedAtIso,
        importanceBps: item.importanceBps,
        retrievalConfidenceBps: item.retrievalConfidenceBps,
        status: 'active',
        reversible: true,
        tags: item.tags,
      };
      consolidatedMemories.push(survivor);
      survivingForTopic.push(survivor);
    }

    if (survivingForTopic.length > 0) {
      const selectedForSummary = survivingForTopic.slice(0, maxSummaryItemsPerTopic);
      const sourceMemoryIds = selectedForSummary.map((entry) => entry.memoryId);
      const sourceHashes = selectedForSummary.map((entry) => entry.originalSha256);
      const uniqueSnippets = [...new Set(selectedForSummary.map((entry) => entry.content))];
      const summaryText = redactor.redactString(`[${topicKey}] ${uniqueSnippets.join(' | ')}`);
      const averageConfidenceBps = clampBps(
        selectedForSummary.reduce((sum, entry) => sum + entry.retrievalConfidenceBps, 0) /
          selectedForSummary.length
      );
      const averageImportanceBps = clampBps(
        selectedForSummary.reduce((sum, entry) => sum + entry.importanceBps, 0) /
          selectedForSummary.length
      );
      const candidateBase = {
        companyId: targetCompanyId,
        topicKey,
        sourceMemoryIds,
        sourceHashes,
        summaryText,
        averageConfidenceBps,
        averageImportanceBps,
        automatedPromotionAllowed: false as const,
        automatedSelfAccept: false as const,
      };
      const candidateSha256 = sha256Canonical(candidateBase);
      semanticCandidates.push({
        candidateId: `sem-${candidateSha256.slice(0, 12)}`,
        ...candidateBase,
        candidateSha256,
      });
    }
  }

  consolidatedMemories.sort((a, b) => a.memoryId.localeCompare(b.memoryId));

  const reportBase = {
    companyId: targetCompanyId,
    evaluatedAtIso: options.nowIso,
    consolidatedMemories,
    semanticCandidates,
    survivingCount,
    decayedCount,
    conflictCount,
    staleCount,
    outOfScopeIgnoredCount,
    automatedPromotionAllowed: false as const,
    automatedSelfAccept: false as const,
  };

  return {
    ...reportBase,
    reportSha256: sha256Canonical(reportBase),
  };
}

export function runRemDreamSelfProbe(
  knowledgeNodes: readonly DreamKnowledgeNode[],
  skillNodes: readonly DreamSkillNode[]
): RemDreamSelfProbeReport {
  const redactor = createRedactor();
  const probes: RemDreamSelfProbe[] = [];
  const seenProbeKeys = new Set<string>();

  const skillByKey = new Map<string, DreamSkillNode>();
  for (const skill of skillNodes) {
    skillByKey.set(`${skill.companyId.trim()}::${skill.skillId}`, skill);
  }

  const knowledgeByKey = new Map<string, DreamKnowledgeNode>();
  for (const node of knowledgeNodes) {
    knowledgeByKey.set(`${node.companyId.trim()}::${node.nodeId}`, node);
  }

  let unverifiedAssumptionCount = 0;
  let weakCrossDomainLinkCount = 0;

  for (const node of knowledgeNodes) {
    const companyId = node.companyId.trim();
    const confidenceBps = clampBps(node.confidenceBps);
    const domain = normalizeDomain(node.domain);
    const redactedClaim = redactor.redactString(node.claim.trim());

    if (!node.verified || node.evidenceCount <= 0 || confidenceBps < 6000) {
      const priorityBps = clampBps(
        10_000 - confidenceBps + (node.verified ? 0 : 1500) + (node.evidenceCount <= 0 ? 1000 : 0)
      );
      const probeKey = `assumption::${companyId}::${node.nodeId}`;
      if (!seenProbeKeys.has(probeKey)) {
        seenProbeKeys.add(probeKey);
        unverifiedAssumptionCount += 1;
        const probeHash = sha256Canonical({
          probeKey,
          domain,
          redactedClaim,
          priorityBps,
        });
        probes.push({
          probeId: `probe-${probeHash.slice(0, 12)}`,
          companyId,
          probeType: 'unverified_assumption',
          priorityBps,
          sourceNodeId: node.nodeId,
          sourceDomain: domain,
          query: `Verify assumption in domain "${domain}" (${node.nodeId}): "${redactedClaim}". What deterministic evidence confirms or falsifies this claim?`,
          rationale: `verified=${String(node.verified)}, evidenceCount=${String(node.evidenceCount)}, confidenceBps=${String(confidenceBps)}`,
        });
      }
    }

    for (const linkedSkillId of node.linkedSkillIds ?? []) {
      const skill = skillByKey.get(`${companyId}::${linkedSkillId}`);
      if (!skill) {
        continue;
      }
      const skillDomain = normalizeDomain(skill.domain);
      const proficiencyBps = clampBps(skill.proficiencyBps);
      if (skillDomain !== domain && (proficiencyBps < 6500 || confidenceBps < 6500)) {
        const probeKey = `cross::${companyId}::${node.nodeId}::${skill.skillId}`;
        if (!seenProbeKeys.has(probeKey)) {
          seenProbeKeys.add(probeKey);
          weakCrossDomainLinkCount += 1;
          const redactedSkillName = redactor.redactString(skill.name.trim());
          const priorityBps = clampBps(10_000 - Math.min(proficiencyBps, confidenceBps));
          const probeHash = sha256Canonical({
            probeKey,
            domain,
            skillDomain,
            redactedClaim,
            redactedSkillName,
            priorityBps,
          });
          probes.push({
            probeId: `probe-${probeHash.slice(0, 12)}`,
            companyId,
            probeType: 'weak_cross_domain_link',
            priorityBps,
            sourceNodeId: node.nodeId,
            targetSkillId: skill.skillId,
            sourceDomain: domain,
            targetDomain: skillDomain,
            query: `Stress-test cross-domain link from "${domain}" (${node.nodeId}) to skill "${redactedSkillName}" in "${skillDomain}" (${skill.skillId}): under what edge case does this transfer fail?`,
            rationale: `cross-domain transfer ${domain}->${skillDomain} has confidenceBps=${String(confidenceBps)}, proficiencyBps=${String(proficiencyBps)}`,
          });
        }
      }
    }
  }

  for (const skill of skillNodes) {
    const companyId = skill.companyId.trim();
    const skillDomain = normalizeDomain(skill.domain);
    const proficiencyBps = clampBps(skill.proficiencyBps);
    const redactedSkillName = redactor.redactString(skill.name.trim());

    for (const linkedKnowledgeId of skill.linkedKnowledgeIds ?? []) {
      const node = knowledgeByKey.get(`${companyId}::${linkedKnowledgeId}`);
      if (!node) {
        continue;
      }
      const nodeDomain = normalizeDomain(node.domain);
      const confidenceBps = clampBps(node.confidenceBps);
      if (nodeDomain !== skillDomain && (proficiencyBps < 6500 || confidenceBps < 6500)) {
        const probeKey = `cross::${companyId}::${node.nodeId}::${skill.skillId}`;
        if (!seenProbeKeys.has(probeKey)) {
          seenProbeKeys.add(probeKey);
          weakCrossDomainLinkCount += 1;
          const priorityBps = clampBps(10_000 - Math.min(proficiencyBps, confidenceBps));
          const probeHash = sha256Canonical({
            probeKey,
            nodeDomain,
            skillDomain,
            redactedSkillName,
            priorityBps,
          });
          probes.push({
            probeId: `probe-${probeHash.slice(0, 12)}`,
            companyId,
            probeType: 'weak_cross_domain_link',
            priorityBps,
            sourceNodeId: node.nodeId,
            targetSkillId: skill.skillId,
            sourceDomain: nodeDomain,
            targetDomain: skillDomain,
            query: `Stress-test cross-domain link from "${nodeDomain}" (${node.nodeId}) to skill "${redactedSkillName}" in "${skillDomain}" (${skill.skillId}): under what edge case does this transfer fail?`,
            rationale: `cross-domain transfer ${nodeDomain}->${skillDomain} has confidenceBps=${String(confidenceBps)}, proficiencyBps=${String(proficiencyBps)}`,
          });
        }
      }
    }
  }

  probes.sort((a, b) => {
    if (b.priorityBps !== a.priorityBps) {
      return b.priorityBps - a.priorityBps;
    }
    return a.probeId.localeCompare(b.probeId);
  });

  const reportBase = {
    probes,
    unverifiedAssumptionCount,
    weakCrossDomainLinkCount,
    automatedPromotionAllowed: false as const,
    automatedSelfAccept: false as const,
  };

  return {
    ...reportBase,
    probeSha256: sha256Canonical(reportBase),
  };
}

export function reconsolidateMemoryFeedback(
  memories: readonly EpisodicMemoryItem[],
  feedback: readonly MemoryFeedbackEvent[]
): ReconsolidatedMemoryReport {
  const redactor = createRedactor();
  const feedbackByKey = new Map<string, MemoryFeedbackEvent[]>();

  for (const event of feedback) {
    const key = `${event.companyId.trim()}::${event.memoryId}`;
    const existing = feedbackByKey.get(key);
    if (existing) {
      existing.push(event);
    } else {
      feedbackByKey.set(key, [event]);
    }
  }

  let appliedFeedbackCount = 0;
  let reactivatedCount = 0;
  const matchedKeys = new Set<string>();
  const reconsolidated: ReconsolidatedMemoryRecord[] = [];

  for (const item of memories) {
    const companyId = item.companyId.trim();
    const key = `${companyId}::${item.memoryId}`;
    const events = feedbackByKey.get(key) ?? [];
    if (events.length > 0) {
      matchedKeys.add(key);
    }

    const redactedContent = redactor.redactString(item.content.trim());
    const redactedProvenance = redactor.redactString(item.provenance.trim());
    const originalSha256 =
      item.originalSha256 && item.originalSha256.trim().length > 0
        ? item.originalSha256.trim()
        : computeOriginalMemorySha256(
            item.memoryId,
            companyId,
            redactedContent,
            redactedProvenance
          );

    const previousImportanceBps = clampBps(item.importanceBps);
    const previousRetrievalConfidenceBps = clampBps(item.retrievalConfidenceBps);
    let importanceBps = previousImportanceBps;
    let retrievalConfidenceBps = previousRetrievalConfidenceBps;

    for (const event of events) {
      const weight = Math.max(
        0,
        Math.min(5000, Math.round(event.weightBps ?? DEFAULT_FEEDBACK_WEIGHT_BPS))
      );
      if (event.outcome === 'hit') {
        retrievalConfidenceBps = clampBps(retrievalConfidenceBps + Math.round(weight * 0.5));
        importanceBps = clampBps(importanceBps + Math.round(weight * 0.25));
      } else if (event.outcome === 'miss') {
        retrievalConfidenceBps = clampBps(retrievalConfidenceBps - Math.round(weight * 0.4));
        importanceBps = clampBps(importanceBps - Math.round(weight * 0.2));
      } else {
        retrievalConfidenceBps = clampBps(retrievalConfidenceBps - Math.round(weight * 0.8));
        importanceBps = clampBps(importanceBps - Math.round(weight * 0.3));
      }
      appliedFeedbackCount += 1;
    }

    const initialStatus: SleepMemoryStatus = item.status === 'decayed' ? 'decayed' : 'active';
    const reactivated =
      initialStatus === 'decayed' &&
      events.some((event) => event.outcome === 'hit') &&
      retrievalConfidenceBps >= 5000;
    const status: SleepMemoryStatus = reactivated ? 'active' : initialStatus;

    if (reactivated) {
      reactivatedCount += 1;
    }

    reconsolidated.push({
      memoryId: item.memoryId,
      companyId,
      topicKey: normalizeTopicKey(item.topicKey),
      content: redactedContent,
      originalProvenance: redactedProvenance,
      originalSha256,
      previousImportanceBps,
      importanceBps,
      previousRetrievalConfidenceBps,
      retrievalConfidenceBps,
      status,
      reactivated,
      appliedFeedbackCount: events.length,
      reversible: true,
    });
  }

  reconsolidated.sort((a, b) => a.memoryId.localeCompare(b.memoryId));

  let ignoredFeedbackCount = 0;
  for (const [key, events] of feedbackByKey.entries()) {
    if (!matchedKeys.has(key)) {
      ignoredFeedbackCount += events.length;
    }
  }

  const reportBase = {
    memories: reconsolidated,
    appliedFeedbackCount,
    ignoredFeedbackCount,
    reactivatedCount,
    automatedPromotionAllowed: false as const,
    automatedSelfAccept: false as const,
  };

  return {
    ...reportBase,
    reconsolidationSha256: sha256Canonical(reportBase),
  };
}
