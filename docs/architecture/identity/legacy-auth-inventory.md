
# Legacy Authentication Surface Inventory

- **Plan:** .plan/moonwitness-identity-provider.md
- **Task:** I01
- **Branch:** dev (commit 2017763530bbdfd23531113fa50784aeba5934ad)
- **Context:** Read-only audit; no runtime changes.

## 1. Human Authentication Entry Points (API-owned)

| Endpoint | Method | File | Owner | Evidence |
|---|---|---|---|---|
| /auth/register | POST | apps/api/src/routes/auth.routes.ts:34 | API | Self-service sign-up; creates role user, partner, company membership, default group |
| /auth/login | POST | apps/api/src/routes/auth.routes.ts:89 | API | Exchanges login+password for access+refresh token (HS256 JWT) |
| /auth/refresh | POST | apps/api/src/routes/auth.routes.ts:134 | API | Rotates refresh token; issues new access+refresh pair |
| /auth/logout | POST | apps/api/src/routes/auth.routes.ts:172 | API | Revokes refresh token family |
| /auth/me/password | PATCH | apps/api/src/routes/auth.routes.ts:184 | API | Change password; revokes all sessions |
| /auth/me | GET | apps/api/src/routes/auth.routes.ts:213 | API | Current user profile |
| /auth/me/preferences | PATCH | apps/api/src/routes/auth.routes.ts:235 | API | Update language/timezone |
| /auth/me/profile | PATCH | apps/api/src/routes/auth.routes.ts:270 | API | Update partner contact details |
| /auth/setup-status | GET | apps/api/src/routes/auth.routes.ts:300 | API | Checks if first-boot setup required (MW_SETUP_TOKEN env) |
| /auth/setup-claim | POST | apps/api/src/routes/auth.routes.ts:330 | API | Claims seeded superadmin account using setup token |

**Token issuance:** API signs HS256 JWTs with JWT_SECRET (shared secret) — apps/api/src/plugins/auth.plugin.ts:137.
**Token verification:** API verifies HS256 JWTs with same JWT_SECRET — apps/api/src/plugins/auth.plugin.ts:138.

## 2. Credential & Session Logic (packages/auth)

| Component | File | Responsibility |
|---|---|---|
| createAuthService | packages/auth/src/service.ts:70 | Register, login, claimSuperadminSetup, changePassword, refresh, logout, revokeAllForUser, revokeAllSessions |
| RefreshToken model | packages/auth/src/refresh-token.ts | Opaque refresh token storage (hash, family, expiry, revocation, rotation lease) |
| Password hashing | @moonwitness/orm import (hashPassword, verifyPassword) | scrypt-based; MIN_PASSWORD_LENGTH=8, MAX_PASSWORD_LENGTH=128 |
| dummyHash precomputation | packages/auth/src/service.ts:95 | Timing-safe unknown-login responses |

**Direct evidence:** All credential verification, session issuance, and token rotation live in packages/auth/src/service.ts.

## 3. Service Token Authority (Machine Identity — packages/auth)

| Component | File | Notes |
|---|---|---|
| ServiceTokenAuthority | packages/auth/src/service-tokens.ts:283 | HMAC-SHA256 (HS256) token issuer/verifier with kid rotation and grace window |
| SigningKeyRecord | packages/auth/src/service-tokens.ts:8 | secret (string/Uint8Array), createdAtMs, optional graceExpiresAtMs, revoked |
| IssueServiceTokenInput / VerifyServiceTokenOptions | packages/auth/src/service-tokens.ts:21 | Claims: sub, iss, aud, scopes[], iat, nbf, exp, jti |
| evaluateRbacScopes | packages/auth/src/service-tokens.ts:153 | Deny-by-default scope evaluator with ! deny patterns and * wildcards |

**Runtime wiring:** ServiceTokenAuthority is instantiated in API startup (not shown here) and used for service-to-service tokens. It shares no secret with human JWT signing. Owner-provided context: The human JWT uses JWT_SECRET; service tokens use a separate ServiceTokenAuthority key set.

## 4. Business Principal & CRM Models (packages/orm-base)

| Model | Table | Key Fields | File |
|---|---|---|---|
| User | users | id (int PK), login (unique), password, partner_id (unique FK), role enum(system/superadmin/user), token_version, language_id, timezone | packages/orm-base/src/models/user.ts |
| Partner | partners | id (int PK), name, email (unique), company_id FK, is_company, is_customer, is_supplier | packages/orm-base/src/models/partner.ts |
| CompanyMembership | company_memberships | user_id, company_id, is_default; unique(user,company) | packages/orm-base/src/models/company-membership.ts |
| AccessGroup | access_groups | code (unique), name | packages/orm-base/src/models/access-group.ts |
| GroupMembership | group_memberships | user_id, group_id; unique(user,group) | packages/orm-base/src/models/access-group.ts |
| ModelAccess | model_access | group_id, model_name (pattern), read/create/write/unlink booleans | packages/orm-base/src/models/access-group.ts |

**Role enum:** system, superadmin, user — defined in both packages/auth/src/service.ts:16 and packages/orm-base/src/models/user.ts:18.

**Direct evidence:** User.password field exists and is used for login; token_version embedded in JWT as tkv claim for cross-replica invalidation (apps/api/src/plugins/auth.plugin.ts:101).

## 5. Authorization Policy (API)

| Component | File | Behavior |
|---|---|---|
| canAccess | apps/api/src/auth/policy.ts:78 | Role-based: system/superadmin full access; user read-only or group-granted |
| INTERNAL_PREFIXES | apps/api/src/auth/policy.ts:32 | Blocks auth.*, base.job, base.cron, base.outbox_event, workflow.*, knowledge.*, ai.* |
| ADMIN_ONLY_MODELS | apps/api/src/auth/policy.ts:39 | base.user, base.audit_log, base.access_group, base.group_membership, base.model_access, base.company_membership, base.partner_bank |
| ADMIN_ROLES | apps/api/src/auth/policy.ts:46 | system, superadmin |
| canManageBaseUser | apps/api/src/auth/policy.ts:183 | Only system can create/promote to system role |
| sanitizeClientContext | apps/api/src/auth/policy.ts:149 | Strips trx, activeTest; overwrites userId, role, companyId, partnerId from auth |

## 6. Auth Plugin & Cache (API)

| Component | File | Notes |
|---|---|---|
| authPlugin | apps/api/src/plugins/auth.plugin.ts:186 | Registers @fastify/jwt (HS256), global guard hook, cache with PG NOTIFY invalidation |
| AUTH_INVALIDATING_MODELS | apps/api/src/plugins/auth.plugin.ts:28 | Triggers cache invalidation on write |
| Cache TTL | DEFAULT_AUTH_CACHE_TTL_MS=5000 | apps/api/src/plugins/auth.plugin.ts:64 |
| Public routes | isPublic() | apps/api/src/plugins/auth.plugin.ts:172 — includes all /auth/* entry points |

## 7. Startup Checks & Seeded Accounts (API)

| Check | File | Evidence |
|---|---|---|
| verifyDefaultBaseAccounts | apps/api/src/startup-checks.ts:7 | Requires base.user_system (role system) and base.user_superadmin (role superadmin) seeded via _orm_data |
| requireAdminPassword flag | apps/api/src/startup-checks.ts:33 | If true, superadmin must have password set via SUPERADMIN_PASSWORD env |
| verifyRequiredModels | apps/api/src/startup-checks.ts:46 | Requires base.user, base.partner, base.company |

**Direct evidence:** System/superadmin accounts are seeded, not created through registration. base.user_superadmin starts with password: null and is claimed via /auth/setup-claim.

## 8. Ownership Summary (Human vs Business vs Machine)

| Capability | Current Owner | Plan Target Owner |
|---|---|---|
| Human credentials (password, login) | packages/auth + API routes | apps/id (Identity DB) |
| Human sessions (refresh tokens) | packages/auth (RefreshToken model) | apps/id |
| Token signing (human access tokens) | API (HS256 JWT_SECRET) | apps/id (asymmetric) |
| Token verification (human) | API (HS256 JWT_SECRET) | apps/api (via identity-sdk, JWKS) |
| Business principal (base.user) | Business DB (orm-base) | Business DB (unchanged) |
| CRM contact (base.partner) | Business DB (orm-base) | Business DB (unchanged) |
| Tenant membership | Business DB (CompanyMembership) | Business DB (unchanged) |
| Group/model grants | Business DB (GroupMembership, ModelAccess) | Business DB (unchanged) |
| Machine identity (service tokens) | packages/auth (ServiceTokenAuthority) | apps/id (OAuth Client Credentials) |
| Machine token verification | packages/auth (ServiceTokenAuthority) | apps/api (via identity-sdk, JWKS) |

## 9. Database Emptiness

**Owner-provided context:** The repository owner confirms the deployment databases are empty. This is not independently inspected production fact. No user-data backfill is planned; clean schema migrations only.

## 10. Gaps & Risks for Migration

1. Shared HS256 secret: API both signs and verifies human JWTs. Must migrate to asymmetric keys owned by Identity.
2. Coupled credential logic: packages/auth is used by API for login/register/refresh. Must extract to apps/id.
3. Superadmin bootstrap: /auth/setup-claim uses MW_SETUP_TOKEN env. Must become one-time CLI-issued bootstrap token in apps/id.
4. Service tokens: ServiceTokenAuthority uses HS256. Must migrate to OIDC Client Credentials in apps/id.
5. No OIDC provider: No discovery, JWKS, authorization code, or PKCE endpoints exist today.
6. No Identity database: Separate IDENTITY_DATABASE_URL and migrations do not exist.
7. No identity_subject mapping: base.user has no column linking to OIDC sub claim.

---

**Verification:**
- git diff --check passes (no runtime changes).
- All cited paths manually opened and confirmed current.

