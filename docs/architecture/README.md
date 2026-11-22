# MoonWitness XV — Architecture Index (`docs/architecture/`)

Canonical index of MoonWitness XV system architecture specifications, domain ownership boundaries, generated diagrams, and AI Corporation / Desktop Harness designs.

---

## 1. Core Architecture & Domain Ownership

- **[ADR Register (`docs/decisions/README.md`)](../decisions/README.md):** Index of accepted platform and AI Corporation decisions ([ADR 0001](../decisions/0001-platform-contracts.md)–[ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) and [ADR 0008](adr/0008-local-first-desktop-agent-harness.md)).
- **[Generated Architecture Diagrams (`diagrams/README.md`)](diagrams/README.md):** Deterministic workspace dependency graph, core addon model relation map, auth token rotation flow, jobs/outbox flow, addon installation flow, and release lifecycle (`pnpm architecture:check`).
- **[Knowledge Domain Ownership (`knowledge-domain-ownership.md`)](knowledge-domain-ownership.md):** Canonical K0–K9 ownership matrix and data flow under [ADR 0004](../decisions/0004-knowledge-rebuild-centralization.md) and [ADR 0005](../decisions/0005-mizan-evaluation-policy-boundary.md).

---

## 2. AI Corporation & Local-First Desktop Harness

- **[AI Corporation Baseline Audit & Reuse Matrix (`ai-corporation-baseline-audit.md`)](ai-corporation-baseline-audit.md):** Exact-SHA source audit (`M12.01`), 10-owner reuse matrix, and `NO-GO` verification (`BASE.17`–`BASE.30`, `AI0.1`–`AI0.42`).
- **[ADR 0007: AI Corporation Addon-First Architecture](../decisions/0007-ai-corporation-addon-first-architecture.md)** ([pointer](adr/0007-ai-corporation-addon-first-architecture.md)): Domain-plane (`@moonwitness/orm-ai`) vs. execution-plane (`@moonwitness/ai-runtime`, `@moonwitness/ai-mcp`, `@moonwitness/ai-evaluation`) architecture.
- **[ADR 0008: Local-First Desktop Agent Harness (`adr/0008-local-first-desktop-agent-harness.md`)](adr/0008-local-first-desktop-agent-harness.md):** Architectural decision for `apps/desktop` (`@moonwitness/desktop`, Tauri v2 + Node `22.x` sidecar) derived from `apps/board` with zero overlap.
- **[Desktop Local-First Harness Architecture (`desktop-local-first-harness.md`)](desktop-local-first-harness.md):** Component topology, dual-dialect `@moonwitness/orm` SQLite sidecar (`~/.moonwitness/local.db`) <-> PostgreSQL PCW sync protocol, `window.__MW_DESKTOP__` (`DesktopCapabilityBridge`), `R0–R4` risk gate, and STRIDE threat model.
- **[AI Corporation Operations & Reference Suite (`../ai-corporation/README.md`)](../ai-corporation/README.md):**
  - [Provider Capability Matrix & Secret Rotation](../ai-corporation/provider-matrix.md)
  - [MCP Tool Catalog, Client Config & A2A Decision](../ai-corporation/mcp-catalog.md)
  - [STRIDE & Agent Containment Threat Model](../ai-corporation/threat-model.md)
  - [Operator Runbook, Emergency Stop & Recovery](../ai-corporation/operator-runbook.md)
  - [Evaluation Methodology, Memory Ablation & G0–G6 Gates](../ai-corporation/evaluation-methodology.md)

---

## 3. Blueprints & Implementation Ledgers

- **[AI Corporation Grand Plan](../../moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-GRAND-PLAN.md)**
- **[AI Corporation Desktop Harness Blueprint](../../moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-DESKTOP-HARNESS.md)**
- **[AI Corporation Granular TODO (`todo-ai-corporation.md`)](../../moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md)**
- **[Desktop Harness Granular TODO (`todo-desktop.md`)](../../todo-desktop.md)**
- **[Canonical Roadmap Source Cards (`M12.01`–`M12.14`)](../roadmap/13-ai-corporation.md)**
