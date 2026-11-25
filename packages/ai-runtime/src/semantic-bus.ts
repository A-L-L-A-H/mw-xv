import { isPrivateMeshHost } from './a2a-protocol.js';
import { sha256Canonical } from './canonical-json.js';
import { createRedactor } from './redaction.js';
import type { DataClassification } from './types.js';

export type SemanticBusRejectionReasonCode =
  | 'PUBLIC_ENDPOINT_FORBIDDEN'
  | 'COMPANY_ISOLATION_VIOLATION'
  | 'CLASSIFICATION_VIOLATION'
  | 'COST_BUDGET_EXCEEDED'
  | 'INVALID_CAPABILITY_VECTOR';

export interface SemanticTaskIntent {
  readonly taskId: string;
  readonly companyId: number;
  readonly dataClassification: DataClassification;
  readonly maxCostMicros: number;
  readonly summary: string;
  readonly capabilityVector: readonly number[];
  readonly tags: readonly string[];
}

export interface MeshNodeCapability {
  readonly nodeId: string;
  readonly agentId: string;
  readonly endpoint: string;
  readonly companyId: number;
  readonly allowedClassifications: readonly DataClassification[];
  readonly estimatedCostMicros: number;
  readonly capabilityVector: readonly number[];
  readonly tags: readonly string[];
}

export interface SemanticResonanceOptions {
  readonly vectorWeight?: number;
  readonly tagWeight?: number;
  readonly minResonanceScore?: number;
}

export interface RankedMeshNodeMatch {
  readonly nodeId: string;
  readonly agentId: string;
  readonly endpoint: string;
  readonly companyId: number;
  readonly estimatedCostMicros: number;
  readonly cosineSimilarity: number;
  readonly lexicalTagOverlap: number;
  readonly resonanceScore: number;
  readonly matchedTags: readonly string[];
}

export interface RejectedMeshNode {
  readonly nodeId: string;
  readonly agentId: string;
  readonly reasonCode: SemanticBusRejectionReasonCode;
  readonly reason: string;
}

export interface SemanticResonanceResult {
  readonly taskId: string;
  readonly companyId: number;
  readonly dataClassification: DataClassification;
  readonly maxCostMicros: number;
  readonly selectedNode: RankedMeshNodeMatch | null;
  readonly rankedMatches: readonly RankedMeshNodeMatch[];
  readonly rejectedNodes: readonly RejectedMeshNode[];
  readonly automatedSelfAccept: false;
  readonly dispatchSha256: string;
}

const VALID_CLASSIFICATIONS: ReadonlySet<string> = new Set<DataClassification>([
  'local_only',
  'cloud_eligible',
  'restricted',
]);

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isValidVector(vector: readonly number[]): boolean {
  return vector.every((entry) => Number.isFinite(entry));
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function computeCosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  const raw = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, raw));
}

function normalizeTags(tags: readonly string[], redact: (s: string) => string): readonly string[] {
  const unique = new Set<string>();
  for (const tag of tags) {
    const cleaned = redact(tag).trim().toLowerCase();
    if (cleaned.length > 0) {
      unique.add(cleaned);
    }
  }
  return Array.from(unique).sort();
}

function computeLexicalTagOverlap(
  taskTags: readonly string[],
  nodeTags: readonly string[]
): { readonly overlap: number; readonly matchedTags: readonly string[] } {
  if (taskTags.length === 0 && nodeTags.length === 0) {
    return { overlap: 0, matchedTags: [] };
  }
  const nodeSet = new Set(nodeTags);
  const matchedTags = taskTags.filter((tag) => nodeSet.has(tag));
  const unionSize = new Set([...taskTags, ...nodeTags]).size;
  if (unionSize === 0) {
    return { overlap: 0, matchedTags: [] };
  }
  return {
    overlap: matchedTags.length / unionSize,
    matchedTags,
  };
}

export function matchTaskToMeshAgentsByResonance(
  taskIntent: SemanticTaskIntent,
  nodeCapabilities: readonly MeshNodeCapability[],
  options: SemanticResonanceOptions = {}
): SemanticResonanceResult {
  const redactor = createRedactor();
  const redact = (value: string): string => redactor.redactString(value);

  const taskId = redact(taskIntent.taskId).trim();
  const summary = redact(taskIntent.summary).trim();
  const taskTags = normalizeTags(taskIntent.tags, redact);
  const vectorWeight = options.vectorWeight ?? 0.7;
  const tagWeight = options.tagWeight ?? 0.3;
  const minResonanceScore = options.minResonanceScore ?? 0;

  const taskHasValidClassification = VALID_CLASSIFICATIONS.has(taskIntent.dataClassification);
  const taskHasValidCompany = isPositiveSafeInteger(taskIntent.companyId);
  const taskHasValidBudget = isValidFiniteNonNegative(taskIntent.maxCostMicros);
  const taskHasValidVector = isValidVector(taskIntent.capabilityVector);

  const rankedMatches: RankedMeshNodeMatch[] = [];
  const rejectedNodes: RejectedMeshNode[] = [];

  for (const node of nodeCapabilities) {
    const nodeId = redact(node.nodeId).trim();
    const agentId = redact(node.agentId).trim();
    const endpoint = redact(node.endpoint).trim();

    if (!isPrivateMeshHost(endpoint)) {
      rejectedNodes.push({
        nodeId,
        agentId,
        reasonCode: 'PUBLIC_ENDPOINT_FORBIDDEN',
        reason: 'Node endpoint is not a private EasyTier/RFC1918/CGNAT/ULA mesh host.',
      });
      continue;
    }

    if (
      !taskHasValidCompany ||
      !isPositiveSafeInteger(node.companyId) ||
      node.companyId !== taskIntent.companyId
    ) {
      rejectedNodes.push({
        nodeId,
        agentId,
        reasonCode: 'COMPANY_ISOLATION_VIOLATION',
        reason: 'Node companyId does not match taskIntent companyId.',
      });
      continue;
    }

    const nodeAllowedValid =
      taskHasValidClassification &&
      node.allowedClassifications.every((classification) =>
        VALID_CLASSIFICATIONS.has(classification)
      ) &&
      node.allowedClassifications.includes(taskIntent.dataClassification);

    if (!nodeAllowedValid) {
      rejectedNodes.push({
        nodeId,
        agentId,
        reasonCode: 'CLASSIFICATION_VIOLATION',
        reason: `Node does not permit dataClassification '${taskIntent.dataClassification}'.`,
      });
      continue;
    }

    if (
      !taskHasValidBudget ||
      !isValidFiniteNonNegative(node.estimatedCostMicros) ||
      node.estimatedCostMicros > taskIntent.maxCostMicros
    ) {
      rejectedNodes.push({
        nodeId,
        agentId,
        reasonCode: 'COST_BUDGET_EXCEEDED',
        reason: 'Node estimatedCostMicros exceeds taskIntent maxCostMicros budget.',
      });
      continue;
    }

    const vectorsPresent =
      taskIntent.capabilityVector.length > 0 || node.capabilityVector.length > 0;
    if (
      !taskHasValidVector ||
      !isValidVector(node.capabilityVector) ||
      (vectorsPresent && taskIntent.capabilityVector.length !== node.capabilityVector.length)
    ) {
      rejectedNodes.push({
        nodeId,
        agentId,
        reasonCode: 'INVALID_CAPABILITY_VECTOR',
        reason: 'Capability vector is non-finite or has mismatched dimensions.',
      });
      continue;
    }

    const cosineSimilarity = roundScore(
      computeCosineSimilarity(taskIntent.capabilityVector, node.capabilityVector)
    );
    const nodeTags = normalizeTags(node.tags, redact);
    const { overlap, matchedTags } = computeLexicalTagOverlap(taskTags, nodeTags);
    const lexicalTagOverlap = roundScore(overlap);

    const hasVector = taskIntent.capabilityVector.length > 0;
    const hasTags = taskTags.length > 0 || nodeTags.length > 0;
    const rawScore =
      hasVector && hasTags
        ? vectorWeight * cosineSimilarity + tagWeight * lexicalTagOverlap
        : hasVector
          ? cosineSimilarity
          : lexicalTagOverlap;
    const resonanceScore = roundScore(rawScore);

    if (resonanceScore < minResonanceScore) {
      continue;
    }

    rankedMatches.push({
      nodeId,
      agentId,
      endpoint,
      companyId: node.companyId,
      estimatedCostMicros: node.estimatedCostMicros,
      cosineSimilarity,
      lexicalTagOverlap,
      resonanceScore,
      matchedTags,
    });
  }

  rankedMatches.sort((left, right) => {
    if (right.resonanceScore !== left.resonanceScore) {
      return right.resonanceScore - left.resonanceScore;
    }
    if (left.estimatedCostMicros !== right.estimatedCostMicros) {
      return left.estimatedCostMicros - right.estimatedCostMicros;
    }
    return left.nodeId.localeCompare(right.nodeId);
  });

  const selectedNode = rankedMatches[0] ?? null;
  const dispatchSha256 = sha256Canonical({
    taskId,
    summary,
    companyId: taskIntent.companyId,
    dataClassification: taskIntent.dataClassification,
    maxCostMicros: taskIntent.maxCostMicros,
    rankedMatches,
    rejectedNodes,
    automatedSelfAccept: false as const,
  });

  return {
    taskId,
    companyId: taskIntent.companyId,
    dataClassification: taskIntent.dataClassification,
    maxCostMicros: taskIntent.maxCostMicros,
    selectedNode,
    rankedMatches,
    rejectedNodes,
    automatedSelfAccept: false,
    dispatchSha256,
  };
}
