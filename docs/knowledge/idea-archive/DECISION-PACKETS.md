# Decision Packets & Version-Strata Crosswalk

**Snapshot:** 2026-11-24 · **Status:** `ADDITIVE / NO DECISION MADE`  
**Source of truth for conflicts:** [UNRESOLVED-DECISIONS.md](UNRESOLVED-DECISIONS.md) · **Canon authority:** [CANON-REGISTRY.md](CANON-REGISTRY.md)

> This file packages existing unresolved records into an answerable form. It does **not** resolve, promote, rename or retire anything. Every item below remains `UNRESOLVED` until one of the four closure rules in §3 is met. No AI-generated summary is closure evidence.

## 1. Version-strata crosswalk

These are not typos to fix. They are **strata** from different source generations. Each row preserves every competing value and names the decision required. No row is merged.

| Stratum | Competing values observed | Where evidenced | Current status | Decision required | Related |
|---|---|---|---|---|---|
| CRAYON framework | v1.3 (9 Gate SEE…CHOOSE; 13 Way OBSERVE…LIVE) vs companion v2 (different Gate 6–9 wording, REVIEW added to 13-Way) | `FRAMEWORK-REGISTRY.md` §FRM-0015 | `UNR-0037` / `REVIEW` | Treat as separate application profile or issue a versioned revision | #173 |
| Dīn Allah / Universal Iman | filename v1.8 · internal cover v1.7 · research-paper footer v1.2 | `FRAMEWORK-REGISTRY.md` §FRM-0016 | `UNR-0038` / `REVIEW` | Establish one edition history record; do not rename source | #174 |
| MoonWitness OS v2.0 | `4 SOURCE → 7 CHANNEL → 4 PROCESS → AMAL → 4 SCALE AXES → MĪZĀN` — Memory Summary only | `FRAMEWORK-REGISTRY.md` §FRM-0017 | `UNR-0041` / `NEEDS-SOURCE` | Recover first source before canonizing Mīzān | #177 |
| MoonWitness generations | II / XII / XIV (V10, V10.1) / XV, each with its own cast, eras and statuses | `CANON-REGISTRY.md` version-specific rules; `STORY-CANON-CHARACTER-BIBLE.md` | separate generations, preserved | Choose hierarchy for cross-generation identity claims | `UNR-0007` |
| XII patch #014 | `FAMILY WITHOUT FEAR` vs `THE WRONG WAY / HELLROAD` | `CANON-REGISTRY.md` §MoonWitness XII | conflict preserved, renumbering blocked | Select owner or keep both unnumbered | `UNR-0010` |
| Library PNG census | 203 PNG (root pagination) vs 1,241 PNG (expanded 1,670-path inventory) | [ISSUE-INDEX.md](ISSUE-INDEX.md) #188 and `docs/meta/github-issues/issue-list-audit.json`; #185 vs #188 | `UNKNOWN`, not "deleted" | Name authoritative snapshot and query date | #185, #188 |
| Library `/MoonWitness` pack | 22-file pack observed in recursive listing; absent from later listing | #182 vs #188 | `NEEDS-SOURCE` | Confirm whether absence is scope change or removal | #182, #188 |
| THUNDERSTRUCK | `THUNDERSTRUCK` vs locator `MENGGIGIL / THUNDERSTRUCK` | `STORY-CANON-CHARACTER-BIBLE.md` §MW-STORY-LEAD-0004 | `DRAFT / UNRESOLVED` | Decide whether they are the same story | #181 |
| ANGEL WITH SHOTGUN | `ANGEL WITH SHOTGUN` · `ANGELWITHSHOTGUN` · `rocksoul-aws` (LAW domain) | `PRODUCT-TECHNOLOGY-MAP.md`; `IDEA-ARCHIVE-INDEX.md` | `UNR-0027` / `UNRESOLVED` | Shared inspiration, same project, or separate workstreams | `UNR-0027` |
| ARSY expansion | “Agent Reality System Yard & Orchestration” vs “AGI Reality System yard” | `UNR-0019` | `UNRESOLVED` | Select official expansion; retain older as variant | `UNR-0019` |
| `CF-020` issue identity | #74 **open** and #75 **closed**, same title/scope, no managed marker | `ISSUE-INDEX.md` §CF-020 conflict | `UNR-0028` / `TRIAGE REQUIRED` | Maintainer names the canonical issue; do not auto-close | #74, #75 |
| GOD PROMISE origin | `00-MAIN GOD PROMISE` vs ROCKSOUL original source | `UNR-0006` | `UNRESOLVED` | Keep separate until primary-source relationship is proven | #17 |

## 2. Answer packets (top 15)

Columns `Evidence`, `Options` and `Recommendation` are condensed from the source register without changing meaning. Fill only the last column; leave everything else intact.

| ID | Question | Evidence | Options | Existing recommendation | Owner / state | **Your answer** |
|---|---|---|---|---|---|---|
| UNR-0001 | Full ChatGPT history available? | One 775-line prompt; full export absent | Provide export / summary-only / defer | Local-only source-preserving intake; never reconstruct from summary | Owner / MISSING | ☐ |
| UNR-0002 | Private `bjo163/*` resources | 132 private metadata records; 2 accessible via current token | Enumerate privately / limit / defer | Private inventory + restore evidence; no public mirror | Owner / OPEN | ☐ |
| UNR-0003 | Source mirror & LFS restore | Metadata only; no restore proof | Mirror all / relevant only / online only | P0 mirror first; keep namespace intact | Owner / OPEN | ☐ |
| UNR-0004 | License / rights / provenance | Sampled markers; 203 PNG unreviewed | Per-repo review / no redistribution | Unknown rights → no bytes copied | Owner / OPEN | ☐ |
| UNR-0005 | Reopen K0-006? | Approved acceptance + #27 | Keep / reopen for one source | Keep closed; reopen only by source-specific packet | Owner / LOCKED CURRENT POLICY | ☐ |
| UNR-0014 | Exact Asmaul Husna numbering profile | Owner corrections #67–69, #71–74 | Named edition / version multiple | Explicit named profile; human review for all 99 | Owner / REVIEW | ☐ |
| UNR-0017 | Visual depiction boundary | Owner restriction on prophets; prompt bans Allah depiction | Text-only / non-identifying symbolism / clarify | Conservative no-depiction boundary | Owner / LOCKED IN CONTEXT | ☐ |
| UNR-0028 | Canonical `CF-020` | #74 open, #75 closed | Name one canonical; annotate the other | No auto-close/reopen/delete | Maintainer / TRIAGE | ☐ |
| UNR-0037 | CRAYON v1.3 vs v2 | Two Library docs, different Gate/13-Way | Separate profile / versioned revision | Preserve each as written | Owner / REVIEW | ☐ |
| UNR-0038 | Dīn Allah version label | v1.8 file, v1.7 cover, v1.2 footer | Reconcile edition history | Do not rename or rewrite source | Owner / REVIEW | ☐ |
| UNR-0039 | Quantum–Fe Stone claims | Preliminary review; workbook forbids experiments | Thermal track / lab-only ferrite / prior-art | No novelty or efficiency claim without evidence | Owner / NEEDS-RESEARCH | ☐ |
| UNR-0040 | ROCKSOUL GAME vs 25-prophet RPG | Game repo documented; RPG only in Memory Summary | Separate / adapt / defer / recover | Do not merge without explicit decision | Owner / UNRESOLVED | ☐ |
| UNR-0041 | Mīzān first source | Memory Summary only | Recover / summary-only / compare | Not a Qur’anic equation or judgment | Owner / NEEDS-SOURCE | ☐ |
| UNR-0042 | Four story leads' primaries | Title/summary only; one captioned image | Recover each / keep summary / defer canon | Keep four distinct; do not merge THUNDERSTRUCK | Owner / NEEDS-SOURCE | ☐ |
| UNR-0043 | 203 PNG provenance & rights | Metadata/caption only | Private index / inspect sample / defer | Private by default; no binary import | Owner / RIGHTS-REVIEW | ☐ |

## 3. Closure rule (verbatim from source register)

An unresolved item may be closed only with one of:

1. exact primary source and version evidence;
2. explicit owner decision;
3. recorded rights/consent review;
4. verified engineering/test evidence for product/technical decisions.

AI-generated summaries, a newer README or a passing unrelated CI run are **not** sufficient closure evidence.

## 4. Machine-readable companion

Every ID above is indexed in [INDEX.json](INDEX.json) with its defining file, status label and linked issues. Regenerate with `node scripts/knowledge/build-idea-archive-index.mjs --check` after editing any source register.

**Maintenance rule:** add answers here only after the owner writes them into the corresponding `UNR-*` row in `UNRESOLVED-DECISIONS.md`. This packet is a reading aid, not a second decision registry.
