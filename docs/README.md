# Documentation index (`docs/`)

Seluruh dokumentasi proyek berada di bawah satu pohon `docs/`. Halaman ini adalah pintu masuk
untuk menemukan dokumen berdasarkan jenisnya. Dokumen yang previously tersebar di root repositori
telah dipindahkan ke sini; tautan lama di dalam repo sudah diperbarui.

## Peta direktori

| Area | Isi |
| --- | --- |
| [Panduan pengguna](guide/index.md) | Quickstart, tutorial, how-to, reference, explanation. |
| [Arsitektur](architecture/README.md) | Batas komponen, ADR arsitektur, diagram, audit domain. |
| [Keputusan (ADR)](decisions/README.md) | ADR yang diterima, termasuk ADR 0004 dan 0007 yang merujuk ke planning bundle. |
| [Roadmap](roadmap/ACTIVE-PLAN.md) | Rencana M0–M12, kartu source, dan bukti eksekusi. |
| [TaskOS](tasks/README.md) | Registry tugas kanonik (`tasks.json`), aturan siklus hidup, dan proyeksi. |
| [Rekayasa](engineering/baseline.md) | Baseline, inventory, feature matrix, dan runbook perawatan. |
| [Operasional](operations/github-bootstrap.md) | GitHub, WhatsApp, storage, evaluasi AI lokal, insiden. |
| [Desain](design/visual-direction.md) | Arah visual, brand, token, aset, dan katalog UI. |
| [Pengetahuan](knowledge/IDEA-ARCHIVE-INDEX.md) | Arsip ide, narasi, dan kebijakan sumber. |
| [Laporan evaluasi](research/) | Reproducibility, semantics benchmark, dan protokol evaluasi model. |
| [Tata kelola](governance/knowledge-privacy-and-safeguarding.md) | Privasi, perlindungan anak, dan gate publikasi. |
| [Blueprint](blueprints/README.md) | Cetak biru inisiatif besar yang aktif. |

## Source & planning bundles (centralized)

Bundle dokumentasi yang dulu berdiri sendiri di root kini berada di `docs/bundles/`.
Struktur internalnya dipertahankan apa adanya agar tautan relatif di dalamnya tetap valid.

| Bundle | Lokasi | Catatan |
| --- | --- | --- |
| AI Corporation blueprint | [docs/bundles/ai-corporation-blueprint/](bundles/ai-corporation-blueprint/README.md) | Grand plan, research register, ADR draft, dan ledger PR/AI. |
| Local AI rebuild plan (2026-10-15) | [docs/bundles/local-ai-rebuild-plan/](bundles/local-ai-rebuild-plan/README_START_HERE.md) | Rencana induk, backlog, dan execution runbook; terkait ADR 0004. |
| Visual Universe autonomous pack | [docs/bundles/visual-universe-pack/](bundles/visual-universe-pack/README-FIRST.md) | Spesifikasi, task cards, evidence, dan proyeksi TaskOS. Arsip `legacy/` bersifat immutable dan diverifikasi dengan Git blob SHA. |

> **Catatan integritas:** jangan mengubah file di dalam `docs/bundles/visual-universe-pack/legacy/`
> secara manual. Manifest dan chunk-nya memakai Git blob SHA untuk verifikasi byte-for-byte;
> `pnpm tasks:sweep` dan `node docs/bundles/visual-universe-pack/tools/sync-task-state.mjs --check`
> akan gagal jika isinya berubah.

## Dokumen lepas yang terpusat

| Dokumen | Lokasi baru |
| --- | --- |
| Implementation plan for docs tasks | [docs/planning/IMPLEMENTATION_PLAN_DOCS_TASKS.md](planning/IMPLEMENTATION_PLAN_DOCS_TASKS.md) |
| UI audit report | [docs/reports/UI_AUDIT_REPORT.md](reports/UI_AUDIT_REPORT.md) |
| GitHub issue drafts & helper | [docs/meta/github-issues/](meta/github-issues/) |

## File yang sengaja tetap di root

Beberapa file markdown tetap berakar di repositori karena merupakan konvensi GitHub atau input
langsung dari tooling, bukan dokumen arsip:

- `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `SECURITY.md`, `LICENSE`.
- `todo.md`, `todo-desktop.md`, `todo-foundation.md`, `todo-ui.md`, `todo-wa.md` — sumber
  pembacaan `scripts/tasks/validate-tasks.mjs` dan `scripts/tasks/sweep-and-consolidate.mjs`.
  Salinan historisnya ada di [docs/archive/todos/](archive/todos/).

## Pemeriksaan

```bash
pnpm docs:links                 # tautan & anchor markdown
pnpm tasks:validate             # registry TaskOS
node docs/bundles/visual-universe-pack/tools/sync-task-state.mjs --check
```
