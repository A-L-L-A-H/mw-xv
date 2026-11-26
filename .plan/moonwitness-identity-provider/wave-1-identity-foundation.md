# Wave 1 — Identity Foundation



**Tasks:** I07–I21. Build the independent persistence and service foundation. Do not implement login routes or OIDC flows in this wave.



## Execution rule

Execute one task at a time in listed dependency order. Inspect only the task-owned paths and direct dependencies. Do not mark a task done without its Verify command and all Acceptance Criteria passing.



#### - [x] I07 — Scaffold packages/orm-identity

- **Owner File(s):** packages/orm-identity/package.json; packages/orm-identity/tsconfig.json
- **Depends On:** I06
- **Effort:** XS
- **Exact Spec:**
  - Check whether the directory or package already exists before creating files; reuse any valid work found.
  - Create a minimal workspace package named @moonwitness/orm-identity with repository-compatible package exports, Node 24 engine, build and test scripts, and strict TypeScript settings.
  - Declare only dependencies actually needed for Objection/Knex ORM model definitions, matching the versions and patterns used by orm-base.
  - Keep this package data-model-only. It must not open a database connection or import apps/api.
- **DO NOT:** Do not scaffold an API, install a second ORM, or add identity models to the business addon registry.
- **Acceptance Criteria:**
  - [x] Workspace package resolves under the existing apps/* and packages/* globs.
  - [x] Manifest uses repository package conventions and Node 24.
  - [x] Package has no apps/api or UI dependency.
- **Verify:** bun install --lockfile-only; bun --filter @moonwitness/orm-identity build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: bun install --lockfile-only — passed (1060 packages resolved, lockfile saved)
  - Command: bun --filter @moonwitness/orm-identity build — passed (tsc exited 0)
  - Manual verification: package name, engines.node=24.x, type=module, exports, build/test scripts mirror orm-base conventions; dependencies limited to orm/types/objection + dev tooling; no apps/api or UI dependency; data-model-only
  - Commit: 84863466 feat(identity): scaffold orm-identity package for I07

#### - [x] I08 — Add ORM package exports, tests and build checks

- **Owner File(s):** packages/orm-identity/src/index.ts; packages/orm-identity/tsconfig.check.json; packages/orm-identity/vitest.config.ts; packages/orm-identity/tests/smoke.test.ts
- **Depends On:** I07
- **Effort:** XS
- **Exact Spec:**
  - Add a stable public barrel export and strict test/build configuration using the same tooling pattern as nearby ORM packages.
  - Add one smoke test proving package imports resolve and the model registry can be imported without opening a database.
  - Add no models beyond a minimal test fixture; model work is owned by later tasks.
  - Ensure test command exits successfully in the monorepo.
- **DO NOT:** Do not export private implementation files or connect the package to business addon registration.
- **Acceptance Criteria:**
  - [x] Build and test scripts exist and pass.
  - [x] Public entry point can be imported in Node 24.
  - [x] No database connection occurs during module import.
- **Verify:** bun --filter @moonwitness/orm-identity build; bun --filter @moonwitness/orm-identity test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: bun --filter @moonwitness/orm-identity build — passed (tsc exited 0)
  - Command: bun --filter @moonwitness/orm-identity test — passed (1 file, 5 tests, 175ms; includes a mocked-knex assertion that no DB connection occurs during module import)
  - Manual verification: public barrel exports IDENTITY_PACKAGE_NAME, IdentityModelEntry, IDENTITY_MODELS (frozen, empty), findIdentityModel; no private implementation files exported; no business addon registration; vitest.config.ts mirrors orm-* package tooling pattern
  - Commit: d5e4b67c feat(identity): add orm-identity public exports tests and build checks for I08

#### - [x] I09 — Scaffold apps/id service entry point

- **Owner File(s):** apps/id/package.json; apps/id/tsconfig.json; apps/id/src/server.ts; apps/id/src/index.ts
- **Depends On:** I03, I04
- **Effort:** XS
- **Exact Spec:**
  - Check the current tree first and reuse any apps/id files already present.
  - Create a minimal Node 24 service package named @moonwitness/id with build, dev, start and test scripts matching the existing Fastify app conventions.
  - Create a server factory and executable entry point that can start and close cleanly. Keep dependency injection for config, database and logger.
  - Use Fastify conventions already present in apps/api; avoid copying all API plugins.
  - Do not add OIDC protocol routes in this scaffold.
- **DO NOT:** Do not duplicate apps/api business routes or introduce a frontend framework into the identity server.
- **Acceptance Criteria:**
  - [x] apps/id can be built independently.
  - [x] Server factory supports controlled startup/shutdown for tests.
  - [x] The package imports no business addon registry.
- **Verify:** bun --filter @moonwitness/id build; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
  - **Evidence:**
    - Command: bun install --lockfile-only — passed (1061 packages resolved; workspace package registered)
    - Command: bun --filter @moonwitness/id build — passed (tsc exited 0)
    - Command: bun --filter @moonwitness/id test — passed (1 file, 3 tests)
    - Manual verification: Node 24 Fastify service with build/dev/start/test scripts; injectable logger, config and database; no business routes/addon imports; smoke tests cover startup/shutdown
    - Commit: 589c4c59 feat(id): scaffold apps/id service entry point for I09

#### - [x] I10 — Add strict Identity environment and configuration validation

- **Owner File(s):** apps/id/src/config/env.ts; apps/id/src/config/env.test.ts
- **Depends On:** I09
- **Effort:** S
- **Exact Spec:**
  - Define and validate IDENTITY_DATABASE_URL, IDENTITY_ISSUER_URL, IDENTITY_PORT, NODE_ENV, key-provider mode and any selected provider-specific settings.
  - Reject missing or malformed production configuration at startup. Never fall back from IDENTITY_DATABASE_URL to the Business DATABASE_URL.
  - Permit explicitly marked local-development defaults only where they cannot be mistaken for production values.
  - Redact credentials in all configuration validation errors.
- **DO NOT:** Do not add real secret values, silently fall back to shared DB credentials, or log full connection URLs.
- **Acceptance Criteria:**
  - [x] Valid configuration parses to a typed immutable object.
  - [x] Missing production database URL and invalid issuer URL fail closed.
  - [x] Error output never includes DB credentials or secret values.
- **Verify:** bun --filter @moonwitness/id test; bun --filter @moonwitness/id build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
  - **Evidence:**
    - Command: bun --filter @moonwitness/id test — passed (2 files, 10 tests)
    - Command: bun --filter @moonwitness/id build — passed (tsc exited 0)
    - Manual verification: immutable typed config; explicit key-provider mode; no DATABASE_URL fallback; production requires HTTPS non-local issuer and external keys; all errors redact credentials/query values
    - Commit: 3240f374 feat(id): add strict identity environment validation for I10

#### - [ ] I11 — Add a dedicated Identity PostgreSQL connection

- **Owner File(s):** apps/id/src/database/identity-database.ts; apps/id/src/database/identity-database.test.ts
- **Depends On:** I08, I10
- **Effort:** S
- **Exact Spec:**
  - Create a connection factory that reads only IDENTITY_DATABASE_URL and uses the repository's supported Knex/PostgreSQL driver.
  - Expose injectable pool settings and a close/dispose method for tests and graceful shutdown.
  - Keep credentials and pool state private to apps/id; do not export the Knex instance through packages/identity-sdk or the business ORM.
  - Add a test proving that absent IDENTITY_DATABASE_URL causes a clear failure and never falls back to DATABASE_URL.
- **DO NOT:** Do not share the API Knex instance or connect to the same database name by implicit default.
- **Acceptance Criteria:**
  - [ ] Identity connection uses a distinct configured database URL.
  - [ ] Connection lifecycle is testable and cleanly closed.
  - [ ] No fallback to business DB is possible.
- **Verify:** bun --filter @moonwitness/id test; bun --filter @moonwitness/id build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I12 — Add liveness and readiness endpoints

- **Owner File(s):** apps/id/src/routes/health.routes.ts; apps/id/src/routes/health.routes.test.ts; apps/id/src/server.ts
- **Depends On:** I09, I10, I11
- **Effort:** XS
- **Exact Spec:**
  - Add a liveness endpoint that reports the process is alive without requiring a database query.
  - Add a readiness endpoint that checks Identity DB connectivity and migration readiness without leaking topology or secrets.
  - Register the routes in the server factory and ensure startup dependency errors produce non-ready status.
  - Use stable response shapes and suitable HTTP status codes consistent with repository health checks.
- **DO NOT:** Do not expose environment variables, database URLs, stack traces or internal key metadata in public health responses.
- **Acceptance Criteria:**
  - [ ] Liveness succeeds without database availability.
  - [ ] Readiness fails when DB is unavailable or migrations are pending.
  - [ ] Health responses contain no sensitive fields.
- **Verify:** bun --filter @moonwitness/id test; bun --filter @moonwitness/id build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I13 — Add deterministic Identity migration runner

- **Owner File(s):** apps/id/src/database/migrations/**; apps/id/src/database/migrate.ts; apps/id/src/database/migrate.test.ts
- **Depends On:** I11
- **Effort:** S
- **Exact Spec:**
  - Implement the smallest migration runner compatible with the repository's Knex version or an established project migration utility.
  - Use an Identity-specific migration table and schema namespace. Do not run Business DB migration files.
  - Support apply, status and rollback only when rollback is safely defined; migrations must be ordered and repeatable.
  - Make startup readiness depend on successful migration status.
- **DO NOT:** Do not run destructive schema resets or import Business ORM addon seeds.
- **Acceptance Criteria:**
  - [ ] Fresh Identity DB migrates to latest schema.
  - [ ] Running migrations twice is a no-op.
  - [ ] Migration history is stored only in Identity DB.
- **Verify:** bun --filter @moonwitness/id test; use an isolated PostgreSQL integration test when the test harness supports it.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I14 — Add identity.account model and migration

- **Owner File(s):** packages/orm-identity/src/models/account.ts; packages/orm-identity/src/models/account.test.ts; apps/id/src/database/migrations/*account*
- **Depends On:** I13
- **Effort:** S
- **Exact Spec:**
  - Define a stable opaque account subject and basic account lifecycle fields: id, status, created_at, updated_at and disabled_at where appropriate.
  - Use a database-generated or cryptographically random opaque identifier; never depend on sequential integers as public OIDC sub values.
  - Add indexes for account lookup and lifecycle status.
  - Keep display/profile attributes minimal; contact and CRM attributes remain in base.partner.
- **DO NOT:** Do not add password, company permission or CRM address fields to account.
- **Acceptance Criteria:**
  - [ ] Migration creates account storage and expected indexes.
  - [ ] Model create/read/update lifecycle tests pass.
  - [ ] Public subject is opaque and immutable.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I15 — Add identity.identifier model and uniqueness constraints

- **Owner File(s):** packages/orm-identity/src/models/identifier.ts; packages/orm-identity/src/models/identifier.test.ts; apps/id/src/database/migrations/*identifier*
- **Depends On:** I14
- **Effort:** S
- **Exact Spec:**
  - Represent login identifiers separately from the account, supporting verified email and username only when enabled by policy.
  - Normalize identifiers consistently before uniqueness checks; preserve original display form separately when needed.
  - Add unique constraints on normalized identifier type/value according to the chosen login policy.
  - Represent verification state and primary identifier status without exposing enumeration details through public endpoints.
- **DO NOT:** Do not use business Partner.email as the source of truth or auto-link records by email.
- **Acceptance Criteria:**
  - [ ] Duplicate normalized identifiers are rejected by DB constraints.
  - [ ] Normalization behavior has tests for case and whitespace.
  - [ ] Identifier records reference exactly one identity.account.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I16 — Add identity.credential and password-hash adapter

- **Owner File(s):** packages/orm-identity/src/models/credential.ts; apps/id/src/security/password-hasher.ts; apps/id/src/security/password-hasher.test.ts; apps/id/src/database/migrations/*credential*
- **Depends On:** I14
- **Effort:** S
- **Exact Spec:**
  - Store credential verifier/hash metadata separately from account and identifier rows.
  - Inspect and reuse a maintained password-hashing implementation already present in the repository if it meets current requirements; otherwise evaluate a maintained library and record the decision.
  - Support password verification and hash upgrade through a narrow adapter; keep algorithm parameters versioned and configurable.
  - Ensure credential lookup does not reveal whether an account exists.
- **DO NOT:** Do not implement a password hash algorithm manually or store plaintext/password-reversible values.
- **Acceptance Criteria:**
  - [ ] Credential records reference an account and have algorithm/version metadata.
  - [ ] Hasher tests cover correct password, wrong password and malformed stored hash.
  - [ ] Logs and thrown errors never contain supplied passwords or hashes.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I17 — Add identity.session model and expiry indexes

- **Owner File(s):** packages/orm-identity/src/models/session.ts; packages/orm-identity/src/models/session.test.ts; apps/id/src/database/migrations/*session*
- **Depends On:** I14
- **Effort:** S
- **Exact Spec:**
  - Persist session ID, account subject, client ID, created/last-seen/expiry timestamps, revocation timestamp and safe metadata.
  - Index active sessions by account and expiration; store only a digest for opaque session secrets if the selected session design requires one.
  - Support revoking one session and all sessions for an account.
  - Keep device/user-agent metadata bounded and redactable.
- **DO NOT:** Do not persist a raw bearer token or unbounded request headers.
- **Acceptance Criteria:**
  - [ ] Session expiry and revocation are enforced by repository operations.
  - [ ] Indexes support account lookup and expiry pruning.
  - [ ] Tests cover expired, revoked and active sessions.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I18 — Add refresh-token family persistence and revocation state

- **Owner File(s):** packages/orm-identity/src/models/refresh-token-family.ts; packages/orm-identity/src/models/refresh-token-family.test.ts; apps/id/src/database/migrations/*refresh*
- **Depends On:** I17
- **Effort:** S
- **Exact Spec:**
  - Persist only a one-way verifier/digest for refresh credentials, with token family, parent/rotation relationship, expiry, consumed timestamp and revocation state.
  - Provide atomic consume-and-rotate semantics that reject concurrent reuse and identify replay of an already-consumed token.
  - Support revoking the affected token family and its associated session.
  - Keep token material out of ORM debug output and logs.
- **DO NOT:** Do not store raw refresh tokens or rely on a non-atomic read-then-write rotation sequence.
- **Acceptance Criteria:**
  - [ ] A token can be consumed once and rotated atomically.
  - [ ] Replay revokes the corresponding family/session.
  - [ ] Tests cover expiry, revocation, replay and concurrent consume.
- **Verify:** bun --filter @moonwitness/orm-identity test; PostgreSQL transaction tests when available.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I19 — Add OAuth client registry model

- **Owner File(s):** packages/orm-identity/src/models/oauth-client.ts; packages/orm-identity/src/models/oauth-client.test.ts; apps/id/src/database/migrations/*oauth-client*
- **Depends On:** I14
- **Effort:** S
- **Exact Spec:**
  - Persist client ID, client type, allowed grant types, exact redirect URI allowlist, allowed scopes, status and confidential-client secret verifier metadata where needed.
  - Represent Board and Desktop as public clients that cannot hold a client secret.
  - Support disabled clients and strict per-client grant/scope restrictions.
  - Do not store a raw client secret; machine client secret creation is handled in a later task.
- **DO NOT:** Do not allow wildcard redirect URIs or turn a public client into a confidential client by configuration.
- **Acceptance Criteria:**
  - [ ] Public and confidential client rules are explicit and tested.
  - [ ] Redirect URI and scope allowlists are persisted deterministically.
  - [ ] Disabled clients cannot authorize.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I20 — Add authorization-code persistence adapter only where provider integration requires it

- **Owner File(s):** apps/id/src/oidc/authorization-code-store.ts; apps/id/src/oidc/authorization-code-store.test.ts; apps/id/src/database/migrations/*authorization-code*
- **Depends On:** I14, I19, I03
- **Effort:** S
- **Exact Spec:**
  - Inspect the selected OIDC Provider implementation first. Prefer its supported adapter/storage contract over a parallel custom authorization-code state machine.
  - If the provider requires application persistence, implement only the adapter interface it documents and persist hashed/opaque code handles with expiry and single-use consumption.
  - If the provider already owns this persistence securely, do not create duplicate tables; write an adapter conformance test proving provider storage is correctly configured and document the no-table decision in the task evidence.
  - Ensure code records are bound to client and expiry through the provider contract.
- **DO NOT:** Do not duplicate protocol state or invent a homegrown authorization code format.
- **Acceptance Criteria:**
  - [ ] Exactly one authoritative authorization-code implementation exists.
  - [ ] Provider adapter conformance tests prove single-use and expiry behavior.
  - [ ] Any omitted table has a documented reason.
- **Verify:** bun --filter @moonwitness/id test; selected provider integration smoke test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.

#### - [ ] I21 — Add Identity audit-event and transactional-outbox models

- **Owner File(s):** packages/orm-identity/src/models/audit-event.ts; packages/orm-identity/src/models/outbox-event.ts; packages/orm-identity/src/models/audit-event.test.ts; apps/id/src/database/migrations/*audit*; apps/id/src/database/migrations/*outbox*
- **Depends On:** I14, I17, I18
- **Effort:** S
- **Exact Spec:**
  - Create append-oriented audit event storage with actor, action, subject, timestamp, correlation ID and redacted structured metadata.
  - Create a transactional outbox table with event ID, type, schema version, payload, creation time, attempt count, next-attempt time and delivered timestamp.
  - Add indexes for pending-event polling and audit subject/time queries.
  - Keep event payloads minimal and avoid copying credentials or private authentication data.
- **DO NOT:** Do not publish external messages inside the account transaction without the outbox record; do not store secrets in event payloads.
- **Acceptance Criteria:**
  - [ ] Audit events are append-oriented and redact-sensitive fields.
  - [ ] Outbox rows can be claimed and retried without losing delivery state.
  - [ ] Both tables have dedicated migrations and tests.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append the exact command, result and commit SHA to this task section.



## Wave exit gate

Fresh Identity database can migrate; apps/id and packages/orm-identity build and test independently; no Identity model is registered in the Business addon registry; no ID code connects to the Business database.
