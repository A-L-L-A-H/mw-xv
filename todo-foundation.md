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

- [x] **Ekstrak legacy `apps/api/src/whatsapp/{models,manifest}.ts` ke `packages/orm-whatsapp`:** 13 model + view dipindah ke `@moonwitness/orm-whatsapp` dan allowlist di `scripts/check-api-addon-boundary.mjs` dikosongkan (`new Set()`).

- [ ] **Pecah god-file `apps/api/src/routes/whatsapp.routes.ts` (~5.400 baris):** `route-helpers.ts` dan `routes/whatsapp/media.routes.ts` telah diekstrak; pemecahan penuh sub-domain lainnya (`accounts`, `conversations`, `messages`, `groups`, `statuses`, `webhooks`) tetap berlanjut bertahap.
- [ ] **Pecah god-file `apps/board/src/board-pages/whatsapp-page.tsx` (~4.450 baris):** ekstrak ke komponen domain terpisah (`InboxList`, `ConversationTimeline`, `MessageComposer`, `GroupProfileDrawer`, `PairingPanel`, `MediaPreview`).
- [x] **Aktifkan healthcheck worker di production:** `docker-compose.production.yml` dan `docker-compose.prd.yml` memakai probe `/readyz` pada port `3011` (`jobs-worker`), `3012` (`jobs-scheduler`), dan `3013` (`outbox-worker`).
- [x] **Tambahkan handler `unhandledRejection`/`uncaughtException` pada worker commands:** handler fatal terintegrasi lewat [apps/api/src/lifecycle/process-shutdown.ts](apps/api/src/lifecycle/process-shutdown.ts) dan dibersihkan di `dispose()`.
- [x] **Pisahkan DDL migrasi dari boot aplikasi:** ditambahkan [apps/api/src/commands/db-migrate.ts](apps/api/src/commands/db-migrate.ts) dengan `pg_advisory_lock(77490122)` serta mode boot `SKIP_BOOT_MIGRATIONS=true`.
- [ ] **Seragamkan versi Node LTS antar lokal, CI, dan Docker:** `engines.node` dipin pada `22.x`; lingkungan host lokal masih menjalankan Node `v24.22.1`.
- [x] **Distributed rate-limit store untuk multi-replica API:** ditambahkan `PostgresRateLimitStore` di [apps/api/src/plugins/rate-limit-store.ts](apps/api/src/plugins/rate-limit-store.ts) dan diaktifkan lewat `RATE_LIMIT_STORE=postgres` di [apps/api/src/app.ts](apps/api/src/app.ts).
- [x] **Sinkronkan test/checker workflow yang merujuk file `.github/workflows/*` lama:** diperbarui pada commit `06aaf10` untuk `scripts/check-workflow-checkout-trust.mjs` dan `pnpm test:roadmap`.

## P2 — DX, Performa Build & Isolasi Kerja

- [x] **Build caching monorepo (Turborepo):** `turbo.json` aktif untuk caching task monorepo tanpa mengganggu skrip CI/release existing.
- [ ] **Bersihkan 6 warning `oxlint` di `apps/board`:** tersisa 5 warning di `apps/board` (`only-export-components` metadata route dan 3 `react(set-state-in-effect)` di `whatsapp-page.tsx`).
- [x] **Isolasi paralel lintas track:** ruleset `protect-main` (id `27796649`) dan `protect-dev` (id `27796651`) aktif di GitHub beserta workflow CI `quality-and-build`, `unit-tests`, `knowledge-gate`, dan `postgres-integration`.
