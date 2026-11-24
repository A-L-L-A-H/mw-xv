# Roadmap evidence (`docs/roadmap/evidence/`)

Folder ini berisi bukti eksekusi kartu roadmap. Per November 2026 ada ~237 file markdown di sini,
didominasi kartu `M*` (milestone) dan `K*` (knowledge workstream). File dipertahankan di satu
tempat karena path-nya dipin oleh `docs/tasks/tasks.json`, ADR, dan `ROADMAP.md` — memindahkannya
akan merusak rujukan lifecycle yang sudah tervalidasi.

## Konvensi penamaan

- `M<nomor>.md` → bukti kartu milestone, mis. [M12.14](M12.14.md).
- `K<kode>-<slug>.md` → bukti kartu knowledge, mis. [K4-003](K4-003.md).
- `issue-audit-*.md`, `M13-desktop-flow-walkthrough.md` → laporan lintas kartu.
- `screenshots/` → bukti visual; `*.json` → data pendukung.

## Cara menemukan bukti

1. Mulai dari [ACTIVE-PLAN](../ACTIVE-PLAN.md) atau [ROADMAP](../../../ROADMAP.md) untuk ID kartu.
2. Buka source card di `docs/roadmap/<nomor>-<topik>.md` untuk daftar bukti yang diharapkan.
3. Cek `evidence.paths` pada entitas terkait di [TaskOS registry](../../tasks/tasks.json) — itu
   adalah rujukan kanonik path bukti.
4. Gunakan [`TEMPLATE.md`](TEMPLATE.md) hanya untuk kartu baru; jangan menulis status lifecycle di
   sini (status ada di TaskOS dan `ROADMAP.md`).

Untuk laporan evaluasi mentah, lihat [docs/research/](../../research/). Untuk bukti operasional,
lihat [docs/operations/evidence/](../../operations/evidence/).
