# Source Recovery Runbook — owner-provided export (local-first)

**Snapshot:** 2026-11-24 · **Status:** `PROCEDURE / NOT EXECUTED`  
**Unblocks:** [Issue #187](https://github.com/A-L-L-A-H/mw-xv/issues/187), [UNR-0001](UNRESOLVED-DECISIONS.md) and, downstream, #178–#182 / #185 / #188.

> This runbook was written **without access to any export**. No conversation bytes, personal notes, credentials or private repository content were read or copied. It exists to turn #187 from "blocked" into "one authorized local run".

## Boundary (non-negotiable)

1. The source export stays on the owner's machine or an approved private volume. It is **never** committed, attached to an issue, or uploaded to this public repository.
2. Under current K0-006 ([CAN-0016](CANON-REGISTRY.md), [Issue #27](https://github.com/A-L-L-A-H/mw-xv/issues/27)), no legacy bytes are imported. Only derived, classified, source-traceable notes enter the public archive.
3. `moonwitness-memory` is a **local utility**. Its README states bounded text chunks are sent to Gemini for extraction; the owner must accept that before enabling AI extraction. Import and hashing work without an API key.
4. Nothing here changes canon. Recovered material is `FACT` about a source plus `USER IDEA` / `CANON` / `DRAFT` classification — never an automatic promotion.

## Step 0 — owner places the export locally

Owner supplies a ChatGPT ZIP export or `conversations.json` at a path they control, e.g. `/tmp/opencode/private-export/` or a local drive. The path is written down privately, not in a public issue.

## Step 1 — fix provenance before parsing

```bash
sha256sum conversations.json     # or the ZIP
# record: filename, byte size, SHA-256, date supplied, owner authorization reference
```

Store the manifest in the **private** archive only. A public record may contain the ID and a redacted note ("owner-supplied export, hash withheld"), never the raw bytes.

## Step 2 — use the tool that already exists

`bjo163/moonwitness-memory` (archived, public README verified 2026-11-24) already implements the required pipeline:

- streams the ZIP/JSON to disk, SHA-256, preserves the original unchanged;
- parses incrementally, one conversation at a time;
- extracts stories, lore, characters, events, ideas, projects, decisions, quotes and entities with **source-message provenance** into SQLite;
- FTS5 + local multilingual semantic search (FastEmbed + LanceDB);
- REST/OpenAPI and streamed NDJSON corpus export;
- optional Rclone/S3 Google Drive backup (explicitly experimental; local import works without it).

Start it locally with its `start.bat` / Docker Compose flow. Without `GEMINI_API_KEY`, import still stores the original and the job waits at `awaiting_ai`; nothing is discarded. Set the key only if the owner accepts bounded chunks leaving the machine.

## Step 3 — export NDJSON, keep provenance

Use the tool's streamed NDJSON export. Every extracted record must retain: source archive ID, conversation ID, message ID(s), extraction timestamp and extractor version. A record without a source-message locator is **not** admissible into the archive.

## Step 4 — distill privately, then publicly

Work in two passes:

1. **Private pass (local/private store):** group by project family, story, character, canon rule and visual asset. Keep original wording verbatim. Record first appearance, revisions, explicit corrections and decisions (Phases 2 and 6 of the master prompt).
2. **Public pass (this repository):** copy only derived notes into `docs/raw/YYYY-MM-DD-<slug>.md` with a `SRC-` locator, classification (`FACT`, `USER IDEA`, `CANON`, `DECISION`, `DRAFT`, `PROPOSAL`, `ASSUMPTION`, `OBSOLETE`, `UNRESOLVED`), and a pointer to the private hash manifest by ID.

Never copy: raw conversation messages, personal diary content, account exports, credentials, infrastructure secrets, child-sensitive data, or third-party artwork bytes.

## Step 5 — link into the archive

For each derived note:

- add or update the relevant stable ID in [INDEX.json](INDEX.json) via `node scripts/knowledge/build-idea-archive-index.mjs`;
- add the source to the matching register (`IDEA-CATALOG.md`, `STORY-CANON-CHARACTER-BIBLE.md`, `CHARACTER-REGISTRY.md`, `CREATIVE-VISUAL-BIBLE.md`, `LIBRARY-SOURCE-REGISTER.md`);
- if a conflict surfaced, add a row to [DECISION-PACKETS.md](DECISION-PACKETS.md) and the corresponding `UNR-*` row — **do not** silently resolve it;
- only after owner review may a rule move from `PROVISIONAL` to `LOCKED` in [CANON-REGISTRY.md](CANON-REGISTRY.md), then pass `node scripts/knowledge/check-canon-registry.mjs`.

## Step 6 — close the loop

1. Post evidence to #187: number of conversations processed, count of derived notes, private manifest ID, list of public IDs created. Do not post hashes or raw excerpts if the owner withheld them.
2. Update [UNR-0001](UNRESOLVED-DECISIONS.md) only with one of the four closure rules in [DECISION-PACKETS.md](DECISION-PACKETS.md) §3.
3. Re-run `gh issue list -R A-L-L-A-H/mw-xv --state all` and regenerate [BACKLOG-DIGEST.md](BACKLOG-DIGEST.md) so the new source records are visible.

## Verification checklist

- [ ] Export never appears in git status, an issue attachment or a workflow artifact.
- [ ] SHA-256 manifest exists in the private store and is referenced by ID only.
- [ ] Every derived note has a source-message locator.
- [ ] Original wording preserved alongside any synthesis.
- [ ] No canon changed without owner decision and canon gate passing.
- [ ] INDEX.json regenerated and `--check` passes.
- [ ] Conflict rows added, not silently resolved.
- [ ] No source repository was deleted, archived, force-pushed or bulk-imported.

## Honest limitation

Writing this runbook did not recover any conversation. Until the owner supplies the export and authorizes a local run, the four story leads, original image prompts, poster masters and first-source framework documents remain `MISSING` / `NEEDS-SOURCE`. AI summaries must not be reconstructed as originals.
