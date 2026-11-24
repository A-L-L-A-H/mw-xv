# Consumer Experience Audit — 01. Repository Architecture

- **Scope:** MoonWitness XV monorepo (`apps/*`, `packages/*`, `scripts/*`)
- **Toolchain:** `bun@1.4.5`, Node `24.x` (`24.22.3` pinned in [`package.json`](../../../package.json)), TypeScript `~5.7.3`
- **Primary Architecture Diagram:** [`diagrams/architecture-layers.mmd`](diagrams/architecture-layers.mmd)
- **Workspace Dependency Source:** [`docs/architecture/diagrams/workspace-dependencies.mmd`](../../architecture/diagrams/workspace-dependencies.mmd)

---

## 1. Repository Architecture Map

MoonWitness XV is a bun workspace monorepo organized under two top-level workspace globs (`apps/*` and `packages/*`) declared in [`package.json`](../../../package.json).

- **`apps/` (9 active workspace apps + `apps/test-results` artifact folder):**
  - **Consumer Web & Desktop Surfaces:** [`apps/board`](../../../apps/board/package.json), [`apps/desktop`](../../../apps/desktop/package.json), [`apps/ui-catalog`](../../../apps/ui-catalog/package.json), [`apps/docs`](../../../apps/docs/package.json)
  - **Standalone Exempt UI:** [`apps/agent-observability`](../../../apps/agent-observability/package.json) (read-only/preserved)
  - **Non-UI Hosts:** [`apps/api`](../../../apps/api/package.json), [`apps/agent-sandbox`](../../../apps/agent-sandbox/package.json), [`apps/isp`](../../../apps/isp/package.json), [`apps/control-plane`](../../../apps/control-plane/package.json)
- **`packages/` (52 workspace packages):**
  - **Consumer Experience Core:** [`packages/ui`](../../../packages/ui/package.json), [`packages/assets`](../../../packages/assets/package.json), [`packages/types`](../../../packages/types/package.json), [`packages/client`](../../../packages/client/package.json)
  - **ORM Core & Domain Addons:** [`packages/orm`](../../../packages/orm/package.json) plus 35 `packages/orm-*` domain addons (`orm-base`, `orm-ai`, `orm-knowledge`, `orm-project`, `orm-workflow`, `orm-whatsapp`, `orm-cloud`, `orm-isp`, `orm-notification`, `orm-organization`, `orm-storage`, etc.) and `orm-cli`
  - **Platform, Knowledge & AI Execution:** `auth`, `jobs`, `logger`, `ai-runtime`, `ai-mcp`, `ai-evaluation`, `local-ai`, `knowledge`, `corpus`, `research`, `mcp-moonwitness`, `eslint-config`

---

## 2. Governance App Classifications

All workspace apps under `apps/*` must be classified in [`scripts/ui-governance-policy.json`](../../../scripts/ui-governance-policy.json) (enforced by [`scripts/check-board-shared-ui.mjs`](../../../scripts/check-board-shared-ui.mjs)).

| App | Package | Classification | Browser | Source Roots | Shared Source Roots |
| --- | --- | --- | --- | --- | --- |
| [`apps/board`](../../../apps/board/package.json) | `@moonwitness/board` | `product-adopter` | `true` | `src` | `—` |
| [`apps/desktop`](../../../apps/desktop/package.json) | `@moonwitness/desktop` | `product-adopter` | `true` | `desktop-web` | `apps/board/src` |
| [`apps/ui-catalog`](../../../apps/ui-catalog/package.json) | `@moonwitness/ui-catalog` | `reference-consumer` | `true` | `src` | `—` |
| [`apps/docs`](../../../apps/docs/package.json) | `@moonwitness/docs` | `publication-shell` | `true` | `src` | `—` |
| [`apps/agent-observability`](../../../apps/agent-observability/package.json) | `@moonwitness/agent-observability` | `standalone-exempt` | `true` | `—` | `—` |
| [`apps/api`](../../../apps/api/package.json) | `@moonwitness/api` | `non-ui` | `false` | `—` | `—` |
| [`apps/agent-sandbox`](../../../apps/agent-sandbox/package.json) | `@moonwitness/agent-sandbox` | `non-ui` | `false` | `—` | `—` |
| [`apps/isp`](../../../apps/isp/package.json) | `@moonwitness/isp` | `non-ui` | `false` | `—` | `—` |
| [`apps/control-plane`](../../../apps/control-plane/package.json) | `@moonwitness/control-plane` | `non-ui` | `false` | `—` | `—` |

> [!NOTE]
> `product-adopter` apps are forbidden from using raw JSX `<button>`, `<input>`, `<select>`, `<textarea>`, `<svg>`, direct `lucide-react`/`@heroicons/react`/`react-icons`/`react-feather` imports, or internal `@moonwitness/ui/dist/*` imports.

---

## 3. Package Dependency Graph (Consumer & Shared Layers)

1. **`@moonwitness/types`** (`packages/types`) — Zero workspace dependencies. Owns shared DTOs, skin metadata contracts (`BuiltinSkinId`, `ColorMode`, `SkinDensity`, `SkinId`, `SkinMetadata`, `ThemeRegistry`, `UserThemePreferences`), and platform contracts.
2. **`@moonwitness/assets`** (`packages/assets`) — Zero runtime workspace dependencies (`sharp`, `opentype.js`, `subset-font` as devDependencies). Owns canonical brand SVGs, WebP illustrations, SVG material masks, fonts (`fonts.css`), UI/ambience sounds, moon-city environment layers, and crew animation frames (`manifest.json` with 251 entries).
3. **`@moonwitness/ui`** (`packages/ui`) — Depends on `@moonwitness/types` (`workspace:*`). Peer dependencies: `react >=18`, `react-dom >=18`, `radix-ui >=1.6.7`, and optional `cmdk >=1.1.1`, `sonner >=2`. Exports 48 components (`./components/*`), 88 generated icons (`./icons` and `./icons/*`), `./themes`, `./components.css`, `./styles/tokens.css`, and 11 `./lib/*` modules.
4. **`@moonwitness/client`** (`packages/client`) — Depends on `@moonwitness/types` (`workspace:*`). Provides `MoonWitnessClient`, token storage abstraction, auth refresh lifecycle, and metadata-driven model CRUD (`searchRead`, `groupCount`, `write`, etc.).
5. **`@moonwitness/orm` & `packages/orm-*`** — Shared domain addons consumed by `apps/api` and `apps/desktop` (via `DESKTOP_ADDONS`), never by `apps/board/src` (`INV-009`). Custom domain routes live in `manifest.httpPlugins` (`INV-014`).

---

## 4. Consumer Application Inventory

| App | Framework & Build | Entry & Route Roots | Runtime Evidence / Tests | Key Integration Pattern |
| --- | --- | --- | --- | --- |
| [`apps/board`](../../../apps/board/package.json) | Next.js `16.4.6` App Router (`output: 'standalone'`), React `19.2.8`, Tailwind v4, `motion ^13.5.0`, `@tanstack/react-query ^5.104.0` | `src/app/` (29 Next.js route entries covering `/`, `/login`, `/register`, `/knowledge`, `/board`, `/board/m/[model]`, `/board/m/[model]/[id]`, `/board/ai/*`, `/board/cloud`, `/board/commercial`, `/board/projects`, `/board/stories/workbench`, `/board/studio`, `/board/whatsapp`, `/board/profile`, `/board/settings`) | `apps/board/e2e/resilience.spec.ts` (`pnpm test:e2e`), `apps/board/e2e/visual-audit.spec.ts` (`pnpm test:e2e:visual:matrix`) | Same-origin BFF `/api/session` + `next.config.ts` rewrites to `BOARD_API_TARGET` (`127.0.0.1:3000`); progressive desktop bridge via `window.__MW_DESKTOP__` |
| [`apps/desktop`](../../../apps/desktop/package.json) | Tauri v2 + Node ESM sidecar (`Fastify 5`, `better-sqlite3`) + Vite `7.0.0` webview (`desktop-web/vite.config.ts`) | [`apps/desktop/desktop-web/main.tsx`](../../../apps/desktop/desktop-web/main.tsx) + shims in `desktop-web/shims/` (`next/link`, `next/navigation`, `next/image`, `next/dynamic`) | [`apps/desktop/desktop-web/tests/routes.spec.ts`](../../../apps/desktop/desktop-web/tests/routes.spec.ts) (`pnpm desktop:test:web`; note policy path mismatch below) | Aliases `@` -> `apps/board/src`, renders `board-pages/*` + `app/board/ai/*` inside SPA `DesktopRouteSwitch`, auto-signs in via local sidecar (`local` / `local-offline-session`) |
| [`apps/ui-catalog`](../../../apps/ui-catalog/package.json) | Vite `8.3.3`, React `19.2.8`, `@tailwindcss/vite ^4.3.3` | [`apps/ui-catalog/src/main.tsx`](../../../apps/ui-catalog/src/main.tsx) -> [`catalog.tsx`](../../../apps/ui-catalog/src/catalog.tsx) (lazy sections: `SceneLab`, `FXLab`, `AssetBrowser`, `AssetDiagnostics`) | `apps/ui-catalog/tests/catalog.spec.ts` (`pnpm test:ui-catalog`), `apps/ui-catalog/tests/bundle-budget.test.mjs` (`pnpm test:ui-budget`) | Static interactive specimen gallery & Playwright visual/axe/CLS regression harness |
| [`apps/docs`](../../../apps/docs/package.json) | Vite `8.3.3`, React `19.2.8`, `react-router ^8.4.0`, `react-markdown ^10.1.0` | [`apps/docs/src/main.tsx`](../../../apps/docs/src/main.tsx) -> [`portal.tsx`](../../../apps/docs/src/portal.tsx) | `pnpm docs:publication:check`, `pnpm --filter @moonwitness/docs test` | Bundles `dist/docs/guide.bundle.json` and embeds built `@moonwitness/ui-catalog` under `/components/` |

---

## 5. Shared UI Dependency Map

Measured via `node scripts/check-board-shared-ui.mjs --all-product-apps` and `node scripts/check-ui-design-system.mjs --json`:

| Metric | `apps/board` | `apps/desktop` | `apps/ui-catalog` | `apps/docs` |
| --- | ---: | ---: | ---: | ---: |
| `@moonwitness/ui/components/*` available | 48 | 48 | 48 | 48 |
| Static component subpaths imported | 37 | 36 | 39 | 1 (`button`) |
| Route-reachable named component usages | 37 | 36 | 39 | 1 |
| Unused `@moonwitness/ui` components | 11 | 12 | 9 | 47 |
| Reachable local files from route entries | 130 | 109 | — | — |
| Policy violations (`raw-native-control`, `raw-svg`, etc.) | 0 | 0 | 0 | 0 |

- **Components unused in `apps/board` (11):** `artwork-frame`, `avatar`, `character-preview`, `field`, `filter-facet-bar`, `kanban-board`, `layered-scene`, `pagination`, `scene-particles`, `scene-transitions`, `sprite-player`.
- **Components unused in `apps/desktop` (12):** Same 11 as `apps/board` plus `paper-note` (because `apps/desktop` does not mount the public marketing homepage `apps/board/src/app/page.tsx`).
- **Components missing from `apps/ui-catalog` JSX showcase (9):** `date-picker`, `label`, `log-console`, `mode-picker`, `number-input`, `smart-button-box`, `status-bar`, `tag-input`, `update-banner`.
- **Knip-protected public APIs** ([`scripts/ui-governance-policy.json`](../../../scripts/ui-governance-policy.json)): `KanbanBoard` (`./components/kanban-board`) and `FilterFacetBar` (`./components/filter-facet-bar`) are retained as public APIs despite zero `apps/board` usage (both are referenced in `apps/ui-catalog`).
- **Frozen child-class override debt (23 findings):** Tracked via SHA-256 fingerprints in `scripts/ui-governance-policy.json` (`apps/board/src/app/global.css`: 4, `apps/board/src/index.css`: 7, `apps/ui-catalog/src/styles.css`: 12). New or modified `.mw-ui-*` child overrides fail CI immediately.
- **Legacy `--ink` alias debt:** `0` internal occurrences in `packages/ui/src`; `41` consumer occurrences remain in report-only mode (`aliasCanonicalization.enforcement = "report-only"`).

---

## 6. Existing Visual & Asset Architecture

- **Design Token & Skin Core:** [`packages/ui/src/styles/tokens.css`](../../../packages/ui/src/styles/tokens.css) (371 lines) defines brand palette (`--mw-paper: #f3efe4`, `--mw-ink: #0d0d0d`, `--mw-yellow: #ffe031`, `--mw-magenta: #ff2e88`, `--mw-signal-blue: #00b8f0`, `--mw-violet: #c084fc`), semantic colors, readable contrast variants (`--mw-*-readable`), motion timings, and grunge clip polygons.
- **Component Stylesheet:** [`packages/ui/src/styles/components.css`](../../../packages/ui/src/styles/components.css) (2,832 lines, 181 `.mw-ui-*` classes) styles all 48 primitives, effects, and overlays (`INV-007`).
- **Built-in Skins ([`packages/ui/src/themes/index.ts`](../../../packages/ui/src/themes/index.ts)):** `moonwitness-ink` (default), `moonwitness-compact`, `moonwitness-high-contrast`, supporting `light`/`dark` modes and `comfortable`/`compact` densities, initialized pre-paint by `createSkinInitScript()`.
- **Asset Pipeline ([`packages/assets/manifest.json`](../../../packages/assets/manifest.json)):** 251 catalogued assets across `brand`, `fonts` (`Anton`, `Space Grotesk`, `JetBrains Mono`, `Road Rage`, `MoonWitness Grunge` declared in [`packages/assets/fonts.css`](../../../packages/assets/fonts.css)), `icons` (88 SVG icons compiled into TSX by `packages/ui/scripts/generate-icons.mjs`), `illustrations` (WebP/SVG), `materials` (torn edges, tape strips, halftone tiles, splatter, stamps), `sounds` (3 UI SFX + 4 ambience tracks), `animation` (4 crew-01 clips × 4 SVG frames), `environments` (`moon-city`), and `scenes`.
- **Board Asset Sync:** [`scripts/copy-board-public-assets.mjs`](../../../scripts/copy-board-public-assets.mjs) copies `brand`, `illustrations`, `materials`, `sounds`, `animation`, `environments`, `scenes`, and `favicon.svg` from `packages/assets` into `apps/board/public` before `dev`/`build`.

---

## 7. Routing, State & API Integration

- **Board Auth & Session BFF:** [`apps/board/src/lib/client.ts`](../../../apps/board/src/lib/client.ts) constructs `MoonWitnessClient` with `CookieTokenStorage` in same-origin web mode, backed by [`apps/board/src/app/api/session/route.ts`](../../../apps/board/src/app/api/session/route.ts) (`HttpOnly`, `SameSite=Strict`, `mw_board_session` cookie). In desktop mode (`window.__MW_DESKTOP_API_URL__`), the client targets the loopback Fastify sidecar (`127.0.0.1:4242`) with `storageKey: 'mw-board-session'`.
- **API Proxy & Security Headers:** [`apps/board/next.config.ts`](../../../apps/board/next.config.ts) proxies `/admin/*`, `/api/*`, `/auth/*`, `/jsonrpc/*`, `/health*`, `/livez`, `/readyz`, `/metrics`, `/notifications*`, `/whatsapp/*`, `/workflows*` to `BOARD_API_TARGET` (`http://127.0.0.1:3000`) and enforces strict CSP (`frame-ancestors 'none'`, `object-src 'none'`, `connect-src 'self'`).
- **Provider Stack ([`apps/board/src/providers.tsx`](../../../apps/board/src/providers.tsx) & [`apps/board/src/app/layout.tsx`](../../../apps/board/src/app/layout.tsx)):** `SkinProvider` -> `SoundProvider` -> `QueryClientProvider` (TanStack Query, `retry: 1`, `refetchOnWindowFocus: false`) -> `MotionConfig reducedMotion="user"` -> `TooltipProvider` -> `AuthProvider`.
- **Desktop Webview Parity (`INV-009`):** [`apps/desktop/desktop-web/main.tsx`](../../../apps/desktop/desktop-web/main.tsx) reuses `apps/board/src/board-pages/*` via Vite `@` alias and lightweight `next/*` shims, wrapping them in `<DesktopChrome />`, `DesktopErrorBoundary`, and `window.__MW_DESKTOP__` (`DesktopCapabilityBridge` in [`apps/board/src/lib/desktop-bridge.ts`](../../../apps/board/src/lib/desktop-bridge.ts)).

---

## 8. Governance Gates & Bundle Budgets

1. **Shared UI Adoption & Policy Gate ([`scripts/check-board-shared-ui.mjs`](../../../scripts/check-board-shared-ui.mjs)):** `pnpm board:ui:check` / `--all-product-apps`. Validates `ui-governance-policy.json`, app classifications, component reachability, and forbids raw native controls/SVGs/external icon packs in `product-adopter` apps.
2. **Design System & Debt Ratchet Gate ([`scripts/check-ui-design-system.mjs`](../../../scripts/check-ui-design-system.mjs)):** `pnpm ui:design:check` (strict mode: `pnpm ui:design:audit`). Checks missing exports, cyclic tokens, undefined `--mw-*` references, hardcoded visual colors/palette classes, composite shadow misuse, duplicate chalk masks, global `.mw-ui-*` overrides, and freezes the 23-entry child-class debt baseline.
3. **Desktop Non-Overlap Membrane ([`scripts/check-desktop-non-overlap.mjs`](../../../scripts/check-desktop-non-overlap.mjs)):** `pnpm desktop:ui:check`. Ensures `apps/desktop/src` never calls `defineModel`/`defineAddon` and `apps/board/src` never imports `@moonwitness/orm`, `tauri`, `better-sqlite3`, `node-pty`, or `node:*` runtime modules.
4. **Board Bundle Budget ([`scripts/check-board-bundle.mjs`](../../../scripts/check-board-bundle.mjs) & [`apps/board/bundle-budget.json`](../../../apps/board/bundle-budget.json)):**

| Route | JS Raw Max | JS Gzip Max | CSS Raw Max | CSS Gzip Max |
| --- | ---: | ---: | ---: | ---: |
| `homepage` (`/`) | 1,000,000 B | 300,000 B | 205,000 B | 40,000 B |
| `board` (`/board`) | 1,800,000 B | 550,000 B | 250,000 B | 60,000 B |
| `login` (`/login`) | 1,200,000 B | 360,000 B | 220,000 B | 50,000 B |
| `model` (`/board/m/[model]`) | 1,800,000 B | 550,000 B | 250,000 B | 60,000 B |
| Interface Audio (`ui` sounds) | 50,000 B combined | — | — | — |

5. **UI Catalog Bundle Budget ([`scripts/check-ui-catalog-budget.mjs`](../../../scripts/check-ui-catalog-budget.mjs) & [`apps/ui-catalog/bundle-budget.json`](../../../apps/ui-catalog/bundle-budget.json)):**

| Group / Section | JS Raw Max | JS Gzip Max | CSS Raw Max | CSS Gzip Max |
| --- | ---: | ---: | ---: | ---: |
| `initial` | 540,000 B | 158,000 B | 150,000 B | 27,000 B |
| `lazy` | 40,000 B | 14,000 B | 1 B | 1 B |
| `total` | 570,000 B | 168,000 B | 143,360 B | 26,576 B |
| `scene` (`SceneLab.tsx`) | 23,000 B | 7,800 B | — | — |
| `assets` (`AssetBrowser.tsx`) | 5,000 B | 2,000 B | — | — |
| `fxlab` (`FXLab.tsx`) | 10,000 B | 3,600 B | — | — |
| `diagnostics` (`AssetDiagnostics.tsx`) | 2,500 B | 1,000 B | — | — |

---

## 9. Technical Limitations & Repository Invariants

All 18 persistent repository invariants from [`.agents/rules/learned-invariants.md`](../../../.agents/rules/learned-invariants.md) apply to any consumer-experience evolution:

| ID | Invariant Summary | Relevance to Consumer Experience Work |
| --- | --- | --- |
| `INV-001` | PowerShell 5.1 chaining via `; if ($?) { ... }` | All Windows local validation scripts |
| `INV-002` | `apps/api` Vitest `--maxWorkers=1 --no-file-parallelism` | Running local API server/tests during E2E audits |
| `INV-003` | Pinned GitHub Actions SHAs (`automation:check:action-pins`) | CI workflow updates |
| `INV-004` | Thin API addon boundary (`LEGACY_*_ALLOWLIST` empty) | Any backend endpoints supporting UI features |
| `INV-005` | `engines.node` pinned to `"24.x"` everywhere | Manifest edits |
| `INV-006` | Recursive route discovery + `docs:generate` / `architecture:generate` | Syncing docs/diagrams after package changes |
| `INV-007` | `packages/ui/src/styles/components.css` integrity (`pnpm test:ui`) | Editing shared CSS layers |
| `INV-008` | Hybrid swarm routing & disjoint file sharding | Multi-agent UI execution |
| `INV-009` | Zero-overlap desktop harness membrane (`pnpm desktop:ui:check`) | Sharing UI between `board` and `desktop` |
| `INV-010` | Diff-scoped preflight vs single-pass generator sync | Swarm landing hygiene |
| `INV-011` | Static Fastify route string literals starting with `'/'` | API reference extraction |
| `INV-012` | Inline `Command` `defaultValue='**none**'` to prevent scroll hijack/CLS | Catalog & inline command palettes |
| `INV-013` | Package `build` scripts execute inside own package dir | Workspace builds |
| `INV-014` | Addon custom routes must use `manifest.httpPlugins` | Any new API endpoints for consumer features |
| `INV-015` | Explicit `30_000ms+` Vitest timeouts for full-addon `buildApp()` | API integration suites |
| `INV-016` | Standalone web subpackage Playwright alignment & React dedup | Multi-consumer Vite builds |
| `INV-017` | UI Catalog bundle budget & responsive `SpritePlayer` (`min(100%, width)` + `aspectRatio`) | New catalog specimens or FX components |
| `INV-018` | `desktop:build` closure (`@moonwitness/desktop...`) & `testTimeout >= 30000` | Desktop build & test verification |

### Observed Architectural Gaps
1. **Desktop E2E policy path mismatch:** `scripts/ui-governance-policy.json` declares `apps/desktop/e2e/desktop-web.spec.ts` for `desktop-webview` runtime evidence, causing `check-ui-design-system.mjs` to report `missing test files`, whereas the actual test resides at [`apps/desktop/desktop-web/tests/routes.spec.ts`](../../../apps/desktop/desktop-web/tests/routes.spec.ts) (configured by `apps/desktop/playwright.web.config.ts`).
2. **`apps/desktop` `@moonwitness/ui` dependency placement:** [`apps/desktop/package.json`](../../../apps/desktop/package.json) declares `@moonwitness/ui` in `devDependencies` (sufficient for Vite bundling, passes `hasUiDependency`), but lacks `@moonwitness/assets` as an explicit dependency—relying on `apps/board/public` as `publicDir`.
3. **High `apps/board` unused visual-component ratio:** 11 of 48 `@moonwitness/ui` components (including `ArtworkFrame`, `CharacterPreview`, `LayeredScene`, `SceneParticles`, `SceneTransitions`, `SpritePlayer`, `KanbanBoard`, `FilterFacetBar`, `Pagination`, `Avatar`, `Field`) are unused in `apps/board`, concentrating the visual brand on `/` and `/login` while operational `/board/*` routes rely on flat CSS panels.
4. **41 consumer `--ink` alias occurrences:** `apps/board` and `apps/ui-catalog` still reference `--ink*` CSS variables instead of canonical `--mw-*` tokens (`report-only`).
