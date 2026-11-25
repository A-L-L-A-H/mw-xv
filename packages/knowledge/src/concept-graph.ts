import { isRecord } from '@moonwitness/types';
import { hashCanonicalJson } from './canonical-json.js';
import {
  resolveKnowledgeIdentity,
  validateCanonicalKnowledgeId,
  type CanonicalKnowledgeId,
  type KnowledgeAlias,
  type KnowledgeIdentityReference,
  type KnowledgeIdentityResolution,
} from './identity.js';
import {
  validateKnowledgeProvenanceGraph,
  type KnowledgeProvenanceActivity,
  type KnowledgeProvenanceGraph,
  type KnowledgeProvenanceRecord,
} from './provenance.js';
import type { KnowledgeValidationIssue, KnowledgeValidationResult } from './types.js';

export const conceptGraphRelations = [
  'broader',
  'narrower',
  'related',
  'synonym',
  'antonym',
  'evidence',
  'governed-by',
  'derived-from',
] as const;
export type ConceptGraphRelation = (typeof conceptGraphRelations)[number];

export const mizanGovernancePrinciples = [
  'justice',
  'balance',
  'accountability',
  'transparency',
  'non-harm',
  'stewardship',
] as const;
export type MizanGovernancePrinciple = (typeof mizanGovernancePrinciples)[number];

export const conceptGraphProvenanceKinds = ['Assertion', 'Evidence', 'ProvenanceActivity'] as const;
export type ConceptGraphProvenanceKind = (typeof conceptGraphProvenanceKinds)[number];

export interface ConceptGraphNodeInput {
  readonly id: string;
  readonly label: string;
  readonly definition?: string;
  readonly provenanceIds?: readonly string[];
}

export interface ConceptGraphEdgeInput {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly relation: ConceptGraphRelation;
  readonly weight?: number;
  readonly provenanceIds?: readonly string[];
}

export interface MizanGovernanceAxiomInput {
  readonly id: string;
  readonly principle: MizanGovernancePrinciple;
  readonly statement: string;
}

export interface ConceptGraphInput {
  readonly nodes: readonly ConceptGraphNodeInput[];
  readonly edges?: readonly ConceptGraphEdgeInput[];
  readonly axioms?: readonly MizanGovernanceAxiomInput[];
}

export interface ConceptGraphNode {
  readonly id: CanonicalKnowledgeId;
  readonly label: string;
  readonly definition: string | null;
  readonly provenanceIds: readonly CanonicalKnowledgeId[];
}

export interface ConceptGraphEdge {
  readonly id: CanonicalKnowledgeId;
  readonly fromId: CanonicalKnowledgeId;
  readonly toId: CanonicalKnowledgeId;
  readonly relation: ConceptGraphRelation;
  readonly weight: number;
  readonly provenanceIds: readonly CanonicalKnowledgeId[];
}

export interface MizanGovernanceAxiom {
  readonly id: CanonicalKnowledgeId;
  readonly principle: MizanGovernancePrinciple;
  readonly statement: string;
}

export interface ConceptGraphIndex {
  readonly version: 'moonwitness-concept-graph/v1';
  readonly nodes: readonly ConceptGraphNode[];
  readonly edges: readonly ConceptGraphEdge[];
  readonly axioms: readonly MizanGovernanceAxiom[];
  readonly nodesById: ReadonlyMap<string, ConceptGraphNode>;
  readonly outgoingByConceptId: ReadonlyMap<string, readonly ConceptGraphEdge[]>;
  readonly incomingByConceptId: ReadonlyMap<string, readonly ConceptGraphEdge[]>;
  readonly provenanceByConceptId: ReadonlyMap<string, readonly string[]>;
  readonly axiomsById: ReadonlyMap<string, MizanGovernanceAxiom>;
  readonly digest: string;
}

export type ConceptProvenanceLookupStatus =
  KnowledgeIdentityResolution['status'] | 'invalid-provenance';

export interface ConceptProvenanceLookup {
  readonly status: ConceptProvenanceLookupStatus;
  readonly identityStatus: KnowledgeIdentityResolution['status'];
  readonly conceptId?: CanonicalKnowledgeId;
  readonly concept?: ConceptGraphNode;
  readonly canonicalIds?: readonly CanonicalKnowledgeId[];
  readonly provenanceIds: readonly string[];
  readonly records: readonly KnowledgeProvenanceRecord[];
  readonly activities: readonly KnowledgeProvenanceActivity[];
  readonly issues: readonly KnowledgeValidationIssue[];
}

export class ConceptGraphError extends Error {
  readonly issues: readonly KnowledgeValidationIssue[];

  constructor(issues: readonly KnowledgeValidationIssue[]) {
    super(`Invalid concept graph: ${issues.map((issue) => issue.message).join('; ')}`);
    this.name = 'ConceptGraphError';
    this.issues = issues;
  }
}

function axiom(
  token: string,
  principle: MizanGovernancePrinciple,
  statement: string
): MizanGovernanceAxiom {
  return {
    id: `mw:assertion:${token}` as CanonicalKnowledgeId,
    principle,
    statement,
  };
}

/** Non-removable governance axioms consumed by every canonical concept graph index. */
export const MIZAN_GOVERNANCE_AXIOMS: readonly MizanGovernanceAxiom[] = [
  axiom(
    'mizan-justice',
    'justice',
    'A concept relation must not elevate a claim above an equally traceable alternative.'
  ),
  axiom(
    'mizan-balance',
    'balance',
    'Every asserted semantic edge must carry provenance and a bounded weight.'
  ),
  axiom(
    'mizan-accountability',
    'accountability',
    'Every concept and semantic edge must identify a canonical provenance reference.'
  ),
  axiom(
    'mizan-transparency',
    'transparency',
    'Provenance references must be canonical and resolvable before index publication.'
  ),
  axiom(
    'mizan-non-harm',
    'non-harm',
    'Hierarchical relations must remain acyclic so derived authority cannot be circular.'
  ),
  axiom(
    'mizan-stewardship',
    'stewardship',
    'Canonical identifiers and deterministic ordering must preserve the integrity of the graph.'
  ),
];

function stringIssue(path: string, keyword: string, message: string): KnowledgeValidationIssue {
  return { path, keyword, message };
}

function compareIssue(left: KnowledgeValidationIssue, right: KnowledgeValidationIssue): number {
  return (
    left.path.localeCompare(right.path) ||
    left.keyword.localeCompare(right.keyword) ||
    left.message.localeCompare(right.message)
  );
}

function canonicalProvenanceIssue(
  value: unknown,
  path: string
): KnowledgeValidationIssue | undefined {
  const result = validateCanonicalKnowledgeId(value);
  if (!result.valid)
    return stringIssue(path, 'canonicalId', result.issue ?? 'Invalid canonical ID');
  if (!conceptGraphProvenanceKinds.includes(result.kind as ConceptGraphProvenanceKind)) {
    return stringIssue(
      path,
      'provenanceKind',
      `provenance ID must use an Assertion, Evidence, or ProvenanceActivity kind: ${String(value)}`
    );
  }
  return undefined;
}

function readProvenanceIds(value: unknown, path: string, issues: KnowledgeValidationIssue[]) {
  const provenanceIds: string[] = [];
  if (!Array.isArray(value)) {
    issues.push(stringIssue(path, 'provenanceIds', 'provenanceIds must be an array'));
    return provenanceIds;
  }
  value.forEach((id, index) => {
    const issue = canonicalProvenanceIssue(id, `${path}/${index}`);
    if (issue) issues.push(issue);
    else provenanceIds.push(id as string);
  });
  if (provenanceIds.length === 0) {
    issues.push(stringIssue(path, 'missingProvenance', 'at least one provenance ID is required'));
  }
  return [...new Set(provenanceIds)].sort();
}

/** Validate structure, canonical identity, provenance, and Mizan governance axioms. */
export function validateConceptGraph(value: unknown): KnowledgeValidationResult {
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    return {
      valid: false,
      issues: [stringIssue('/nodes', 'shape', 'concept graph nodes must be an array')],
    };
  }
  if (value.edges !== undefined && !Array.isArray(value.edges)) {
    return {
      valid: false,
      issues: [stringIssue('/edges', 'shape', 'concept graph edges must be an array')],
    };
  }
  if (value.axioms !== undefined && !Array.isArray(value.axioms)) {
    return {
      valid: false,
      issues: [stringIssue('/axioms', 'shape', 'governance axioms must be an array')],
    };
  }

  const issues: KnowledgeValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();
  const axioms = [...MIZAN_GOVERNANCE_AXIOMS, ...((value.axioms ?? []) as unknown[])];
  const axiomIds = new Set<string>();

  value.nodes.forEach((node: unknown, index: number) => {
    const path = `/nodes/${index}`;
    if (!isRecord(node)) {
      issues.push(stringIssue(path, 'shape', 'concept node must be an object'));
      return;
    }
    const idResult = validateCanonicalKnowledgeId(node.id);
    if (!idResult.valid)
      issues.push(
        stringIssue(`${path}/id`, 'canonicalId', idResult.issue ?? 'Invalid canonical ID')
      );
    else if (idResult.kind !== 'Concept')
      issues.push(
        stringIssue(`${path}/id`, 'recordKind', 'concept node ID must use the Concept kind')
      );
    if (typeof node.id === 'string') {
      if (nodeIds.has(node.id))
        issues.push(stringIssue(`${path}/id`, 'duplicateId', `duplicate concept ID: ${node.id}`));
      nodeIds.add(node.id);
    }
    if (
      typeof node.label !== 'string' ||
      node.label.trim().length === 0 ||
      node.label.length > 300
    ) {
      issues.push(
        stringIssue(`${path}/label`, 'label', 'concept label must contain 1 to 300 characters')
      );
    }
    if (node.definition !== undefined && typeof node.definition !== 'string') {
      issues.push(
        stringIssue(`${path}/definition`, 'definition', 'concept definition must be a string')
      );
    } else if (typeof node.definition === 'string' && node.definition.length > 2_000) {
      issues.push(
        stringIssue(
          `${path}/definition`,
          'definition',
          'concept definition exceeds 2000 characters'
        )
      );
    }
    readProvenanceIds(node.provenanceIds, `${path}/provenanceIds`, issues);
  });

  const edges = (value.edges ?? []) as unknown[];
  edges.forEach((edge: unknown, index: number) => {
    const path = `/edges/${index}`;
    if (!isRecord(edge)) {
      issues.push(stringIssue(path, 'shape', 'concept edge must be an object'));
      return;
    }
    const idResult = validateCanonicalKnowledgeId(edge.id);
    if (!idResult.valid)
      issues.push(
        stringIssue(`${path}/id`, 'canonicalId', idResult.issue ?? 'Invalid canonical ID')
      );
    else if (idResult.kind !== 'Relation')
      issues.push(
        stringIssue(`${path}/id`, 'recordKind', 'concept edge ID must use the Relation kind')
      );
    if (typeof edge.id === 'string') {
      if (edgeIds.has(edge.id))
        issues.push(
          stringIssue(`${path}/id`, 'duplicateId', `duplicate concept edge ID: ${edge.id}`)
        );
      edgeIds.add(edge.id);
    }

    for (const endpoint of ['fromId', 'toId'] as const) {
      const endpointResult = validateCanonicalKnowledgeId(edge[endpoint]);
      if (!endpointResult.valid) {
        issues.push(
          stringIssue(
            `${path}/${endpoint}`,
            'canonicalId',
            endpointResult.issue ?? 'Invalid canonical ID'
          )
        );
      } else if (endpointResult.kind !== 'Concept') {
        issues.push(
          stringIssue(`${path}/${endpoint}`, 'recordKind', `${endpoint} must use the Concept kind`)
        );
      } else if (!nodeIds.has(edge[endpoint] as string)) {
        issues.push(
          stringIssue(
            `${path}/${endpoint}`,
            'unresolvedReference',
            `${endpoint} does not resolve to a concept node`
          )
        );
      }
    }
    if (typeof edge.fromId === 'string' && edge.fromId === edge.toId) {
      issues.push(
        stringIssue(`${path}/toId`, 'semanticSelfLoop', 'a concept edge cannot reference itself')
      );
    }
    if (!conceptGraphRelations.includes(edge.relation as ConceptGraphRelation)) {
      issues.push(
        stringIssue(
          `${path}/relation`,
          'relation',
          'concept edge relation is not in the canonical vocabulary'
        )
      );
    }
    if (
      edge.weight !== undefined &&
      (typeof edge.weight !== 'number' ||
        !Number.isFinite(edge.weight) ||
        edge.weight < 0 ||
        edge.weight > 1)
    ) {
      issues.push(
        stringIssue(
          `${path}/weight`,
          'weight',
          'concept edge weight must be a finite number from 0 to 1'
        )
      );
    }
    readProvenanceIds(edge.provenanceIds, `${path}/provenanceIds`, issues);
    if (typeof edge.fromId === 'string' && typeof edge.toId === 'string') {
      const pair = `${edge.fromId}\0${String(edge.relation)}\0${edge.toId}`;
      if (edgePairs.has(pair)) {
        issues.push(
          stringIssue(`${path}/relation`, 'duplicateRelation', 'duplicate semantic relation')
        );
      }
      edgePairs.add(pair);
    }
  });

  axioms.forEach((axiomValue: unknown, index: number) => {
    const path = `/axioms/${index}`;
    if (!isRecord(axiomValue)) {
      issues.push(stringIssue(path, 'shape', 'governance axiom must be an object'));
      return;
    }
    const result = validateCanonicalKnowledgeId(axiomValue.id);
    if (!result.valid)
      issues.push(stringIssue(`${path}/id`, 'canonicalId', result.issue ?? 'Invalid canonical ID'));
    else if (result.kind !== 'Assertion')
      issues.push(
        stringIssue(`${path}/id`, 'recordKind', 'governance axiom ID must use the Assertion kind')
      );
    if (typeof axiomValue.id === 'string') {
      if (axiomIds.has(axiomValue.id)) {
        issues.push(
          stringIssue(
            `${path}/id`,
            'duplicateId',
            `duplicate governance axiom ID: ${axiomValue.id}`
          )
        );
      }
      axiomIds.add(axiomValue.id);
    }
    if (!mizanGovernancePrinciples.includes(axiomValue.principle as MizanGovernancePrinciple)) {
      issues.push(
        stringIssue(
          `${path}/principle`,
          'principle',
          'governance principle is not in the Mizan vocabulary'
        )
      );
    }
    if (
      typeof axiomValue.statement !== 'string' ||
      axiomValue.statement.trim().length === 0 ||
      axiomValue.statement.length > 1_000
    ) {
      issues.push(
        stringIssue(
          `${path}/statement`,
          'statement',
          'governance axiom statement must contain 1 to 1000 characters'
        )
      );
    }
  });

  const broaderEdges = new Map<string, string[]>();
  edges.forEach((edge: unknown) => {
    if (!isRecord(edge) || edge.relation !== 'broader') return;
    if (typeof edge.fromId !== 'string' || typeof edge.toId !== 'string') return;
    broaderEdges.set(edge.fromId, [...(broaderEdges.get(edge.fromId) ?? []), edge.toId]);
  });
  const visited = new Set<string>();
  const active = new Set<string>();
  const cycleNodes = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) {
      cycleNodes.add(id);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    for (const next of broaderEdges.get(id) ?? []) visit(next);
    active.delete(id);
  };
  for (const id of broaderEdges.keys()) visit(id);
  if (cycleNodes.size > 0) {
    edges.forEach((edge: unknown, index: number) => {
      if (!isRecord(edge) || edge.relation !== 'broader') return;
      if (typeof edge.fromId !== 'string' || !cycleNodes.has(edge.fromId)) return;
      issues.push(
        stringIssue(
          `/edges/${index}/toId`,
          'mizanCycle',
          'Mizan non-harm axiom forbids circular hierarchical relations'
        )
      );
    });
  }

  issues.sort(compareIssue);
  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

function normalizeIndex(value: ConceptGraphInput, axioms: readonly MizanGovernanceAxiom[]) {
  const nodes: ConceptGraphNode[] = value.nodes.map((node) => ({
    id: node.id as CanonicalKnowledgeId,
    label: node.label,
    definition: node.definition ?? null,
    provenanceIds: [...new Set(node.provenanceIds ?? [])].sort() as CanonicalKnowledgeId[],
  }));
  const edges: ConceptGraphEdge[] = (value.edges ?? []).map((edge) => ({
    id: edge.id as CanonicalKnowledgeId,
    fromId: edge.fromId as CanonicalKnowledgeId,
    toId: edge.toId as CanonicalKnowledgeId,
    relation: edge.relation,
    weight: edge.weight ?? 1,
    provenanceIds: [...new Set(edge.provenanceIds ?? [])].sort() as CanonicalKnowledgeId[],
  }));
  nodes.sort((left, right) => left.id.localeCompare(right.id));
  edges.sort((left, right) => left.id.localeCompare(right.id));
  const orderedAxioms = [...axioms].sort((left, right) => left.id.localeCompare(right.id));
  return { nodes, edges, axioms: orderedAxioms };
}

function addToIndexMap(
  map: Map<string, ConceptGraphEdge[]>,
  key: string,
  edge: ConceptGraphEdge
): void {
  map.set(key, [...(map.get(key) ?? []), edge]);
}

/** Build a canonical, deterministically ordered concept graph index or fail closed. */
export function buildConceptGraphIndex(value: unknown): ConceptGraphIndex {
  const validation = validateConceptGraph(value);
  if (!validation.valid) throw new ConceptGraphError(validation.issues);
  const input = value as ConceptGraphInput;
  const axioms: MizanGovernanceAxiom[] = [...MIZAN_GOVERNANCE_AXIOMS, ...(input.axioms ?? [])].map(
    (item) => ({
      id: item.id as CanonicalKnowledgeId,
      principle: item.principle,
      statement: item.statement,
    })
  );
  const { nodes, edges, axioms: orderedAxioms } = normalizeIndex(input, axioms);
  const nodesById = new Map<string, ConceptGraphNode>(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, ConceptGraphEdge[]>();
  const incoming = new Map<string, ConceptGraphEdge[]>();
  const provenance = new Map<string, Set<string>>();

  for (const node of nodes) provenance.set(node.id, new Set(node.provenanceIds));
  for (const edge of edges) {
    addToIndexMap(outgoing, edge.fromId, edge);
    addToIndexMap(incoming, edge.toId, edge);
    for (const id of [edge.fromId, edge.toId]) {
      const target = provenance.get(id) ?? new Set<string>();
      for (const provenanceId of edge.provenanceIds) target.add(provenanceId);
      provenance.set(id, target);
    }
  }

  const digest = hashCanonicalJson({
    version: 'moonwitness-concept-graph/v1',
    nodes,
    edges,
    axioms: orderedAxioms,
  });

  return {
    version: 'moonwitness-concept-graph/v1',
    nodes,
    edges,
    axioms: orderedAxioms,
    nodesById,
    outgoingByConceptId: new Map(
      [...outgoing].map(([id, items]) => [
        id,
        [...items].sort((left, right) => left.id.localeCompare(right.id)),
      ])
    ),
    incomingByConceptId: new Map(
      [...incoming].map(([id, items]) => [
        id,
        [...items].sort((left, right) => left.id.localeCompare(right.id)),
      ])
    ),
    provenanceByConceptId: new Map([...provenance].map(([id, ids]) => [id, [...ids].sort()])),
    axiomsById: new Map(orderedAxioms.map((item) => [item.id, item])),
    digest,
  };
}

/** Resolve a concept alias or canonical ID and return its canonical provenance neighborhood. */
export function lookupConceptProvenance(
  index: ConceptGraphIndex,
  reference: KnowledgeIdentityReference,
  provenanceGraph: KnowledgeProvenanceGraph,
  aliases: readonly KnowledgeAlias[] = []
): ConceptProvenanceLookup {
  const resolution = resolveKnowledgeIdentity(reference, [...index.nodesById.keys()], aliases);
  if (resolution.status !== 'resolved') {
    return {
      status: resolution.status,
      identityStatus: resolution.status,
      canonicalIds: resolution.status === 'conflict' ? resolution.canonicalIds : undefined,
      provenanceIds: [],
      records: [],
      activities: [],
      issues: [],
    };
  }

  const graphValidation = validateKnowledgeProvenanceGraph(provenanceGraph);
  if (!graphValidation.valid) {
    return {
      status: 'invalid-provenance',
      identityStatus: resolution.status,
      conceptId: resolution.canonicalId,
      concept: index.nodesById.get(resolution.canonicalId),
      provenanceIds: [],
      records: [],
      activities: [],
      issues: graphValidation.issues,
    };
  }

  const provenanceIds = [...(index.provenanceByConceptId.get(resolution.canonicalId) ?? [])].sort();
  const provenanceSet = new Set(provenanceIds);
  const records = provenanceGraph.records
    .filter(
      (record) =>
        provenanceSet.has(record.id) ||
        (record.derivation?.input_ids.some((id) => provenanceSet.has(id)) ?? false)
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const activities = provenanceGraph.activities
    .filter(
      (activity) =>
        provenanceSet.has(activity.id) ||
        activity.source_ids.some((id) => provenanceSet.has(id)) ||
        activity.used_ids.some((id) => provenanceSet.has(id)) ||
        activity.generated_ids.some((id) => provenanceSet.has(id))
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    status: 'resolved',
    identityStatus: resolution.status,
    conceptId: resolution.canonicalId,
    concept: index.nodesById.get(resolution.canonicalId),
    provenanceIds,
    records,
    activities,
    issues: [],
  };
}
