# Documentation index (`docs/`)

Seluruh dokumentasi proyek berada di bawah satu pohon `docs/`. Halaman ini adalah pintu masuk
untuk menemukan dokumen berdasarkan jenisnya. Bundle dan file markdown yang dulu tersebar di root
sudah dipusatkan ke sini; tautan internalnya sudah diperbarui.

## Peta direktori

| Area                                                            | Isi                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Panduan pengguna](guide/index.md)                              | Quickstart, tutorial, how-to, reference, explanation.                                  |
| [Arsitektur](architecture/README.md)                            | Batas komponen, ADR arsitektur, diagram, audit domain.                                 |
| [Keputusan (ADR)](decisions/README.md)                          | ADR yang diterima, termasuk ADR 0004 dan 0007.                                         |
| [Roadmap](roadmap/ACTIVE-PLAN.md)                               | Rencana M0–M12, kartu source, dan bukti eksekusi.                                      |
| [Bukti roadmap](roadmap/evidence/README.md)                     | Indeks ~237 bukti kartu M/K yang dirujuk TaskOS.                                       |
| [TaskOS](tasks/README.md)                                       | Registry tugas kanonik (`tasks.json`), sumber checklist, dan proyeksi.                 |
| [Rekayasa](engineering/baseline.md)                             | Baseline, inventory, feature matrix, dan runbook perawatan.                            |
| [Operasional](operations/github-bootstrap.md)                   | GitHub, WhatsApp, storage, evaluasi AI lokal, insiden.                                 |
| [Desain](design/visual-direction.md)                            | Arah visual, brand, token, aset, dan katalog UI.                                       |
| [Pengetahuan](knowledge/IDEA-ARCHIVE-INDEX.md)                  | Arsip ide, narasi, dan kebijakan sumber.                                               |
| [Second Brain](second-brain/README.md)                          | Alur `raw/` → `brain/` → `wiki/` untuk ide dan pengetahuan.                            |
| [Laporan evaluasi](research/)                                   | Reproducibility, semantics benchmark, dan protokol evaluasi model.                     |
| [Tata kelola](governance/knowledge-privacy-and-safeguarding.md) | Privasi, perlindungan anak, dan gate publikasi.                                        |
| [Blueprint](meta/blueprints-registry.md)                        | Cetak biru inisiatif besar yang aktif.                                                 |
| [Meta & tooling](meta/)                                         | Registry, laporan audit, draf issue, dan [lokasi tooling agen](meta/agent-tooling.md). |

## Source & planning bundles (centralized)

Bundle dokumentasi yang dulu berdiri sendiri di root kini berada di `docs/bundles/`.
Struktur internalnya dipertahankan apa adanya agar tautan relatif di dalamnya tetap valid.

| Bundle                             | Lokasi                                                                                    | Catatan                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AI Corporation blueprint           | [docs/bundles/ai-corporation-blueprint/](bundles/ai-corporation-blueprint/README.md)      | Grand plan, research register, ADR draft, dan ledger PR/AI.                                                                      |
| Local AI rebuild plan (2026-10-15) | [docs/bundles/local-ai-rebuild-plan/](bundles/local-ai-rebuild-plan/README_START_HERE.md) | Rencana induk, backlog, dan execution runbook; terkait ADR 0004.                                                                 |
| Visual Universe autonomous pack    | [docs/bundles/visual-universe-pack/](bundles/visual-universe-pack/README-FIRST.md)        | Spesifikasi, task cards, evidence, dan proyeksi TaskOS. Arsip `legacy/` bersifat immutable dan diverifikasi dengan Git blob SHA. |

> **Catatan integritas:** jangan mengubah file di dalam `docs/bundles/visual-universe-pack/legacy/`
> secara manual. Manifest dan chunk-nya memakai Git blob SHA untuk verifikasi byte-for-byte;
> `pnpm tasks:sweep` dan `node docs/bundles/visual-universe-pack/tools/sync-task-state.mjs --check`
> akan gagal jika isinya berubah.

## Sumber checklist TaskOS

Lima checklist awal dulu berada di root; sekarang berada di [docs/tasks/sources/](tasks/sources/)
dan dibaca langsung oleh `scripts/tasks/validate-tasks.mjs` serta
`scripts/tasks/sweep-and-consolidate.mjs`:

- [todo.md](tasks/sources/todo.md) — work entry point TaskOS.
- [todo-desktop.md](tasks/sources/todo-desktop.md) — desktop engineering `DSK-0`–`DSK-10`.
- [todo-foundation.md](tasks/sources/todo-foundation.md) — fondasi keamanan & infrastruktur.
- [todo-ui.md](tasks/sources/todo-ui.md) — UI `WUI-*`.
- [todo-wa.md](tasks/sources/todo-wa.md) — WhatsApp `WA-*`.

Salinan historisnya ada di [docs/archive/todos/](archive/todos/).

## Dokumen lepas yang terpusat

| Dokumen                            | Lokasi                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| Implementation plan for docs tasks | [docs/meta/IMPLEMENTATION_PLAN_DOCS_TASKS.md](meta/IMPLEMENTATION_PLAN_DOCS_TASKS.md)               |
| UI audit report                    | [docs/meta/UI_AUDIT_REPORT.md](meta/UI_AUDIT_REPORT.md)                                             |
| Registri blueprint & spec          | [blueprints-registry.md](meta/blueprints-registry.md) · [specs-registry.md](meta/specs-registry.md) |
| Strategi & visi produk             | [meta/strategy/](meta/strategy/)                                                                    |
| Protokol agen lokal                | [docs/operations/local-agent-protocol.md](operations/local-agent-protocol.md)                       |
| Draf issue GitHub                  | [docs/meta/github-issues/](meta/github-issues/)                                                     |

## Dokumen tambahan yang sebelumnya belum terindeks

- Desain: [components](design/components.md) · [illustrations](design/illustrations.md) · [visual direction](design/visual-direction.md) · [Moon City artwork review and current approval](design/moon-city-artwork-review.md) · [production approval](decisions/moon-city-production-approval.md).
- Rekayasa & pengujian: [performance baseline](engineering/performance-baseline.md) · [WhatsApp verification](testing/whatsapp-verification.md) · [Internal R&D Agent Observatory](decisions/0018-internal-rd-agent-observatory.md) (consolidated into `apps/desktop`).
- Operasional: [WhatsApp/Whatsmeow migration](operations/whatsapp-whatsmeow-migration-plan.md).
- Roadmap: [control-plane execution report](roadmap/control-plane-execution-report.md) · [M13 walkthrough](roadmap/evidence/M13-desktop-flow-walkthrough.md).
- Pengetahuan: [GitHub issue index](knowledge/idea-archive/GITHUB-ISSUE-INDEX.md).
- Addon: [developer guide](addons/developer-guide.md).
- Rencana & spec arsip: [TaskOS v2 implementation](superpowers/plans/2026-11-22-todo-taskos-v2-implementation.md) · [ISP cloud hardening](superpowers/specs/2026-11-22-isp-cloud-hardening-design.md).
- Visual Universe: [dependency graph](bundles/visual-universe-pack/DEPENDENCY_GRAPH.md) · [source index](bundles/visual-universe-pack/SOURCE_INDEX.md) · [handoff template](bundles/visual-universe-pack/HANDOFF_TEMPLATE.md) · [start prompt](bundles/visual-universe-pack/START_PROMPT.md) · [task summary](bundles/visual-universe-pack/TASK_SUMMARY.md).

## Yang tetap di root

Hanya file konvensi GitHub/tooling yang tersisa di root: `README.md`, `CHANGELOG.md`,
`ROADMAP.md`, `SECURITY.md`, `LICENSE`, `package.json`, config build, dan
`deploy/compose/docker-compose*.yml` (semua compose file terpusat di `deploy/compose/`).

## Pemeriksaan

```bash
pnpm docs:links                 # tautan & anchor markdown
pnpm tasks:validate             # registry TaskOS
pnpm tasks:sweep -- --check     # deterministik terhadap sumber checklist
node docs/bundles/visual-universe-pack/tools/sync-task-state.mjs --check
```
