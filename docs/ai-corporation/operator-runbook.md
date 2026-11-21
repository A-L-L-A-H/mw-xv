# AI Corporation & Desktop Harness Operator Runbook (`DOC.7`, `DOC.11`, `AI10.19`–`AI10.30`)

- **Audience:** Platform operators, company administrators, and on-call engineers
- **Related references:** [AI Corporation Docs Index](README.md) · [Threat Model & R0–R4 Policy](threat-model.md) · [Provider Matrix & Secret Rotation](provider-matrix.md) · [PostgreSQL Backup & Recovery](../guide/how-to/recovery.md) · [Jobs & Outbox Guide](../guide/how-to/jobs-outbox.md)

---

## 1. Observability, Correlation & Alert Thresholds (`AI10.19`–`AI10.25`)

Every execution path emits structured correlation telemetry via `GenAiTelemetryCollector` ([`packages/ai-runtime/src/risk-policy.ts`](../../packages/ai-runtime/src/risk-policy.ts)) and `@moonwitness/logger` (with automatic `AI_LOGGER_REDACT_PATHS` secret scrubbing in [`packages/ai-runtime/src/redaction.ts`](../../packages/ai-runtime/src/redaction.ts)):

- **End-to-End Correlation Chain:** `work_contract_id` -> `agent_run.id` (`correlation_id`, `idempotency_key`) -> `base.job.id` (`fencing_token`) -> provider request -> tool call (`auditRef`) -> `ai.artifact_manifest` (`storage_key`, `sha256`) -> PCW verifier decision.
- **Alert Conditions (`evaluateOperationalAlerts`):**
  1. `STUCK_RUN_DETECTED`: Active run duration or queue wait exceeds `ExecutionPolicy.max_wall_clock_seconds`.
  2. `RETRY_STORM_DETECTED`: Consecutive job/provider retries exceed configured threshold within the sliding window.
  3. `BUDGET_EXHAUSTED`: Run or taskforce token/cost counters reach `max_tokens_per_run`, `max_cost_micros_per_run`, or `Taskforce.budget_micros`.
  4. `PROVIDER_OUTAGE`: Consecutive `outage` / `timeout` errors trip the provider circuit breaker (`ProviderResilienceGuard`).

---

## 2. Emergency Stop Procedures (`DOC.7`, `AI10.6`, `AI10.30`)

`EmergencyStopController` ([`packages/ai-runtime/src/risk-policy.ts`](../../packages/ai-runtime/src/risk-policy.ts)) and `ai.agent.is_emergency_stopped` provide immediate, deterministic halt controls across four scopes:

| Scope          | Target Key              | Effect                                                                                             |
| -------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| **`global`**   | `global:*`              | Halts all new run dispatches and aborts all in-flight tool calls across all companies              |
| **`company`**  | `company:<companyId>`   | Halts all agents, jobs, and MCP tool calls for a single tenant company                             |
| **`agent`**    | `agent:<agentId>`       | Sets `ai.agent.is_emergency_stopped = true`; blocks dispatch and aborts active runs for that agent |
| **`provider`** | `provider:<providerId>` | Disables `ai.provider_profile.enabled = false`; blocks outbound calls to that provider immediately |

### Executing an Emergency Stop

1. **Via Mission Control UI (`/board/ai`):** Use the **Emergency Controls** bar to trigger **Pause Agent**, **Revoke Grant**, **Stop Run**, or **Disable Provider**. UI controls wait for server confirmation before showing active halt status (`AI9.11`, `AI9.24`).
2. **Via Runtime / API:**
   - Activate stop on `EmergencyStopController.activateStop({ scope, targetId, reason, activatedBy })` or patch `ai.agent` (`is_emergency_stopped: true`) / `ai.capability_grant` (`status: 'revoked'`, `revoked_at: <ISO>`).
   - Call `cancelJob(jobId)` in `@moonwitness/jobs` to signal cooperative `AbortSignal` termination to the active worker and its local PTY/worktree child tree.

---

## 3. Incident Playbooks (`AI10.30`)

### 3.1 Stuck or Lease-Expired Run

1. Inspect the run diagnostics (`buildRunInspectionRecord`): check `lastCheckpointCursor`, `lastSuccessfulAction`, `fencing_token`, and `base.job.lease_until`.
2. If the worker crashed mid-run, `@moonwitness/jobs` automatically reclaims the job once `lease_until` expires, increments `fencing_token`, and resumes from `checkpoint_cursor`. Any late commit from the stale worker is rejected by `LeaseLostError`.
3. If the run is wedged on an external tool or local PTY, trigger **Stop Run** (`cancelJob`), which fires `AbortSignal` and terminates the PTY process tree (`taskkill /T /F` on Windows / `-pgid` on POSIX).

### 3.2 Failed or Offline Provider

1. Verify provider health via prompt-free `healthCheck()` (`OllamaAdapter` checks `GET /api/tags`; cloud adapters check metadata endpoints without sending prompt data).
2. Confirm that `DataClassificationRouter` did **not** downgrade data classification: `local_only` and `restricted` runs must remain failed/queued (`CLASSIFICATION_FALLBACK_BLOCKED`) rather than falling back to cloud providers.
3. For local Ollama outages on workstation/server, restart the loopback service (`http://127.0.0.1:11434`) and retry the failed run by authorized operator action.

### 3.3 Compromised Credential or Secret Rotation (`DOC.5`)

1. **Immediate Containment:** Activate `provider` emergency stop (`scope: 'provider'`) and revoke active `ai.capability_grant` records bound to the affected scope.
2. **Rotate Environment Secret:** Update the secret value in the host environment or OS keychain matching `ai.provider_profile.secret_ref` (e.g., `MW_AI_C1_OPENAI_KEY` -> new rotated key, or rotate to a new reference name `MW_AI_C1_OPENAI_KEY_V2` on `ai.provider_profile`). Never store raw keys in ORM fields or commit `.env` files.
3. **Revoke Sessions if Needed:** Run `pnpm revoke:auth-sessions` if an operator or service-principal token was exposed.

### 3.4 Runaway Token / Micro-USD Cost

1. Lower `max_tokens_per_run`, `max_cost_micros_per_run`, `max_steps`, and `max_concurrent_runs` in `ai.execution_policy` and increment `policy_version`.
2. Because `CapabilityGateway` checks `policy_version` at execution time, existing grants bound to the older `policy_version` are immediately denied (`POLICY_VERSION_MISMATCH`) until re-issued under the tighter policy.

---

## 4. Upgrade, Backup, Restore & Cleanup Procedures (`DOC.11`, `AI10.26`–`AI10.29`)

1. **Programmatic Schema & Addon Upgrades:**
   - Run `pnpm db:migrate` (`apps/api/src/commands/db-migrate.ts`), which acquires PostgreSQL advisory lock `77490122` and runs `installApiAddons` transactionally, preserving user-edited seed fields tracked in `_orm_data`.
2. **PostgreSQL Backup & Restore Drill:**
   - Follow [`docs/guide/how-to/recovery.md`](../guide/how-to/recovery.md) (`scripts/backup-postgres.sh` and `scripts/restore-postgres.sh`).
   - Run `pnpm test:restore-drill` (`scripts/verify-application-restore.mjs`) to verify backup/restore integrity across core and addon tables.
   - **Reconciliation After Restore With In-Flight Jobs (`AI10.27`):** After restoring a snapshot taken while `base.job` / `ai.agent_run` rows were `running`, expired `lease_until` timestamps allow the worker to reclaim jobs safely via monotonic `fencing_token` checks, while idempotent `idempotency_key` constraints prevent duplicate side effects.
3. **Artifact & Worktree Retention Cleanup (`AI10.29`):**
   - Run `pnpm attachments:reconcile` (`reconcileAttachmentStorage` / `pruneOrphanAttachmentStorage` in `@moonwitness/orm-storage`, dry-run by default) to audit and prune expired or orphaned artifact blobs referenced by `ai.artifact_manifest`.
   - On `apps/desktop`, call `bridge.worktree.release(runId)` or `bridge.dispose()` to prune `.mw-worktrees/run-<id>` directories and flush synced `PcwSyncEnvelope` records in `~/.moonwitness/local.db`.
