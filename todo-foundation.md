# MoonWitness Foundation Hardening & Stability Todo

Checklist penguatan fondasi arsitektur, keamanan, CI/CD, reliabilitas runtime, dan DX lintas monorepo.

## P0 — Kritis (Selesai)

- [x] **Mode scanner media WhatsApp eksplisit pasca-hapus ClamAV:** tambahkan `DisabledAttachmentScanner` pada [apps/api/src/whatsapp/clamav-scanner.ts](apps/api/src/whatsapp/clamav-scanner.ts) bila `WHATSAPP_MEDIA_SCAN=disabled` diset eksplisit (tetap fail-closed `null` bila keduanya kosong, dan tetap aktifkan `ClamAvScanner` bila `WHATSAPP_CLAMAV_URL` diset). Dikonfigurasi pada `.env.example`, `.env.production.example`, `docker-compose.production.yml`, dan `docker-compose.prd.yml`.
- [x] **Hardening HTTP API & proses:** allowlist `CORS_ORIGINS` (deny by default di production), security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `HSTS` prod), nonaktifkan Swagger UI `/docs` di production kecuali `ENABLE_API_DOCS=true`, sanitasi pesan error 500 di production, `trustProxy` otomatis di production, serta handler `unhandledRejection`/`uncaughtException` di [apps/api/src/app.ts](apps/api/src/app.ts) & [apps/api/src/server.ts](apps/api/src/server.ts).
- [x] **Security headers Board & sinkronisasi Nginx:** tambahkan `headers()` di [apps/board/next.config.ts](apps/board/next.config.ts) dan perbarui [deploy/nginx-board.conf](deploy/nginx-board.conf) untuk Next.js standalone (`board:8080`), `client_max_body_size 15m`, serta proxy penuh `/api`, `/auth`, `/admin`, `/whatsapp`, `/notifications`, `/workflows`, `/jsonrpc`, dan health endpoints.
- [x] **CI Quality Gate & pre-push:** tambahkan [.github/workflows/ci.yml](.github/workflows/ci.yml) dengan action SHA-pinned untuk push/PR `dev` & `main` (action-pins, roadmap, `board:ui:check`, `api:addon:check`, assets, UI, build, budgets, unit tests) serta perkuat [.githooks/pre-push](.githooks/pre-push) dengan `api:addon:check` & `board typecheck`.
- [x] **Wajib Addon-First & Thin `apps/api` ([ADR 0006](docs/decisions/0006-mandatory-addon-thin-api.md)):** seluruh assembly addon & route dipusatkan di [apps/api/src/addons/registry.ts](apps/api/src/addons/registry.ts) agar [apps/api/src/app.ts](apps/api/src/app.ts) tetap tipis; ditegakkan otomatis lewat `pnpm api:addon:check` ([scripts/check-api-addon-boundary.mjs](scripts/check-api-addon-boundary.mjs)) di pre-push & CI.
- [x] **Hardening ORM & API core:** blokir seluruh prefix `knowledge.*` di [apps/api/src/auth/policy.ts](apps/api/src/auth/policy.ts), perbaiki whitelist `BaseModel.search_read()` di [packages/orm/src/base.model.ts](packages/orm/src/base.model.ts), hilangkan bocoran daftar model di `modelNotFound`, dukung `config: { public: true }` & gabungkan SQL JOIN di [apps/api/src/plugins/auth.plugin.ts](apps/api/src/plugins/auth.plugin.ts), cache `Environment.bindModel()`, auto-index komposit `(company_id, active, id)` + `field.index`, chained multi-step `addon.upgrade`, cache reverse-FK `findReference()`, serta optimistic concurrency (`If-Match` / `x-expected-write-date` → `409 Conflict`).

## P1 — Stabilitas, Skala & Maintainability

- [ ] **Ekstrak legacy `apps/api/src/whatsapp/{models,manifest}.ts` ke `packages/orm-whatsapp`:** pindahkan 2 file allowlist terakhir ke workspace addon package lalu kosongkan allowlist di `scripts/check-api-addon-boundary.mjs`.

- [ ] **Pecah god-file `apps/api/src/routes/whatsapp.routes.ts` (~5.700 baris):** pisahkan ke modul sub-domain (`accounts`, `conversations`, `messages`, `groups`, `media`, `statuses`, `webhooks`) tanpa mengubah kontrak route atau regresi `pnpm test:whatsapp`.
- [ ] **Pecah god-file `apps/board/src/board-pages/whatsapp-page.tsx` (~4.450 baris):** ekstrak ke komponen domain terpisah (`InboxList`, `ConversationTimeline`, `MessageComposer`, `GroupProfileDrawer`, `PairingPanel`, `MediaPreview`).
- [ ] **Aktifkan healthcheck worker di production:** ganti `healthcheck: { disable: true }` pada `jobs-worker`, `jobs-scheduler`, dan `outbox-worker` di `docker-compose.production.yml` / `docker-compose.prd.yml` dengan probe health/heartbeat nyata agar worker hang otomatis di-restart.
- [ ] **Tambahkan handler `unhandledRejection`/`uncaughtException` pada worker commands:** konsistenkan `jobs-worker.ts`, `jobs-scheduler.ts`, dan `outbox-worker.ts` melalui `createProcessShutdownController`.
- [ ] **Pisahkan DDL migrasi dari boot aplikasi:** buat command migrasi pre-deploy dengan PostgreSQL advisory lock agar multi-instance rolling deploy tidak memicu concurrent DDL saat startup `installAddons()`.
- [ ] **Seragamkan versi Node LTS antar lokal, CI, dan Docker:** putuskan 1 versi Node LTS tetap untuk `Dockerfile`, `.github/workflows/*.yml`, dan `engines.node`.
- [ ] **Distributed rate-limit store untuk multi-replica API:** pertimbangkan PostgreSQL/Redis store untuk `@fastify/rate-limit` bila API dijalankan >1 instance.
- [ ] **Sinkronkan test/checker workflow yang merujuk file `.github/workflows/*` lama:** perbarui `scripts/check-workflow-checkout-trust.mjs` dan 3 test di `pnpm test:roadmap` yang masih mengharapkan workflow lama yang sudah dihapus saat reduksi CI 2026-10-25.

## P2 — DX, Performa Build & Isolasi Kerja

- [ ] **Build caching monorepo (Turborepo):** tambahkan `turbo.json` untuk caching `build`, `typecheck`, `lint`, dan `test` di 26 workspace packages tanpa mengganggu skrip CI/release existing.
- [ ] **Bersihkan 6 warning `oxlint` di `apps/board`:** hilangkan 3 warning `react(set-state-in-effect)` di `whatsapp-page.tsx` agar React Compiler dapat mengoptimalkan komponen secara penuh, plus `only-export-components` / unused param di `e2e/whatsapp.spec.ts`.
- [ ] **Isolasi paralel lintas track:** gunakan branch/worktree terpisah per track pekerjaan (`dev` untuk K-series, branch fitur untuk UI/refactor) dan aktifkan required check `CI Quality Gate` pada branch protection GitHub.
