# Agent tooling locations

Instruksi agen tersebar di beberapa lokasi karena tiap tool punya konvensi discovery sendiri.
Jangan menggabungkan atau memindahkan folder ini tanpa memeriksa konvensi tool terkait.
Skill yang dipakai lintas tool harus memiliki satu implementasi kanonis; lokasi discovery lain hanya boleh menjadi bridge.

| Lokasi                              | Tool / pemilik                          | Isi                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.agents/rules/`, `.agents/skills/` | Skill tool-agnostic                     | [Invariant yang dipelajari](../../.agents/rules/learned-invariants.md), skill `frontier-research-scout`, `hybrid-swarm-dag`, dan `visual-swarm` kanonis beserta script/assets.                                                                                                                                                                                                                             |
| `plugins/moonwitness/`              | Plugin MoonWitness yang didistribusikan | Rule boundary, skill `mw-addon-dev`, `mw-boundaries`, `mw-taskos`, dan `plugin.json`.                                                                                                                                                                                                                                                                                                                      |
| `.qoder/skills/visual-swarm/`       | Qoder discovery bridge                  | `SKILL.md` saja; mengarahkan Qoder ke skill kanonis di `.agents/skills/visual-swarm/` tanpa menduplikasi script atau assets.                                                                                                                                                                                                                                                                               |
| `tools/agent-observatory/`          | Internal R&D Lab (workstation only)     | Lab R&D internal read-only loopback (`127.0.0.1:4190`) untuk **observatory, discovery, monitoring, dan eksperimen** (Antigravity, OpenCode, Magpie, Claude, Codex, Qoder, Gemini CLI, auto-discovery apps/packages/ADR/skill/compose); **khusus R&D internal**, bukan aplikasi produk ([ADR 0018](../decisions/0018-internal-rd-agent-observatory.md), [README](../../tools/agent-observatory/README.md)). |
| `vendor/opencode/.opencode/`        | Snapshot upstream OpenCode              | Agent, command, skill, dan glossary pihak ketiga — jangan diedit.                                                                                                                                                                                                                                                                                                                                          |

## Otoritas visual-swarm

- `.agents/skills/visual-swarm/` adalah satu-satunya sumber instruksi dan implementasi `visual-swarm`.
- `.qoder/skills/visual-swarm/SKILL.md` hanya bridge kompatibilitas discovery; perubahan skill dilakukan di lokasi kanonis.
- Dashboard adalah snapshot/viewer koordinasi read-only, bukan otoritas orkestrasi, queue, jobs, monitoring, atau observability.
- Di MoonWitness, API, ORM, jobs, dan Board tetap berwenang. Skill tidak boleh membuat server produk/orkestrasi kedua, database, queue, atau product UI; viewer loopback opsional hanya membaca manifest lokal.

## Aturan umum

- Perubahan invariant arsitektur baru ditulis di `.agents/rules/learned-invariants.md`, lalu
  dicerminkan ke rule plugin jika berlaku untuk konsumen eksternal.
- `docs/` tetap satu-satunya tempat dokumentasi proyek; skill menjelaskan _cara kerja_, bukan
  menyimpan salinan dokumen.
- Snapshot `vendor/` bersifat pinjaman — perbaikan harus di upstream, bukan di sini.
