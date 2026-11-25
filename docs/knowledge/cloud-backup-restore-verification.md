# Cloud control-plane backup and restore verification (CF-022)

Status: **procedure definition only**. No production backup, restore or deployment action is
authorised by this document. RPO and RTO are **unknown** until measured in an approved drill.
Missing infrastructure capabilities are recorded as blockers below, not claimed as complete.

## 1. Backup scope and exclusions

Supported boundary — the database-backed cloud control plane and the configuration that governs it:

| In scope                                                                                                            | Where it lives                                                | Notes                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Cloud domain records (`cloud.provider`, `cloud.server`, `cloud.deployment_target`, `cloud.app`, `cloud.deployment`) | ORM-managed tables in the application database                | Tenant (`company_id`) columns are part of every record; restore must preserve them. |
| Provider references (type, endpoint, region, code, UUIDs, instance IDs)                                             | Same cloud tables                                             | Store references and identifiers, never plaintext credentials.                      |
| Audit evidence and job/outbox records                                                                               | `cloud_deployments.log` / `error_message`, jobs/outbox tables | Verify redaction before archiving; logs are redacted on write by the HTTP plugin.   |
| Secret **references** (env key names such as `MW_CONTROL_PLANE_TOKEN`, `MW_INTERNAL_SECRET`, `MW_METRICS_TOKEN`)    | Deployment configuration / secret manager                     | Record only the _name_ and rotation version, never the value.                       |
| Addon installation metadata and model access grants                                                                 | base/addon seed tables                                        | Required to reconstruct authorisation semantics.                                    |

Explicitly **excluded**:

- Raw provider credentials, bearer tokens, `access_key` / `secret_key` values, and URL userinfo.
  These are resolved at runtime from secret references (`packages/orm-cloud/src/auth.ts`).
- Container volumes / application data on provider hosts. This repository provides no
  mechanism to back those up; they remain a blocker for full application-level recovery.
- Live Docker/Coolify/Mesh provider state. Provider consoles remain the authority for their
  own state; this procedure only restores the control-plane records that point at them.
- Browser-local or desktop-local state (not part of the control plane).

## 2. Backup procedure (operator-run, non-production evidence only)

1. Take a **consistent logical dump** of the application database using the deployment's
   supported backup capability. Record the tool, version, timestamp and database engine in the
   evidence log. If no supported dump capability exists in the deployment, stop: this is blocker
   **B-1**, not a completed backup.
2. Export configuration as a **redacted manifest**: feature flags, `controlPlaneUrl`, port,
   allowed probe hosts, token/secret reference names, rotation version, quota capacity.
   Never export resolved token values. `validateCloudConfig` / `readCloudReadiness` reason codes
   are safe to record; URLs with embedded credentials are rejected at validation time.
3. Compute and record checksums for every artefact:

   ```sh
   sha256sum cloud-control-plane.sql.gz > cloud-control-plane.sql.gz.sha256
   sha256sum cloud-config-redacted.json > cloud-config-redacted.json.sha256
   sha256sum -c cloud-control-plane.sql.gz.sha256
   sha256sum -c cloud-config-redacted.json.sha256
   ```

4. Verify the dump is non-empty and contains the expected cloud tables and row counts. Store
   checksum files **separately** from the artefacts so a single object-store incident cannot
   silently replace both.
5. Confirm no secret leaked into the artefacts:

   ```sh
   grep -E 'Bearer |secret_key|access_key|password=|MW_CONTROL_PLANE_TOKEN=[^<]' \
     cloud-config-redacted.json cloud-control-plane.sql.gz || echo "no plaintext secrets found"
   ```

   A positive match invalidates the backup artefact; rotate the exposed credential and redo it.

## 3. Restore procedure (non-production only)

1. Provision a fresh, isolated non-production database and API/worker process pair.
2. Load the redacted configuration manifest and supply secrets **by reference** from the
   non-production secret store. Required references: `MW_CONTROL_PLANE_TOKEN` (or
   `MW_INTERNAL_SECRET` / `JWT_SECRET` for derivation), `MW_METRICS_TOKEN` when the metrics
   feature is enabled, and the database URL. Do not paste values into tickets, shell history or
   domain records. During rotation, configure current and previous references for the overlap
   window; `verifyControlPlaneToken` accepts both and `describeControlPlaneToken` reports only
   safe metadata.
3. Validate before starting: `validateCloudConfigOrThrow` must fail fast on malformed URLs,
   weak/missing secrets or broken feature dependencies. Disabled optional cloud features must
   not prevent unrelated API startup; readiness reports stable reason codes (for example
   `CLOUD_TOKEN_MISSING`) without URLs or key material.
4. Restore the logical dump into the fresh database and re-run `sha256sum -c` on a fresh copy
   of the artefact before applying it.
5. Start the API and jobs worker against the restored database. Do **not** point them at
   production providers or production control-plane endpoints.

## 4. Non-production restore verification checklist

- [ ] Checksums of the restore artefact match the recorded `.sha256` files.
- [ ] Cloud table row counts match the backup evidence; `company_id` values are intact.
- [ ] **API**: `GET /api/cloud/health`, `GET /api/cloud/readiness` and
      `GET /api/cloud/export/terraform` authenticate and return redacted, tenant-scoped data.
      Cross-company IDs return 404 for every route family in `CLOUD_ROUTE_ACCESS_MATRIX`.
- [ ] **Jobs worker**: `cloud.targets.probe` is registered and probes only allowlisted
      targets; invalid targets yield stable reason codes without changing health status.
- [ ] **Cloud addon**: model access grants and views load; credential fields are absent from
      provider views; tenant isolation regression tests pass.
- [ ] **Control Plane connectivity**: probe/control-plane calls use bearer auth from the
      configured secret reference, bounded timeouts and bounded response sizes; no SSRF
      destination (`169.254.169.254`, public IPs) is contacted.
- [ ] Provider secret sentinel regression: sentinel values injected during the drill never
      appear in API responses, stored deployment logs, metrics output or Terraform output.
- [ ] Reconciliation: an ambiguous provider timeout stays a single logical deployment; replay
      with the same idempotency key does not create a second remote resource.
- [ ] Record observed RPO/RTO values from the drill **timestamps only**. Until an approved
      drill measures them, RPO/RTO remain **unknown**.

## 5. Metrics scrape and authentication requirements (CF-012)

- Cloud operation metrics are exposed by the API observability layer with names
  `moonwitness_cloud_operations_total` and `moonwitness_cloud_operation_duration_seconds_sum`
  (contract in `CLOUD_METRICS_CONTRACT`).
- Labels are fixed enums: `operation`, `outcome`, `provider`. No company ID, resource ID, token,
  URL or secret is used as a label value; `normalizeCloud*` helpers map arbitrary input to
  `other` and the series count is capped.
- The metrics endpoint must remain protected by `MW_METRICS_TOKEN` using an `Authorization:
Bearer` header. It **fails closed** when the token is not configured; do not expose the
  endpoint unauthenticated, and do not include the token in scrape URLs, logs or dashboards.
- Scrapers must use HTTPS, a dedicated read-only service credential, and must not forward
  query strings containing secrets to upstream services.

## 6. Known blockers (not claimed complete)

- **B-1** No repository-provided database dump/restore automation for the cloud control plane;
  the deployment's actual backup capability must be identified and approved before RPO/RTO can
  be measured.
- **B-2** No supported backup mechanism for provider-managed container volumes/application data.
- **B-3** No automated non-production restore drill exists in this repository; the checklist
  above is manual until a drill harness is approved.
- **B-4** Metrics endpoint authentication is owned by the API observability layer; the cloud
  package only publishes the bounded-contract helpers and the fail-closed configuration check.
