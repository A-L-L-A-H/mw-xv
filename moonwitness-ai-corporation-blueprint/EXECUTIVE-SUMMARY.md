# MoonWitness XV — AI Corporation
## Executive Summary

**Decision sought:** approve a research and architecture program, not immediate authorization for unrestricted autonomous execution.

### Vision

Evolve MoonWitness XV into an evidence-grounded, adaptive AI operating system for long-running projects and organizations. Humans set goals and constitutional boundaries. AI agents plan, form task-specific teams, execute bounded work, verify deliverables, maintain continuity, and propose reusable lessons.

### Architectural invariants

1. **ORM Addon-First remains mandatory.** Every durable business/domain record is declared through MoonWitness addons. No shadow ORM, duplicate task database, or external system of record.
2. **Reuse before addition.** Inspect `orm-organization`, `orm-request`, `orm-workflow`, `orm-integration`, `orm-knowledge`, `orm-storage`, and `@moonwitness/jobs` before adding models or engines.
3. **Keep Knowledge AI separate from Workforce AI.** Preserve the existing K0–K9 provenance, privacy, evidence, and restricted local-AI work. General tool-using agents need a separately reviewed execution boundary.
4. **Use existing Jobs Engine first.** Add capabilities only after checkpoint/recovery benchmarks identify a concrete gap.
5. **External frameworks are adapters.** Paperclip, Trinity, OpenHands or other systems may be benchmarked or integrated, but MoonWitness remains the source of truth.

### Candidate research contribution: Proof-Carrying Continuity

Every accepted result carries artifacts and evidence for its acceptance criteria. Acceptance may create ongoing obligations (for example API compatibility, regression tests, source rights, or security constraints). Later changes trigger impact analysis and selective re-verification. Memory and procedures are promoted only when controlled evaluation demonstrates improved future outcomes.

This is a research hypothesis with prior-art overlap, not a claim that nobody has built it before and not a claim of AGI.

### Target architecture

- **Domain plane:** organization, requests, workflow, agent identity, capabilities, policy, budget, evidence references and obligations — all ORM Addon-First.
- **Execution plane:** model calls, isolated workspaces, tools, browser/shell sessions and high-volume traces — ephemeral, scoped and replaceable.
- **Control loop:** orient → interpret → plan → allocate → authorize → execute → observe → verify → reconcile → consolidate.
- **Protocols:** MCP for agent-to-tool; optional A2A for cross-runtime peer delegation. ORM and Jobs remain authoritative.
- **Safety:** least privilege, time-limited capabilities, company scope, independent verification, human approval for consequential actions, auditable recovery.

### Delivery sequence

0. Exact-`dev`-SHA audit and architecture freeze.
1. Minimal agent domain addon and identity/permission contract.
2. One bounded durable agent using one local and one cloud provider route.
3. Proof-Carrying Work and obligation continuity.
4. Multi-agent staffing and delegation.
5. Outcome-measured memory and procedural learning.
6. MCP and optional A2A interoperability.
7. Mission Control visual interface and evaluation lab.
8. Cross-domain generalization research.

### First proof of concept

A single agent inspects one bounded MoonWitness package in read-only mode and produces a source-backed technical report. An independent reviewer validates claims and exact source references. The run is interrupted once to test recovery. No file edits, Git writes, or deployment are permitted.

### Approval questions

- Confirm that MoonWitness remains the sole source of truth.
- Confirm ORM Addon-First as a non-negotiable invariant.
- Confirm no duplicate task, workflow, knowledge or durable job engine.
- Confirm the knowledge/workforce AI boundary.
- Approve Phase 0 audit and a bounded read-only proof of concept.

### Important status

This pack is documentation-only. It has not modified the GitHub repository, pushed a branch, created issues, or opened a pull request. Reconcile with the exact current `dev` SHA and repository ADR/task numbering before submission.
