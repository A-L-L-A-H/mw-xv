# Design Specs & RFC Registry

Registry ini mencatat spesifikasi teknis tingkat fitur (*micro design specifications*) dan dokumen RFC sebelum implementasi kode. Berkasnya kini disimpan di `docs/superpowers/specs/`; daftar spec arsip juga dirujuk dari [indeks dokumentasi](../README.md).

## Format Berkas
`docs/superpowers/specs/YYYY-MM-DD-<fitur>-design.md`

## Hubungan dengan TaskOS
Setiap design spec memuat blok pemetaan task:
```html
<!-- tasks: AUD-001, AUD-002 -->
```
Blok ini adalah penanda dokumentasi, bukan mekanisme otomatis: tidak ada script yang membacanya. Otoritas lifecycle tetap [TaskOS registry](../tasks/tasks.json), `ROADMAP.md` dan [Issue Sync Contract](../roadmap/ISSUE-SYNC-CONTRACT.md). `pnpm tasks:validate` memvalidasi `docs/tasks/tasks.json`, bukan marker pada spec.
