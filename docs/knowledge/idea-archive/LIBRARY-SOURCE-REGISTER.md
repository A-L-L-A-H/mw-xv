# Library Source Register — Availability, Provenance & Privacy

**Snapshot:** 2026-11-23 · **Status:** metadata inventory only.
This register distinguishes the current-turn master prompt from older Library files with the same generic filename. It deliberately does not expose private diary content or republish unreviewed image binaries.

## Text sources

| Source record | Library / conversation identity | Observed size | Status and treatment |
|---|---|---:|---|
| SRC-LIB-0001 | Current-turn user attachment `Pasted text.txt` | 775 lines | Read in full; preserved verbatim at [raw master prompt](../../raw/2026-11-23-master-prompt-total-idea-archive.md) |
| SRC-LIB-0002 | Older Library `Pasted text.txt` (19 Jun 2026) | 439 lines | Personal first-person note with sensitive private content. **Not copied or summarized in this public repository.** Retain the Library original; any future use requires a scoped private/local intake and explicit publication/retention decision |
| SRC-LIB-0003 | `Omniscience_Method_RGBL_AI_Ready_Research_Paper.md` | 437 lines | Version 1.0 dated 17 Aug 2026; method summarized in [Framework Registry](FRAMEWORK-REGISTRY.md). Personal experiential detail is not reproduced here |
| SRC-LIB-0004 | Library folder named `rocksoul` | Folder metadata only in this pass | Folder was visible; recursive contents were not resolved by the available listing call. Do not infer it is empty |

## Image sources

The Library root listing returned **21 image files** (19 PNG and 2 JPG) with generic filenames such as `image.png`, numbered `image(n).png`, UUID-named PNG files, two camera-style JPG filenames and one ChatGPT Image filename. These are Library source objects, not assets cleared for publication.

- Image file metadata was enumerated and image files were opened in read-only image mode during the audit.
- Original prompt histories, revision chains, approval records and per-image license/publication rights were not available for every image.
- Some prior Library search captions described poster / infographic ideas (e.g. Moon / ROCKSOUL / RGB / Spear & Salt / Mars / accountability and other visual concepts). A generated/search caption is **not** the user's original prompt or proof of authorship/canon.
- No image binary, font, sound or personal photo was copied into MW-XV.
- New production assets must use the target `packages/assets` manifest and the existing human review / rights gates.

## Evidence-state policy

- `SOURCE-READ`: text bytes were read in full.
- `METADATA-ONLY`: filename/date/size was observed; contents not reviewed.
- `IMAGE-OPENED`: image binary was opened for read-only inspection; original prompt/rights may still be missing.
- `PRIVATE-WITHHELD`: source is available to the user but omitted from public output due private/sensitive content.
- `CAPTION-ONLY`: only a generated/library caption is known; not original wording.
- `RIGHTS-REVIEW`: publication or reuse requires per-asset rights review.

## Current limits

The Library inventory is not a complete ChatGPT account export. It does not prove that every conversation attachment, older version, prompt, image, local file, gist or backup has been surfaced. New material should be added as source references first; never silently rewrite the original.
