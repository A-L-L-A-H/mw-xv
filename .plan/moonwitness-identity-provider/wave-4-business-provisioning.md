# Wave 4 — Business-User Provisioning



**Tasks:** I41–I49. This wave links Identity accounts to existing Business principals without merging the two databases. Identity never connects directly to the Business database.



## Execution rule

Execute one task per cycle in dependency order. Respect Owner File(s). Identity must never open the Business database; Business provisioning is performed by the API-side consumer.



#### - [x] I41 — Add opaque identity_subject mapping to base.user

- **Owner File(s):** packages/orm-base/src/models/user.ts; packages/orm-base/src/models/user.test.ts; packages/orm-base/src/migrations/*identity-subject*
- **Depends On:** I04, I14
- **Effort:** S
- **Exact Spec:**
  - Add a nullable unique identity_subject field to the existing business user model, represented as an opaque string compatible with OIDC sub values.
  - Keep base.user.id, all existing foreign keys and existing business relation semantics unchanged.
  - Add an index/unique constraint that allows existing null values but rejects duplicate non-null subjects.
  - Expose the field through the model's safe schema/serialization rules only where required by API identity mapping.
  - Do not move account, password or session data into orm-base.
- **DO NOT:** Do not replace the primary key, assume sub is always UUID, or make Partner.email an identity key.
- **Acceptance Criteria:**
  - [x] Migration runs on an empty Business DB and is repeatable.
  - [x] Existing integer primary key and foreign keys are unchanged.
  - [x] Two users cannot share the same non-null identity_subject.
- **Verify:** bun --filter @moonwitness/orm-base test; bun --filter @moonwitness/orm-base build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: `bun --filter @moonwitness/orm-base test` — passed (5 files, 29 tests)
  - Command: `bun --filter @moonwitness/orm-base build` — passed (tsc exited 0)
  - Manual verification: `base.user` now exposes nullable unique `identity_subject` string field; integer primary key and all existing relations unchanged; migration creates column and a unique index that permits multiple NULL subjects but rejects duplicate non-null subjects; repeat invocation of migration is idempotent; tests verify opaque subject assignment and user resolution by subject without email fallback.
  - Commit: b22d0837 (fix: 128dc685)

#### - [x] I42 — Add API repository to resolve verified subject to business user

- **Owner File(s):** apps/api/src/auth/identity-principal-repository.ts; apps/api/src/auth/identity-principal-repository.test.ts
- **Depends On:** I41
- **Effort:** XS
- **Exact Spec:**
  - Add a narrow repository function that accepts a verified opaque subject and resolves one active base.user with the matching identity_subject.
  - Return the minimum principal fields needed by the auth plugin: local integer ID, active flag, partner ID and any existing cache/version fields still required.
  - Handle missing, duplicated (should be prevented by DB) and inactive principals as explicit fail-closed outcomes.
  - Keep token verification outside the repository; repository input must already be a verified subject.
- **DO NOT:** Do not accept unverified JWT payloads or search by email/login as a fallback.
- **Acceptance Criteria:**
  - [x] Active mapped user resolves to the correct local ID.
  - [x] Unknown and inactive subject are rejected.
  - [x] No email-based implicit linking is implemented.
- **Verify:** bun --filter @moonwitness/api test; bun --filter @moonwitness/api build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: `bunx --cwd apps/api vitest run src/auth/identity-principal-repository.test.ts dist/auth/identity-principal-repository.test.js` — passed (2 files, 10 tests)
  - Command: `bunx --cwd apps/api vitest run --exclude tests/postgres.integration.test.ts --exclude tests/postgres.performance.integration.test.ts --exclude tests/whatsapp-attachments-job.postgres.integration.test.ts` — passed (68 passed, 4 skipped, 466 tests)
  - Command: `bun --filter @moonwitness/api build` — passed (tsc exited 0)
  - Manual verification: `resolveIdentityPrincipal` and `findActivePrincipalByVerifiedSubject` resolve active `base.user` strictly by `identity_subject`, fail closed on missing (`not_found`), duplicate (`duplicate_subject`), inactive user/partner (`inactive`), or malformed/raw-JWT input (`invalid_subject`), and never fall back to email or login matching.
  - Commit: 48cdf4e1

#### - [x] I43 — Define a versioned Identity-to-Business event contract

- **Owner File(s):** docs/architecture/identity/provisioning-contract.md; packages/types/src/identity-provisioning.ts; packages/types/src/index.ts; packages/types/tests/identity-provisioning.test.ts
- **Depends On:** I04, I21
- **Effort:** S
- **Exact Spec:**
  - Define versioned events for account.created, account.disabled and account.reactivated with immutable event ID, schema version, subject, timestamp and correlation ID.
  - Include only the minimum information required to provision a Business principal, such as verified display identifier and account state; never include credential or token material.
  - Define event ordering/idempotency, retry and unknown-version behavior.
  - Use existing shared event/type conventions if present; do not create a second event envelope format.
- **DO NOT:** Do not include password hash, refresh token, MFA data, private key, raw setup secret or unrestricted account payload.
- **Acceptance Criteria:**
  - [x] Every event has a stable ID and explicit schema version.
  - [x] Payload schema is tested and rejects unknown/missing required fields.
  - [x] Event contract is documented for producer and consumer.
- **Verify:** bun --filter @moonwitness/types test; bun --filter @moonwitness/types build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: `bun --filter @moonwitness/types test` — passed (37 tests passed, including `tests/identity-provisioning.test.mjs`; package uses `.test.mjs` via `node --test tests/*.test.mjs`)
  - Command: `bun --filter @moonwitness/types build` — passed (`tsc` exited 0)
  - Manual verification: `docs/architecture/identity/provisioning-contract.md` documents envelope (`identity.outbox_event`), deterministic `event_id` (`sha256_hex`), schema versioning (`v1`), ordering (`occurred_at`), idempotency, retry, and fail-closed unknown-version behavior; `packages/types/src/identity-provisioning.ts` exports strict validators rejecting missing required fields, unknown/credential payload fields, and mismatched `event_type`/`payload` pairs.
  - Commit: b714a3e9

#### - [ ] I44 — Publish account lifecycle events through Identity outbox

- **Owner File(s):** apps/id/src/events/outbox-publisher.ts; apps/id/src/events/outbox-publisher.test.ts; apps/id/src/server.ts
- **Depends On:** I21, I43
- **Effort:** S
- **Exact Spec:**
  - Add a bounded publisher that claims pending outbox rows and publishes versioned events through the repository's existing reliable job/message mechanism where compatible.
  - If no suitable transport exists, implement an authenticated internal delivery adapter to the API with bounded retries and persisted delivery state.
  - Use leases/atomic claim so two workers do not publish the same pending row simultaneously; consumers must still be idempotent because delivery is at least once.
  - Add shutdown handling and avoid blocking login requests on downstream Business API availability.
- **DO NOT:** Do not access the Business database or pretend two databases share one transaction.
- **Acceptance Criteria:**
  - [ ] Outbox rows are created in the same transaction as account lifecycle changes.
  - [ ] Publisher retries transient failures and marks delivered only after acknowledgement.
  - [ ] Publisher can restart without losing pending work.
  - [ ] Event payloads are redacted and do not contain credentials.
- **Verify:** bun --filter @moonwitness/id test; integration test with a fake receiver.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I45 — Consume provisioning events idempotently in API

- **Owner File(s):** apps/api/src/services/identity-provisioning-consumer.ts; apps/api/src/services/identity-provisioning-consumer.test.ts; apps/api/src/server.ts
- **Depends On:** I42, I43, I44
- **Effort:** S
- **Exact Spec:**
  - Add an API-side consumer that validates event schema/version before any DB write.
  - Persist processed event IDs in the Business DB or reuse an existing idempotent consumer framework so retries do not duplicate users.
  - On account.created, create or update a business principal with identity_subject; on disabled/reactivated, update only the local principal active state.
  - Use a transaction for the processed-event record and business-user mutation.
  - Reject unknown event versions without applying partial changes; expose retry/dead-letter state through existing job observability.
- **DO NOT:** Do not trust the sender based on network location alone; authenticate the internal producer and validate event signatures or service credentials.
- **Acceptance Criteria:**
  - [ ] Duplicate delivery results in one business principal only.
  - [ ] Malformed/unknown events fail closed and are visible for repair.
  - [ ] Business DB mutation and processed-event receipt are atomic.
  - [ ] Consumer never writes credentials or sessions.
- **Verify:** bun --filter @moonwitness/api test; PostgreSQL idempotency integration test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I46 — Provision or link base.partner as a business contact only

- **Owner File(s):** apps/api/src/services/identity-provisioning-consumer.ts; apps/api/src/services/identity-partner-linker.ts; apps/api/src/services/identity-partner-linker.test.ts
- **Depends On:** I45
- **Effort:** S
- **Exact Spec:**
  - Inspect current Partner model constraints and user creation transaction before implementing the linker.
  - Create a minimal Partner profile required by base.user.partner relation when a new business principal is provisioned.
  - If a trusted explicit partner ID is provided by an approved business workflow, link only after verifying authorization and uniqueness.
  - Do not merge or link existing Partner records by email alone. Keep identity_subject as the sole machine-stable account mapping.
- **DO NOT:** Do not turn Partner into the account table or overwrite an existing contact profile based on matching email.
- **Acceptance Criteria:**
  - [ ] A new business user receives the required Partner relation.
  - [ ] Repeated event delivery does not create duplicate Partners.
  - [ ] No automatic email-based Partner merge occurs.
- **Verify:** bun --filter @moonwitness/api test; bun --filter @moonwitness/orm-base test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I47 — Provision least-privilege company membership and user group

- **Owner File(s):** apps/api/src/services/identity-provisioning-consumer.ts; apps/api/src/services/identity-first-workspace.ts; apps/api/src/services/identity-first-workspace.test.ts
- **Depends On:** I45, I46
- **Effort:** S
- **Exact Spec:**
  - Inspect existing Company, CompanyMembership, AccessGroup and GroupMembership creation paths and required addon seeds.
  - Define an explicit first-workspace provisioning operation after first-owner bootstrap. Reuse the existing company creation service if available; otherwise create the smallest isolated service with tests.
  - Create exactly one initial workspace/company only when the setup flow explicitly requests it; do not guess a company name or create duplicate tenant rows.
  - Assign the new business principal to the selected company using the least-privilege default user group. If the bootstrap flow design needs a tenant administrator, grant only the tenant-scoped admin group for that company.
  - Do not grant base.group_superadmin, role system or any global model/row bypass.
- **DO NOT:** Do not infer tenant membership from x-company-id or create an implicit all-company membership.
- **Acceptance Criteria:**
  - [ ] Membership is explicit and scoped to one selected company.
  - [ ] Default group grants are least-privilege and tenant-admin authority is company-scoped only when requested.
  - [ ] Duplicate provisioning is idempotent.
  - [ ] No legacy global superadmin/system grant is assigned.
- **Verify:** bun --filter @moonwitness/api test; PostgreSQL tenant-isolation integration test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I48 — Synchronize account disable/reactivate state

- **Owner File(s):** apps/api/src/services/identity-provisioning-consumer.ts; apps/api/src/services/identity-account-state.test.ts
- **Depends On:** I45
- **Effort:** XS
- **Exact Spec:**
  - Map Identity account disabled/reactivated lifecycle events to the local base.user active state.
  - Revoke or invalidate API auth cache entries for the affected business user immediately after commit.
  - Ensure disabled account requests fail even when a prior access-token signature remains valid.
  - Make reactivation explicit and preserve existing company memberships without silently granting new ones.
- **DO NOT:** Do not delete business data or memberships when an Identity account is disabled.
- **Acceptance Criteria:**
  - [ ] Disabled user is rejected on next API request after consumer applies event.
  - [ ] Reactivation restores only prior business membership state.
  - [ ] Duplicate events do not change effective state or duplicate records.
- **Verify:** bun --filter @moonwitness/api test; identity provisioning integration tests.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I49 — Add retry/dead-letter visibility and a safe repair command

- **Owner File(s):** apps/api/src/services/identity-provisioning-consumer.ts; apps/api/src/commands/identity-provisioning-repair.ts; apps/api/src/commands/identity-provisioning-repair.test.ts
- **Depends On:** I44, I45, I47, I48
- **Effort:** S
- **Exact Spec:**
  - Expose bounded retry count, last error category, next retry time and dead-letter state through existing operational logging/metrics.
  - Add an operator command that can replay one event by immutable event ID after validation and dry-run preview.
  - Make repair idempotent and require an explicit apply flag; never bulk-replay all events by default.
  - Redact payloads and credentials from command output.
- **DO NOT:** Do not silently discard poison events or provide an unsafe bulk replay that can create duplicate users.
- **Acceptance Criteria:**
  - [ ] Failed events remain visible with actionable reason.
  - [ ] Dry run reports intended changes without writing.
  - [ ] Explicit replay does not duplicate principal/partner/membership.
  - [ ] Output contains no credential or personal-data dump.
- **Verify:** bun --filter @moonwitness/api test; command dry-run and isolated replay test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.



## Wave exit gate

New identity accounts are provisioned into base.user idempotently; Partner remains a contact profile; memberships are explicit; disabled accounts invalidate access; outbox retries are observable and repairable.
