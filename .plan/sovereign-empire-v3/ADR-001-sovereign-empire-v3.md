# ADR-001 — Sovereign Empire v3 (Live VPS Cutover, Monetization & Autonomous Self-Hosting)

- **Status:** Accepted
- **Date:** 2026-11-27
- **Plan Tracker:** `.plan/sovereign-empire-v3.md`

---

## 1. Context & Empirical Cross-Check Findings

Following closure of `sovereign-empire-v2` (24 repos + `mw-ww` v1.0 launch), an empirical cross-check across all 25 repositories, GitHub Actions telemetry, VPS configuration (`~/.gemini/vps-ops`), and Plan-TaskOS validator source uncovered 7 structural gaps blocking live commercial revenue and autonomous self-operation:

1. **Private-Repo VPS Deployment Breakage (`apps.mycocolink.com:22022`)**:
   - `mw-stack/scripts/deploy-remote-vps.sh` curls `https://raw.githubusercontent.com/A-L-L-A-H/mw-stack/main/...`, which returns `404` on private repositories without an auth header.
   - `--profile business` omits `mw-mylove` (the public storefront) and `docker-socket-proxy` (leaving `mw-cp` unable to manage containers safely), `mw-isp`/`mw-mission` lack `MW_RID_JWKS_URL`, and `Caddyfile.template` hardcodes `a-l-l-a-h.com`.
2. **Red CI Lanes & Validator Bug**:
   - 3 GitHub Actions lanes currently fail (`mw-xv` run `45920336381`, `mw-rocksoul-cli` run `45918801293`, `mw-pocket` run `45918273318`), while `mw-core` has zero workflow checks.
   - `packages/plan-taskos/src/core/validator.ts:263` passes `#anchor` literally into `readFile()`, breaking `specs/W*.md#Vxx` resolution if anchors are written in `spec_files`.
   - `sovereign-empire-v2` left placeholder `bun --version` verification commands and unsealed proof envelopes.
3. **Disconnected Order-to-Cash Loop**:
   - `mw-mylove/src/storefront.ts` only serves static USD pricing tiers; no live IDR/QRIS Midtrans/Xendit checkout triggers `mw-cp` PaaS provisioning, `mw-isp` RADIUS voucher activation, PPh Final 0.5% / Zakat ledger posting, or WhatsApp PDF receipt delivery.
4. **Missing Cross-Repo Contract & Chaos Verification**:
   - Repos pass isolated unit tests, but zero automated multi-container integration tests verify RS256 JWKS propagation, PaaS deploy + Caddy TLS `ask`, or Postgres backup-restore integrity.
5. **Security & Compliance Gaps**:
   - No zero-downtime key rotation (`mwctl rotate-keys`), RS256 dual-`kid` rotation in `mw-rid`, container `cap_drop=ALL` enforcement in `mw-cp`, SSRF blocklists in `mw-rocksoul-sandbox`, or UU PDP data-subject export endpoints.
6. **Workstation Disk Pressure & Orphan Directories**:
   - `C:` sits near 90% capacity (~12.6 GB free), triggering Go compiler Windows commit-charge OOM without `GOMEMLIMIT`/`mw-ww` auto-sweep; non-git orphan folders (`mw-control`, `mw-xv-review-7e964`, `mw-xv-sweep`) remain in `z:\repo\`.
7. **Autonomous Self-Hosting & Product Polish**:
   - `rocksoul` CLI can execute individual runs but does not yet continuously self-drive `plan-taskos next --claim` -> `complete --commit` across free-tier model pools (`Gemini`, `Groq`, `OpenRouter`, `NVIDIA NIM`, `Ollama`), nor bridge WhatsApp voice/email ops cleanly into live tickets and daily founder briefs.

---

## 2. Decision Drivers

- **Zero-Card Sovereignty:** Every CI/CD, DNS, backup (`rclone crypt` -> Google Drive), monitoring (`UptimeRobot`/`Grafana Cloud`), and AI inference path remains 100% credit-card-free.
- **Disjoint Write-Ownership:** Every micro-task (`V01`–`V72`) owns a strictly unique file path (`errors=0, conflicts=0, cycles=0` enforced by `bun run plan:lint`).
- **Energy-Saving Hybrid Swarm Routing:** Route implementation/test tasks to `flash`/`gemini-3.8-flash-low`, architecture/security/E2E to `neon`, and financial/audit sign-offs to `argon`.

---

## 3. Architectural Decisions

### Decision 1 — Fleet Scope Prefixing for Cross-Repo Micro-Tasks
- **Chosen:** Tasks targeting `mw-xv` use exact repo-relative paths (`apps/...`, `packages/...`, `scripts/...`); tasks targeting satellite repositories use `fleet/<repo>/<relative-path>` in `owner_files` (with exact repo paths noted inside `specs/W{n}.md`) so `plan-taskos lint` proves global disjoint ownership while remaining Windows/Posix containment-safe.
- **Rejected:** Mixing 25 separate `.plan/` databases or disabling `normalizeRepoPath` containment.
- **Consequence:** One cognitive workgraph Brain indexes all 72 cross-fleet tasks in `<150ms`.

### Decision 2 — SCP/Tar-Pipe Zero-Auth VPS Bundle Delivery
- **Chosen:** Upload `mw-stack` bundle directly over SSH (`scp` / `tar | ssh`) and push/load locally built multi-arch OCI images over SSH tunnel (`docker save | ssh docker load` or authenticated GHCR) so private GitHub repos deploy reliably with zero card or public-repo exposure.

---

## 4. Repository Gate Invariants

| Gate | Command / Check | Requirement |
|---|---|---|
| Schema, Ownership & DAG | `bun run plan:lint` | `errors=0, conflicts=0, cycles=0` across all plans |
| Verify Command Realism | `packages/plan-taskos/src/core/verify-policy.ts` | Zero dummy `bun --version` or no-op verify commands in v3 |
| Registry Integrity | `node ../mw-stack/scripts/validate-core-registry.mjs` | Zero port collisions, D12 non-operational `mw-core` |
| Protected Locks | `.agents/rules/autonomous-git-release-lock.md` | Never alter protected release/hook files without `@bjo163` approval |
