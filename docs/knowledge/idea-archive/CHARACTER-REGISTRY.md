# Character Registry

**Snapshot:** 2026-11-23 · **ID namespace:** `CHR-####`  
This registry indexes source character records. It does not establish that similarly named characters from different generations are the same person/entity.

## Identity policy

Keep separate:
- character / persona identity;
- alias observation;
- source and source version;
- appearance / costume;
- story role;
- real-person inspiration or franchise reference;
- reviewer identity decision.

Use `UNKNOWN` when the source does not support equivalence. Do not merge identities by name similarity.

## MoonWitness II — nine source character records

Source file: `bjo163/moonwitness-II/data/characters.yaml`, blob `406ddf616d98926f0edd91116814e85f36df8faf`.

All nine entries in that source are `canon_level: lore`, `visibility: public`, `status: review`.

| Character ID | Source name | Aliases / alternate terms as recorded | Status |
|---|---|---|---|
| CHR-0001 | THE SHADOW | R; 163; Dancer; Runaway; Not Untouched; Actor; alternate identity field THE DREAMER; Dreamer aliases include Runaway, The Unremembered, The Chosen One, Dancer, The Exposer | lore / review |
| CHR-0002 | A LAH | THE BOSS; LiAlH₄; nickname THE BATTERY | lore / review |
| CHR-0003 | DOGS FROM UNIVERSE | MOH571; THE STARS; YOUJIZZ; THE DREAMER | lore / review |
| CHR-0004 | THE BLUE WITCH | MANSA MUSA; BLUE EYES | lore / review |
| CHR-0005 | DJ DAVID | David | lore / review |
| CHR-0006 | WALTER WHITE | Skill: DOKTER BEDAH | lore / review |
| CHR-0007 | ELECTRIC FOREST | Cassade Pope | lore / review |
| CHR-0008 | INDESTRUCTIBLE | THE FATHER; THE RED FIRE | lore / review |
| CHR-0009 | JHNNY DEPP | Pirate of Carebean | lore / review |

**Caution:** alias lists are fields in the historical lore source, not proof of equivalence with real people, celebrities, religious figures or characters in other franchises. Preserve the original spellings, including apparent variants.

## MoonWitness XII — main cast (separate version)

Source: `bjo163/moonwitness-xii-season-global-championships/docs/CHARACTER_CANON_V3_AND_ROADMAP.md`, blob `4e06daf4884055f3e855bc691c30851c727b377a`.

| Character ID | Source label | Role / visual note | Cross-generation identity |
|---|---|---|---|
| CHR-0010 | ROCKSOUL | Main Witness; hoodie/backward cap; green/black cap modes are symbolic storytelling | UNRESOLVED vs other ROCKSOUL references |
| CHR-0011 | ISROCKFEEL | Action Mentor / Punk-Rock Driver; stage energy | UNRESOLVED |
| CHR-0012 | WALTERWHITE | Wild Idea Engineer; eccentric engineer | UNRESOLVED vs II WALTER WHITE |
| CHR-0013 | 4-LAH / THE BATTERIES | Signal Queen / Command Center | UNRESOLVED vs II A LAH / THE BATTERY |

XII supporting cast:

| Character ID | Source label | Note |
|---|---|---|
| CHR-0014 | MIKAIL | Emerald field-gardener / stewardship design |
| CHR-0015 | FINAL KEEPER | Silver-black time watcher; the source says inspired by mortality-related themes, not an unqualified identification |
| CHR-0016 | QUESTION DUO | Indigo/crimson investigators |
| CHR-0017 | RECORD TWINS | Gold/silver archivists; the source explicitly cautions against treating Raqib/Atid as personal names from Qur'an 50:18 |
| CHR-0018 | MALIK | Dark-red boundary guardian |
| CHR-0019 | RIDWAN | Jade garden welcome; source says the name occurs in later tradition, not named in Qur'an |

XII explicitly says these are original fictional design motifs, not depictions of metaphysical reality. It also says faces are hidden by silhouettes and roles are communicated through outfit/palette.

## V10 / other source families

The V10.1 public narrative lists candidates including THE SHADOW, A LAH / THE BOSS, DOGS FROM UNIVERSE, THE BLUE WITCH, DJ DAVID, WALTER WHITE, ELECTRIC FOREST, INDESTRUCTIBLE, JHNNY DEPP and later ROCKSOUL / 4-LAH / WALTER variants. Those records are an editorial companion and should not be merged into the II/XII YAML identities without exact source crosswalk review.

## Missing character attributes

The following are not complete in the inspected source set and must not be invented:
- full first appearance dates;
- all original dialogue/quotes;
- physical description and approved final art for every variant;
- full relationship graph;
- exact identity decisions between generations;
- original owner manuscript or unredacted private character sheets.

## New character record requirements

New CHR records should include: exact source wording, source ref/commit/blob, universe/version, status, role, aliases as observations, related stories/events, asset/provenance IDs, rights status, and explicit human-reviewed identity decisions. Never use an inferred `sameAs` edge without evidence.
