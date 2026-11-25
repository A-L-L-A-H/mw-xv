import { describe, it, expect } from "vitest";
import type { ProofEnvelopeDraft } from "../src/brain/merkle-dag.js";
import { hashProofLeaf, sealProofEnvelope, computeMerkleRoot, emptyMerkleRoot, verifyProofChain } from "../src/brain/merkle-dag.js";
import { createHash } from "node:crypto";
import { canonicalJson } from "../src/core/redaction.js";

describe("merkle-dag: RFC 6962 leaf/node hashing, parallel sealing, tamper verification", () => {
  const baseDraft = {
    schema_version: "1.0.0",
    task_urn: "urn:mw:work:moonwitness/test:W1/T01",
    code: "T01",
    parent_proof_hashes: [] as string[],
    commands: [{ cmd: "echo ok" }],
    diff_files: ["packages/plan-taskos/src/brain/merkle-dag.ts"],
    owner_files_verified: true,
    acceptance_criteria_state: [{ criterion: "typecheck", satisfied: true }],
    commit_sha: null,
    model_tier: "flash",
    agent_runtime: "claude-code",
    verified_at: "2026-01-01T00:00:00.000Z",
  };

  function hashMerkleNode(leftHex: string, rightHex: string): string {
    const SHA256_HEX = /^[0-9a-f]{64}$/;
    if (!SHA256_HEX.test(leftHex) || !SHA256_HEX.test(rightHex)) {
      throw new Error("hashMerkleNode requires 64-character hexadecimal SHA-256 digests");
    }
    const input = Buffer.concat([
      Buffer.from([0x01]),
      Buffer.from(leftHex, "hex"),
      Buffer.from(rightHex, "hex"),
    ]);
    return createHash("sha256").update(input).digest("hex");
  }

  it("hashProofLeaf produces deterministic SHA-256 with 0x00 prefix", () => {
    const h1 = hashProofLeaf(baseDraft);
    const h2 = hashProofLeaf(baseDraft);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // Verify 0x00 prefix is used by comparing with manual computation
    const canonical = canonicalJson(baseDraft);
    const input = Buffer.concat([Buffer.from([0x00]), Buffer.from(canonical, "utf8")]);
    const expected = createHash("sha256").update(input).digest("hex");
    expect(h1).toBe(expected);
  });

  it("hashProofLeaf is stable: envelope_sha256 excluded from leaf payload", () => {
    const draftWithHash = { ...baseDraft, envelope_sha256: "fake" } as typeof baseDraft & { envelope_sha256: string };
    // Should hash identically because envelope_sha256 is excluded
    const h1 = hashProofLeaf(baseDraft);
    const h2 = hashProofLeaf(draftWithHash);
    expect(h1).toBe(h2);
  });

  it("sealProofEnvelope sorts and dedups parent_proof_hashes", () => {
    const parents = ["c".repeat(64), "a".repeat(64), "b".repeat(64), "a".repeat(64)];
    const sealed = sealProofEnvelope(baseDraft, parents);
    expect(sealed.parent_proof_hashes).toEqual(["a".repeat(64), "b".repeat(64), "c".repeat(64)]);
    expect(sealed.envelope_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Verify the sealed envelope's hash matches recomputation
    expect(hashProofLeaf(sealed)).toBe(sealed.envelope_sha256);
  });

  it("sealProofEnvelope filters invalid hashes", () => {
    const parents = ["valid".repeat(12) + "0000", "invalid", "a".repeat(64)];
    const sealed = sealProofEnvelope(baseDraft, parents);
    expect(sealed.parent_proof_hashes).toEqual(["a".repeat(64)]);
  });

  it("parallel disjoint workers produce zero hash collisions", () => {
    // Two workers with completely different task graphs
    const draftA = { ...baseDraft, task_urn: "urn:mw:work:moonwitness/test:W1/T01", code: "T01" };
    const draftB = { ...baseDraft, task_urn: "urn:mw:work:moonwitness/test:W2/T02", code: "T02", parent_proof_hashes: [] };
    // Neither depends on the other
    const sealedA = sealProofEnvelope(draftA, []);
    const sealedB = sealProofEnvelope(draftB, []);
    // Hashes must be different because task_urn/code differ
    expect(sealedA.envelope_sha256).not.toBe(sealedB.envelope_sha256);
    // Parents are empty (no depends_on edge between them)
    expect(sealedA.parent_proof_hashes).toEqual([]);
    expect(sealedB.parent_proof_hashes).toEqual([]);
  });

  it("computeMerkleRoot returns empty tree hash for empty array", () => {
    const root = computeMerkleRoot([]);
    expect(root).toBe(emptyMerkleRoot());
    // Empty root should be SHA-256 of empty bytes
    expect(root).toBe(createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  });

  it("computeMerkleRoot single leaf returns the leaf hash", () => {
    const leaf = "a".repeat(64);
    const root = computeMerkleRoot([leaf]);
    expect(root).toBe(leaf);
  });

  it("computeMerkleRoot two leaves uses 0x01 node prefix", () => {
    const leaf1 = "a".repeat(64);
    const leaf2 = "b".repeat(64);
    const root = computeMerkleRoot([leaf1, leaf2]);
    // Verify with manual RFC 6962 node hash
    const nodeInput = Buffer.concat([Buffer.from([0x01]), Buffer.from(leaf1, "hex"), Buffer.from(leaf2, "hex")]);
    const expected = createHash("sha256").update(nodeInput).digest("hex");
    expect(root).toBe(expected);
  });

  it("computeMerkleRoot odd leaf count duplicates last leaf", () => {
    const leaf1 = "a".repeat(64);
    const leaf2 = "b".repeat(64);
    const leaf3 = "c".repeat(64);
    const root = computeMerkleRoot([leaf1, leaf2, leaf3]);
    // Level 1: hash(leaf1, leaf2), hash(leaf3, leaf3) -> Level 2: hash of those two
    const node12 = Buffer.concat([Buffer.from([0x01]), Buffer.from(leaf1, "hex"), Buffer.from(leaf2, "hex")]);
    const h12 = createHash("sha256").update(node12).digest("hex");
    const node33 = Buffer.concat([Buffer.from([0x01]), Buffer.from(leaf3, "hex"), Buffer.from(leaf3, "hex")]);
    const h33 = createHash("sha256").update(node33).digest("hex");
    const rootNode = Buffer.concat([Buffer.from([0x01]), Buffer.from(h12, "hex"), Buffer.from(h33, "hex")]);
    const expected = createHash("sha256").update(rootNode).digest("hex");
    expect(root).toBe(expected);
  });

  it("computeMerkleRoot is order-independent (sorted leaves)", () => {
    const leaves = ["c".repeat(64), "a".repeat(64), "b".repeat(64)];
    const root1 = computeMerkleRoot(leaves);
    const root2 = computeMerkleRoot([...leaves].sort());
    expect(root1).toBe(root2);
  });

  it("verifyProofChain detects envelope hash tampering", () => {
    const sealed = sealProofEnvelope(baseDraft, []);
    const proofs = [{ ...sealed, envelope_sha256: "f".repeat(64) }]; // tampered hash
    const tasks = [{ task_urn: sealed.task_urn, code: sealed.code, graph: { depends_on: [] } }];
    const result = verifyProofChain(proofs, tasks);
    expect(result.valid).toBe(false);
    expect(result.failedProofs.length).toBe(1);
    expect(result.failedProofs[0].reason).toBe("ENVELOPE_HASH_MISMATCH");
  });

  it("verifyProofChain detects missing parent proof for depends_on", () => {
    const parentDraft = { ...baseDraft, task_urn: "urn:mw:work:moonwitness/test:W1/T00", code: "T00" };
    const parentSealed = sealProofEnvelope(parentDraft, []);
    const childDraft = { ...baseDraft, graph: { depends_on: ["T00"] } };
    const childSealed = sealProofEnvelope(childDraft, []); // deliberately missing parent hash
    const proofs = [parentSealed, childSealed];
    const tasks = [
      { task_urn: parentSealed.task_urn, code: parentSealed.code, graph: { depends_on: [] } },
      { task_urn: childSealed.task_urn, code: childSealed.code, graph: { depends_on: ["T00"] } },
    ];
    const result = verifyProofChain(proofs, tasks);
    expect(result.valid).toBe(false);
    expect(result.failedProofs.length).toBe(1);
    expect(result.failedProofs[0].reason).toMatch(/MISSING_PARENT_PROOF_FOR_DEPENDENCY:T00/);
  });

  it("verifyProofChain passes for valid chain with correct parent hashes", () => {
    const parentDraft = { ...baseDraft, task_urn: "urn:mw:work:moonwitness/test:W1/T00", code: "T00" };
    const parentSealed = sealProofEnvelope(parentDraft, []);
    const childDraft = { ...baseDraft, graph: { depends_on: ["T00"] } };
    const childSealed = sealProofEnvelope(childDraft, [parentSealed.envelope_sha256]);
    const proofs = [parentSealed, childSealed];
    const tasks = [
      { task_urn: parentSealed.task_urn, code: parentSealed.code, graph: { depends_on: [] } },
      { task_urn: childSealed.task_urn, code: childSealed.code, graph: { depends_on: ["T00"] } },
    ];
    const result = verifyProofChain(proofs, tasks);
    expect(result.valid).toBe(true);
    expect(result.failedProofs).toEqual([]);
  });

  it("verifyProofChain works with taskUrnByProofHash option for external mapping", () => {
    const parentDraft = { ...baseDraft, task_urn: "urn:mw:work:moonwitness/test:W1/T00", code: "T00" };
    const parentSealed = sealProofEnvelope(parentDraft, []);
    const childDraft = { ...baseDraft, graph: { depends_on: ["T00"] } };
    const childSealed = sealProofEnvelope(childDraft, [parentSealed.envelope_sha256]);
    const proofs = [parentSealed, childSealed];
    const tasks = [
      { task_urn: parentSealed.task_urn, code: parentSealed.code, graph: { depends_on: [] } },
      { task_urn: childSealed.task_urn, code: childSealed.code, graph: { depends_on: ["T00"] } },
    ];
    const taskUrnByProofHash = new Map([[parentSealed.envelope_sha256, parentSealed.task_urn]]);
    const result = verifyProofChain(proofs, tasks, { taskUrnByProofHash });
    expect(result.valid).toBe(true);
  });

  it("leaf hashing is canonical JSON + 0x00 domain prefix (RFC 6962 §2.1)", async () => {
    // Parity with packages/ai-runtime/src/merkle-ledger.ts: same canonical
    // JSON serialization + 0x00 leaf prefix yields identical digests.
    const { hashMerkleLeaf: aiHashLeaf } = await import("../../ai-runtime/src/merkle-ledger.js");
    const testData = { key: "value", num: 42 };
    const ourLeaf = hashProofLeaf(testData as unknown as ProofEnvelopeDraft);
    const aiLeaf = aiHashLeaf(testData);
    expect(ourLeaf).toBe(aiLeaf);
  });
});