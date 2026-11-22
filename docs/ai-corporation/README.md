# MoonWitness XV — AI Corporation Architecture & Operations Index (`DOC.1`–`DOC.16`)

- **Status:** Active Documentation Suite for Milestone M12 (`M12.01`–`M12.14`) and Desktop Harness (`DSK-0`–`DSK-10`)
- **Architecture Invariant:** **ORM Addon-First** ([ADR 0006](../decisions/0006-mandatory-addon-thin-api.md), [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md), [ADR 0008](../architecture/adr/0008-local-first-desktop-agent-harness.md))
- **Authoritative blueprints & ledgers:**
  - [AI Corporation Grand Plan](../../moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-GRAND-PLAN.md)
  - [AI Corporation Implementation Plan](../../moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-IMPLEMENTATION-PLAN.md)
  - [AI Corporation Research Register](../../moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-RESEARCH-REGISTER.md)
  - [AI Corporation Desktop Harness Blueprint](../../moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-DESKTOP-HARNESS.md)
  - [AI Corporation Granular TODO (`AI0`–`AI11`, `DOC`, `GATE`, `SLICE`)](../../moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md)
  - [Desktop Harness Granular TODO (`DSK-0`–`DSK-10`)](../../todo-desktop.md)
  - [Canonical Roadmap Source Cards (`M12.01`–`M12.14`)](../roadmap/13-ai-corporation.md)
  - [Master Roadmap](../../ROADMAP.md)

---

## 1. Documentation Suite Index

| Document                                                 | Scope & Covered Checklist Items                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`README.md`](README.md)                                 | Canonical architecture index, domain model catalog (`@moonwitness/orm-ai`), K0–K9 knowledge vs workforce memory boundary (`DOC.1`–`DOC.3`, `AI8.1`)                                                                                                             |
| [`provider-matrix.md`](provider-matrix.md)               | Local (`Ollama`, local `DeepSeek`/`vLLM`) vs cloud (`OpenAI`, `Anthropic`) capabilities, data classification (`local_only`, `cloud_eligible`, `restricted`), secret setup (`MW_AI_*`) without credentials (`DOC.4`, `DOC.5`, `DOC.8`, `AI3.28`)                 |
| [`mcp-catalog.md`](mcp-catalog.md)                       | Local & HTTP MCP client configuration without secrets, registered tool catalog, capability permission matrix, and A2A protocol deferral decision (`DOC.6`, `AI5.29`–`AI5.33`, `DSK-0.11`)                                                                       |
| [`threat-model.md`](threat-model.md)                     | STRIDE & agent containment threat model, prompt-injection / tool-output poisoning / traversal defenses, and Risk Tier (`R0–R4`) data-flow diagrams (`DOC.9`, `AI10.1`–`AI10.18`)                                                                                |
| [`operator-runbook.md`](operator-runbook.md)             | Incident response for stuck runs, failed providers, compromised credentials, runaway cost, emergency stop (`EmergencyStopController`), upgrade, backup, and restore procedures (`DOC.7`, `DOC.11`, `AI10.19`–`AI10.30`)                                         |
| [`evaluation-methodology.md`](evaluation-methodology.md) | Deterministic benchmark corpus, 4-arm memory ablation (`no-memory`, `episodic-only`, `skill-only`, `combined`), capability gates `G0`–`G6` (`agiClaimed: false`), and supported deployment / hardware specs (`DOC.10`, `AI10.31`–`AI10.38`, `AI11.1`–`AI11.24`) |

---

## 2. Addon-First Domain Model Catalog (`@moonwitness/orm-ai`, `DOC.3`)

All durable AI Corporation state is declared in [`packages/orm-ai/src/manifest.ts`](../../packages/orm-ai/src/manifest.ts) (`addon: 'ai'`, `version: '1.0.0'`, depending on `base`, `organization`, `jobs`, `workflow`, `orm-storage`). Direct generic CRUD access (`/api/ai.*` and `/jsonrpc`) is blocked via `INTERNAL_PREFIXES` in [`apps/api/src/auth/policy.ts`](../../apps/api/src/auth/policy.ts).

| Model Name                | Table                      | Primary Purpose & Key Invariants                                                                                                                                                                                                                   |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai.provider_profile`     | `ai_provider_profiles`     | Provider transport configuration (`mock`, `ollama`, `openai`, `anthropic`), `secret_ref` (`^MW_AI_(?:C[1-9][0-9]*_)?[A-Z0-9_]{1,100}$` — never raw keys), `data_classification`, timeouts, and rate limits                                         |
| `ai.model_profile`        | `ai_model_profiles`        | Model capabilities (`supports_tools`, `supports_streaming`, `supports_structured_output`), context window, modalities, and micro-USD token costs                                                                                                   |
| `ai.execution_policy`     | `ai_execution_policies`    | Versioned constitutional limits (`default_risk_tier`, `max_risk_tier` `R0`–`R4`, `allowed_classification`, `allow_cloud_fallback`, `max_steps`, `max_wall_clock_seconds`, `max_tokens_per_run`, `max_cost_micros_per_run`, `max_delegation_depth`) |
| `ai.agent`                | `ai_agents`                | Single-company agent identity (`draft`, `active`, `paused`, `disabled`, `retired`), acyclic `reports_to_agent`, optional 1:1 `service_user` (`role: 'user'` only, never `superadmin`/`system`), `is_emergency_stopped`                             |
| `ai.agent_profile`        | `ai_agent_profiles`        | Mutable display metadata (`name` / `display_name`), sensitive `system_instructions`, default model/policy references, and default capability identifiers                                                                                           |
| `ai.work_contract`        | `ai_work_contracts`        | Typed Proof-Carrying Work contract (`objective`, `scope_json`, `constraints_json`, `risk_tier`, `data_classification`, `assigned_agent`, distinct `reviewer_agent`, `workflow_instance`, optional `source_model`/`source_id`)                      |
| `ai.acceptance_criterion` | `ai_acceptance_criteria`   | Individually verifiable criteria per contract (`verification_method`: `automated_test`, `schema_check`, `source_inspection`, `independent_reviewer`, `human_decision`; locked once work begins)                                                    |
| `ai.capability_grant`     | `ai_capability_grants`     | Time-bounded authority token (`<domain>.<action>@v<major>`, `policy_version`, `max_calls_per_run`, `expires_at`, `revoked_at`, `audit_ref`) checked at dispatch and re-checked at tool execution time                                              |
| `ai.agent_run`            | `ai_agent_runs`            | Durable run record correlated 1:1 with `@moonwitness/jobs` (`base.job`), tracking `idempotency_key`, `correlation_id`, `fencing_token`, safe `checkpoint_cursor`, token usage (`estimated` vs `provider_reported`), and micro-USD cost             |
| `ai.artifact_manifest`    | `ai_artifact_manifests`    | Immutable evidence reference (`storage_key` UUID in `@moonwitness/orm-storage`, 64-hex `sha256`, `artifact_kind`, `verification_status`, `source_sha`, `retention_until`)                                                                          |
| `ai.obligation`           | `ai_obligations`           | Continuing verification obligation surviving task closure (`trigger_kind`: `code_change`, `source_change`, `policy_change`, `time_expiry`, `manual`; `impact_links_json`, `status`)                                                                |
| `ai.taskforce`            | `ai_taskforces`            | Temporary bounded multi-agent team (`lead_agent`, `work_contract`, `max_agents`, `budget_micros`, `spent_micros`, `expires_at`)                                                                                                                    |
| `ai.workforce_assignment` | `ai_workforce_assignments` | Individual agent assignment inside a taskforce (`role_template`, `workspace_scope`, `write_mode`: `read_only`, `isolated_worktree`, `locked_artifact`)                                                                                             |
| `ai.skill_version`        | `ai_skill_versions`        | Versioned procedural SOP (`candidate`, `approved`, `rejected`, `revoked`), `eval_score_bps`, `approval_workflow`, instant revocation                                                                                                               |
| `ai.memory_candidate`     | `ai_memory_candidates`     | Scoped episodic/semantic/procedural lesson candidate (`confidence_bps`, `source_run`, `evidence_artifact`, `approval_workflow`, `retention_until`, `expires_at`)                                                                                   |

---

## 3. Knowledge AI (`K0–K9`) vs. Workforce Memory Boundary (`AI8.1`)

Per [ADR 0004](../decisions/0004-knowledge-rebuild-centralization.md), [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) (D4, D10), and [Knowledge Domain Ownership](../architecture/knowledge-domain-ownership.md):

1. **Authoritative Knowledge (`@moonwitness/orm-knowledge`, `@moonwitness/corpus`, `@moonwitness/research`):**
   - Owns source-backed textual witnesses, assertions, provenance graphs, privacy revocations, and reviewed publications under `K0–K9`.
   - Consumed by workforce agents **strictly read-only** through approved projection interfaces (`mw_knowledge_approved_read` / `readApprovedPublication` / `readActiveResearchGraphRelease`).
2. **Loopback K7 Suggestion Runtime (`@moonwitness/local-ai`):**
   - Remains strictly loopback-only (`AI_MODE=disabled` default) and tool-free for K0–K9 research suggestions.
3. **Workforce Experience & Memory (`ai.memory_candidate`, `ai.skill_version` in `@moonwitness/orm-ai`):**
   - Agent run summaries (`episodic`), domain notes (`semantic`), and reusable SOPs (`procedural`) are stored separately in `@moonwitness/orm-ai` as **untrusted candidates** (`status: 'candidate'`).
   - Retrieved memories are always injected with `untrustedContext: true` and `authorityGranted: false` ([`packages/ai-runtime/src/memory-evaluator.ts`](../../packages/ai-runtime/src/memory-evaluator.ts)); they can never grant capabilities, override `ExecutionPolicy`, or mutate K0–K9 knowledge records.
