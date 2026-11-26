# ADR-001 — MoonWitness Identity Provider and Business Authorization Boundary

- **Status:** Accepted — ownership boundary frozen by I01 inventory evidence
- **Plan:** .plan/moonwitness-identity-provider.md
- **Context branch:** dev
- **Decision context:** The repository contains human credential authentication in packages/auth, API JWT handling in apps/api, business users in packages/orm-base, and business authorization in API policies/rules. The repository owner confirms the deployment databases are empty. The full current-state audit is documented in `docs/architecture/identity/legacy-auth-inventory.md`.

## Decision

1. Create apps/id as the only human Identity Provider and OIDC issuer.
2. Create a dedicated Identity database with a separate IDENTITY_DATABASE_URL and separate database credentials. The same PostgreSQL server may host both databases initially.
3. Create packages/orm-identity for Identity-owned persistence. Do not register its models in the API business addon registry.
4. Keep base.user.id as the business principal primary key. Add a future unique opaque identity_subject mapping to the OIDC sub claim. Never substitute an identity UUID as a business primary key.
5. Keep base.partner as a business/CRM profile. It is not the credential or login authority.
6. Keep CompanyMembership, AccessGroup, GroupMembership, ModelAccess and record rules in the Business database and enforce them in API.
7. Create packages/identity-sdk for token verification and first-party OIDC client helpers. Never include credentials or private signing keys in this package.
8. Select a maintained standards-compliant OIDC Provider implementation in task I03. Do not handwrite OAuth/OIDC state machines, JOSE or cryptographic primitives.
9. Board and Desktop are OIDC public clients using Authorization Code + PKCE. Desktop uses the system browser and a validated callback mechanism.
10. API is a resource server. It validates asymmetric-signed access tokens using strict issuer, audience, expiry, allowed algorithm and JWKS key ID checks. The Identity private signing key never leaves the ID security boundary.
11. Bootstrap the first Platform Owner with a high-entropy one-time setup secret issued by an operator CLI/installer, stored only as a verifier/hash, consumed atomically and disabled after successful first-owner creation.
12. Identity publishes account lifecycle events through a transactional outbox. API consumes them idempotently to provision or disable local business principals and memberships.
13. Platform Owner is an Identity-level capability, not the legacy system/superadmin role. It must not implicitly bypass tenant row rules.
14. Machine services use Service Principals and OAuth Client Credentials rather than human accounts.
15. As databases are confirmed empty by the owner, no user-data backfill is required. Schema migrations must still support clean install, repeatability and upgrade checks.

## Ownership matrix

| Data | Authoritative owner |
|---|---|
| Account identity and canonical login identifiers | Identity DB |
| Password and MFA credentials | Identity DB |
| Login sessions and refresh-token families | Identity DB |
| OAuth clients, authorization grants and signing-key metadata | Identity DB |
| Business user integer ID (`base.user.id`) and business foreign keys | Business DB |
| Opaque `identity_subject` mapping (future column on `base.user`) | Business DB |
| Email recovery and verification provider contracts | Identity DB |
| CRM contact, person/company relationship and contact details | Business DB |
| Tenant membership (`CompanyMembership`) | Business DB + API enforcement |
| Group membership (`GroupMembership`) | Business DB + API enforcement |
| Model CRUD grants (`ModelAccess`) | Business DB + API enforcement |
| Row-level record rules | Business DB + API enforcement |
| Machine client identity and secret verifier | Identity DB |
| Machine client allowed scopes | Identity DB registration plus API enforcement |
| Provisioning/lifecycle events | Identity DB outbox + Business DB consumer |
| Refresh-token replay detection and revocation | Identity DB |
| OIDC session state and logout | Identity DB |
| Signing-key material and rotation | Identity DB |
| Access-token verification (issuer/audience/JWKS) | apps/api via packages/identity-sdk |

### Owner-provided database context

The repository owner confirms the deployment databases are empty. This is owner-provided context, not independently inspected production fact. No user-data backfill is planned. Schema migrations must still support clean install, repeatability and upgrade checks.

## Security requirements

- Asymmetric signing only; no shared API/Identity HMAC signing secret.
- Exact redirect URI matching; PKCE method S256 for public clients.
- Authorization codes are single-use and bound to client, redirect URI, PKCE challenge and nonce.
- Refresh tokens rotate; replay revokes the affected token family/session.
- Access tokens have short expiry, explicit issuer and audience, and minimal claims.
- API re-evaluates business authorization; token claims alone do not grant company/model access.
- Never auto-link an Identity account to a business user or partner solely by matching email.
- Secret values are redacted from logs, errors, snapshots and telemetry.
- Fail closed when issuer/JWKS verification or required business-principal resolution fails.
- Never auto-link an Identity account to a business user or partner solely by matching email.
- Token claims alone do not grant business authorization; API re-evaluates membership, groups, model grants and record rules.
- No implicit global superadmin/system bypass for tenant row rules.
- x-company-id header is never treated as membership or authorization proof without verifying CompanyMembership.

## Alternatives rejected

- Keep packages/auth as the permanent credential authority: rejected because it couples human credentials to the Business ORM and API.
- Create a second general-purpose user registry inside Business DB: rejected because it duplicates business principals.
- Move all tenant/model permissions to Identity: rejected because those permissions depend on business records.
- Implement OAuth/OIDC in-house: rejected due protocol and security complexity.
- Share HS256 signing secret with API: rejected because every verifier would also possess signing authority.
- Delete business user references: rejected because business foreign keys and IDs remain local.

## Open decisions

- I03 must compare maintained OIDC Provider implementations and external-IdP alternatives. Record Node 24 compatibility, Fastify integration, Bun development compatibility, feature coverage, maintenance, license and test evidence.
- Production signing-key storage must be injected through a key-provider interface. Local development keys must be clearly marked and must never be silently selected in production.
- Email recovery and verification stay disabled or clearly unavailable until a real delivery provider is configured.
- The exact production issuer URL, client IDs, redirect URIs and deployment secrets are configuration inputs, not values agents may invent.
