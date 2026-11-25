# Blueprint registry (`docs/meta/blueprints-registry.md`)

Direktori `docs/blueprints/` sudah dihapus. Cetak biru (_macro blueprints_) kini hidup di
`docs/bundles/` sebagai source bundle yang dipertahankan utuh, sedangkan cetak biru aktif yang
masih dipakai sebagai panduan implementasi ada di `docs/superpowers/plans/`.

## Blueprint aktif

| Topik                           | Lokasi                                                                                                                                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI Corporation (EGAO, ADR 0007) | [Grand plan](../bundles/ai-corporation-blueprint/docs/AI-CORPORATION-GRAND-PLAN.md) · [Desktop harness](../bundles/ai-corporation-blueprint/docs/AI-CORPORATION-DESKTOP-HARNESS.md) · [Ledger PR/AI](../bundles/ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md) |
| TaskOS v2 & Second Brain        | [Centralization plan](../superpowers/plans/2026-11-22-taskos-second-brain-centralization.md) · [Implementation plan](../superpowers/plans/2026-11-22-todo-taskos-v2-implementation.md)                                                                                        |
| Local AI rebuild (2026-10-15)   | [Master plan](../bundles/local-ai-rebuild-plan/MOONWITNESS_XI_MASTER_PLAN.md) · [Backlog](../bundles/local-ai-rebuild-plan/MOONWITNESS_XI_BACKLOG.md)                                                                                                                         |
| Visual Universe                 | [README first](../bundles/visual-universe-pack/README-FIRST.md) · [Source index](../bundles/visual-universe-pack/SOURCE_INDEX.md)                                                                                                                                             |

## Siklus hidup blueprint

`Draft` → `In Review` → `Accepted` → `Implementing` → `Shipped` → `Superseded`.
Setiap bagian blueprint mengikat task code konkret di [TaskOS registry](../tasks/tasks.json).
Status resmi tetap berada di [ROADMAP](../../ROADMAP.md); blueprint bukan registry lifecycle kedua.
