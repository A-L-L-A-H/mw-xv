# Wave 6 — Clients and Deployment



**Tasks:** I60–I67. Integrate Board and Desktop as OIDC public clients, then deploy Identity as an independent service. This is the first production-usable cutover gate.



## Execution rule

Execute one task per cycle in dependency order. Inspect existing client/session conventions before editing. Do not cut production traffic over until the clean-install end-to-end gate passes.



#### - [ ] I60 — Register Board as an OIDC public client

- **Owner File(s):** apps/id/src/oidc/clients/board-client.ts; apps/id/src/oidc/clients/board-client.test.ts; apps/id/src/database/seeds/board-client.ts
- **Depends On:** I31, I40
- **Effort:** XS
- **Exact Spec:**
  - Register a stable Board client ID as a public client with Authorization Code grant and PKCE S256 only.
  - Configure exact development and production callback URI allowlists from validated deployment configuration; never accept wildcard hosts or arbitrary callback input.
  - Allow only the scopes Board actually needs. Do not grant Client Credentials to a public client.
  - Make seed application idempotent and keep redirect URI values out of source when they differ by deployment.
- **DO NOT:** Do not store a Board client secret or hard-code a production hostname.
- **Acceptance Criteria:**
  - [ ] Board is registered as a public OIDC client.
  - [ ] Only Authorization Code + PKCE is enabled for the Board client.
  - [ ] Redirect allowlist is exact and environment-specific.
  - [ ] Repeated seed runs do not duplicate client records.
- **Verify:** bun --filter @moonwitness/id test; identity client registry integration test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I61 — Implement Board Authorization Code + PKCE callback

- **Owner File(s):** apps/board/src/app/auth/login/route.ts; apps/board/src/app/auth/callback/route.ts; apps/board/src/lib/auth/oidc-client.ts; apps/board/src/lib/auth/oidc-client.test.ts
- **Depends On:** I32, I33, I34, I40, I60
- **Effort:** S
- **Exact Spec:**
  - Inspect the existing Board App Router layout, middleware and API client before choosing exact integration seams.
  - Implement login initiation and callback using a maintained OIDC client helper from packages/identity-sdk or the selected provider's documented client library.
  - Generate state, nonce and PKCE verifier server-side; validate state/nonce on callback and exchange the code only against the configured issuer/token endpoint.
  - Use a server-side BFF/session boundary so access and refresh tokens are not returned to browser JavaScript.
  - Validate post-login return paths against local relative paths to prevent open redirects.
- **DO NOT:** Do not put tokens, code_verifier or client secrets in localStorage, sessionStorage, browser URLs or client-side logs.
- **Acceptance Criteria:**
  - [ ] Board login uses Authorization Code + PKCE S256.
  - [ ] State, nonce and redirect validation are tested.
  - [ ] Tokens remain server-side in secure session storage.
  - [ ] Open-redirect attempts are rejected.
- **Verify:** bun --filter @moonwitness/board typecheck; Board auth unit tests; add a focused Playwright login callback test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I62 — Implement Board server-side session, renewal and logout

- **Owner File(s):** apps/board/src/lib/auth/session-store.ts; apps/board/src/lib/auth/session-store.test.ts; apps/board/src/app/auth/logout/route.ts; apps/board/src/middleware.ts
- **Depends On:** I39, I61
- **Effort:** S
- **Exact Spec:**
  - Persist Board's app session using a server-side session mechanism supported by the current Next deployment model.
  - Set Secure, HttpOnly, SameSite and expiry attributes deliberately. Keep provider refresh tokens encrypted or sealed at rest in server-side storage.
  - Renew access tokens server-side and handle refresh replay/revoked session by clearing Board session and requiring login again.
  - Implement logout that revokes the Identity session/token family and clears the local cookie.
  - Prevent CSRF for state-changing cookie-authenticated endpoints.
- **DO NOT:** Do not expose refresh tokens to browser code or rely on deleting the cookie without revoking the Identity session.
- **Acceptance Criteria:**
  - [ ] Session cookie has secure production attributes.
  - [ ] Access token renewal occurs server-side.
  - [ ] Refresh failure clears invalid local session.
  - [ ] Logout revokes Identity session and Board cookie.
  - [ ] CSRF protection is tested.
- **Verify:** bun --filter @moonwitness/board typecheck; Board auth tests; focused Playwright session/logout test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I63 — Register Desktop as an OIDC public client

- **Owner File(s):** apps/id/src/oidc/clients/desktop-client.ts; apps/id/src/oidc/clients/desktop-client.test.ts; apps/id/src/database/seeds/desktop-client.ts
- **Depends On:** I31, I40
- **Effort:** XS
- **Exact Spec:**
  - Register a stable Desktop client ID as a public client using Authorization Code + PKCE S256.
  - Define exact loopback callback or custom-scheme callback policy supported by Desktop; require state, nonce and PKCE.
  - Ensure callback URI registration does not allow arbitrary ports/hosts beyond the documented secure loopback pattern.
  - Keep allowed scopes least-privilege and do not assign a confidential-client secret.
- **DO NOT:** Do not treat a packaged Desktop binary as a confidential client or embed a static secret.
- **Acceptance Criteria:**
  - [ ] Desktop is registered as public OIDC client.
  - [ ] Callback allowlist matches the documented Desktop strategy.
  - [ ] Only expected grant types and scopes are allowed.
- **Verify:** bun --filter @moonwitness/id test; client registry validation tests.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I64 — Implement Desktop system-browser login with PKCE

- **Owner File(s):** apps/desktop/src/auth/oidc-client.ts; apps/desktop/src/auth/oidc-client.test.ts; apps/desktop/src/cli.ts
- **Depends On:** I32, I33, I34, I40, I63
- **Effort:** S
- **Exact Spec:**
  - Implement OIDC login using the system browser, not an embedded browser password form.
  - Use random state/nonce and PKCE S256; receive callback through the exact loopback/custom-scheme approach approved in I63.
  - Validate callback state and exchange code using the configured issuer and public client ID.
  - Use OS credential storage or the repository's supported secure storage boundary for refresh/session credentials; if unavailable, stop and document a safe blocker rather than writing plaintext tokens.
  - Make CLI login status and logout commands report only non-sensitive account/session state.
- **DO NOT:** Do not embed client secrets, save refresh tokens in plaintext config files or accept arbitrary callback URLs.
- **Acceptance Criteria:**
  - [ ] Desktop starts system-browser OIDC login and validates state/PKCE callback.
  - [ ] Tokens are stored only through secure storage or flow fails closed.
  - [ ] No token appears in console output, logs or desktop config exports.
  - [ ] Logout revokes session and clears local credential storage.
- **Verify:** bun --filter @moonwitness/desktop typecheck; bun --filter @moonwitness/desktop test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I65 — Implement Desktop callback, token lifecycle and logout

- **Owner File(s):** apps/desktop/src/auth/session-manager.ts; apps/desktop/src/auth/session-manager.test.ts; apps/desktop/src/bridge.ts
- **Depends On:** I39, I64
- **Effort:** S
- **Exact Spec:**
  - Connect the OIDC client to the Desktop session manager and application bridge without changing unrelated agent/runtime behavior.
  - Handle access-token expiry, refresh rotation, refresh replay/revocation, logout and account-disabled failures.
  - Expose only typed authenticated/unauthenticated state to Desktop UI; never expose refresh token values to renderer code.
  - Ensure local credential clearing happens even when remote logout is unavailable, while reporting remote revocation status honestly.
- **DO NOT:** Do not pass bearer/refresh token values through generic UI events or IPC logs.
- **Acceptance Criteria:**
  - [ ] Session state is stable across app restart using secure storage.
  - [ ] Refresh and logout paths are covered by tests.
  - [ ] Renderer receives no refresh token or private credential.
  - [ ] Remote logout failure does not prevent local credential clearing.
- **Verify:** bun --filter @moonwitness/desktop typecheck; bun --filter @moonwitness/desktop test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I66 — Add Identity service and separate Identity database to deployment

- **Owner File(s):** deploy/compose/docker-compose.production.yml; deploy/compose/docker-compose.yml; .env.example; .env.production.example; deploy/README.md
- **Depends On:** I10, I11, I12, I30
- **Effort:** S
- **Exact Spec:**
  - Inspect current Compose service naming, networks, secrets, health checks, reverse proxy and production environment conventions before editing.
  - Add an Identity service with its own database connection and service health check. Use a separate database name and credential from the Business API.
  - Add the Identity database service/database initialization only if the current PostgreSQL deployment does not already provide a safe separate database mechanism.
  - Route the public Identity issuer path consistently with IDENTITY_ISSUER_URL and ensure API, Board and Desktop receive only public issuer metadata/configuration.
  - Document bootstrap-token issuance as an operator step. Do not add a default password or MW_SETUP_TOKEN permanent environment variable.
  - Keep local development defaults clearly separated from production.
- **DO NOT:** Do not publish the Identity DB port publicly, share database credentials with API, or hard-code real issuer/domain values.
- **Acceptance Criteria:**
  - [ ] Compose can start Business DB and Identity DB as separate databases with separate credentials.
  - [ ] Identity readiness is used by service dependencies/health checks.
  - [ ] Issuer URL and reverse-proxy path are consistent.
  - [ ] No default superadmin password/setup token is required.
- **Verify:** docker compose config; compose build/start smoke test using disposable local environment; git diff --check.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I67 — Prove clean first installation end to end

- **Owner File(s):** apps/id/tests/clean-install.e2e.test.ts; apps/api/tests/identity-clean-install.e2e.test.ts; apps/board/e2e/identity-login.spec.ts; apps/desktop/tests/identity-login.e2e.test.ts
- **Depends On:** I25, I37, I45, I47, I58, I62, I65, I66
- **Effort:** S
- **Exact Spec:**
  - Start from empty disposable Identity and Business databases; run migrations and assert setup is required.
  - Issue a bootstrap token through the operator command, create the first Platform Owner, and prove the setup token cannot be reused.
  - Complete Board and Desktop OIDC login with test clients and verify the API accepts only the Identity access token.
  - Prove the provisioning outbox creates exactly one base.user/Partner and explicit initial membership.
  - Prove cross-tenant requests, unknown business principal, disabled account and invalid audience are denied.
  - Record deterministic setup/teardown and avoid real domains, email providers or production credentials.
- **DO NOT:** Do not run against any shared or production database or mark the cutover ready using only mocked auth routes.
- **Acceptance Criteria:**
  - [ ] A clean installation passes from migrations through first-owner setup, login, provisioning and API access.
  - [ ] Bootstrap token can be consumed only once.
  - [ ] Board and Desktop login tests pass.
  - [ ] Cross-tenant and invalid-token negative tests pass.
  - [ ] Test teardown leaves no shared data behind.
- **Verify:** Run the new clean-install E2E suites and all affected API/ID/Board/Desktop test commands.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.



## Wave exit gate

Board and Desktop both log in through the same OIDC issuer; no client stores refresh tokens in browser-readable storage; deployment has separate Identity DB credentials; full clean-install E2E passes before production traffic is switched.