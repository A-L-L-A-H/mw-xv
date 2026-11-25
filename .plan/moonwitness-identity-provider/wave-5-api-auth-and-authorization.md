# Wave 5 — API Authentication and Authorization



**Tasks:** I50–I59. Convert API into an OIDC resource server while retaining its Business authorization authority. Remove old human auth only after Board and Desktop are migrated.



## Execution rule

Execute one task per cycle in dependency order. Respect Owner File(s). Identity must never open the Business database; Business provisioning is performed by the API-side consumer.



#### - [ ] I50 — Scaffold packages/identity-sdk

- **Owner File(s):** packages/identity-sdk/package.json; packages/identity-sdk/tsconfig.json; packages/identity-sdk/src/index.ts
- **Depends On:** I04
- **Effort:** XS
- **Exact Spec:**
  - Create or reuse a workspace package named @moonwitness/identity-sdk with Node 24 engine and strict build/test scripts.
  - Keep the SDK free of identity database connection code, password/session logic and signing private keys.
  - Export only stable public types and helper entry points. Keep browser OIDC client utilities and server-side verifier separated by subpath if both are needed.
  - Use only dependencies justified by the I03/I51 implementation choice.
- **DO NOT:** Do not add direct ORM, database, Fastify server or React dependencies.
- **Acceptance Criteria:**
  - [ ] SDK builds independently and public exports are importable.
  - [ ] No private signing key or DB credential path exists in the SDK.
  - [ ] Package dependencies are minimal.
- **Verify:** bun --filter @moonwitness/identity-sdk build; bun --filter @moonwitness/identity-sdk test.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I51 — Implement strict issuer/audience/JWKS access-token verifier

- **Owner File(s):** packages/identity-sdk/src/server/token-verifier.ts; packages/identity-sdk/src/server/token-verifier.test.ts; packages/identity-sdk/src/index.ts
- **Depends On:** I30, I35, I36, I50
- **Effort:** S
- **Exact Spec:**
  - Use a maintained JOSE/JWT verifier and remote JWKS resolver supported by the selected runtime; reuse a transitive dependency only if direct dependency policy and exports permit it.
  - Require exact configured issuer and API audience, allowed asymmetric algorithms, valid kid, signature, exp, iat and bounded clock skew.
  - Reject ID tokens and tokens missing required access-token claims.
  - Cache JWKS using provider cache semantics with bounded refresh; protect against attacker-driven arbitrary kid or URL resolution.
  - Return a typed minimal verified principal object, not the original untrusted payload.
- **DO NOT:** Do not decode-only verify JWT, trust token alg/header, accept arbitrary jwks_uri or use a shared HS256 secret.
- **Acceptance Criteria:**
  - [ ] Valid Identity access token passes.
  - [ ] Wrong issuer, audience, signature, alg, kid, expiry and token type are rejected.
  - [ ] JWKS refresh behavior is bounded and tested.
  - [ ] Verifier does not log token values.
- **Verify:** bun --filter @moonwitness/identity-sdk test; bun --filter @moonwitness/identity-sdk build.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I52 — Replace API-local JWT signing with Identity token verification

- **Owner File(s):** apps/api/src/plugins/auth.plugin.ts; apps/api/src/plugins/identity-verifier.plugin.ts; apps/api/src/plugins/identity-verifier.plugin.test.ts; apps/api/src/app.ts
- **Depends On:** I12, I36, I51
- **Effort:** S
- **Exact Spec:**
  - Introduce the Identity access-token verifier into the Fastify authentication plugin lifecycle.
  - Read trusted issuer, audience and JWKS configuration from validated API config; never use a caller-supplied issuer/JWKS URL.
  - Remove API access-token signing from the user authentication path while keeping the API bootable for the remaining old routes until I57/I58.
  - Keep authentication plugin output compatible with downstream request principal consumers during the staged cutover.
  - Fail startup or readiness when required verifier configuration is missing in production.
- **DO NOT:** Do not expose private key material to API or accept old HS256 user tokens as a fallback.
- **Acceptance Criteria:**
  - [ ] API accepts only verified Identity access tokens on the new path.
  - [ ] Invalid/missing verifier config fails closed in production.
  - [ ] No user access token is signed by API.
  - [ ] Existing non-auth business routes still build.
- **Verify:** bun --filter @moonwitness/api test; bun --filter @moonwitness/api build.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I53 — Resolve verified token subject to the local business principal

- **Owner File(s):** apps/api/src/plugins/auth.plugin.ts; apps/api/src/auth/identity-principal-repository.ts; apps/api/src/auth/identity-principal-mapping.test.ts
- **Depends On:** I42, I52
- **Effort:** S
- **Exact Spec:**
  - After cryptographic validation, resolve the verified subject through identity-principal-repository.
  - Construct the existing request user/principal context from the mapped base.user, Partner, memberships, groups, ModelAccess and cache state.
  - Reject missing, inactive or unmapped subjects; do not provision users during arbitrary API requests.
  - Keep company context selection subject to existing CompanyMembership validation.
- **DO NOT:** Do not trust role/company claims from token as a substitute for business DB authorization.
- **Acceptance Criteria:**
  - [ ] Verified sub maps to one local business user.
  - [ ] Unknown/unprovisioned/inactive subject receives an authentication failure.
  - [ ] Company membership remains checked by API.
- **Verify:** bun --filter @moonwitness/api test; API auth integration tests.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I54 — Preserve auth-cache invalidation and revocation behavior

- **Owner File(s):** apps/api/src/plugins/auth.plugin.ts; apps/api/src/auth/identity-revocation.ts; apps/api/src/auth/identity-revocation.test.ts
- **Depends On:** I43, I45, I53
- **Effort:** S
- **Exact Spec:**
  - Preserve existing auth cache behavior and invalidation safeguards while changing cache keys to the local business user and verified session identifiers.
  - Invalidate affected user/session caches after account disable, reactivation, membership changes and relevant provisioning events.
  - Use the authenticated provisioning/event channel or Business DB notification mechanism; API must not query Identity DB directly.
  - Define access-token maximum lifetime and revocation delay explicitly. Fail closed when a required revocation event is malformed or sender is unauthenticated.
- **DO NOT:** Do not claim immediate revocation if only short-lived token expiry is implemented; document and test the actual revocation bound.
- **Acceptance Criteria:**
  - [ ] Disabled user is rejected after event propagation and cache invalidation.
  - [ ] Cache cannot retain revoked principal state beyond defined TTL.
  - [ ] API has no direct Identity DB connection.
- **Verify:** bun --filter @moonwitness/api test; revocation/cache integration tests.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I55 — Remove implicit global system/superadmin data bypass

- **Owner File(s):** apps/api/src/auth/policy.ts; apps/api/src/auth/rules.ts; apps/api/src/auth/policy.test.ts; apps/api/src/auth/rules.test.ts
- **Depends On:** I05, I53
- **Effort:** S
- **Exact Spec:**
  - Inventory every authorization bypass currently triggered by system or superadmin role and convert it into explicit policy checks.
  - Ensure platform-level operations require named platform capabilities/scopes and are restricted to explicit administrative endpoints.
  - Keep tenant model grants, CompanyMembership and record rules active for ordinary business data even for Platform Owner.
  - Convert technical service access to explicit Service Principal scopes in the later machine-identity tasks; avoid granting technical actor an all-data exception.
  - Add regression tests for cross-company read/write denial and legitimate platform-maintenance endpoints.
- **DO NOT:** Do not merely rename superadmin or move the bypass to a new boolean flag.
- **Acceptance Criteria:**
  - [ ] No global no-domain/no-row-filter path remains for human Platform Owner.
  - [ ] Tenant boundaries remain enforced for platform actors.
  - [ ] Every administrative bypass is a named endpoint capability with a test.
  - [ ] system actor is not silently granted human permissions.
- **Verify:** bun --filter @moonwitness/api test; authorization and row-rule integration tests.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I56 — Refactor current-user profile and preference endpoints

- **Owner File(s):** apps/api/src/routes/auth.routes.ts; apps/api/src/routes/auth-me.routes.ts; apps/api/src/routes/auth-me.routes.test.ts
- **Depends On:** I53
- **Effort:** S
- **Exact Spec:**
  - Separate identity-owned attributes from Business-owned profile/preferences in the current-user response.
  - Keep API endpoints for business profile and preference data only; identity identifiers/password/MFA changes belong to apps/id.
  - Return a stable local principal ID and opaque subject mapping only where client needs it; do not expose credential metadata.
  - Update profile/preference routes to require the verified principal and preserve existing validation/tenant context.
- **DO NOT:** Do not let API update Identity password or canonical login identifier through Business ORM.
- **Acceptance Criteria:**
  - [ ] Current-user endpoint works with Identity-authenticated request context.
  - [ ] Business preferences/profile remain editable through API policy.
  - [ ] No password, credential or refresh-token field is returned.
- **Verify:** bun --filter @moonwitness/api test; Board API client type checks.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I57 — Remove API-owned human login/register/password routes

- **Owner File(s):** apps/api/src/routes/auth.routes.ts; apps/api/src/routes/auth.routes.test.ts; apps/api/src/server.ts
- **Depends On:** I56, I61, I64
- **Effort:** S
- **Exact Spec:**
  - After Board and Desktop OIDC flows have passed their integration tests, remove human login, register, refresh, logout and password-change route handlers from API.
  - Keep only approved Business profile/preference/current-principal endpoints that are not identity credentials.
  - Return a clear not-found or explicit deprecation response for removed legacy paths according to repository API compatibility policy; do not retain a hidden alternate login.
  - Update route tests and generated API docs.
- **DO NOT:** Do not remove the route until I61 and I64 are completed; do not leave legacy login accepted behind a feature flag in production.
- **Acceptance Criteria:**
  - [ ] No API route can authenticate a human with a password.
  - [ ] No public self-registration/login/refresh/password route remains.
  - [ ] Business profile routes continue to work.
- **Verify:** bun --filter @moonwitness/api test; bun --filter @moonwitness/api build; search route registry for legacy endpoints.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I58 — Remove API runtime wiring to legacy credential auth service

- **Owner File(s):** apps/api/src/addons/registry.ts; apps/api/package.json; apps/api/src/addons/registry.test.ts
- **Depends On:** I52, I53, I57
- **Effort:** S
- **Exact Spec:**
  - Remove creation and registration of the old packages/auth credential service from API runtime after all active routes no longer depend on it.
  - Remove the API workspace dependency only if no remaining API code imports the package.
  - Keep unrelated business addon registration unchanged.
  - Update registry tests to prove Identity verifier is the only human authentication authority.
- **DO NOT:** Do not delete the packages/auth source in this task; do not remove machine-token support without inspecting its runtime uses.
- **Acceptance Criteria:**
  - [ ] API boot does not instantiate createAuthService.
  - [ ] No unused auth package dependency remains in apps/api/package.json.
  - [ ] All business addons still register as before.
- **Verify:** bun --filter @moonwitness/api test; bun --filter @moonwitness/api build.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I59 — Add tenant and authorization regression coverage

- **Owner File(s):** apps/api/tests/identity-auth.integration.test.ts; apps/api/tests/authorization-tenant-boundary.integration.test.ts; apps/api/vitest.config.ts
- **Depends On:** I47, I48, I50, I55, I57, I58
- **Effort:** S
- **Exact Spec:**
  - Test authenticated user with one company membership can access only that company where policy requires it.
  - Test Platform Owner cannot bypass ordinary tenant record rules.
  - Test unmapped subject, disabled business user, removed membership, invalid scope and expired token fail.
  - Test service actors cannot use human endpoints and cannot expand scopes through request headers.
  - Use isolated test databases and synthetic accounts only.
- **DO NOT:** Do not weaken existing policy to make tests pass or rely exclusively on mocked authorization helpers.
- **Acceptance Criteria:**
  - [ ] Critical tenant-boundary positive and negative tests pass.
  - [ ] Tests cover Identity verification plus Business authorization together.
  - [ ] No cross-tenant data leakage is possible through tested CRUD paths.
- **Verify:** bun --filter @moonwitness/api test; run targeted PostgreSQL integration suite.
- **Evidence:** after completion, append exact command, result and commit SHA here.



## Wave exit gate

API accepts only Identity-issued access tokens, resolves sub to base.user, applies company/group/model/record rules, denies global bypass and has no active human login/register/password flow.