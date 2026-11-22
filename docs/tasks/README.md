# MoonWitness TaskOS — Centralized Work Registry (`docs/tasks/`)

Direktori ini adalah pusat kebenaran tunggal (*canonical single source of truth*) untuk seluruh pekerjaan, backlog, dan tata kelola tugas MoonWitness.

## Berkas Inti
- `docs/tasks/tasks.schema.json`: Kontrak JSON Schema Draft-07 standar untuk `moonwitness-tasks/v2`.
- `docs/tasks/tasks.json`: Basis data master kanonik seluruh tugas proyek (mencakup 1.346+ tasks dari seri M, K, WA, AUD, EVO, DSK, MW).

## Perintah Penting
```bash
# Validasi skema, DAG, dan integritas tugas tanpa drift
pnpm tasks:validate

# Sinkronisasi status dua arah dengan ROADMAP.md
pnpm tasks:sync
```
