# MoonWitness Central Task Directory

> **PENGUMUMAN PENTING — SUMBER KEBENARAN TUNGGAL:**
> Seluruh pelacakan pekerjaan, TODO, backlog, dan tata kelola tugas proyek MoonWitness telah **disentralisasi secara kanonik** ke:
> 
> **`docs/tasks/tasks.json`** (TaskOS v2 Standard Contract)
> 
> Seluruh arsip histori TODO lama tersimpan aman di:
> - `docs/archive/todos/todo.md` (arsip 850+ riwayat checklist)
> - `docs/archive/todos/todo-wa.md` (arsip checklist WhatsApp)
> - `docs/archive/todos/todo-desktop.md` (arsip checklist Desktop)
> - `docs/archive/todos/todo-ui.md` (arsip 100% selesai checklist UI)
> - `docs/archive/todos/todo-foundation.md` (arsip 100% selesai checklist fondasi)

---

## 1. Akses & Antarmuka TaskOS

1. **Web UI & Local Kanban Server (`apps/todo` / `moonwitness-dx`):**
   ```bash
   # Jalankan papan Kanban dan Second Brain lokal
   pnpm --filter moonwitness-dx dev
   ```

2. **Perintah Validasi & Sinkronisasi:**
   ```bash
   # Validasi kepatuhan skema dan pohon dependensi bebas siklus
   pnpm tasks:validate

   # Sinkronisasi status dua arah dengan ROADMAP.md
   pnpm tasks:sync
   ```

3. **Master Roadmap Verifikasi Rilis:**
   - [ROADMAP.md](ROADMAP.md) tetap menjadi gerbang resmi penerimaan rilis master 227 kartu M-series dan K-series.

---

## 2. Status Pekerjaan Terbuka Prioritas Tinggi (Snapshot Terkonsolidasi)

Semua item di bawah ini dikelola secara dinamis di `docs/tasks/tasks.json`:

- `AUD-001` [P0]: Wire `@moonwitness/ai-runtime` to production job handlers in `ai-corporation.routes.ts`.
- `AUD-002` [P0]: Integrate all AI and Desktop packages to CI gate, unit runner, and docs generator.
- `AUD-003` [P0]: Resolve AGPL-3.0-only license anomaly and workspace boundary in `apps/todo`.
- `AUD-004` [P0]: Harden multi-tier rate limiting and fix `PostgresRateLimitStore` `timeWindow` bug.
- `AUD-008` [P1]: Activate Turborepo build caching in workspace and CI pipeline.
- `AUD-009` [P1]: Fix logger synchronous file I/O and implement deep recursive secret redaction.
- `AUD-005` [P1]: Implement automated PostgreSQL `FORCE ROW LEVEL SECURITY` for zero-trust multi-tenancy.
- `AUD-006` [P1]: Harden multi-replica auth with `token_version` and PG `NOTIFY` cache invalidation.
- `AUD-007` [P1]: Migrate `@moonwitness/ai-mcp` to official `@modelcontextprotocol/sdk` with PROV-AGENT lineage.
- `AUD-010` [P2]: Optimize PostgreSQL query engine (native `ILIKE` and `pg_trgm`) and post-transaction `CONCURRENTLY` index sync.
- `AUD-012` [P2]: Realtime eventing layer with PostgreSQL `LISTEN/NOTIFY` and Fastify SSE.
- `AUD-013` [P2]: Behavior-led decomposition of 4 core god-files (`generic.routes.ts`, `list-view.tsx`, `base.model.ts`, `addon.ts`).
- `AUD-014` [P3]: End-to-end metadata reflection via `orm:codegen` v2.
