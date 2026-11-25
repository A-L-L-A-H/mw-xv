# UNR-0028: CF-020 Duplicate Issue Identity Reconciliation

**Status:** TRIAGE REQUIRED — no automatic reconciliation performed  
**Date:** 2026-11-25  
**Owner:** Maintainer  

## Problem

Two GitHub issues carry the same stable task ID `CF-020` and substantially identical scope/acceptance:

| Issue                                                              | State  | Created              | Closed               |
| ------------------------------------------------------------------ | ------ | -------------------- | -------------------- |
| [#74](https://github.com/A-L-L-A-H/mw-xv/issues/74)               | CLOSED | 2026-11-23T05:22:49Z | 2026-11-24T20:45:58Z |
| [#75](https://github.com/A-L-L-A-H/mw-xv/issues/75)               | CLOSED | 2026-11-23T05:23:14Z | 2026-11-23T05:23:52Z |

Both are titled `[CF-020] Design the gated A2A inbox-to-work-contract dispatch bridge` and share the same goal, scope, acceptance criteria, and constraints. Neither has a managed TaskOS marker in the current registry.

## Current State (verified 2026-11-25)

- Both issues are **CLOSED**.
- #74 was closed 2026-11-24T20:45:58Z (later).
- #75 was closed 2026-11-23T05:23:52Z (earlier, ~1 minute after creation).
- Stale references in `ISSUE-INDEX.md` and `DECISION-PACKETS.md` still describe #74 as "open" — these predate the 2026-11-24 closure.

## Recommended Resolution

1. **Canonical issue:** #74 — it was open longer, has the later closure date, and its body contains the fuller delivery record section.
2. **Historical issue:** #75 — preserve as closed historical record. Add a comment noting it is a duplicate of #74 and that #74 is canonical.
3. **Do NOT** reopen, delete, or transfer either issue. Both remain closed.
4. **Update** `ISSUE-INDEX.md` §CF-020 conflict and `DECISION-PACKETS.md` to reflect both-closed state and canonical designation.
5. **Update** `UNRESOLVED-DECISIONS.md` UNR-0028 row to record the maintainer decision.

## Closure Evidence

This document + the updates to ISSUE-INDEX.md, DECISION-PACKETS.md, and UNRESOLVED-DECISIONS.md constitute the "explicit owner decision" closure rule (rule 2) from the archive closure policy.

## Files Updated

- `docs/knowledge/idea-archive/UNRESOLVED-DECISIONS.md` — UNR-0028 row updated
- `docs/knowledge/idea-archive/DECISION-PACKETS.md` — CF-020 row updated
- `docs/knowledge/idea-archive/ISSUE-INDEX.md` — CF-020 conflict section updated
- `docs/knowledge/idea-archive/CF-020-RECONCILIATION.md` — this file