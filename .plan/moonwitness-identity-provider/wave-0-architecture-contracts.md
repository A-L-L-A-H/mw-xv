# Wave 0 — Architecture Contracts and Audit



**Tasks:** I01–I06. Documentation and read-only audit only. No runtime authentication changes in this wave.



## Execution rule

Execute one task at a time in listed dependency order. Inspect only the task-owned paths and direct dependencies. Do not mark a task done without its Verify command and all Acceptance Criteria passing.



#### - [x] I01 — Re-verify the existing authentication surface and write a source-backed legacy inventory

- **Owner File(s):** docs/architecture/identity/legacy-auth-inventory.md
- **Depends On:** None
- **Effort:** S
- **Exact Spec:**
  - Inspect packages/auth, packages/orm-base user/partner/membership/access models, API auth plugin/routes/policy/rules/startup checks/addon registry, production Compose and authentication security documentation.
  - List all human login/register/password/refresh/logout entry points and identify which process owns signing and token verification today.
  - List every base.user credential/role field, Partner relation, CompanyMembership, group/model grant and system/superadmin seed/startup check.
  - Inspect service-token source and all runtime imports. Mark it as runtime-wired or not runtime-wired only when direct evidence proves it.
  - Record database emptiness as owner-confirmed context; do not claim the production database was independently inspected.
  - Add a source path and one-sentence evidence note for every finding. Separate verified facts from recommended changes.
- **DO NOT:** Do not edit runtime code, infer usages from names alone, or copy stale findings without rechecking current dev.
- **Acceptance Criteria:**
  - [x] Inventory distinguishes human authentication, business principal, CRM contact, business authorization and machine identity.
  - [x] Every claim links to a current repository path and identifies whether the evidence is direct or owner-provided.
  - [x] No runtime source file changes.
- **Verify:** git diff --check; manually open every cited source path.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: git diff --check - passed
  - Manual verification: all cited source paths opened and confirmed current
  - Commit: 977e9a5c docs(identity): write legacy authentication surface inventory for I01

---

#### - [ ] I02 — Freeze Identity vs Business User ownership in ADR-001

- **Owner File(s):** .plan/moonwitness-identity-provider/ADR-001-identity-provider.md
- **Depends On:** I01
- **Effort:** XS
- **Exact Spec:**
  - Finalize the owner boundary: apps/id owns human credentials and sessions; API owns business authorization; base.user remains a local business principal.
  - Preserve base.user.id and all existing business foreign keys. Add a future opaque identity_subject mapping; do not substitute an identity UUID as a business primary key.
  - Document the separate Identity and Business database boundary and separate credentials.
  - Add an ownership matrix for account, identifier, credential, session, partner, membership, group/model grants, record rules and service principals.
  - Document that the owner confirms the databases are empty and that no user-data backfill is planned.
- **DO NOT:** Do not create another business user registry or move tenant permissions into apps/id.
- **Acceptance Criteria:**
  - [ ] ADR has one unambiguous owner for each data class.
  - [ ] All rejected alternatives and security invariants are documented.
  - [ ] ADR reflects the I01 inventory.
- **Verify:** git diff --check; compare ADR ownership table with I01 inventory.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: git diff --check - passed
  - Manual verification: all cited source paths opened and confirmed current
  - Commit: 977e9a5c docs(identity): write legacy authentication surface inventory for I01

#### - [ ] I03 — Evaluate and select a maintained OIDC Provider implementation

- **Owner File(s):** docs/architecture/identity/oidc-provider-evaluation.md
- **Depends On:** I01, I02
- **Effort:** S
- **Exact Spec:**
  - Compare at least two maintained OIDC Provider/server implementations and one external-provider option. A client-only OAuth package is not a provider candidate.
  - Compare Node 24 support, Fastify integration, Bun development compatibility, Authorization Code + PKCE S256, refresh rotation/replay hooks, discovery/JWKS, key rotation, logout/session behavior, Client Credentials, licence, maintenance and testability.
  - Prefer a maintained provider implementation over handwritten OAuth/OIDC protocol endpoints. Record which behaviors remain application-owned and which are delegated to the provider.
  - Create a minimal isolated smoke test proving discovery, authorization request, PKCE code exchange and JWKS on the supported runtime. Do not wire it into production apps yet.
  - Recommend exactly one strategy with evidence and a fallback. Update ADR only if the recommendation changes the agreed architecture.
- **DO NOT:** Do not implement a custom OAuth/OIDC state machine or add a runtime dependency without a documented compatibility result.
- **Acceptance Criteria:**
  - [ ] Evaluation compares candidates using the same criteria and links evidence.
  - [ ] Smoke-test commands, runtime versions and actual results are recorded.
  - [ ] One recommended provider strategy is clear; unresolved incompatibilities are explicit.
- **Verify:** Run the provider smoke-test command recorded in the document; git diff --check.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: git diff --check - passed
  - Manual verification: all cited source paths opened and confirmed current
  - Commit: 977e9a5c docs(identity): write legacy authentication surface inventory for I01

#### - [ ] I04 — Define issuer, subject, audience, token and client contracts

- **Owner File(s):** docs/architecture/identity/oidc-contract.md
- **Depends On:** I02, I03
- **Effort:** XS
- **Exact Spec:**
  - Define issuer semantics, opaque subject format, API audience, Board/Desktop client IDs, machine-client identifiers, expiry policy and allowable clock skew.
  - Define minimum access-token claims: iss, sub, aud, iat, exp, jti, sid, client_id and scope where applicable.
  - Clearly distinguish ID token from API access token. API must reject ID tokens even if signed by the same issuer.
  - Define expected behavior for disabled account, missing business principal, invalid audience, untrusted issuer, unknown kid and unavailable JWKS.
  - Include illustrative non-production examples only; use reserved example domains and fake subjects.
- **DO NOT:** Do not place company membership lists or complete model permissions in tokens; do not include real secrets or domains.
- **Acceptance Criteria:**
  - [ ] Contract covers access token, ID token and client types separately.
  - [ ] All required claims and validation failures are explicit.
  - [ ] Examples contain no production secrets.
- **Verify:** git diff --check; manually trace each claim to ADR-001.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: git diff --check - passed
  - Manual verification: all cited source paths opened and confirmed current
  - Commit: 977e9a5c docs(identity): write legacy authentication surface inventory for I01

#### - [ ] I05 — Define the threat model and Platform/Tenant authorization boundary

- **Owner File(s):** docs/architecture/identity/security-model.md
- **Depends On:** I02
- **Effort:** S
- **Exact Spec:**
  - Threat-model bootstrap abuse, credential stuffing, session theft, refresh replay, token substitution, key compromise, redirect manipulation, account enumeration, cross-tenant access and forged provisioning events.
  - Define Platform Owner, Tenant Admin, Regular User and Service Principal as distinct actor types.
  - Define Platform Owner capabilities as explicit platform operations; they do not imply permission to read every tenant's business records.
  - Define fail-closed behavior when Identity verification, JWKS retrieval or business-principal mapping is unavailable.
  - Define redaction rules for password, setup secret, access/refresh token, MFA secret, connection URL and private-key material.
  - Map each threat to at least one mitigation and a test scenario.
- **DO NOT:** Do not define an all-powerful admin shortcut or treat x-company-id as proof of membership.
- **Acceptance Criteria:**
  - [ ] Each listed threat has a concrete control and a future test case.
  - [ ] Actor types and privilege boundaries are unambiguous.
  - [ ] Security logging and secret-redaction rules are testable.
- **Verify:** git diff --check; review each threat/control pair.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: git diff --check - passed
  - Manual verification: all cited source paths opened and confirmed current
  - Commit: 977e9a5c docs(identity): write legacy authentication surface inventory for I01

#### - [ ] I06 — Create the acceptance matrix and architecture exit gate

- **Owner File(s):** docs/architecture/identity/acceptance-matrix.md
- **Depends On:** I03, I04, I05
- **Effort:** XS
- **Exact Spec:**
  - Translate the architecture definition of done into named test scenarios: clean install, one-time bootstrap, login, PKCE, refresh replay, logout, disabled account, unknown subject, wrong audience/issuer, missing membership and cross-tenant denial.
  - Map each scenario to its implementation task and anticipated test suite.
  - Separate mandatory first-usable-cutover tests from post-MVP MFA, service-client and passkey tests.
  - Mark every scenario as planned, not passed. Only change status after actual test evidence is recorded.
- **DO NOT:** Do not mark an unimplemented scenario as passed or invent test output.
- **Acceptance Criteria:**
  - [ ] Every architecture invariant maps to at least one named test.
  - [ ] MVP and post-MVP scenarios are separated.
  - [ ] Wave 1 entry gate and OIDC provider choice are explicit.
- **Verify:** git diff --check; review matrix-to-task traceability.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:**
  - Command: git diff --check - passed
  - Manual verification: all cited source paths opened and confirmed current
  - Commit: 977e9a5c docs(identity): write legacy authentication surface inventory for I01



## Wave exit gate

Do not start Wave 1 until I01–I06 are done and the OIDC provider recommendation has implementation evidence. Any unresolved provider/security choice must be recorded as a blocker, not guessed.

