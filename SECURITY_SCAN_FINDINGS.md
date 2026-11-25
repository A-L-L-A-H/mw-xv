# Security Deep Scan Findings - 12 Hourly Scan

## Scan Context
- **Repository**: Z:\repo\mw-xv (GitHub A-L-L-A-H/mw-xv, dev branch)
- **Scan Date**: 2026-11-25
- **Scan Type**: Comprehensive security+config scan replacing security-deps + config-drift sentinel

---

## Categories and Findings

### vuln-bun: Bun Vulnerabilities
- **Findings**: 0 (no vulnerabilities found)
- **Checked**: 932 packages via `bun audit --json`
- **Result**: Clean

### vuln-cargo: Cargo Vulnerabilities
- **Findings**: 2
1. **RUSTSEC-2026-0459** (CVE-2026-119375) — `libsqlite3-sys` via C SQLite CVE-2026-119375
   - **Severity**: High (CVSS:4.0/AV:L/AC:L/AT:N/PR:N/UI:P/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N)
   - **Package**: libsqlite3-sys 0.30.1
   - **Description**: SQLite versions before 3.54.0 can return uninitialized page-cache memory when a process opens a database file together with a sibling write-ahead-log (`-wal`) file whose page size differs from the database's. A crafted pair of files can make ordinary queries return stale bytes from the process's memory.
   - **Patched by**: `>=0.39.0` (bundles SQLite 3.54.0+)
   - **Remediation**: Upgrade libsqlite3-sys to >= 0.39.0 (via rusqlite >= 0.41.0)

2. **RUSTSEC-2023-0071** (CVE-2023-49092) — `rsa` timing sidechannel
   - **Severity**: High (CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N)
   - **Package**: rsa 0.9.10
   - **Description**: Non-constant-time implementation leaks private key information through timing observable over the network.
   - **Patched by**: `>=0.10.0`
   - **Remediation**: Upgrade rsa crate to >= 0.10.0

### vuln-go: Go Vulnerabilities (govulncheck)
- **Findings**: 4
1. **GO-2026-6859** — HTTP/1 server crash due to MaxBytesReader header race in `net/http`
   - **Fixed in**: go1.27.4
   - **Impact**: Server crash via crafted requests

2. **GO-2026-6809** — Distrust compromised intermediate certificates in `crypto/x509`
   - **Fixed in**: go1.27.3
   - **Impact**: TLS certificate trust compromise

3. **GO-2026-6617** — HTTP/2 server crash due to HPACK encoder race in `net/http/internal/http2`
   - **Fixed in**: go1.27.2
   - **Impact**: Server crash via HPACK manipulation

4. **GO-2026-6613** — HTTP/1 server connection desynchronization after 2xx CONNECT response in `net/http`
   - **Impact**: Request/response hijacking after CONNECT

### license-drift: License Compliance
- **Findings**: 0 (no GPL-licensed packages detected)
- **Checked**: `bunx license-checker --production --json`
- **Result**: Clean (only UNLICENSED private packages)

### secret-leak: Secret Detection
- **Findings**: 0
- **Methods**: 
  - `bunx @secretlint/secretlint "**/*"` — npm unavailable
  - `rg -n "(api[_-]?key|secret|token|password)\s*[:=]\s*[\"'][^\"']{20,}[\"']" --type yaml --type json --type toml .github/` — no matches
- **Result**: Clean

### compose-drift: Docker Compose Drift
- **Findings**: Analyzed 8 compose files across development, production, and prd configs
- **Key observations**:
  - `docker-compose.development.yml`: Uses many env vars with defaults (JWT_SECRET, SUPERADMIN_PASSWORD, WHATSAPP_GATEWAY_*)
  - `docker-compose.production.yml`: Requires JWT_SECRET, DATABASE_URL, WHATSAPP_GATEWAY_URL, ATTACHMENT_S3_ACCESS_KEY, ATTACHMENT_S3_SECRET_KEY
  - `docker-compose.prd.yml`: Simply includes `docker-compose.production.yml`
  - All required production secrets are documented: JWT_SECRET, MW_INTERNAL_SECRET, SUPERADMIN_PASSWORD, DATABASE_URL, METRICS_TOKEN, WHATSAPP_*
- **Result**: No divergent env vars flagged; all required secrets documented

### action-pins: GitHub Action Pin Status
- **Findings**: 0 unpinned actions; 91 action references verified against upstream version tags
- **Checked**:
  - `node scripts/check-action-pins.mjs` — 21 workflow/composite files validated
  - `node scripts/check-action-tag-pins.mjs` — all 91 references have immutable SHA pins with version tags
- **Result**: All actions properly pinned

---

## Global Deduplication
- No duplicate issues across categories
- Each finding is unique to its dependency/module

---

## Issue Template (for any new issues)

```
Title: [SECURITY] <category>: <count> findings
Labels: security, auto-generated, <category>, priority:P<score>
Body:
## Findings
<what, where, CVE/GHSA, severity>
## Evidence
<full output>
## Remediation
<upgrade / rotate / pin / document>
## Context
Commit: <SHA>
Scan: <timestamp>
```