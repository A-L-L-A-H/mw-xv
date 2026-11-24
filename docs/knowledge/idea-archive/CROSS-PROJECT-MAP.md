# Cross-Project Relationship Map

**Snapshot:** 2026-11-23 · **Status:** evidence-backed map with provisional links  
A shared theme, name or visual motif is not sufficient reason to merge two projects. This map connects them only where an owner proposal or source repository explicitly defines a relationship.

## 1. Main product and creative map

```text
                         MOONWITNESS
                  message · witness · archive
                             |
          +------------------+-------------------+
          |                  |                   |
     Story / Lore        Product Surface       Knowledge
          |                  |                   |
      MW II / XII        MW-XV Board          Corpus / Research
          |                  |                   |
     V10 / V10.1         Community proposal    Evidence / Publication
          |
      ROCKSOUL / GOD PROMISE
          |
   Asmaul Husna / Visual concepts / Research
```

This diagram is navigational, not a claim that every item belongs to one locked fictional universe.

## 2. Research-domain ownership (source-repository model)

| Domain | Repository / reference owner | Question it owns | Cross-project boundary |
|---|---|---|---|
| TEXT / RGBL | `bjo163/moonwitness-corpus` (RGBL corpus lineage) | What exact text, edition, passage and provenance are being referenced? | Does not own interpretation or story canon |
| STORY / MFTL | `bjo163/rocksoul-mftl` | What narrative / belief source is being recorded? | A myth or belief can be recorded without being accepted as fact |
| EVENT / LEGEND | `bjo163/rocksoul-legend` | What event is supported by evidence? | Event is separate from later narrative |
| PERSON / SUPERHERO | `bjo163/rocksoul-superhero` | Who acted, witnessed, authored or transmitted? | Role/label does not prove identity or moral judgment |
| LAW / AWS | `bjo163/rocksoul-aws` | What rule, jurisdiction or authority applies? | AWS here means ANGEL WITH SHOTGUN; semantic domain is LAW, not Amazon Web Services |
| PERSPECTIVE / JIZZ | `bjo163/rocksoul-jizz` | How is the phenomenon framed / seen? | Perspective does not own the underlying text, event or person |
| RELATIONSHIP / CORRELATION | `bjo163/rocksoul-correlation` | How do reviewed records relate? | Correlation is not causation, identity or fulfillment |

## 3. Product, design and operations map

| Concern | Existing reference | Reuse direction / risk |
|---|---|---|
| Identity / IAM | `bjo163/rocksoul-platform`; MW-XV `packages/auth` / `orm-base` | Target MW-XV owns its identity and tenancy; do not create a second IAM authority |
| Community participation | `bjo163/rocksoul-community`; MW-XV Issue #15 | Research actual feature gap before accepting `orm-community`; proposals/comments remain non-canonical until reviewed |
| Messaging channels | `bjo163/moonsky`; MW-XV `orm-integration` / WhatsApp / notification | Keep channel operator identity separate from platform user identity; do not duplicate message stores without an accepted boundary |
| UI implementation | `bjo163/rocksoul-ui`; MW-XV `packages/ui` | Existing target UI remains canonical; external UI is reference only unless license and conformance are reviewed |
| Visual assets | `bjo163/rocksoul-assets`; MW-XV `packages/assets` | Single target manifest; every source asset needs rights/provenance |
| Creative app tooling | `bjo163/moonframe`; MW-XV `apps/ui-catalog` | Use for comparison; do not create second component/scene system |
| Coding agent / FLOW | `bjo163/rocksouldx`; MW-XV desktop / AI runtime | Current FLOW is partly roadmap; do not fork a second runtime |
| Local archive intake | `bjo163/moonwitness-memory` (archived) | Source design reference; private conversation ingestion is permission/retention-gated |
| Time / calendar research | `bjo163/antikythera-time` | Software-only research profile; not a religious calendar authority or replacement for UTC |
| Semantic analysis | `bjo163/witness-semantic-engine` | Downstream candidate analysis; exact source corpus remains separately owned |
| Ontology | `bjo163/universal-ontology-engine` (OX-DX) | Research/reference; MW-XV's existing ontology remains canonical for its own records |
| Product and public hub | `bjo163/A-L-L-A-H.COM`, `bjo163/A-L-L-A-H`, `bjo163/empire-of-the-light` | Related history/design, but status and architecture are not interchangeable |

## 4. Important separation decisions

- MoonWitness II, XII, XIV and XV are different generations/artifacts. A newer target does not erase the earlier story history.
- V10/V10.1 editorial narrative is not a substitute for original user manuscripts.
- ROCKSOUL and GOD PROMISE are related editorial tracks but their original manuscripts are explicitly unresolved as equivalent.
- THE SHADOW aliases in one source must not be auto-merged with similarly named entities in other sources or real/religious persons.
- Asmaul Husna visual inspiration references are not canonical religious explanations.
- `ANGEL WITH SHOTGUN` as a creative label and the `rocksoul-aws` LAW research repository are recorded as separate tracks until owner-defined relationship is confirmed.
- ARSY naming varies across source/context: the A-L-L-A-H blueprint expands it as “Agent Reality System Yard & Orchestration”; the available recent user context also says “AGI Reality System yard”. Preserve both variants; do not normalize without owner decision.
- MoonWitness Radio and MOONSKY channel messaging are not automatically the same product.
- Exatel / ISP business context is separate from the MoonWitness narrative and knowledge canon.

## 5. Target MW-XV package ownership to reuse

MW-XV README and Issue #15 indicate these existing owners:
- ORM / typed domain addons and API registry.
- `packages/corpus` for source editions, passages and corpus provenance.
- `packages/research` for analysis and source comparisons.
- `packages/orm-knowledge` for knowledge/editorial/review/publication records.
- `packages/assets` for original artwork, variants, licenses and manifests.
- `apps/board` for one product UI surface.
- `apps/desktop`, `packages/ai-runtime`, `packages/ai-mcp`, `packages/orm-ai` for bounded local AI.
- TaskOS for cross-project accepted work.

New packages must be justified by a verified missing owner contract, not by the existence of a separate legacy repository.
