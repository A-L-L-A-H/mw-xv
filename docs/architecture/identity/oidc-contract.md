# Identity OIDC Contract (I04)

- **Plan:** .plan/moonwitness-identity-provider.md
- **Task:** I04 — Define issuer, subject, audience, token and client contracts
- **Depends On:** I02, I03 (both complete)
- **Branch:** dev
- **Context:** Non-production contract only. All URLs use reserved `example.com` / `id.example.com` domains and fake subjects. No production secrets, real client IDs or real tenant data.

## 1. Issuer semantics

- **Issuer URL:** `https://id.example.com` (illustrative non-production; production URL is a deployment configuration input, never invented by an agent).
- Issuer must use HTTPS in any non-local deployment.
- The exact configured issuer value MUST equal the `iss` claim in every issued ID token and access token, and MUST equal the `issuer` field in `/.well-known/openid-configuration` (per I03 recommendation, discovery is provider-built and must not drift from provider configuration).
- API resource-server validation compares `iss` byte-for-byte against a trusted allowlist containing exactly the configured Identity issuer. Any other value is rejected.
- Local development MAY use `http://localhost:<port>`; production MUST NOT.

## 2. Opaque subject format

- **`sub` claim:** opaque, non-guessable Identity-generated identifier (UUIDv4-style string), independent of `base.user.id` (business integer PK) and of `base.partner_id` (CRM FK).
- ADR-001 ownership boundary: `base.user.id` remains the business principal PK; a future `identity_subject` column on `base.user` maps Identity `sub` to the business user. The mapping is authoritative, never resolved by email or login name.
- Example (fake): `sub: "9f1c0e3a-6f0b-4a3e-9c22-0a4b7c6d8e91"`.
- `sub` MUST NOT embed tenant ID, company ID, role, email, login or any structured business value.
- Missing or malformed `sub` → reject with `invalid_token`.

## 3. Audiences and client identifiers

### 3.1 Human OIDC clients (Authorization Code + PKCE S256)

| Client type | Client ID (illustrative, non-production) | Audience (`aud`) | Notes |
|---|---|---|---|
| Board (web app) | `mw-board-client` | `https://api.example.com` | Public client; PKCE S256 required |
| Desktop app | `mw-desktop-client` | `https://api.example.com` | Public client; system browser + validated callback |

- Client IDs are configuration inputs registered in `identity.oauth_client` (I19). The values above are examples only.
- Redirect URIs are exact-match allowlists per client; no wildcards or substring matching.

### 3.2 Machine clients (Client Credentials)

| Client type | Client ID (illustrative, non-production) | Audience (`aud`) | Notes |
|---|---|---|---|
| Service-to-service | `mw-svc-worker` | `https://api.example.com` | Confidential client; secret/verifier in Identity DB |
| Integration job | `mw-svc-sync` | `https://api.example.com` | Confidential client; scopes enforced by API |

- Machine client IDs are configuration inputs registered per ADR-001 §14. Allowed scopes are Identity-registered and re-enforced by API.

### 3.3 Resource server audience

- **`aud` value for API access tokens:** `https://api.example.com` (illustrative).
- API MUST reject any token whose `aud` does not include exactly this configured value.
- ID tokens do not use the API audience.

## 4. Token types

### 4.1 API access token (resource-server token)

**Purpose:** sent by Board/Desktop/machine clients to the API as `Authorization: Bearer <access_token>`.

**Minimum required claims:**

| Claim | Meaning | Validation |
|---|---|---|
| `iss` | Issuer | Must equal the configured Identity issuer exactly |
| `sub` | Opaque Identity subject | Must be present, opaque, resolvable through `identity_subject` |
| `aud` | Audience | Must equal the configured API audience |
| `iat` | Issued-at (Unix seconds) | Within allowable skew (see §6) |
| `exp` | Expiry (Unix seconds) | Must be in the future after skew |
| `jti` | Unique token ID | Required; used for deny-listing/traceability |
| `sid` | Identity session ID | Required for human interactive flows |
| `client_id` | Registered OAuth client | Must match an enabled client |
| `scope` | Space-separated scopes | Present where applicable (machine flows and scoped human flows) |

**Additional constraints:**
- Asymmetric signing only (per I03 recommendation: `oidc-provider` with JWKS; RS256/ES256 supported by provider; algorithm allowlist is strict).
- `kid` header MUST be present and resolve against Identity JWKS.
- Access tokens MUST NOT contain company membership lists, complete model permissions, row-rule grants or any authorisation data (per ADR-001 security requirements). Claims alone never grant business authorization; API re-evaluates business policy.
- For human flows, `scope` includes `openid` and MAY include `offline_access` when the consent UI has explicitly granted it (per I03 evidence).

### 4.2 ID token (OIDC identity token)

**Purpose:** returned to the Board/Desktop client by the Identity provider at the token endpoint after an Authorization Code flow. Consumed by the client, never by the API resource server.

**Minimum required claims:**

| Claim | Meaning | Validation (by client) |
|---|---|---|
| `iss` | Issuer | Must equal configured Identity issuer |
| `sub` | Opaque Identity subject | Stable per end-user |
| `aud` | Client ID | Must equal the client's registered ID |
| `iat` / `exp` | Timing | Within allowable skew |
| `nonce` | Flow-binding value | Must match the value sent in the authorization request |
| `sid` | Identity session ID | Present for interactive flows |
| `azp` | Authorized party | Equals `client_id` |

**Key distinction:** ID token `aud` is the **client ID** (e.g. `mw-board-client`); access token `aud` is the **API audience** (`https://api.example.com`). An ID token sent to the API MUST be rejected even if signed by the same issuer, because `aud` does not match the API audience and the API's verification SDK must not accept tokens carrying client-audience values.

**API MUST NOT use ID tokens as access tokens.** `packages/identity-sdk` (I05/I06+ surface) must validate `aud` strictly and reject ID-token-shaped tokens.

## 5. Token claim ownership vs business authorisation

Per ADR-001:

| Concern | Owner | In token? |
|---|---|---|
| Authentication (`sub`, `sid`, `client_id`) | Identity | Yes |
| Session (`sid`, `jti`) | Identity | Yes |
| Scopes (what the client is allowed to request) | Identity registration + API enforcement | Yes (minimal) |
| Company membership (`CompanyMembership`) | Business DB + API enforcement | **No** |
| Group grants (`GroupMembership`, `ModelAccess`) | Business DB + API enforcement | **No** |
| Row-level record rules | Business DB + API enforcement | **No** |
| Platform Owner capability | Identity (not legacy `system` role) | **No** — not a token claim |

Token claims are an authentication and session statement. Business authorisation is re-evaluated by the API on every request.

## 6. Expiry policy and clock skew

| Token type | Expiry (non-production illustrative) | Notes |
|---|---|---|
| Access token | 15 minutes | Short-lived; asymmetric-signed; API verifies `exp` |
| ID token | 5 minutes | Consumed once by client, never reused |
| Refresh token | 30 days (rolling; rotates on every use per I03) | Replay revokes family |
| Authorization code | 60 seconds | Single-use; bound to client, redirect URI, PKCE challenge, nonce |
| Client-credentials access token | 15 minutes | Machine flows |

- **Allowable clock skew:** ±60 seconds on `iat` / `exp` / `nbf` verification. Any token outside skew is rejected. Skew is a shared SDK configuration value, not per-request.
- Refresh tokens rotate on every use; replay of an already-used refresh token revokes the entire token family and associated session (per I03 evidence and ADR-001).

## 7. Expected validation failure behaviours

The API (via `packages/identity-sdk`) MUST fail closed on each of the following. All failures produce a `401` response without leaking internal detail beyond a generic `invalid_token` / `unauthorized` error unless otherwise noted.

| Condition | Expected API behaviour |
|---|---|
| Disabled Identity account | Reject. Even if the token is cryptographically valid and unexpired, `sub` resolution must confirm the account is enabled. |
| Missing business principal (`identity_subject` not mapped to `base.user`) | Reject. The API does not auto-provision a business user from token claims; provisioning is event-driven (ADR-001 §12). |
| Invalid audience (missing/wrong `aud`) | Reject. Applies equally to ID tokens sent to the API (client-audience ≠ API-audience). |
| Untrusted issuer (`iss` not in allowlist) | Reject. Never treat an unknown issuer as valid even with a valid signature. |
| Unknown `kid` (JWKS key ID not found) | Reject. The client SHOULD trigger a JWKS refresh; the API does not trust the token until the key resolves. |
| JWKS unavailable | Reject (fail closed). No graceful fallback to unsigned/older keys. |
| Signature verification failure | Reject. |
| Expired token | Reject. |
| Algorithm outside allowlist | Reject. |
| ID token presented to API | Reject (audience mismatch; ID token is not an access token). |
| Replay of a used refresh token | Identity revokes the affected family/session; API rejects downstream requests on invalid/missing tokens. |
| Missing required claim (`sub`, `jti`, `sid`, `client_id`) | Reject. |

Failures are generic; they do not distinguish between "account disabled", "principal missing" and "audience wrong" in responses sent to the client, to avoid account-state enumeration.

## 8. Illustrative non-production examples

### 8.1 Human access token (decoded claims — fake values)

```json
{
  "iss": "https://id.example.com",
  "sub": "9f1c0e3a-6f0b-4a3e-9c22-0a4b7c6d8e91",
  "aud": "https://api.example.com",
  "iat": 1735305600,
  "exp": 1735306500,
  "jti": "at-01-example-0001",
  "sid": "sess-example-0001",
  "client_id": "mw-board-client",
  "scope": "openid offline_access"
}
```

### 8.2 ID token (decoded claims — fake values)

```json
{
  "iss": "https://id.example.com",
  "sub": "9f1c0e3a-6f0b-4a3e-9c22-0a4b7c6d8e91",
  "aud": "mw-board-client",
  "iat": 1735305600,
  "exp": 1735305900,
  "nonce": "nonce-example-0001",
  "sid": "sess-example-0001",
  "azp": "mw-board-client"
}
```

### 8.3 Machine access token (decoded claims — fake values)

```json
{
  "iss": "https://id.example.com",
  "sub": "svc-0e3a6f0b-4a3e-9c22-0a4b7c6d8e91",
  "aud": "https://api.example.com",
  "iat": 1735305600,
  "exp": 1735306500,
  "jti": "cc-01-example-0001",
  "client_id": "mw-svc-worker",
  "scope": "telemetry.read"
}
```

All subjects, IDs, domains, tokens and secrets shown are illustrative non-production values. Real production values are configuration inputs.

## 9. Traceability to ADR-001

| Contract item | ADR-001 anchor |
|---|---|
| Issuer URL is a deployment input, not invented | §Open decisions ("exact production issuer URL ... are configuration inputs") |
| Opaque `sub`, independent of `base.user.id` | §Decision 4 |
| `identity_subject` mapping on `base.user` | §Decision 4, §Ownership matrix |
| Never auto-link by email | §Security requirements |
| API audience / strict issuer / JWKS / `kid` validation | §Decision 10, §Security requirements |
| Machine clients via Client Credentials | §Decision 14 |
| Board/Desktop public clients + PKCE | §Decision 9 |
| Company/tenant/model authorisation re-evaluated by API, not from claims | §Decision 6, §Security requirements |
| Refresh rotation + replay revokes family | §Security requirements; I03 smoke evidence |
| Short expiry, minimal claims | §Security requirements |
| Fail closed on issuer/JWKS/principal resolution | §Security requirements |
| No implicit Platform Owner bypass | §Decision 13 |

## 10. Verification

- `git diff --check` — passed.
- Every claim in §4.1 and §4.2 is manually traced to an ADR-001 anchor in §9.
- Owner file changed only: `docs/architecture/identity/oidc-contract.md` plus the two tracking files.

---

**Evidence:**
- Command: git diff --check - passed
- Manual verification: every access-token and ID-token claim traced to ADR-001 (§9).
- Commit: to be recorded after commit.
