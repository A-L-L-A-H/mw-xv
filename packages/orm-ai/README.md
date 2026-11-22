# `@moonwitness/orm-ai`

Addon-First domain models, constraints, views, menus, workflows, and fail-closed `ModelAccess` seeds for MoonWitness XV AI Corporation (`M12.03` / [ADR 0007](../../docs/decisions/0007-ai-corporation-addon-first-architecture.md)).

## Addon Declaration

- **Addon name:** `ai` (`version: '1.0.0'`)
- **Dependencies:** `base`, `organization`, `jobs`, `workflow`, `orm-storage`
- **API isolation:** Registered in `API_ADDONS` (`apps/api/src/addons/registry.ts`) with `'ai.'` blocked in `INTERNAL_PREFIXES` (`apps/api/src/auth/policy.ts`) so generic `/api/:model` and `/jsonrpc` routes never bypass capability grants, tenant scoping, or Proof-Carrying Work workflows.

## Domain Models (15)

| Model                     | Table                      | Role                                                                                            |
| ------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `ai.provider_profile`     | `ai_provider_profiles`     | Transport profiles (`mock`, `ollama`, `openai`, `anthropic`) with `secret_ref` (`MW_AI_*` only) |
| `ai.model_profile`        | `ai_model_profiles`        | Model capabilities, context window, and micro-USD pricing                                       |
| `ai.execution_policy`     | `ai_execution_policies`    | Versioned risk-tier (`R0`–`R4`), classification, and resource bounds                            |
| `ai.agent`                | `ai_agents`                | Company-scoped agent identity, acyclic `reports_to_agent`, emergency stop                       |
| `ai.agent_profile`        | `ai_agent_profiles`        | Agent instructions, default model/policy, and default capabilities                              |
| `ai.work_contract`        | `ai_work_contracts`        | Typed Proof-Carrying Work contract with assigned and distinct reviewer agents                   |
| `ai.acceptance_criterion` | `ai_acceptance_criteria`   | Verifiable acceptance criteria locked once execution starts                                     |
| `ai.capability_grant`     | `ai_capability_grants`     | Time-bounded capability grant re-checked at execution time                                      |
| `ai.agent_run`            | `ai_agent_runs`            | Durable run correlated 1:1 with `@moonwitness/jobs` (`base.job`)                                |
| `ai.artifact_manifest`    | `ai_artifact_manifests`    | SHA-256 content-addressed evidence reference in `@moonwitness/orm-storage`                      |
| `ai.obligation`           | `ai_obligations`           | Continuing verification obligation surviving task closure                                       |
| `ai.taskforce`            | `ai_taskforces`            | Temporary bounded multi-agent team with micro-USD budget and expiry                             |
| `ai.workforce_assignment` | `ai_workforce_assignments` | Individual agent role assignment and workspace write mode inside a taskforce                    |
| `ai.skill_version`        | `ai_skill_versions`        | Versioned procedural SOP candidate with workflow-gated promotion/revocation                     |
| `ai.memory_candidate`     | `ai_memory_candidates`     | Scoped episodic/semantic memory candidate separated from K0–K9 knowledge                        |

## Verification & Reference

- Run package tests: `pnpm --filter @moonwitness/orm-ai test`
- Run workspace addon conformance: `pnpm test:addon-conformance`
- Architecture, security, and operator guide: [`docs/ai-corporation/README.md`](../../docs/ai-corporation/README.md)
