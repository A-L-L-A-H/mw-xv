# Story, Canon & Character Bible

**Snapshot:** 2026-11-23 · **Status:** source-preserving editorial reference  
This is a map across existing story sources. It does not replace their original files, authenticate missing private manuscripts, or silently promote `review` / `draft` material to final canon.

## 1. Story source hierarchy

| Source                                               | What it contains                                                                                                 | What it does not prove                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bjo163/moonwitness-II`                              | Master blueprint, world rules, eras, story seeds and character YAML                                              | That every lore entry is final or that character references equal real people      |
| `bjo163/moonwitness-xii-season-global-championships` | 15 indexed story episodes, 63 editorial summary pages, 33 patch slots and character concept records              | 15 authenticated transcripts, 63 original posters, or external submission/approval |
| `bjo163/moonwitness-xiv`                             | Public V10 99-chapter index, 16-part V10.1 expanded edition, source crosswalk, progress ledger and recovery gaps | Original V9/V10 manuscript, complete ChatGPT export, or approved final canon       |
| MW-XV                                                | Current knowledge/ontology/knowledge archive and story/editorial ownership contracts                             | That all historical lore has been imported or reconciled                           |

The public V10 narrative index and V10.1 expansion must retain their own warning: V10.1 is a public expanded research edition, **not the original transcript and not final canon**.

## 2. MoonWitness II — core story platform

**Project identity:** Story & Witness Platform · Living Archive · Interactive Narrative Experience.  
**Core theme:** `END OF AN ERA`.  
**Visual style as written in the source:** `Lines — Visual Effect Mansa`.

### Core platform sequence

`CAPTURE → CONNECT → WITNESS → UNDERSTAND → PRESERVE → PROMOTE → MOVE FORWARD`

### Thirteen core narrative functions (source order)

1. Storytelling — turn people, events, memories, fragments and moments into stories.
2. Exposure — reveal hidden signals and connections.
3. Change Advisory Board — examine transitions, consequences and next decisions.
4. Chasing Heart — longing, attachment and connection.
5. Lovestruck — love, vulnerability, attraction, romance and emotional tension.
6. Breath Electric — energy, atmosphere, movement, rhythm and emotional electricity.
7. Seduction — attraction, curiosity, temptation, fascination, desire and attachment.
8. Fault Lines — pressure, misalignment, fracture, instability and transition.
9. Villain of the Story — disruption, temptation, opposition, conflict and transformation as narrative forces.
10. Witness Archive — preserve events, observations, messages, memories, relationships and changes.
11. Sanity's Last Breath — final narrative threshold before silence, escape, transformation or end of a phase.
12. Past Presence — how the past remains present through trace, objects, places, messages, habits, relations and signals.
13. Promoting — identify what deserves to continue into the next phase.

**Important source rule:** “Promoting” is explicitly not advertising; it asks what deserves to continue.

### Eight eras (source order and status)

| Order | Era ID | Title         | Source status          |
| ----: | ------ | ------------- | ---------------------- |
|     0 | era_00 | BEFORE LIGHT  | `published` lore entry |
|     1 | era_01 | THE ARRIVAL   | `draft`                |
|     2 | era_02 | THE WITNESS   | `draft`                |
|     3 | era_03 | THE RUNAWAYS  | `draft`                |
|     4 | era_04 | THE EXPOSURE  | `draft`                |
|     5 | era_05 | THE CHANGE    | `draft`                |
|     6 | era_06 | END OF AN ERA | `draft`                |
|     7 | era_07 | NEXT PHASE    | `draft`                |

Source: `bjo163/moonwitness-II/data/eras.yaml`, blob `e55b6b308620bac0d2b6d2fb518af2f826c51122`. These are story eras, not dates in real-world chronology.

### Existing story records

| Story ID  | Title                 | Theme                        | Current source status |
| --------- | --------------------- | ---------------------------- | --------------------- |
| story_001 | When The Moon Witness | END OF AN ERA                | `review`              |
| story_002 | THE RUNAWAY TRACE     | IDENTITY · MEMORY · MOVEMENT | `review`              |

Source: `bjo163/moonwitness-II/data/stories.yaml`, blob `465011cb842ec4c6e7ebca11b2fd70de5e7c7d2b`. Preserve the titles, premises and endings from that source file; do not infer missing episodes.

## 3. MoonWitness II world rules

Source: `bjo163/moonwitness-II/docs/WORLD_RULES.md`, blob `c3634f74b63ad727cd1c8166e5dbe6d6278aa0ea`.

1. The Moon is the symbolic anchor of the Witness layer.
2. A witness records an observation without forcing a final interpretation.
3. Mystery, unknown and unresolved states are valid parts of the universe.
4. Identities can have multiple names; aliases can coexist without automatically becoming separate entities.
5. Past presence connects eras.
6. Fault lines reveal pressure; they do not necessarily mean permanent breakage.
7. Promoting moves forward what deserves to continue.
8. Narrative roles stay contextual.
9. The story can evolve; canon may grow while lore remains unresolved.
10. Keep rules simple enough to support creation and exploration.

These are repository-authored story rules. They are not automatically MW-XV technical policy or theological claims.

## 4. Character registry — MoonWitness II

The following source records are in `data/characters.yaml`, version 0.1. All are `canon_level: lore`, `visibility: public`, `status: review`; none is labelled `locked`.

| Stable source ID        | Name               | Aliases / alternate labels recorded in source                                                                                                                                 | Source caveat                                                                     |
| ----------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| char_the_shadow         | THE SHADOW         | R; 163; Dancer; Runaway; Not Untouched; Actor. Alternate identity field: THE DREAMER; dreamer aliases include Runaway, The Unremembered, The Chosen One, Dancer, The Exposer. | Alias/alternate-identity fields are source assertions; do not auto-merge personas |
| char_a_lah              | A LAH              | THE BOSS; LiAlH₄; nickname THE BATTERY                                                                                                                                        | Fictional lore role                                                               |
| char_dogs_from_universe | DOGS FROM UNIVERSE | MOH571; THE STARS; YOUJIZZ; THE DREAMER                                                                                                                                       | Skill labels are fictional metadata                                               |
| char_blue_witch         | THE BLUE WITCH     | MANSA MUSA; BLUE EYES                                                                                                                                                         | Preserve as lore names; no real-person identity assertion                         |
| char_dj_david           | DJ DAVID           | David                                                                                                                                                                         | Preserve source-level alias                                                       |
| char_walter_white       | WALTER WHITE       | Skill label DOKTER BEDAH                                                                                                                                                      | Fictional/reference treatment; do not identify as a real actor/person             |
| char_electric_forest    | ELECTRIC FOREST    | Cassade Pope                                                                                                                                                                  | Inspiration/alias relationship is not proof of identity                           |
| char_indestructible     | INDESTRUCTIBLE     | THE FATHER; THE RED FIRE                                                                                                                                                      | Fictional symbolic role                                                           |
| char_jhnny_depp         | JHNNY DEPP         | Pirate of Carebean                                                                                                                                                            | Exact source spelling retained; rights/identity review before adaptation          |

Source: `bjo163/moonwitness-II/data/characters.yaml`, blob `406ddf616d98926f0edd91116814e85f36df8faf`.

**Identity policy:** preserve persona, alias observation, source, appearance, narrative role and identity decision as separate concepts. `UNKNOWN` is valid. Never infer that a lore character is a real or religious figure.

## 5. MoonWitness XII — separate era and cast

XII's own Character Canon V3 says it is a working product, not a feature-complete world platform.

### Main cast (XII source terminology)

- ROCKSOUL — Main Witness.
- ISROCKFEEL — Action Mentor / Punk-Rock Driver.
- WALTERWHITE — Wild Idea Engineer.
- 4-LAH / THE BATTERIES — Signal Queen / Command Center.

### Supporting cast

MIKAIL; FINAL KEEPER; QUESTION DUO; RECORD TWINS; MALIK; RIDWAN.

The XII source says these are original symbolic character designs and not portrayals of actual metaphysical beings. Keep XII characters distinct from II's similarly named or related characters until source-by-source identity decisions are accepted.

### XII story / patch archive status

- 15 indexed episode records and 63 editorial summary pages; originals/transcripts are not fully authenticated.
- 33 patch slots: 8 previously registered/reported in chat; 5 recovered drafts; 1 numbering conflict (#014); 18 editorial proposals (#015–#032); 1 in-chat record (#033).
- `KOPIHITAM - SIACENG (FAITH TO ACTION)` is recorded as requested/submitted in chat, not as externally dispatched or approved.
- `FAMILY WITHOUT FEAR` versus `THE WRONG WAY / HELLROAD` is a preserved number/title conflict at #014. Both candidates stay visible.

Sources: `CHARACTER_CANON_V3_AND_ROADMAP.md` blob `4e06daf4884055f3e855bc691c30851c727b377a`; `MASTER_BUG_PATCH_33_V2.md` blob `eb4d2ca671e1d46174ebd3dd941b92ffc323078b`.

## 6. V10 / V10.1 and continuity gaps

- V10 public draft: 99-chapter editorial index.
- V10.1: 16-part expanded public research edition.
- Historical progress ledger: 2023–2026, with early dates identified as leads when no primary source exists.
- Source crosswalk: public references S01–S22 and anonymized private-source locators S23+.
- Recovery-gap register lists unresolved manuscript, alias, poster, terminology and chronology work.

Known unresolved pairs/gaps include:

- `00-MAIN GOD PROMISE` versus ROCKSOUL: distinct source leads, no automatic merge.
- World Patch #014 title conflict described above.
- The Batteries four books and NPD 24:27 / 24:37 / 25:50 source/page gaps.
- THE SHADOW / DOGS FROM UNIVERSE / ROCKSOUL / 4-LAH / WALTER alias candidates.
- ZILL shadow-optics work versus ZILL tasawuf narrative.
- MYLUFT / MA’LŪF / AL-WADŪD / Honey / Queen R terminology.
- Original poster/manuscript recovery and publication rights.
- Historical 2023–2025 timeline: exact first dates remain unknown where primary evidence is absent.

## 7. Recent MoonWitness story leads — not canon-locked

These four episode / poster titles are retained from the available recent-conversation summary (around September 2026). The summary is a discovery aid, not a substitute for the original conversation transcript or source artwork prompt.

| Story lead ID      | Original title                               | What the currently available source supports                                                                                                                                        | Status                                                                                                                   |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| MW-STORY-LEAD-0001 | **MOONWITNESS — Two Generations, One Toast** | The Library contains a matching image title/caption. Available context associates the concept with a father/son, memory and parallel-world narrative.                               | `DRAFT / SOURCE-PARTIAL`; recover the original episode text and prompt before expanding                                  |
| MW-STORY-LEAD-0002 | **MOONWITNESS — Chaos Before Dawn**          | Available summary identifies a pre-dawn dream-world sequence and the name MyLuft.                                                                                                   | `DRAFT / NEEDS-SOURCE`; plot, sequence and final wording not available                                                   |
| MW-STORY-LEAD-0003 | **MOONWITNESS — BIRD OF A FEATHER**          | Available summary confirms the exact title and that poster text was revised.                                                                                                        | `DRAFT / TITLE-ONLY`; do not add a plot or characters from inference                                                     |
| MW-STORY-LEAD-0004 | **MOONWITNESS — THUNDERSTRUCK**              | Available summary preserves the title, a MyLuft dream-world framing and a “Wahyono” wordplay note. The V10 progress ledger separately uses the locator `MENGGIGIL / THUNDERSTRUCK`. | `DRAFT / UNRESOLVED`; do not assume the ledger's two labels are identical or interpret the wordplay as a religious claim |

**Continuity rule:** keep these four records separate from `story_001` and `story_002` until original sources establish their relationship. No shared cast, chronology, canon status, episode numbering or ending is inferred. Preserve the title spelling and punctuation above. A future recovery pass must attach the original message / file locator, first-known date if evidenced, exact user wording and revision chain.

## 8. Canon registry status rules

Use `LOCKED` only for explicit owner-confirmed constraints with a traceable source. Use `PROVISIONAL` for accepted working lore with open review. Use `RETIRED` for superseded versions retained historically. Use `UNRESOLVED` for conflicts. Existing source labels such as `review`, `draft`, `published`, `registered`, `recovered_draft`, `proposed` and `user_submitted_in_chat` must not be flattened.

No silent renumbering, alias fusion, story rewrite or poster replacement is authorized by this index.
