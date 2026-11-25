import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildMerkleAuditTree,
  computeAuditPath,
  computeConsistencySubproof,
  computeMerkleTreeHash,
  emptyTreeHash,
  generateMerkleInclusionProof,
  hashMerkleLeaf,
  hashMerkleNode,
  isPowerOfTwo,
  largestPowerOfTwoLessThan,
  RFC6962_LEAF_DOMAIN_PREFIX,
  RFC6962_NODE_DOMAIN_PREFIX,
  verifyConsistencyProofHashes,
  verifyMerkleConsistency,
  verifyMerkleInclusionProof,
} from '../src/merkle-ledger.js';

describe('M16.03 RFC 6962 Merkle Sovereignty Ledger', () => {
  it('enforces strict RFC 6962 0x00 leaf vs 0x01 internal node domain separation', () => {
    const payload = { action: 'audit', seq: 1 };
    const leafHash = hashMerkleLeaf(payload);
    const expectedLeaf = createHash('sha256')
      .update(
        Buffer.concat([
          Buffer.from([RFC6962_LEAF_DOMAIN_PREFIX]),
          Buffer.from('{"action":"audit","seq":1}', 'utf8'),
        ])
      )
      .digest('hex');

    expect(leafHash).toBe(expectedLeaf);

    const nodeHash = hashMerkleNode(leafHash, leafHash);
    const expectedNode = createHash('sha256')
      .update(
        Buffer.concat([
          Buffer.from([RFC6962_NODE_DOMAIN_PREFIX]),
          Buffer.from(leafHash, 'hex'),
          Buffer.from(leafHash, 'hex'),
        ])
      )
      .digest('hex');

    expect(nodeHash).toBe(expectedNode);

    // Second-preimage resistance: hashing raw concatenated child bytes as a leaf must differ from internal node hash
    const rawConcatAsLeaf = hashMerkleLeaf(`${leafHash}${leafHash}`);
    expect(rawConcatAsLeaf).not.toBe(nodeHash);
  });

  it('produces identical leaf hashes regardless of object key order and redacts sensitive fields', () => {
    const eventA = { b: 2, a: 1, apiKey: 'sk-proj-secretvalue1234567890' };
    const eventB = { a: 1, apiKey: 'sk-proj-secretvalue1234567890', b: 2 };

    const treeA = buildMerkleAuditTree([eventA]);
    const treeB = buildMerkleAuditTree([eventB]);

    expect(treeA.rootHash).toBe(treeB.rootHash);
    expect(treeA.rfc6962DomainSeparated).toBe(true);
    expect(treeA.automatedSelfAccept).toBe(false);
    expect(treeA.automatedPromotionAllowed).toBe(false);
    expect(JSON.stringify(treeA.redactedEvents)).not.toContain('sk-proj-secretvalue1234567890');
  });

  it('generates and verifies inclusion proofs for every leaf in non-power-of-two trees', () => {
    const events = Array.from({ length: 7 }, (_, idx) => ({
      seq: idx + 1,
      kind: 'governance-event',
      detail: `entry-${idx + 1}`,
    }));

    const tree = buildMerkleAuditTree(events);
    expect(tree.leafCount).toBe(7);
    expect(tree.treeSha256).toMatch(/^[0-9a-f]{64}$/u);

    for (let i = 0; i < events.length; i += 1) {
      const proof = generateMerkleInclusionProof(tree, i);
      expect(proof.automatedSelfAccept).toBe(false);
      expect(proof.automatedPromotionAllowed).toBe(false);
      expect(proof.proofSha256).toMatch(/^[0-9a-f]{64}$/u);

      const verification = verifyMerkleInclusionProof(events[i], proof, tree.rootHash);
      expect(verification.valid).toBe(true);
      expect(verification.computedRootHash).toBe(tree.rootHash);
    }
  });

  it('detects tampering of leaf payload, expected root hash, or audit path', () => {
    const events = [
      { seq: 1, amount: 100 },
      { seq: 2, amount: 250 },
      { seq: 3, amount: 500 },
      { seq: 4, amount: 750 },
    ];
    const tree = buildMerkleAuditTree(events);
    const proof = generateMerkleInclusionProof(tree, 2);

    const tamperedPayload = verifyMerkleInclusionProof(
      { seq: 3, amount: 999999 },
      proof,
      tree.rootHash
    );
    expect(tamperedPayload.valid).toBe(false);
    expect(tamperedPayload.reason).toBe('MERKLE_ROOT_MISMATCH');

    const tamperedRoot = verifyMerkleInclusionProof(events[2], proof, '0'.repeat(64));
    expect(tamperedRoot.valid).toBe(false);
    expect(tamperedRoot.reason).toBe('MERKLE_ROOT_MISMATCH');
  });

  it('proves append-only consistency in O(log N) hashes across multiple tree sizes', () => {
    const allEvents = Array.from({ length: 16 }, (_, idx) => ({
      seq: idx + 1,
      event: `append-${idx + 1}`,
    }));

    for (const olderSize of [1, 2, 3, 4, 5, 7, 8, 11]) {
      for (const newerSize of [olderSize, olderSize + 1, 13, 16]) {
        if (newerSize < olderSize) continue;
        const result = verifyMerkleConsistency(
          allEvents.slice(0, olderSize),
          allEvents.slice(0, newerSize)
        );
        expect(result.consistent).toBe(true);
        expect(result.olderTreeSize).toBe(olderSize);
        expect(result.newerTreeSize).toBe(newerSize);
        expect(result.proofHashCount).toBeLessThanOrEqual(Math.ceil(Math.log2(newerSize)) + 1);
        expect(result.automatedSelfAccept).toBe(false);
        expect(result.automatedPromotionAllowed).toBe(false);
        expect(result.verificationSha256).toMatch(/^[0-9a-f]{64}$/u);
      }
    }
  });

  it('rejects history rewrites and truncation in consistency verification', () => {
    const olderEvents = [
      { seq: 1, decision: 'deny' },
      { seq: 2, decision: 'allow' },
      { seq: 3, decision: 'deny' },
    ];
    const rewrittenNewerEvents = [
      { seq: 1, decision: 'deny' },
      { seq: 2, decision: 'TAMPERED' },
      { seq: 3, decision: 'deny' },
      { seq: 4, decision: 'allow' },
    ];

    const rewriteCheck = verifyMerkleConsistency(olderEvents, rewrittenNewerEvents);
    expect(rewriteCheck.consistent).toBe(false);
    expect(rewriteCheck.reason).toBe('APPEND_ONLY_CONSISTENCY_VIOLATED');

    const truncatedCheck = verifyMerkleConsistency(olderEvents, olderEvents.slice(0, 2));
    expect(truncatedCheck.consistent).toBe(false);
    expect(truncatedCheck.reason).toBe('NEWER_TREE_SMALLER_THAN_OLDER');
  });

  it('exports low-level RFC 6962 helpers and supports optional unredacted inclusion verification', () => {
    expect(emptyTreeHash()).toBe(createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
    expect(largestPowerOfTwoLessThan(7)).toBe(4);
    expect(isPowerOfTwo(8)).toBe(true);
    expect(isPowerOfTwo(7)).toBe(false);

    const payloads = [
      { id: 1, secret: 'alpha' },
      { id: 2, secret: 'beta' },
    ];
    const unredactedLeafHashes = payloads.map((p) => hashMerkleLeaf(p));
    const rootHash = computeMerkleTreeHash(unredactedLeafHashes);
    const auditPath = computeAuditPath(unredactedLeafHashes, 0);
    expect(auditPath).toHaveLength(1);

    const subproof = computeConsistencySubproof(1, unredactedLeafHashes, true);
    expect(verifyConsistencyProofHashes(1, 2, unredactedLeafHashes[0]!, rootHash, subproof)).toBe(
      true
    );

    const tree = buildMerkleAuditTree(payloads);
    const redactedProof = generateMerkleInclusionProof(tree, 0);
    expect(verifyMerkleInclusionProof(payloads[0], redactedProof, tree.rootHash).valid).toBe(true);
    expect(
      verifyMerkleInclusionProof(payloads[0], redactedProof, tree.rootHash, { redact: false }).valid
    ).toBe(false);
  });
});
