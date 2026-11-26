## Fixer Queue (updated 2026-11-25T19:20:00+00:00)

### P0 (fix now)
- #284 Audit: Missing MILLISECONDS_PER_DAY in @moonwitness/types and raw duration handling [score: 70] - Export constant from types, replace magic numbers, <1h effort
- #283 Audit: Error-to-message normalization duplicated across 30+ sites and 4 private helpers [score: 70] - Consolidate to shared utility, high blast radius (30+ sites), <1d effort
- #282 Audit: Private-mesh CIDR and loopback validators still duplicated in ai-runtime [score: 70] - Consolidate validators, affects ai-runtime/local-ai/orm-cloud, <1d effort
- #279 Audit: trimTrailingSlashes helper duplicated across 6 packages [score: 70] - Consolidate to shared utility, affects 6 packages, <1h effort

### P1 (fix soon)
- #340 [CODE-QUALITY] todo-density: 0 findings (10 matches, 0 actual TODOs) [score: 65]
- #338 [CODE-QUALITY] bundle-budget: 2 findings (build required) [score: 65]
- #335 [CODE-QUALITY] dead-code: 10 findings [score: 65]
- #333 [CODE-QUALITY] tsc-errors: 1019 findings [score: 65]
- #286 Audit: Desktop ISP proxy defaults to port 8091 instead of 3002 and API OpenAPI hardcodes localhost:3000 [score: 65]
- #281 Audit: DEFAULT_TIMEOUT_MS hardcoded in 3 packages with different values (5s/15s/30s) [score: 65]
- #280 Audit: mcp-moonwitness hardcodes localhost:3000 instead of using @moonwitness/types service endpoints [score: 65]
- #200 Audit: Mirrored WhatsApp runtime modules in apps/api vs packages/orm-whatsapp [score: 60]
- #344 Gate failure: 330/merge [73680d983a19] [score: 55]
- #343 Gate failure: dev [2a12c4a00e2d] [score: 55]
- #339 [CODE-QUALITY] broken-links: 1 finding [score: 55]
- #337 [CODE-QUALITY] circular-deps: 0 findings [score: 55]
- #336 [CODE-QUALITY] high-complexity: 0 findings [score: 55]
- #213 Audit: orm-* test scripts inconsistent (tsc-check gate applied to only 11 of 30 packages) [score: 55]

### P2 (backlog)
0 issues
