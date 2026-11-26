# Wave 2 — Bootstrap and Login



**Tasks:** I22–I29. Implement first-owner setup and Identity-hosted login. This wave must not add OIDC protocol endpoints; those belong to Wave 3.



## Execution rule

Execute one micro-task per cycle in dependency order. Inspect only the task-owned paths and direct dependencies. Use the selected OIDC provider contract from Wave 0. Never implement protocol or cryptographic primitives from scratch.



#### - [x] I22 — Add operator CLI for one-time bootstrap-token issuance

- **Owner File(s):** packages/orm-identity/src/models/bootstrap-token.ts; packages/orm-identity/src/models/bootstrap-token.test.ts; apps/id/src/commands/create-bootstrap-token.ts; apps/id/package.json; apps/id/src/database/migrations/*bootstrap*
- **Depends On:** I11, I13, I14, I21
- **Effort:** S
- **Exact Spec:**
  - Add a bootstrap-token record with verifier/digest, created/expiry/consumed timestamps and a unique installation scope. Persist no raw token.
  - Add an operator-only CLI that generates a cryptographically random high-entropy token, stores only its one-way verifier and prints the raw token once to stdout.
  - Support a short configurable expiry and reject creating a second active token unless the previous one is expired or explicitly revoked.
  - Make the command unavailable through public HTTP routes. Document secure handoff from installer/operator to the first owner.
  - Add redaction for command logs and errors.
- **DO NOT:** Do not put the token in a committed .env file, compose default, database plaintext column, telemetry or shell history by default.
- **Acceptance Criteria:**
  - [x] Raw token is displayed once and is not recoverable from DB.
  - [x] Expired, consumed and revoked tokens cannot be claimed.
  - [x] Only an operator command can issue a token.
  - [x] Tests cover duplicate active token and expiry behavior.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: `bun --filter @moonwitness/orm-identity test` — passed (9 files, 38 tests)
  - Command: `bun --filter @moonwitness/id test` — passed (8 files, 36 tests)
  - Command: `bun --filter @moonwitness/id build` — passed (tsc exited 0)
  - Manual verification: digest-only bootstrap token model, partial unique index for one active token per installation scope, atomic consume restricted to unconsumed/unrevoked/unexpired rows, operator-only `bootstrap:token` script with one-time stdout raw token and redacted errors; no public HTTP route was added.
  - Commit: a5abf8cc feat(identity): add bootstrap token operator CLI for I22; ccc9f913 fix(identity): preserve bootstrap error cause for I22

#### - [x] I23 — Add bootstrap-state service and setup-status endpoint

- **Owner File(s):** apps/id/src/bootstrap/bootstrap-state.ts; apps/id/src/bootstrap/bootstrap-state.test.ts; apps/id/src/routes/bootstrap.routes.ts; apps/id/src/server.ts
- **Depends On:** I22, I11, I14
- **Effort:** XS
- **Exact Spec:**
  - Expose a service that reports whether initial setup is required, whether a valid unconsumed bootstrap token exists and whether the first Platform Owner already exists.
  - Expose only non-sensitive public setup state; never reveal token digest, token existence details that aid guessing, account email or internal database state.
  - Return setupRequired=false permanently after the first Platform Owner capability is created, even if old tokens remain in storage.
  - Add a GET setup-status route and wire it into apps/id server.
- **DO NOT:** Do not return whether a particular email/account exists or expose bootstrap-token metadata.
- **Acceptance Criteria:**
  - [x] Fresh DB reports setup required only when a valid bootstrap token is available. 
  - [x] Consumed/expired token or existing Platform Owner disables setup. 
  - [x] Route response is stable and contains no secret details. 
- **Verify:** bun --filter @moonwitness/id test; bun --filter @moonwitness/id build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: `bun --filter @moonwitness/id test` — passed (9 files, 40 tests)
  - Command: `bun --filter @moonwitness/id build` — passed (tsc exited 0)
  - Manual verification: `/setup-status` is registered in the Identity server and emits only `{ setupRequired }` with no-store; service checks unconsumed, unrevoked, unexpired tokens with a boolean SQL query and fails closed on database or owner-check errors; an injected platform-owner checker permanently disables setup without leaking account data.
  - Commit: pending I23 implementation commit

#### - [ ] I24 — Add atomic first Platform Owner creation service

- **Owner File(s):** packages/orm-identity/src/models/account-capability.ts; packages/orm-identity/src/models/account-capability.test.ts; apps/id/src/bootstrap/create-first-owner.ts; apps/id/src/bootstrap/create-first-owner.test.ts; apps/id/src/database/migrations/*account-capability*
- **Depends On:** I15, I16, I22, I23
- **Effort:** S
- **Exact Spec:**
  - Represent platform capabilities separately from tenant/business roles. Add a minimal capability grant model with unique account/capability pairs.
  - Implement a transaction that verifies bootstrap eligibility, creates account, verified initial identifier, password credential and the first platform_owner capability.
  - Enforce a database-level uniqueness/installation guard so two concurrent requests cannot create two first owners.
  - Return a non-secret account subject and one-time success result; never return the password hash or bootstrap verifier.
  - Do not create a Business DB user in this service; provisioning happens through the later outbox integration.
- **DO NOT:** Do not assign the legacy system/superadmin role or grant blanket tenant-data permissions.
- **Acceptance Criteria:**
  - [ ] Exactly one first Platform Owner can be created even under concurrent attempts.
  - [ ] Account, identifier, credential and capability are committed atomically or all rolled back.
  - [ ] Second owner bootstrap attempt is rejected without revealing sensitive account data.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test; PostgreSQL concurrency test when available.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I25 — Add single-use bootstrap claim endpoint

- **Owner File(s):** apps/id/src/routes/bootstrap.routes.ts; apps/id/src/bootstrap/claim-bootstrap.ts; apps/id/src/bootstrap/claim-bootstrap.test.ts
- **Depends On:** I22, I23, I24
- **Effort:** S
- **Exact Spec:**
  - Add a POST claim endpoint that accepts setup token, initial identifier and password over TLS only.
  - Validate token using its one-way verifier and expiry; consume it atomically in the same transaction as first-owner creation.
  - Make repeated or concurrent claims fail safely. Do not disclose whether the token was previously valid, consumed or unknown.
  - Return a generic successful completion response and safe next step; do not issue long-lived access tokens as part of bootstrap.
  - Apply request-size limits and redact every submitted field from logs.
- **DO NOT:** Do not allow bootstrap token reuse or a public account-registration mode.
- **Acceptance Criteria:**
  - [ ] Only one claim can succeed for an installation.
  - [ ] Token consumption and first-owner creation are atomic.
  - [ ] Invalid, expired, reused and concurrent claims fail closed.
  - [ ] No submitted secret appears in logs or error responses.
- **Verify:** bun --filter @moonwitness/id test; add integration test using an isolated Identity DB.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I26 — Add the minimal first-install setup page

- **Owner File(s):** apps/id/src/ui/setup-page.ts; apps/id/src/ui/setup-page.test.ts; apps/id/src/server.ts
- **Depends On:** I25
- **Effort:** S
- **Exact Spec:**
  - Render a small accessible HTML setup form from apps/id for the initial Platform Owner only; use server-side form handling and existing app styling conventions only if present.
  - Collect bootstrap token, email/identifier and password, send them to the claim endpoint, and show a generic completion/error state.
  - Do not persist token or password in browser storage, analytics, URL parameters, query strings or error telemetry.
  - Hide or disable the setup route once setup is complete. Keep the page independent of Board's logged-in application shell.
- **DO NOT:** Do not add a separate full frontend build or client-side authentication SDK for this one-page setup flow.
- **Acceptance Criteria:**
  - [ ] Setup form works on a fresh install and is unavailable after bootstrap completion.
  - [ ] Labels, focus order and errors are accessible.
  - [ ] Submitted secrets are not written to browser storage, URL or server logs.
- **Verify:** bun --filter @moonwitness/id test; run the existing app's browser/smoke test if configured.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I27 — Add password verification and login-session service

- **Owner File(s):** apps/id/src/auth/login-service.ts; apps/id/src/auth/login-service.test.ts
- **Depends On:** I16, I17
- **Effort:** S
- **Exact Spec:**
  - Implement a service that normalizes the submitted login identifier, resolves the account and verifies the stored credential through the password-hasher adapter.
  - Return the same externally observable failure for unknown identifier, wrong password, disabled account and locked account where appropriate.
  - On success create a server-side Identity session with explicit expiry and client context.
  - Keep last-login metadata minimal and avoid retaining raw passwords, request headers or excessive device fingerprinting.
- **DO NOT:** Do not query base.user or base.partner from the Identity service.
- **Acceptance Criteria:**
  - [ ] Correct credentials create a session for an active account.
  - [ ] Wrong password, unknown account and disabled account do not create a session.
  - [ ] Password verification uses the maintained hasher adapter and has no plaintext logging.
- **Verify:** bun --filter @moonwitness/id test; bun --filter @moonwitness/id build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I28 — Add login, current-session and logout routes

- **Owner File(s):** apps/id/src/routes/auth.routes.ts; apps/id/src/routes/auth.routes.test.ts; apps/id/src/server.ts
- **Depends On:** I27
- **Effort:** S
- **Exact Spec:**
  - Expose login and logout endpoints through the session service; add a minimal current-session endpoint for the Identity login page.
  - Choose cookie attributes deliberately: HttpOnly, Secure in production, SameSite appropriate to the chosen OIDC flow, bounded Path/Domain and explicit expiry.
  - Add CSRF protection for cookie-authenticated state-changing requests. Do not return raw session credentials to browser JavaScript.
  - Do not expose an API resembling the old API-owned /auth/register route; account creation is via controlled bootstrap or an approved later invitation flow.
- **DO NOT:** Do not put session IDs, passwords or refresh tokens in localStorage/sessionStorage or URL query parameters.
- **Acceptance Criteria:**
  - [ ] Login, current-session and logout flows are tested.
  - [ ] Cookie security attributes are asserted in production-mode tests.
  - [ ] Logout revokes server-side session state.
  - [ ] No public self-registration route exists.
- **Verify:** bun --filter @moonwitness/id test; bun --filter @moonwitness/id build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I29 — Add login throttling and brute-force regression tests

- **Owner File(s):** apps/id/src/security/login-rate-limit.ts; apps/id/src/security/login-rate-limit.test.ts; apps/id/src/routes/auth.routes.test.ts
- **Depends On:** I28
- **Effort:** S
- **Exact Spec:**
  - Add bounded rate limiting for login and bootstrap claim attempts using the repository's maintained rate-limit support where practical.
  - Rate-limit using privacy-preserving keys and server-side state; avoid trusting arbitrary forwarded client IP headers unless the trusted proxy chain is configured.
  - Use generic failures and bounded backoff for repeated failures. Avoid permanent account lockout that can be abused to deny service.
  - Test rate-limit reset/expiry behavior and concurrent request handling.
- **DO NOT:** Do not log credentials, expose account existence, or let user-supplied headers spoof the trusted client address.
- **Acceptance Criteria:**
  - [ ] Repeated failed logins are throttled.
  - [ ] Unknown and known accounts have equivalent error behavior.
  - [ ] Rate limits expire and do not permanently lock an account.
  - [ ] Tests cover configured trusted-proxy behavior.
- **Verify:** bun --filter @moonwitness/id test; bun --filter @moonwitness/id build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.



## Wave exit gate

A fresh Identity database can issue a one-time operator token, create exactly one Platform Owner, lock bootstrap permanently and authenticate/revoke an Identity session. There is no public self-registration endpoint.
