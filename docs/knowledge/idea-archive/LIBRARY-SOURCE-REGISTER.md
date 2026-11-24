# Library Source Register — Availability, Provenance & Privacy

**Snapshot:** 2026-11-23 · **Status:** metadata inventory plus selected source review.  
This register distinguishes raw files, inspected documents, generated captions and unreviewed media. A Library listing is not a full ChatGPT account export.

## Current complete inventory snapshot — 2026-11-23 follow-up pagination

A complete paginated Library listing was performed after the earlier 94-object discovery snapshot. The latest result is:

| Scope | Entries | Files | Folders | Pagination |
|---|---:|---:|---:|---|
| Library root only | 279 | 278 | 1 | 3 pages; cursor exhausted |
| Recursive Library tree | 319 | 300 | 19 | 4 pages; cursor exhausted |

### Root-file MIME inventory

| File class | Count |
|---|---:|
| PNG | 203 |
| Markdown | 33 |
| ZIP | 28 |
| JSON | 6 |
| Plain text | 4 |
| DOCX | 1 |
| Python | 1 |
| CSV | 1 |
| Unknown MIME | 1 |
| **Files total** | **278** |

The one root folder is `/MoonWitness`. Its recursive subtree adds 18 nested folders and 22 files, for a recursive total of 319 entries. Across the recursive tree, MIME counts are 203 PNG, 43 Markdown, 28 ZIP, 11 TypeScript, 7 JSON, 4 plain-text, 1 DOCX, 1 Python, 1 CSV and 1 unknown-MIME file.

The `/MoonWitness` subtree includes a platform blueprint, foundation index, ADRs, governance / AI specifications, TypeScript contracts, package sources and tests. The inventory is metadata-only; the existence of code or a blueprint does not establish completeness, current deployment, ownership equivalence or approval to import it into MW-XV.

### Earlier snapshot retained as history

An earlier Library listing snapshot recorded 94 objects (63 PNG, 28 document/text/spreadsheet/PDF-type objects and 3 other files). That count remains a historical checkpoint, not the latest total. The later paginated listing is used for current inventory counts. Differences between snapshots are not interpreted as proof of deletion or addition of particular files.

These counts describe returned Library metadata only. They do not mean all file contents, image prompts, revisions, provenance or rights have been read or cleared. The Library is not a complete ChatGPT account export.

## Selected text and structured sources

| Source record | Library source | Observed format / date | Review state and treatment |
|---|---|---|---|
| SRC-LIB-0001 | Current-turn master prompt, `Teks yang ditempel (1).txt` | 775 lines · 23 Nov 2026 | **SOURCE-READ**; preserved verbatim at [raw master prompt](../../second-brain/raw/2026-11-23-master-prompt-total-idea-archive.md) |
| SRC-LIB-0002 | Older Library `Pasted text.txt` | 439 lines · 19 Jun 2026 | **PRIVATE-WITHHELD**; sensitive first-person note; not copied or summarized into public Git |
| SRC-LIB-0003 | `Omniscience_Method_RGBL_AI_Ready_Research_Paper.md` | 437 lines · v1.0 · 17 Aug 2026 | **SOURCE-READ**; summarized in [Framework Registry](FRAMEWORK-REGISTRY.md); personal experiential detail omitted |
| SRC-LIB-0004 | Library folder `rocksoul` | Folder metadata | **METADATA-ONLY**; recursive contents were not resolved by the listing call; do not infer it is empty |
| SRC-LIB-0005 | `CRAYON_Framework_v1.3_Bilingual_FINAL.docx` and paired PDF | 9 pages · v1.3 · 23 Aug 2026 | **SOURCE-READ** for the DOCX text; four cumulative levels, clock metaphor, 9 Gate, 13 Way, audience conditions and non-claims recorded |
| SRC-LIB-0006 | `Easy_Way_to_Understand_Allah_Bilingual_Research_Paper_v2_FINAL.docx` and paired PDF | 16 pages · v2 | **SOURCE-READ** for the DOCX text; non-scriptural conceptual starting framework; PDF is listed as a paired copy |
| SRC-LIB-0007 | `Din_Allah_4_Kitab_Universal_Iman_Foundation_v1.8_FINAL_Universal_Iman_Charter.docx` | 56 pages · 20 Aug 2026 | **SOURCE-PARTIAL**; first pages and four-book section inspected. Filename v1.8 conflicts with internal cover v1.7 and footer v1.2 |
| SRC-LIB-0008 | `Quantum_FE_Stone_Research_Paper_ID.docx` and paired PDF | 14 pages · v1.0 · 17 Oct 2026 | **SOURCE-PARTIAL**; executive summary, method, selected technical sections inspected; preliminary scoping review/proposal only |
| SRC-LIB-0009 | `Quantum_FE_Stone_Research_DIY.xlsx` | 7 worksheets · 149 extracted rows · v1.0 | **SOURCE-READ**; planner, DIY recipes, BOQ, experiment log, candidate materials and selected literature rows reviewed; explicitly reports no physical experiment |
| SRC-LIB-0010 | Remaining Library image collection | 203 PNG records in the latest root inventory | **METADATA-ONLY / RIGHTS-REVIEW** unless an individual item is separately inspected; do not treat captions as original prompt history |
| SRC-LIB-0011 | Library folder `/MoonWitness` | 18 nested folders · 22 files (Markdown, TypeScript and JSON) | **METADATA-ONLY** inventory; blueprint, contracts, code, governance and tests require source-by-source review before any target adoption |

## Image sources and caption-only visual leads

The latest root inventory contains 203 PNG image files. Image objects with titles / captions relate to (among others) ROCKSOUL / GOD PROMISE posters, MoonWitness Bass-Hunter / Shirat bridge art, a Journey of Light world map, CRAYON / RGB-related posters, “One Moon / AEQ-GHAUTS”, Ya’juj & Ma’juj visual concepts, and a 32×32 “Mega Tileset MoonWitness” top-down RPG atlas.

Some of these titles and descriptions came from generated Library/search captions rather than the original image-generation prompt. They are therefore **CAPTION-ONLY** evidence: useful for navigation and idea recovery, not proof of exact original wording, authorship, canon or reuse rights. No PNG binary, font, music, personal photo or other Library media was copied into MW-XV by this archive update.

## Evidence-state policy

- `SOURCE-READ` — extracted text was read in the inspected range / full document as stated per row.
- `SOURCE-PARTIAL` — only selected pages or sections were read.
- `METADATA-ONLY` — filename/date/size was observed; contents not reviewed.
- `IMAGE-OPENED` — binary was opened read-only; original prompt and rights may still be missing.
- `PRIVATE-WITHHELD` — source is private/sensitive and omitted from public output.
- `CAPTION-ONLY` — generated/library caption, not the original user prompt.
- `RIGHTS-REVIEW` — publication or reuse requires per-asset rights review.

## Current limits

The Library inventory is not a complete ChatGPT account export. It does not prove that every historical conversation attachment, original prompt, older version, image revision, local file, gist, wiki, release asset or backup has been surfaced. User-supplied artwork is not automatically cleared for public redistribution. New material should be added first as a source reference with exact access state; never silently rewrite or overwrite the original.
