# ADR Draft — MoonWitness AI Corporation Architecture

**Status:** Proposed / not accepted  
**Date:** 2026-11-21  
**Decision owner:** MoonWitness maintainers  
**Number:** Pending repository ADR inventory; do not assign a final number yet.

## Context

MoonWitness XV is a metadata-driven business platform with ORM Addon-First domain declarations, existing organization/request/workflow/knowledge/integration/storage addons, a durable Jobs Engine, audit/outbox, and a local-AI knowledge suggestion boundary. The public roadmap already has K0–K9 work for knowledge, evidence, provenance, privacy, and local-AI safety.

The product direction under consideration is an autonomous AI organization that can plan, delegate, execute, verify, learn from outcomes, and maintain long-running projects.

## Decision proposals

### D1 — MoonWitness remains the source of truth

All company, work, agent, policy, budget, approval, evidence-reference and obligation state lives in MoonWitness domain models. External orchestration systems are adapters, not authoritative databases.

### D2 — ORM Addon-First remains mandatory

Durable domain models, fields, relations, access, views, menus, seeds and upgrade hooks are declared through addons. No parallel ORM, direct model SQL migration stream or shadow business database is introduced.

### D3 — Reuse existing domain addons before creating new models

Audit `orm-request`, `orm-organization`, `orm-workflow`, `orm-integration`, `orm-knowledge`, `orm-storage` and `@moonwitness/jobs`. New models are justified only by documented missing semantics.

### D4 — Knowledge AI and workforce AI remain separate boundaries

The existing local-AI/K-track remains a restricted source-grounded suggestion system. General workforce execution is a separately reviewed runtime with explicit identity, provider, tool, workspace and permission contracts.

### D5 — One bounded agent precedes the swarm

The first production-oriented proof of concept is a single agent using one approved provider route, a read-only tool set, durable job state, evidence envelope and independent verifier.

### D6 — Acceptance is evidence-based

The worker cannot unilaterally accept its own work. Required acceptance criteria need valid evidence and the configured review/approval policy.

### D7 — Introduce a persistent obligation ledger

Accepted deliverables create active obligations. Later changes trigger impact analysis and selective re-verification. Existing knowledge/provenance mechanisms are reused rather than duplicated.

### D8 — Adaptive workforce is bounded by a fixed constitution

Temporary teams and specialists may be created within allowed capabilities, company scope, budget and expiry. Agent workflows cannot change their own authority, security policy or human approval rules.

### D9 — MCP and A2A remain adapters

MCP exposes authorized tools/resources; A2A handles peer-agent task delegation where needed. Internal ORM/Jobs state remains authoritative.

### D10 — Learning changes are proposals first

Memory, skills, model routing and policy changes are versioned candidates. Promotion requires replay, outcome-based evaluation and rollback. No live self-modification of production safety policy.

### D11 — Existing Jobs Engine is the initial durability layer

Do not add a second queue/workflow database until a benchmark identifies a concrete gap in long-running checkpointed agent execution.

### D12 — Research claims remain evidence-bound

The project may investigate capabilities relevant to AGI, but must not claim AGI or novelty beyond what a prior-art search and reproducible evidence support.

## Consequences

### Positive

- Preserves the current source-of-truth and addon architecture.
- Limits duplicated infrastructure and database drift.
- Makes agent authority inspectable and auditable.
- Gives the project a measurable research contribution around project continuity and evidence.
- Allows model and runtime providers to be replaced without changing business state.

### Costs / trade-offs

- More up-front contract and test design.
- Need to reconcile existing request/workflow models before new AI schema.
- Independent verification and long-horizon regression add latency and compute cost.
- Dynamic organization needs cycle/duplication detection and more observability.
- Full autonomy must be rolled out gradually by risk tier.

## Alternatives considered

1. **Adopt Paperclip as the main application:** rejected as the primary architecture because it would create a second business/task source of truth; it may still be used for comparative experiments.
2. **Build a separate AI platform/database:** rejected because it duplicates organization, request, workflow, knowledge and audit state.
3. **Make the local knowledge-suggestion runtime a general agent executor:** rejected because its intentionally restricted safety boundary and purpose are different.
4. **Start with a large multi-agent swarm:** rejected because multi-agent coordination adds failure modes before a single reliable worker exists.
5. **Adopt an external durable workflow engine immediately:** deferred until current Jobs Engine limits are measured.

## Required evidence before acceptance

- Exact-SHA inventory of current `dev` source.
- Model and service reuse matrix.
- Current K0–K9 overlap map.
- Agent identity and tenant authorization design.
- Threat model and risk tiers.
- Minimal provider/runtime prototype plan.
- Compatibility and operational impact assessment.
