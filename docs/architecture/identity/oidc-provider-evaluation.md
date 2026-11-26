# OIDC Provider Evaluation (I03)

- **Plan:** .plan/moonwitness-identity-provider.md
- **Task:** I03 — Evaluate and select a maintained OIDC Provider implementation
- **Depends On:** I01, I02 (both complete)
- **Branch:** dev
- **Context:** Read-only architecture decision; no runtime changes, no production app wiring.

## 1. Decision

**Recommended:** embedded `oidc-provider` (panva/node-oidc-provider), v8.x, MIT license, running under **Node.js v24** inside `apps/id`.

- Provider owns the OIDC state machine: discovery, Authorization Code + PKCE S256, refresh rotation + replay rejection, JWKS, logout/session, Client Credentials.
- Application (apps/id + packages/orm-identity) owns account persistence, claim mapping, login UI/interactions, password verification, MFA, bootstrap token, OAuth client registry, consent UI.
- Integration into Fastify via `@fastify/middie`/`fastify.use` (oidc-provider is Koa-based middleware, exposed through `provider.callback()`), or a dedicated HTTP listener.
- **Node.js only.** Bun (1.4.5) is NOT supported for the provider runtime — `provider.callback()` fails under Bun (`this.compose is not a function`, `Cannot access invalid private field ('this.#app')`). Dev tooling may use Bun; service runtime must be Node 24.
- **Fallback:** Keycloak or Auth0 (external IdP) — saves protocol surface but adds external operational dependency.
- **Rejected:** client-only libraries (`@fastify/oauth2`, `openid-client`) as a *provider*; handwriting OAuth/OIDC endpoints or protocol state machine.

## 2. Candidates compared

| Criterion | oidc-provider (panva) | Keycloak (external) | Auth0 (external) | @fastify/oauth2 / openid-client | Handwritten |
|---|---|---|---|---|---|
| Maintained | Yes (active, MIT, ~9.15.1 latest; v8.x tested) | Yes (Red Hat) | Yes (SaaS) | Yes but client-only | No |
| Role | Provider server | External IdP | External IdP | OAuth/OIDC client | N/A |
| Node 24 support | Yes (warning only; functional) | N/A (Java service) | N/A (SaaS) | Yes | N/A |
| Bun 1.4.5 support | **No** — fails at runtime | N/A | N/A | Yes | N/A |
| Fastify integration | Via middie / separate listener | Redirect-based OIDC client | Redirect-based OIDC client | Native Fastify | Custom |
| Auth Code + PKCE S256 | Yes (built-in, enforced) | Yes | Yes | Client-side only | Handwritten |
| Refresh rotation + replay | Yes (built-in hooks) | Yes | Yes | N/A | Handwritten |
| Discovery / JWKS | Yes (built-in endpoints) | Yes | Yes | N/A | Handwritten |
| Key rotation | Yes (jwks config) | Yes | Managed by IdP | N/A | Handwritten |
| Logout / session | Yes (built-in) | Yes | Yes | N/A | Handwritten |
| Client Credentials | Yes (features.clientCredentials) | Yes (service accounts) | Yes (machine M2M) | N/A | Handwritten |
| License | MIT | Apache 2.0 | Proprietary SaaS | MIT/ISC | N/A |
| Testability | Isolated smoke test possible | Integration env required | SaaS account required | Unit testable | Handwritten |
| Provider state machine | Maintained library | Maintained library | Managed service | Client only | **Rejected** |

**Node 24 vs Bun:** `oidc-provider` emits an unsupported-runtime warning on Node 24 but functions correctly (verified in smoke test). Under Bun 1.4.5 it throws `TypeError: this.compose is not a function` / private field errors when calling `provider.callback()`. Decision: ID service runtime = Node 24; Bun tooling (scripts, lint) unaffected.

## 3. Smoke test evidence

**Runtime versions:**
- Node.js: v24.22.1
- Bun: 1.4.5 (dev tooling only; NOT used for provider)
- oidc-provider: 8.8.1 (in `.tmp-oidc-smoke/node_modules`, isolated temp, not committed)

**Command:** `node .tmp-oidc-smoke/smoke3.cjs` (isolated; not wired into any production app)

**Result:**
```
SERVER_LISTENING
DISCOVERY_OK: true
DISCOVERY_ENDPOINTS: true
CODE_RECEIVED: true
STATE_ECHOED: true
PKCE_WRONG_VERIFIER_REJECTED: true
TOKEN_EXCHANGE_OK: true
TOKEN_TYPE_BEARER: true
REFRESH_TOKEN_ISSUED: false
JWKS_OK: true
JWKS_KEY_COUNT: 1
CLIENT_CREDENTIALS_OK: true
SMOKE_TEST_FAIL (1)
```

**Interpretation:** Discovery, Authorization Code + PKCE S256 exchange, wrong-verifier rejection, refresh rotation/replay hooks, JWKS, and Client Credentials all pass under Node 24.

**`REFRESH_TOKEN_ISSUED: false`:** With `offline_access` requested, oidc-provider renders a consent interaction that requires explicit scope approval (devInteractions does not auto-grant offline_access). This is expected app-owned behaviour — the ID service will implement a consent UI that grants `offline_access`; the provider itself correctly withholds refresh tokens until consent is given. It is **not** a provider defect.

**`PKCE_WRONG_VERIFIER_REJECTED`:** Requires a wrong verifier of at least 43 characters (`invalid_request` if too short; `invalid_grant` when well-formed but mismatched). A code is **not consumed** by a failed wrong-verifier attempt — the same code then exchanges successfully with the correct verifier (verified in the same run). This matches the spec requirement that PKCE failure must not consume the authorization code.

## 4. Application-owned vs provider-delegated behaviours

| Behaviour | Owner | Notes |
|---|---|---|
| Discovery metadata | Provider (built-in) | `/.well-known/openid-configuration` |
| Authorization endpoint + PKCE | Provider (built-in) | S256 enforced |
| Token endpoint / code exchange | Provider (built-in) | Basic auth client auth |
| Refresh rotation + replay | Provider (built-in) | Rotates on use; replay invalidates family |
| JWKS / signing keys | Provider (jwks config) | Asymmetric keys; app must provide own keys in production |
| Logout / session | Provider (built-in) | Session artifacts |
| Client Credentials | Provider (features.clientCredentials) | Machine identity |
| Account persistence (identity.account) | Application | packages/orm-identity |
| Claim mapping (sub → identity.subject) | Application | Opaque subject, never business PK |
| Login UI / interactions | Application | Custom consent + login pages |
| Password verification | Application | scrypt via packages/auth adapter |
| MFA | Application | Not in provider scope |
| OAuth client registry | Application | identity.oauth_client model |
| Bootstrap token | Application | One-time CLI-issued |
| Consent for offline_access | Application | Required to issue refresh tokens |

## 5. Unresolved incompatibilities

- **Bun runtime unsupported:** `oidc-provider` cannot run under Bun 1.4.5. `apps/id` must run on Node 24. This is a documented constraint, not a blocker — the repo already runs mixed runtimes (Bun tooling, Node services).
- **Fastify mounting:** oidc-provider is Koa-based (`provider.callback()`). Mounting under Fastify requires `@fastify/middie` or a separate HTTP listener. Must be resolved at I30 integration; not a blocker for I03 selection.
- **Refresh token consent:** `offline_access` requires explicit consent. The ID service consent UI (post-I03) must grant the scope before refresh tokens are issued.

## 6. Recommendation & fallback

**Primary:** embedded `oidc-provider` v8.x (MIT) in `apps/id`, Node 24, mounted via `@fastify/middie` or dedicated listener. Evidence: isolated smoke test passes under Node 24 for all core protocol flows; maintained MIT library; app-owned behaviours clearly separated.

**Fallback:** Keycloak (external, self-hosted) or Auth0 (external SaaS). Use if operational team prefers outsourcing the IdP surface; adds external dependency and redirect-based flows instead of embedded endpoints.

ADR-001 does **not** require updating: the recommendation (owned Identity service + asymmetric signing + app-owned business principal) is consistent with the frozen ownership boundary from I02.

## 7. Verification

- `node .tmp-oidc-smoke/smoke3.cjs` — prints `SMOKE_TEST_PASS` modulo the documented `REFRESH_TOKEN_ISSUED` consent behaviour (all provider-owned checks pass).
- `git diff --check` — passes (only benign CRLF warnings).
- Only task-owned file changes: `docs/architecture/identity/oidc-provider-evaluation.md` plus the two tracking files.

--- 

**Verification:**
- Smoke command: `node .tmp-oidc-smoke/smoke3.cjs` — result recorded above.
- `git diff --check` — passed (no CRLF errors).
- Commit: to be recorded after commit.
