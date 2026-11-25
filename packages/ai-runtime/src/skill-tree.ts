import { sha256Canonical } from './canonical-json.js';
import { createRedactor, type RedactionContext } from './redaction.js';

export type SkillDomain = 'orm' | 'board' | 'paas' | 'desktop' | 'knowledge';

export const SKILL_DOMAINS: readonly SkillDomain[] = [
  'orm',
  'board',
  'paas',
  'desktop',
  'knowledge',
];

export type SkillNodeStatus =
  | 'transferable'
  | 'neutral'
  | 'insufficient_evidence'
  | 'prune_recommended'
  | 'revocation_candidate';

export interface CrossDomainTransferSample {
  readonly targetDomain: SkillDomain;
  readonly baselineSuccessRateBps: number;
  readonly withSkillSuccessRateBps: number;
  readonly sampleCount: number;
}

export interface SkillTransferabilityInput {
  readonly skillId: string;
  readonly sourceDomain: SkillDomain;
  readonly baselineSuccessRateBps: number;
  readonly withSkillSuccessRateBps: number;
  readonly sampleCount: number;
  readonly crossDomainSamples?: readonly CrossDomainTransferSample[];
}

export interface SkillTransferabilityOptions {
  readonly minSamples?: number;
  readonly positiveThresholdBps?: number;
  readonly revocationThresholdBps?: number;
  readonly secrets?: readonly string[];
}

export interface SkillTransferabilityAssessment {
  readonly skillId: string;
  readonly sourceDomain: SkillDomain;
  readonly transferDeltaBps: number;
  readonly worstDomainDeltaBps: number;
  readonly negativeTransferDetected: boolean;
  readonly totalSamples: number;
  readonly confidenceBps: number;
  readonly transferabilityScoreBps: number;
  readonly status: SkillNodeStatus;
  readonly automatedPromotionAllowed: false;
  readonly assessmentSha256: string;
}

export interface SkillNodeInput {
  readonly id: string;
  readonly parentId: string | null;
  readonly domain: SkillDomain;
  readonly name: string;
  readonly description: string;
  readonly baselineSuccessRateBps: number;
  readonly withSkillSuccessRateBps: number;
  readonly sampleCount: number;
  readonly crossDomainSamples?: readonly CrossDomainTransferSample[];
  readonly evidenceSha256?: string;
}

export interface CollectiveSkillNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly domain: SkillDomain;
  readonly name: string;
  readonly description: string;
  readonly depth: number;
  readonly childrenIds: readonly string[];
  readonly assessment: SkillTransferabilityAssessment;
  readonly status: SkillNodeStatus;
  readonly evidenceSha256?: string;
}

export interface CollectiveSkillTree {
  readonly nodes: readonly CollectiveSkillNode[];
  readonly rootNodeIds: readonly string[];
  readonly domainCounts: Readonly<Record<SkillDomain, number>>;
  readonly degradedNodeIds: readonly string[];
  readonly cycleDetectedNodeIds: readonly string[];
  readonly automatedPromotionAllowed: false;
  readonly treeSha256: string;
}

export interface PrunedSkillNodeEntry {
  readonly id: string;
  readonly domain: SkillDomain;
  readonly status: 'prune_recommended' | 'revocation_candidate';
  readonly transferDeltaBps: number;
  readonly reason: string;
  readonly descendantIdsAffected: readonly string[];
}

export interface SkillTreePruneReport {
  readonly retainedNodeIds: readonly string[];
  readonly prunedNodes: readonly PrunedSkillNodeEntry[];
  readonly revocationCandidateIds: readonly string[];
  readonly pruneRecommendedIds: readonly string[];
  readonly degradedCount: number;
  readonly automatedPromotionAllowed: false;
  readonly treeSha256: string;
}

const DEFAULT_MIN_SAMPLES = 5;
const DEFAULT_POSITIVE_THRESHOLD_BPS = 200;
const DEFAULT_REVOCATION_THRESHOLD_BPS = -500;

function buildRedactor(secrets?: readonly string[]): RedactionContext {
  const redactor = createRedactor();
  if (secrets) {
    for (const secret of secrets) {
      redactor.registerSecret(secret);
    }
  }
  return redactor;
}

function clampRateBps(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

function clampSignedBps(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-10_000, Math.min(10_000, Math.round(value)));
}

function safeSampleCount(count: number): number {
  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }
  return Math.floor(count);
}

export function scoreSkillTransferability(
  input: SkillTransferabilityInput,
  options?: SkillTransferabilityOptions
): SkillTransferabilityAssessment {
  const redactor = buildRedactor(options?.secrets);
  const minSamples = Math.max(1, Math.floor(options?.minSamples ?? DEFAULT_MIN_SAMPLES));
  const positiveThresholdBps = Math.max(
    0,
    Math.round(options?.positiveThresholdBps ?? DEFAULT_POSITIVE_THRESHOLD_BPS)
  );
  const revocationThresholdBps = Math.min(
    -1,
    Math.round(options?.revocationThresholdBps ?? DEFAULT_REVOCATION_THRESHOLD_BPS)
  );

  const primaryBaseline = clampRateBps(input.baselineSuccessRateBps);
  const primaryWithSkill = clampRateBps(input.withSkillSuccessRateBps);
  const primarySamples = safeSampleCount(input.sampleCount);
  const primaryDelta = primaryWithSkill - primaryBaseline;

  let weightedDeltaSum = primaryDelta * Math.max(1, primarySamples);
  let totalWeight = Math.max(1, primarySamples);
  let totalSamples = primarySamples;
  let worstDomainDeltaBps = primaryDelta;

  if (input.crossDomainSamples && input.crossDomainSamples.length > 0) {
    for (const sample of input.crossDomainSamples) {
      const sampleCount = safeSampleCount(sample.sampleCount);
      const sampleDelta =
        clampRateBps(sample.withSkillSuccessRateBps) - clampRateBps(sample.baselineSuccessRateBps);
      const weight = Math.max(1, sampleCount);
      weightedDeltaSum += sampleDelta * weight;
      totalWeight += weight;
      totalSamples += sampleCount;
      if (sampleDelta < worstDomainDeltaBps) {
        worstDomainDeltaBps = sampleDelta;
      }
    }
  }

  const transferDeltaBps = clampSignedBps(weightedDeltaSum / totalWeight);
  const negativeTransferDetected = transferDeltaBps < 0 || worstDomainDeltaBps < 0;
  const confidenceBps = clampRateBps((totalSamples / minSamples) * 10_000);
  const transferabilityScoreBps = clampSignedBps(
    Math.round((transferDeltaBps * confidenceBps) / 10_000)
  );

  let status: SkillNodeStatus;
  if (transferDeltaBps <= revocationThresholdBps || worstDomainDeltaBps <= revocationThresholdBps) {
    status = 'revocation_candidate';
  } else if (negativeTransferDetected) {
    status = 'prune_recommended';
  } else if (totalSamples < minSamples) {
    status = 'insufficient_evidence';
  } else if (transferDeltaBps >= positiveThresholdBps) {
    status = 'transferable';
  } else {
    status = 'neutral';
  }

  const cleanSkillId = redactor.redactString(input.skillId);
  const corePayload = {
    skillId: cleanSkillId,
    sourceDomain: input.sourceDomain,
    transferDeltaBps,
    worstDomainDeltaBps,
    negativeTransferDetected,
    totalSamples,
    confidenceBps,
    transferabilityScoreBps,
    status,
    automatedPromotionAllowed: false as const,
  };

  return {
    ...corePayload,
    assessmentSha256: sha256Canonical(corePayload),
  };
}

export function buildCollectiveSkillTree(
  inputs: readonly SkillNodeInput[],
  options?: SkillTransferabilityOptions
): CollectiveSkillTree {
  const redactor = buildRedactor(options?.secrets);
  const sortedInputs = [...inputs].sort((left, right) => left.id.localeCompare(right.id));
  const inputById = new Map<string, SkillNodeInput>();
  for (const entry of sortedInputs) {
    inputById.set(entry.id, entry);
  }

  const childrenMap = new Map<string, string[]>();
  const cycleDetectedSet = new Set<string>();
  const resolvedParentMap = new Map<string, string | null>();

  for (const entry of sortedInputs) {
    if (entry.parentId === null || !inputById.has(entry.parentId)) {
      resolvedParentMap.set(entry.id, null);
      continue;
    }

    // Detect cycles deterministically
    const visited = new Set<string>([entry.id]);
    let cursor: string | null = entry.parentId;
    let hasCycle = false;
    while (cursor !== null) {
      if (visited.has(cursor)) {
        hasCycle = true;
        break;
      }
      visited.add(cursor);
      cursor = inputById.get(cursor)?.parentId ?? null;
    }

    if (hasCycle) {
      cycleDetectedSet.add(entry.id);
      resolvedParentMap.set(entry.id, null);
    } else {
      resolvedParentMap.set(entry.id, entry.parentId);
      const list = childrenMap.get(entry.parentId) ?? [];
      list.push(entry.id);
      childrenMap.set(entry.parentId, list);
    }
  }

  const depthCache = new Map<string, number>();
  function computeDepth(nodeId: string): number {
    const cached = depthCache.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    const parentId = resolvedParentMap.get(nodeId) ?? null;
    const depth = parentId === null ? 0 : computeDepth(parentId) + 1;
    depthCache.set(nodeId, depth);
    return depth;
  }

  const domainCounts: Record<SkillDomain, number> = {
    orm: 0,
    board: 0,
    paas: 0,
    desktop: 0,
    knowledge: 0,
  };

  const nodes: CollectiveSkillNode[] = [];
  const rootNodeIds: string[] = [];
  const degradedNodeIds: string[] = [];

  for (const entry of sortedInputs) {
    const parentId = resolvedParentMap.get(entry.id) ?? null;
    const depth = computeDepth(entry.id);
    const childrenIds = [...(childrenMap.get(entry.id) ?? [])].sort();

    const assessment = scoreSkillTransferability(
      {
        skillId: entry.id,
        sourceDomain: entry.domain,
        baselineSuccessRateBps: entry.baselineSuccessRateBps,
        withSkillSuccessRateBps: entry.withSkillSuccessRateBps,
        sampleCount: entry.sampleCount,
        ...(entry.crossDomainSamples !== undefined
          ? { crossDomainSamples: entry.crossDomainSamples }
          : {}),
      },
      options
    );

    domainCounts[entry.domain] += 1;
    if (parentId === null) {
      rootNodeIds.push(entry.id);
    }
    if (assessment.status === 'prune_recommended' || assessment.status === 'revocation_candidate') {
      degradedNodeIds.push(entry.id);
    }

    nodes.push({
      id: redactor.redactString(entry.id),
      parentId: parentId !== null ? redactor.redactString(parentId) : null,
      domain: entry.domain,
      name: redactor.redactString(entry.name),
      description: redactor.redactString(entry.description),
      depth,
      childrenIds: childrenIds.map((childId) => redactor.redactString(childId)),
      assessment,
      status: assessment.status,
      ...(entry.evidenceSha256 !== undefined ? { evidenceSha256: entry.evidenceSha256 } : {}),
    });
  }

  const cycleDetectedNodeIds = [...cycleDetectedSet].sort();
  const coreTree = {
    nodes,
    rootNodeIds: [...rootNodeIds].sort(),
    domainCounts,
    degradedNodeIds: [...degradedNodeIds].sort(),
    cycleDetectedNodeIds,
    automatedPromotionAllowed: false as const,
  };

  return {
    ...coreTree,
    treeSha256: sha256Canonical(coreTree),
  };
}

export function pruneDegradedSkillNodes(tree: CollectiveSkillTree): SkillTreePruneReport {
  const nodeById = new Map<string, CollectiveSkillNode>();
  for (const node of tree.nodes) {
    nodeById.set(node.id, node);
  }

  function collectDescendants(rootId: string): string[] {
    const visited = new Set<string>();
    const queue = [...(nodeById.get(rootId)?.childrenIds ?? [])];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);
      const childNode = nodeById.get(current);
      if (childNode) {
        for (const nextChild of childNode.childrenIds) {
          queue.push(nextChild);
        }
      }
    }
    return [...visited].sort();
  }

  const prunedNodes: PrunedSkillNodeEntry[] = [];
  const retainedNodeIds: string[] = [];
  const revocationCandidateIds: string[] = [];
  const pruneRecommendedIds: string[] = [];

  const sortedNodes = [...tree.nodes].sort((left, right) => left.id.localeCompare(right.id));
  for (const node of sortedNodes) {
    const isRevocation = node.status === 'revocation_candidate';
    const isPrune = node.status === 'prune_recommended' || node.assessment.transferDeltaBps < 0;

    if (isRevocation || isPrune) {
      const finalStatus: 'prune_recommended' | 'revocation_candidate' = isRevocation
        ? 'revocation_candidate'
        : 'prune_recommended';
      if (finalStatus === 'revocation_candidate') {
        revocationCandidateIds.push(node.id);
      } else {
        pruneRecommendedIds.push(node.id);
      }

      prunedNodes.push({
        id: node.id,
        domain: node.domain,
        status: finalStatus,
        transferDeltaBps: node.assessment.transferDeltaBps,
        reason: isRevocation
          ? `severe_negative_transfer (${node.assessment.transferDeltaBps}bps, worst=${node.assessment.worstDomainDeltaBps}bps)`
          : `negative_transfer_detected (${node.assessment.transferDeltaBps}bps, worst=${node.assessment.worstDomainDeltaBps}bps)`,
        descendantIdsAffected: collectDescendants(node.id),
      });
    } else {
      retainedNodeIds.push(node.id);
    }
  }

  const coreReport = {
    retainedNodeIds,
    prunedNodes,
    revocationCandidateIds,
    pruneRecommendedIds,
    degradedCount: prunedNodes.length,
    automatedPromotionAllowed: false as const,
  };

  return {
    ...coreReport,
    treeSha256: sha256Canonical({
      sourceTreeSha256: tree.treeSha256,
      ...coreReport,
    }),
  };
}
