# MoonWitness — Master Engineering Transformation TODO

> Checklist rekayasa kanonis di root repository untuk mentransformasi monorepo MoonWitness (`@moonwitness/*`) menjadi platform aplikasi modular bergaya Odoo yang terpadu dan siap produksi. Disusun dari audit langsung terhadap kode sumber `apps/*`, `packages/*`, `scripts/*`, `.github/workflows/*`, dan ADR terkait.

---

## 00 — Project Overview

### Tujuan Transformasi

Menyatukan backend Fastify 5 (`apps/api`), ORM programatis Objection/Knex (`packages/orm`), 11 package addon (`packages/orm-*`, `packages/auth`, `packages/jobs`), client SDK (`packages/client`), design system (`packages/ui`, `packages/assets`), dan frontend Next.js App Router (`apps/board`) ke dalam satu platform deklaratif berbasis metadata (Model, Schema Sync, Addon, View, Widget, Action, Menu, Domain, Security, dan Skin).

### Arsitektur Target Ringkas

1. **Core Runtime (`@moonwitness/orm` + `apps/api`):** Bootstrap tunggal yang memisahkan registrasi metadata in-memory (`registerAddons`) dari sinkronisasi DDL/seed transaksional (`installAddons`), dipakai seragam oleh server HTTP maupun seluruh worker (`jobs-worker`, `jobs-scheduler`, `outbox-worker`).
2. **ORM & Schema Management (`@moonwitness/orm`):** `Registry` + `Environment` + `Recordset` + `defineModel` + `extendModel`, field terkomputasi/tersimpan, hook `onchange`/`default_get`, constraint validator, domain relasional bertitik, dan sinkronisasi skema PostgreSQL/SQLite otomatis tanpa framework skrip migrasi SQL terpisah.
3. **Native Addon Engine (`@moonwitness/orm` + `packages/orm-*`):** Addon workspace mandiri yang memiliki model, ekstensi model, view, menu, action, rule keamanan, seed, dan `httpPlugins`, lengkap dengan lifecycle install/enable/disable/upgrade/uninstall terintegrasi `ir.feature_flag`.
4. **Model–View, Widget, Action, Menu & Domain Engines:** Registry multi-view dengan pewarisan `extendView` (`list`, `form`, `search`, `kanban`, `calendar`, `graph`, `pivot`), `FieldWidgetRegistry`, `ActionRegistry` + menu hierarkis + smart button, serta evaluator domain/context tunggal di `@moonwitness/types`.
5. **Security, API/RPC, Frontend & Skin Engine:** Kebijakan akses deklaratif tingkat model/record/field/action, upload lampiran streaming, paritas REST & JSON-RPC penuh, renderer dinamis `apps/board` tanpa hardcode model khusus, serta `ThemeRegistry` & Skin Engine runtime di `@moonwitness/ui`.

### Prinsip Kerja & Aturan Penyelesaian

1. **ORM Mengelola Evolusi Skema:** Perubahan DDL biasa (tabel, kolom, nullability, default, `CHECK` constraint enum, index, unique, FK) dikelola otomatis oleh `@moonwitness/orm` + `pnpm db:migrate`. Hook `addon.upgrade` hanya untuk transformasi data khusus. **Dilarang membuat framework skrip migrasi SQL terpisah.**
2. **Addon-First & Thin `apps/api` (`ADR-0006`):** Seluruh model domain, view, menu, dan manifest addon berada di `packages/*` (`pnpm api:addon:check`).
3. **Shared UI Wajib (`@moonwitness/ui` + `@moonwitness/assets`):** Seluruh kontrol UI, ikon, dan token di `apps/board` memakai package shared (`pnpm board:ui:check`), mempertahankan `apps/board` (`@moonwitness/board`) sebagai lokasi fisik peran `apps/web`.
4. **Satu Implementasi Kanonis per Engine:** Menghapus duplikasi tipe (`@moonwitness/client` vs `@moonwitness/types`) dan evaluator domain (`@moonwitness/client` vs `@moonwitness/orm`).
5. **Aturan Checklist:** `[x]` hanya untuk fitur yang sudah ada dan terverifikasi bukti kodenya. `[ ]` berarti belum selesai atau belum diverifikasi; setiap checkbox induk dan subtask bisa dicentang langsung secara independen.
6. **Legenda Prioritas:** **P0** Kritis/keamanan/integritas data · **P1** Fondasi inti & kontrak · **P2** Runtime platform & engine · **P3** Pengalaman UI, skin, DX & lanjutan.

### Ringkasan Progres & Penyelesaian per Fase

| Seksi     | Fase / Subsistem                     | Rentang ID Utama                | Prioritas  | Task Utama `[x]` | Task Utama `[ ]` | Subtask `[ ]` | Total Checkbox |
| :-------- | :----------------------------------- | :------------------------------ | :--------- | ---------------: | ---------------: | ------------: | -------------: |
| 01        | Baseline Fitur Terverifikasi         | `MW-BASE-001`–`MW-BASE-012`     | Baseline   |               12 |                0 |             0 |             12 |
| 03        | Core Runtime                         | `MW-CORE-001`–`MW-CORE-006`     | P0–P1      |                6 |                0 |             0 |             30 |
| 04        | ORM & Model Engine                   | `MW-ORM-001`–`MW-ORM-012`       | P1–P2      |               12 |                0 |             0 |             60 |
| 05        | ORM Schema Management                | `MW-SCHEMA-001`–`MW-SCHEMA-008` | P0–P1      |                8 |                0 |             0 |             40 |
| 06        | Native Addon Engine                  | `MW-ADDON-001`–`MW-ADDON-009`   | P1–P2      |                9 |                0 |             0 |             45 |
| 07        | Model–View Engine                    | `MW-VIEW-001`–`MW-VIEW-010`     | P1–P2      |               10 |                0 |             0 |             50 |
| 08        | Field Widget Engine                  | `MW-WIDGET-001`–`MW-WIDGET-007` | P2–P3      |                7 |                0 |             0 |             35 |
| 09        | Action & Menu Engine                 | `MW-ACT-001`–`MW-ACT-007`       | P2         |                7 |                0 |             0 |             35 |
| 10        | Domain & Context Engine              | `MW-DOM-001`–`MW-DOM-006`       | P1–P2      |                6 |                0 |             0 |             30 |
| 11        | Security & Identity                  | `MW-SEC-001`–`MW-SEC-008`       | P0–P1      |                8 |                0 |             0 |             40 |
| 12        | API & RPC Architecture               | `MW-API-001`–`MW-API-007`       | P1–P2      |                7 |                0 |             0 |             35 |
| 13        | Transformasi Backend (`apps/api`)    | `MW-BACK-001`–`MW-BACK-007`     | P1–P2      |                7 |                0 |             0 |             35 |
| 14        | Transformasi Frontend (`apps/board`) | `MW-WEB-001`–`MW-WEB-009`       | P2–P3      |                9 |                0 |             0 |             45 |
| 15        | Shared UI & Design System            | `MW-UI-001`–`MW-UI-006`         | P2–P3      |                6 |                0 |             0 |             30 |
| 16        | Skin & Theme Engine                  | `MW-SKIN-001`–`MW-SKIN-005`     | P3         |                5 |                0 |             0 |             25 |
| 17        | Konsolidasi Shared Packages          | `MW-PKG-001`–`MW-PKG-006`       | P1–P2      |                6 |                0 |             0 |             30 |
| 18        | Events, Jobs & Automation            | `MW-JOB-001`–`MW-JOB-005`       | P1–P2      |                5 |                0 |             0 |             25 |
| 19        | Konfigurasi, Storage & i18n          | `MW-CFG-001`–`MW-CFG-005`       | P1–P3      |                5 |                0 |             8 |             25 |
| 20        | Performa & Optimasi                  | `MW-PERF-001`–`MW-PERF-005`     | P2–P3      |                5 |                0 |             8 |             25 |
| 21        | Penguatan Keamanan & Reliabilitas    | `MW-HARD-001`–`MW-HARD-005`     | P0–P1      |                5 |                0 |             8 |             25 |
| 22        | Testing & Quality Assurance          | `MW-QA-001`–`MW-QA-006`         | P1–P2      |                6 |                0 |             8 |             30 |
| 23        | Developer Experience & Tooling       | `MW-DX-001`–`MW-DX-004`         | P2–P3      |                4 |                0 |             0 |             20 |
| 24        | Dokumentasi                          | `MW-DOC-001`–`MW-DOC-004`       | P2–P3      |                4 |                0 |             4 |             20 |
| 25        | CI/CD & Kesiapan Produksi            | `MW-CICD-001`–`MW-CICD-005`     | P0–P2      |                0 |                5 |            20 |             25 |
| 26        | Integrasi Platform End-to-End        | `MW-E2E-001`–`MW-E2E-016`       | P0–P1      |               16 |                0 |             0 |             64 |
| 27        | Audit Akhir & Pembersihan            | `MW-AUDIT-001`–`MW-AUDIT-004`   | P1–P3      |                0 |                4 |            16 |             20 |
| 28        | Definition of Done                   | `MW-DOD-001`–`MW-DOD-005`       | Gate Akhir |                0 |                5 |             0 |              5 |
| **Total** | **Seluruh Seksi Terlacak**           | **`MW-BASE-*` + `MW-*`**        | **P0–P3**  |          **175** |           **14** |        **72** |        **861** |

---

## 01 — Repository Discovery & Baseline

### Inventaris Workspace (Terukur via `node scripts/audit-workspace.mjs`)

1. **Cakupan Monorepo:** 27 entri workspace (root `moonwitness-monorepo` + 4 apps + 22 packages), 1.234 file sumber, **0** siklus import runtime, **0** siklus dependency workspace, dan **5** siklus import file-level type-only (`packages/local-ai/src/index.ts -> suggestion-generation.ts`, `packages/orm-knowledge/src/research-release-validation.ts -> research-release.ts`, `packages/orm-storage/src/index.ts -> s3.ts`, `packages/orm/src/base.model.ts -> environment.ts`, `packages/orm/src/base.model.ts -> model-definition.ts`).
2. **Model Addon Terdaftar:** **73 model** lintas 11 manifest addon (`base`: 23, `auth`: 1, `jobs`: 4, `notification`: 3, `organization`: 4, `orm-storage`: 0, `workflow`: 4, `request`: 1, `orm-integration`: 2, `orm-whatsapp`: 13, `knowledge`: 18).
3. **Pemeriksaan Boundary Baseline (Lulus):** `node scripts/check-api-addon-boundary.mjs` (0 pelanggaran), `node scripts/check-board-shared-ui.mjs` (0 pelanggaran), `node scripts/roadmap/validate-roadmap.mjs` (213 task tervalidasi: 148 seri M + 65 seri K; 81 terbuka).
4. **Workflow CI Aktif (`.github/workflows/`):** 6 file (`ci.yml`, `pages.yml`, `release-orchestrate.yml`, `release-plan.yml`, `release-prepare.yml`, `release.yml`). Catatan temuan: `scripts/platform-audit.mjs` dan `scripts/check-gitleaks-config.mjs` masih merujuk nama workflow lama yang sudah pensiun (`gitleaks.yml`, `codeql.yml`, `browser-matrix.yml`, `deep-regression.yml`, `platform-audit.yml`).

### Audit Aplikasi (`apps/*`)

| App               | Nama Package              | Peran & Implementasi Saat Ini                                                                                                                                                            | Temuan Audit & Gap                                                                                                                                                                                                                                                                                                                                                                                                |
| :---------------- | :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | `@moonwitness/api`        | Host Fastify 5 REST/JSON-RPC, auth plugin, CRUD generik, route domain, dan 13 CLI/worker (`server.ts`, `db-migrate.ts`, `jobs-worker.ts`, `jobs-scheduler.ts`, `outbox-worker.ts`).      | `app.ts` (306 baris) tipis, tetapi `registry.ts` melewatkan `model.knex`/`views`/`menus`/`postInstall` saat `SKIP_BOOT_MIGRATIONS=true`. `generic.routes.ts` 1.586 baris; sub-router WhatsApp `conversations.routes.ts` (1.073), `groups.routes.ts` (1.015), `messages.routes.ts` (864), dan `route-helpers.ts` (831) masih besar. CLI worker menduplikasi daftar addon dan langsung memanggil `installAddons()`. |
| `apps/board`      | `@moonwitness/board`      | Aplikasi Next.js App Router untuk `/` publik dan `/board/*` terautentikasi (`app-shell.tsx`, `list-view.tsx`, `form-view.tsx`, `fields.tsx`, `whatsapp-page.tsx`, `dashboard-page.tsx`). | Berperan sebagai `apps/web` kanonis. Bebas kontrol HTML mentah (`board:ui:check`), tetapi `list-view.tsx` (1.486 baris), `whatsapp-page.tsx` (2.897 baris), dan `dashboard-page.tsx` (991 baris) masih besar. Hardcode sidebar, omnisearch 4 model, `onchange` `country_id`, field pencarian `Many2one`, dan heuristik Kanban. `useViews` memakai `staleTime: Infinity`.                                          |
| `apps/docs`       | `@moonwitness/docs`       | Portal dokumentasi React/Vite dengan pencarian & build GitHub Pages berversi.                                                                                                            | Build lokal dan pengecekan keamanan publikasi lulus; publikasi `main` Pages masih menunggu gate promosi (`M6.07`–`M6.10`).                                                                                                                                                                                                                                                                                        |
| `apps/ui-catalog` | `@moonwitness/ui-catalog` | Katalog spesimen komponen interaktif & uji visual/a11y Playwright (`catalog.tsx`, 1.642 baris).                                                                                          | Mencakup primitif dan token light/dark saat ini; belum ada switcher multi-skin atau widget data-view (`KanbanBoard`, `StatusBar`, `DatePicker`).                                                                                                                                                                                                                                                                  |

### Audit Seluruh 22 Package (`packages/*`)

| Package                         | Kategori                  | Model | Konsumer                                     | Evaluasi & Arah Tindakan                                                                                                                                                                                                        |
| :------------------------------ | :------------------------ | ----: | :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@moonwitness/orm`              | Core ORM                  |     0 | `api`, seluruh `orm-*`, `auth`, `jobs`       | **Pertahankan & Perluas:** Tambah `extendModel`, `Recordset`, field `computed`/`stored`, `onchange`, registry multi-view, dan evolusi skema kolom/enum/FK.                                                                      |
| `@moonwitness/orm-base`         | Addon Inti (`base`)       |    23 | `api`, `auth`, `jobs`, seluruh `orm-*`       | **Pertahankan & Perluas:** Memuat `base.partner`, `base.user`, `base.company`, `ir.feature_flag`, `base.audit_log`, dll. Tambah `base.config_parameter` & `base.saved_filter`.                                                  |
| `@moonwitness/auth`             | Addon (`auth`)            |     1 | `api`                                        | **Pertahankan:** Mengelola `auth.refresh_token`, scrypt hashing, rotasi refresh token. Integrasikan via `httpPlugins` & caching grant.                                                                                          |
| `@moonwitness/jobs`             | Addon (`jobs`)            |     4 | `api`, `orm-*`                               | **Pertahankan & Perbaiki:** Mengelola `base.job`, `base.job_run`, `base.cron`, `base.outbox_event`. Perbaiki bug head-of-line scheduler (`K7-005`) dan satukan bootstrap worker.                                                |
| `@moonwitness/orm-notification` | Addon (`notification`)    |     3 | `api`, `orm-workflow`, `orm-request`         | **Pertahankan:** Notifikasi in-app & template via outbox. Pindahkan registrasi route ke `httpPlugins`.                                                                                                                          |
| `@moonwitness/orm-organization` | Addon (`organization`)    |     4 | `api`                                        | **Pertahankan:** Departemen, tim, posisi, membership. Pindahkan `isValidOrganizationMutation` dari `generic.routes.ts` ke constraint model deklaratif.                                                                          |
| `@moonwitness/orm-storage`      | Provider Storage          |     0 | `api`                                        | **Pertahankan & Perbaiki Siklus:** Provider lokal & S3 (`putStream`, `getStream`, rekonsiliasi). Hapus siklus tipe `index.ts -> s3.ts`; gunakan `putStream` pada upload generic.                                                |
| `@moonwitness/orm-workflow`     | Addon (`workflow`)        |     4 | `api`, `orm-request`, `orm-knowledge`        | **Pertahankan:** State machine, approval, trigger append-only SQL, job expiry. Hubungkan dengan `StatusBar` dan `httpPlugins`.                                                                                                  |
| `@moonwitness/orm-request`      | Addon (`request`)         |     1 | `api`                                        | **Pertahankan:** Addon referensi `PurchaseRequest` di atas `workflow` + `notification`.                                                                                                                                         |
| `@moonwitness/orm-integration`  | Addon (`orm-integration`) |     2 | `api`                                        | **Pertahankan:** Outbound webhook, `MW_WEBHOOK_SECRET_C*`, HMAC & guard DNS SSRF.                                                                                                                                               |
| `@moonwitness/orm-whatsapp`     | Addon (`orm-whatsapp`)    |    13 | `api`                                        | **Pertahankan & Rapikan:** Versi package `1.14.0` tidak selaras dengan policy monorepo `1.0.0-rc.1`. Hapus raw SQL `setup` enum setelah ORM mendukung diff `CHECK` constraint; hapus shim `apps/api/src/whatsapp/manifest.ts`.  |
| `@moonwitness/orm-knowledge`    | Addon (`knowledge`)       |    18 | `api`                                        | **Pertahankan & Perbaiki Siklus:** Knowledge graph, witness, story, BUG case, publication, trigger append-only. Putus siklus tipe `research-release-validation.ts -> research-release.ts`; pindahkan 15 route ke `httpPlugins`. |
| `@moonwitness/types`            | Kontrak Shared            |     0 | `api`, `board`, `orm`, `orm-*`, `jobs`       | **Pertahankan & Konsolidasi:** Rumah tunggal kontrak DTO, `FieldMeta`, `ViewSpec`, `ResolvedViews`, `ActionSpec`, dan parser/evaluator `Domain`.                                                                                |
| `@moonwitness/client`           | SDK Frontend              |     0 | `board`                                      | **Konsolidasi Kontrak:** Saat ini tanpa dependency `@moonwitness/types` dan menduplikasi tipe view/domain serta `evalDomain`. Wajib bergantung ke `@moonwitness/types` dan hapus duplikasi.                                     |
| `@moonwitness/ui`               | Design System             |     0 | `board`, `docs`, `ui-catalog`                | **Pertahankan & Perluas:** Tambah komponen data-view (`DataGrid`, `KanbanBoard`, `StatusBar`, `SmartButtonBox`, `DatePicker`) dan `ThemeRegistry` / Skin Engine.                                                                |
| `@moonwitness/assets`           | Aset Statis               |     0 | `ui`, `board`, `docs`, `ui-catalog`          | **Pertahankan:** Brand SVG/raster, 82+ ikon kanonis, font, audio SFX, manifest & lisensi.                                                                                                                                       |
| `@moonwitness/logger`           | Observability             |     0 | `api`                                        | **Pertahankan:** Logger Pino terstruktur dengan redaksi secret otomatis.                                                                                                                                                        |
| `@moonwitness/knowledge`        | Domain Core               |     0 | `corpus`, `research`, `orm-knowledge`, `api` | **Pertahankan:** Kontrak record knowledge offline, canonical JSON hashing, PROV schema.                                                                                                                                         |
| `@moonwitness/corpus`           | Domain Ingestion          |     0 | `orm-knowledge`, `api`                       | **Pertahankan:** Ingesti teks/artefak offline terverifikasi lisensi.                                                                                                                                                            |
| `@moonwitness/research`         | Research Engine           |     0 | `orm-knowledge`, `api`                       | **Pertahankan:** Evaluasi assertion, evidence, relation, privacy lifecycle, dan Mizan.                                                                                                                                          |
| `@moonwitness/local-ai`         | Adapter AI Lokal          |     0 | `api`                                        | **Pertahankan & Perbaiki Siklus:** Adapter loopback disabled-by-default dengan uji prompt injection. Putus siklus tipe `index.ts -> suggestion-generation.ts`.                                                                  |
| `@moonwitness/eslint-config`    | Tooling                   |     0 | root                                         | **Pertahankan:** Aturan strict TypeScript/ESLint lintas monorepo (nol explicit `any`).                                                                                                                                          |

### Fitur Existing yang Sudah Berjalan & Terverifikasi (Wajib Dipertahankan)

- [x] **MW-BASE-001** Urutan topologis addon, `pg_advisory_xact_lock` transaksional, serta upsert idempoten `_orm_addons` dan `_orm_data` yang menjaga edit user (`packages/orm/src/addon.ts`, `scripts/roadmap/addon-conformance.test.mjs`).
- [x] **MW-BASE-002** Deklarasi model `defineModel`, hashing scrypt password otomatis, penyaringan `hiddenFields` di `$formatJson`, index komposit `(company_id, active, id)`, dan constraint unik (`packages/orm/src/model-definition.ts`).
- [x] **MW-BASE-003** Bootstrap Fastify 5 tipis dengan security header, allowlist `CORS_ORIGINS`, `PostgresRateLimitStore`, graceful shutdown, dan server kesehatan worker `/readyz` (`apps/api/src/app.ts`, `apps/api/src/server.ts`).
- [x] **MW-BASE-004** Rotasi family refresh token dengan grace window 5 detik, deteksi reuse/theft, login timing-safe, dan CLI pencabutan sesi (`packages/auth/src/service.ts`).
- [x] **MW-BASE-005** Blokir default-deny prefix `knowledge.*` di API generik, isolasi `company_id` (`hasCompanyAccess`), concurrency optimis `If-Match`/`x-expected-write-date` (`409`), dan `base.audit_log` append-only (`apps/api/src/auth/policy.ts`, `apps/api/src/routes/generic.routes.ts`).
- [x] **MW-BASE-006** Worker job dengan lease/fencing token, cron scheduler, dan outbox transaksional (`packages/jobs/src/runtime.ts`), plus `orm-notification`, trigger append-only `orm-workflow`, webhook `orm-integration` ber-guard SSRF, dan storage lokal/S3 `orm-storage`.
- [x] **MW-BASE-007** Gate boundary wajib addon-first (`pnpm api:addon:check`) dan nol JSX mentah di Board (`pnpm board:ui:check`) aktif di CI & `.githooks/pre-push`.
- [x] **MW-BASE-008** Design system `@moonwitness/ui`, `@moonwitness/assets` (114 SVG tervalidasi bounds/sanitasi), dan spesimen visual/a11y `@moonwitness/ui-catalog`.
- [x] **MW-BASE-009** Frontend Next.js App Router (`apps/board`) untuk `/` dan `/board/*` dengan `scopedQueryKey`, company switcher, command palette, shortcut keyboard, dan budget bundle per route (`pnpm board:budget`).
- [x] **MW-BASE-010** Dekomposisi sub-router backend WhatsApp (`apps/api/src/routes/whatsapp/*.routes.ts`) dan komponen UI WhatsApp (`apps/board/src/components/whatsapp/*`) dengan nol error ESLint dan nol warning `oxlint` (commit `1990580`, `2ae2e92`).
- [x] **MW-BASE-011** Stack knowledge/corpus/research/local-ai offline dengan trigger append-only (`packages/orm-knowledge/src/manifest.ts`) dan gate deterministik `K9-001` (`scripts/knowledge/run-k-gate.mjs`).
- [x] **MW-BASE-012** Generator referensi & diagram arsitektur deterministik (`pnpm docs:generate`, `pnpm architecture:generate`) serta validator 213 task roadmap (`pnpm automation:check:roadmap`).

### Rekonsiliasi Backlog Existing (`ROADMAP.md`, `todo-foundation.md`, `todo-ui.md`, `todo-wa.md`)

1. **`ROADMAP.md` (`docs/roadmap/tasks.json`):** 132/213 task selesai, 81 terbuka (48 seri M, 33 seri K). Item kode/CI terbuka direkonsiliasi ke Seksi 18, 21, 22, 24, dan 25; item yang bergantung pada approval GitHub/perangkat nyata ditempatkan eksplisit di Seksi 29.
2. **`todo-foundation.md`:** Ekstraksi `orm-whatsapp`, pemecahan route WhatsApp awal, healthcheck worker, `db:migrate`, `PostgresRateLimitStore`, dan warning `oxlint` sudah selesai. Item tersisa (paritas Node `22.x` vs lokal `v24.x` dan pemecahan lanjutan) masuk ke `MW-DX-001`, `MW-BACK-001`, dan `MW-WEB-007`.
3. **`todo-ui.md` & `todo-wa.md`:** Fondasi UI dan inbox v1 WhatsApp selesai; item yang tertahan koneksi/scan QR GoWA (`P0-01`–`P0-05`, `P0-08`, `P0-24`–`P0-25`, `P1-06`, `P1-28`, `P2-01`) dilacak di Seksi 29.

---

## 02 — Architecture & Design Decisions

### Keputusan Arsitektur Utama

| ID Keputusan  | Area                             | Implementasi Saat Ini                                                                                                        | Masalah Aktual                                                                                                           | Alternatif Praktis                                                                                                                        | Solusi Terpilih (Paling Sederhana & Tangguh)                                                                                                                                                                                                                                                  | Dampak & Risiko                                                                                                                            |
| :------------ | :------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-MW-01** | Identitas App Web                | `apps/board` (`@moonwitness/board`) melayani `/` dan `/board/*`.                                                             | Spesifikasi menyebut `apps/web`, berisiko menimbulkan duplikasi folder atau rename destruktif.                           | (A) Rename ke `apps/web` di 23+ skrip/CI/Docker; (B) Buat app kedua; (C) Tetapkan `apps/board` sebagai app web kanonis.                   | **Opsi C:** Pertahankan `apps/board` di disk sebagai realisasi `apps/web`; seluruh task frontend diarahkan ke `apps/board`.                                                                                                                                                                   | Nol regresi pada CI, Docker, `board:ui:check`, dan `board:budget`. Risiko: kontributor mencari `apps/web`; dimitigasi di Seksi 00 & 24.    |
| **ADR-MW-02** | Evolusi Skema ORM                | `syncModel` membuat tabel, kolom hilang, index; `orm-whatsapp` pakai raw SQL untuk enum.                                     | Tidak bisa update nullability, default, tipe kolom aman, enum `CHECK`, atau FK tabel lama; tanpa dry-run.                | (A) Tambah skrip migrasi SQL tradisional; (B) Perluas `syncModel` menjadi schema diff & sync engine bergaya Odoo.                         | **Opsi B:** Perluas `syncModel` via introspeksi `information_schema`/SQLite `PRAGMA` + preflight aman; `addon.upgrade` hanya untuk backfill data.                                                                                                                                             | Mempertahankan ADR-0001/Odoo dan menghapus hack raw SQL. Risiko: perubahan destruktif; dimitigasi preflight fail-closed (`MW-SCHEMA-005`). |
| **ADR-MW-03** | Pewarisan Model                  | `defineModel` membuat kelas terisolasi; belum ada ekstensi model lintas addon.                                               | Addon tidak bisa menambah field atau hook ke model upstream (`base.partner`, `base.user`).                               | (A) Monkey-patch prototype; (B) Registry `extendModel(target, ext)` dievaluasi sebelum `syncModel`.                                       | **Opsi B:** Tambah `extendModel` di `@moonwitness/orm` yang menggabungkan `fields`, `unique`, `exposedActions`, dan hooks secara topologis.                                                                                                                                                   | Memungkinkan ekstensibilitas sejati antar addon. Risiko: tabrakan nama field; dicegah saat resolusi addon (`MW-ORM-003`).                  |
| **ADR-MW-04** | Pewarisan & Jenis View           | `views` Map menyimpan 1 `ViewSpec` (`list`, `form`, `search` saja).                                                          | Addon berikutnya menimpa view lama; belum ada `kanban`, `calendar`, `graph`, `pivot`, tab form, statusbar, smart button. | (A) Template XML XPath; (B) `defineView` + `extendView` typed TS/JSON berurutan prioritas.                                                | **Opsi B:** Registry view berprioritas dengan patch `extendView` di `@moonwitness/orm`, divalidasi ke field model.                                                                                                                                                                            | Type-safe tanpa parser XML berat. Risiko: ekstensi merujuk field yang berubah; dicegah validasi startup (`MW-VIEW-002`).                   |
| **ADR-MW-05** | Kepemilikan Policy Keamanan      | `INTERNAL_PREFIXES`, `ADMIN_ONLY_MODELS`, `PUBLIC_MODELS` di-hardcode di `apps/api/src/auth/`.                               | Penambahan model/addon menuntut edit manual di `apps/api`; belum ada ACL field/action deklaratif.                        | (A) Tetap daftar terpusat di `apps/api`; (B) Deklarasikan metadata keamanan, ACL field, dan `recordRules` pada model/addon.               | **Opsi B:** Pindahkan deklarasi akses ke model/addon `@moonwitness/orm`, dikompilasi ke policy runtime dengan default-deny & guard `knowledge.*`.                                                                                                                                             | Memenuhi batas ADR-0006 dan mencegah kebocoran endpoint. Risiko: lupa deklarasi akses; dimitigasi default-deny (`MW-SEC-001`).             |
| **ADR-MW-06** | Pemisahan Boot Runtime           | `SKIP_BOOT_MIGRATIONS=true` melewatkan `model.knex`, `registerView`, `modelMenus`, `postInstall`; worker menduplikasi addon. | Boot produksi tanpa migrasi kehilangan view eksplisit, urutan menu, dan binding DB; worker tidak sinkron dengan API.     | (A) Selalu jalankan DDL saat boot; (B) Pisahkan `registerAddons` (in-memory) dari `installAddons` (DDL/seed).                             | **Opsi B:** Pisahkan `registerAddons` (selalu jalan di API & worker) dari `synchronizeAddons` (`db:migrate` / boot normal) via satu daftar addon kanonis.                                                                                                                                     | Memperbaiki bug kritis produksi `SKIP_BOOT_MIGRATIONS=true` (`MW-CORE-001`, `MW-CORE-002`).                                                |
| **ADR-MW-07** | Domain & Context Engine          | `orm/domain.ts` & `client/domain.ts` terpisah; `client/types.ts` menduplikasi `@moonwitness/types`.                          | Client kurang operator (`<>`, `like`, `=like`, `is null`, dll); SQL domain gagal pada path relasi bertitik.              | (A) Sinkronisasi manual dua file; (B) Satukan parser/evaluator murni di `@moonwitness/types` dan compiler SQL join di `@moonwitness/orm`. | **Opsi B:** Satu engine domain & token konteks (`$uid`, `$company_id`) di `@moonwitness/types`, dipakai bersama `@moonwitness/orm` dan `@moonwitness/client`.                                                                                                                                 | Menghapus inkonsistensi filter server/client dan mendukung filter relasional (`MW-DOM-001`, `MW-DOM-002`).                                 |
| **ADR-MW-08** | Action & Menu Engine             | `AddonMenu` datar; sidebar `app-shell.tsx` meng-hardcode halaman non-model; aksi hanya string `action_*`.                    | Tidak bisa mendeklarasikan menu bertingkat, window/server/client action, atau smart button secara modular.               | (A) Pertahankan hardcode JSX; (B) `ActionRegistry` + `MenuRegistry` hierarkis + endpoint `/api/app/bootstrap`.                            | **Opsi B:** Addon mendeklarasikan action dan hierarki menu yang dirender dinamis oleh `AppShell` dan `FormEngine`.                                                                                                                                                                            | Navigasi dan workspace sepenuhnya modular per addon (`MW-ACT-001`–`MW-ACT-007`).                                                           |
| **ADR-MW-09** | Skin & Theme Engine              | `tokens.css` hanya punya `:root` + `.dark` via `useTheme` di `localStorage`.                                                 | Belum ada dukungan skin bernama, kepadatan (`compact`), atau sinkronisasi preferensi ke profil server.                   | (A) CSS-in-JS runtime; (B) Layer CSS token `[data-skin]` / `[data-density]` + `ThemeRegistry` typed di `@moonwitness/ui`.                 | **Opsi B:** Engine skin murni CSS variables dengan registrasi metadata di `@moonwitness/ui` + hidrasi pre-paint SSR/DB.                                                                                                                                                                       | Nol penalti bundle JS dan kompatibel SSR (`MW-SKIN-001`–`MW-SKIN-005`).                                                                    |
| **ADR-MW-10** | Klasifikasi Kapabilitas Platform | 14 kapabilitas lintas platform dievaluasi terhadap kebutuhan nyata MoonWitness.                                              | Risiko overengineering fitur enterprise teoritis ke inti platform.                                                       | Klasifikasikan tegas menjadi Inti, Addon, Eksternal, atau Ditunda.                                                                        | **Inti:** Config params, storage/attachments, i18n, audit log, jobs/scheduler/outbox, observability. **Addon:** Notification, webhook, workflow, CSV tool, view analitik. **Eksternal:** GoWA WhatsApp, S3/RustFS, Local AI loopback. **Ditunda:** Visual WYSIWYG DB builder, multi-cloud CD. | Scope tetap fokus, ramping, dan realistis.                                                                                                 |

### Arah Ketergantungan Package Target

```text
@moonwitness/types (kontrak API, view, action, domain AST & evaluator tunggal)
  ├── @moonwitness/logger
  ├── @moonwitness/assets
  │     └── @moonwitness/ui (token, skin, primitif, komponen data-view, ikon)
  ├── @moonwitness/client (bergantung pada @moonwitness/types)
  │     └── apps/board (shell & view engine dinamis Next.js App Router)
  └── @moonwitness/orm (Registry, Environment, Recordset, Model/Schema/View/Action/Security engines)
        └── @moonwitness/orm-base (model inti, menu, config, saved filter, feature flag)
              ├── @moonwitness/auth, @moonwitness/jobs, @moonwitness/orm-*
              └── apps/api (host tipis Fastify & worker via API_ADDONS)
```

---

## 03 — Core Runtime

| ID            | Prioritas | Layer | Dependensi                   | Lokasi Target                                                        |
| :------------ | :-------- | :---- | :--------------------------- | :------------------------------------------------------------------- |
| `MW-CORE-001` | P0        | Core  | —                            | `packages/orm/src/addon.ts`, `apps/api/src/addons/registry.ts`       |
| `MW-CORE-002` | P1        | Core  | `MW-CORE-001`                | `apps/api/src/addons/registry.ts`, `apps/api/src/commands/*`         |
| `MW-CORE-003` | P1        | Core  | `MW-CORE-002`                | `packages/orm/src/`, `apps/api/src/plugins/orm.plugin.ts`            |
| `MW-CORE-004` | P1        | Core  | `MW-CORE-002`                | `apps/api/src/config/env.ts`, `apps/api/src/routes/health.routes.ts` |
| `MW-CORE-005` | P2        | Core  | `MW-CORE-002`, `MW-CORE-004` | `apps/api/src/lifecycle/`, `apps/api/src/server.ts`                  |
| `MW-CORE-006` | P1        | Core  | —                            | `packages/types/src/`, `packages/orm/src/`, `apps/api/src/app.ts`    |

- [x] **MW-CORE-001** Pisahkan registrasi metadata in-memory (`registerAddons`) dari sinkronisasi DDL/seed (`installAddons`) agar mode `SKIP_BOOT_MIGRATIONS=true` tidak melompati `model.knex(db)`, `views`, `modelMenus`, dan `postInstall`
  - [x] **MW-CORE-001.1** Ekstrak fungsi murni `registerAddons(db, addons)` di `packages/orm/src/addon.ts` untuk bind Knex, `Registry.register`, view, menu, action, dan rule keamanan tanpa DDL
  - [x] **MW-CORE-001.2** Perbarui `installApiAddons` di `apps/api/src/addons/registry.ts` agar tetap memanggil `registerAddons` dan hook in-memory saat `skipBootMigrations` bernilai `true`
  - [x] **MW-CORE-001.3** Tambahkan uji integrasi boot dengan `SKIP_BOOT_MIGRATIONS=true` yang membuktikan `/api/base.partner/views` mengembalikan view eksplisit (bukan fallback)
  - [x] **MW-CORE-001.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test` lulus tanpa error

- [x] **MW-CORE-002** Satukan modul bootstrap runtime (`bootstrapMoonWitnessRuntime`) yang dipakai identik oleh `apps/api/src/app.ts`, `db-migrate.ts`, `jobs-worker.ts`, `jobs-scheduler.ts`, dan `outbox-worker.ts`
  - [x] **MW-CORE-002.1** Buat modul bootstrap kanonis di `apps/api/src/addons/registry.ts` yang mengekspor daftar manifest addon resmi tunggal
  - [x] **MW-CORE-002.2** Hapus duplikasi daftar addon dan pemanggilan langsung `installAddons(...)` di `jobs-worker.ts`, `jobs-scheduler.ts`, dan `outbox-worker.ts`
  - [x] **MW-CORE-002.3** Pastikan seluruh proses worker menghormati `SKIP_BOOT_MIGRATIONS` setelah `db:migrate` berjalan
  - [x] **MW-CORE-002.4** Verifikasi: `pnpm build && pnpm api:addon:check && pnpm --filter @moonwitness/api test` lulus

- [x] **MW-CORE-003** Sediakan `ServiceRegistry` bertipe pada Core Runtime & `Environment` untuk akses layanan lintas addon (`storage`, `logger`, `jobs`, `notification`, `scanner`, `localAi`)
  - [x] **MW-CORE-003.1** Definisikan `ServiceToken<T>` dan `ServiceContainer` di `packages/orm/src/`
  - [x] **MW-CORE-003.2** Sambungkan `ServiceContainer` di `apps/api/src/plugins/orm.plugin.ts` agar tersedia via `env.services.get(token)` di API maupun worker
  - [x] **MW-CORE-003.3** Tambahkan unit test resolusi layanan & missing-service fail-closed error di `packages/orm/tests/`
  - [x] **MW-CORE-003.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm audit:workspace` lulus tanpa siklus dependency baru

- [x] **MW-CORE-004** Implementasikan validasi skema konfigurasi startup dan diagnostik runtime `/readyz` yang terstruktur
  - [x] **MW-CORE-004.1** Validasi seluruh environment variable runtime di `apps/api/src/config/env.ts` dengan pesan error terstruktur & aman dari kebocoran secret
  - [x] **MW-CORE-004.2** Perluas `/readyz` pada `apps/api/src/routes/health.routes.ts` dan `worker-health.ts` untuk melaporkan versi addon aktif, status DB pool, dan kesiapan layanan inti
  - [x] **MW-CORE-004.3** Uji startup failure formatting & `/readyz` degraded vs healthy payload di `apps/api/tests/`
  - [x] **MW-CORE-004.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-CORE-005** Seragamkan lifecycle proses (`onInit`, `onReady`, `onDispose`) antara server API Fastify dan seluruh worker command
  - [x] **MW-CORE-005.1** Integrasikan shutdown controller (`apps/api/src/lifecycle/`) dengan `ServiceContainer.disposeAll()` dan penutupan koneksi DB/S3/HTTP
  - [x] **MW-CORE-005.2** Pastikan timeout drain request dan pelepasan lease worker berjalan deterministik saat `SIGINT`/`SIGTERM`
  - [x] **MW-CORE-005.3** Uji urutan cleanup resource pada `apps/api/tests/`
  - [x] **MW-CORE-005.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-CORE-006** Standarisasi hierarki kelas error platform (`PlatformError`, `ValidationError`, `AccessDeniedError`, `NotFoundError`, `ConcurrencyConflictError`, `SchemaSyncError`)
  - [x] **MW-CORE-006.1** Definisikan kontrak kode error stabil dan status HTTP mapping di `packages/types/src/` dan `packages/orm/src/`
  - [x] **MW-CORE-006.2** Perbarui `setErrorHandler` di `apps/api/src/app.ts` agar memetakan instance `PlatformError` tanpa bergantung pada string-matching ad-hoc
  - [x] **MW-CORE-006.3** Tambahkan unit test mapping setiap subclass error pada mode development dan production (sanitasi 500)
  - [x] **MW-CORE-006.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test` lulus

---

## 04 — ORM & Model Engine

| ID           | Prioritas | Layer | Dependensi                    | Lokasi Target                                                             |
| :----------- | :-------- | :---- | :---------------------------- | :------------------------------------------------------------------------ |
| `MW-ORM-001` | P1        | ORM   | —                             | `packages/orm/src/model-definition.ts`, `packages/orm/src/view.ts`        |
| `MW-ORM-002` | P1        | ORM   | `MW-ORM-001`, `MW-SCHEMA-001` | `packages/orm/src/model-definition.ts`, `packages/orm/src/addon.ts`       |
| `MW-ORM-003` | P1        | ORM   | `MW-ORM-001`                  | `packages/orm/src/model-definition.ts`, `packages/orm/src/registry.ts`    |
| `MW-ORM-004` | P2        | ORM   | `MW-ORM-001`, `MW-ORM-003`    | `packages/orm/src/model-definition.ts`, `packages/orm/src/base.model.ts`  |
| `MW-ORM-005` | P2        | ORM   | `MW-ORM-003`                  | `packages/orm/src/model-definition.ts`, `packages/orm/src/base.model.ts`  |
| `MW-ORM-006` | P1        | ORM   | `MW-ORM-003`, `MW-CORE-006`   | `packages/orm/src/model-definition.ts`, `packages/orm/src/base.model.ts`  |
| `MW-ORM-007` | P2        | ORM   | `MW-CORE-003`                 | `packages/orm/src/environment.ts`, `packages/orm/src/base.model.ts`       |
| `MW-ORM-008` | P2        | ORM   | `MW-ORM-001`                  | `packages/orm/src/model-definition.ts`, `packages/orm/src/base.model.ts`  |
| `MW-ORM-009` | P1        | ORM   | `MW-CORE-006`                 | `packages/orm/src/base.model.ts`, `apps/api/src/routes/generic.routes.ts` |
| `MW-ORM-010` | P1        | ORM   | `MW-ORM-001`                  | `packages/orm/src/model-definition.ts`, `packages/orm/src/addon.ts`       |
| `MW-ORM-011` | P1        | ORM   | `MW-ORM-006`                  | `packages/orm/src/base.model.ts`                                          |
| `MW-ORM-012` | P2        | ORM   | `MW-DOM-002`                  | `packages/orm/src/base.model.ts`                                          |

- [x] **MW-ORM-001** Perluas definisi field kanonis di `@moonwitness/orm` dengan `float`, `decimal`, `date`, `datetime`, `json`, dan `manyToMany`
  - [x] **MW-ORM-001.1** Tambahkan builder `fields.float`, `fields.decimal`, `fields.date`, `fields.datetime`, `fields.json`, dan `fields.manyToMany` beserta inferensi `ModelValues<F>` di `packages/orm/src/model-definition.ts`
  - [x] **MW-ORM-001.2** Petakan tipe-tipe baru ke `jsonSchema` Objection (presisi desimal, format tanggal ISO, validasi JSON) dan `FieldType` di `packages/orm/src/view.ts`
  - [x] **MW-ORM-001.3** Tambahkan unit test inferensi tipe & serialisasi nilai di SQLite/PostgreSQL pada `packages/orm/tests/`
  - [x] **MW-ORM-001.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-ORM-002** Implementasikan relasi `manyToMany` otomatis dengan tabel penghubung deterministik dan manajemen link (`set`, `link`, `unlink`)
  - [x] **MW-ORM-002.1** Hasilkan `ManyToManyRelation` di `relationMappings` dan skema tabel junction otomatis pada `syncModel` (mendukung override `relationTable`)
  - [x] **MW-ORM-002.2** Dukung operasi tulis relasi M2M (`[id1, id2]`) pada `create`/`write` di `BaseModel` beserta index unik komposit dua arah
  - [x] **MW-ORM-002.3** Uji eager-loading `withGraphFetched` dan mutasi M2M di SQLite dan PostgreSQL
  - [x] **MW-ORM-002.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

- [x] **MW-ORM-003** Bangun mekanisme pewarisan & ekstensi model bergaya Odoo (`extendModel(targetModel, extension)`) di `@moonwitness/orm`
  - [x] **MW-ORM-003.1** Tambahkan API `extendModel` dan koleksi `Addon.extensions` agar addon hilir dapat menambah `fields`, `unique`, `exposedActions`, dan hooks ke model hulu
  - [x] **MW-ORM-003.2** Terapkan penggabungan ekstensi secara deterministik sesuai urutan topologis addon sebelum `syncModel` dan deteksi tabrakan nama kolom
  - [x] **MW-ORM-003.3** Uji ekstensi `base.partner` dari addon pengujian (verifikasi `jsonSchema`, `describeFields`, dan sinkronisasi kolom SQL)
  - [x] **MW-ORM-003.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-ORM-004** Implementasikan field terkomputasi deklaratif (`compute`, `depends`, `store`) pada `FieldOptions`
  - [x] **MW-ORM-004.1** Dukung evaluasi field `compute` non-stored saat `search_read`/`browse` (otomatis `readonly: true` di `FieldMeta`)
  - [x] **MW-ORM-004.2** Dukung field `compute` dengan `store: true` dan `depends` (termasuk path relasi) agar terhitung ulang transaksional saat `create`/`write`
  - [x] **MW-ORM-004.3** Uji recompute stored & non-stored field beserta pencegahan dependensi siklik antar field terkomputasi
  - [x] **MW-ORM-004.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

- [x] **MW-ORM-005** Tambahkan provider `default` dinamis dan handler `onchange` deklaratif pada `defineModel` / `extendModel`
  - [x] **MW-ORM-005.1** Implementasikan `Model.defaultGet(fields, context)` dan `Model.onchange(values, changedField)` di `packages/orm/src/base.model.ts`
  - [x] **MW-ORM-005.2** Kembalikan struktur standar `{ values, domainOverrides, warnings }` agar perubahan parent field (mis. `country_id` -> reset `state_id`) berasal dari model, bukan UI
  - [x] **MW-ORM-005.3** Migrasi logika reset `country_id -> state_id` ke definisi model `base.partner` / `base.partner_address`
  - [x] **MW-ORM-005.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/orm-base test` lulus

- [x] **MW-ORM-006** Implementasikan constraint validator lintas-field (`constraints`) yang berjalan transaksional di ORM sebelum commit
  - [x] **MW-ORM-006.1** Dukung deklarasi `constraints: [(record, env) => void | Promise<void>]` di `defineModel` dan `extendModel`
  - [x] **MW-ORM-006.2** Jalankan seluruh constraint pada `create`, `write`, dan `update` di `BaseModel`, dan pindahkan `isValidOrganizationMutation` ke `@moonwitness/orm-organization`
  - [x] **MW-ORM-006.3** Uji kegagalan constraint melempar `ValidationError` (`400`) dan membatalkan transaksi secara atomik
  - [x] **MW-ORM-006.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/orm-organization test` lulus

- [x] **MW-ORM-007** Implementasikan abstraksi `Recordset<M>` yang immutable dan chainable pada `Environment`
  - [x] **MW-ORM-007.1** Buat kelas `Recordset<M>` di `packages/orm/src/` dengan `ids`, `env`, `.ensureOne()`, `.mapped()`, `.filtered()`, `.write()`, `.unlink()`, dan `.executeAction()`
  - [x] **MW-ORM-007.2** Pertahankan kompatibilitas penuh method statis `BaseModel` (`search`, `search_read`, `browse`, `create`, `write`, `unlink`)
  - [x] **MW-ORM-007.3** Tambahkan unit test batch operation & singleton check `.ensureOne()` di `packages/orm/tests/`
  - [x] **MW-ORM-007.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-ORM-008** Tambahkan metadata `_recName` / `displayField` pada `defineModel` dan standarisasi `display_name` / `nameGet`
  - [x] **MW-ORM-008.1** Izinkan model mendeklarasikan `_recName` (mis. `login` untuk `base.user`, `code` untuk `base.sequence`) di `defineModel` & sertakan di `FieldMeta`/model info
  - [x] **MW-ORM-008.2** Perbarui getter `BaseModel.display_name` dan tambahkan `Model.nameGet(ids)` untuk lookup label relasional efisien
  - [x] **MW-ORM-008.3** Tambahkan unit test resolusi `_recName` untuk model tanpa kolom `name`
  - [x] **MW-ORM-008.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance` lulus

- [x] **MW-ORM-009** Tegakkan optimistic concurrency (`expectedWriteDate`) di level `BaseModel.write()` / `BaseModel.unlink()` agar REST dan JSON-RPC memiliki proteksi `409 Conflict` yang sama
  - [x] **MW-ORM-009.1** Tambahkan opsi `expectedWriteDate` di `BaseModel.write` & `unlink` dengan query kondisional `AND write_date = ?`
  - [x] **MW-ORM-009.2** Lempar `ConcurrencyConflictError` (`409`) bila baris ada namun `write_date` tidak cocok
  - [x] **MW-ORM-009.3** Uji konflik konkurensi melalui REST `If-Match` dan JSON-RPC `execute_kw`
  - [x] **MW-ORM-009.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api exec vitest run tests/api-orm-hardening.test.ts` lulus

- [x] **MW-ORM-010** Tambahkan kebijakan `onDelete` (`'restrict' | 'cascade' | 'set null'`) pada field `belongsTo` dan selaraskan dengan `findReference` serta FK SQL
  - [x] **MW-ORM-010.1** Tambah opsi `onDelete` di `fields.belongsTo` (`packages/orm/src/model-definition.ts`) dengan default aman `'restrict'`
  - [x] **MW-ORM-010.2** Terapkan `onDelete` tersebut pada builder FK di `syncModel` serta logika penghapusan/pengarsipan `findReference`
  - [x] **MW-ORM-010.3** Uji perilaku cascade, set-null, dan restrict pada relasi parent-child di SQLite dan PostgreSQL
  - [x] **MW-ORM-010.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

- [x] **MW-ORM-011** Satukan pipeline validasi, hashing password, hook update, dan redaksi field `sensitive` pada `BaseModel.write()` dan `instance.update()`
  - [x] **MW-ORM-011.1** Pastikan `BaseModel.write()` menjalankan JSON Schema patch validation, hash password, `$beforeUpdate` hook ekstensi, dan `sensitive` field handling secara seragam
  - [x] **MW-ORM-011.2** Hapus celah bypass validasi/hashing antara batch `write()` dan instance `update()`
  - [x] **MW-ORM-011.3** Uji update batch pada model dengan field `password`, `pattern`, dan `compute`
  - [x] **MW-ORM-011.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-ORM-012** Dukung pengurutan (`order`) bertitik pada relasi `belongsTo` (mis. `order: 'partner.name asc'`) di `BaseModel.buildSearchQuery`
  - [x] **MW-ORM-012.1** Validasi path `order` terhadap `relationMappings` dan `hiddenFields` setiap model pada rantai relasi
  - [x] **MW-ORM-012.2** Bangun `LEFT JOIN` dengan alias deterministik yang bebas ambiguitas kolom pada PostgreSQL dan SQLite
  - [x] **MW-ORM-012.3** Uji sorting relasional positif dan penolakan (`400`) untuk path invalid atau `hiddenFields`
  - [x] **MW-ORM-012.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

---

## 05 — ORM Schema Management

| ID              | Prioritas | Layer | Dependensi                       | Lokasi Target                                                        |
| :-------------- | :-------- | :---- | :------------------------------- | :------------------------------------------------------------------- |
| `MW-SCHEMA-001` | P0        | ORM   | `MW-CORE-001`                    | `packages/orm/src/`                                                  |
| `MW-SCHEMA-002` | P1        | ORM   | `MW-SCHEMA-001`, `MW-ORM-001`    | `packages/orm/src/addon.ts`                                          |
| `MW-SCHEMA-003` | P1        | ORM   | `MW-SCHEMA-001`                  | `packages/orm/src/addon.ts`, `packages/orm-whatsapp/src/manifest.ts` |
| `MW-SCHEMA-004` | P1        | ORM   | `MW-SCHEMA-001`, `MW-ORM-010`    | `packages/orm/src/addon.ts`                                          |
| `MW-SCHEMA-005` | P0        | ORM   | `MW-SCHEMA-001`, `MW-SCHEMA-002` | `packages/orm/src/addon.ts`, `apps/api/src/commands/db-migrate.ts`   |
| `MW-SCHEMA-006` | P1        | ORM   | `MW-SCHEMA-005`                  | `apps/api/src/commands/db-migrate.ts`, `package.json`                |
| `MW-SCHEMA-007` | P2        | ORM   | `MW-SCHEMA-001`                  | `packages/orm/src/addon.ts`                                          |
| `MW-SCHEMA-008` | P1        | ORM   | `MW-SCHEMA-002`, `MW-SCHEMA-005` | `packages/orm/src/addon.ts`                                          |

- [x] **MW-SCHEMA-001** Bangun introspektor skema PostgreSQL & SQLite di `@moonwitness/orm` yang membaca kolom aktual, nullability, default, `CHECK` constraint, index, unique index, dan foreign key
  - [x] **MW-SCHEMA-001.1** Implementasikan `introspectDatabaseSchema(trx, tableNames)` membaca `information_schema` + `pg_constraint` + `pg_indexes` untuk `pg`
  - [x] **MW-SCHEMA-001.2** Implementasikan backend SQLite via `PRAGMA table_info`, `index_list`, `foreign_key_list`, dan `sqlite_master` SQL check parsing
  - [x] **MW-SCHEMA-001.3** Tambahkan unit test paritas output `TableSchemaSnapshot` antara SQLite dan mock/live PostgreSQL
  - [x] **MW-SCHEMA-001.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

- [x] **MW-SCHEMA-002** Perluas `syncModel` untuk mengevolusikan perubahan kolom eksisting secara aman (nullability, default value, pelebaran tipe seperti `string -> text` atau `integer -> decimal`)
  - [x] **MW-SCHEMA-002.1** Hitung diff antara definisi `Model.fields` dan `TableSchemaSnapshot` di dalam transaksi migrasi
  - [x] **MW-SCHEMA-002.2** Terapkan `ALTER TABLE` aman di PostgreSQL (dan rekonstruksi tabel transaksional aman di SQLite saat diperlukan)
  - [x] **MW-SCHEMA-002.3** Tolak penambahan `NOT NULL` tanpa default pada tabel berisi data dengan error `SchemaSyncError` yang jelas
  - [x] **MW-SCHEMA-002.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

- [x] **MW-SCHEMA-003** Implementasikan sinkronisasi otomatis `CHECK` constraint untuk field `enum` di `syncModel` dan hapus raw SQL workaround di `packages/orm-whatsapp/src/manifest.ts`
  - [x] **MW-SCHEMA-003.1** Bandingkan daftar nilai `field.values` dengan `CHECK` constraint aktual di database pada `syncModel`
  - [x] **MW-SCHEMA-003.2** Perbarui constraint otomatis di PostgreSQL/SQLite bila himpunan enum bertambah, serta gagalkan bila nilai lama yang masih ada di data dihapus
  - [x] **MW-SCHEMA-003.3** Hapus blok raw SQL `setup` pada `packages/orm-whatsapp/src/manifest.ts`
  - [x] **MW-SCHEMA-003.4** Verifikasi: `pnpm test:addon-conformance && pnpm test:integration` lulus dengan tabel `whatsapp_accounts` teruji

- [x] **MW-SCHEMA-004** Rekonsiliasi constraint foreign key (`FOREIGN KEY`) dan aksi `onDelete` pada kolom `belongsTo` baru maupun tabel eksisting
  - [x] **MW-SCHEMA-004.1** Deteksi kolom `belongsTo` yang belum memiliki constraint FK di PostgreSQL dan tambahkan constraint secara idempoten
  - [x] **MW-SCHEMA-004.2** Deteksi perubahan `onDelete` (`RESTRICT` / `CASCADE` / `SET NULL`) pada metadata model dan perbarui FK constraint secara aman
  - [x] **MW-SCHEMA-004.3** Uji penambahan FK dan perubahan `onDelete` di PostgreSQL dengan data relasional
  - [x] **MW-SCHEMA-004.4** Verifikasi: `pnpm test:integration` lulus

- [x] **MW-SCHEMA-005** Implementasikan preflight guard perubahan destruktif & generator rencana `SchemaDiffPlan` fail-closed
  - [x] **MW-SCHEMA-005.1** Blokir otomatis penghapusan kolom, penghapusan tabel, penyempitan tipe data, atau penghapusan nilai enum yang berisiko kehilangan data kecuali dengan flag eksplisit & hook upgrade
  - [x] **MW-SCHEMA-005.2** Klasifikasikan setiap item diff sebagai `safe_create`, `safe_alter`, `index_sync`, atau `destructive_blocked`
  - [x] **MW-SCHEMA-005.3** Uji skenario perubahan destruktif membuktikan transaksi dibatalkan sebelum DDL apa pun dieksekusi
  - [x] **MW-SCHEMA-005.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-SCHEMA-006** Tambahkan mode `--dry-run` dan `--json` pada `apps/api/src/commands/db-migrate.ts` (`pnpm db:migrate`)
  - [x] **MW-SCHEMA-006.1** Dukung `pnpm db:migrate -- --dry-run` untuk mencetak `SchemaDiffPlan` lengkap tanpa mengeksekusi mutasi DDL atau seed
  - [x] **MW-SCHEMA-006.2** Tambahkan opsi `--json` agar pipeline CI/CD dapat memvalidasi apakah perubahan skema bersifat aman atau breaking
  - [x] **MW-SCHEMA-006.3** Uji CLI `db-migrate` dengan fixture DB kosong & pre-populated untuk memastikan `--dry-run` nol efek samping
  - [x] **MW-SCHEMA-006.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-SCHEMA-007** Rekonsiliasi index ORM (`mw_idx_*`) dan unique constraint (`mw_uq_*`) yang usang tanpa menyentuh index manual/DBA di luar namespace `mw_*`
  - [x] **MW-SCHEMA-007.1** Hapus index `mw_idx_*`/`mw_uq_*` yatim saat definisi `index` atau `unique` dihapus dari model
  - [x] **MW-SCHEMA-007.2** Tambahkan pre-check duplikasi data sebelum membuat `UNIQUE INDEX` baru agar error mudah didiagnosis
  - [x] **MW-SCHEMA-007.3** Uji pelestarian index eksternal non-`mw_*` selama sinkronisasi ulang
  - [x] **MW-SCHEMA-007.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

- [x] **MW-SCHEMA-008** Perkuat pelacakan versi & checksum skema pada `_orm_addons` serta eksekusi transaksional `addon.upgrade`
  - [x] **MW-SCHEMA-008.1** Simpan `schema_digest` deterministik per addon di `_orm_addons` agar boot normal dengan skema identik tidak melakukan DDL berulang
  - [x] **MW-SCHEMA-008.2** Jalankan `syncModel` + rantai `addon.upgrade` berurutan versi dalam satu transaksi PostgreSQL dengan `pg_advisory_xact_lock`
  - [x] **MW-SCHEMA-008.3** Uji kegagalan di tengah hook `upgrade` melakukan rollback penuh atas DDL maupun baris data
  - [x] **MW-SCHEMA-008.4** Verifikasi: `pnpm test:integration` lulus

---

## 06 — Native Addon Engine

| ID             | Prioritas | Layer | Dependensi                      | Lokasi Target                                                               |
| :------------- | :-------- | :---- | :------------------------------ | :-------------------------------------------------------------------------- |
| `MW-ADDON-001` | P1        | Addon | `MW-CORE-001`                   | `packages/orm/src/addon.ts`, `packages/types/src/`                          |
| `MW-ADDON-002` | P1        | Addon | `MW-ADDON-001`, `MW-CORE-002`   | `packages/orm/src/addon.ts`, `apps/api/src/addons/registry.ts`              |
| `MW-ADDON-003` | P1        | Addon | `MW-ADDON-001`, `MW-SCHEMA-008` | `packages/orm/src/addon.ts`, `packages/orm-base/src/models/feature-flag.ts` |
| `MW-ADDON-004` | P2        | Addon | `MW-ADDON-003`                  | `packages/orm/src/addon.ts`                                                 |
| `MW-ADDON-005` | P1        | Addon | `MW-SCHEMA-008`, `MW-ADDON-003` | `packages/orm/src/addon.ts`                                                 |
| `MW-ADDON-006` | P2        | Addon | `MW-ADDON-001`, `MW-CORE-003`   | `apps/api/src/addons/registry.ts`, `packages/*/src/manifest.ts`             |
| `MW-ADDON-007` | P1        | Addon | `MW-ADDON-001`, `MW-ORM-003`    | `packages/orm/src/addon.ts`, `scripts/roadmap/addon-conformance.test.mjs`   |
| `MW-ADDON-008` | P3        | Addon | `MW-ADDON-004`                  | `scripts/evolution/prune-expired-experiments.mjs`                           |
| `MW-ADDON-009` | P3        | Addon | `MW-ADDON-001`, `MW-ADDON-007`  | `scripts/evolution/scaffold-exp-addon.mjs`, `package.json`                  |

- [x] **MW-ADDON-001** Perluas kontrak manifest `Addon` (`packages/orm/src/addon.ts`) dengan `displayName`, `category`, `summary`, `license`, `autoInstall`, `uninstallable`, `actions`, `security`, dan `compatibility`
  - [x] **MW-ADDON-001.1** Perbarui interface `Addon` dan validasi `defineAddon` termasuk semver range kompatibilitas pada `depends`
  - [x] **MW-ADDON-001.2** Validasi keunikan nama model, action, menu, dan ID seed lintas seluruh manifest sebelum transaksi dimulai
  - [x] **MW-ADDON-001.3** Perbarui 11 manifest addon workspace yang ada agar melengkapi metadata wajib baru tanpa memecahkan test lama
  - [x] **MW-ADDON-001.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance` lulus

- [x] **MW-ADDON-002** Implementasikan penemuan addon otomatis (`discoverWorkspaceAddons`) & resolusi graf dependensi deterministik
  - [x] **MW-ADDON-002.1** Tambahkan penanda `moonwitness.addon: true` pada `package.json` addon dan resolver penemuan addon di `apps/api/src/addons/`
  - [x] **MW-ADDON-002.2** Pastikan resolver mendeteksi dependensi hilang, versi tak kompatibel, dan dependency cycle dengan error yang jelas
  - [x] **MW-ADDON-002.3** Tambahkan unit test penemuan addon dengan urutan input teracak dan manifest invalid
  - [x] **MW-ADDON-002.4** Verifikasi: `pnpm test:addon-conformance && pnpm api:addon:check` lulus

- [x] **MW-ADDON-003** Lacak status siklus hidup penuh addon (`uninstalled | installed | disabled | upgrade_failed`) di `_orm_addons` serta integrasikan enable/disable dengan `ir.feature_flag`
  - [x] **MW-ADDON-003.1** Tambahkan kolom `status` pada tabel `_orm_addons` via schema engine (`MW-SCHEMA-002`)
  - [x] **MW-ADDON-003.2** Implementasikan `enableAddon(db, name)` dan `disableAddon(db, name)` yang memblokir penonaktifan addon inti (`base`, `auth`, `jobs`) atau yang masih memiliki dependen aktif
  - [x] **MW-ADDON-003.3** Pastikan menu, action, dan endpoint model addon berstatus `disabled` tidak terekspose pada runtime tanpa menghapus datanya di DB
  - [x] **MW-ADDON-003.4** Verifikasi: `pnpm test:addon-conformance && pnpm --filter @moonwitness/api test` lulus

- [x] **MW-ADDON-004** Implementasikan `uninstallAddon(db, name, options)` yang aman terhadap dependensi, view, menu, action, permission, dan resource `_orm_data`
  - [x] **MW-ADDON-004.1** Tolak uninstall (`409`) apabila ada addon aktif lain yang bergantung pada addon target
  - [x] **MW-ADDON-004.2** Lepaskan registrasi runtime (model dari `Registry`, view, menu, action, record rule) serta hapus entri `_orm_addons` dan `_orm_data` milik addon secara transaksional
  - [x] **MW-ADDON-004.3** Tambahkan opsi eksplisit `purgeData: false` (default aman) dan uji install ulang bersih sesudah uninstall
  - [x] **MW-ADDON-004.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-ADDON-005** Implementasikan pemulihan kegagalan install/upgrade addon (rollback DB + snapshot registry in-memory atomik)
  - [x] **MW-ADDON-005.1** Simpan salinan snapshot registry in-memory sebelum `installAddons`/`upgrade` dan pulihkan otomatis bila transaksi gagal
  - [x] **MW-ADDON-005.2** Catat status `upgrade_failed` beserta pesan error terstruktur pada log diagnostik tanpa merusak state model aktif
  - [x] **MW-ADDON-005.3** Uji injeksi kegagalan di tengah upgrade pada SQLite dan PostgreSQL
  - [x] **MW-ADDON-005.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

- [x] **MW-ADDON-006** Pindahkan registrasi HTTP plugin fitur (`auth`, `jobs`, `notification`, `workflow`, `whatsapp`, dan 15 `knowledge` route) dari `apps/api/src/addons/registry.ts` ke `manifest.httpPlugins` milik masing-masing addon
  - [x] **MW-ADDON-006.1** Refactor `authRoutes`, `jobsRoutes`, `notificationRoutes`, `workflowRoutes` menjadi `httpPlugins` di package addon masing-masing dengan `ServiceRegistry` (`MW-CORE-003`)
  - [x] **MW-ADDON-006.2** Evaluasi & pindahkan adapter route `whatsapp` dan `knowledge` ke plugin addon bersih tanpa mengekspor internals API
  - [x] **MW-ADDON-006.3** Pastikan `apps/api/src/addons/registry.ts` hanya merangkai daftar addon dan runtime context
  - [x] **MW-ADDON-006.4** Verifikasi: `pnpm audit:workspace && pnpm api:addon:check && pnpm --filter @moonwitness/api test` lulus

- [x] **MW-ADDON-007** Perkuat validasi lintas-addon pada `registerAddons` dan `scripts/roadmap/addon-conformance.test.mjs`
  - [x] **MW-ADDON-007.1** Validasi eksistensi target relasi, field view, referensi seed `ref(...)`, action, menu, dan aturan keamanan lintas seluruh addon aktif
  - [x] **MW-ADDON-007.2** Perluas `addon-conformance.test.mjs` agar mengecek idempotensi install berulang di SQLite maupun daftar model/menu tanpa duplikasi
  - [x] **MW-ADDON-007.3** Tambahkan uji negatif untuk manifest rusak (referensi `ref()` hilang, circular dependency, menu invalid)
  - [x] **MW-ADDON-007.4** Verifikasi: `pnpm test:addon-conformance` lulus

- [x] **MW-ADDON-008** Integrasikan `disableAddon`/`uninstallAddon` ke alur kedaluwarsa eksperimen (`pnpm evolution:prune`) dan `ir.feature_flag`
  - [x] **MW-ADDON-008.1** Hubungkan `scripts/evolution/prune-expired-experiments.mjs` dengan mekanisme disable/uninstall addon yang bersih
  - [x] **MW-ADDON-008.2** Pastikan fitur eksperimen yang sudah melewati `expiresAt` nonaktif otomatis sebelum kode dipangkas
  - [x] **MW-ADDON-008.3** Tambahkan uji dry-run prune di `scripts/evolution/`
  - [x] **MW-ADDON-008.4** Verifikasi: `pnpm evolution:prune -- --dry-run` lulus

- [x] **MW-ADDON-009** Perbarui generator scaffold (`scripts/evolution/scaffold-exp-addon.mjs` dan generator addon produksi) agar menghasilkan struktur addon lengkap
  - [x] **MW-ADDON-009.1** Sertakan template `defineModel`, `defineView`, `defineAction`, `menus`, `security`, `package.json`, `tsconfig.json`, dan test conformance
  - [x] **MW-ADDON-009.2** Dukung mode `--dry-run` dan penamaan addon standar (`orm-<nama>`) maupun eksperimental (`exp-<nama>`)
  - [x] **MW-ADDON-009.3** Uji output scaffold di direktori sementara lolos kompilasi TypeScript dan conformance check
  - [x] **MW-ADDON-009.4** Verifikasi: `pnpm test:addon-conformance` lulus

---

## 07 — Model–View Engine

| ID            | Prioritas | Layer   | Dependensi                  | Lokasi Target                                                           |
| :------------ | :-------- | :------ | :-------------------------- | :---------------------------------------------------------------------- |
| `MW-VIEW-001` | P1        | Core    | `MW-ORM-003`, `MW-CORE-001` | `packages/orm/src/view.ts`                                              |
| `MW-VIEW-002` | P1        | Core    | `MW-VIEW-001`, `MW-DOM-001` | `packages/orm/src/view.ts`                                              |
| `MW-VIEW-003` | P2        | Core    | `MW-VIEW-001`, `MW-ORM-008` | `packages/orm/src/view.ts`                                              |
| `MW-VIEW-004` | P2        | Core    | `MW-VIEW-001`, `MW-PKG-002` | `packages/orm/src/view.ts`, `packages/types/src/`                       |
| `MW-VIEW-005` | P2        | Core    | `MW-VIEW-001`, `MW-ACT-001` | `packages/orm/src/view.ts`, `packages/types/src/`                       |
| `MW-VIEW-006` | P2        | Core    | `MW-VIEW-001`, `MW-DOM-001` | `packages/orm/src/view.ts`, `packages/types/src/`                       |
| `MW-VIEW-007` | P2        | Core    | `MW-VIEW-001`               | `packages/orm/src/view.ts`, `packages/types/src/`                       |
| `MW-VIEW-008` | P3        | Core    | `MW-VIEW-001`, `MW-ORM-001` | `packages/orm/src/view.ts`, `packages/types/src/`                       |
| `MW-VIEW-009` | P3        | Core    | `MW-VIEW-001`, `MW-ORM-001` | `packages/orm/src/view.ts`, `packages/types/src/`                       |
| `MW-VIEW-010` | P2        | Backend | `MW-VIEW-001`               | `packages/orm/src/registry.ts`, `apps/api/src/routes/generic.routes.ts` |

- [x] **MW-VIEW-001** Ganti `Map<string, ViewSpec>` tunggal pada `packages/orm/src/view.ts` dengan View Registry multi-view berprioritas yang mendukung pewarisan `extendView(model, patch)`
  - [x] **MW-VIEW-001.1** Simpan daftar view dasar + daftar patch `extendView` dengan `priority` dan `addonName`
  - [x] **MW-VIEW-001.2** Implementasikan resolver penggabungan (`before`, `after`, `replace`, `attributes`, `insertSection`, `addFilter`) secara deterministik saat `resolveViews`
  - [x] **MW-VIEW-001.3** Uji skenario 2 addon berurutan memperluas `base.partner` tanpa menimpa field addon lain
  - [x] **MW-VIEW-001.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-VIEW-002** Terapkan validasi deklarasi view menyeluruh pada `defineView` / `extendView` dan `registerAddons`
  - [x] **MW-VIEW-002.1** Validasi seluruh nama field di `list`, `form`, `search`, `kanban`, `calendar`, `graph`, dan `pivot` ada di model target (termasuk field hasil `extendModel`)
  - [x] **MW-VIEW-002.2** Tolak field `password`/`hidden` pada list/search/kanban/graph/pivot, serta validasi sintaks `domain` filter di SearchView
  - [x] **MW-VIEW-002.3** Tambahkan uji negatif untuk view invalid di `packages/orm/tests/`
  - [x] **MW-VIEW-002.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance` lulus

- [x] **MW-VIEW-003** Tingkatkan generasi view default otomatis (`resolveViews`) bagi model tanpa view eksplisit
  - [x] **MW-VIEW-003.1** Prioritaskan field kunci (`name`, `code`, `title`, `state`, `company`, relasi utama) pada list default dan sembunyikan field teknis/sensitif
  - [x] **MW-VIEW-003.2** Hasilkan search fields default mencakup string + `_recName` dan filter standar `Active` / `Archived`
  - [x] **MW-VIEW-003.3** Uji resolusi default atas model minimal tanpa `defineView`
  - [x] **MW-VIEW-003.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-VIEW-004** Perluas spesifikasi `ListView` dengan `editable` (`'top' | 'bottom' | false`), kolom `widget`, `optional` (`'show' | 'hide'`), agregasi (`sum`/`avg`), dekorasi badge baris, dan `multiEdit`
  - [x] **MW-VIEW-004.1** Definisikan tipe kolom list terstruktur (`ListColumnSpec`) sambil mempertahankan kompatibilitas string nama kolom sederhana
  - [x] **MW-VIEW-004.2** Validasi agregasi numerik hanya pada field `integer`/`float`/`decimal`
  - [x] **MW-VIEW-004.3** Tambahkan dukungan dekorasi warna semantik berbasis domain (mis. status `draft`/`approved`/`cancelled`)
  - [x] **MW-VIEW-004.4** Verifikasi: `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-VIEW-005** Perluas spesifikasi `FormView` dengan `header` (field statusbar + tombol aksi), `smartButtons`, `tabs` (notebook/halaman), layout grup kolom, `widget`/`domain`/`context` per field, dan opsi `chatter`
  - [x] **MW-VIEW-005.1** Definisikan `FormHeaderSpec`, `FormTabSpec`, `FormFieldSpec`, dan `SmartButtonSpec` di `@moonwitness/types` dan `packages/orm/src/view.ts`
  - [x] **MW-VIEW-005.2** Konversi field relasional bergantung (`state` pada `base.partner`, `bank` pada `base.partner_bank`) agar memakai deklarasi `domain` di metadata view/model
  - [x] **MW-VIEW-005.3** Uji resolusi metadata form lengkap melalui `/api/:model/views`
  - [x] **MW-VIEW-005.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance` lulus

- [x] **MW-VIEW-006** Perluas spesifikasi `SearchView` dengan preset `groupBy`, `facets`, filter rentang tanggal, dan konfigurasi `searchPanel`
  - [x] **MW-VIEW-006.1** Tambahkan `SearchGroupBy` dan `SearchPanelSpec` ke kontrak `SearchView`
  - [x] **MW-VIEW-006.2** Validasi field `groupBy` & `searchPanel` terhadap kolom skalar/relasi yang aman di-query (bukan `hiddenFields`)
  - [x] **MW-VIEW-006.3** Terapkan filter & groupBy default pada `base.partner`, `base.activity`, dan `request.purchase_request`
  - [x] **MW-VIEW-006.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-VIEW-007** Tambahkan spesifikasi deklaratif `KanbanView` (`groupBy`, `cardTitle`, `cardFields`, `badgeField`, `quickCreate`, `stageOrder`) menggantikan heuristik ad-hoc di `list-view.tsx`
  - [x] **MW-VIEW-007.1** Definisikan kontrak `KanbanView` di `@moonwitness/types` dan `packages/orm/src/view.ts`
  - [x] **MW-VIEW-007.2** Deklarasikan view Kanban eksplisit untuk model ber-pipeline (`base.activity`, `request.purchase_request`, `workflow.instance`)
  - [x] **MW-VIEW-007.3** Validasi `groupBy` Kanban hanya menunjuk field `selection`, `belongsTo`, atau `boolean` yang valid
  - [x] **MW-VIEW-007.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance` lulus

- [x] **MW-VIEW-008** Tambahkan spesifikasi deklaratif `CalendarView` (`dateStart`, `dateStop`, `colorBy`, `mode`, `fields`) untuk model berbasis waktu
  - [x] **MW-VIEW-008.1** Definisikan tipe `CalendarView` dan validasi bahwa `dateStart`/`dateStop` merujuk field `date`/`datetime` yang ada
  - [x] **MW-VIEW-008.2** Tambahkan `calendar` view pada `base.activity` (berbasis `deadline` dan `assigned_to`)
  - [x] **MW-VIEW-008.3** Sertakan `calendar` pada output `/api/:model/views` saat dideklarasikan
  - [x] **MW-VIEW-008.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-VIEW-009** Tambahkan spesifikasi deklaratif `GraphView` (`type`, `dimension`, `measure`, `aggregation`) dan `PivotView` (`rows`, `columns`, `measures`) yang terhubung dengan `/api/:model/group-count`
  - [x] **MW-VIEW-009.1** Definisikan tipe `GraphView` (`bar | line | pie`) dan `PivotView` di `@moonwitness/types` dan `@moonwitness/orm`
  - [x] **MW-VIEW-009.2** Validasi seluruh dimensi/baris/kolom berada dalam daftar scalar aman dan maksimal 3 grup per query sesuai batas `/api/:model/group-count`
  - [x] **MW-VIEW-009.3** Tambahkan view analitik pada `request.purchase_request` dan `base.activity`
  - [x] **MW-VIEW-009.4** Verifikasi: `pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-VIEW-010** Implementasikan caching metadata view berbasis `Registry.getGeneration()` dengan HTTP `ETag` / `304 Not Modified` dan invalidasi otomatis di `apps/board`
  - [x] **MW-VIEW-010.1** Bangun `ETag` deterministik pada `/api/:model/views` dari `(model, generation, role, lang, fieldAclDigest)` dan layani `304` saat cocok
  - [x] **MW-VIEW-010.2** Ganti `staleTime: Infinity` pada `useViews` di `apps/board/src/hooks/use-model.ts` dengan stale/version key dari `/api/app/bootstrap`
  - [x] **MW-VIEW-010.3** Uji perubahan metadata (mis. pergantian bahasa/role/addon upgrade) langsung terefleksi tanpa hard-refresh manual
  - [x] **MW-VIEW-010.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/board typecheck` lulus

---

## 08 — Field Widget Engine

| ID              | Prioritas | Layer    | Dependensi                                  | Lokasi Target                                         |
| :-------------- | :-------- | :------- | :------------------------------------------ | :---------------------------------------------------- |
| `MW-WIDGET-001` | P2        | Frontend | `MW-VIEW-004`, `MW-VIEW-005`                | `apps/board/src/components/views/fields.tsx`          |
| `MW-WIDGET-002` | P2        | Frontend | `MW-WIDGET-001`, `MW-UI-001`                | `apps/board/src/components/views/`                    |
| `MW-WIDGET-003` | P2        | Frontend | `MW-WIDGET-001`, `MW-VIEW-005`, `MW-UI-002` | `apps/board/src/components/views/`                    |
| `MW-WIDGET-004` | P2        | Frontend | `MW-WIDGET-001`, `MW-ORM-008`, `MW-DOM-003` | `apps/board/src/components/views/fields.tsx`          |
| `MW-WIDGET-005` | P2        | Frontend | `MW-WIDGET-001`, `MW-VIEW-005`              | `apps/board/src/components/views/one2many-widget.tsx` |
| `MW-WIDGET-006` | P2        | Frontend | `MW-WIDGET-001`, `MW-ORM-002`               | `apps/board/src/components/views/`                    |
| `MW-WIDGET-007` | P2        | Frontend | `MW-WIDGET-004`, `MW-ORM-005`, `MW-API-003` | `apps/board/src/components/views/form-view.tsx`       |

- [x] **MW-WIDGET-001** Bangun `FieldWidgetRegistry` yang dapat diperluas di `apps/board/src/components/views/widget-registry.tsx` untuk `FieldCell` dan `FieldWidget`
  - [x] **MW-WIDGET-001.1** Definisikan interface `RegisteredFieldWidget` (renderer list cell, form editor, dan formatter CSV opsional)
  - [x] **MW-WIDGET-001.2** Dukung resolusi bertingkat berdasarkan `widget` eksplisit di view terlebih dahulu, lalu fallback ke `field.type`
  - [x] **MW-WIDGET-001.3** Refactor `fields.tsx` memakai registry tanpa mengubah perilaku kontrol existing
  - [x] **MW-WIDGET-001.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WIDGET-002** Implementasikan widget skalar lengkap menggunakan primitif `@moonwitness/ui` (`text` textarea, `float`, `decimal`, `monetary`, `date`, `datetime`, `json`, `badge`, `color`, `email`, `url`, `phone`)
  - [x] **MW-WIDGET-002.1** Tambahkan renderer editable & read-only cell untuk seluruh tipe skalar baru dengan dukungan locale/timezone (`apps/board/src/lib/date-format.ts`)
  - [x] **MW-WIDGET-002.2** Pastikan `monetary` membaca simbol mata uang dari record atau default perusahaan aktif
  - [x] **MW-WIDGET-002.3** Pastikan `email`/`url`/`phone` menampilkan tautan aman tervalidasi (`http:`/`https:`/`mailto:`/`tel:` saja, tolak `javascript:`)
  - [x] **MW-WIDGET-002.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WIDGET-003** Implementasikan widget header `StatusBar` deklaratif untuk field `selection`/`state` pada form view
  - [x] **MW-WIDGET-003.1** Hubungkan komponen `StatusBar` dari `@moonwitness/ui` (`MW-UI-002`) dengan metadata `views.form.header`
  - [x] **MW-WIDGET-003.2** Izinkan klik transisi status atau pemanggilan `action_*` terotorisasi saat tidak `readonly`
  - [x] **MW-WIDGET-003.3** Pastikan indikator status aktif terbaca tanpa bergantung warna saja (label + border/ikon)
  - [x] **MW-WIDGET-003.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WIDGET-004** Refactor `Many2oneWidget` (`apps/board/src/components/views/fields.tsx`) agar memakai `field.domain`, `field.context`, dan `_recName`/metadata target—menghapus hardcode `base.country_state`, `base.country`, `base.bank`, dan `base.user`
  - [x] **MW-WIDGET-004.1** Evaluasi `field.domain` secara reaktif terhadap nilai form saat ini untuk menyaring hasil `searchRead`
  - [x] **MW-WIDGET-004.2** Ambil field pencarian dari metadata target (`search.fields` / `_recName`) alih-alih `if (target === 'base.user')`
  - [x] **MW-WIDGET-004.3** Tambahkan tautan cepat ke record relasi dan tombol clear aksesibel (bukan ikon non-button dengan `onClick`)
  - [x] **MW-WIDGET-004.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` + E2E dropdown filter relasi lulus

- [x] **MW-WIDGET-005** Perbarui `One2ManyWidget` (`apps/board/src/components/views/one2many-widget.tsx`) agar membaca `foreignKey` dari metadata (hapus default `'partner_id'`) serta dukung tambah/edit baris via dialog
  - [x] **MW-WIDGET-005.1** Wajibkan `field.foreignKey` berasal dari metadata relasi backend dan tampilkan error konfigurasi yang jelas bila hilang
  - [x] **MW-WIDGET-005.2** Sediakan mode edit/tambah anak dalam modal/drawer atau inline row dengan mempertahankan jalur navigasi parent yang ada
  - [x] **MW-WIDGET-005.3** Uji pembuatan & penghapusan record anak `base.partner_address` dari form `base.partner`
  - [x] **MW-WIDGET-005.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` + E2E one2many lulus

- [x] **MW-WIDGET-006** Implementasikan `Many2ManyWidget` (chip tag + dialog multi-pilih) yang terhubung dengan field `manyToMany` (`MW-ORM-002`)
  - [x] **MW-WIDGET-006.1** Buat widget chip relasional yang mendukung penambahan/penghapusan relasi dengan pencarian asinkron ke model target
  - [x] **MW-WIDGET-006.2** Patuhi `field.readonly`, `field.domain`, dan izin read model target
  - [x] **MW-WIDGET-006.3** Uji keyboard interaction (`Backspace`/`Escape`/checkbox pilih) dan keterbacaan di viewport 320px
  - [x] **MW-WIDGET-006.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WIDGET-007** Bersihkan seluruh hardcode model/field dari `apps/board/src/components/views/form-view.tsx` (`country_id -> state_id` reset dan `contextDomain`) dengan menghubungkan endpoint `/onchange`
  - [x] **MW-WIDGET-007.1** Panggil `client.model(model).onchange(...)` saat field dengan flag `hasOnchange` berubah dan terapkan `values` / `domainOverrides` / toast `warnings`
  - [x] **MW-WIDGET-007.2** Hapus seluruh kondisi `if (name === 'country_id')` dan `contextDomain` manual di `form-view.tsx`
  - [x] **MW-WIDGET-007.3** Pastikan dirty state, validasi lokal, dan pengeditan tetap responsif tanpa memblokir ketikan
  - [x] **MW-WIDGET-007.4** Verifikasi: `pnpm --filter @moonwitness/board typecheck && pnpm lint` + E2E partner address lulus

---

## 09 — Action & Menu Engine

| ID           | Prioritas | Layer    | Dependensi                   | Lokasi Target                                                               |
| :----------- | :-------- | :------- | :--------------------------- | :-------------------------------------------------------------------------- |
| `MW-ACT-001` | P2        | Core     | `MW-ADDON-001`               | `packages/types/src/`, `packages/orm/src/`                                  |
| `MW-ACT-002` | P2        | Backend  | `MW-ACT-001`, `MW-SEC-003`   | `packages/orm/src/`, `apps/api/src/routes/generic.routes.ts`                |
| `MW-ACT-003` | P2        | Core     | `MW-ACT-001`                 | `packages/orm/src/`, `packages/types/src/`                                  |
| `MW-ACT-004` | P2        | Core     | `MW-ACT-003`, `MW-ADDON-001` | `packages/orm/src/addon.ts`, `packages/orm-base/src/manifest.ts`            |
| `MW-ACT-005` | P2        | Backend  | `MW-ACT-004`, `MW-SEC-001`   | `apps/api/src/routes/`                                                      |
| `MW-ACT-006` | P2        | Frontend | `MW-ACT-003`, `MW-VIEW-005`  | `apps/board/src/components/views/form-view.tsx`, `packages/orm/src/view.ts` |
| `MW-ACT-007` | P2        | Frontend | `MW-ACT-005`                 | `apps/board/src/components/layout/app-shell.tsx`                            |

- [x] **MW-ACT-001** Definisikan kontrak kanonis `ActionDefinition` (`window`, `server`, `client`, `record`) dan protokol hasil `ActionResult` (`reload`, `navigate`, `open_window`, `notify`, `download`)
  - [x] **MW-ACT-001.1** Tambahkan skema tipe action di `@moonwitness/types` dan helper `defineAction(...)` di `@moonwitness/orm`
  - [x] **MW-ACT-001.2** Daftarkan action pada `Addon.actions` dengan validasi ID unik (`<addon>.<slug>`) dan target model/handler valid
  - [x] **MW-ACT-001.3** Tambahkan unit test validasi & serialisasi kontrak action di `packages/orm/tests/`
  - [x] **MW-ACT-001.4** Verifikasi: `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-ACT-002** Bangun `ActionRegistry` backend & mesin eksekusi untuk action per-record, batch multi-record (`ids[]`), dan server action tingkat model
  - [x] **MW-ACT-002.1** Implementasikan `POST /api/:model/action/:actionName` dan `/api/:model/:id/action/:method` lewat `ActionRegistry` dalam `inRequestTransaction`
  - [x] **MW-ACT-002.2** Terapkan pengecekan domain kondisi action (`visibleIf` / `enabledIf`), pencatatan `base.audit_log`, dan event outbox
  - [x] **MW-ACT-002.3** Pastikan batch action membatasi jumlah ID (`<= 100`) dan memverifikasi record rule setiap ID dalam scope company aktif
  - [x] **MW-ACT-002.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-ACT-003** Implementasikan Window Actions (membuka model dengan `domain`, `context`, `viewModes`, `target: 'current' | 'dialog'`) dan Client Actions (membuka halaman modul seperti WhatsApp & Knowledge)
  - [x] **MW-ACT-003.1** Dukung deklarasi Window & Client Action pada manifest `orm-whatsapp`, `orm-knowledge`, `orm-request`, dan `orm-base`
  - [x] **MW-ACT-003.2** Pastikan Window Action mampu mengawali filter/konteks pembuatan record (mis. "Create Address for Partner" atau "My Open Requests")
  - [x] **MW-ACT-003.3** Tambahkan unit test resolusi Window & Client Action di `packages/orm/tests/`
  - [x] **MW-ACT-003.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance` lulus

- [x] **MW-ACT-004** Perbarui `AddonMenu` (`packages/orm/src/addon.ts`) menjadi `MenuRegistry` hierarkis (`id`, `parentId`, `label`, `icon`, `sequence`, `actionId` | `model`, `groups`, `developmentOnly`)
  - [x] **MW-ACT-004.1** Bangun pohon menu asiklik dengan deteksi orphan `parentId` dan siklus parent-child saat registrasi addon
  - [x] **MW-ACT-004.2** Konversi seluruh menu flat addon existing ke struktur hierarkis dengan backward compatibility
  - [x] **MW-ACT-004.3** Saring menu berdasarkan role/group pengguna, status aktif addon, serta mode `developmentOnly`
  - [x] **MW-ACT-004.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance` lulus

- [x] **MW-ACT-005** Sediakan endpoint `GET /api/app/bootstrap` yang mengembalikan profil user, company aktif, daftar addon aktif, pohon menu, action terotorisasi, dan preferensi skin dalam satu respons
  - [x] **MW-ACT-005.1** Implementasikan `GET /api/app/bootstrap` di `apps/api` sambil mempertahankan `/api/models` untuk kompatibilitas mundur
  - [x] **MW-ACT-005.2** Sertakan `registryGeneration` agar frontend tahu kapan harus menginvalidasi cache `/views`
  - [x] **MW-ACT-005.3** Uji isolasi per role (`system`, `superadmin`, `user`) dan perubahan `X-Company-Id` pada respons bootstrap
  - [x] **MW-ACT-005.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-ACT-006** Implementasikan Smart Buttons deklaratif (`smartButtons`) pada header `FormView` untuk menampilkan hitungan relasi langsung dan menjalankan Window Action scoped
  - [x] **MW-ACT-006.1** Hubungkan komponen `SmartButtonBox` (`MW-UI-002`) ke array `views.form.smartButtons` dengan fetching hitungan batch (`search_count` / `group-count`)
  - [x] **MW-ACT-006.2** Terapkan Smart Buttons nyata pada `base.partner` (Addresses, Bank Accounts, Activities) dan `base.company` (Users, Partners)
  - [x] **MW-ACT-006.3** Pastikan klik Smart Button membuka Window Action target dengan filter parent domain & context otomatis terisi
  - [x] **MW-ACT-006.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` + E2E smart-button navigation lulus

- [x] **MW-ACT-007** Refactor `apps/board/src/components/layout/app-shell.tsx` untuk merender menu hierarkis dan target omnisearch secara dinamis dari `/api/app/bootstrap`
  - [x] **MW-ACT-007.1** Hapus tautan sidebar hardcoded (`WhatsApp`, `Knowledge explorer`, `Story workbench`) dan pindahkan ke manifest client action addon terkait
  - [x] **MW-ACT-007.2** Ganti pencarian omnisearch yang di-hardcode pada 4 model dengan daftar model `searchable` dari bootstrap + izin read user
  - [x] **MW-ACT-007.3** Uji navigasi desktop, drawer mobile, dan command palette `Ctrl+K` tidak memiliki link ke halaman 403
  - [x] **MW-ACT-007.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` + navigation E2E lulus

---

## 10 — Domain & Context Engine

| ID           | Prioritas | Layer    | Dependensi                 | Lokasi Target                                                                                                |
| :----------- | :-------- | :------- | :------------------------- | :----------------------------------------------------------------------------------------------------------- |
| `MW-DOM-001` | P1        | Shared   | `MW-PKG-002`               | `packages/types/src/domain.ts`, `packages/orm/src/domain.ts`, `packages/client/src/domain.ts`                |
| `MW-DOM-002` | P1        | ORM      | `MW-DOM-001`               | `packages/orm/src/domain.ts`, `packages/orm/src/base.model.ts`                                               |
| `MW-DOM-003` | P2        | Core     | `MW-DOM-001`               | `packages/types/src/`, `packages/orm/src/domain.ts`                                                          |
| `MW-DOM-004` | P2        | Core     | `MW-DOM-003`               | `apps/api/src/plugins/orm.plugin.ts`, `packages/orm/src/environment.ts`, `packages/client/src/repository.ts` |
| `MW-DOM-005` | P2        | Addon    | `MW-DOM-003`, `MW-SEC-002` | `packages/orm-base/src/`                                                                                     |
| `MW-DOM-006` | P3        | Frontend | `MW-DOM-005`, `MW-WEB-003` | `apps/board/src/components/views/query-builder-dialog.tsx`, `apps/board/src/components/views/list-view.tsx`  |

- [x] **MW-DOM-001** Konsolidasikan parsing AST domain, validasi batas/kedalaman, dan evaluator in-memory ke `@moonwitness/types` (mendukung seluruh 16 `DomainOperator` seragam di server & client)
  - [x] **MW-DOM-001.1** Pindahkan `parseDomainToAST`, `validateDomain`, `normalizeLeaf`, dan `evalDomain` murni ke `@moonwitness/types`
  - [x] **MW-DOM-001.2** Hapus evaluator duplikat di `packages/client/src/domain.ts` (yang sebelumnya kehilangan operator `<>`, `like`, `not like`, `=like`, `is null`, `is not null` dan memakai `==`)
  - [x] **MW-DOM-001.3** Tambahkan unit test matriks 16 operator × tipe nilai (`null`, `boolean`, `number`, `string`, `array`) dan kasus negasi/nesting
  - [x] **MW-DOM-001.4** Verifikasi: `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/client test && pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-DOM-002** Tambahkan resolusi path relasional bertitik (`relation.field`, batas kedalaman maksimal 2 hop) pada kompilator SQL domain di `packages/orm/src/domain.ts`
  - [x] **MW-DOM-002.1** Kompilasi leaf bertitik seperti `['partner.country.code', '=', 'ID']` ke subquery `EXISTS` atau `LEFT JOIN` berparameter di Knex
  - [x] **MW-DOM-002.2** Validasi setiap hop terhadap `relationMappings`, eksistensi kolom, dan `hiddenFields` agar tidak bisa membocorkan field privat lewat domain
  - [x] **MW-DOM-002.3** Uji query domain bertitik pada SQLite dan PostgreSQL termasuk kasus negasi (`!`, `is null`) dan penolakan hop > 2 / `hiddenFields`
  - [x] **MW-DOM-002.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

- [x] **MW-DOM-003** Implementasikan interpolasi token konteks dinamis (`$uid`, `$partner_id`, `$company_id`, `$today`, `$now`) dalam domain untuk filter, record rule, field domain, dan window action
  - [x] **MW-DOM-003.1** Buat `resolveDomainContext(domain, ctx)` murni di `@moonwitness/types` dengan daftar token whitelist eksplisit
  - [x] **MW-DOM-003.2** Pastikan di server token selalu diisi dari `req.auth` / `env.context` terverifikasi, bukan dari payload request
  - [x] **MW-DOM-003.3** Uji resolusi `$uid`, `$company_id`, `$today` dan penolakan token liar
  - [x] **MW-DOM-003.4** Verifikasi: `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/orm test` lulus

- [x] **MW-DOM-004** Standarisasi propagasi `ExecutionContext` (`userId`, `role`, `companyId`, `lang`, `tz`, `activeTest`, `default_*`) di API, ORM, Job, dan `@moonwitness/client`
  - [x] **MW-DOM-004.1** Propagasi `lang`, `tz`, dan `activeTest` konsisten di `orm.plugin.ts`, `Environment`, dan `JobContext`
  - [x] **MW-DOM-004.2** Terapkan `default_*` secara aman pada `defaultGet` dan form creation context tanpa menimpa field `company_id` atau server-managed
  - [x] **MW-DOM-004.3** Tambahkan unit test propagasi context di API dan worker job
  - [x] **MW-DOM-004.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test` lulus

- [x] **MW-DOM-005** Tambahkan model `base.saved_filter` di `@moonwitness/orm-base` untuk menyimpan filter pencarian, sort, groupBy, dan flag default per `(model, company, user | shared)`
  - [x] **MW-DOM-005.1** Definisikan model `SavedFilter` (`model_name`, `name`, `domain_json`, `order`, `group_by`, `is_default`, `is_shared`, `user`, `company`) serta validasi JSON domain saat save
  - [x] **MW-DOM-005.2** Terapkan record rule bahwa user hanya boleh mengubah filter miliknya, sedangkan filter `is_shared: true` hanya bisa dipublikasikan oleh admin/superadmin
  - [x] **MW-DOM-005.3** Tambahkan views, manifest registration, dan unit/integration tests
  - [x] **MW-DOM-005.4** Verifikasi: `pnpm --filter @moonwitness/orm-base test && pnpm test:addon-conformance` lulus

- [x] **MW-DOM-006** Hubungkan Search View & Query Builder di `apps/board` ke `base.saved_filter` dengan dukungan penuh 16 operator domain
  - [x] **MW-DOM-006.1** Perbarui `query-builder-dialog.tsx` untuk mendukung seluruh operator (`is null`, `is not null`, `in`, `not in`, `ilike`, `=`, `!=`, dll.) dan pratinjau filter
  - [x] **MW-DOM-006.2** Tambahkan menu "Save current filter" dan daftar filter tersimpan pada `SearchEngineBar`
  - [x] **MW-DOM-006.3** Uji simpan, muat ulang, pilih default, dan hapus saved filter antar-company terisolasi di Playwright
  - [x] **MW-DOM-006.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` + E2E lulus

---

## 11 — Security & Identity

| ID           | Prioritas | Layer    | Dependensi                               | Lokasi Target                                                                   |
| :----------- | :-------- | :------- | :--------------------------------------- | :------------------------------------------------------------------------------ |
| `MW-SEC-001` | P0        | Security | `MW-CORE-001`, `MW-ADDON-001`            | `packages/orm/src/model-definition.ts`, `apps/api/src/auth/policy.ts`           |
| `MW-SEC-002` | P1        | Security | `MW-SEC-001`, `MW-DOM-003`               | `packages/orm/src/addon.ts`, `apps/api/src/auth/rules.ts`                       |
| `MW-SEC-003` | P1        | Security | `MW-SEC-001`, `MW-ORM-011`               | `packages/orm/src/model-definition.ts`, `apps/api/src/routes/generic.routes.ts` |
| `MW-SEC-004` | P1        | Security | `MW-ACT-001`, `MW-SEC-001`               | `apps/api/src/auth/policy.ts`, `packages/orm/src/`                              |
| `MW-SEC-005` | P0        | Security | `MW-SEC-002`, `MW-SEC-003`, `MW-SEC-004` | `apps/api/tests/`, `apps/api/src/routes/`                                       |
| `MW-SEC-006` | P1        | Security | `MW-SEC-002`                             | `apps/api/src/routes/generic.routes.ts`, `apps/api/src/whatsapp/media.ts`       |
| `MW-SEC-007` | P1        | Security | `MW-SEC-001`                             | `apps/api/src/plugins/auth.plugin.ts`, `packages/auth/src/service.ts`           |
| `MW-SEC-008` | P0        | Security | `MW-DOM-004`                             | `apps/api/src/routes/generic.routes.ts`                                         |

- [x] **MW-SEC-001** Pindahkan klasifikasi kebijakan akses model (`internal`, `adminOnly`, `publicRead`, `readOnlyForUsers`) dari list hardcoded di `apps/api/src/auth/{policy,rules}.ts` ke metadata deklaratif `defineModel` / `defineAddon` (tetap menjaga guard fail-closed prefix `knowledge.*`)
  - [x] **MW-SEC-001.1** Tambahkan properti `accessPolicy` pada opsi `defineModel` dengan default aman (`internal` / fail-closed) jika tidak dideklarasikan eksplisit
  - [x] **MW-SEC-001.2** Kompilasi kebijakan model dari `Registry` pada saat startup dan perbarui `canAccess()` agar membaca registry sambil tetap mempertahankan blokir permanen prefix `knowledge.*` dan `auth.*`
  - [x] **MW-SEC-001.3** Anotasi seluruh 73 model addon yang ada agar semantik izin eksisting terjaga 100% tanpa regresi
  - [x] **MW-SEC-001.4** Verifikasi: `pnpm --filter @moonwitness/api exec vitest run tests/security-hardening.test.ts tests/api-orm-hardening.test.ts` lulus

- [x] **MW-SEC-002** Izinkan addon mendeklarasikan `recordRules` langsung pada manifest (menggantikan switch-case hardcoded di `apps/api/src/auth/rules.ts`) dengan batas tenant `company_id` yang tetap wajib dan tak dapat dioverride
  - [x] **MW-SEC-002.1** Tambahkan tipe `AddonRecordRule` (`model`, `operations`, `domain`, `groups`) pada `Addon.security`
  - [x] **MW-SEC-002.2** Pastikan `getRecordRuleDomain` selalu menggabungkan (`AND`) batas `company_id` sebelum mengevaluasi rule addon kustom
  - [x] **MW-SEC-002.3** Migrasi rule untuk `notification.*`, `base.partner`, `base.partner_address`, `base.partner_category_link`, dan `base.company` ke manifest addon terkait
  - [x] **MW-SEC-002.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm test:integration` lulus

- [x] **MW-SEC-003** Implementasikan ACL tingkat field (`groups` / `readGroups` / `writeGroups` pada `FieldOptions`) yang ditegakkan pada `describeFields`, `search_read`, `browse`, `create`, `write`, `group-count`, dan CSV export
  - [x] **MW-SEC-003.1** Saring `FieldMeta` dalam `/fields` dan `/views` berdasarkan `groupPermissions` / role caller
  - [x] **MW-SEC-003.2** Strip field terlarang dari hasil `search_read`/`read`, tolak (`403`) penggunaannya pada `fields`, `domain`, `order`, `group_by`, dan tolak penulisan (`403`) di `create`/`write`/`jsonrpc`
  - [x] **MW-SEC-003.3** Tambahkan uji positif dan negatif ACL field di REST, JSON-RPC, dan grouped-count
  - [x] **MW-SEC-003.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-SEC-004** Implementasikan izin akses tingkat action (`allowedGroups` / `requiredPermission` pada `ActionDefinition`), memisahkan eksekusi aksi sensitif dari izin `'write'` biasa
  - [x] **MW-SEC-004.1** Tambahkan fungsi `canExecuteAction(auth, model, actionDef)` di `apps/api/src/auth/policy.ts`
  - [x] **MW-SEC-004.2** Saring action yang tidak boleh dijalankan caller dari metadata `/api/:model/views` dan `/api/app/bootstrap`, dan kembalikan `403` pada panggilan API langsung
  - [x] **MW-SEC-004.3** Uji action permission terpisah antara role `user` biasa vs group khusus vs `superadmin`
  - [x] **MW-SEC-004.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-SEC-005** Buktikan paritas otorisasi lintas-lapis antara REST `/api/:model`, JSON-RPC `/jsonrpc`, `base.attachment`, `group-count`, dan rute domain addon (`notification`, `workflow`, `whatsapp`, `knowledge`)
  - [x] **MW-SEC-005.1** Satukan helper otorisasi yang dipakai oleh REST dan JSON-RPC agar nol perbedaan jalur validasi
  - [x] **MW-SEC-005.2** Uji seluruh skenario negatif lintas-company (`X-Company-Id`), lintas-user, dan manipulasi FK lintas-tenant pada REST & JSON-RPC
  - [x] **MW-SEC-005.3** Pastikan `knowledge.*` dan `auth.*` tetap mengembalikan `403`/`404` tanpa membocorkan eksistensi tabel/model
  - [x] **MW-SEC-005.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm test:integration` lulus

- [x] **MW-SEC-006** Perkuat kontrol akses upload/download `base.attachment` untuk tautan polimorfik (`resource_model`/`resource_id`) dan satukan validasi magic-byte MIME di `generic.routes.ts` & `whatsapp/media.ts`
  - [x] **MW-SEC-006.1** Ekstrak helper shared validasi nama file aman, ukuran maksimum, dan magic-byte signature MIME ke satu modul
  - [x] **MW-SEC-006.2** Wajibkan pemanggil upload `base.attachment` memiliki izin `write` (atau izin khusus attachment) pada parent record dan berada pada company yang sama
  - [x] **MW-SEC-006.3** Uji path traversal, MIME palsu (ekstensi `.png` berisi script), dan akses lampiran antar-tenant
  - [x] **MW-SEC-006.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-SEC-007** Implementasikan mekanisme invalidasi cache otorisasi & pencabutan sesi segera saat role, password, group membership, atau company membership diubah
  - [x] **MW-SEC-007.1** Tambahkan epoch/generation counter per user atau cluster (tersimpan aman / disinkronkan via DB timestamp/revision) yang diinvalidasi saat `base.user`, `base.group_membership`, `base.model_access`, atau `base.company_membership` dimutasi
  - [x] **MW-SEC-007.2** Pastikan pencabutan grant atau deaktivasi user membatalkan akses di request berikutnya secara langsung
  - [x] **MW-SEC-007.3** Tambahkan uji integrasi multi-request pencabutan akses group & company
  - [x] **MW-SEC-007.4** Verifikasi: `pnpm --filter @moonwitness/api exec vitest run tests/auth.test.ts` lulus

- [x] **MW-SEC-008** Amankan input `context` dan `domain` dari klien pada endpoint `default-get`, `onchange`, dan `group-count` agar tidak dapat memalsukan `userId`, `role`, `companyId`, atau bypass `activeTest`
  - [x] **MW-SEC-008.1** Terapkan allowlist ketat pada parameter `context` yang berasal dari klien (hanya izinkan `default_*`, `lang`, `tz`, dan key tampilan aman)
  - [x] **MW-SEC-008.2** Pastikan key keamanan (`userId`, `role`, `companyId`, `partnerId`, `trx`) selalu ditimpa dari server `req.auth`
  - [x] **MW-SEC-008.3** Tambahkan uji adversarial context-injection di `apps/api/tests/security-hardening.test.ts`
  - [x] **MW-SEC-008.4** Verifikasi: `pnpm --filter @moonwitness/api exec vitest run tests/security-hardening.test.ts` lulus

---

## 12 — API & RPC Architecture

| ID           | Prioritas | Layer   | Dependensi                               | Lokasi Target                                               |
| :----------- | :-------- | :------ | :--------------------------------------- | :---------------------------------------------------------- |
| `MW-API-001` | P1        | Backend | `MW-SEC-001`, `MW-SEC-005`               | `apps/api/src/routes/generic.routes.ts`                     |
| `MW-API-002` | P2        | Backend | `MW-API-001`, `MW-ACT-002`, `MW-ORM-005` | `apps/api/src/routes/`, `packages/types/src/jsonrpc.ts`     |
| `MW-API-003` | P2        | Backend | `MW-ORM-005`, `MW-API-001`               | `apps/api/src/routes/`, `packages/client/src/repository.ts` |
| `MW-API-004` | P1        | Backend | `MW-API-001`                             | `apps/api/src/routes/`, `packages/orm-storage/src/index.ts` |
| `MW-API-005` | P3        | Backend | `MW-API-001`, `MW-ORM-001`               | `apps/api/src/app.ts`, `apps/api/src/routes/`               |
| `MW-API-006` | P2        | Backend | `MW-CORE-006`, `MW-API-001`              | `packages/types/src/api.ts`, `apps/api/src/routes/`         |
| `MW-API-007` | P2        | Backend | `MW-API-001`, `MW-PERF-002`              | `apps/api/src/routes/`, `packages/client/src/repository.ts` |

- [x] **MW-API-001** Pecah `apps/api/src/routes/generic.routes.ts` (1.586 baris) menjadi modul route & policy terfokus (`metadata.routes.ts`, `query.routes.ts`, `mutation.routes.ts`, `attachment.routes.ts`, `jsonrpc.routes.ts`, `generic-policy.ts`)
  - [x] **MW-API-001.1** Pastikan seluruh assertion test integrasi & otorisasi berjalan hijau sebelum memulai pemecahan
  - [x] **MW-API-001.2** Ekstrak masing-masing domain tanggung jawab menjadi sub-plugin Fastify (< 350 baris per file) tanpa mengubah URL, header, atau error code
  - [x] **MW-API-001.3** Pastikan `pnpm docs:generate` (`extractRoutes`) tetap mendeteksi 100% endpoint generik pada file-file hasil pemecahan
  - [x] **MW-API-001.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm test:integration && pnpm docs:check` lulus

- [x] **MW-API-002** Lengkapi paritas JSON-RPC `execute_kw` (`/jsonrpc`) agar mendukung `read`, `search_count`, `search_group_count`, `fields_get`, `views_get`, `default_get`, `onchange`, dan `call_action`
  - [x] **MW-API-002.1** Perbarui `rpcOperation` dan dispatcher `executeRpc` dengan pengecekan `canAccess`, record rule, field ACL, dan batas query yang identik dengan REST
  - [x] **MW-API-002.2** Dukung `expected_write_date` pada JSON-RPC `write` dan return JSON-RPC error code terstruktur (`-32003` Forbidden, `-32009` Conflict)
  - [x] **MW-API-002.3** Tambahkan client wrapper method di `packages/client` & test kontrak JSON-RPC lengkap
  - [x] **MW-API-002.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/client test` lulus

- [x] **MW-API-003** Sediakan endpoint REST `POST /api/:model/default-get` dan `POST /api/:model/onchange` beserta method terkait di `ModelRepository`
  - [x] **MW-API-003.1** Terapkan validasi skema body, strip server-managed/readonly fields, dan delegasikan ke `Model.defaultGet` / `Model.onchange`
  - [x] **MW-API-003.2** Pastikan `onchange` memfilter hasil sesuai field-level ACL caller sebelum dikirim kembali
  - [x] **MW-API-003.3** Tambah method `getDefaults` dan `onchange` pada `packages/client/src/repository.ts`
  - [x] **MW-API-003.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/client test` lulus

- [x] **MW-API-004** Ubah endpoint `/api/base.attachment/upload` dari buffering memori penuh (`Buffer`) menjadi streaming via `putStream` di `@moonwitness/orm-storage` dan dukung `multipart/form-data`
  - [x] **MW-API-004.1** Gunakan `putStream` untuk menghitung SHA-256 checksum dan batas ukuran `MAX_ATTACHMENT_BYTES` sambil mengalirkan stream langsung ke storage lokal/S3
  - [x] **MW-API-004.2** Pertahankan kompatibilitas upload `application/octet-stream` eksisting sekaligus dukung `multipart/form-data`
  - [x] **MW-API-004.3** Uji pembatalan stream, penolakan > 10 MiB (`413`), dan cleanup atomik jika transaksi DB gagal
  - [x] **MW-API-004.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/orm-storage test` lulus

- [x] **MW-API-005** Hasilkan skema OpenAPI 3.x dinamis dari metadata model & route addon pada `@fastify/swagger`
  - [x] **MW-API-005.1** Konversikan `Model.jsonSchema` dan `FieldMeta` terdaftar menjadi skema komponen OpenAPI yang terdokumentasi rapi di `/docs`
  - [x] **MW-API-005.2** Jangan mengekspos model `internal` / `knowledge.*` pada spesifikasi OpenAPI generik bila tidak diizinkan
  - [x] **MW-API-005.3** Uji validitas dokumen `app.swagger()` saat test suite dijalankan
  - [x] **MW-API-005.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-API-006** Seragamkan amplop respons JSON API (`success`, `data`, `meta`, `error`, `code`, `requestId`) dan metadata paginasi di seluruh route
  - [x] **MW-API-006.1** Standarisasi tipe amplop di `packages/types/src/api.ts` dan `routes.ts`
  - [x] **MW-API-006.2** Sertakan `code` error dan `requestId` di semua respons kegagalan `apps/api` tanpa memecahkan field existing yang dipakai client
  - [x] **MW-API-006.3** Tambahkan unit test kontrak respons sukses & error
  - [x] **MW-API-006.4** Verifikasi: `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/api test` lulus

- [x] **MW-API-007** Tambahkan endpoint mutasi bulk transaksional (`PATCH /api/:model/bulk`, `DELETE /api/:model/bulk`, batch `action`) yang dibatasi maksimal 100 ID
  - [x] **MW-API-007.1** Validasi panjang daftar `ids` (`1..100`), cek otorisasi per record, jalankan `findReference` ter-batch (`MW-PERF-002`), dan tulis audit log + outbox dalam satu transaksi
  - [x] **MW-API-007.2** Tambahkan method `bulkWrite`, `bulkUnlink`, dan `bulkAction` di `packages/client/src/repository.ts`
  - [x] **MW-API-007.3** Uji rollback penuh apabila 1 dari N record gagal validasi atau ditolak record rule
  - [x] **MW-API-007.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/client test` lulus

---

## 13 — Backend Transformation: `apps/api`

| ID            | Prioritas | Layer   | Dependensi                    | Lokasi Target                                                         |
| :------------ | :-------- | :------ | :---------------------------- | :-------------------------------------------------------------------- |
| `MW-BACK-001` | P2        | Backend | —                             | `apps/api/src/routes/whatsapp/`, `apps/api/src/whatsapp/`             |
| `MW-BACK-002` | P2        | Backend | `MW-CORE-002`                 | `apps/api/src/whatsapp/manifest.ts`, `apps/api/src/`                  |
| `MW-BACK-003` | P2        | Backend | `MW-ADDON-006`                | `apps/api/src/research-review-workflow.ts`, `packages/orm-knowledge/` |
| `MW-BACK-004` | P2        | Backend | `MW-CORE-003`, `MW-ORM-007`   | `apps/api/src/`                                                       |
| `MW-BACK-005` | P2        | Backend | `MW-ADDON-006`, `MW-BACK-001` | `apps/api/src/addons/registry.ts`, `apps/api/src/routes/`             |
| `MW-BACK-006` | P1        | Backend | `MW-CORE-004`                 | `apps/api/src/app.ts`, `apps/api/src/plugins/rate-limit-store.ts`     |
| `MW-BACK-007` | P1        | Backend | `MW-CORE-006`                 | `apps/api/src/plugins/observability.plugin.ts`, `apps/api/src/app.ts` |

- [x] **MW-BACK-001** Pecah sub-router WhatsApp yang masih besar (`conversations.routes.ts` 1.073 baris, `groups.routes.ts` 1.015 baris, `messages.routes.ts` 864 baris, dan `route-helpers.ts` 831 baris) menjadi layanan domain terpisah
  - [x] **MW-BACK-001.1** Ekstrak logika bisnis sinkronisasi GoWA, rekonsiliasi cursor baca, dan penggabungan LID ke layanan murni terpisah dari adapter Fastify
  - [x] **MW-BACK-001.2** Jaga setiap file route handler tetap tipis (< 400 baris) tanpa mengubah kontrak HTTP atau header HMAC
  - [x] **MW-BACK-001.3** Pastikan seluruh test suite WhatsApp tetap hijau pada SQLite & PostgreSQL
  - [x] **MW-BACK-001.4** Verifikasi: `pnpm --filter @moonwitness/api exec vitest run tests/whatsapp*.test.ts && pnpm lint` lulus

- [x] **MW-BACK-002** Hapus file shim legacy `apps/api/src/whatsapp/manifest.ts` setelah seluruh worker dan test mengimpor langsung dari `@moonwitness/orm-whatsapp`
  - [x] **MW-BACK-002.1** Perbarui sisa import `../whatsapp/manifest.js` di `registry.ts`, worker commands, dan file test
  - [x] **MW-BACK-002.2** Hapus file `apps/api/src/whatsapp/manifest.ts`
  - [x] **MW-BACK-002.3** Pastikan cek `api:addon:check` dan `docs:check` tetap bersih
  - [x] **MW-BACK-002.4** Verifikasi: `pnpm api:addon:check && pnpm build && pnpm --filter @moonwitness/api test` lulus

- [x] **MW-BACK-003** Pindahkan `apps/api/src/research-review-workflow.ts` ke setup/seed deklaratif milik addon `knowledge` di `@moonwitness/orm-knowledge`
  - [x] **MW-BACK-003.1** Integrasikan inisialisasi workflow review riset ke `manifest.setup` / `manifest.data` di `@moonwitness/orm-knowledge`
  - [x] **MW-BACK-003.2** Hapus hook `postInstall` khusus knowledge di `apps/api/src/addons/registry.ts`
  - [x] **MW-BACK-003.3** Uji install ulang idempoten dan pastikan record workflow tetap terjaga
  - [x] **MW-BACK-003.4** Verifikasi: `node scripts/knowledge/run-k-gate.mjs --json && pnpm test:addon-conformance` lulus

- [x] **MW-BACK-004** Hilangkan akses query DB mentah (`app.db('...')`) yang melewati ORM di `apps/api/src/` pada model yang dikelola addon (termasuk flag, status auth, dan helper domain)
  - [x] **MW-BACK-004.1** Audit seluruh kemunculan `app.db(` / `db(` di `apps/api/src/` dan alihkan ke model ORM atau helper paket domain terkait
  - [x] **MW-BACK-004.2** Pertahankan raw DB hanya pada mekanisme infrastruktur murni (rate-limit store, advisory lock migrasi, probe health `/readyz`)
  - [x] **MW-BACK-004.3** Uji regresi fungsional untuk setiap endpoint yang dialihkan ke ORM
  - [x] **MW-BACK-004.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm test:integration` lulus

- [x] **MW-BACK-005** Sambungkan registrasi seluruh plugin route fitur ke mekanisme `httpPlugins` di `API_ADDONS` agar `apps/api` murni bertindak sebagai host runtime tipis
  - [x] **MW-BACK-005.1** Pastikan plugin route addon menerima dependensi runtime lewat `ServiceRegistry` (`MW-CORE-003`)
  - [x] **MW-BACK-005.2** Kurangi import route spesifik di `apps/api/src/addons/registry.ts` hingga hanya mengorkestrasi addon aktif
  - [x] **MW-BACK-005.3** Jalankan generator docs untuk memverifikasi daftar endpoint di `generated-api.md` tetap akurat 100%
  - [x] **MW-BACK-005.4** Verifikasi: `pnpm docs:check && pnpm api:addon:check && pnpm --filter @moonwitness/api test` lulus

- [x] **MW-BACK-006** Sentralisasikan kebijakan rate-limit per keluarga route (auth, bulk/upload, RPC, WhatsApp, local-ai) dengan header `429 Retry-After` dan dukungan penuh `PostgresRateLimitStore`
  - [x] **MW-BACK-006.1** Definisikan tabel kebijakan batas per route di `apps/api/src/config/` agar tidak tersebar angka ajaib di tiap file route
  - [x] **MW-BACK-006.2** Gunakan key komposit `(companyId:userId)` untuk endpoint terautentikasi dan IP aman (`trustProxy`) untuk endpoint publik
  - [x] **MW-BACK-006.3** Uji skenario burst limit dengan `RATE_LIMIT_STORE=postgres`
  - [x] **MW-BACK-006.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm test:integration` lulus

- [x] **MW-BACK-007** Lengkapi korelasi `x-request-id`, pemetaan error database terstandar, dan verifikasi redaksi log untuk seluruh rute baru (`bootstrap`, `default-get`, `onchange`, `bulk`, `jsonrpc`)
  - [x] **MW-BACK-007.1** Pastikan setiap respons sukses maupun gagal mengembalikan header `x-request-id` yang konsisten dengan log Pino
  - [x] **MW-BACK-007.2** Perluas uji redaksi sentinel logger atas token, password, dan field `sensitive: true` pada rute baru
  - [x] **MW-BACK-007.3** Pastikan metrik Prometheus (`/metrics`) membatasi label kardinalitas rendah (route template saja)
  - [x] **MW-BACK-007.4** Verifikasi: `pnpm --filter @moonwitness/api exec vitest run tests/security-hardening.test.ts` lulus

---

## 14 — Frontend Transformation: `apps/web` (`apps/board`)

| ID           | Prioritas | Layer    | Dependensi                                                 | Lokasi Target                                                                         |
| :----------- | :-------- | :------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| `MW-WEB-001` | P2        | Frontend | `MW-VIEW-004`, `MW-VIEW-006`, `MW-API-007`                 | `apps/board/src/components/views/list-view.tsx`                                       |
| `MW-WEB-002` | P2        | Frontend | `MW-VIEW-007`, `MW-WEB-001`, `MW-UI-003`                   | `apps/board/src/components/views/`                                                    |
| `MW-WEB-003` | P2        | Frontend | `MW-VIEW-006`, `MW-DOM-005`, `MW-WEB-001`                  | `apps/board/src/components/views/`                                                    |
| `MW-WEB-004` | P2        | Frontend | `MW-VIEW-005`, `MW-WIDGET-007`, `MW-ACT-006`, `MW-API-003` | `apps/board/src/components/views/form-view.tsx`                                       |
| `MW-WEB-005` | P3        | Frontend | `MW-VIEW-008`, `MW-VIEW-009`, `MW-WEB-001`                 | `apps/board/src/components/views/`                                                    |
| `MW-WEB-006` | P2        | Frontend | `MW-ACT-003`, `MW-WEB-002`, `MW-WEB-004`                   | `apps/board/src/board-pages/model-page.tsx`                                           |
| `MW-WEB-007` | P2        | Frontend | —                                                          | `apps/board/src/board-pages/whatsapp-page.tsx`, `apps/board/src/components/whatsapp/` |
| `MW-WEB-008` | P3        | Frontend | `MW-ACT-007`                                               | `apps/board/src/board-pages/dashboard-page.tsx`                                       |
| `MW-WEB-009` | P1        | Frontend | `MW-ACT-007`                                               | `apps/board/src/hooks/use-auth.tsx`, `apps/board/src/lib/query-scope.ts`              |

- [x] **MW-WEB-001** Pecah `apps/board/src/components/views/list-view.tsx` (1.486 baris) menjadi engine terpisah (`ListEngine`, `ListTable`, `BulkActionBar`, `ColumnToggle`, `ListStateAdapter`)
  - [x] **MW-WEB-001.1** Ekstrak helper murni pembangun domain & paginasi ke unit terpisah dengan unit test langsung
  - [x] **MW-WEB-001.2** Sambungkan `BulkActionBar` ke endpoint transaksional `bulkUnlink`/`bulkAction` (`MW-API-007`) serta pertahankan CSV export formula-safe
  - [x] **MW-WEB-001.3** Tambahkan dukungan toggle kolom opsional (`optional: 'show' | 'hide'`), baris dekorasi warna semantik, dan footer agregasi (`sum`/`avg`)
  - [x] **MW-WEB-001.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck && pnpm test:board-csv` lulus

- [x] **MW-WEB-002** Bangun `KanbanEngine` dinamis berbasis `views.kanban` (`MW-VIEW-007`) menggunakan `@moonwitness/ui` `KanbanBoard` menggantikan blok pipeline sementara di `list-view.tsx`
  - [x] **MW-WEB-002.1** Render kolom stage dari urutan `views.kanban.stageOrder` / nilai selection model beserta jumlah record per stage
  - [x] **MW-WEB-002.2** Dukung perpindahan stage yang mudah diakses via keyboard maupun drag/menu aksi dengan optimistic update + rollback saat `403`/`409`
  - [x] **MW-WEB-002.3** Sembunyikan tab Kanban secara bersih bagi model yang tidak mendeklarasikan `views.kanban`
  - [x] **MW-WEB-002.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WEB-003** Bangun `SearchEngineBar` terpadu dari metadata `views.search`, chip facet aktif, pemilih `groupBy`, `searchPanel`, dan filter tersimpan (`base.saved_filter`)
  - [x] **MW-WEB-003.1** Sinkronkan status pencarian, filter aktif, dan `groupBy` dengan state URL agar tautan pencarian bisa di-bookmark / di-refresh
  - [x] **MW-WEB-003.2** Saat `groupBy` aktif, tampilkan header grup dari `/api/:model/group-count` dengan ekspansi baris lazy per grup
  - [x] **MW-WEB-003.3** Gunakan chip facet `@moonwitness/ui` `FilterFacetBar` yang dapat dihapus lewat keyboard
  - [x] **MW-WEB-003.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WEB-004** Tingkatkan `FormView` menjadi `FormEngine` lengkap dengan `StatusBar`, `SmartButtonBox`, tabbed notebooks, dialog konfirmasi shared (ganti `window.confirm`/`alert`), dan pemulihan konflik `write_date` (`409`)
  - [x] **MW-WEB-004.1** Ganti `window.confirm` & `window.alert` pada `form-view.tsx`, `list-view.tsx`, dan `one2many-widget.tsx` dengan `Dialog` & `toast` dari `@moonwitness/ui`
  - [x] **MW-WEB-004.2** Kirim header `If-Match` berisi `write_date` saat update dan tampilkan banner resolusi konflik yang ramah bila server membalas `409`
  - [x] **MW-WEB-004.3** Render `tabs` dan `sections` secara responsif dan hormati opsi `chatter: false` bila model menonaktifkan chatter
  - [x] **MW-WEB-004.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WEB-005** Implementasikan renderer `CalendarView`, `GraphView`, dan `PivotView` yang di-lazy-load (`next/dynamic`) menggunakan `@moonwitness/ui/components/chart` dan `/api/:model/group-count`
  - [x] **MW-WEB-005.1** Buat `CalendarView` interaktif (mode bulan/minggu) untuk model bertanggal seperti `base.activity`
  - [x] **MW-WEB-005.2** Buat `GraphView` (`bar`, `line`, `pie`) dengan tabel data alternatif yang aksesibel dari `@moonwitness/ui/components/chart`
  - [x] **MW-WEB-005.3** Buat `PivotView` ringkas berbasis matriks `/group-count` beserta tombol ekspor CSV yang aman
  - [x] **MW-WEB-005.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck && pnpm board:budget` lulus

- [x] **MW-WEB-006** Perbarui `apps/board/src/board-pages/model-page.tsx` dengan View Switcher dinamis dan eksekutor hasil Action (`ActionResult`)
  - [x] **MW-WEB-006.1** Dukung perpindahan mulus antar mode view tersedia (`list`, `kanban`, `calendar`, `graph`, `pivot`) sesuai Window Action dan metadata model
  - [x] **MW-WEB-006.2** Tangani `ActionResult` (`open_window` di tab atau dialog, `navigate`, `reload`, `notify`, `download`) secara terpusat
  - [x] **MW-WEB-006.3** Pertahankan jalur direct URL `/board/m/:model` dan `/board/m/:model/:id` serta guard akses 403/404
  - [x] **MW-WEB-006.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WEB-007** Lanjutkan dekomposisi `apps/board/src/board-pages/whatsapp-page.tsx` (2.897 baris) ke komponen dan custom hooks domain terpisah (`todo-foundation.md`)
  - [x] **MW-WEB-007.1** Ekstrak `InboxList`, `ConversationTimeline`, `PairingPanel`, dan hook polling/state ke `apps/board/src/components/whatsapp/`
  - [x] **MW-WEB-007.2** Jaga `whatsapp-page.tsx` sebagai orkestrator ringan (< 450 baris) tanpa regresi UX atau polling background
  - [x] **MW-WEB-007.3** Pastikan nol warning `oxlint` dan nol pelanggaran `board:ui:check`
  - [x] **MW-WEB-007.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board lint && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WEB-008** Modularisasi `apps/board/src/board-pages/dashboard-page.tsx` (991 baris) ke panel KPI dan modul operasional berbasis izin pengguna
  - [x] **MW-WEB-008.1** Pisahkan panel KPI inti, panel admin `jobs`/`outbox`/`cron`, dan panel aktivitas menjadi komponen independen
  - [x] **MW-WEB-008.2** Periksa izin/grant model sebelum memanggil API panel dashboard agar tidak menghasilkan 403 berisik di network console
  - [x] **MW-WEB-008.3** Pertahankan keselarasan visual dan baseline screenshot dashboard desktop/mobile
  - [x] **MW-WEB-008.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-WEB-009** Pastikan isolasi penuh cache TanStack Query di `apps/board` saat ganti perusahaan (`X-Company-Id`), ganti user, atau sesi habis
  - [x] **MW-WEB-009.1** Bersihkan query cache milik tenant/user sebelumnya secara sinkron saat `handleSelectCompany`, `logout`, atau `onSessionExpired`
  - [x] **MW-WEB-009.2** Pastikan `useModels` dan `useViews` selalu mengikat `scopedQueryKey` yang mencakup `(userId, companyId, generation)`
  - [x] **MW-WEB-009.3** Tambahkan atau jalankan uji E2E peralihan perusahaan untuk memastikan tidak ada data tenant lama yang sempat berkedip
  - [x] **MW-WEB-009.4** Verifikasi: `pnpm --filter @moonwitness/board typecheck && pnpm test:e2e` lulus

---

## 15 — Shared UI & Design System

| ID          | Prioritas | Layer  | Dependensi                                         | Lokasi Target                                                              |
| :---------- | :-------- | :----- | :------------------------------------------------- | :------------------------------------------------------------------------- |
| `MW-UI-001` | P2        | Shared | —                                                  | `packages/ui/src/components/`, `packages/ui/package.json`                  |
| `MW-UI-002` | P2        | Shared | —                                                  | `packages/ui/src/components/`, `packages/ui/package.json`                  |
| `MW-UI-003` | P2        | Shared | —                                                  | `packages/ui/src/components/`, `packages/ui/package.json`                  |
| `MW-UI-004` | P2        | Shared | —                                                  | `packages/ui/src/components/table.tsx`                                     |
| `MW-UI-005` | P3        | Shared | `MW-UI-001`, `MW-UI-002`, `MW-UI-003`, `MW-UI-004` | `apps/ui-catalog/src/catalog.tsx`, `apps/ui-catalog/tests/catalog.spec.ts` |
| `MW-UI-006` | P2        | Shared | `MW-UI-001`                                        | `scripts/check-board-shared-ui.mjs`                                        |

- [x] **MW-UI-001** Tambahkan primitif `DatePicker` (date & datetime), `NumberInput` (desimal/moneter), dan `TagInput` ke `@moonwitness/ui` beserta subpath export resmi
  - [x] **MW-UI-001.1** Implementasikan komponen terkontrol yang mendukung keyboard navigation, `aria-invalid`, dan disabled state
  - [x] **MW-UI-001.2** Daftarkan subpath export eksplisit di `packages/ui/package.json` (hindari barrel export berat)
  - [x] **MW-UI-001.3** Tambahkan unit test kontrol shared di `packages/ui/tests/shared-controls.test.mjs`
  - [x] **MW-UI-001.4** Verifikasi: `pnpm test:ui && pnpm test:ui-budget` lulus

- [x] **MW-UI-002** Tambahkan primitif komposisi `StatusBar` dan `SmartButtonBox` ke `@moonwitness/ui` sesuai bahasa visual MoonWitness
  - [x] **MW-UI-002.1** Dukung state aktif/selesai/disabled pada `StatusBar` dan angka count + ikon + label pada `SmartButtonBox`
  - [x] **MW-UI-002.2** Pastikan tampilan responsif pada lebar minimum 320px tanpa horizontal overflow atau clipping focus ring
  - [x] **MW-UI-002.3** Tambahkan unit test komposisi di `packages/ui/tests/compositions.test.mjs`
  - [x] **MW-UI-002.4** Verifikasi: `pnpm test:ui` lulus

- [x] **MW-UI-003** Tambahkan primitif komposisi `KanbanBoard` / `KanbanColumn` dan `FilterFacetBar` ke `@moonwitness/ui` (murni presentasional tanpa ketergantungan router/API)
  - [x] **MW-UI-003.1** Sediakan slot kolom, header count, kartu fokus-aman, dan tombol hapus facet yang aksesibel keyboard
  - [x] **MW-UI-003.2** Hormati `prefers-reduced-motion` dan token spacing/border `@moonwitness/ui`
  - [x] **MW-UI-003.3** Tambahkan unit test render & subpath package verification di `packages/ui/tests/`
  - [x] **MW-UI-003.4** Verifikasi: `pnpm test:ui && pnpm test:ui-budget` lulus

- [x] **MW-UI-004** Perluas `@moonwitness/ui/components/table` (`Table`) agar mendukung slot inline-edit, visibilitas kolom opsional, dan baris footer agregat (`tfoot`)
  - [x] **MW-UI-004.1** Tambahkan subkomponen `TableFooter` / `TableSummaryCell` dengan semantik `<table>` HTML native yang utuh
  - [x] **MW-UI-004.2** Jaga kompatibilitas penuh seluruh pemakai `Table` yang sudah ada di Board dan UI Catalog
  - [x] **MW-UI-004.3** Uji keyboard sorting dan scroll overflow container di unit test UI
  - [x] **MW-UI-004.4** Verifikasi: `pnpm test:ui` lulus

- [x] **MW-UI-005** Tambahkan spesimen & uji visual/Axe WCAG 2.1 AA untuk seluruh komponen UI baru di `apps/ui-catalog`
  - [x] **MW-UI-005.1** Tambahkan spesimen interaktif untuk `DatePicker`, `NumberInput`, `StatusBar`, `SmartButtonBox`, `KanbanBoard`, dan `FilterFacetBar`
  - [x] **MW-UI-005.2** Uji seluruh spesimen pada light/dark dan viewport desktop (1440px) & mobile (320px/390px) dengan Playwright + Axe
  - [x] **MW-UI-005.3** Pastikan bundle size katalog tetap lolos `pnpm test:ui-budget`
  - [x] **MW-UI-005.4** Verifikasi: `pnpm test:ui-catalog && pnpm test:ui-budget` lulus

- [x] **MW-UI-006** Pertahankan & perketat checker `scripts/check-board-shared-ui.mjs` mencakup seluruh direktori komponen baru di `apps/board/src/`
  - [x] **MW-UI-006.1** Pastikan 0 elemen HTML kontrol mentah (`<button>`, `<input>`, `<select>`, `<textarea>`, `<svg>`) maupun import `@moonwitness/ui/dist` di file view/widget baru
  - [x] **MW-UI-006.2** Tambahkan kasus uji baru bila ada pola import internal yang perlu diblokir
  - [x] **MW-UI-006.3** Jalankan checker manual dan pastikan pre-push hook tetap memblokir pelanggaran
  - [x] **MW-UI-006.4** Verifikasi: `pnpm board:ui:check` lulus

---

## 16 — Skin & Theme Engine

| ID            | Prioritas | Layer    | Dependensi                     | Lokasi Target                                                                |
| :------------ | :-------- | :------- | :----------------------------- | :--------------------------------------------------------------------------- |
| `MW-SKIN-001` | P3        | Shared   | `MW-PKG-002`                   | `packages/types/src/`, `packages/ui/src/styles/tokens.css`                   |
| `MW-SKIN-002` | P3        | Shared   | `MW-SKIN-001`                  | `packages/ui/src/styles/`                                                    |
| `MW-SKIN-003` | P3        | Frontend | `MW-SKIN-002`                  | `apps/board/src/hooks/use-theme.ts`, `apps/board/src/app/layout.tsx`         |
| `MW-SKIN-004` | P3        | Shared   | `MW-SKIN-003`, `MW-SCHEMA-002` | `packages/orm-base/src/models/user.ts`, `apps/api/src/routes/auth.routes.ts` |
| `MW-SKIN-005` | P3        | Shared   | `MW-SKIN-002`, `MW-UI-005`     | `apps/ui-catalog/src/catalog.tsx`, `apps/ui-catalog/tests/catalog.spec.ts`   |

- [x] **MW-SKIN-001** Definisikan kontrak `SkinMetadata`, `SkinDensity` (`'comfortable' | 'compact'`), `ColorMode` (`'light' | 'dark'`), dan `ThemeRegistry` di `@moonwitness/types` dan `@moonwitness/ui`
  - [x] **MW-SKIN-001.1** Buat registry metadata skin (`id`, `label`, `description`, `supportedModes`, `supportedDensities`, `swatchPreview`) di `packages/ui/src/lib/`
  - [x] **MW-SKIN-001.2** Ekspor `ThemeRegistry` melalui subpath eksplisit `@moonwitness/ui/themes`
  - [x] **MW-SKIN-001.3** Tambahkan unit test validasi registrasi skin & fallback default saat ID skin tidak dikenal
  - [x] **MW-SKIN-001.4** Verifikasi: `pnpm test:ui && pnpm --filter @moonwitness/types test` lulus

- [x] **MW-SKIN-002** Buat definisi token CSS berlapis di `@moonwitness/ui` untuk skin `moonwitness-ink` (bawaan zine/manga), `moonwitness-compact` (padat operasional), dan `moonwitness-high-contrast` (kontras tinggi aksesibilitas)
  - [x] **MW-SKIN-002.1** Implementasikan selector token berbasis `[data-skin="..."]` + `.dark` + `[data-density="compact"]` tanpa membebani runtime JS
  - [x] **MW-SKIN-002.2** Pastikan setiap skin menjaga identitas logo/aset MoonWitness serta keterbacaan tabel/form
  - [x] **MW-SKIN-002.3** Jalankan uji kontras WCAG AA otomatis pada seluruh pasangan foreground/background per skin di `packages/ui/tests/tokens.test.mjs`
  - [x] **MW-SKIN-002.4** Verifikasi: `pnpm test:ui` lulus

- [x] **MW-SKIN-003** Implementasikan `SkinProvider` runtime & script hidrasi pre-paint di `apps/board` (perluasan `use-theme.ts` dan `layout.tsx`) agar pergantian skin/mode/density berlangsung instan tanpa FOUC
  - [x] **MW-SKIN-003.1** Simpan state lokal di `localStorage` dan terapkan atribut `data-skin` + `data-density` + `.dark` pada `<html>` sebelum first paint
  - [x] **MW-SKIN-003.2** Tambahkan selector cepat Skin & Density pada menu profil/pengaturan Board
  - [x] **MW-SKIN-003.3** Pastikan ukuran JS tambahan di route awal tetap di bawah batas `pnpm board:budget`
  - [x] **MW-SKIN-003.4** Verifikasi: `pnpm --filter @moonwitness/board typecheck && pnpm board:budget` lulus

- [x] **MW-SKIN-004** Simpan preferensi `skin`, `theme_mode`, dan `density` pada `base.user` dan sinkronkan lewat `/auth/me` serta `/board/settings`
  - [x] **MW-SKIN-004.1** Tambahkan field `skin`, `theme_mode`, dan `density` ber-default aman pada `packages/orm-base/src/models/user.ts` (tersinkron otomatis via `MW-SCHEMA-002`)
  - [x] **MW-SKIN-004.2** Izinkan user memperbarui preferensi tampilan miliknya sendiri pada endpoint profil `/auth/me/preferences`
  - [x] **MW-SKIN-004.3** Uji persistensi preferensi lintas-sesi saat user login ulang di Playwright
  - [x] **MW-SKIN-004.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm test:integration` lulus

- [x] **MW-SKIN-005** Tambahkan switcher Skin & Density di `apps/ui-catalog` dan uji kompatibilitas komponen serta kontras pada seluruh kombinasi skin
  - [x] **MW-SKIN-005.1** Sediakan toolbar pratinjau skin & density pada UI Catalog
  - [x] **MW-SKIN-005.2** Jalankan Playwright + Axe di seluruh kombinasi `(skin × light/dark × compact/comfortable)`
  - [x] **MW-SKIN-005.3** Dokumentasikan token dan cara menambah skin baru di `packages/ui/TOKENS.md`
  - [x] **MW-SKIN-005.4** Verifikasi: `pnpm test:ui-catalog` lulus

---

## 17 — Shared Packages Consolidation

| ID           | Prioritas | Layer  | Dependensi                 | Lokasi Target                                                                                             |
| :----------- | :-------- | :----- | :------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `MW-PKG-001` | P1        | Shared | —                          | `packages/orm/src/`, `packages/orm-storage/src/`, `packages/local-ai/src/`, `packages/orm-knowledge/src/` |
| `MW-PKG-002` | P1        | Shared | `MW-PKG-001`               | `packages/client/package.json`, `packages/client/src/types.ts`, `packages/types/src/`                     |
| `MW-PKG-003` | P2        | Shared | `MW-PKG-001`               | `package.json`, `packages/*/package.json`, `apps/*/package.json`                                          |
| `MW-PKG-004` | P1        | Shared | —                          | `packages/orm-whatsapp/package.json`, `packages/orm-whatsapp/src/manifest.ts`                             |
| `MW-PKG-005` | P3        | Shared | `MW-API-001`, `MW-PKG-002` | `packages/types/src/guards.ts`, `apps/api/src/routes/`                                                    |
| `MW-PKG-006` | P2        | Shared | `MW-PKG-001`, `MW-PKG-002` | `packages/*/package.json`, `scripts/audit-workspace.mjs`                                                  |

- [x] **MW-PKG-001** Hilangkan seluruh 5 siklus import file-level type-only yang terdeteksi `node scripts/audit-workspace.mjs`
  - [x] **MW-PKG-001.1** Putus siklus `packages/orm/src/base.model.ts <-> environment.ts / model-definition.ts` dengan mengekstrak kontrak antarmuka bersama ke `orm/src/contracts.ts`
  - [x] **MW-PKG-001.2** Putus siklus `packages/orm-storage/src/index.ts <-> s3.ts` dengan mengekstrak `AttachmentStorage` interface ke `storage.types.ts`
  - [x] **MW-PKG-001.3** Putus siklus `packages/local-ai/src/index.ts <-> suggestion-generation.ts` dan `packages/orm-knowledge/src/research-release-validation.ts <-> research-release.ts`
  - [x] **MW-PKG-001.4** Verifikasi: `node scripts/audit-workspace.mjs` mencetak `"localImportCycles": []`, `"runtimeImportCycles": []`, `"workspaceDependencyCycles": []` dan `pnpm test:unit:built` lulus

- [x] **MW-PKG-002** Hubungkan `@moonwitness/client` ke `@moonwitness/types` dan hapus duplikasi tipe (`FieldMeta`, `ListView`, `FormView`, `SearchView`, `ResolvedViews`, `Domain`, `GroupCount*`, `SearchRead*`) di `packages/client/src/types.ts`
  - [x] **MW-PKG-002.1** Tambahkan `"@moonwitness/types": "workspace:*"` di `packages/client/package.json`
  - [x] **MW-PKG-002.2** Pindahkan tipe metadata/view/action/domain terpadu ke `@moonwitness/types` dan re-export ulang dari `@moonwitness/client` agar import konsumer di `apps/board` tidak rusak
  - [x] **MW-PKG-002.3** Pastikan tidak ada duplikasi interface antara `@moonwitness/orm`, `@moonwitness/types`, dan `@moonwitness/client`
  - [x] **MW-PKG-002.4** Verifikasi: `pnpm build && pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/client test && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-PKG-003** Audit dan bersihkan kandidat dependency tak terpakai pada manifest `package.json` (memilah adapter runtime/CLI sah seperti `pg`, `better-sqlite3`, `tailwindcss`, `oxlint` vs dependency berlebih)
  - [x] **MW-PKG-003.1** Evaluasi setiap item pada `unusedDependencyCandidates` di output `audit-workspace.mjs` (mis. `objection` pada `packages/orm-integration/package.json` bila tidak pernah dipakai)
  - [x] **MW-PKG-003.2** Hapus hanya dependency yang terbukti benar-benar yatim dan perbarui `pnpm-lock.yaml` jika berubah
  - [x] **MW-PKG-003.3** Dokumentasikan pengecualian adapter dinamis/CLI pada skrip audit agar sinyal audit berikutnya tetap bersih
  - [x] **MW-PKG-003.4** Verifikasi: `node scripts/audit-workspace.mjs && pnpm verify` lulus

- [x] **MW-PKG-004** Selaraskan versi `packages/orm-whatsapp/package.json` (`1.14.0` vs monorepo `1.0.0-rc.1`) dengan kebijakan versi workspace bersama tanpa mengubah versi skema addon runtime (`whatsappManifest.version: '1.14.0'`)
  - [x] **MW-PKG-004.1** Pisahkan jelas antara versi npm package monorepo (`package.json`) dengan versi schema addon DB (`defineAddon({ version })`)
  - [x] **MW-PKG-004.2** Sesuaikan `packages/orm-whatsapp/package.json` dan pastikan tes rilis & kebijakan versi lulus
  - [x] **MW-PKG-004.3** Pastikan `_orm_addons` di database tidak menganggap pembaruan `package.json` sebagai downgrade addon
  - [x] **MW-PKG-004.4** Verifikasi: `pnpm test:workspace-version-policy && pnpm release:check` lulus

- [x] **MW-PKG-005** Konsolidasikan helper murni yang terbukti identik semantik (`parseInteger`, `countValue`) ke `@moonwitness/types` tanpa membuat dumping-ground package utilitas
  - [x] **MW-PKG-005.1** Verifikasi kesamaan perilaku null/NaN/bigint antara helper di `generic.routes.ts`, `jobs.routes.ts`, dan `notification.routes.ts`
  - [x] **MW-PKG-005.2** Ekstrak hanya fungsi yang identik semantiknya ke `packages/types/src/guards.ts` beserta unit test langsung
  - [x] **MW-PKG-005.3** Ganti salinan lokal di `apps/api/src/routes/`
  - [x] **MW-PKG-005.4** Verifikasi: `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/api test` lulus

- [x] **MW-PKG-006** Tegakkan peta `exports` eksplisit dan larang bypass import subpath internal lintas seluruh 22 package workspace
  - [x] **MW-PKG-006.1** Pastikan setiap package hanya mengekspor entry `.` (atau subpath terdaftar eksplisit untuk `@moonwitness/ui` dan `@moonwitness/assets`)
  - [x] **MW-PKG-006.2** Perluas `audit:workspace` agar mendeteksi import lintas-package ke `src/` atau `dist/` internal
  - [x] **MW-PKG-006.3** Perbaiki setiap import yang melewati public export map
  - [x] **MW-PKG-006.4** Verifikasi: `pnpm audit:workspace && pnpm build` lulus

---

## 18 — Events, Jobs & Automation

| ID           | Prioritas | Layer   | Dependensi                    | Lokasi Target                                                                                     |
| :----------- | :-------- | :------ | :---------------------------- | :------------------------------------------------------------------------------------------------ |
| `MW-JOB-001` | P1        | Backend | —                             | `packages/jobs/src/runtime.ts`, `packages/jobs/tests/runtime.test.ts`                             |
| `MW-JOB-002` | P2        | Backend | `MW-ORM-011`, `MW-JOB-001`    | `packages/orm/src/base.model.ts`, `packages/jobs/src/runtime.ts`                                  |
| `MW-JOB-003` | P2        | Backend | `MW-JOB-001`, `MW-ACT-007`    | `apps/api/src/routes/jobs.routes.ts`, `apps/board/src/components/layout/cron-scheduler-panel.tsx` |
| `MW-JOB-004` | P2        | Backend | `MW-JOB-001`                  | `packages/orm-workflow/tests/`, `packages/orm-integration/tests/`                                 |
| `MW-JOB-005` | P2        | Core    | `MW-CORE-002`, `MW-ADDON-002` | `packages/orm/src/addon.ts`, `packages/jobs/src/runtime.ts`                                       |

- [x] **MW-JOB-001** Perbaiki bug head-of-line cron scheduler yang tercatat di `ROADMAP.md` `K7-005` (`packages/jobs/src/runtime.ts`) agar satu cron yang gagal tidak memblokir jadwal cron berikutnya
  - [x] **MW-JOB-001.1** Isolasi blok `try/catch` per item cron saat evaluasi tick scheduler dan majukan/backoff cron gagal secara independen
  - [x] **MW-JOB-001.2** Tambahkan uji regresi membuktikan 1 cron bermasalah tidak menghentikan penjadwalan cron sehat berikutnya
  - [x] **MW-JOB-001.3** Uji kembali seluruh kebijakan misfire & concurrency (`skip`, `coalesce`, `catch_up`, `forbid`, `replace`)
  - [x] **MW-JOB-001.4** Verifikasi: `pnpm --filter @moonwitness/jobs test && pnpm test:integration` lulus

- [x] **MW-JOB-002** Standarisasi publikasi event siklus hidup model (`record.created`, `record.updated`, `record.archived`, `record.deleted`, `record.action_*`) ke `base.outbox_event` dengan redaksi `sensitive`/`hidden` terpusat
  - [x] **MW-JOB-002.1** Pastikan event terbit seragam baik saat record diubah lewat REST, JSON-RPC, maupun `Recordset`/Action
  - [x] **MW-JOB-002.2** Pastikan `auditSnapshot` menyaring field `sensitive` dan `hidden` sebelum menulis ke payload outbox
  - [x] **MW-JOB-002.3** Uji integrasi end-to-end dengan `@moonwitness/orm-integration` webhook dan `@moonwitness/orm-notification`
  - [x] **MW-JOB-002.4** Verifikasi: `pnpm --filter @moonwitness/orm-integration test && pnpm --filter @moonwitness/orm-notification test && pnpm test:integration` lulus

- [x] **MW-JOB-003** Sediakan inspeksi dead-letter (`status = 'dead'`) dan kontrol retry/cancel teraudit bagi admin pada `base.job` dan `base.outbox_event`
  - [x] **MW-JOB-003.1** Tambah/verifikasi endpoint retry & cancel dead job/outbox di `jobs.routes.ts` khusus role `system`/`superadmin` dengan logging audit
  - [x] **MW-JOB-003.2** Tampilkan tabel dead-letter ringkas dan tombol retry di panel administrasi cron/jobs pada Board
  - [x] **MW-JOB-003.3** Pastikan user non-admin menerima `403` untuk seluruh endpoint admin jobs/outbox
  - [x] **MW-JOB-003.4** Verifikasi: `pnpm --filter @moonwitness/api test` + E2E admin jobs lulus

- [x] **MW-JOB-004** Tutup sisa verifikasi integrasi `orm-workflow` (`M9.03`) dan `orm-integration` (`M9.04`) pada skenario timeout expiry dan delivery retry
  - [x] **MW-JOB-004.1** Verifikasi eksekusi job `workflow.expire_due` melalui worker/scheduler penuh di PostgreSQL
  - [x] **MW-JOB-004.2** Verifikasi SSRF DNS guard, batas timeout total, dan idempotency delivery webhook di PostgreSQL
  - [x] **MW-JOB-004.3** Rekam hasil integrasi tanpa skenario skip pada database uji
  - [x] **MW-JOB-004.4** Verifikasi: `pnpm --filter @moonwitness/orm-workflow test && pnpm --filter @moonwitness/orm-integration test && pnpm test:integration` lulus

- [x] **MW-JOB-005** Dukung deklarasi `jobHandlers` dan `outboxConsumers` langsung pada manifest `Addon` agar worker mendaftarkannya otomatis saat boot
  - [x] **MW-JOB-005.1** Tambahkan properti `jobHandlers` dan `outboxConsumers` pada `Addon` di `packages/orm/src/addon.ts`
  - [x] **MW-JOB-005.2** Hubungkan proses `jobs-worker` dan `outbox-worker` agar meregistrasikan handler dari addon aktif melalui bootstrap tunggal (`MW-CORE-002`)
  - [x] **MW-JOB-005.3** Uji duplikasi nama handler dan deregistrasi bersih saat shutdown/uninstall addon
  - [x] **MW-JOB-005.4** Verifikasi: `pnpm --filter @moonwitness/jobs test && pnpm --filter @moonwitness/api test` lulus

---

## 19 — Configuration, Storage & Internationalization

| ID           | Prioritas | Layer          | Dependensi                  | Lokasi Target                                                                      |
| :----------- | :-------- | :------------- | :-------------------------- | :--------------------------------------------------------------------------------- |
| `MW-CFG-001` | P2        | Addon          | `MW-SEC-001`, `MW-CORE-003` | `packages/orm-base/src/`                                                           |
| `MW-CFG-002` | P3        | Frontend       | `MW-CFG-001`, `MW-ACT-003`  | `apps/board/src/board-pages/settings-page.tsx`                                     |
| `MW-CFG-003` | P1        | Backend        | `MW-API-004`                | `packages/orm-storage/src/s3.ts`, `apps/api/src/commands/attachments-reconcile.ts` |
| `MW-CFG-004` | P3        | Shared         | `MW-DOM-004`                | `packages/orm/src/view.ts`, `packages/types/src/`, `apps/board/src/`               |
| `MW-CFG-005` | P2        | Infrastructure | `MW-DOC-001`                | `docs/architecture/`, `scripts/verify-application-restore.mjs`                     |

- [x] **MW-CFG-001** Tambahkan model `base.config_parameter` di `@moonwitness/orm-base` untuk konfigurasi sistem dan per-company (`string | integer | boolean | json`, `is_secret`)
  - [x] **MW-CFG-001.1** Definisikan model `ConfigParameter` (`key`, `value_type`, `value`, `is_secret`, `company`) dengan `accessPolicy: 'adminOnly'`
  - [x] **MW-CFG-001.2** Sediakan helper `getConfigParam(env, key, fallback)` pada `ServiceRegistry` yang memprioritaskan env var rahasia lalu parameter DB
  - [x] **MW-CFG-001.3** Tandai field `value` bersyarat/sensitif agar parameter `is_secret` tidak muncul dalam audit log dan outbox
  - [x] **MW-CFG-001.4** Verifikasi: `pnpm --filter @moonwitness/orm-base test && pnpm --filter @moonwitness/api test` lulus

- [x] **MW-CFG-002** Sediakan halaman **General Settings** di `apps/board` bagi admin untuk mengelola parameter company (`base.config_parameter`) dan feature flags (`ir.feature_flag`)
  - [ ] **MW-CFG-002.1** Perluas `apps/board/src/board-pages/settings-page.tsx` untuk menampilkan bagian pengaturan user (semua user) dan bagian pengaturan sistem/company (admin saja)
  - [ ] **MW-CFG-002.2** Pastikan toggle feature flag & parameter non-secret memakai kontrol `@moonwitness/ui` dan validasi tipe
  - [ ] **MW-CFG-002.3** Uji penolakan akses (`403`) saat user biasa mencoba mengubah parameter global
  - [ ] **MW-CFG-002.4** Verifikasi: `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-CFG-003** Verifikasi alur upload presigned S3/RustFS & CORS (`todo-wa.md` `P2-05`) serta satukan rekonsiliasi orphan attachment (`pnpm attachments:reconcile`)
  - [ ] **MW-CFG-003.1** Uji integrasi S3 presigned POST, verifikasi ukuran/MIME `HEAD`, streaming copy ke key final, dan penolakan replay tiket
  - [ ] **MW-CFG-003.2** Pastikan `attachments:reconcile` memindai referensi dari `base.attachment` maupun `whatsapp.message` secara bersamaan agar tidak menghapus file aktif
  - [ ] **MW-CFG-003.3** Tutup 1 test acceptance S3 yang sebelumnya ter-skip pada lingkungan uji ber-storage S3/RustFS
  - [ ] **MW-CFG-003.4** Verifikasi: `pnpm --filter @moonwitness/orm-storage test && pnpm test:whatsapp` lulus

- [x] **MW-CFG-004** Bangun lapisan internasionalisasi (`i18n`) untuk terjemahan label model/view/menu/selection dan teks antarmuka `apps/board` berdasarkan `base.user.language` / `Accept-Language`
  - [x] **MW-CFG-004.1** Sediakan kamus terjemahan (`en-US`, `id-ID`) berbasis lookup table aman di `@moonwitness/orm` (untuk metadata model/view/menu) dan `apps/board` (untuk UI shell)
  - [x] **MW-CFG-004.2** Terapkan resolusi bahasa di `/api/:model/views` dan `/api/app/bootstrap` dengan fallback deterministik ke `en-US`
  - [x] **MW-CFG-004.3** Uji teks bahasa Indonesia yang panjang pada lebar viewport 320px tidak menyebabkan overlap atau overflow
  - [x] **MW-CFG-004.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/board typecheck` lulus

- [x] **MW-CFG-005** Verifikasi & dokumentasikan matriks klasifikasi kapabilitas platform (`Core` vs `Addon` vs `External` vs `Deferred`) beserta uji backup/restore aplikasi
  - [x] **MW-CFG-005.1** Pastikan seluruh tabel addon baru (termasuk `base.config_parameter`, `base.saved_filter`, dan kolom ekstensi) ikut tercakup dalam `restore-drill-fixture.ts`
  - [x] **MW-CFG-005.2** Jalankan `pnpm test:restore-drill` terhadap instance PostgreSQL dan verifikasi keutuhan relasi serta akun
  - [x] **MW-CFG-005.3** Dokumentasikan batasan kapabilitas eksternal dan opsional pada `docs/architecture/`
  - [x] **MW-CFG-005.4** Verifikasi: `pnpm test:restore-drill && pnpm docs:check` lulus

---

## 20 — Performance & Optimization

| ID            | Prioritas | Layer    | Dependensi                    | Lokasi Target                                                                        |
| :------------ | :-------- | :------- | :---------------------------- | :----------------------------------------------------------------------------------- |
| `MW-PERF-001` | P1        | Backend  | `MW-SEC-007`                  | `apps/api/src/plugins/auth.plugin.ts`                                                |
| `MW-PERF-002` | P2        | Backend  | `MW-ORM-010`                  | `apps/api/src/routes/generic.routes.ts`, `packages/orm/src/base.model.ts`            |
| `MW-PERF-003` | P2        | Frontend | `MW-WEB-001`, `MW-WIDGET-004` | `apps/board/src/components/views/list-view.tsx`, `apps/board/src/hooks/use-model.ts` |
| `MW-PERF-004` | P2        | QA       | `MW-DOM-002`, `MW-ORM-004`    | `apps/api/tests/postgres.performance.integration.test.ts`                            |
| `MW-PERF-005` | P2        | Frontend | `MW-WEB-005`, `MW-SKIN-003`   | `scripts/check-board-bundle.mjs`, `scripts/check-ui-catalog-budget.mjs`              |

- [x] **MW-PERF-001** Tambahkan cache in-memory ber-TTL pendek & sadar-invalidasi di `apps/api/src/plugins/auth.plugin.ts` untuk memangkas 3 query database per request HTTP
  - [x] **MW-PERF-001.1** Cache komposit `(userProfile, companyMemberships, groupPermissions)` di-key oleh `(userId, authRevisionEpoch)`
  - [x] **MW-PERF-001.2** Invalidasi instan setiap mutasi pada `base.user`, `base.company_membership`, `base.group_membership`, atau `base.model_access` (`MW-SEC-007`)
  - [x] **MW-PERF-001.3** Tambahkan benchmark jumlah query sebelum vs sesudah di `postgres.performance.integration.test.ts`
  - [x] **MW-PERF-001.4** Verifikasi: `pnpm --filter @moonwitness/api exec vitest run tests/auth.test.ts tests/postgres.performance.integration.test.ts` lulus

- [x] **MW-PERF-002** Ubah `findReference()` di `apps/api/src/routes/generic.routes.ts` & `BaseModel.unlink` agar melakukan batch lookup `WHERE col IN (...)` untuk operasi bulk
  - [x] **MW-PERF-002.1** Buat fungsi `findReferencesBatch(model, ids, activeUsersOnly, trx)` yang memetakan ID bermasalah ke model perujuk dalam 1 query per kolom FK
  - [x] **MW-PERF-002.2** Pastikan kasus 1 ID tetap secepat sebelumnya dan mutasi bulk 50–100 ID bebas masalah N+1
  - [x] **MW-PERF-002.3** Tambahkan assertion batas jumlah query saat bulk archive/delete di suite performa
  - [x] **MW-PERF-002.4** Verifikasi: `pnpm test:integration` lulus

- [x] **MW-PERF-003** Optimalkan fetching data `ListView`, `One2ManyWidget`, dan `Many2oneWidget` di `apps/board` (proyeksi `fields` kolom terlihat + debounce pencarian konsisten)
  - [ ] **MW-PERF-003.1** Kirim parameter `fields` berisi `['id', 'write_date', ...visibleListColumns]` pada query `ListView` menggantikan pembacaan seluruh kolom tabel
  - [ ] **MW-PERF-003.2** Terapkan debounce `250ms` seragam pada input pencarian list & `Many2oneWidget` typeahead
  - [ ] **MW-PERF-003.3** Uji payload network lebih ramping tanpa memutus tampilan cell atau optimistic concurrency
  - [ ] **MW-PERF-003.4** Verifikasi: `pnpm --filter @moonwitness/board typecheck && pnpm test:e2e` lulus

- [x] **MW-PERF-004** Perluas benchmark query PostgreSQL & kapasitas knowledge (`postgres.performance.integration.test.ts`, `benchmark-knowledge-capacity.mjs`) mencakup domain bertitik dan field terkomputasi
  - [ ] **MW-PERF-004.1** Ukur latensi p50/p95, jumlah query SQL, dan RSS memori untuk daftar 1.000+ record dengan domain relasional & eager loading
  - [ ] **MW-PERF-004.2** Pastikan index komposit otomatis ORM (`(company_id, active, id)` dan index FK) benar-benar digunakan pada query umum
  - [ ] **MW-PERF-004.3** Rekam metrik baseline di evidence tanpa merendahkan threshold regresi
  - [ ] **MW-PERF-004.4** Verifikasi: `pnpm test:integration` lulus

- [x] **MW-PERF-005** Pertahankan seluruh anggaran ukuran bundle Next.js per route (`pnpm board:budget`) dan katalog UI (`pnpm test:ui-budget`) setelah penambahan engine view dan skin
  - [x] **MW-PERF-005.1** Pastikan `CalendarView`, `GraphView`, dan `PivotView` di-import secara dinamis (`next/dynamic`) agar tidak masuk bundle awal `/`, `/login`, maupun `/board`
  - [x] **MW-PERF-005.2** Ukur kembali ukuran CSS & JS terkompresi di build produksi Next.js
  - [x] **MW-PERF-005.3** Pastikan SFX audio tetap dimuat on-demand saat interaksi user
  - [x] **MW-PERF-005.4** Verifikasi: `pnpm build && pnpm board:budget && pnpm test:ui-budget` lulus

---

## 21 — Security & Reliability Hardening

| ID            | Prioritas | Layer          | Dependensi                               | Lokasi Target                                                                                 |
| :------------ | :-------- | :------------- | :--------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `MW-HARD-001` | P0        | Security       | —                                        | `scripts/check-gitleaks-config.mjs`, `scripts/platform-audit.mjs`, `.github/workflows/ci.yml` |
| `MW-HARD-002` | P1        | Security       | —                                        | `Dockerfile`, `docs/security/vulnerability-policy.json`, `pnpm-workspace.yaml`                |
| `MW-HARD-003` | P0        | Security       | `MW-API-002`, `MW-API-003`, `MW-DOM-002` | `apps/api/src/routes/generic-query-graph.ts`, `apps/board/src/lib/csv-export.ts`              |
| `MW-HARD-004` | P1        | Infrastructure | `MW-SCHEMA-008`, `MW-ADDON-005`          | `scripts/verify-application-restore.mjs`, `packages/orm-knowledge/tests/`                     |
| `MW-HARD-005` | P1        | Security       | —                                        | `scripts/evolution/check-constitution.mjs`, `scripts/evolution/check-ratchet.mjs`             |

- [x] **MW-HARD-001** Rekonsiliasi referensi workflow pensiun (`gitleaks.yml`, `codeql.yml`, `browser-matrix.yml`, `deep-regression.yml`, `platform-audit.yml`) di skrip audit dan aktifkan gate secret scan di CI (`K9-002`)
  - [x] **MW-HARD-001.1** Perbarui `scripts/check-gitleaks-config.mjs` dan `scripts/platform-audit.mjs` agar selaras dengan 6 workflow aktif atau integrasikan job gitleaks ke `ci.yml`
  - [x] **MW-HARD-001.2** Pastikan `pnpm automation:check:secrets` memverifikasi aturan `.gitleaks.toml` tanpa bergantung pada file workflow yang telah dihapus
  - [x] **MW-HARD-001.3** Uji negative secret fixture memastikan deteksi entropy tinggi pada secret runtime tetap aktif
  - [x] **MW-HARD-001.4** Verifikasi: `pnpm automation:check:secrets && pnpm test:secrets && pnpm test:platform-audit` lulus

- [x] **MW-HARD-002** Triage & tangani 20 alert library Trivy pada image container (`M8.03`) dan pastikan build `Dockerfile` bebas kerentanan CRITICAL
  - [ ] **MW-HARD-002.1** Perbarui base image Node 22 LTS & toolchain pnpm/npm di `Dockerfile` dan cek `pnpm audit --prod --audit-level=high`
  - [ ] **MW-HARD-002.2** Catat disposisi/exception bertanggal kedaluwarsa di `docs/security/vulnerability-policy.json` untuk alert toolchain non-runtime yang belum memiliki fix upstream
  - [ ] **MW-HARD-002.3** Jalankan `pnpm test:security-policy` serta scan Trivy image API dan Board
  - [ ] **MW-HARD-002.4** Verifikasi: `pnpm test:security-policy && pnpm audit --prod --audit-level=high` lulus

- [x] **MW-HARD-003** Audit dan perketat batas amplifikasi payload, kedalaman join domain, dan sanitasi formula CSV di semua endpoint API/RPC baru
  - [x] **MW-HARD-003.1** Batasi ukuran JSON body, kedalaman AST domain (`<= 32`), jumlah term (`<= 100`), jumlah field select (`<= 100`), dan jumlah hop relasi (`<= 2`) seragam di REST & `/jsonrpc`
  - [x] **MW-HARD-003.2** Verifikasi `csv-export.ts` menetralkan sel awalan `=`, `+`, `-`, `@`, tab, dan newline untuk seluruh tipe widget baru
  - [x] **MW-HARD-003.3** Tambahkan uji fuzzing/adversarial payload pada `default-get`, `onchange`, `group-count`, dan `bulk`
  - [x] **MW-HARD-003.4** Verifikasi: `pnpm --filter @moonwitness/api exec vitest run tests/security-hardening.test.ts tests/api-orm-hardening.test.ts && pnpm test:board-csv` lulus

- [x] **MW-HARD-004** Verifikasi ulang `pnpm test:restore-drill` dan skenario interrupted-write (`K9-003`) di PostgreSQL pasca-pembaruan skema ORM & lifecycle addon
  - [ ] **MW-HARD-004.1** Perbarui fixture restore agar mencakup field ekstensi `extendModel`, tabel M2M, dan status `_orm_addons`
  - [ ] **MW-HARD-004.2** Buktikan proses dump/restore PostgreSQL menjaga konsistensi trigger append-only (`workflow_events`, `knowledge_*`) dan credential hash user
  - [ ] **MW-HARD-004.3** Rekam target waktu pemulihan dan integritas row count
  - [ ] **MW-HARD-004.4** Verifikasi: `pnpm test:restore-drill && pnpm --filter @moonwitness/orm-knowledge test` lulus

- [x] **MW-HARD-005** Pastikan seluruh invarian konstitusional (`check-constitution.mjs`) dan monotonic fitness ratchet (`check-ratchet.mjs`) selalu hijau sepanjang eksekusi transformasi
  - [x] **MW-HARD-005.1** Jaga file keamanan konstitusional dan nol allowlist `LEGACY_MODEL_ALLOWLIST` / `LEGACY_ADDON_ALLOWLIST`
  - [x] **MW-HARD-005.2** Jalankan `pnpm evolution:signals && pnpm evolution:fitness` setelah perubahan arsitektur besar
  - [x] **MW-HARD-005.3** Pastikan nol regresi metrik kualitas dan kebersihan boundary
  - [x] **MW-HARD-005.4** Verifikasi: `pnpm evolution:check && pnpm api:addon:check` lulus

---

## 22 — Testing & Quality Assurance

| ID          | Prioritas | Layer | Dependensi                                                  | Lokasi Target                                                        |
| :---------- | :-------- | :---- | :---------------------------------------------------------- | :------------------------------------------------------------------- |
| `MW-QA-001` | P1        | QA    | `MW-ORM-003`, `MW-ORM-004`, `MW-SCHEMA-003`, `MW-ADDON-004` | `packages/orm/tests/`, `apps/api/tests/postgres.integration.test.ts` |
| `MW-QA-002` | P1        | QA    | `MW-ADDON-007`, `MW-VIEW-002`, `MW-ACT-004`, `MW-SEC-001`   | `scripts/roadmap/addon-conformance.test.mjs`                         |
| `MW-QA-003` | P0        | QA    | `MW-SEC-005`                                                | `apps/api/tests/`                                                    |
| `MW-QA-004` | P2        | QA    | `MW-WEB-006`, `MW-SKIN-005`                                 | `apps/board/e2e/`                                                    |
| `MW-QA-005` | P1        | QA    | `MW-CORE-001`, `MW-SCHEMA-006`, `MW-JOB-001`                | `apps/api/tests/`, `packages/jobs/tests/`                            |
| `MW-QA-006` | P2        | QA    | `MW-QA-004`                                                 | `apps/board/e2e/`, `scripts/run-visual-matrix.mjs`                   |

- [x] **MW-QA-001** Bangun suite unit + SQLite + PostgreSQL untuk seluruh kapabilitas baru ORM & Schema Engine (`extendModel`, `compute/store`, `onchange`, `Recordset`, `manyToMany`, schema evolution, `uninstall`)
  - [x] **MW-QA-001.1** Tambahkan unit test deterministik di `packages/orm/tests/` untuk setiap fitur baru
  - [x] **MW-QA-001.2** Tambahkan integration test di `apps/api/tests/postgres.integration.test.ts` dengan `REQUIRE_POSTGRES_TESTS=true` (nol silent skip)
  - [x] **MW-QA-001.3** Verifikasi konsistensi hasil antara SQLite test suite dan PostgreSQL 16/17
  - [x] **MW-QA-001.4** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm test:integration` lulus

- [x] **MW-QA-002** Perluas `scripts/roadmap/addon-conformance.test.mjs` untuk memverifikasi view multi-mode, hierarki menu, action, ACL field, record rules, dan idempotensi siklus hidup lintas 11+ addon
  - [x] **MW-QA-002.1** Uji setiap addon dapat di-install, di-reinstall tanpa duplikasi seed, dan valid seluruh metadata view/action/menu-nya
  - [x] **MW-QA-002.2** Uji addon non-inti yang mendukung disable/uninstall dapat dinonaktifkan tanpa mematahkan dependensi atau skema dasar
  - [x] **MW-QA-002.3** Pastikan nol model yatim tanpa security policy eksplisit
  - [x] **MW-QA-002.4** Verifikasi: `pnpm test:addon-conformance` lulus

- [x] **MW-QA-003** Bangun matriks uji otorisasi otomatis penuh pada API mencakup seluruh 73+ model × 3 role (`system`, `superadmin`, `user`) × (`read`, `create`, `write`, `unlink`, `action`, `group-count`, `jsonrpc`)
  - [x] **MW-QA-003.1** Iterasi dinamis atas `Registry.getNames()` agar setiap model atau ekstensi baru otomatis diuji oleh suite keamanan
  - [x] **MW-QA-003.2** Uji kasus positif dengan group grant sah dan kasus negatif (`403`/`404`) lintas-tenant/tanpa grant/field terlarang
  - [x] **MW-QA-003.3** Pastikan tidak ada model internal (`auth.*`, `knowledge.*`, `base.job`, `base.cron`, `base.outbox_event`) yang bocor ke API generik
  - [x] **MW-QA-003.4** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm test:integration` lulus

- [x] **MW-QA-004** Tambahkan suite Playwright E2E untuk view engine dinamis (`List`, `Form`, `Kanban`, `Calendar`, `Graph`, `Pivot`, `Search`, `SmartButtons`, `Widgets`, dan `Skin`) terhadap API + PostgreSQL asli
  - [ ] **MW-QA-004.1** Uji create/edit/`onchange`/konflik `409`/saved filter/Kanban stage move/Smart Button navigation end-to-end di browser
  - [ ] **MW-QA-004.2** Uji perpindahan skin & density tersimpan lintas-reload dan terisolasi antar company
  - [ ] **MW-QA-004.3** Pastikan 0 console error, 0 hydration warning, dan lulus audit Axe WCAG 2.1 AA pada view baru
  - [ ] **MW-QA-004.4** Verifikasi: `pnpm test:e2e` lulus dengan PostgreSQL asli

- [x] **MW-QA-005** Tambahkan test unit khusus untuk `db-migrate.ts` (`--dry-run`, advisory lock), boot `SKIP_BOOT_MIGRATIONS=true`, dan isolasi kegagalan scheduler (`K7-005`)
  - [x] **MW-QA-005.1** Capai dan pertahankan seluruh ambang coverage branch kritis pada `docs/testing/coverage-thresholds.json`
  - [x] **MW-QA-005.2** Uji negative-path ketika advisory lock gagal atau schema diff mendeteksi kolom destruktif
  - [x] **MW-QA-005.3** Verifikasi runner unit test (`scripts/run-unit-tests.mjs`) dan kebijakan coverage lulus
  - [x] **MW-QA-005.4** Verifikasi: `pnpm test:coverage-policy && pnpm test:unit` lulus

- [x] **MW-QA-006** Jalankan matriks visual & lintas-browser (`Chromium`, `Firefox`, `WebKit`) (`M3.11`) setelah transformasi UI dan selesaikan setiap ketidaksesuaian layout/fokus
  - [ ] **MW-QA-006.1** Jalankan `pnpm test:e2e:visual:matrix` dan tinjau hasil diff di viewport 1440px, 1024px, dan 320px/390px
  - [ ] **MW-QA-006.2** Perbarui baseline snapshot terkurasi hanya setelah inspeksi visual langsung pada halaman yang sengaja diubah
  - [ ] **MW-QA-006.3** Dokumentasikan cakupan browser pada dokumentasi QA terkait
  - [ ] **MW-QA-006.4** Verifikasi: `pnpm test:e2e:visual:matrix` lulus

---

## 23 — Developer Experience & Tooling

| ID          | Prioritas | Layer          | Dependensi                     | Lokasi Target                                  |
| :---------- | :-------- | :------------- | :----------------------------- | :--------------------------------------------- |
| `MW-DX-001` | P2        | Infrastructure | —                              | `.nvmrc`, `package.json`, `Dockerfile`         |
| `MW-DX-002` | P3        | Infrastructure | `MW-ADDON-009`                 | `scripts/`, `package.json`                     |
| `MW-DX-003` | P3        | Infrastructure | `MW-SCHEMA-006`, `MW-VIEW-001` | `apps/api/src/commands/`, `package.json`       |
| `MW-DX-004` | P3        | Infrastructure | `MW-PKG-001`                   | `turbo.json`, `scripts/ci/build-workspace.mjs` |

- [x] **MW-DX-001** Seragamkan runtime Node `22.x` LTS antar lokal, CI, dan Docker (menutup temuan drift lokal `v24.22.1` vs `engines.node: "22.x"` di `todo-foundation.md`)
  - [x] **MW-DX-001.1** Tambahkan `.nvmrc` (`22`) dan `.node-version` yang selaras dengan `engines.node: "22.x"` serta workflow CI
  - [x] **MW-DX-001.2** Tambahkan peringatan/cek versi Node yang ramah di skrip dev lokal agar ketidaksesuaian native module `better-sqlite3` segera terlihat
  - [x] **MW-DX-001.3** Validasi seluruh build dan test berjalan bersih di bawah Node `22.x`
  - [x] **MW-DX-001.4** Verifikasi: `pnpm build && pnpm test:unit:built && pnpm test:package-manager` lulus

- [x] **MW-DX-002** Sediakan CLI developer terpadu (`pnpm addon:create`) untuk membuat package addon produksi siap-pakai dalam hitungan detik
  - [x] **MW-DX-002.1** Bungkus generator scaffold untuk menghasilkan `packages/orm-<nama>` lengkap dengan model, view, menu, action, rule akses, dan conformance test
  - [x] **MW-DX-002.2** Integrasikan otomatis atau tampilkan langkah tepat registrasi ke workspace build & docs reference
  - [x] **MW-DX-002.3** Tambahkan unit test CLI generator & validasi output
  - [x] **MW-DX-002.4** Verifikasi: `pnpm test:addon-conformance` lulus

- [x] **MW-DX-003** Sediakan CLI inspeksi runtime ORM & metadata (`pnpm orm:inspect`) yang menampilkan addon terpasang, model, field ekstensi, view tergabung, action, dan diff skema DB
  - [x] **MW-DX-003.1** Buat command `apps/api/src/commands/orm-inspect.ts` mendukung flag `--model`, `--addon`, dan `--json` tanpa menjalankan server HTTP
  - [x] **MW-DX-003.2** Daftarkan script `orm:inspect` di `package.json` root dan `apps/api/package.json`
  - [x] **MW-DX-003.3** Tambahkan test output JSON inspeksi untuk memastikan bebas secret/password
  - [x] **MW-DX-003.4** Verifikasi: `pnpm --filter @moonwitness/api test` lulus

- [x] **MW-DX-004** Optimalkan `turbo.json` dan `scripts/ci/build-workspace.mjs` agar incremental build & caching monorepo deterministik dan cepat
  - [x] **MW-DX-004.1** Audit `inputs` dan `outputs` task `build`, `typecheck`, dan `test` di `turbo.json` agar perubahan di `@moonwitness/types` memicu rebuild seluruh downstream tepat sasaran
  - [x] **MW-DX-004.2** Pastikan `pnpm verify` dan `pnpm build` tidak meninggalkan cache kotor atau `.d.ts` stale
  - [x] **MW-DX-004.3** Uji skrip diagnostik build (`test:e2e:diagnostics`)
  - [x] **MW-DX-004.4** Verifikasi: `pnpm build && pnpm typecheck && pnpm test:e2e:diagnostics` lulus

---

## 24 — Documentation

| ID           | Prioritas | Layer          | Dependensi                                  | Lokasi Target                                                                       |
| :----------- | :-------- | :------------- | :------------------------------------------ | :---------------------------------------------------------------------------------- |
| `MW-DOC-001` | P2        | Infrastructure | `MW-ADDON-001`, `MW-VIEW-001`, `MW-ACT-001` | `scripts/docs/generate-reference.mjs`, `scripts/architecture/generate-diagrams.mjs` |
| `MW-DOC-002` | P2        | Infrastructure | `MW-DOC-001`, `MW-SKIN-002`                 | `docs/addons/`, `docs/architecture/`, `packages/ui/README.md`                       |
| `MW-DOC-003` | P3        | Infrastructure | `MW-ORM-003`, `MW-VIEW-001`, `MW-ACT-001`   | `packages/orm/examples/`, `packages/orm/tests/addon.test.ts`                        |
| `MW-DOC-004` | P3        | Infrastructure | `MW-DOC-002`, `MW-CICD-002`                 | `.github/workflows/pages.yml`, `apps/docs/`                                         |

- [x] **MW-DOC-001** Perbarui generator referensi & diagram arsitektur (`pnpm docs:generate`, `pnpm architecture:generate`) agar mencakup field ekstensi, view baru, action, menu hierarkis, dan skin token
  - [x] **MW-DOC-001.1** Perbarui extractor model, route, env, dan diagram relasi untuk menyertakan `extendModel`, `Kanban`/`Calendar`/`Graph`/`Pivot`, dan endpoint baru
  - [x] **MW-DOC-001.2** Pastikan 2 kali eksekusi berturut-turut menghasilkan output byte-identik tanpa memuat `.env` rahasia atau DB produksi
  - [x] **MW-DOC-001.3** Sinkronkan `README.md` otomatis di antara marker generator (`readme:check`)
  - [x] **MW-DOC-001.4** Verifikasi: `pnpm docs:generate && pnpm docs:check && pnpm architecture:check` lulus

- [x] **MW-DOC-002** Perbarui panduan Addon Developer, ORM Schema Evolution, Model–View Engine, Security Model, serta UI/Skin Bible (`packages/ui/README.md`, `TOKENS.md`)
  - [x] **MW-DOC-002.1** Dokumentasikan secara jelas bahwa `apps/board` adalah frontend Next.js kanonis (peran `apps/web`) dan ORM mengelola evolusi skema tanpa file migrasi SQL
  - [x] **MW-DOC-002.2** Dokumentasikan cara membuat addon lengkap (`defineModel`, `extendModel`, `defineView`, `extendView`, `defineAction`, `recordRules`, dan `SkinMetadata`)
  - [x] **MW-DOC-002.3** Validasi seluruh tautan dan anchor Markdown di seluruh repository
  - [x] **MW-DOC-002.4** Verifikasi: `pnpm docs:links && pnpm docs:build` lulus

- [x] **MW-DOC-003** Perbarui dan uji contoh kode executable (`packages/orm/examples/`) untuk `extendModel`, `extendView`, `defineAction`, computed fields, dan `uninstallAddon`
  - [x] **MW-DOC-003.1** Tambahkan contoh modular kecil yang mengilustrasikan pewarisan model & view antar 2 addon
  - [x] **MW-DOC-003.2** Pastikan contoh lulus `tsc --noEmit` ketat dan terpasang idempoten dalam pengujian Vitest SQLite
  - [x] **MW-DOC-003.3** Pastikan 0 explicit `any` pada seluruh contoh dokumentasi
  - [x] **MW-DOC-003.4** Verifikasi: `pnpm docs:examples:check` lulus

- [x] **MW-DOC-004** Selesaikan validasi publikasi GitHub Pages berversi & pemindaian keamanan output docs (`M6.07`–`M6.11`, `M10.09`) saat promosi ke `main`
  - [ ] **MW-DOC-004.1** Jalankan `pnpm docs:publication:check` terhadap hasil build `apps/docs/dist` untuk mendeteksi kebocoran token/PII/env
  - [ ] **MW-DOC-004.2** Verifikasi navigasi portal docs (`/roadmap`, katalog UI, base path Pages, halaman 404)
  - [ ] **MW-DOC-004.3** Catat SHA sumber dan run URL deployment Pages di `main` setelah promosi
  - [ ] **MW-DOC-004.4** Verifikasi: `pnpm test:docs-portal && pnpm test:docs-publication && pnpm docs:publication:check` lulus

---

## 25 — CI/CD & Production Readiness

| ID            | Prioritas | Layer          | Dependensi                                    | Lokasi Target                                                         |
| :------------ | :-------- | :------------- | :-------------------------------------------- | :-------------------------------------------------------------------- |
| `MW-CICD-001` | P0        | Infrastructure | `MW-QA-001`, `MW-QA-003`, `MW-QA-004`         | `.github/workflows/ci.yml`, `package.json`                            |
| `MW-CICD-002` | P1        | Infrastructure | `MW-CICD-001`, `MW-HARD-001`                  | `.github/workflows/`, `ROADMAP.md`                                    |
| `MW-CICD-003` | P0        | Infrastructure | `MW-CORE-002`, `MW-SCHEMA-006`, `MW-HARD-002` | `Dockerfile`, `docker-compose.*.yml`                                  |
| `MW-CICD-004` | P2        | Infrastructure | `MW-CICD-002`, `MW-CICD-003`, `MW-PKG-004`    | `.github/workflows/release*.yml`, `scripts/release-*.mjs`             |
| `MW-CICD-005` | P1        | Infrastructure | `MW-CICD-001`, `MW-HARD-004`, `MW-JOB-004`    | `scripts/knowledge/run-k-gate.mjs`, `docs/roadmap/evidence/K9-007.md` |

- [ ] **MW-CICD-001** Jalankan dan hijaukan seluruh suite lokal & CI teknis penuh (`pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:ui-catalog`) setelah transformasi selesai
  - [ ] **MW-CICD-001.1** Pastikan seluruh job di `.github/workflows/ci.yml` (`quality-and-build`, `unit-tests`, `knowledge-gate`, `postgres-integration`) lulus pada exact SHA commit terakhir
  - [ ] **MW-CICD-001.2** Pastikan 0 test skip tersembunyi pada pengujian wajib PostgreSQL dan E2E kritis
  - [ ] **MW-CICD-001.3** Verifikasi seluruh pemeriksaan boundary (`api:addon:check`, `board:ui:check`, `audit:workspace`, `evolution:check`) lulus
  - [ ] **MW-CICD-001.4** Verifikasi: `pnpm verify && pnpm test:integration && pnpm test:e2e && pnpm test:ui-catalog` lulus

- [ ] **MW-CICD-002** Selesaikan alur promosi PR `dev -> main` (`M1.08`), `sync-main-to-dev`, dan `ci-gate` termasuk fresh `CODEOWNER` approval pada perubahan sensitif
  - [ ] **MW-CICD-002.1** Verifikasi aturan proteksi 2 branch (`main`/`dev`) tetap terjaga tanpa branch fitur atau force-push
  - [ ] **MW-CICD-002.2** Pastikan skrip promotion risk classifier dan workflow trust check lulus terhadap `.github/workflows/*`
  - [ ] **MW-CICD-002.3** Catat bukti commit SHA promosi & merge PR `dev -> main`
  - [ ] **MW-CICD-002.4** Verifikasi: `pnpm test:promotion-policy && pnpm test:expected-ref && pnpm test:ci-gate && pnpm test:workflow-trust` lulus

- [ ] **MW-CICD-003** Verifikasi build image Docker produksi (`api`, `board`), konfigurasi Compose, pre-deploy `db:migrate:built`, dan `/readyz` seluruh container API & worker
  - [ ] **MW-CICD-003.1** Uji boot kontainer produksi dengan menjalankan `db:migrate:built` terlebih dahulu lalu boot API & worker dengan `SKIP_BOOT_MIGRATIONS=true`
  - [ ] **MW-CICD-003.2** Verifikasi Nginx/Board same-origin proxy meneruskan `/api`, `/auth`, `/jsonrpc`, `/health`, dan `/readyz` dengan benar
  - [ ] **MW-CICD-003.3** Pastikan container smoke test dan healthcheck port `3011` (`jobs-worker`), `3012` (`jobs-scheduler`), `3013` (`outbox-worker`) sehat
  - [ ] **MW-CICD-003.4** Verifikasi: `pnpm test:e2e:diagnostics` + smoke container Compose lulus

- [ ] **MW-CICD-004** Selesaikan verifikasi release otomatis (`M7.05`–`M7.16`, `M10.06`–`M10.07`, `K9-006`): `release:check`, `release:dry-run`, SBOM, provenance GHCR, dan verifikasi atestasi
  - [ ] **MW-CICD-004.1** Jalankan `release:dry-run` dari clean worktree dan pastikan seluruh manifest versi package selaras (`MW-PKG-004`)
  - [ ] **MW-CICD-004.2** Verifikasi aset rilis, checksum, dan tag semver terlindungi pasca-promosi `main`
  - [ ] **MW-CICD-004.3** Rekam bukti run rilis hosted dan hasil `release:verify-attestations`
  - [ ] **MW-CICD-004.4** Verifikasi: `pnpm release:check && pnpm test:release-dry-run && pnpm test:release-workflow && pnpm test:release-verify-attestations` lulus

- [ ] **MW-CICD-005** Selesaikan evaluasi gate produksi knowledge (`K9-001`–`K9-007`) termasuk uji `K_GATE_REQUIRE_ALL_TESTS=1` di PostgreSQL dan sertifikasi offline egress-denial
  - [ ] **MW-CICD-005.1** Jalankan `scripts/knowledge/run-k-gate.mjs` terhadap PostgreSQL aktif dengan semua suite knowledge wajib lulus
  - [ ] **MW-CICD-005.2** Verifikasi nol koneksi outbound (`fetch`/`http`/`net`/`dns`) selama operasi offline `knowledge`, `corpus`, `research`, dan `local-ai`
  - [ ] **MW-CICD-005.3** Pastikan syarat go/no-go pada `docs/roadmap/evidence/K9-007.md` diperbarui sebelum mengaktifkan publikasi publik
  - [ ] **MW-CICD-005.4** Verifikasi: `node scripts/knowledge/run-k-gate.mjs --json` (dengan `K_GATE_REQUIRE_ALL_TESTS=1`) lulus

---

## 26 — End-to-End Platform Integration

> **Gerbang Penerimaan Lintas-Lapis Wajib:** Membuktikan seluruh siklus hidup addon berjalan utuh dari discovery package hingga UI browser dinamis di atas PostgreSQL sungguhan.

| ID           | Prioritas | Layer       | Dependensi                                                                    | Lokasi Target                                                                                 |
| :----------- | :-------- | :---------- | :---------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `MW-E2E-001` | P0        | Integration | `MW-ADDON-002`, `MW-CORE-002`                                                 | `apps/api/src/addons/registry.ts`, `packages/orm/src/addon.ts`                                |
| `MW-E2E-002` | P0        | Integration | `MW-ADDON-001`, `MW-E2E-001`                                                  | `packages/orm/src/addon.ts`                                                                   |
| `MW-E2E-003` | P0        | Integration | `MW-E2E-002`                                                                  | `packages/orm/src/addon.ts`                                                                   |
| `MW-E2E-004` | P0        | Integration | `MW-CORE-001`, `MW-ORM-003`, `MW-E2E-003`                                     | `packages/orm/src/registry.ts`, `packages/orm/src/model-definition.ts`                        |
| `MW-E2E-005` | P0        | Integration | `MW-SCHEMA-003`, `MW-SCHEMA-004`, `MW-E2E-004`                                | `packages/orm/src/addon.ts`, `apps/api/src/commands/db-migrate.ts`                            |
| `MW-E2E-006` | P0        | Integration | `MW-SEC-001`, `MW-SEC-002`, `MW-SEC-003`, `MW-E2E-005`                        | `apps/api/src/auth/`, `packages/orm-base/`                                                    |
| `MW-E2E-007` | P1        | Integration | `MW-VIEW-001`, `MW-VIEW-002`, `MW-E2E-004`                                    | `packages/orm/src/view.ts`                                                                    |
| `MW-E2E-008` | P1        | Integration | `MW-ACT-001`, `MW-ACT-002`, `MW-E2E-006`                                      | `packages/orm/src/`, `apps/api/src/routes/`                                                   |
| `MW-E2E-009` | P1        | Integration | `MW-ACT-004`, `MW-ACT-005`, `MW-E2E-008`                                      | `packages/orm/src/addon.ts`, `apps/api/src/routes/`                                           |
| `MW-E2E-010` | P1        | Integration | `MW-ACT-007`, `MW-VIEW-010`, `MW-E2E-009`                                     | `apps/board/src/components/layout/app-shell.tsx`, `apps/board/src/board-pages/model-page.tsx` |
| `MW-E2E-011` | P1        | Integration | `MW-WEB-006`, `MW-SKIN-003`, `MW-E2E-010`                                     | `apps/board/src/components/views/`                                                            |
| `MW-E2E-012` | P0        | Integration | `MW-WEB-004`, `MW-API-002`, `MW-E2E-011`                                      | `apps/board/e2e/`, `apps/api/tests/`                                                          |
| `MW-E2E-013` | P1        | Integration | `MW-DOM-006`, `MW-WIDGET-004`, `MW-WIDGET-005`, `MW-WIDGET-006`, `MW-E2E-012` | `apps/board/e2e/`, `apps/api/tests/postgres.integration.test.ts`                              |
| `MW-E2E-014` | P0        | Integration | `MW-SEC-005`, `MW-E2E-012`                                                    | `apps/board/e2e/`, `apps/api/tests/`                                                          |
| `MW-E2E-015` | P0        | Integration | `MW-SCHEMA-008`, `MW-E2E-005`                                                 | `apps/api/tests/postgres.integration.test.ts`, `packages/orm/tests/addon.test.ts`             |
| `MW-E2E-016` | P1        | Integration | `MW-ADDON-003`, `MW-ADDON-004`, `MW-E2E-015`                                  | `packages/orm/tests/addon.test.ts`, `apps/api/tests/`                                         |

- [x] **MW-E2E-001** **Penemuan Addon:** Addon workspace ditemukan otomatis oleh Core Runtime dari `packages/*` tanpa import manual model/route di `apps/api/src/app.ts`
  - [x] **MW-E2E-001.1** Addon terdeteksi otomatis dari metadata package workspace oleh resolver boot
  - [x] **MW-E2E-001.2** `pnpm api:addon:check` lulus nol pelanggaran boundary
  - [x] **MW-E2E-001.3** Verifikasi: `pnpm api:addon:check && pnpm test:addon-conformance`

- [x] **MW-E2E-002** **Validasi Manifest:** Manifest addon (`version`, `depends`, `models`, `extensions`, `views`, `actions`, `menus`, `security`, `data`) divalidasi fail-closed sebelum mutasi DB
  - [x] **MW-E2E-002.1** Manifest valid lolos registrasi sedangkan manifest dengan referensi model/field/dependensi rusak ditolak sebelum membuka transaksi
  - [x] **MW-E2E-002.2** Nol duplikasi nama addon, model, atau ID seed
  - [x] **MW-E2E-002.3** Verifikasi: `pnpm test:addon-conformance`

- [x] **MW-E2E-003** **Resolusi Dependensi:** Installer mengurutkan rantai dependensi addon (`request -> workflow -> notification -> jobs -> base`) dan relasi FK secara deterministik
  - [x] **MW-E2E-003.1** Input manifest dengan urutan terbalik maupun acak terinstal pada urutan topologis yang identik
  - [x] **MW-E2E-003.2** Tidak ada kegagalan missing foreign table selama penciptaan tabel berantai
  - [x] **MW-E2E-003.3** Verifikasi: `pnpm test:addon-conformance`

- [x] **MW-E2E-004** **Registrasi Model & Ekstensi ORM:** Model baru dan ekstensi `extendModel` terdaftar lengkap ke `Registry` baik saat boot normal maupun `SKIP_BOOT_MIGRATIONS=true`
  - [x] **MW-E2E-004.1** Field ekstensi, constraint, dan `jsonSchema` tergabung konsisten di proses API dan worker
  - [x] **MW-E2E-004.2** `Model.knex(db)` aktif pada setiap model saat `SKIP_BOOT_MIGRATIONS=true`
  - [x] **MW-E2E-004.3** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test`

- [x] **MW-E2E-005** **Sinkronisasi Skema ORM:** `pnpm db:migrate` / `installAddons` menyinkronkan tabel, kolom, tipe, enum `CHECK`, index, unique key, dan FK ke PostgreSQL tanpa skrip migrasi eksternal
  - [x] **MW-E2E-005.1** `pnpm db:migrate` membuat seluruh tabel/kolom baru dan `pnpm db:migrate -- --dry-run` pasca-migrasi melaporkan 0 diff tersisa
  - [x] **MW-E2E-005.2** Tidak ada penggunaan sistem migrasi SQL manual terpisah
  - [x] **MW-E2E-005.3** Verifikasi: `pnpm test:integration`

- [x] **MW-E2E-006** **Registrasi Izin Akses:** ACL model, ACL field, izin action, dan record rule milik addon terdaftar atomik ke engine keamanan dan `base.model_access`
  - [x] **MW-E2E-006.1** Kebijakan akses langsung aktif tanpa edit kode hardcode di `apps/api/src/auth/`
  - [x] **MW-E2E-006.2** Seed grant `base.model_access` tercipta idempoten dan menjaga perubahan manual administrator
  - [x] **MW-E2E-006.3** Verifikasi: `pnpm --filter @moonwitness/api test && pnpm test:integration`

- [x] **MW-E2E-007** **Registrasi & Pewarisan View:** View dasar dan ekstensi `extendView` tergabung, tervalidasi, dan tersedia dalam `ResolvedViews` (`list`, `form`, `search`, `kanban`, dll.)
  - [x] **MW-E2E-007.1** `/api/:model/views` mengembalikan kolom/tab/smartButton/kanban hasil penggabungan addon hulu + hilir
  - [x] **MW-E2E-007.2** Header `ETag` valid dan berubah saat generasi registry/role/bahasa berubah
  - [x] **MW-E2E-007.3** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test`

- [x] **MW-E2E-008** **Registrasi Action:** Window, Server, Client, dan Record action terdaftar di `ActionRegistry` dan dapat dieksekusi transaksional
  - [x] **MW-E2E-008.1** Eksekusi action melalui REST dan JSON-RPC berjalan transaksional, menghasilkan `base.audit_log`, dan mengembalikan `ActionResult`
  - [x] **MW-E2E-008.2** Action yang tidak diotorisasi ditolak (`403`)
  - [x] **MW-E2E-008.3** Verifikasi: `pnpm --filter @moonwitness/api test`

- [x] **MW-E2E-009** **Registrasi Menu:** Menu hierarkis addon tersaji pada `/api/app/bootstrap` tersaring sesuai izin, status aktif addon, dan `developmentOnly`
  - [x] **MW-E2E-009.1** Menu tampil terurut berdasarkan `parentId` dan `sequence`
  - [x] **MW-E2E-009.2** Menu tersembunyi bila user tidak punya izin baca model/action target
  - [x] **MW-E2E-009.3** Verifikasi: `pnpm --filter @moonwitness/api test`

- [x] **MW-E2E-010** **Pengiriman Metadata ke `apps/board`:** Frontend mengonsumsi `/api/app/bootstrap` dan `/api/:model/views` lewat `@moonwitness/client` tanpa menduplikasi definisi model
  - [x] **MW-E2E-010.1** Sidebar, command palette, dan route `/board/m/:model` dibangun dinamis dari payload API
  - [x] **MW-E2E-010.2** Tidak ada skema field atau relasi model yang di-hardcode di kode komponen generic Board
  - [x] **MW-E2E-010.3** Verifikasi: `pnpm test:e2e`

- [x] **MW-E2E-011** **Rendering Model Dinamis:** `apps/board` merender List, Form (StatusBar, Tabs, Smart Buttons), Kanban, dan Search view menggunakan `@moonwitness/ui` dan token skin aktif
  - [x] **MW-E2E-011.1** Nol console error, nol hydration mismatch, dan nol horizontal overflow pada viewport 320px dan 1440px
  - [x] **MW-E2E-011.2** Lulus audit Axe WCAG 2.1 AA pada light/dark dan skin aktif
  - [x] **MW-E2E-011.3** Verifikasi: `pnpm test:e2e`

- [x] **MW-E2E-012** **Siklus CRUD Lengkap:** User dapat Create (`default_get` + `onchange`), Read, Update (`If-Match` `write_date`), Archive, Unarchive, jalankan Action, dan Delete dari UI + REST + JSON-RPC
  - [x] **MW-E2E-012.1** Seluruh mutasi tersimpan di PostgreSQL dan menghasilkan baris `base.audit_log` + `base.outbox_event` nyata
  - [x] **MW-E2E-012.2** Tab `409 Conflict` muncul bersih bila record diubah secara konkuren oleh sesi lain
  - [x] **MW-E2E-012.3** Verifikasi: `pnpm test:e2e && pnpm test:integration`

- [x] **MW-E2E-013** **Pencarian & Field Relasional:** Search teks bebas, domain Polish notation, `base.saved_filter`, filter relasional bertitik, `Many2one` domain dinamis, `One2many` line, dan `Many2many` tag berfungsi utuh
  - [x] **MW-E2E-013.1** Mengubah parent field memperbarui pilihan `Many2one` anak via `onchange`/domain dinamis
  - [x] **MW-E2E-013.2** Saved filter tersimpan dan terisolasi per user/company lintas reload
  - [x] **MW-E2E-013.3** Verifikasi: `pnpm test:e2e && pnpm test:integration`

- [x] **MW-E2E-014** **Penegakan Aturan Akses:** Model ACL, record rule, isolasi `X-Company-Id`, field ACL, dan action permission ditegakkan konsisten di UI, REST, JSON-RPC, dan Attachment
  - [x] **MW-E2E-014.1** Field terbatas tidak terkirim dan ditolak saat dikirim paksa; record company lain ditolak (`403`/`404`)
  - [x] **MW-E2E-014.2** Tombol aksi terlarang tersembunyi di UI dan panggilan langsung API ditolak `403`
  - [x] **MW-E2E-014.3** Verifikasi: `pnpm test:e2e && pnpm test:integration`

- [x] **MW-E2E-015** **Upgrade Addon & Pelestarian Data:** Upgrade versi addon (penambahan kolom, pelebaran enum, update view/menu, serta `upgrade` hook) memperbarui skema PostgreSQL sambil menjaga 100% data user dan edit seed
  - [x] **MW-E2E-015.1** Record produksi/uji lama tetap utuh dan menerima nilai enum baru setelah upgrade
  - [x] **MW-E2E-015.2** Kegagalan di tengah upgrade menggulung balik seluruh transaksi skema dan data
  - [x] **MW-E2E-015.3** Verifikasi: `pnpm test:integration`

- [x] **MW-E2E-016** **Disable & Uninstall Addon Aman:** Menonaktifkan/meng-uninstall addon menolak uninstall bila masih punya dependen aktif (`409`), membersihkan runtime metadata addon leaf secara aman, dan stabil saat restart/reinstall
  - [x] **MW-E2E-016.1** Menu, view, action, dan rute addon leaf yang dinonaktifkan/di-uninstall hilang bersih dari runtime tanpa merusak addon inti
  - [x] **MW-E2E-016.2** Reinstall kembali memulihkan registrasi runtime tanpa duplikasi record `_orm_data` atau tabel rusak
  - [x] **MW-E2E-016.3** Verifikasi: `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test && pnpm test:integration`

---

## 27 — Final Audit & Cleanup

| ID             | Prioritas | Layer          | Dependensi                                                 | Lokasi Target                            |
| :------------- | :-------- | :------------- | :--------------------------------------------------------- | :--------------------------------------- |
| `MW-AUDIT-001` | P1        | Shared         | `MW-BACK-002`, `MW-PKG-002`, `MW-WIDGET-007`, `MW-ACT-007` | Seluruh repository                       |
| `MW-AUDIT-002` | P1        | QA             | `MW-AUDIT-001`                                             | `apps/*`, `packages/*`                   |
| `MW-AUDIT-003` | P2        | Infrastructure | `MW-DOC-001`, `MW-AUDIT-001`                               | `docs/`, `README.md`, `packages/assets/` |
| `MW-AUDIT-004` | P2        | Infrastructure | `MW-E2E-016`, `MW-AUDIT-003`                               | `todo.md`, `ROADMAP.md`, `todo-*.md`     |

- [ ] **MW-AUDIT-001** Pastikan seluruh shim legacy (`apps/api/src/whatsapp/manifest.ts`), kontrak duplikat (`packages/client/src/types.ts`, evaluator `domain.ts`), dan switch-case model hardcoded bersih dari repository
  - [ ] **MW-AUDIT-001.1** Periksa output `pnpm audit:workspace` memiliki nol runtime cycles, nol local file cycles, dan nol workspace cycles
  - [ ] **MW-AUDIT-001.2** Pastikan `pnpm api:addon:check` dan `pnpm board:ui:check` lulus bersih
  - [ ] **MW-AUDIT-001.3** Pastikan nol file sementara/scratch tertinggal di direktori kode sumber
  - [ ] **MW-AUDIT-001.4** Verifikasi: `pnpm audit:workspace && pnpm api:addon:check && pnpm board:ui:check` lulus

- [ ] **MW-AUDIT-002** Audit seluruh source TypeScript/JavaScript dari explicit `any`, komentar `// TODO`, fungsi placeholder, dan data mock pada jalur produksi
  - [ ] **MW-AUDIT-002.1** Jalankan pemeriksaan `pnpm lint`, `pnpm format:check`, dan `pnpm typecheck` di seluruh workspace
  - [ ] **MW-AUDIT-002.2** Pastikan nol explicit `any` atau pengecualian lint baru yang tidak berdasar
  - [ ] **MW-AUDIT-002.3** Pastikan fixture uji terisolasi di direktori test/katalog berlabel jelas
  - [ ] **MW-AUDIT-002.4** Verifikasi: `pnpm lint && pnpm format:check && pnpm typecheck` lulus

- [ ] **MW-AUDIT-003** Regenerasi dan validasi seluruh dokumen referensi turunan, diagram arsitektur, serta manifest aset (`pnpm docs:generate`, `pnpm architecture:generate`, `pnpm assets:validate`)
  - [ ] **MW-AUDIT-003.1** Pastikan referensi API, model, relasi, dan env var cocok 100% dengan source code terkini
  - [ ] **MW-AUDIT-003.2** Pastikan 114+ SVG aset lolos sanitasi dan check bounds
  - [ ] **MW-AUDIT-003.3** Pastikan `pnpm docs:check` dan `pnpm architecture:check` tidak melaporkan file stale
  - [ ] **MW-AUDIT-003.4** Verifikasi: `pnpm docs:check && pnpm architecture:check && pnpm test:assets` lulus

- [ ] **MW-AUDIT-004** Rekonsiliasi status checkbox dan bukti eksekusi di `todo.md`, `ROADMAP.md`, `todo-foundation.md`, `todo-ui.md`, dan `todo-wa.md`
  - [ ] **MW-AUDIT-004.1** Perbarui status item yang benar-benar telah terverifikasi pada checklist terkait tanpa membuat backlog tandingan
  - [ ] **MW-AUDIT-004.2** Pastikan ringkasan hitungan `[x]` / `[ ]` pada Seksi 00 `todo.md` dan `ROADMAP.md` akurat
  - [ ] **MW-AUDIT-004.3** Jalankan validator roadmap resmi
  - [ ] **MW-AUDIT-004.4** Verifikasi: `pnpm automation:check:roadmap && pnpm verify` lulus

---

## 28 — Definition of Done

Suatu task di checklist ini **hanya boleh dicentang `[x]`** apabila seluruh syarat checkable di bawah terpenuhi dan diverifikasi:

- [ ] **MW-DOD-001** Implementasi kode atau konfigurasi selesai nyata pada file target tanpa `// TODO`, fungsi stub, explicit `any`, atau logika duplikat
- [ ] **MW-DOD-002** Pemeriksaan boundary & konstitusi lulus bersih (`pnpm api:addon:check`, `pnpm board:ui:check`, `pnpm audit:workspace`, `pnpm evolution:check`)
- [ ] **MW-DOD-003** Pemeriksaan kualitas statis lintas monorepo lulus pasca-edit terakhir (`pnpm lint`, `pnpm format:check`, `pnpm typecheck`)
- [ ] **MW-DOD-004** Seluruh pengujian relevan pada ruang lingkup berubah dijalankan pasca-edit terakhir dan lulus tanpa skip terselubung (`pnpm test:unit`, `pnpm test:addon-conformance`, `pnpm test:ui`, `pnpm test:integration`, `pnpm test:e2e`)
- [ ] **MW-DOD-005** Referensi docs, diagram arsitektur, dan budget bundle (`pnpm docs:check`, `pnpm architecture:check`, `pnpm board:budget`) hijau saat ada perubahan model, rute, atau UI

---

## 29 — Remaining Technical Debt & Deferred Features

### A. Ketergantungan Perangkat Keras, Layanan Eksternal & Hosting (Tertunda di Luar Kode Offline)

1. **Pairing Perangkat Nyata GoWA WhatsApp (`todo-wa.md`):** Item `P0-01`–`P0-05`, `P0-08`, `P0-24`–`P0-25`, `P1-06`, `P1-28`, dan `P2-01` menunggu pemindaian QR langsung oleh pengguna ke instance GoWA aktif (`wa.moonwitness.biz.id` `v9.6.0`), verifikasi persistensi sesi setelah restart container, backup volume kredensial GoWA, serta pengamatan receipt/media live.
2. **Benchmark Model Local AI Nyata (`ROADMAP.md` `K7-006`):** Runtime outage & disabled-mode sudah lulus di API; sertifikasi latensi, memori, akurasi komparatif, dan egress-denial tingkat OS menunggu ketersediaan endpoint model lokal (Ollama/OpenAI-compat) pada mesin target.
3. **Gate Governance & Rilis Hosted GitHub (`ROADMAP.md` `M1.08`, `M6.07`–`M6.11`, `M7.05`–`M7.16`, `M10.07`, `M11.03`–`M11.15`, `K9-007`):** Membutuhkan approval `CODEOWNER` untuk PR promosi `dev -> main`, eksekusi tag rilis GitHub/GHCR perdana, publikasi GitHub Pages terpercaya dari `main`, dan sign-off kebijakan safeguarding.

### B. Kapabilitas Opsional / Enterprise yang Sengaja Ditunda (Non-Goal Saat Ini)

1. **Visual Drag-and-Drop Schema/Form/Workflow Builder di UI:** Model dan workflow tetap dideklarasikan code-first dalam TypeScript terketik ketat di package addon (`defineModel`, `defineView`, `WorkflowDefinition`) demi keandalan CI dan type safety.
2. **Dialek Database di Luar PostgreSQL & SQLite Test Harness:** Target produksi tunggal adalah PostgreSQL 16/17; SQLite (`better-sqlite3`) hanya untuk unit/conformance/audit lokal cepat.
3. **Fitur WhatsApp Lanjutan v2+ (`todo-wa.md` NEXT):** Album multi-lampiran, voice note, CRM bot/broadcast (`P4-01`–`P4-13`), live presence (`P4-15`), dan publikasi Status/Story (`P3-03`–`P3-16`) ditunda sampai v1 live pairing diterima.
4. **Provisioning & Auto-Deploy Cloud Staging/Produksi (`ADR-0001`, `ADR-0004`):** Scope rilis terbatas pada image GHCR, GitHub Release, Docker Compose self-hosted, dan docs GitHub Pages.
