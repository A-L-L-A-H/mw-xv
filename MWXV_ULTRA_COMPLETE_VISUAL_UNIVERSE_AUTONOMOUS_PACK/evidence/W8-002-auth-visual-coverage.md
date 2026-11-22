# W8-002 — Auth addon visual coverage evidence

- Source audit `evidence/domains/auth.md` confirms `auth.refresh_token` is the only auth model, with no model menu/session-list screen. Existing real consumers are `/login` and `/register`; credential/session operations remain in the auth API.
- Added a labelled UI Catalog boundary specimen for the routes that do not exist: it states session-management is not exposed and contains no token fixture. The specimen reuses the canonical `auth-login-desktop.webp` asset as decoration and labels only source-verified routes and states.
- The existing Board auth page continues to own idle/submitting/API-error states, real credential labels, busy semantics, API response text, and password visibility. No remember-me, reset, lockout, or session route was invented.
- `pnpm board:ui:check` — exit 0 (6 static boundary tests plus shared UI scan).
- `pnpm --filter @moonwitness/board typecheck` — exit 0 (run with the adjacent W8-001 Board consumer changes).
- `pnpm test:assets` — exit 0 (38 tests; auth artwork and existing provenance validated).
- `pnpm --filter @moonwitness/ui-catalog build` — exit 0.
- `pnpm ui:budget` — exit 0; JavaScript 504,348/524,288 raw bytes and 147,403/163,840 gzip bytes; stylesheet 131,065/131,072 raw bytes and 23,570/24,576 gzip bytes.
- `pnpm test:ui-catalog` — exit 0 (27 tests, including auth specimen and WCAG 2.1 A/AA checks for both themes).
- Residual issue: authenticated live API sign-in was not run in this task; existing Board E2E specs cover invalid credentials, busy state, and session behavior.
