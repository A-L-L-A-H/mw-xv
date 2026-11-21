---
name: frontier-research-scout
description: Scout frontier research from arXiv, GitHub trending, and engineering blogs via search_web, synthesize an Architectural Decision Record (ADR), and codify a deterministic invariant gate script before writing feature code.
---

# Frontier Research Scout Workflow

Execute this deterministic 3-stage pipeline whenever designing a novel subsystem, runtime harness, or evaluation gate in MoonWitness.

## Stage 1: Frontier Evidence Acquisition (`search_web`)

Query primary technical sources before drafting abstractions:

1. **Academic & Preprint Corpus (`arXiv`)**:
   - Query `search_web` with `domain: "arxiv.org"` for verifiable algorithms, formal guarantees, or evaluation protocols (e.g., proof-carrying work, memory ablation, reciprocal rank fusion, capability gates).
2. **Production Reference Implementations (`GitHub` & Engineering Blogs)**:
   - Query `search_web` across GitHub repositories and systems engineering blogs for zero-dependency patterns, failure modes, and concrete data structures.
3. **Signal Filtering**:
   - Discard hype, unconstrained autonomous loops, and unverified benchmarks.
   - Extract only mechanisms that can be expressed as deterministic state machines, SHA-256 content-addressed envelopes, or static AST/schema invariants.

## Stage 2: Architectural Decision Record (ADR) Synthesis

Translate scouted findings into a concise ADR before touching runtime source:

- **Context & Problem Statement**: Identify the exact failure mode or architectural bottleneck in MoonWitness.
- **Evaluated Alternatives**: Compare at least two frontier approaches with explicit trade-offs (latency, determinism, security membrane, dependency weight).
- **Decision & Membrane Alignment**:
  - Domain models and addon manifests live exclusively in `packages/orm-*` (`INV-004`).
  - Browser UI components live in `packages/ui` and `apps/board` (`INV-007`).
  - Local execution sidecar logic lives in `apps/desktop` without duplicating domain models (`INV-009`).
- **Falsifiable Invariants**: List the exact properties that must hold at compile time and runtime.

## Stage 3: Deterministic Invariant Gate First

Before implementing feature code, encode the ADR's invariants into an automated gate script under `scripts/` with a paired `node --test` suite:

1. **Static & Structural Gate**:
   - Write or extend a fast check script (e.g., `scripts/check-*.mjs`, `scripts/preflight-fast.mjs`, `scripts/orm-codegen.mjs`, `scripts/ai-drift-watchdog.mjs`) that exits non-zero on any invariant violation and supports `--json` output.
2. **Unit Test Coverage**:
   - Pair every gate script with a `scripts/<name>.test.mjs` suite using `node:test` and `node:assert/strict`.
3. **Implementation & Verification**:
   - Implement the feature against the gate.
   - Chain verification commands in Windows PowerShell using `; if ($?) { ... }` (`INV-001`).
   - Record any new failure class in `.agents/rules/learned-invariants.md`.
