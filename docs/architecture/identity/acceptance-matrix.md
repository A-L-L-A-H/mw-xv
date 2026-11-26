# Identity Acceptance Matrix and Architecture Exit Gate (I06)

- **Plan:** .plan/moonwitness-identity-provider.md
- **Task:** I06 — Create the acceptance matrix and architecture exit gate
- **Depends On:** I03, I04, I05 (all complete)
- **Branch:** dev
- **Status:** All scenarios are **planned**, not passed. No test evidence exists yet. Status changes only after real test evidence is recorded.

## 1. Wave 0 exit gate status

| Requirement | Status | Evidence |
|---|---|---|
| I01 legacy authentication surface inventory | ✅ Done | `docs/architecture/identity/legacy-auth-inventory.md`; commit `977e9a5c` |
| I02 Identity vs Business ownership frozen (ADR-001) | ✅ Done | `.plan/moonwitness-identity-provider/ADR-001-identity-provider.md`; commit `540d2859` |
| I03 maintained OIDC provider evaluated & selected | ✅ Done | `docs/architecture/identity/oidc-provider-evaluation.md`; commit `d5b891b8` |
| I04 issuer/subject/audience/token/client contract | ✅ Done | `docs/architecture/identity/oidc-contract.md`; commit `6d074d96` |
| I05 threat model & Platform/Tenant authorization boundary | ✅ Done | `docs/architecture/identity/security-model.md`; commit `39ac8796` |
| I06 acceptance matrix & architecture exit gate | ✅ Done | This file |

**OIDC provider choice:** embedded `oidc-provider` (panva/node-oidc-provider) v8.x, MIT, Node 24 runtime, mounted via `@fastify/middie` or dedicated listener — recorded with smoke-test evidence in `docs/architecture/identity/oidc-provider-evaluation.md`. Node-only constraint is explicit. No unresolved provider/security choice remains. **Wave 1 entry gate is open.**

## 2. Architecture definition of done → named test scenarios

Each architecture invariant maps to at least one named test scenario. All scenarios are planned; none has been run.

### 2.1 MVP / first-usable-cutover tests (mandatory before first production cutover)

| Scenario name | Architecture invariant | Implementation task | Anticipated test suite | Status |
|---|---|---|---|---|
| `clean-install` | Dedicated Identity DB + schema migrations from empty state | I07, I11, I13, I14 | `packages/orm-identity` integration test + `apps/id` startup smoke | Planned |
| `one-time-bootstrap` | High-entropy setup secret; single-use, atomic, disabled after use | I10, I11, I20 | `apps/id` integration test | Planned |
| `login-success` | Identity authentication produces session + tokens | I21, I22 | `apps/id` integration test | Planned |
| `login-failure-generic` | No account enumeration (identical response for existing/unknown login) | I21 | `apps/id` integration test | Planned |
| `pkce-auth-code-flow` | Authorization Code + PKCE S256 against embedded provider | I30, I32, I34 | `apps/id` OIDC smoke test | Planned |
| `refresh-rotation` | Refresh rotates on every use; new refresh issued | I18, I22 | `apps/id` integration test | Planned |
| `refresh-replay-revokes-family` | Replay revokes family + session | I18, I22 | `apps/id` integration test | Planned |
| `logout-revokes-session` | Logout invalidates session and all refresh families | I21, I22 | `apps/id` integration test | Planned |
| `api-rejects-id-token` | ID token ≠ access token; API rejects client-audience tokens | I04, I46 | `packages/identity-sdk` unit + `apps/api` integration test | Planned |
| `api-rejects-wrong-audience` | API audience mismatch rejected | I04, I46 | `packages/identity-sdk` unit test | Planned |
| `api-rejects-untrusted-issuer` | `iss` allowlist enforced | I04, I46 | `packages/identity-sdk` unit test | Planned |
| `api-rejects-unknown-kid` | Unknown `kid` rejected; JWKS refresh attempted once | I46 | `packages/identity-sdk` unit test | Planned |
| `api-rejects-jwks-unavailable` | Fail closed when JWKS unreachable | I46 | `packages/identity-sdk` integration test | Planned |
| `disabled-account-rejected` | Disabled Identity account fails principal resolution | I46, I57 | `apps/api` integration test | Planned |
| `unknown-subject-rejected` | Missing `identity_subject` mapping fails closed | I46, I57 | `apps/api` integration test | Planned |
| `missing-membership-rejected` | No CompanyMembership → no business access | I46, I57, I58 | `apps/api` integration test | Planned |
| `cross-tenant-denied` | Tenant A user cannot access tenant B records; `x-company-id` is not proof | I46, I58, I59 | `apps/api` integration test | Planned |
| `provisioning-event-idempotent` | Duplicate lifecycle event → no double provisioning | I23, I24, I48 | `apps/api` integration test | Planned |
| `provisioning-event-unknown-sub-rejected` | Unknown `sub` in event → rejected | I48 | `apps/api` integration test | Planned |
| `machine-client-credentials` | Client Credentials flow issues scoped access token | I19, I36 | `apps/id` OIDC smoke test | Planned |
| `machine-token-scope-enforced` | API enforces scopes; claims alone never grant business authz | I46, I59 | `apps/api` integration test | Planned |
| `secret-redaction-in-logs` | Password/setup secret/token/MFA/connection URL never logged | I10, I21, I22, I46 | logging utility unit + integration test | Planned |
| `key-rotation-jwks` | New `kid` published; old keys retained for grace window | I38, I39 | `apps/id` OIDC smoke test | Planned |
| `key-compromise-response` | Rotating key invalidates sessions and publishes new JWKS | I38, I39 | `apps/id` integration test | Planned |
| `redirect-uri-exact-match` | Unregistered/wildcard redirect URI rejected | I19, I32 | `apps/id` OIDC smoke test | Planned |
| `setup-secret-replay-rejected` | Second setup-claim attempt fails after first success | I20 | `apps/id` integration test | Planned |

### 2.2 Post-MVP tests (explicitly deferred)

| Scenario name | Architecture invariant | Implementation task | Anticipated test suite | Status |
|---|---|---|---|---|
| `mfa-totp-enrollment` | Optional MFA for privileged accounts | I52 | `apps/id` integration test | Planned |
| `mfa-totp-login-challenge` | MFA challenge on login for enrolled accounts | I52 | `apps/id` integration test | Planned |
| `service-client-registration` | Service Principal OAuth client registration | I19, I36 | `apps/id` integration test | Planned |
| `service-client-scope-restriction` | Service Principal cannot use human-only scopes | I19, I36 | `apps/id` integration test | Planned |
| `passkey-enrollment` | WebAuthn/passkey enrolment | Post-MVP (no task) | `apps/id` integration test | Planned |
| `passkey-login` | WebAuthn/passkey login | Post-MVP (no task) | `apps/id` integration test | Planned |

## 3. Matrix-to-task traceability

| Task | Scenarios covered |
|---|---|
| I07 (orm-identity scaffold) | `clean-install` |
| I10 (Identity env/config validation) | `one-time-bootstrap`, `secret-redaction-in-logs` |
| I11 (Identity PostgreSQL connection) | `clean-install`, `one-time-bootstrap` |
| I13 (deterministic migration runner) | `clean-install` |
| I14 (identity.account model) | `clean-install` |
| I18 (refresh-token family persistence) | `refresh-rotation`, `refresh-replay-revokes-family` |
| I19 (OAuth client registry) | `machine-client-credentials`, `service-client-registration`, `redirect-uri-exact-match` |
| I20 (bootstrap one-time secret) | `one-time-bootstrap`, `setup-secret-replay-rejected` |
| I21 (login endpoint) | `login-success`, `login-failure-generic`, `logout-revokes-session`, `secret-redaction-in-logs` |
| I22 (refresh/logout/session endpoints) | `refresh-rotation`, `refresh-replay-revokes-family`, `logout-revokes-session` |
| I23 (provisioning outbox) | `provisioning-event-idempotent` |
| I24 (API provisioning consumer) | `provisioning-event-idempotent`, `provisioning-event-unknown-sub-rejected` |
| I30 (discovery metadata) | `pkce-auth-code-flow` |
| I32 (client registry provider adapter) | `pkce-auth-code-flow`, `redirect-uri-exact-match` |
| I34 (PKCE token exchange) | `pkce-auth-code-flow` |
| I36 (Client Credentials) | `machine-client-credentials`, `service-client-registration`, `service-client-scope-restriction` |
| I38 (signing-key provider) | `key-rotation-jwks` |
| I39 (key rotation) | `key-rotation-jwks`, `key-compromise-response` |
| I46 (identity-sdk verification) | `api-rejects-id-token`, `api-rejects-wrong-audience`, `api-rejects-untrusted-issuer`, `api-rejects-unknown-kid`, `api-rejects-jwks-unavailable`, `disabled-account-rejected`, `unknown-subject-rejected`, `machine-token-scope-enforced` |
| I48 (provisioning consumer wiring) | `provisioning-event-idempotent`, `provisioning-event-unknown-sub-rejected` |
| I52 (MFA) | `mfa-totp-enrollment`, `mfa-totp-login-challenge` |
| I57 (disabled account/principal mapping) | `disabled-account-rejected`, `unknown-subject-rejected` |
| I58 (business principal resolution) | `missing-membership-rejected` |
| I59 (tenant enforcement) | `cross-tenant-denied`, `machine-token-scope-enforced` |

Every architecture invariant from I01–I05 maps to at least one named test in §2.

## 4. Status rule

All scenarios in §2.1 and §2.2 are **planned**. None has been run. A scenario may only be marked **passed** after real test evidence is recorded in the relevant task's Evidence block, with the test command, result and commit SHA.

No unimplemented scenario is marked as passed. No test output is invented.

## 5. Verification

- `git diff --check` — passed.
- Every architecture invariant from I01–I05 maps to at least one named test (§2, §3).
- MVP and post-MVP scenarios are separated (§2.1 vs §2.2).
- Wave 1 entry gate and OIDC provider choice are explicit (§1).
- All scenarios are marked **planned**, not **passed**.

---

**Evidence:**
- Command: git diff --check - passed
- Manual verification: matrix-to-task traceability reviewed; every scenario maps to ≥1 implementation task and ≥1 anticipated test suite.
- Commit: to be recorded after commit.
