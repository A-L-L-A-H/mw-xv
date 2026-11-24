# Canon Registry & Continuity Rules

**Snapshot:** 2026-11-23 · **ID namespace:** `CAN-####`  
This registry preserves sourced rules and constraints. It does not decide conflicts or rewrite older story versions. `LOCKED` means an explicit owner instruction or decision is recorded; it does not make a fictional or religious claim objectively true.

## Status vocabulary

- `LOCKED` — explicit owner instruction / accepted boundary.
- `PROVISIONAL` — repository-documented lore or working rule whose scope may evolve.
- `UNRESOLVED` — source conflict or missing owner decision.
- `RETIRED` — superseded record retained for history.

Compound values such as `PROVISIONAL lore` or `LOCKED owner instruction` mean **status + classification**, not additional status values. `RETIRED` and `UNRESOLVED` remain in the vocabulary for future use.

## Canon / continuity register

| Canon ID | Rule / exact source wording | Domain | Source / provenance | Status |
|---|---|---|---|---|
| CAN-0001 | “The Moon is the symbolic anchor of the Witness layer.” | MoonWitness II | `moonwitness-II/docs/WORLD_RULES.md`, blob `c3634f74b63ad727cd1c8166e5dbe6d6278aa0ea` | PROVISIONAL lore |
| CAN-0002 | “A witness can preserve an observation without forcing a final interpretation.” | Witness / evidence | Same II world rules | PROVISIONAL lore |
| CAN-0003 | “Mystery, unknown, and unresolved states are valid parts of the universe.” | Story / canon | Same II world rules | PROVISIONAL lore |
| CAN-0004 | “Aliases can coexist without automatically becoming separate entities.” | Character identity | Same II world rules; target ontology also forbids identity inference | PROVISIONAL lore / policy alignment |
| CAN-0005 | “Past Presence connects Eras.” | Narrative continuity | Same II world rules | PROVISIONAL lore |
| CAN-0006 | “A fault line marks tension or misalignment, not necessarily permanent breakage.” | Narrative metaphor | Same II world rules | PROVISIONAL lore |
| CAN-0007 | “Promoting asks what deserves to continue into the next phase.” / “Promoting is not advertising.” | Narrative function | II master blueprint | PROVISIONAL lore |
| CAN-0008 | “Narrative Roles Stay Contextual.” | Character / story roles | II world rules | PROVISIONAL lore |
| CAN-0009 | “Canon may grow. Lore may remain unresolved.” | Continuity | II world rules | PROVISIONAL lore |
| CAN-0010 | “World rules should make creation and exploration easier, not harder.” | Narrative design | II world rules | PROVISIONAL lore |
| CAN-0011 | Do not depict Allah as a human, character or visual object. | Religious / visual boundary | Owner-provided master prompt (774 newline-terminated lines; 775 including the unterminated final line) | LOCKED owner instruction |
| CAN-0012 | Do not silently change canon, remove historical versions or replace original wording without preserving the source. | Archive / canon governance | Owner-provided master prompt | LOCKED archive rule |
| CAN-0013 | Distinguish original user ideas from AI suggestions, drafts, proposals and assumptions. | Archive / provenance | Owner-provided master prompt | LOCKED archive rule |
| CAN-0014 | Distinguish scripture text, hadith, tafsir, translation, personal interpretation, metaphor and creative concept. | Religious / editorial | Owner-provided master prompt | LOCKED editorial boundary |
| CAN-0015 | Do not reproduce third-party character/artwork references as original production assets. | Copyright / visual production | Existing MW-XV Issue #18 / #19 proposals and source policies | PROVISIONAL until asset rights review |
| CAN-0016 | No legacy source bytes, private conversation records, prompts, fixtures, data or assets are imported under current K0-006 scope. | Repository migration | Owner-approved MW-XV K0-006 decision and Issue #27 | LOCKED current migration boundary |

## Version-specific status rules

### MoonWitness II
- The source file marks characters as `canon_level: lore`, `status: review`.
- Era `BEFORE LIGHT` is marked `published`; the remaining seven eras are `draft`.
- Story seeds `story_001` and `story_002` are marked `review`.
- These source-level statuses must not be flattened into an across-universe final canon label.

### MoonWitness XII
- Source docs call the platform a working product, not a feature-complete world platform.
- The 33-patch register uses distinct states: registered/reported, recovered draft, numbering conflict, proposal and user-submitted-in-chat.
- #014 must preserve both `FAMILY WITHOUT FEAR` and `THE WRONG WAY / HELLROAD` as a conflict.
- #033 `KOPIHITAM - SIACENG (FAITH TO ACTION)` is recorded as requested/submitted in chat only, not as external delivery or approval.
- The register says zero independent verification of divine approval.

### V10 / V10.1
- V10 public draft is an editorial 99-chapter index.
- V10.1 is a 16-part expanded public research companion, not the original V10 transcript and not final canon.
- Original first-person private materials remain missing/controlled; AI summaries must not be silently reconstructed as originals.

## Conflict register links

See [Unresolved Decisions](UNRESOLVED-DECISIONS.md) for source conflicts, available options, recommendations and the owner decisions that remain open. Do not close a conflict just because a later source uses one spelling/title.

