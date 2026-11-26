# Wave 3 — OIDC Provider



**Tasks:** I30–I40. Integrate the maintained OIDC provider selected in I03. The library owns protocol parsing/state machines; this code configures policy and tests.



## Execution rule

Execute one micro-task per cycle in dependency order. Inspect only the task-owned paths and direct dependencies. Use the selected OIDC provider contract from Wave 0. Never implement protocol or cryptographic primitives from scratch.



#### - [ ] I30 — Publish and verify OIDC discovery metadata

- **Owner File(s):** apps/id/src/oidc/provider.ts; apps/id/src/oidc/discovery.test.ts; apps/id/src/server.ts
- **Depends On:** I03, I09, I19
- **Effort:** S
- **Exact Spec:**
  - Integrate the selected provider's discovery implementation. Prefer the provider's built-in metadata endpoint and configuration.
  - Publish the exact issuer URL and supported endpoints/algorithms/grants from validated configuration.
  - Ensure metadata never advertises disabled grants, HTTP callback URLs in production or unsupported signing algorithms.
  - Add a discovery contract test that checks issuer consistency and required endpoints.
- **DO NOT:** Do not handwrite a separate discovery document that can drift from the provider configuration.
- **Acceptance Criteria:**
  - [ ] OIDC discovery returns valid metadata for the configured issuer.
  - [ ] Issuer value exactly matches token issuer and configured public base URL.
  - [ ] Unsupported algorithms/grants are not advertised.
- **Verify:** bun --filter @moonwitness/id test; provider discovery smoke test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - **BLOCKER — dependency tidak terpenuhi:** I03 memilih `oidc-provider` (panva/node-oidc-provider) sebagai provider wajib, tetapi `apps/id/package.json` tidak mendeklarasikan dependency tersebut, `bun.lock` tidak memuatnya, dan `require.resolve('oidc-provider')` menghasilkan `MODULE_NOT_FOUND`. `@fastify/middie` tersedia, tetapi tidak dapat dipakai tanpa provider.
  - Owner File(s) I30 hanya `apps/id/src/oidc/provider.ts`, `apps/id/src/oidc/discovery.test.ts`, dan `apps/id/src/server.ts`; menambahkan `oidc-provider` ke `apps/id/package.json`/`bun.lock` berada di luar scope task dan dilarang oleh aturan owner file.
  - Perbaikan yang diperlukan: buat task follow-up untuk menambahkan dependency `oidc-provider` versi v8.x/9.x yang kompatibel Node 24 ke manifest apps/id, commit lockfile, lalu ulangi I30 dari awal.
  - Verification I30 tidak dijalankan karena implementasi tidak dimulai; `bun --filter @moonwitness/id test` dan provider discovery smoke test tidak dapat membuktikan acceptance criteria tanpa provider terpasang.

#### - [ ] I31 — Validate OAuth client registration and redirect URI allowlists

- **Owner File(s):** apps/id/src/oidc/client-registry.ts; apps/id/src/oidc/client-registry.test.ts
- **Depends On:** I19, I30
- **Effort:** S
- **Exact Spec:**
  - Expose a provider adapter that loads enabled client metadata from identity.oauth_client.
  - Require exact redirect URI equality against a registered allowlist; reject wildcard, substring and unnormalized URI matches.
  - Apply per-client grant type and scope allowlists. Board and Desktop are public clients and must not be assigned client secrets.
  - Make unknown or disabled client IDs fail with protocol-appropriate generic errors.
- **DO NOT:** Do not allow dynamic arbitrary client registration or wildcard callback hosts in production.
- **Acceptance Criteria:**
  - [ ] Exact registered redirect URI is accepted.
  - [ ] Unregistered, wildcard, lookalike and disabled-client URIs are rejected.
  - [ ] Public clients cannot authenticate with a stored client secret.
- **Verify:** bun --filter @moonwitness/id test; provider client-validation smoke test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I32 — Validate authorization requests and state/nonce requirements

- **Owner File(s):** apps/id/src/oidc/authorization-request.ts; apps/id/src/oidc/authorization-request.test.ts
- **Depends On:** I30, I31
- **Effort:** S
- **Exact Spec:**
  - Configure the selected provider to validate response_type, client_id, redirect_uri, scope, state and nonce according to OIDC requirements.
  - Ensure authorization requests require an active Identity session before consent/authorization continues.
  - Reject unsupported response modes and grant types rather than silently downgrading.
  - Use provider hooks or documented extension points; do not replace the provider's protocol parser.
- **DO NOT:** Do not accept open redirect parameters or forward unvalidated query parameters to callback URLs.
- **Acceptance Criteria:**
  - [ ] Invalid/missing client and redirect are rejected safely.
  - [ ] State is required for app authorization requests; nonce is required for OIDC ID token requests.
  - [ ] Provider handles protocol error response construction.
- **Verify:** bun --filter @moonwitness/id test; provider authorization-request integration tests.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I33 — Enforce PKCE S256 for public clients

- **Owner File(s):** apps/id/src/oidc/pkce-policy.ts; apps/id/src/oidc/pkce-policy.test.ts
- **Depends On:** I31, I32
- **Effort:** XS
- **Exact Spec:**
  - Configure Authorization Code + PKCE S256 as mandatory for Board and Desktop public clients.
  - Reject plain PKCE, missing code_challenge, unsupported challenge methods and malformed challenge values.
  - Use the OIDC provider's built-in PKCE verification. The application adapter may add policy checks but must not reimplement verifier hashing.
  - Add negative tests for absent and invalid challenges.
- **DO NOT:** Do not store or log code_verifier values.
- **Acceptance Criteria:**
  - [ ] Public-client authorization requests require S256.
  - [ ] Provider rejects mismatched verifier and challenge.
  - [ ] No custom SHA/PKCE state machine is introduced.
- **Verify:** bun --filter @moonwitness/id test; PKCE provider integration tests.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I34 — Bind authorization codes to client, redirect, PKCE and nonce

- **Owner File(s):** apps/id/src/oidc/authorization-code-policy.ts; apps/id/src/oidc/authorization-code-policy.test.ts
- **Depends On:** I20, I31, I33
- **Effort:** S
- **Exact Spec:**
  - Use the selected provider's authorization-code implementation and storage adapter.
  - Verify issued codes are single use and bound to client ID, exact redirect URI, PKCE challenge, session and OIDC nonce as required.
  - Use provider-supported hooks to reject replay and expired codes. Do not invent parallel authorization-code storage if the provider already handles it.
  - Record the authoritative code-storage decision in test evidence.
- **DO NOT:** Do not log code values or accept a code issued to a different client/redirect.
- **Acceptance Criteria:**
  - [ ] Code cannot be exchanged twice.
  - [ ] Code cannot be exchanged with a different client, redirect or PKCE verifier.
  - [ ] Expired and revoked-session codes fail.
- **Verify:** bun --filter @moonwitness/id test; provider code-flow integration test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I35 — Add asymmetric signing-key provider abstraction

- **Owner File(s):** apps/id/src/security/signing-key-provider.ts; apps/id/src/security/signing-key-provider.test.ts; apps/id/src/database/migrations/*signing-key*; packages/orm-identity/src/models/signing-key-metadata.ts
- **Depends On:** I04, I14, I03
- **Effort:** S
- **Exact Spec:**
  - Define a provider interface for signing operations and public-key metadata retrieval, using the chosen OIDC implementation's supported key-provider extension point.
  - Keep private key bytes outside normal ORM rows when a production key-management provider is selected. Persist only key identifiers, algorithm, public metadata, activation and retirement timestamps.
  - Provide a clearly labelled development-only local key implementation if needed for tests; production mode must require an explicitly configured key provider.
  - Restrict signing algorithms to a documented allowlist compatible with the selected provider and resource-server verifier.
- **DO NOT:** Do not implement signing algorithms or JOSE primitives manually, store raw production private keys in the database, or silently fall back to development keys.
- **Acceptance Criteria:**
  - [ ] Provider interface has injectable test implementation.
  - [ ] Production config fails when no valid key provider is configured.
  - [ ] Key metadata contains no private key material.
  - [ ] Only approved asymmetric algorithms are allowed.
- **Verify:** bun --filter @moonwitness/id test; bun --filter @moonwitness/orm-identity test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I36 — Publish JWKS and active public keys

- **Owner File(s):** apps/id/src/oidc/jwks.test.ts; apps/id/src/oidc/provider.ts; apps/id/src/security/signing-key-provider.ts
- **Depends On:** I35, I30
- **Effort:** XS
- **Exact Spec:**
  - Configure the selected OIDC provider to publish public keys from the signing-key provider.
  - Expose no private key parameters in JWKS. Verify kid uniqueness and algorithm/use metadata.
  - Ensure only active and deliberately retained verification keys are published; retired keys remain only through the configured token-verification overlap window.
  - Add tests that parse JWKS and assert private fields are absent.
- **DO NOT:** Do not hand-assemble private JWK objects or expose internal key-provider diagnostics publicly.
- **Acceptance Criteria:**
  - [ ] JWKS contains usable public keys with stable kid values.
  - [ ] No private key parameter is published.
  - [ ] Unknown/retired key behavior is documented and tested.
- **Verify:** bun --filter @moonwitness/id test; JWKS endpoint smoke test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I37 — Complete Authorization Code token exchange

- **Owner File(s):** apps/id/src/oidc/token-policy.ts; apps/id/src/oidc/token-policy.test.ts; apps/id/src/oidc/provider.ts
- **Depends On:** I30, I31, I32, I33, I34, I35, I36
- **Effort:** S
- **Exact Spec:**
  - Configure the provider's token endpoint for Authorization Code + PKCE and OIDC ID token issuance.
  - Define API audience for access tokens. Ensure ID tokens are distinct and cannot be accepted as API credentials.
  - Use minimal claims from oidc-contract.md; never place tenant/model grants into the access token.
  - Ensure disabled accounts or revoked sessions cannot exchange an authorization code.
  - Use the selected provider's standards-compliant token endpoint; this task is policy/configuration and integration, not a new token protocol implementation.
- **DO NOT:** Do not sign JWTs directly in route handlers or issue an access token without verified client/authorization context.
- **Acceptance Criteria:**
  - [ ] Valid code and PKCE exchange returns expected ID/access token types.
  - [ ] Wrong client, redirect, nonce, audience and PKCE fail.
  - [ ] Disabled account/revoked session fails before token issue.
  - [ ] ID token is not accepted as API access token.
- **Verify:** bun --filter @moonwitness/id test; full authorization-code flow smoke test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I38 — Complete refresh rotation and replay-family revocation

- **Owner File(s):** apps/id/src/oidc/refresh-token-policy.ts; apps/id/src/oidc/refresh-token-policy.test.ts; apps/id/src/oidc/provider.ts
- **Depends On:** I18, I37
- **Effort:** S
- **Exact Spec:**
  - Connect provider refresh behavior to the refresh-token family store and atomic rotation contract.
  - Configure single-use refresh tokens, bounded lifetime and replay detection.
  - On replay, revoke the affected refresh family and related session; record a redacted security event.
  - Ensure revoked, expired, disabled-account and wrong-client refresh attempts fail.
- **DO NOT:** Do not preserve legacy API refresh tokens or return raw refresh credentials from diagnostics.
- **Acceptance Criteria:**
  - [ ] Refresh token rotates on success.
  - [ ] Reusing a consumed token revokes the family/session.
  - [ ] Expired/revoked/disabled-account refresh attempts fail.
  - [ ] Concurrent refresh tests prove atomic behavior.
- **Verify:** bun --filter @moonwitness/id test; PostgreSQL refresh concurrency integration test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I39 — Complete logout and server-side session revocation

- **Owner File(s):** apps/id/src/oidc/logout-policy.ts; apps/id/src/oidc/logout-policy.test.ts; apps/id/src/oidc/provider.ts
- **Depends On:** I17, I18, I37, I38
- **Effort:** S
- **Exact Spec:**
  - Configure provider end-session/logout behavior and server-side session revocation.
  - Support revoking the current session and all sessions for an account through a separate protected account operation.
  - Ensure refresh tokens linked to a revoked session are unusable.
  - Use exact registered post-logout redirect URIs and safe default local completion when no redirect is allowed.
- **DO NOT:** Do not perform open redirects or claim that deleting a browser cookie alone revokes a session.
- **Acceptance Criteria:**
  - [ ] Logout invalidates server-side session and refresh family.
  - [ ] Unregistered post-logout URI is rejected.
  - [ ] All-session revocation invalidates existing sessions.
  - [ ] Tests verify old credentials no longer work.
- **Verify:** bun --filter @moonwitness/id test; OIDC logout integration test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I40 — Add full OIDC protocol integration tests

- **Owner File(s):** apps/id/tests/oidc-provider.integration.test.ts; apps/id/tests/oidc-security.integration.test.ts; apps/id/vitest.config.ts
- **Depends On:** I30, I31, I32, I33, I34, I35, I36, I37, I38, I39
- **Effort:** S
- **Exact Spec:**
  - Build an end-to-end test using an isolated Identity DB and the selected provider, starting from discovery and authorization request through callback, token exchange, refresh and logout.
  - Add negative tests for unregistered redirect, missing/bad PKCE, replayed code, replayed refresh token, wrong client, disabled account, invalid nonce and revoked session.
  - Validate the access token using the same public JWKS flow intended for API; verify issuer, audience, expiry and key ID.
  - Ensure tests do not contact production issuer, real email, real key store or external user data.
- **DO NOT:** Do not rely only on mocked provider functions for protocol conformance.
- **Acceptance Criteria:**
  - [ ] Happy path and all critical negative cases pass in an isolated test environment.
  - [ ] Tests confirm API access-token validation against JWKS.
  - [ ] No test output contains credentials or bearer tokens.
- **Verify:** bun --filter @moonwitness/id test; bun --filter @moonwitness/id build.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.



## Wave exit gate

Discovery, Authorization Code + PKCE, JWKS, token exchange, refresh rotation and logout pass integration tests. API-facing access tokens are asymmetric, issuer/audience-specific, short-lived and distinct from ID tokens.
