/**
 * T17 — RFC 6962 DAG-Merkle Proof Ledger.
 *
 * Domain-separated hashing with exact parity to
 * `packages/ai-runtime/src/merkle-ledger.ts`:
 *   - leaf   prefix 0x00: SHA-256(0x00 || canonicalJson(envelopeWithoutSelfHash))
 *   - node   prefix 0x01: SHA-256(0x01 || leftBytes || rightBytes)
 *
 * Exports:
 *   - hashProofLeaf(envelope)
 *   - sealProofEnvelope(draft, parentProofHashes)  — parent hashes derived
 *     strictly from `depends_on` predecessors so parallel /swarm workers never
 *     collide; unique sorted 64-hex hashes.
 *   - computeMerkleRoot(leafHashes) — deterministic RFC 6962 root over sorted
 *     proof leaves.
 *   - verifyProofChain(proofs, tasks) — every envelope_sha256 recomputes to
 *     the stored hash AND every depends_on predecessor's proof hash is present
 *     in parent_proof_hashes (tamper + skipped-dependency detection).
 *
 * No wall-clock linear order is assumed across unrelated parallel tasks.
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "../core/redaction.js";

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;
const SHA256_HEX = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ProofEnvelopeDraft {
  readonly schema_version: string;
  readonly task_urn: string;
  readonly code: string;
  readonly parent_proof_hashes: readonly string[];
  readonly commands: readonly unknown[];
  readonly diff_files: readonly string[];
  readonly owner_files_verified: boolean;
  readonly acceptance_criteria_state: readonly unknown[];
  readonly commit_sha: string | null;
  readonly model_tier?: string;
  readonly agent_runtime?: string;
  readonly verified_at?: string;
}

export interface ProofEnvelope extends ProofEnvelopeDraft {
  readonly envelope_sha256: string;
}

export interface VerifyOptions {
  readonly taskUrnByProofHash?: Map<string, string>;
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly failedProofs: Array<{
    readonly envelope_sha256: string;
    readonly task_urn: string;
    readonly reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * RFC 6962 leaf hash: SHA-256(0x00 || canonicalJson(envelopeWithoutSelfHash)).
 * The leaf payload is the full envelope as-is except `envelope_sha256` is
 * omitted when present (self-referencing-stable: compute first, then seal).
 * Generic over the payload shape so it hashes identically to
 * `packages/ai-runtime/src/merkle-ledger.ts` `hashMerkleLeaf`.
 */
export function hashProofLeaf(envelope: ProofEnvelopeDraft): string {
  const source = envelope as unknown as Record<string, unknown>;
  const withoutSelfHash: Record<string, unknown> = { ...source };
  delete withoutSelfHash.envelope_sha256;
  const canonical = canonicalJson(withoutSelfHash);
  const input = Buffer.concat([
    Buffer.from([LEAF_PREFIX]),
    Buffer.from(canonical, "utf8"),
  ]);
  return createHash("sha256").update(input).digest("hex");
}

/**
 * RFC 6962 internal node hash: SHA-256(0x01 || leftBytes || rightBytes).
 */
function hashMerkleNode(leftHex: string, rightHex: string): string {
  if (!SHA256_HEX.test(leftHex) || !SHA256_HEX.test(rightHex)) {
    throw new Error("hashMerkleNode requires 64-character hexadecimal SHA-256 digests");
  }
  const input = Buffer.concat([
    Buffer.from([NODE_PREFIX]),
    Buffer.from(leftHex, "hex"),
    Buffer.from(rightHex, "hex"),
  ]);
  return createHash("sha256").update(input).digest("hex");
}

/** Empty-tree hash: SHA-256 of zero bytes. */
export function emptyMerkleRoot(): string {
  return createHash("sha256").update(Buffer.alloc(0)).digest("hex");
}

/**
 * Deterministic RFC 6962 Merkle tree root over sorted proof leaves.
 * Leaves are sorted lexicographically before hashing so the root is
 * independent of input order.
 */
export function computeMerkleRoot(leafHashes: readonly string[]): string {
  const sorted = [...leafHashes].filter((h) => SHA256_HEX.test(h)).sort();
  if (sorted.length === 0) return emptyMerkleRoot();
  if (sorted.length === 1) return sorted[0]!;
  return buildRoot(sorted);
}

function buildRoot(level: string[]): string {
  if (level.length === 1) return level[0]!;
  const next: string[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i]!;
    const right = level[i + 1] ?? left; // duplicate last leaf on odd counts
    next.push(hashMerkleNode(left, right));
  }
  return buildRoot(next);
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

/**
 * Validate and normalize parent proof hashes: unique, sorted, 64-hex only.
 */
function normalizeParentHashes(hashes: readonly string[]): string[] {
  return [...new Set(hashes)].filter((h) => SHA256_HEX.test(h)).sort();
}

/**
 * Seal a proof envelope draft: sort/dedup the `parentProofHashes`,
 * compute `envelope_sha256` via `hashProofLeaf`, and return the sealed
 * `ProofEnvelope`. Parent hashes are derived strictly from `depends_on`
 * predecessors (passed in by the caller), so parallel /swarm workers over
 * disjoint task sets produce zero hash collisions.
 */
export function sealProofEnvelope(
  draft: ProofEnvelopeDraft,
  parentProofHashes: readonly string[]
): ProofEnvelope {
  const parents = normalizeParentHashes(parentProofHashes);
  const envelope: ProofEnvelope = {
    ...draft,
    parent_proof_hashes: parents,
    envelope_sha256: hashProofLeaf({ ...draft, parent_proof_hashes: parents }),
  };
  return envelope;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a proof chain:
 *   1. Every `envelope_sha256` recomputes to `hashProofLeaf(envelope)`.
 *   2. Every `depends_on` predecessor's proof hash is present in
 *      `parent_proof_hashes` (detects tampering or skipped dependency).
 *
 * `tasks` maps task_urn -> task graph with `depends_on`. The
 * `taskUrnByProofHash` option maps a proof hash back to its task_urn so the
 * predecessor check can resolve each `depends_on` code to its sealed proof.
 */
export function verifyProofChain(
  proofs: readonly ProofEnvelope[],
  tasks: readonly {
    readonly task_urn: string;
    readonly code: string;
    readonly graph?: { readonly depends_on?: readonly string[] };
  }[],
  options: VerifyOptions = {}
): VerifyResult {
  const taskUrnByProofHash = options.taskUrnByProofHash ?? new Map<string, string>();
  const proofByHash = new Map<string, ProofEnvelope>();
  const proofHashByTaskUrn = new Map<string, string>();

  for (const proof of proofs) {
    proofByHash.set(proof.envelope_sha256, proof);
    if (proof.task_urn) proofHashByTaskUrn.set(proof.task_urn, proof.envelope_sha256);
  }
  for (const [hash, urn] of taskUrnByProofHash) {
    if (!proofHashByTaskUrn.has(urn)) proofHashByTaskUrn.set(urn, hash);
  }

  const failed: VerifyResult["failedProofs"] = [];

  for (const proof of proofs) {
    // 1. Recompute the leaf hash and compare (envelope_sha256 excluded from
    //    the leaf payload by hashProofLeaf itself).
    const expected = hashProofLeaf(proof);
    if (expected !== proof.envelope_sha256) {
      failed.push({
        envelope_sha256: proof.envelope_sha256,
        task_urn: proof.task_urn,
        reason: "ENVELOPE_HASH_MISMATCH",
      });
      continue;
    }

    // 2. Every depends_on predecessor's proof hash must appear in
    //    parent_proof_hashes.
    const task = tasks.find((t) => t.task_urn === proof.task_urn);
    const deps = task?.graph?.depends_on ?? [];
    for (const depCode of deps) {
      // Resolve dependency code -> task_urn -> proof hash.
      const depTask = tasks.find((t) => t.code === depCode);
      const depUrn = depTask?.task_urn;
      const depProofHash = depUrn ? proofHashByTaskUrn.get(depUrn) : undefined;
      if (!depProofHash || !proof.parent_proof_hashes.includes(depProofHash)) {
        failed.push({
          envelope_sha256: proof.envelope_sha256,
          task_urn: proof.task_urn,
          reason: `MISSING_PARENT_PROOF_FOR_DEPENDENCY:${depCode}`,
        });
        break;
      }
    }
  }

  return { valid: failed.length === 0, failedProofs: failed };
}
