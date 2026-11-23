# Design Specs & RFC Registry (`docs/specs/`)

Direktori ini mencatat spesifikasi teknis tingkat fitur (_micro design specifications_) dan dokumen RFC sebelum implementasi kode.

## Format Berkas

`docs/specs/YYYY-MM-DD-<fitur>-design.md`

## Hubungan dengan TaskOS

Setiap design spec memuat blok pemetaan task:

```html
<!-- tasks: AUD-001, AUD-002 -->
```

Engine `apps/todo` (`moonwitness-dx`) secara otomatis memetakan progres penyelesaian task ke spesifikasi terkait.
