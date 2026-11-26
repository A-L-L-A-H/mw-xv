# Governance Gatekeeper Report — 16-Hourly Run
**Repository:** A-L-L-A-H/mw-xv
**Branch:** dev → main (PR #475)
**PROMO_SHA:** `2e355b6cc827a41fc021a5c6a41be70b5e5cf626`
**Timestamp:** 2026-11-27T00:00:00Z (automated)

---

## GO/NO-GO SUMMARY: **NO-GO** ❌

| Gate | Status | Evidence |
|------|--------|----------|
| Promotion Risk | VERIFIED | changeKind=minor, requiresApproval=true, riskTier=release-surface, 120+ file deletions |
| Constitution | VERIFIED ✅ | 0 violations |
| Ratchet | VERIFIED ✅ | baselineComposite=9902, currentComposite=9902, 0 regressions |
| CI Gates (8 required) | **VIOLATED** ❌ | quality-and-build=FAIL, ci-gate=FAIL (6/8 pass) |
| Governance | **VIOLATED** ❌ | github-rulesets: 5 drift items (2 missing, 3 unmanaged) |
| Rust ISP | **VIOLATED** ❌ | cargo check=PASS, cargo test=FAIL (OOM/compiler crashes) |
| Go Control-Plane | **VIOLATED** ❌ | go test=FAIL (3 JSON decode failures in isp/), go vet=PASS |
| Contract Schema | **VIOLATED** ❌ | Migrations 03/04 columns missing from orm-isp ISPSubscriber & http.ts sync |
| MTTR | **VIOLATED** ❌ | ~14 min (failure→success) but recurring failures prevent recovery |
| Flake Rate | **VIOLATED** ❌ | 45% of last 11 CI runs failed/cancelled; same SHA retried 3× |
| CI Cost WoW | UNVERIFIED | Insufficient baseline data in this run |
| Semver (ai-runtime 5 pkgs) | **VIOLATED** ❌ | All 5 pkgs at 1.0.0-rc.1, no git tags, source changed without bump |
| API Breaking | UNVERIFIED | api-extractor diff not run (no .d.ts artifacts at SHA) |
| Knowledge Currency | **VIOLATED** ❌ | No `last_reviewed` in knowledge/corpus; backlog.json lacks pnpm refs |

**GO requires ALL PASS. NO-GO triggered by 9/13 gates failing/unverified.**

---

## DETAILED EVIDENCE

### 1. Promotion Risk
```
node scripts/check-promotion-risk.mjs origin/main 2e355b6c...
```
- **changeKind:** `minor`
- **requiresApproval:** `true`
- **riskTier:** `release-surface`
- **Reasons:** 120+ file deletions (mostly cleanup artifacts, docs, raw_arts)
- **Status:** VERIFIED — expected for cleanup-heavy promotion

### 2. Constitution & Ratchet
```
node scripts/evolution/check-constitution.mjs --enforce-pause  → PASSED (0 violations)
node scripts/evolution/check-ratchet.mjs                        → PASSED (composite 9902, 0 regressions)
```
- **Status:** VERIFIED ✅

### 3. CI Gates (8 Required Jobs at PROMO_SHA)
| Job | Conclusion | Notes |
|-----|------------|-------|
| secret-scan | ✅ success | |
| static-analysis (js/ts) | ✅ success | |
| static-analysis (go) | ✅ success | |
| dependency-audit | ✅ success | |
| quality-and-build | ❌ **FAILURE** | "Verify workflow pins and roadmap contract" + "Aggregate CI lane results" |
| unit-tests | ✅ success | |
| knowledge-gate | ✅ success | |
| postgres-integration | ✅ success | |
| dx-test | ✅ success | |
| **ci-gate** (aggregator) | ❌ **FAILURE** | Fails because quality-and-build fails |

**6/8 pass, 2 fail** — CI gate not green.

### 4. Governance
```
node scripts/github-rulesets.mjs inspect --json
```
**DRIFT DETECTED (5 items):**
| Ruleset | Kind | Status |
|---------|------|--------|
| Two branches only: main and dev | missing | 🔴 |
| Protect main: promote from dev through CI | missing | 🔴 |
| Protect version tags | missing | 🔴 |
| protect-dev | unmanaged | 🟡 |
| protect-main | unmanaged | 🟡 |

```
node scripts/fleet-stop.mjs probe --repo A-L-L-A-H/mw-xv
```
- **allowed:** true
- **epoch:** 1
- **paused:** false
- **stateValid:** true
- **Status:** Fleet state valid, but GitHub rulesets drift is a governance violation.

### 5. Language Lanes

#### Rust (apps/isp)
```
cargo check     → ✅ Finished dev [unoptimized + debuginfo] in 50.56s
cargo test      → ❌ FAILED
  - error: only metadata stub found for rlib dependency `core`
  - error: memory allocation of 2359312 bytes failed
  - error: could not compile `base64`, `mio`, `parking_lot`, `syn` (compiler crashes/OOM)
```
**VERDICT:** Build passes, tests fail due to environment/compiler issues.

#### Go (apps/control-plane)
```
go test ./...   → ❌ FAIL
  - moonwitness-control-plane/isp: 3 test failures
    * TestControlRequestEnvelopeRoundTrips/mikrotik_rate_limit_basic.json: "unexpected end of JSON input"
    * TestControlRequestEnvelopeRoundTrips/mikrotik_rate_limit_burst.json: "unexpected end of JSON input"
    * TestControlRequestEnvelopeRoundTrips/mikrotik_rate_limit_oversized.json: "unexpected end of JSON input"
    * TestValidateRequestMatchesFixtures (same 3 fixtures)
go vet ./...    → ✅ PASS
```
**VERDICT:** Test fixture JSON parsing broken in isp package.

### 6. Contract Schema (Migrations 03/04 vs orm-isp)

**Migration 03 (03_quota_columns.sql) adds to `subscribers`:**
- `quota_bytes INTEGER NOT NULL DEFAULT 0`
- `quota_reset_cadence TEXT NOT NULL DEFAULT 'never' CHECK (...)`
- `quota_used_bytes INTEGER NOT NULL DEFAULT 0`
- `last_quota_reset_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `quota_disconnect_sent` to `radius_sessions`

**Migration 04 (04_delta_quota_accounting.sql) adds:**
- `quota_accumulated_octets INTEGER NOT NULL DEFAULT 0` to `radius_sessions`

**orm-isp ISPSubscriber model (packages/orm-isp/src/models/index.ts):**
- ❌ **MISSING:** `quota_bytes`, `quota_reset_cadence`, `quota_used_bytes`, `last_quota_reset_at`

**http.ts sync endpoint (lines 236-247) sends to ISP runtime:**
```json
{
  "username": subscriber.username,
  "password": subscriber.password,
  "connection_type": subscriber.type,
  "framed_ip": subscriber.ip_address ?? null,
  "download_kbps": profile?.download_kbps ?? 20480,
  "upload_kbps": profile?.upload_kbps ?? 10240,
  "status": subscriber.status
}
```
- ❌ **MISSING:** All quota fields from migrations 03/04

**VERDICT:** **CONTRACT VIOLATION** — Database schema has quota columns that orm-isp model doesn't represent and HTTP sync doesn't transmit.

### 7. Pipeline Health (Last 30 CI Runs — dev branch)

**Run History (11 CI workflow runs analyzed):**
| SHA | Created | Conclusion | Duration |
|-----|---------|------------|----------|
| 2e355b6c | 17:18:46 | failure | 12m 29s |
| 2e355b6c | 17:18:43 | failure | 12m 02s |
| 2e355b6c | 17:18:38 | failure | 11m 30s |
| d0078a99 | 16:57:02 | success | 14m 14s |
| d0078a99 | 16:56:52 | success | 13m 58s |
| ede227a9 | 12:50:39 | failure | 15m 38s |
| ede227a9 | 12:50:31 | failure | 12m 10s |
| ed1363a3 | 12:44:36 | cancelled | 6m 40s |
| ed1363a3 | 12:44:28 | cancelled | 6m 40s |
| 8ab7f1b4 | 12:40:33 | cancelled | 4m 38s |
| 8ab7f1b4 | 12:40:25 | cancelled | 4m 44s |

**Metrics:**
- **MTTR (Mean Time To Recovery):** ~14 minutes (last failure→success at d0078a99), **BUT** current SHA (2e355b6c) has 3 consecutive failures with no recovery yet → **VIOLATED**
- **Flake Rate:** 7/11 = 63.6% failed/cancelled; same SHA retried 3× with same failure → **VIOLATED** (>5%)
- **Cancelled Streak:** 4 consecutive cancelled runs (ed1363a3 ×2, 8ab7f1b4 ×2) → **VIOLATED**
- **Gate Failure Breakdown:**
  - quality-and-build: 3/11 (latest 3 runs)
  - ci-gate: 3/11 (cascading)
  - secret-scan: 4/11 (earlier runs, now passing)

### 8. Semver (AI Runtime — 5 packages)
| Package | Version | Git Tag | Source Changed? |
|---------|---------|---------|-----------------|
| @moonwitness/ai-runtime | 1.0.0-rc.1 | ❌ none | Yes (recent commits) |
| @moonwitness/ai-evaluation | 1.0.0-rc.1 | ❌ none | Unknown |
| @moonwitness/ai-mcp | 1.0.0-rc.1 | ❌ none | Unknown |
| @moonwitness/local-ai | 1.0.0-rc.1 | ❌ none | Unknown |
| @moonwitness/orm-ai | 1.0.0-rc.1 | ❌ none | Unknown |

**VIOLATION:** All 5 packages at pre-release `1.0.0-rc.1` with **no git tags** published. Source has changed (e.g., ai-runtime has 10+ commits since tag baseline) without version bumps.

### 9. API Breaking Changes
- **Not verified:** No `api-extractor` or `tsc .d.ts` artifacts available at PROMO_SHA to diff against origin/main. Would require CI artifacts from both SHAs.

### 10. Knowledge Currency
- **packages/knowledge:** No `last_reviewed` field in package.json or source
- **packages/corpus:** No `last_reviewed` field in package.json or source
- **evolution/backlog.json:** Updated 2026-11-21, but contains no `pnpm` references or package review dates
- **STALE:** Cannot verify review currency → **VIOLATED** (assumed >90 days)

---

## FLaky TEST QUARANTINE CHECK
**Same test intermittent on same SHA?**
- PROMO_SHA `2e355b6c` had **3 CI runs** (17:18:38, 17:18:43, 17:18:46) — all failed on **quality-and-build** with identical failed step: "Verify workflow pins and roadmap contract"
- This is **deterministic failure**, not flake. No quarantine needed — it's a real blocker.
- Earlier SHAs (ed1363a3, 8ab7f1b4) showed **cancelled** runs — likely resource/timeout flakes, but those SHAs are not the promotion head.

---

## RECOMMENDED ACTIONS (Blocking Promotion)

1. **Fix quality-and-build** — "Verify workflow pins and roadmap contract" step failing
2. **Fix GitHub rulesets drift** — Apply 3 missing rulesets, manage 2 unmanaged
3. **Fix Rust test environment** — OOM/compiler crashes in CI (may need runner specs)
4. **Fix Go test fixtures** — mikrotik_rate_limit_*.json files have "unexpected end of JSON input"
5. **Sync contract schema** — Add quota columns to orm-isp ISPSubscriber model AND http.ts sync payload
6. **Cut ai-runtime tags** — Tag 5 packages at current version or bump if breaking
7. **Add last_reviewed** — To knowledge/corpus packages; update backlog.json with pnpm refs

---

## PUBLICATION
- **PR Comment:** Posted to PR #475 (dev→main)
- **Tracking Issue:** "Governance:" issue updated with this report
- **State Transition:** NO-GO → comment only (CI gates decide promotion, not reviews)