/**
 * @moonwitness/plan-taskos — Cognitive WorkGraph OS SDK.
 *
 * Pure TypeScript package with zero forbidden imports.
 * Node 24.x (`node:sqlite` WAL + FTS5).
 */

// Core — URN, paths, redaction, types, loader, validator, disjoint-prover, DAG, authority
export * from "./core/urn.js";
export * from "./core/paths.js";
export * from "./core/redaction.js";
export * from "./core/types.js";
export * from "./core/loader.js";
export * from "./core/validator.js";
export * from "./core/disjoint-prover.js";
export * from "./core/dag.js";
export * from "./core/authority.js";

// Brain — storage, schema, reindex, knowledge-graph, hybrid-recall, episodic-memory, merkle-dag
export * from "./brain/storage.js";
export * from "./brain/schema.js";
export * from "./brain/reindex.js";
export * from "./brain/knowledge-graph.js";
export * from "./brain/hybrid-recall.js";
export * from "./brain/episodic-memory.js";
export {
  hashProofLeaf,
  emptyMerkleRoot,
  computeMerkleRoot,
  sealProofEnvelope,
  verifyProofChain,
  type ProofEnvelopeDraft,
  type VerifyOptions,
  type VerifyResult,
} from "./brain/merkle-dag.js";

// Runner — brief-compiler, lease-manager, scope-gate, proof-runner
export * from "./runner/brief-compiler.js";
export * from "./runner/lease-manager.js";
export * from "./runner/scope-gate.js";
export * from "./runner/proof-runner.js";

// Adapters — plan-md, taskos-v2, docs, github, orm-http, swarm, telemetry
export * from "./adapters/plan-md.adapter.js";
export * from "./adapters/taskos-v2.adapter.js";
export * from "./adapters/docs.adapter.js";
export * from "./adapters/github.adapter.js";
export * from "./adapters/orm-http.adapter.js";
export * from "./adapters/swarm.adapter.js";
export * from "./adapters/telemetry.adapter.js";