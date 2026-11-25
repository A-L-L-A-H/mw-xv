# W10-004 — Homepage visual and accessibility evidence

Date: 2026-11-25 (Asia/Jakarta)

The production Moon City homepage has desktop, tablet and mobile coverage in the official `visual-audit.spec.ts` matrix. After the auth hydration fix, its homepage case passes Chromium and WebKit. Firefox renders the page but crashes in Axe at the mobile viewport; an isolated Firefox rerun reproduced the crash. The standalone Save-Data check passes Chromium, Firefox and WebKit. Reduced-motion and static fallback assertions remain in `public-home.spec.ts`; the UI Catalog scene harness covers desktop/mobile composition, layer inspection, keyboard/static controls and scene specimens without claiming nonexistent production routes.

Known limitations: full operational Board validation is still blocked by W9-006. The latest official matrix is 33 passed / 9 failed (seven Firefox, two WebKit). The WebKit failures are dashboard snapshot mismatches; Firefox has two dashboard snapshot mismatches and five page crashes during Axe-heavy/mobile/story flows. `/signals` and `/archive` remain unimplemented routes; their images remain catalog-only specimens. Whole-product accessibility acceptance cannot be claimed while the official matrix is red. See W9-006 evidence for detail.
