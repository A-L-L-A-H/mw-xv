import { createHash } from 'node:crypto';
import { createRedactor } from './redaction.js';
import { sha256Canonical, toCanonicalJson } from './canonical-json.js';

export const RFC6962_LEAF_DOMAIN_PREFIX = 0x00;
export const RFC6962_NODE_DOMAIN_PREFIX = 0x01;

export interface MerkleAuditPathStep {
  readonly hash: string;
  readonly position: 'left' | 'right';
}

export interface MerkleAuditTree {
  readonly leafCount: number;
  readonly rootHash: string;
  readonly leafHashes: readonly string[];
  readonly redactedEvents: readonly unknown[];
  readonly rfc6962DomainSeparated: true;
  readonly automatedSelfAccept: false;
  readonly automatedPromotionAllowed: false;
  readonly treeSha256: string;
}

export interface MerkleInclusionProof {
  readonly leafIndex: number;
  readonly treeSize: number;
  readonly leafHash: string;
  readonly rootHash: string;
  readonly auditPath: readonly MerkleAuditPathStep[];
  readonly automatedSelfAccept: false;
  readonly automatedPromotionAllowed: false;
  readonly proofSha256: string;
}

export interface MerkleInclusionVerificationResult {
  readonly valid: boolean;
  readonly leafHash: string;
  readonly computedRootHash: string;
  readonly expectedRootHash: string;
  readonly reason?: string;
}

export interface MerkleConsistencyResult {
  readonly consistent: boolean;
  readonly olderTreeSize: number;
  readonly newerTreeSize: number;
  readonly olderRootHash: string;
  readonly newerRootHash: string;
  readonly consistencyProof: readonly string[];
  readonly proofHashCount: number;
  readonly automatedSelfAccept: false;
  readonly automatedPromotionAllowed: false;
  readonly verificationSha256: string;
  readonly reason?: string;
}

export interface VerifyMerkleInclusionProofOptions {
  readonly redact?: boolean;
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/iu;

export function emptyTreeHash(): string {
  return createHash('sha256').update(Buffer.alloc(0)).digest('hex');
}

export function largestPowerOfTwoLessThan(n: number): number {
  let k = 1;
  while (k * 2 < n) {
    k *= 2;
  }
  return k;
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * RFC 6962 Section 2.1 leaf hash:
 * MTH({d(0)}) = SHA-256(0x00 || canonicalJson(d(0)))
 */
export function hashMerkleLeaf(payload: unknown): string {
  const canonicalJson = toCanonicalJson(payload);
  const input = Buffer.concat([
    Buffer.from([RFC6962_LEAF_DOMAIN_PREFIX]),
    Buffer.from(canonicalJson, 'utf8'),
  ]);
  return createHash('sha256').update(input).digest('hex');
}

/**
 * RFC 6962 Section 2.1 internal node hash:
 * SHA-256(0x01 || leftBytes || rightBytes)
 */
export function hashMerkleNode(leftHex: string, rightHex: string): string {
  if (!SHA256_HEX_PATTERN.test(leftHex) || !SHA256_HEX_PATTERN.test(rightHex)) {
    throw new Error('hashMerkleNode requires 64-character hexadecimal SHA-256 digests');
  }
  const input = Buffer.concat([
    Buffer.from([RFC6962_NODE_DOMAIN_PREFIX]),
    Buffer.from(leftHex, 'hex'),
    Buffer.from(rightHex, 'hex'),
  ]);
  return createHash('sha256').update(input).digest('hex');
}

export function computeMerkleTreeHash(leafHashes: readonly string[]): string {
  const count = leafHashes.length;
  if (count === 0) {
    return emptyTreeHash();
  }
  if (count === 1) {
    return leafHashes[0]!;
  }
  const split = largestPowerOfTwoLessThan(count);
  const left = computeMerkleTreeHash(leafHashes.slice(0, split));
  const right = computeMerkleTreeHash(leafHashes.slice(split));
  return hashMerkleNode(left, right);
}

export function computeAuditPath(
  leafHashes: readonly string[],
  leafIndex: number
): MerkleAuditPathStep[] {
  const count = leafHashes.length;
  if (count <= 1) {
    return [];
  }
  const split = largestPowerOfTwoLessThan(count);
  if (leafIndex < split) {
    const subPath = computeAuditPath(leafHashes.slice(0, split), leafIndex);
    const siblingHash = computeMerkleTreeHash(leafHashes.slice(split));
    return [...subPath, { hash: siblingHash, position: 'right' }];
  }
  const subPath = computeAuditPath(leafHashes.slice(split), leafIndex - split);
  const siblingHash = computeMerkleTreeHash(leafHashes.slice(0, split));
  return [...subPath, { hash: siblingHash, position: 'left' }];
}

export function computeConsistencySubproof(
  m: number,
  leafHashes: readonly string[],
  isCompleteSubtree: boolean
): string[] {
  const n = leafHashes.length;
  if (m === n) {
    if (isCompleteSubtree) {
      return [];
    }
    return [computeMerkleTreeHash(leafHashes)];
  }
  const split = largestPowerOfTwoLessThan(n);
  if (m <= split) {
    const sub = computeConsistencySubproof(m, leafHashes.slice(0, split), isCompleteSubtree);
    return [...sub, computeMerkleTreeHash(leafHashes.slice(split))];
  }
  const sub = computeConsistencySubproof(m - split, leafHashes.slice(split), false);
  return [...sub, computeMerkleTreeHash(leafHashes.slice(0, split))];
}

export function verifyConsistencyProofHashes(
  olderSize: number,
  newerSize: number,
  olderRootHash: string,
  newerRootHash: string,
  proof: readonly string[]
): boolean {
  if (olderSize === 0) {
    return proof.length === 0;
  }
  if (olderSize === newerSize) {
    return proof.length === 0 && olderRootHash === newerRootHash;
  }
  if (olderSize > newerSize || proof.length === 0) {
    return false;
  }

  const nodes = isPowerOfTwo(olderSize) ? [olderRootHash, ...proof] : [...proof];
  let fn = olderSize - 1;
  let sn = newerSize - 1;

  while ((fn & 1) === 1) {
    fn >>= 1;
    sn >>= 1;
  }

  let fr = nodes[0]!;
  let sr = nodes[0]!;

  for (let i = 1; i < nodes.length; i += 1) {
    const sibling = nodes[i]!;
    if (sn === 0) {
      return false;
    }
    if ((fn & 1) === 1 || fn === sn) {
      fr = hashMerkleNode(sibling, fr);
      sr = hashMerkleNode(sibling, sr);
      while (fn !== 0 && (fn & 1) === 0) {
        fn >>= 1;
        sn >>= 1;
      }
    } else {
      sr = hashMerkleNode(sr, sibling);
    }
    fn >>= 1;
    sn >>= 1;
  }

  return sn === 0 && fr === olderRootHash && sr === newerRootHash;
}

export function buildMerkleAuditTree(events: readonly unknown[]): MerkleAuditTree {
  const redactor = createRedactor();
  const redactedEvents = events.map((event) => redactor.redactObject(event));
  const leafHashes = redactedEvents.map((event) => hashMerkleLeaf(event));
  const rootHash = computeMerkleTreeHash(leafHashes);

  const core = {
    leafCount: leafHashes.length,
    rootHash,
    leafHashes,
    rfc6962DomainSeparated: true as const,
    automatedSelfAccept: false as const,
    automatedPromotionAllowed: false as const,
  };

  return {
    ...core,
    redactedEvents,
    treeSha256: sha256Canonical(core),
  };
}

export function generateMerkleInclusionProof(
  tree: MerkleAuditTree,
  leafIndex: number
): MerkleInclusionProof {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new RangeError(
      `leafIndex ${String(leafIndex)} is out of bounds for tree size ${String(tree.leafCount)}`
    );
  }

  const auditPath = computeAuditPath(tree.leafHashes, leafIndex);
  const leafHash = tree.leafHashes[leafIndex]!;
  const core = {
    leafIndex,
    treeSize: tree.leafCount,
    leafHash,
    rootHash: tree.rootHash,
    auditPath,
    automatedSelfAccept: false as const,
    automatedPromotionAllowed: false as const,
  };

  return {
    ...core,
    proofSha256: sha256Canonical(core),
  };
}

export function verifyMerkleInclusionProof(
  leafPayload: unknown,
  proof: MerkleInclusionProof,
  expectedRootHash: string,
  options?: VerifyMerkleInclusionProofOptions
): MerkleInclusionVerificationResult {
  const shouldRedact = options?.redact ?? true;
  const payloadToHash = shouldRedact ? createRedactor().redactObject(leafPayload) : leafPayload;
  const leafHash = hashMerkleLeaf(payloadToHash);

  if (!SHA256_HEX_PATTERN.test(expectedRootHash)) {
    return {
      valid: false,
      leafHash,
      computedRootHash: '',
      expectedRootHash,
      reason: 'INVALID_EXPECTED_ROOT_HASH',
    };
  }

  if (proof.leafIndex < 0 || proof.leafIndex >= proof.treeSize) {
    return {
      valid: false,
      leafHash,
      computedRootHash: '',
      expectedRootHash,
      reason: 'LEAF_INDEX_OUT_OF_BOUNDS',
    };
  }

  let currentHash = leafHash;
  for (const step of proof.auditPath) {
    if (!SHA256_HEX_PATTERN.test(step.hash)) {
      return {
        valid: false,
        leafHash,
        computedRootHash: '',
        expectedRootHash,
        reason: 'INVALID_AUDIT_PATH_HASH',
      };
    }
    currentHash =
      step.position === 'left'
        ? hashMerkleNode(step.hash, currentHash)
        : hashMerkleNode(currentHash, step.hash);
  }

  const valid = currentHash === expectedRootHash && leafHash === proof.leafHash;
  return {
    valid,
    leafHash,
    computedRootHash: currentHash,
    expectedRootHash,
    ...(valid ? {} : { reason: 'MERKLE_ROOT_MISMATCH' }),
  };
}

export function verifyMerkleConsistency(
  olderEvents: readonly unknown[],
  newerEvents: readonly unknown[]
): MerkleConsistencyResult {
  const olderTree = buildMerkleAuditTree(olderEvents);
  const newerTree = buildMerkleAuditTree(newerEvents);
  const m = olderTree.leafCount;
  const n = newerTree.leafCount;

  if (m > n) {
    const core = {
      consistent: false,
      olderTreeSize: m,
      newerTreeSize: n,
      olderRootHash: olderTree.rootHash,
      newerRootHash: newerTree.rootHash,
      consistencyProof: [] as readonly string[],
      proofHashCount: 0,
      automatedSelfAccept: false as const,
      automatedPromotionAllowed: false as const,
      reason: 'NEWER_TREE_SMALLER_THAN_OLDER',
    };
    return {
      ...core,
      verificationSha256: sha256Canonical(core),
    };
  }

  if (m === 0) {
    const core = {
      consistent: true,
      olderTreeSize: 0,
      newerTreeSize: n,
      olderRootHash: olderTree.rootHash,
      newerRootHash: newerTree.rootHash,
      consistencyProof: [] as readonly string[],
      proofHashCount: 0,
      automatedSelfAccept: false as const,
      automatedPromotionAllowed: false as const,
    };
    return {
      ...core,
      verificationSha256: sha256Canonical(core),
    };
  }

  const consistencyProof = m === n ? [] : computeConsistencySubproof(m, newerTree.leafHashes, true);
  const consistent = verifyConsistencyProofHashes(
    m,
    n,
    olderTree.rootHash,
    newerTree.rootHash,
    consistencyProof
  );

  const core = {
    consistent,
    olderTreeSize: m,
    newerTreeSize: n,
    olderRootHash: olderTree.rootHash,
    newerRootHash: newerTree.rootHash,
    consistencyProof,
    proofHashCount: consistencyProof.length,
    automatedSelfAccept: false as const,
    automatedPromotionAllowed: false as const,
    ...(consistent ? {} : { reason: 'APPEND_ONLY_CONSISTENCY_VIOLATED' }),
  };

  return {
    ...core,
    verificationSha256: sha256Canonical(core),
  };
}
