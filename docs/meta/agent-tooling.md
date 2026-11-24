# Agent tooling locations

Instruksi agen tersebar di beberapa lokasi karena tiap tool punya konvensi discovery sendiri.
Jangan menggabungkan atau memindahkan folder ini tanpa memeriksa konvensi tool terkait.

| Lokasi                              | Tool / pemilik                          | Isi                                                                                                                             |
| ----------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `.agents/rules/`, `.agents/skills/` | Agent lokal (OpenCode/custom)           | [Invariant yang dipelajari](../../.agents/rules/learned-invariants.md), skill `frontier-research-scout` dan `hybrid-swarm-dag`. |
| `plugins/moonwitness/`              | Plugin MoonWitness yang didistribusikan | Rule boundary, skill `mw-addon-dev`, `mw-boundaries`, `mw-taskos`, dan `plugin.json`.                                           |
| `.qoder/skills/visual-swarm/`       | Qoder IDE                               | Skill visual swarm + dashboard (file ini belum di-track di git).                                                                |
| `vendor/opencode/.opencode/`        | Snapshot upstream OpenCode              | Agent, command, skill, dan glossary pihak ketiga — jangan diedit.                                                               |

## Aturan umum

- Perubahan invariant arsitektur baru ditulis di `.agents/rules/learned-invariants.md`, lalu
  dicerminkan ke rule plugin jika berlaku untuk konsumen eksternal.
- `docs/` tetap satu-satunya tempat dokumentasi proyek; skill menjelaskan _cara kerja_, bukan
  menyimpan salinan dokumen.
- Snapshot `vendor/` bersifat pinjaman — perbaikan harus di upstream, bukan di sini.
