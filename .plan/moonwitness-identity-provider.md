# Plan: MoonWitness Identity Provider & Authentication Clean Cutover

- **Plan ID:** moonwitness-identity-provider
- **ADR:** .plan/moonwitness-identity-provider/ADR-001-identity-provider.md
- **Micro-tasks:** 79 total (I01–I79), sized XS/S for low-cost coding agents
- **Target branch:** dev
- **Execution mode:** one task per cycle, serial dependency order
- **Repository baseline inspected:** dev commit 2017763530bbdfd23531113fa50784aeba5934ad
- **End state:** apps/id is the single human Identity Provider; Board and Desktop use OIDC; API verifies identity and owns business authorization; legacy credential authentication is removed.

## 1. Goal and ownership boundaries

Build one central identity service without creating a second business-user registry.

| Area | Owner | Responsibilities |
|---|---|---|
| Human identity | apps/id | Accounts, identifiers, password credentials, login, sessions, refresh-token families, OIDC, signing-key lifecycle, MFA and recovery |
| Identity persistence | packages/orm-identity | Models and migrations used only by apps/id against the Identity database |
| Identity client/verifier SDK | packages/identity-sdk | OIDC client helpers and resource-server token verification; no credentials or private keys |
| Business principal | base.user in Business DB | Local application identity mapped from opaque OIDC sub; preserve existing integer primary key |
| Business contact | base.partner | CRM/contact/profile record; not the login credential authority |
| Business authorization | apps/api + Business DB | CompanyMembership, AccessGroup, GroupMembership, ModelAccess and record rules |
| Resource server | apps/api | Verify tokens, resolve business principal, enforce business authorization |
| User applications | Board and Desktop | OIDC clients; never implement a separate password/session system |

**Core rule:** Identity answers who the person is. The API answers what that person may do in a company and on a business record.

## 2. Assumptions and explicit non-goals

- The repository owner confirms the deployment databases are empty. Treat this as owner-provided context, not an independently inspected production fact.
- Do not create user-data migration or email-based account matching tasks. Create clean, reproducible schema migrations instead.
- Identity and Business data live in separate databases with separate credentials. They may initially share one PostgreSQL server.
- Do not replace base.user.id or business foreign keys.
- Do not duplicate Partner or move all company/model/row permissions into Identity.
- Do not implement OAuth/OIDC state machines, JOSE primitives or cryptography by hand. Select and use a maintained provider implementation.
- Do not share an HS256 signing secret between ID and API.
- Do not map Platform Owner to the old system/superadmin roles or preserve their global data bypass.
- Do not remove old routes, fields, seeds or packages until replacement behavior is tested and cutover tasks are reached.
- Do not invent production hostnames, email settings, secrets, key stores or OAuth redirect URIs.

## 3. Autonomous agent protocol — read before every cycle

1. Read this master plan, then only the single Wave Playbook that owns the first unchecked task whose dependencies are all checked.
2. Execute exactly one micro-task per cycle. Never run two agents on this plan concurrently.
3. Read only the task-owned files, their direct imports/types and the smallest relevant tests/configuration. Do not load the whole repository.
4. Edit only the listed Owner File(s). If another file is required, stop and create a follow-up task rather than silently widening scope.
5. Follow Exact Spec. Reuse existing repository patterns and dependencies before introducing new ones.
6. Run every Verify command. If a script name is unavailable, inspect the owning package scripts and record the exact valid replacement; never claim a skipped check passed.
7. Mark a task [x] only after every Acceptance Criterion and verification passes. Add a concise evidence note (test command, result, and commit SHA) to the owning Wave Playbook.
8. Update the matching checkbox in both this master checklist and the owning Wave Playbook.
9. Commit only the task-owned implementation/tests plus the two tracking files. Never use git add -A, force push, --no-verify, or push to main. Push dev only through the repository's approved workflow; if rejected, stop and report the exact blocker.
10. Keep each task small. No opportunistic cleanup, formatting of unrelated files, broad renaming, API redesign or speculative dependency upgrades.
11. Never log or commit passwords, bootstrap tokens, refresh tokens, private keys, MFA secrets, database URLs with credentials or real customer data. Use generated test fixtures only.
12. A security-sensitive task must add negative tests, not only a happy-path test.
13. If a predecessor is blocked, do not skip it. Record the blocker and choose another task only when its dependency graph allows it.
14. All work is serial even when tasks look independent. This prevents two inexpensive agents from changing shared integration points at once.

## 4. Dependency waves and ownership

| Wave | Playbook | Tasks | Main ownership |
|---|---|---:|---|
| 0 — Architecture contracts | wave-0-architecture-contracts.md | I01–I06 | docs/architecture/identity and ADR |
| 1 — Identity foundation | wave-1-identity-foundation.md | I07–I21 | packages/orm-identity and apps/id foundation |
| 2 — Bootstrap and login | wave-2-bootstrap-and-login.md | I22–I29 | apps/id bootstrap and auth |
| 3 — OIDC provider | wave-3-oidc-provider.md | I30–I40 | apps/id OIDC adapter and protocol tests |
| 4 — Business provisioning | wave-4-business-provisioning.md | I41–I49 | orm-base and API provisioning boundary |
| 5 — API auth and authorization | wave-5-api-auth-and-authorization.md | I50–I59 | identity-sdk and API auth |
| 6 — Clients and deployment | wave-6-clients-and-deployment.md | I60–I67 | Board, Desktop and deployment |
| 7 — Machine identity and cutover | wave-7-hardening-and-cutover.md | I68–I79 | machine principals, hardening and legacy removal |

Task dependencies are declared inside each playbook. Follow them exactly; the first unchecked task is not automatically runnable unless its dependencies are done.

## 5. Master micro-task checklist

### Wave 0 — Architecture contracts
- [x] **I01** — Re-verify the existing authentication surface and write a source-backed legacy inventory
- [x] **I02** — Freeze Identity vs Business User ownership in ADR-001
- [ ] **I03** — Evaluate and select a maintained OIDC Provider implementation
- [ ] **I04** — Define issuer, subject, audience, token and client contracts
- [ ] **I05** — Define the threat model and Platform/Tenant authorization boundary
- [ ] **I06** — Create the acceptance matrix and architecture exit gate

### Wave 1 — Identity foundation
- [ ] **I07** — Scaffold packages/orm-identity
- [ ] **I08** — Add ORM package exports, tests and build checks
- [ ] **I09** — Scaffold apps/id service entry point
- [ ] **I10** — Add strict Identity environment/config validation
- [ ] **I11** — Add a dedicated Identity PostgreSQL connection
- [ ] **I12** — Add liveness and readiness endpoints
- [ ] **I13** — Add deterministic Identity migration runner
- [ ] **I14** — Add identity.account model and migration
- [ ] **I15** — Add identity.identifier model and uniqueness constraints
- [ ] **I16** — Add identity.credential and password-hash adapter
- [ ] **I17** — Add identity.session model and expiry indexes
- [ ] **I18** — Add refresh-token family persistence and revocation state
- [ ] **I19** — Add OAuth client registry model
- [ ] **I20** — Add authorization-code persistence adapter only where provider integration requires it
- [ ] **I21** — Add Identity audit-event and transactional-outbox models

### Wave 2 — Bootstrap and login
- [ ] **I22** — Add operator CLI for one-time bootstrap-token issuance
- [ ] **I23** — Add bootstrap-state service and setup-status endpoint
- [ ] **I24** — Add atomic first Platform Owner creation service
- [ ] **I25** — Add single-use bootstrap claim endpoint
- [ ] **I26** — Add the minimal first-install setup page
- [ ] **I27** — Add password verification and login-session service
- [ ] **I28** — Add login, current-session and logout routes
- [ ] **I29** — Add login throttling and brute-force regression tests

### Wave 3 — OIDC provider
- [ ] **I30** — Publish and verify OIDC discovery metadata
- [ ] **I31** — Validate OAuth client registration and redirect URI allowlists
- [ ] **I32** — Validate authorization requests and state/nonce requirements
- [ ] **I33** — Enforce PKCE S256 for public clients
- [ ] **I34** — Bind authorization codes to client, redirect, PKCE and nonce
- [ ] **I35** — Add asymmetric signing-key provider abstraction
- [ ] **I36** — Publish JWKS and active public keys
- [ ] **I37** — Complete Authorization Code token exchange
- [ ] **I38** — Complete refresh rotation and replay-family revocation
- [ ] **I39** — Complete logout and server-side session revocation
- [ ] **I40** — Add full OIDC protocol integration tests

### Wave 4 — Business-user provisioning
- [ ] **I41** — Add opaque identity_subject mapping to base.user
- [ ] **I42** — Add API repository to resolve verified subject to business user
- [ ] **I43** — Define a versioned Identity-to-Business event contract
- [ ] **I44** — Publish account lifecycle events through Identity outbox
- [ ] **I45** — Consume provisioning events idempotently in API
- [ ] **I46** — Provision/link base.partner as a business contact only
- [ ] **I47** — Provision least-privilege company membership and user group
- [ ] **I48** — Synchronize account disable/reactivate state
- [ ] **I49** — Add retry/dead-letter visibility and a safe repair command

### Wave 5 — API authentication and authorization
- [ ] **I50** — Scaffold packages/identity-sdk
- [ ] **I51** — Implement strict issuer/audience/JWKS access-token verifier
- [ ] **I52** — Implement strict Identity access-token verification for API
- [ ] **I53** — Resolve verified token subject to the local business principal
- [ ] **I54** — Preserve auth-cache invalidation and revocation behavior
- [ ] **I55** — Remove implicit global system/superadmin data bypass
- [ ] **I56** — Refactor current-user profile and preference endpoints
- [ ] **I57** — Remove API-owned human login/register/password routes
- [ ] **I58** — Remove API runtime wiring to the legacy credential auth service
- [ ] **I59** — Add tenant and authorization regression coverage

### Wave 6 — Clients and deployment
- [ ] **I60** — Register Board as an OIDC public client
- [ ] **I61** — Implement Board Authorization Code + PKCE callback
- [ ] **I62** — Implement Board server-side session, renewal and logout
- [ ] **I63** — Register Desktop as an OIDC public client
- [ ] **I64** — Implement Desktop system-browser login with PKCE
- [ ] **I65** — Implement Desktop callback, token lifecycle and logout
- [ ] **I66** — Add Identity service and separate Identity database to deployment
- [ ] **I67** — Prove clean first installation end to end

### Wave 7 — Machine identity, hardening and final cutover
- [ ] **I68** — Add machine Service Principal model
- [ ] **I69** — Implement OAuth Client Credentials for machine clients
- [ ] **I70** — Enforce explicit scopes for machine principals in API
- [ ] **I71** — Implement signing-key rotation and overlap window
- [ ] **I72** — Add TOTP credential persistence and crypto boundary
- [ ] **I73** — Add MFA enrollment and challenge flows
- [ ] **I74** — Add account recovery and email-verification provider contracts
- [ ] **I75** — Evaluate WebAuthn/passkey support and record rollout decision
- [ ] **I76** — Remove default system/superadmin seeds and startup dependency
- [ ] **I78** — Remove legacy auth package/runtime and obsolete service-token wiring
- [ ] **I77** — Remove credential ownership and obsolete role fields from base.user
- [ ] **I79** — Run final security audit, update runbooks and close the plan

## 6. MVP gates

- **Foundation:** I01–I21. Identity service builds and owns its separate persistence.
- **First login:** I22–I40. Fresh install can create the first owner and authenticate clients with OIDC.
- **Business integration:** I41–I59. API can resolve an Identity subject and enforce tenant/business authorization.
- **First usable cutover:** I60–I67. Board and Desktop use ID; a clean installation passes end-to-end tests.
- **Post-MVP security:** I68–I75. Machine identity, MFA, recovery and passkey decision.
- **Final cleanup:** I76–I79. Remove legacy credentials only after the replacement is proven.

## 7. Global DO NOT list

- DO NOT edit docs/tasks/tasks.json or generated TaskOS projections by hand.
- DO NOT replace base.user integer primary keys or business foreign keys.
- DO NOT auto-link accounts by email alone.
- DO NOT store plaintext bootstrap secrets, passwords, refresh tokens or MFA secrets.
- DO NOT expose Identity private signing keys to API, Board, Desktop or shared SDKs.
- DO NOT accept untrusted issuer, audience, algorithm, key ID, nonce or redirect URI.
- DO NOT treat x-company-id as membership or authorization proof.
- DO NOT let Platform Owner bypass tenant row rules implicitly.
- DO NOT delete the old authentication path before end-to-end replacement tests pass.
- DO NOT implement OAuth/OIDC, JWT signing primitives or password hashing algorithms from scratch.
- DO NOT add a new runtime dependency before recording why existing dependencies cannot do the job.

## 8. Definition of done

1. Fresh deployment initializes Identity with a separate database and no default admin password.
2. One-time bootstrap creates exactly one first Platform Owner, then permanently locks.
3. Board and Desktop authenticate through one issuer using Authorization Code + PKCE.
4. API verifies asymmetric Identity tokens using trusted issuer, audience and JWKS.
5. API resolves opaque subject to base.user while preserving business IDs.
6. Business access is still checked against membership, groups, model grants and record rules.
7. No implicit global superadmin/system bypass remains.
8. Machine clients use separate principals and explicit scopes.
9. Refresh replay, logout, disabled accounts, invalid issuer/audience and cross-tenant access are tested.
10. All focused build, test, integration and clean-install checks pass.
11. Legacy credential routes, password storage, seeds and runtime auth package are removed only after proven cutover.


