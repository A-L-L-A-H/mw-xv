# Wave 7 — Machine Identity, Hardening and Final Cutover



**Tasks:** I68–I79. Complete machine identity, security hardening and removal of the legacy human authentication system. Do not delete legacy code before the clean-install MVP passes.



## Execution rule

Execute one task per cycle in dependency order. Inspect existing client/session conventions before editing. Do not cut production traffic over until the clean-install end-to-end gate passes.



#### - [ ] I68 — Add machine Service Principal model

- **Owner File(s):** packages/orm-identity/src/models/service-principal.ts; packages/orm-identity/src/models/service-principal.test.ts; apps/id/src/database/migrations/*service-principal*
- **Depends On:** I04, I19
- **Effort:** S
- **Exact Spec:**
  - Represent machine actors separately from human accounts with stable principal ID, client ID, status, owner/description, allowed scopes and secret-verifier metadata.
  - Use explicit lifecycle states, rotation metadata and last-used timestamp without storing raw client credentials.
  - Keep machine principal identity distinguishable from human accounts in audit events and API request context.
  - Do not create a Business base.user row for every service principal.
- **DO NOT:** Do not reuse a human Platform Owner account or assign implicit global admin permissions to service principals.
- **Acceptance Criteria:**
  - [ ] Machine principals are distinct from human accounts.
  - [ ] Credential verifier metadata is protected and rotation-aware.
  - [ ] Disabled service principal cannot authenticate.
  - [ ] Audit actor type is explicit.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I69 — Implement OAuth Client Credentials for machine clients

- **Owner File(s):** apps/id/src/oidc/client-credentials-policy.ts; apps/id/src/oidc/client-credentials-policy.test.ts; apps/id/src/oidc/provider.ts
- **Depends On:** I35, I37, I68
- **Effort:** S
- **Exact Spec:**
  - Enable the provider's Client Credentials grant only for registered confidential machine clients.
  - Generate high-entropy client secrets once, store only a one-way verifier and support explicit secret rotation/revocation.
  - Require strict client authentication and issue short-lived access tokens with the registered client identity and allowed scopes.
  - Do not issue ID tokens or human session claims for machine-client grants.
- **DO NOT:** Do not enable Client Credentials for Board/Desktop public clients or store raw client secrets.
- **Acceptance Criteria:**
  - [ ] Valid confidential machine client can obtain a scoped access token.
  - [ ] Wrong/expired/revoked secret and disabled client fail.
  - [ ] Token has machine actor identity and no human account session claims.
  - [ ] Secret is shown only once at creation/rotation.
- **Verify:** bun --filter @moonwitness/id test; Client Credentials integration tests.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I70 — Enforce explicit scopes for machine principals in API

- **Owner File(s):** apps/api/src/auth/service-principal-policy.ts; apps/api/src/auth/service-principal-policy.test.ts; apps/api/src/plugins/auth.plugin.ts
- **Depends On:** I51, I55, I69
- **Effort:** S
- **Exact Spec:**
  - Map verified client identity and scope claims into a separate machine-principal request context.
  - Require an explicit endpoint/action scope for every machine-only operation; deny human-only routes to machine actors.
  - Keep tenant-specific data access constrained by explicit service assignment/membership policy. A scope alone must not bypass row rules.
  - Add audit attribution to machine client ID and initiating human/automation context when available.
- **DO NOT:** Do not map a service principal to base.user_system or global superadmin.
- **Acceptance Criteria:**
  - [ ] Machine token can access only explicitly scoped endpoints.
  - [ ] Machine token cannot call human profile/password/session routes.
  - [ ] Machine actor cannot bypass tenant record rules.
  - [ ] Missing/unknown scope is denied.
- **Verify:** bun --filter @moonwitness/api test; machine-principal authorization integration tests.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I71 — Implement signing-key rotation and overlap window

- **Owner File(s):** apps/id/src/security/signing-key-rotation.ts; apps/id/src/security/signing-key-rotation.test.ts; apps/id/src/commands/rotate-signing-key.ts
- **Depends On:** I35, I36
- **Effort:** S
- **Exact Spec:**
  - Implement rotation using the selected provider/key-provider interfaces: create new key, begin signing with new kid, publish both old/new public keys during overlap, then retire old key after maximum token lifetime plus clock skew.
  - Require operator confirmation for irreversible retirement and support dry-run status output.
  - Ensure process restart and multiple ID instances do not create conflicting active signing keys.
  - Emit redacted audit events for key activation and retirement.
- **DO NOT:** Do not delete a still-valid verification key or print/export private key bytes.
- **Acceptance Criteria:**
  - [ ] New key becomes active and signs with new kid.
  - [ ] Old public key remains available through the overlap window.
  - [ ] Retired key is removed only after safe retention period.
  - [ ] Rotation is safe under repeated invocation and restart.
- **Verify:** bun --filter @moonwitness/id test; multi-instance/key-rotation integration test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I72 — Add TOTP credential persistence and crypto boundary

- **Owner File(s):** packages/orm-identity/src/models/mfa-credential.ts; packages/orm-identity/src/models/mfa-credential.test.ts; apps/id/src/security/mfa-secret-vault.ts; apps/id/src/database/migrations/*mfa*
- **Depends On:** I16, I21
- **Effort:** S
- **Exact Spec:**
  - Add a generic MFA credential record with type, encrypted secret material reference, status, created/verified/last-used timestamps and recovery metadata.
  - Define an encryption/key-vault adapter so TOTP seeds are encrypted at rest with a key external to the Identity database.
  - Use a maintained TOTP library in the later flow; this task only defines persistence and secret-handling boundary.
  - Ensure secrets are returned only during enrollment and never in ordinary account/profile responses.
- **DO NOT:** Do not store raw TOTP seeds in plaintext DB columns, logs or test snapshots.
- **Acceptance Criteria:**
  - [ ] Credential model distinguishes pending and verified MFA devices.
  - [ ] Secret vault interface does not expose raw key storage to generic model code.
  - [ ] Tests verify encrypted-at-rest representation and safe redaction.
- **Verify:** bun --filter @moonwitness/orm-identity test; bun --filter @moonwitness/id test.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I73 — Add MFA enrollment and challenge flows

- **Owner File(s):** apps/id/src/security/totp-service.ts; apps/id/src/security/totp-service.test.ts; apps/id/src/routes/mfa.routes.ts; apps/id/src/routes/mfa.routes.test.ts
- **Depends On:** I28, I72
- **Effort:** S
- **Exact Spec:**
  - Use a maintained TOTP implementation to generate enrollment secret/otpauth URI and verify time-based codes.
  - Require a recent authenticated session for enrollment and confirmation. Mark a device active only after successful challenge.
  - Apply rate limits and replay protection for accepted time steps; provide safe disable/recovery rules.
  - Integrate MFA policy into login challenge without leaking whether another account has MFA enabled.
- **DO NOT:** Do not invent OTP algorithms or expose the secret after enrollment confirmation.
- **Acceptance Criteria:**
  - [ ] Enrollment secret is shown only during pending setup and encrypted at rest.
  - [ ] Invalid/replayed code fails and repeated attempts are throttled.
  - [ ] MFA login challenge is required when policy says it is required.
  - [ ] Disable flow requires recent authentication or an approved recovery path.
- **Verify:** bun --filter @moonwitness/id test; MFA integration tests.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I74 — Add account recovery and email-verification provider contracts

- **Owner File(s):** apps/id/src/notifications/email-delivery.ts; apps/id/src/notifications/email-delivery.test.ts; apps/id/src/routes/account-recovery.routes.ts; apps/id/src/routes/account-recovery.routes.test.ts
- **Depends On:** I16, I21
- **Effort:** S
- **Exact Spec:**
  - Define an email-delivery adapter interface with a no-op/unavailable implementation when no provider is configured.
  - Implement one-time recovery/verification token records as hashed verifiers with bounded expiry and single-use semantics.
  - Use generic responses and rate limits to prevent account enumeration.
  - Require email identifier ownership verification before treating an identifier as verified; only allow password reset through Identity.
  - Document provider configuration without adding real SMTP/API secrets.
- **DO NOT:** Do not claim email delivery succeeded when provider is absent or log the recovery token.
- **Acceptance Criteria:**
  - [ ] Routes report a safe unavailable state when no mail provider is configured.
  - [ ] Recovery/verification tokens are hashed, expiring and single use.
  - [ ] Unknown and known account responses are indistinguishable.
  - [ ] Successful reset updates Identity credential and revokes old sessions.
- **Verify:** bun --filter @moonwitness/id test; recovery integration tests with a fake delivery adapter.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I75 — Evaluate WebAuthn/passkey support and record rollout decision

- **Owner File(s):** docs/architecture/identity/webauthn-evaluation.md; .plan/moonwitness-identity-provider/ADR-001-identity-provider.md
- **Depends On:** I03
- **Effort:** S
- **Exact Spec:**
  - Evaluate maintained WebAuthn server libraries and provider-native passkey support compatible with Node 24 and the selected OIDC provider.
  - Compare resident credentials, user verification, origin/RP ID configuration, attestation policy, backup eligibility, recovery and multi-device behavior.
  - Record the rollout recommendation, migration/UX impact and test requirements.
  - Keep passkeys post-MVP unless a standards-compliant implementation is already provided by the selected provider.
- **DO NOT:** Do not implement WebAuthn cryptographic validation manually or claim support based only on a UI mockup.
- **Acceptance Criteria:**
  - [ ] Evaluation compares maintained options and security behavior.
  - [ ] RP ID/origin constraints and recovery implications are documented.
  - [ ] Decision is recorded as implement now, defer or use provider feature with reasons.
- **Verify:** git diff --check; verify referenced library/provider documentation and version compatibility.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I76 — Remove default system/superadmin seeds and startup dependency

- **Owner File(s):** packages/orm-base/src/data.ts; apps/api/src/startup-checks.ts; apps/api/src/addons/registry.ts; apps/api/tests/startup-checks.test.ts
- **Depends On:** I47, I55, I58, I70
- **Effort:** S
- **Exact Spec:**
  - Remove default human superadmin account seeding and the production readiness requirement for SUPERADMIN_PASSWORD.
  - Remove base.user_system only after all required technical actor functions have been replaced with explicit Service Principals or narrowly scoped internal credentials.
  - Keep any non-human seed data required by tests isolated to test fixtures, not production default users.
  - Update startup checks to verify Identity issuer/JWKS readiness and Business schema readiness instead of default user rows.
  - Remove reset-superadmin-password command wiring if no supported operational use remains.
- **DO NOT:** Do not remove a technical actor while active jobs still require it; inspect references and add replacement tests first.
- **Acceptance Criteria:**
  - [ ] Fresh install creates no default system/superadmin user rows.
  - [ ] Startup no longer requires SUPERADMIN_PASSWORD.
  - [ ] All jobs/integrations use explicit service identity or safe internal execution context.
  - [ ] No production global superuser seed remains.
- **Verify:** bun --filter @moonwitness/orm-base test; bun --filter @moonwitness/api test; bun run orm:check:seeds.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I78 — Remove legacy auth package/runtime and obsolete service-token wiring

- **Owner File(s):** packages/auth/**; apps/api/package.json; apps/api/src/addons/registry.ts; package.json; bun.lock
- **Depends On:** I67, I69, I70, I76
- **Effort:** S
- **Exact Spec:**
  - Search all workspace imports and runtime wiring for @moonwitness/auth, auth.refresh_token, createAuthService and ServiceTokenAuthority.
  - Remove packages/auth only when no active runtime consumer remains and the required service-token use cases have been moved to or explicitly retained behind the machine identity contract.
  - Remove legacy auth refresh-token model registration and obsolete package/build/test wiring.
  - Remove obsolete reset-superadmin-password and revoke-auth-sessions command wrappers only after equivalent Identity operations are available.
  - Update lockfile and documentation using the repository package manager.
- **DO NOT:** Do not delete a service-token capability still used by a real machine integration; prove every removed export has no live consumer.
- **Acceptance Criteria:**
  - [ ] No API runtime imports the legacy human credential auth service.
  - [ ] No auth.refresh_token model is registered in the Business DB.
  - [ ] Machine-to-machine use cases are handled by Service Principal scopes or an explicitly documented retained adapter.
  - [ ] No stale workspace dependency or command points to removed code.
- **Verify:** bun install --lockfile-only; bun run build; bun run test:unit:built; repository search for legacy auth symbols.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I77 — Remove credential ownership and obsolete role fields from base.user

- **Owner File(s):** packages/orm-base/src/models/user.ts; packages/orm-base/src/models/user.test.ts; packages/orm-base/src/migrations/*identity-cleanup*; docs/architecture/identity/legacy-field-usage-map.md
- **Depends On:** I55, I56, I57, I58, I78
- **Effort:** S
- **Exact Spec:**
  - Search all source, test, seed, generated schema and UI references to base.user.password, base.user.login and the legacy system/superadmin/user role enum.
  - Remove password storage and password helper methods from base.user; remove the legacy global role field after all consumers use explicit grants/capabilities.
  - Remove login as an authentication authority. If a genuine non-auth business display use remains, replace it with an explicitly named profile/display field before dropping the legacy column.
  - Keep identity_subject and business principal ID stable. No data backfill is required because the owner confirms the DB is empty.
  - Update model metadata, generated references, fixtures and tests in the smallest coherent scope.
- **DO NOT:** Do not blindly drop login while a real business feature still depends on it; do not reintroduce email-based identity matching.
- **Acceptance Criteria:**
  - [ ] base.user stores no password or password hash.
  - [ ] Legacy system/superadmin/user global role is no longer an authorization authority.
  - [ ] No login call path authenticates from the Business database.
  - [ ] Build/tests and generated model references are consistent.
- **Verify:** bun --filter @moonwitness/orm-base test; bun --filter @moonwitness/api test; bun run docs:check:built; repository search for removed fields.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.

#### - [ ] I79 — Run final security audit, update runbooks and close the plan

- **Owner File(s):** docs/architecture/identity/**; docs/operations/identity-runbook.md; .plan/moonwitness-identity-provider.md; .plan/moonwitness-identity-provider/**
- **Depends On:** I67, I68, I70, I71, I73, I74, I75, I76, I77, I78
- **Effort:** S
- **Exact Spec:**
  - Run a source-based security review against ADR-001, security-model.md and acceptance-matrix.md.
  - Verify bootstrap one-time semantics, password storage, session/refresh revocation, PKCE, redirect matching, asymmetric signing, key rotation, JWKS, scope enforcement, tenant row rules, secret redaction and service-principal separation.
  - Document deployment configuration, operator bootstrap, backup/restore of both databases, key rotation, account recovery availability, incident response and safe rollback boundaries.
  - Record exact test/build/CI source SHA and remaining limitations. Mark the plan complete only when all Definition of Done checks have evidence.
  - Review the final changed-file list and remove only temporary test artifacts produced by this plan.
- **DO NOT:** Do not claim production readiness when any mandatory test, key-management requirement, database backup plan or tenant-isolation check is unresolved.
- **Acceptance Criteria:**
  - [ ] All Definition of Done requirements are mapped to passing evidence.
  - [ ] Runbook covers fresh install, bootstrap, key rotation, recovery and incident response.
  - [ ] No secret or test-only credential is committed.
  - [ ] Plan has no unchecked mandatory task and final source SHA is recorded.
- **Verify:** bun run verify; clean-install E2E; security review and git diff --check.
- **Expected Output:** The task passes all acceptance criteria and verification; only task-owned files change.
- **Evidence:** after completion, append exact command, result and commit SHA here.



## Wave exit gate

Human authentication has one authority; machine clients have separate principals/scopes; default superuser seeds and Business DB credentials are removed; final security review and runbook are backed by passing evidence.