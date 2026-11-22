# W8-001 — Base addon visual coverage evidence

- Source contract: `evidence/domains/base.md` identifies the real generic model route and the public base models (partner, company, user, activity, attachment, tag), API-derived view metadata, and menu permissions.
- Added canonical UI icon coverage for actual `base.activity`, `base.attachment`, and `base.tag` model menu entries. Existing partner/company/user icon mappings remain; all use typed exports from `@moonwitness/ui/icons` with no duplicate art.
- The real generic model consumer retains live loading skeletons, empty/no-results states, retryable record-fetch errors, create/write controls gated by API `views.permissions`, and now distinguishes actual 403 access denial, 404 model unavailability, and transient view-load failures.
- No people, company, activity, attachment, or tag records were invented. No new route was added; the UI uses the existing generic `/board/m/[model]` consumer.
- `pnpm --filter @moonwitness/board typecheck` — exit 0.
- `pnpm board:ui:check` — exit 0 (6 static boundary tests plus shared UI scan).
- `node --test scripts/board/model-icon-registry.test.mjs scripts/board/model-view-error-state.test.mjs` — exit 0 (3 tests).
- `pnpm test:assets` — exit 0 (38 tests; canonical assets/provenance/docs check).
- `pnpm test:ui-catalog` — exit 0 (26 tests, including WCAG 2.1 A/AA checks in both themes; shared catalog consumer remains green).
- Residual issue: Board API-driven states were source-reviewed and typechecked; no authenticated live-data screenshot was captured in this task.
