# Identity Security Model (I05)

- **Plan:** .plan/moonwitness-identity-provider.md
- **Task:** I05 — Define the threat model and Platform/Tenant authorization boundary
- **Depends On:** I02 (complete; contract-level, no runtime changes)
- **Branch:** dev
- **Context:** Non-production threat model. All client IDs, URLs, tenant names and secret examples are illustrative. Uses reserved `example.com` domains only.

## 1. Actor types and privilege boundaries

Four distinct actor types exist. No actor type implies any other actor type, and no actor type implies a global all-powerful bypass.

| Actor type | Authenticated as | Primary capability | Explicitly does NOT get |
|---|---|---|---|
| **Platform Owner** | Identity account flagged as Platform Owner | Explicit platform operations (see §1.1) | Read/write of tenant business records; implicit tenant membership |
| **Tenant Admin** | Identity account + `CompanyMembership.is_admin = true` for one tenant | Admin operations within that tenant's records | Access to other tenants; platform operations |
| **Regular User** | Identity account + non-admin `CompanyMembership` | Business operations within allowed groups/model grants | Cross-tenant access; admin operations |
| **Service Principal** | OAuth Client Credentials machine client | Explicitly-scoped machine-to-machine operations | Human session features (MFA, password, refresh-family) |

### 1.1 Platform Owner capability boundary

Platform Owner is an **Identity-level capability** (per ADR-001 §13), not an implicit global superadmin. It grants explicit platform operations only:

| Capability | Scope |
|---|---|
| View/list registered OAuth clients | Identity DB |
| Register/disable OAuth clients | Identity DB |
| View/list Identity accounts and enable/disable them | Identity DB |
| View signing-key metadata (public JWKs) | Identity DB |
| Rotate signing keys | Identity DB |
| View identity lifecycle events | Identity outbox |
| Trigger re-provisioning events | Identity outbox |

Platform Owner **does NOT** include:

- Read/write of any tenant's business records (`base.user`, `base.partner`, tenant-specific rows).
- Implicit tenant membership in any company.
- Bypass of tenant row rules, group grants, or model access.
- Access to Business DB directly.
- Ability to read tenant data through platform tooling that uses a Business DB connection.

Platform Owner operations run against the Identity DB; tenant business operations run against the Business DB. These are different security contexts enforced at different layers.

## 2. Fail-closed behaviour

When Identity verification, JWKS retrieval or business-principal mapping is unavailable, the API fails closed. "Fail closed" means the request is rejected with a generic `401`/`403` and never allowed to proceed on the assumption that a previously-cached identity or a stale-but-valid token is trustworthy.

| Condition | Behaviour |
|---|---|
| Identity JWKS endpoint unreachable | Reject all bearer-token requests (do not use cached JWKS beyond a short, bounded cache window; beyond that window, fail closed). |
| JWKS returned but no matching `kid` | Reject. Optionally trigger a single refresh attempt; if still missing, reject. |
| Identity token validation service unavailable | Reject. |
| `identity_subject` → `base.user` mapping not found | Reject. API does not auto-provision business principals from token claims; provisioning is event-driven (ADR-001 §12). |
| Mapped business user is disabled in Business DB | Reject. |
| Identity account is disabled in Identity DB | Reject. |
| Business DB unreachable for principal resolution | Reject. Business authorization cannot be evaluated without the principal; do not proceed on token claims alone. |

Failures are generic and do not leak account state to the caller. All failures produce a log entry (see §4).

## 3. Threat model

Each threat has at least one concrete control and a future test scenario.

### 3.1 Bootstrap abuse

**Threat:** An attacker discovers or guesses the one-time setup secret and claims the first Platform Owner before the legitimate operator.

**Controls:**
- Setup secret is a high-entropy value issued by an operator CLI/installer.
- Secret is stored only as a verifier/hash in Identity DB, never in plaintext or logs.
- Consumed atomically; disabled after first successful Platform Owner creation.
- Single-use, time-boxed (expiry after issuance).
- Rate-limit setup-claim attempts.

**Test scenario (future):** Attempt to claim setup secret twice; second attempt fails. Attempt to claim after expiry; fails. Attempt with wrong value; fails with generic error and does not leak whether the secret exists.

### 3.2 Credential stuffing

**Threat:** Bulk automated login attempts against known/breached password lists.

**Controls:**
- Login rate-limiting per IP, per login identifier and globally.
- Timing-safe unknown-login responses (existing `dummyHash` pattern).
- No account-enumeration signal in the response body (`invalid credentials` regardless of whether the login exists).
- Optional MFA for accounts with elevated privilege (Tenant Admin/Platform Owner).
- Optional CAPTCHA or progressive delay after repeated failures.

**Test scenario (future):** N failed logins from one IP within a window → rate-limit response. Timing difference between existing/unknown login is below a threshold. Response body is identical for existing/unknown login.

### 3.3 Session theft

**Threat:** An attacker steals an Identity session cookie or access token and impersonates the user.

**Controls:**
- Short access-token TTL (15 minutes illustrative, per I04).
- Refresh tokens rotate on every use; replay revokes the family (per I03 smoke evidence).
- Session cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax/Strict`, scoped to the Identity host.
- Identity session records include IP/UA metadata; unusual changes trigger re-authentication.
- Logout invalidates the Identity session and all refresh families bound to it.

**Test scenario (future):** Reuse an already-used refresh token → family revoked, all subsequent refresh attempts fail. Logout revokes all families. Cookie flags are set on all Identity responses.

### 3.4 Refresh replay

**Threat:** An attacker reuses a previously-consumed refresh token to obtain new access tokens.

**Controls:**
- Refresh tokens rotate on every use.
- Replay of a used refresh token revokes the entire token family and associated Identity session.
- Detection is atomic in Identity DB (single refresh-consumption transaction).
- Audit/log entry on replay detection.

**Test scenario (future):** Two concurrent refresh attempts with the same token → exactly one succeeds; the other causes family revocation. All subsequent requests with any token from that family fail.

### 3.5 Token substitution

**Threat:** An attacker presents an ID token (or a token from another issuer/client) to the API as an access token.

**Controls:**
- API access-token validation requires `aud` = API audience (per I04); ID tokens carry client `aud` and are rejected.
- `iss` must be in the trusted issuer allowlist; no other issuer accepted.
- `client_id` must match an enabled registered client.
- Required claim set (`iss`, `sub`, `aud`, `iat`, `exp`, `jti`, `sid`, `client_id`) must all be present and valid.
- Signature must verify against Identity JWKS; algorithm allowlist is strict.

**Test scenario (future):** ID token sent to API → rejected. Token from a different issuer → rejected. Token signed with an untrusted key → rejected. Token missing any required claim → rejected.

### 3.6 Key compromise

**Threat:** Identity signing-key material is leaked or stolen.

**Controls:**
- Private signing keys never leave the Identity security boundary (per ADR-001 §10).
- Key-provider interface in `apps/id`; no local dev keys silently selected in production.
- Key rotation supported via JWKS; old keys retained in JWKS for a grace window.
- Key metadata (public JWKs) exposed via `/jwks`; private keys never.
- On suspected compromise: rotate immediately, revoke affected sessions, publish new JWKS.

**Test scenario (future):** After rotation, new tokens use new `kid`; old tokens fail once old `kid` is removed after grace window. `/jwks` never exposes private key material.

### 3.7 Redirect manipulation

**Threat:** An attacker tricks a user into authorizing a redirect to an attacker-controlled URL.

**Controls:**
- Exact-match redirect URI allowlists per client; no wildcards or substring matching.
- Registered at client-provisioning time (I19); changes require explicit Identity-admin action.
- PKCE S256 binds the code to the original request (per I03 evidence).
- `state` parameter is required and validated by the client on return.
- No open redirect on any Identity endpoint.

**Test scenario (future):** Authorization request with an unregistered redirect URI → rejected. Request with a substring/wildcard-style match → rejected. Wrong `state` on callback → client rejects.

### 3.8 Account enumeration

**Threat:** An attacker determines whether a login/email exists without knowing the password.

**Controls:**
- Registration, password reset and login error responses are generic and identical for existing/unknown identities.
- Timing-safe comparison for login existence (`dummyHash` precomputation).
- No user-existence signal in HTTP status, body or log content returned to the caller.
- Rate-limit identity-lookup endpoints.

**Test scenario (future):** Response bodies and timing for existing vs unknown login are indistinguishable. No 404-vs-400 difference that signals existence.

### 3.9 Cross-tenant access

**Threat:** A user in tenant A gains read/write access to tenant B's business records.

**Controls:**
- `x-company-id` header is never treated as membership proof (per ADR-001).
- API re-evaluates `CompanyMembership` for the requested company on every request.
- Row-level record rules are applied per-request in the Business DB layer.
- Token claims alone never grant tenant access.
- No implicit Platform Owner bypass of tenant row rules.

**Test scenario (future):** User in tenant A requests tenant B resources with `x-company-id` set to B → rejected. User removes the header → default-company scoping only. Platform Owner making tenant-scoped requests → rejected (not a member).

### 3.10 Forged provisioning events

**Identity publishes lifecycle events (account created/disabled, credentials changed).** A forged event could create or disable business principals without corresponding Identity state.

**Controls:**
- Events are published from Identity DB transactional outbox only.
- API consumes events idempotently; event ID is unique per outbox row.
- Consumer verifies event source (outbox row in the shared deployment, or signed event envelope if cross-service).
- No external entry point can insert events into the outbox.
- Outbox insert requires Identity DB credentials (separate from Business DB credentials).

**Test scenario (future):** Duplicate event delivery → idempotent (no double provisioning). Event with unknown `sub` → rejected. Direct outbox insert from Business DB credentials → fails (separate credentials).

## 4. Security logging and secret-redaction rules

### 4.1 What is logged

| Event | Log content |
|---|---|
| Login success | `sub`, `client_id`, `sid`, IP, UA, timestamp |
| Login failure | Attempted login identifier, IP, UA, timestamp; NO password, NO account-state detail |
| Refresh use/rotation | `sub`, `sid`, `jti`, timestamp |
| Refresh replay detection | `sub`, `sid`, timestamp; family/session revoked |
| Setup secret claim | Timestamp, IP; NO secret value |
| Access-token verification failure | Reason category (aud/iss/sig/exp), `jti` if present, timestamp; NO token value |
| Provisioning event consumed | Event ID, `sub`, timestamp, outcome |
| Key rotation | `kid`, timestamp; NO private key material |

### 4.2 Secret-redaction rules

The following MUST be redacted from all logs, errors, telemetry, snapshots and monitoring data. Redaction applies at the logging layer before emission.

| Field | Redaction form |
|---|---|
| Password | Never logged in any form |
| Setup secret | Never logged in any form |
| Access token | `[REDACTED_ACCESS_TOKEN]` or entirely omitted |
| Refresh token | `[REDACTED_REFRESH_TOKEN]` or entirely omitted |
| MFA secret | Never logged in any form |
| Connection URL (DB/Redis/etc.) | Redact userinfo/credentials; keep host/port/database |
| Private-key material | Never logged in any form |
| Authorization header | `[REDACTED_AUTHORIZATION]` |
| Cookie header | `[REDACTED_COOKIE]` |

### 4.3 Testability of redaction rules

The rules in §4.2 are testable by:

1. **Unit tests** on the logging utility that confirm each redacted field never appears in output.
2. **Integration tests** that trigger login failure, token verification failure and refresh replay, then assert no redacted value appears in captured logs.
3. **Snapshot/telemetry review** that confirm no redacted value appears in error reports or monitoring data.

These are future test cases (not part of I05); they are listed as the concrete testable expectation for the redaction rules.

## 5. Explicit non-goals / rejected patterns

- **No all-powerful admin shortcut:** Platform Owner does not bypass tenant row rules or group grants.
- **x-company-id is never proof of membership:** membership is verified per-request from CompanyMembership.
- **No implicit global superadmin:** the legacy `system` role is not carried into the Identity model as a bypass.
- **No auto-linking by email:** Identity → business user linkage is via explicit `identity_subject` mapping only.
- **No authorisation claims in tokens:** business authorisation is re-evaluated per-request by the API.
- **No graceful degradation to unsigned/older keys:** verification failure is a hard reject.

## 6. Verification

- `git diff --check` — passed.
- All 10 listed threats (§3.1–§3.10) have at least one concrete control and a future test scenario.
- Actor types and privilege boundaries are explicit (§1, §1.1).
- Fail-closed behaviour is defined for Identity verification, JWKS and principal-mapping unavailability (§2).
- Secret-redaction rules are explicit and testable (§4.2, §4.3).

---

**Evidence:**
- Command: git diff --check - passed
- Manual verification: each threat/control pair reviewed against ADR-001 security requirements.
- Commit: to be recorded after commit.
