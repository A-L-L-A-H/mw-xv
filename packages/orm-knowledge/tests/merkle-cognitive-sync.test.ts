import { describe, expect, test } from 'vitest';
import {
  buildMerkleTree,
  diffCognitiveGraphs,
  generateMerkleProof,
  mergeCognitiveGraphs,
  verifyMerkleProof,
  type CognitiveGraphSnapshot,
  type CognitiveNode,
} from '../src/merkle-cognitive-sync.js';

function makeNode(
  id: string,
  lamportClock: number,
  peerId: string,
  value: string,
): CognitiveNode {
  return {
    id,
    kind: 'concept',
    payload: { value },
    lamportClock,
    peerId,
  };
}

describe('merkle-cognitive-sync', () => {
  test('builds Merkle tree and verifies inclusion proofs', () => {
    const nodes = new Map<string, CognitiveNode>([
      ['n1', makeNode('n1', 1, 'peer-a', 'alpha')],
      ['n2', makeNode('n2', 2, 'peer-a', 'beta')],
      ['n3', makeNode('n3', 3, 'peer-a', 'gamma')],
    ]);

    const tree = buildMerkleTree(nodes);
    expect(tree.rootHash).toHaveLength(64);

    const proof = generateMerkleProof(tree, 'n2');
    expect(proof).not.toBeNull();
    expect(verifyMerkleProof(proof!)).toBe(true);
    expect(generateMerkleProof(tree, 'missing')).toBeNull();
  });

  test('diffs and deterministically merges peer graphs without conflicts', () => {
    const peerA: CognitiveGraphSnapshot = {
      peerId: 'peer-a',
      nodes: new Map([
        ['n1', makeNode('n1', 1, 'peer-a', 'v1')],
        ['n2', makeNode('n2', 5, 'peer-a', 'v5-a')],
      ]),
    };

    const peerB: CognitiveGraphSnapshot = {
      peerId: 'peer-b',
      nodes: new Map([
        ['n1', makeNode('n1', 1, 'peer-a', 'v1')],
        ['n2', makeNode('n2', 3, 'peer-b', 'v3-b')],
        ['n3', makeNode('n3', 2, 'peer-b', 'v2-b')],
      ]),
    };

    const delta = diffCognitiveGraphs(peerB, peerA);
    expect(delta.identicalCount).toBe(1);
    expect(delta.missingInTarget.map((n) => n.id)).toEqual(['n3']);
    expect(delta.newerInSource).toHaveLength(0);

    const mergeAB = mergeCognitiveGraphs(peerA, peerB, 'merged');
    const mergeBA = mergeCognitiveGraphs(peerB, peerA, 'merged');

    expect(mergeAB.rootHash).toBe(mergeBA.rootHash);
    expect(mergeAB.merged.nodes.get('n2')?.payload.value).toBe('v5-a');
    expect(mergeAB.merged.nodes.get('n3')?.payload.value).toBe('v2-b');
  });
});
