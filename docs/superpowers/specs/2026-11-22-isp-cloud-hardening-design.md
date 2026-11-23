# ISP & Cloud Operational Hardening and Closed-Loop Design

Date: 2026-11-22
Status: Approved (Opsi 1 — Worker-Driven Reconciliation + Zero-Config Runtime Auth & Streaming)

## Scope

Close the operational, security, and lifecycle loops across four subsystems:

1. **Zero-Config Internal Bearer Auth & Network Isolation** (`apps/isp`, `apps/control-plane`, `packages/orm-isp`, `packages/orm-cloud`, `scripts/run-local-services.mjs`, `docker-compose.yml`)
2. **ISP Closed-Loop Session Sync, Metering, Outbox Retry & RFC 5176 CoA/Disconnect** (`apps/isp`, `packages/orm-isp`, `apps/api` jobs worker/scheduler)
3. **Cloud Safe Container Naming/Redeploy, Real Streaming Logs SSE & Compose Fixes** (`apps/control-plane`, `packages/orm-cloud`, `docker-compose.yml`)
4. **Active Health Probes for HA Failover** (`packages/orm-isp`, `packages/orm-cloud`, `apps/api` jobs worker/scheduler)

## 1. Zero-Config Internal Auth & Network Isolation

Users never manually invent or enter internal service tokens.

### Token Resolution Contract (Identical across Node.js, Rust, Go)

Domain labels:

- ISP service: `moonwitness-isp-admin-v1`
- Control Plane: `moonwitness-control-plane-admin-v1`

Precedence:

1. Explicit service override (`MW_ISP_ADMIN_TOKEN` / `MW_CONTROL_PLANE_TOKEN`, trimmed non-empty).
2. Derived HMAC-SHA256 hex token from shared secret (`MW_INTERNAL_SECRET` or `JWT_SECRET`):
   `hex(HMAC_SHA256(secret, domain_label))` (64 lowercase hex characters).
3. Standalone fallback (runtimes only): auto-generate 32 CSPRNG bytes -> 64 hex chars, persist to `<dir(db_path)>/.admin-token` (`0600` on Unix) so standalone single-node restarts preserve the token without manual input.

Runtime enforcement:

- `GET /health` remains unauthenticated for container/orchestrator liveness probes.
- All other HTTP endpoints require `Authorization: Bearer <token>` verified via constant-time comparison; missing/invalid credentials fail closed with `401 Unauthorized`.
- Default HTTP bind addresses use `127.0.0.1` (`127.0.0.1:3000` in `apps/isp`, `127.0.0.1:3003` in `apps/control-plane`). In `docker-compose.yml`, host port mappings bind `127.0.0.1:3002:3000` and `127.0.0.1:3003:3003` while RADIUS UDP (`1812/udp`, `1813/udp`) remains reachable for NAS routers.
- `scripts/run-local-services.mjs` generates an ephemeral CSPRNG `MW_INTERNAL_SECRET` per run if unset and passes it to child processes.

## 2. ISP Closed-Loop Sync, Metering, Outbox & RFC 5176 CoA

- **`apps/isp` (`radius_protocol.rs`, `main.rs`):**
  - Implement RFC 5176 `Disconnect-Request` (Code `40`) packet encoding with MD5 Request Authenticator (`MD5(Code + ID + Length + 16*0 + Attributes + Secret)`) and `Disconnect-ACK` (`41`) / `Disconnect-NAK` (`42`) response verification.
  - Add authenticated `POST /api/sessions/disconnect` that resolves the active session/NAS secret from SQLite, sends UDP `Disconnect-Request` to `<nas_ip>:<coa_port>` (default `3799`), and marks the session `terminated` (`terminate_cause = 6`) on ACK.
- **`packages/orm-isp` (`reconcile.ts`, `jobs.ts`, `http.ts`):**
  - `syncIspRuntimeSessions`: fetches `/api/sessions` with Bearer auth, maps `username` to `ISPSubscriber`, upserts `ISPRadiusSession` by unique `session_id`, and invokes `meterSessionsToSubscriptionInvoices()` per affected company.
  - `processIspRadiusOutbox`: processes `ISPRadiusOutbox` rows in `pending` / `failed` state, executes suspend + CoA disconnect against `apps/isp`, and transitions rows to `sent` or `failed` with sanitized errors.
  - Expose manual trigger endpoints (`POST /api/isp/sessions/sync`, `POST /api/isp/outbox/process`, `POST /api/isp/nas/probe`) protected by `ModelAccess`.
  - Register `@moonwitness/jobs` handlers (`isp.sessions.reconcile`, `isp.outbox.process`, `isp.nas.probe`) and cron schedules in `jobs-worker.ts` / `jobs-scheduler.ts`.

## 3. Cloud Safe Container Naming, Streaming Logs SSE & Compose Fixes

- **`apps/control-plane` (`main.go`):**
  - Add optional `Name` field to `containerMeta`, sanitize container names (`mw-` prefix, `[a-z0-9._-]`), reject flag-like inputs (`-` prefix), and stop/remove any pre-existing container with the same safe name before `docker run -d` (safe replace-on-redeploy).
  - Add `GET /api/containers/{id}/logs?follow=true|false&tail=200` validating container identifier syntax (`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`), streaming `docker logs --timestamps --tail <N> --follow <id>` as SSE events (`event: log`) when `follow=true` or returning JSON `{ id, logs }` when `follow=false`.
- **`packages/orm-cloud` (`http.ts`):**
  - Forward Bearer auth on all control-plane calls and pass `name: cloudApp.name` in `/api/deploy`.
  - Upgrade `GET /api/cloud/deployments/:id/logs` to fetch live tail logs when `container_id` is present (falling back to stored `deployment.log`), and upgrade `GET /api/cloud/deployments/:id/logs/stream` to proxy live SSE chunks from `control-plane` with client-disconnect abort handling.
- **`docker-compose.yml`:**
  - Fix `control-plane` build context (`./apps/control-plane`, `Dockerfile: Dockerfile`) and `depends_on` service names (`postgres`, `gowa`, `radius`).
  - Pass `MW_INTERNAL_SECRET=${MW_INTERNAL_SECRET:-${JWT_SECRET:-}}` and remove static hardcoded `MW_ISP_ADMIN_TOKEN`.

## 4. Active Health Probes for HA Failover

- **`packages/orm-isp` (`reconcile.ts`):** `probeIspNasHealth` probes active `ISPNAS` endpoints (configurable TCP/UDP probe, injectable in tests) and updates `health_status` (`healthy`, `degraded`, `offline`) so `selectHealthyNas` triggers genuine failover.
- **`packages/orm-cloud` (`probe.ts`, `jobs.ts`):** `probeCloudTargetsHealth` probes active `CloudDeploymentTarget` `/health` endpoints and updates `health_status` so `selectHealthyDeploymentTarget` triggers genuine failover. Exposed via `POST /api/cloud/targets/probe` and scheduled via `cloud.targets.probe`.
