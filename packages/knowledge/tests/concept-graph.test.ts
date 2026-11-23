import { describe, expect, it } from 'vitest';
import {
  MIZAN_GOVERNANCE_AXIOMS,
  buildConceptGraphIndex,
  lookupConceptProvenance,
  validateConceptGraph,
  type ConceptGraphInput,
} from '../src/index.js';
import type { KnowledgeProvenanceGraph } from '../src/provenance.js';

const conceptAccountability = 'mw:concept:accountability';
const conceptJustice = 'mw:concept:justice';
const conceptBalance = 'mw:concept:balance';
const assertionGovernance = 'mw:assertion:governance-standard';
const evidenceAudit = 'mw:evidence:audit-trail';
const activityDerivation = 'mw:provenance-activity:governance-derivation';
const actorId = 'mw:agent:synthetic-reviewer';
const sourceId = 'mw:artifact:synthetic-source';
const inputId = 'mw:content:synthetic-input';

function graphInput(): ConceptGraphInput {
  return {
    nodes: [
      {
        id: conceptJustice,
        label: 'Justice',
        definition: 'Fair allocation of rights and obligations.',
        provenanceIds: [assertionGovernance],
      },
      {
        id: conceptBalance,
        label: 'Balance',
        provenanceIds: [evidenceAudit],
      },
      {
        id: conceptAccountability,
        label: 'Accountability',
        provenanceIds: [assertionGovernance, evidenceAudit],
      },
    ],
    edges: [
      {
        id: 'mw:relation:justice-governance',
        fromId: conceptJustice,
        toId: conceptAccountability,
        relation: 'governed-by',
        provenanceIds: [assertionGovernance],
      },
      {
        id: 'mw:relation:balance-related-justice',
        fromId: conceptBalance,
        toId: conceptJustice,
        relation: 'related',
        weight: 0.75,
        provenanceIds: [evidenceAudit],
      },
    ],
  };
}

function provenanceGraph(): KnowledgeProvenanceGraph {
  return {
    records: [
      { id: actorId, kind: 'Agent' },
      { id: sourceId, kind: 'Artifact' },
      { id: inputId, kind: 'Content' },
      {
        id: assertionGovernance,
        kind: 'Assertion',
        derivation: {
          activity_id: activityDerivation,
          input_ids: [inputId, sourceId],
          method_id: 'mw:method:governance-review',
          method_version: '1.0.0',
        },
      },
      {
        id: evidenceAudit,
        kind: 'Evidence',
        derivation: {
          activity_id: activityDerivation,
          input_ids: [inputId, sourceId],
          method_id: 'mw:method:governance-review',
          method_version: '1.0.0',
        },
      },
    ],
    activities: [
      {
        id: activityDerivation,
        actor_id: actorId,
        source_ids: [sourceId],
        used_ids: [inputId, sourceId],
        generated_ids: [assertionGovernance, evidenceAudit],
        started_at: '2026-10-15T10:00:00Z',
        ended_at: '2026-10-15T10:00:01Z',
        method_id: 'mw:method:governance-review',
        method_version: '1.0.0',
      },
    ],
  };
}

describe('canonical concept graph index', () => {
  it('builds deterministic indexes with canonical IDs, provenance maps, and Mizan axioms', () => {
    const input = graphInput();
    const first = buildConceptGraphIndex(input);
    const second = buildConceptGraphIndex(graphInput());

    expect(validateConceptGraph(input)).toEqual({ valid: true, issues: [] });
    expect(first.digest).toBe(second.digest);
    expect(first.version).toBe('moonwitness-concept-graph/v1');
    expect(first.nodes.map((node) => node.id)).toEqual([
      conceptAccountability,
      conceptBalance,
      conceptJustice,
    ]);
    expect(first.edges[0].weight).toBe(0.75);
    expect(first.edges[1].weight).toBe(1);
    expect(first.outgoingByConceptId.get(conceptJustice)?.map((edge) => edge.id)).toEqual([
      'mw:relation:justice-governance',
    ]);
    expect(first.incomingByConceptId.get(conceptAccountability)?.map((edge) => edge.id)).toEqual([
      'mw:relation:justice-governance',
    ]);
    expect(first.provenanceByConceptId.get(conceptAccountability)).toEqual([
      assertionGovernance,
      evidenceAudit,
    ]);
    expect(MIZAN_GOVERNANCE_AXIOMS.every((axiom) => first.axiomsById.has(axiom.id))).toBe(true);
  });

  it('keeps fixed Mizan axioms when callers supply supplemental axioms', () => {
    const input = graphInput();
    const index = buildConceptGraphIndex({
      ...input,
      axioms: [
        {
          id: 'mw:assertion:local-governance-rule',
          principle: 'stewardship',
          statement: 'Local records must cite their source corpus.',
        },
      ],
    });
    expect(index.axioms).toHaveLength(MIZAN_GOVERNANCE_AXIOMS.length + 1);
    expect(index.axiomsById.has('mw:assertion:mizan-justice')).toBe(true);
  });

  it('allows omitted edge weights but rejects out-of-range weights', () => {
    const validInput = graphInput();
    expect(validateConceptGraph(validInput)).toEqual({ valid: true, issues: [] });
    const invalid = {
      ...validInput,
      edges: [{ ...validInput.edges![0], weight: 1.2 }],
    };
    const result = validateConceptGraph(invalid);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected weight failure');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/edges/0/weight', keyword: 'weight' }),
      ])
    );
  });

  it('rejects wrong canonical kinds, unresolved endpoints, self-loops, and duplicate relations', () => {
    const wrongKindInput = graphInput();
    const wrongKind: ConceptGraphInput = {
      ...wrongKindInput,
      nodes: [
        { ...wrongKindInput.nodes[0], id: 'mw:entity:justice' },
        ...wrongKindInput.nodes.slice(1),
      ],
    };
    expect(validateConceptGraph(wrongKind)).toMatchObject({ valid: false });

    const unresolvedInput = graphInput();
    const unresolved: ConceptGraphInput = {
      ...unresolvedInput,
      edges: [
        { ...unresolvedInput.edges![0], toId: 'mw:concept:missing' },
        ...unresolvedInput.edges!.slice(1),
      ],
    };
    expect(validateConceptGraph(unresolved)).toMatchObject({ valid: false });

    const selfLoopInput = graphInput();
    const selfLoop: ConceptGraphInput = {
      ...selfLoopInput,
      edges: [
        { ...selfLoopInput.edges![0], toId: conceptJustice },
        ...selfLoopInput.edges!.slice(1),
      ],
    };
    expect(validateConceptGraph(selfLoop)).toMatchObject({ valid: false });

    const duplicateRelationInput = graphInput();
    const duplicateRelation: ConceptGraphInput = {
      ...duplicateRelationInput,
      edges: [
        duplicateRelationInput.edges![0],
        { ...duplicateRelationInput.edges![0], id: 'mw:relation:copy' },
      ],
    };
    const result = validateConceptGraph(duplicateRelation);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected duplicate relation');
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: 'duplicateRelation' })])
    );
  });

  it('rejects missing and wrong-kind provenance references', () => {
    const missingInput = graphInput();
    const missing: ConceptGraphInput = {
      ...missingInput,
      nodes: missingInput.nodes.map((node, index) =>
        index === 1 ? { ...node, provenanceIds: [] } : node
      ),
    };
    expect(validateConceptGraph(missing)).toMatchObject({ valid: false });

    const wrongKindInput = graphInput();
    const wrongKind: ConceptGraphInput = {
      ...wrongKindInput,
      edges: [
        { ...wrongKindInput.edges![0], provenanceIds: ['mw:concept:justice'] },
        ...wrongKindInput.edges!.slice(1),
      ],
    };
    const result = validateConceptGraph(wrongKind);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected provenance kind failure');
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: 'provenanceKind' })])
    );
  });

  it('rejects circular broader relations under the Mizan non-harm axiom', () => {
    const input = graphInput();
    const circularInput: ConceptGraphInput = {
      ...input,
      edges: [
        {
          id: 'mw:relation:justice-broader-accountability',
          fromId: conceptJustice,
          toId: conceptAccountability,
          relation: 'broader',
          provenanceIds: [assertionGovernance],
        },
        {
          id: 'mw:relation:accountability-broader-justice',
          fromId: conceptAccountability,
          toId: conceptJustice,
          relation: 'broader',
          provenanceIds: [assertionGovernance],
        },
      ],
    };
    const result = validateConceptGraph(circularInput);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected cycle failure');
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: 'mizanCycle' })])
    );
    expect(() => buildConceptGraphIndex(circularInput)).toThrow(/Mizan non-harm/);
  });

  it('resolves canonical and alias concept provenance neighborhoods', () => {
    const index = buildConceptGraphIndex(graphInput());
    const graph = provenanceGraph();
    const aliases = [
      { namespace: 'governance', value: 'accountability', targetId: conceptAccountability },
    ];

    const canonical = lookupConceptProvenance(
      index,
      { canonicalId: conceptAccountability },
      graph,
      aliases
    );
    expect(canonical.status).toBe('resolved');
    expect(canonical.provenanceIds).toEqual([assertionGovernance, evidenceAudit]);
    expect(canonical.records.map((record) => record.id)).toEqual([
      assertionGovernance,
      evidenceAudit,
    ]);
    expect(canonical.activities.map((activity) => activity.id)).toEqual([activityDerivation]);

    const aliasLookup = lookupConceptProvenance(
      index,
      { alias: { namespace: 'governance', value: 'accountability' } },
      graph,
      aliases
    );
    expect(aliasLookup.identityStatus).toBe('resolved');
    expect(aliasLookup.conceptId).toBe(conceptAccountability);
  });

  it('returns deterministic identity failures without reading provenance', () => {
    const index = buildConceptGraphIndex(graphInput());
    const aliases = [
      { namespace: 'governance', value: 'justice', targetId: conceptJustice },
      { namespace: 'governance', value: 'justice', targetId: conceptBalance },
      { namespace: 'governance', value: 'dangling', targetId: 'mw:concept:absent' },
    ];
    expect(
      lookupConceptProvenance(
        index,
        { canonicalId: 'mw:concept:absent' },
        provenanceGraph(),
        aliases
      ).status
    ).toBe('not-found');
    expect(
      lookupConceptProvenance(
        index,
        { alias: { namespace: 'governance', value: 'justice' } },
        provenanceGraph(),
        aliases
      ).status
    ).toBe('conflict');
    expect(
      lookupConceptProvenance(
        index,
        { alias: { namespace: 'governance', value: 'dangling' } },
        provenanceGraph(),
        aliases
      ).status
    ).toBe('dangling-alias');
  });

  it('fails closed on invalid provenance graphs', () => {
    const index = buildConceptGraphIndex(graphInput());
    const graph = provenanceGraph();
    graph.records.push({ id: 'mw:agent:missing-kind', kind: 'Evidence' });
    const lookup = lookupConceptProvenance(index, { canonicalId: conceptJustice }, graph);
    expect(lookup.status).toBe('invalid-provenance');
    expect(lookup.records).toEqual([]);
    expect(lookup.issues.length).toBeGreaterThan(0);
  });
});
