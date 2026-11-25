# Issue Backlog Digest — 2026-11-24

**Snapshot:** live `gh issue list --state all` at 2026-11-24 · **Repository:** `A-L-L-A-H/mw-xv`

> Navigational digest only. Not a task registry, not canon, not an approval list. The canonical issue and PR inventory is [ISSUE-INDEX.md](ISSUE-INDEX.md); canonical task lifecycle is TaskOS.

## Why this exists

The repository receives machine-generated audit findings faster than a human can triage them. In the last snapshot alone, 30 new issues arrived in ~24 hours. This digest separates **engineering noise** from **work that actually needs a person**, so creative/archive work is not buried.

## Category counts

| Category                          |   Count | Meaning                                                 | Action                                                |
| --------------------------------- | ------: | ------------------------------------------------------- | ----------------------------------------------------- |
| Archive & knowledge (owner-gated) |      25 | Original proposals #15–#22, #27, archive wave #173–#188 | Needs owner / source / rights decision                |
| Managed TaskOS projections        |     136 | `M*`, `AUD-*`, `CF-*`, `MW-*`, `UI-*` stable IDs        | Follow TaskOS + Issue Sync Contract; do not hand-edit |
| Automated code-audit findings     |      28 | `audit` / `auto-generated` labels, hourly bot           | Engineering backlog; batch by package                 |
| Other / unclassified              |       4 | Misc proposals and incident records                     | Triage individually                                   |
| **Total**                         | **191** |                                                         |                                                       |

## Issues that actually need a human

| Issue                                                 | State  | Why it needs a person                           |
| ----------------------------------------------------- | ------ | ----------------------------------------------- |
| [#15](https://github.com/A-L-L-A-H/mw-xv/issues/15)   | open   | Expansion scope / architecture authority        |
| [#16](https://github.com/A-L-L-A-H/mw-xv/issues/16)   | open   | Product vision and Radio direction              |
| [#17](https://github.com/A-L-L-A-H/mw-xv/issues/17)   | open   | Editorial workflow approval                     |
| [#18](https://github.com/A-L-L-A-H/mw-xv/issues/18)   | open   | Asmaul Husna edition and 99-name review         |
| [#19](https://github.com/A-L-L-A-H/mw-xv/issues/19)   | open   | Artwork pipeline approval                       |
| [#20](https://github.com/A-L-L-A-H/mw-xv/issues/20)   | open   | Research method acceptance                      |
| [#21](https://github.com/A-L-L-A-H/mw-xv/issues/21)   | open   | Desktop harness decision                        |
| [#22](https://github.com/A-L-L-A-H/mw-xv/issues/22)   | open   | AEQ / BABYDOLL status decision                  |
| [#27](https://github.com/A-L-L-A-H/mw-xv/issues/27)   | open   | Repository preservation program and K0-006 gate |
| [#74](https://github.com/A-L-L-A-H/mw-xv/issues/74)   | open   | CF-020 canonical identity (open copy)           |
| [#75](https://github.com/A-L-L-A-H/mw-xv/issues/75)   | closed | CF-020 canonical identity (closed copy)         |
| [#173](https://github.com/A-L-L-A-H/mw-xv/issues/173) | open   | CRAYON version reconciliation                   |
| [#174](https://github.com/A-L-L-A-H/mw-xv/issues/174) | open   | Universal Iman edition conflict                 |
| [#175](https://github.com/A-L-L-A-H/mw-xv/issues/175) | open   | Quantum–Fe novelty / safety boundary            |
| [#176](https://github.com/A-L-L-A-H/mw-xv/issues/176) | open   | Game-lineage separation                         |
| [#177](https://github.com/A-L-L-A-H/mw-xv/issues/177) | open   | Mīzān first-source recovery                     |
| [#178](https://github.com/A-L-L-A-H/mw-xv/issues/178) | open   | Story lead source recovery                      |
| [#179](https://github.com/A-L-L-A-H/mw-xv/issues/179) | open   | Story lead source recovery                      |
| [#180](https://github.com/A-L-L-A-H/mw-xv/issues/180) | open   | Story lead source recovery                      |
| [#181](https://github.com/A-L-L-A-H/mw-xv/issues/181) | open   | THUNDERSTRUCK / MENGGIGIL identity              |
| [#182](https://github.com/A-L-L-A-H/mw-xv/issues/182) | open   | 22-file Library pack provenance                 |
| [#183](https://github.com/A-L-L-A-H/mw-xv/issues/183) | open   | Parent: archive completion gate                 |
| [#185](https://github.com/A-L-L-A-H/mw-xv/issues/185) | open   | PNG rights review                               |
| [#186](https://github.com/A-L-L-A-H/mw-xv/issues/186) | open   | Maintainer decision                             |
| [#187](https://github.com/A-L-L-A-H/mw-xv/issues/187) | open   | Private export intake / consent                 |
| [#188](https://github.com/A-L-L-A-H/mw-xv/issues/188) | open   | Library census conflict                         |
| [#197](https://github.com/A-L-L-A-H/mw-xv/issues/197) | open   | Antigravity hook bridge proposal                |

## Repeated legacy strata (do not re-create)

20 legacy `MW-UI-*` / `MW-RSR-*` / `MW-ART-*` stable IDs each appear on four closed issue copies from repeated planning waves. They are preserved as history. **Do not open a fifth copy.** Use [ISSUE-INDEX.md](ISSUE-INDEX.md) §Repeated legacy stable IDs.

## Regeneration

This is a point-in-time snapshot. Re-run `gh issue list -R A-L-L-A-H/mw-xv --state all --limit 500` and regenerate before any lifecycle decision. Automated audit issues are execution backlog, not archive proposals.
