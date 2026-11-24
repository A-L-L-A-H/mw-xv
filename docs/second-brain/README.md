# Second Brain (`docs/second-brain/`)

Tiga lapisan pengetahuan dulu berdiri sebagai folder tersendiri di `docs/`. Sekarang semuanya
berada di bawah satu direktori agar alurnya jelas:

| Lapisan | Lokasi | Fungsi |
| --- | --- | --- |
| Raw | [raw/](raw/README.md) | *Quick capture*: ide mentah, cuplikan, transkrip. Penamaan `YYYY-MM-DD-<slug>.md`. |
| Brain | [brain/](brain/README.md) | Laboratorium sintesis: hubungkan ide, tugas, dan dokumentasi (`[[Task:...]]`, `[[Wiki:...]]`). |
| Wiki | [wiki/README.md](wiki/README.md) | *Evergreen single source of truth*: standar, runbook, kamar domain. |

## Alur

`raw/` → (triage) → `brain/` → (kristalisasi) → ADR di [`../decisions/`](../decisions/README.md)
atau design spec di [`../meta/specs-registry.md`](../meta/specs-registry.md) → task di
[`../tasks/tasks.json`](../tasks/tasks.json) → *evergreen* di `wiki/`.

Jangan mengedit registry hasil generator (`tasks.json`, `roadmap/tasks.json`) secara langsung.
Lihat [indeks dokumentasi](../README.md) untuk peta seluruh `docs/`.
