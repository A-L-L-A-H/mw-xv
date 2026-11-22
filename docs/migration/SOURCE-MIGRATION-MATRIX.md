# Legacy Source Reference & Clean-Room Rebuild Matrix — bjo163 to A-L-L-A-H/mw-xv

Prepared: 2026-11-23. Target: A-L-L-A-H/mw-xv, branch dev. Public inventory baseline: 148 repositories returned by GitHub owner search on 2026-11-22 (100 + 48 results). Status: historical metadata and requirements reference only; the owner-approved K0-006 disposition authorizes no legacy code, data, prompt, fixture, asset or corpus-record imports.

## Decision vocabulary

- **CLEAN_ROOM_REBUILD:** use behavior and requirement descriptions as design input, then author a new target implementation. Copy no legacy source bytes, records, prompts, fixtures or assets.
- **REFERENCE_ONLY:** retain design, visual or architectural observations for comparison; no code/data/asset incorporation and no runtime dependency.
- **METADATA_ARCHIVE:** retain repository identity, refs, exact commit, file/blob/hash, license/notice observations and audit notes only.
- **RESEARCH_FIRST:** read-only gap/fit analysis; not an import permission or implementation approval.
- **DO_NOT_IMPORT:** do not use source code, data, prompts, fixtures, assets or private archive content under the current scope.
- **REOPEN_K0-006:** mandatory owner decision plus source-specific rights, privacy, provenance and quality review before any future external-content import.

Priority P0 = retirement blocker/source preservation; P1 = high product value; P2 = optional/dependency-gated; P3 = historical/unrelated. Maturity is based on README/spec inspection, not independent test execution.

## High-value source decisions

| Source | Branch | README blob SHA (not commit SHA) | Capability | Target | Decision | Caveat |
|---|---|---|---|---|---|---|
| [moonwitnessxv](https://github.com/bjo163/moonwitnessxv) | dev | df30c29080a61fd9465cc68a5a2933c6fc1c3cf5 | Vision, architecture history, ARSY/Dock/ORBIT/LUMEN specs | Vision, Knowledge/Research, Board/Desktop where compatible | REFERENCE_ONLY | Old MoonQL/D00–D13 is not the target architecture |
| [moonwitness-corpus](https://github.com/bjo163/moonwitness-corpus) | main | 079e027785a9853e68dbdeadc82c5cba88ad18ac | RGBL, editions/passages, evidence, rights, provenance, Key Witness | corpus, knowledge, research, orm-knowledge | CLEAN_ROOM_REBUILD | Verify data hashes, provenance and license assertions; no second corpus engine |
| [rocksouldx](https://github.com/bjo163/rocksouldx) | dev | 3157a62dc2582c726fe41a59936d71ebee344d6a | Repo Radar, Overlap Detector, Plan Forge, Prompt Forge, Task Deck, Proof Gate, Memory Ledger, Visual DNA Lab | Desktop, AI Runtime/Evaluation, Project/Workflow | CLEAN_ROOM_REBUILD | OpenCode notices/license apply; FLOW is not fully implemented; no second agent runner |
| [rocksoul-assets](https://github.com/bjo163/rocksoul-assets) | main | ea4678167445e5e8788ecc862ebd1d6eca38f51b | Brand, SVG, PNG/APNG, WebM/Lottie, sound, asset registry | packages/assets, packages/ui, UI Catalog | REFERENCE_ONLY | Check individual asset/font/media/trademark/source rights |
| [moonframe](https://github.com/bjo163/moonframe) | main | 8b9022e90901262e0cd570b1b0b8c289f4634afb | Components, skins, templates and CLI | Existing UI package/catalog | CLEAN_ROOM_REBUILD | No parallel UI system; human visual reviews incomplete |
| [rocksoul-ui](https://github.com/bjo163/rocksoul-ui) | main | c9170743e97dd447c660b20a0893cdd91a7ea5be | Design-to-component grammar | packages/ui | REFERENCE_ONLY | Compare with MoonFrame and target UI |
| [rocksoul-community](https://github.com/bjo163/rocksoul-community) | main | 012148a4e29904577ca60096dda3c528a37854b3 | Threads, source-aware proposals, saved cases, notifications | Board + workflow + notifications; new addon only if gap persists | RESEARCH_FIRST | Contributions remain non-canonical; identity bridge is not IAM authority |
| [moonsky](https://github.com/bjo163/moonsky) | main | 778829a77f50fccc809f34c35aea235ce56b5e07 | Inbox, Telegram/WhatsApp, REST/WebSocket, delivery tracking | orm-integration, orm-whatsapp, orm-notification, orm-storage | CLEAN_ROOM_REBUILD | Separate DB/operator identity must not become duplicate platform identity |
| [echolog](https://github.com/bjo163/echolog) | main | not captured | Object storage and sidecar metadata | Compare with orm-storage/provider | REFERENCE_ONLY | Avoid parallel storage metadata |
| [rocksoul-mftl](https://github.com/bjo163/rocksoul-mftl) | main | a70c4e39c835e1f9cd3941356e71d4232c164590 | Narrative/belief corpus, claims, evidence, uncertainty | Knowledge/Research/Story Workbench | CLEAN_ROOM_REBUILD | Keep Story distinct from Event and theological assertion |
| [rocksoul-legend](https://github.com/bjo163/rocksoul-legend) | main | 6e731b8106566ae44fd1cac7010a35fcfa59bf68 | Event reconstruction, source docs, evidence, uncertainty | Research/Knowledge | CLEAN_ROOM_REBUILD | Event is not later narrative |
| [rocksoul-superhero](https://github.com/bjo163/rocksoul-superhero) | main | e326b87fe31a8796d4f08bee57b4302fc4f1f999 | Person/actor, witness, authorship, transmission | Research identity/provenance | CLEAN_ROOM_REBUILD | No identity resolution from name similarity alone |
| [rocksoul-correlation](https://github.com/bjo163/rocksoul-correlation) | main | 86f88d6938251d3f7e264aaf3acf4a32f48c7b3e | Evidence graph, support, counter-evidence, confidence | Research/Knowledge graph | CLEAN_ROOM_REBUILD | Relation is not causation, identity or fulfillment |
| [rocksoul-aws](https://github.com/bjo163/rocksoul-aws) | main | f4248d1f1dc2a823346039eb8fa819bf4cda1a52 | Law, jurisdiction, applicability, authority | Research/Knowledge | REFERENCE_ONLY | Current jurisdictional/legal review required |
| [rocksoul-jizz](https://github.com/bjo163/rocksoul-jizz) | main | 5471233c8f0810d812f51b141fb47f8acfd988c8 | Perspective, framing, reaction over time | Research/Knowledge | CLEAN_ROOM_REBUILD | Perspective does not own underlying event/text |
| [rocksoul-game](https://github.com/bjo163/rocksoul-game) | main | cc625e7150b105fc8b701da8618ae312f0d4500b | 2D narrative game, quests, signals, archive restoration | Optional Public Web/Story experience | REFERENCE_ONLY | Preproduction; fiction distinct from testimony and revelation |
| [rocksoul-world](https://github.com/bjo163/rocksoul-world) | main | af5baed74b84570023dc796e6710353ae4f15a43 | Local-first Rust world runtime | Desktop/experience research | REFERENCE_ONLY | Inspect runtime value before adoption |
| [rocksoul-platform](https://github.com/bjo163/rocksoul-platform) | main | 510369123eb32917d87490f8a2736c4a0741b651 | IAM/admin product contracts | Reuse orm-base, auth, orm-organization, Board | DO_NOT_IMPORT | README indicates browser fixtures, not live IAM authority |
| [rocksoul-mind](https://github.com/bjo163/rocksoul-mind) | master | dadc82c4279fd9610f1492a58f16dcfead99f874 | MiniMind small-model training/teaching | Research reference only | DO_NOT_IMPORT | Upstream jingyaogong/minimind; audit license/provenance before reuse |
| [empire-of-the-light](https://github.com/bjo163/empire-of-the-light) | main | 85466a04e30752a84d6eb6dc88676a96df04dc90 | UNILEX vocabulary, source families, journey scopes | Knowledge ontology/docs | RESEARCH_FIRST | Proposed design, not production implementation |
| [AQEL](https://github.com/bjo163/AQEL) | main | a4ca2e0a40246d6f5ebf8c70e8a2dc9a49428f8c | Arabic-first language and semantic core | Experimental lab/archive | METADATA_ARCHIVE | Pre-release; compiler maturity and license require review |
| [antikythera-time](https://github.com/bjo163/antikythera-time) | main | ce4ffcf737fb0ddd0e4582fe2fa72132310086b2 | M-Time temporal/calendar research | Optional isolated Research module | REFERENCE_ONLY | External reproduction/review gates open; no religious authority decision |
| [moonwitness-memory](https://github.com/bjo163/moonwitness-memory) | main | a04ab00f730b4b8487174b159a185b85485e9ba4 | Local archive intake, original preservation, hashes, extraction | Private archive intake/Desktop | CLEAN_ROOM_REBUILD | Already archived; private conversations require scoped consent and retention controls |
| [moonwitness-reborn](https://github.com/bjo163/moonwitness-reborn) | main | dd8fc72883ac6183e4b2480b425450838671ee3b | Earlier TypeScript addon/agent platform | Architecture history | REFERENCE_ONLY | No parallel ORM/runtime |
| [moonwitness-xiv](https://github.com/bjo163/moonwitness-xiv) | main | ef6f125109b314993771e3b3ee973c47ccf9f5db | Metadata-driven monorepo lineage | Compare target architecture/history | REFERENCE_ONLY | Target XV is already chosen; avoid duplicate copy |
| [moonwitness](https://github.com/bjo163/moonwitness) | main | 7bc14f72765ef9648186e9e988578450f7477c8b | Older OS/dual-portal/UI experiments | Historical reference | METADATA_ARCHIVE | Extract individual ideas only when evidenced |

## Asmaul Husna data-quality gate

Source: [moonwitness-corpus dataset](https://github.com/bjo163/moonwitness-corpus/tree/main/datasets/asmaul-husna-99).

- README claims 99 entries, Arabic/transliteration/Indonesian/English, Qur'an references and CC0. Verify underlying sources and rights; a README assertion is not proof for every item.
- Top artifact metadata declares byte_size 32768 and SHA-256 e3b0c442...b855 (the digest of an empty byte sequence), while JSONL records are present. Recompute from exact source bytes before use.
- The reviewed #66–#74 order differs from the project-owner-selected profile (#67 Al-Aḥad, #68 Aṣ-Ṣamad, #69 Al-Qādir, #71–#74 Al-Muqaddim, Al-Mu’akhkhir, Al-Awwal, Al-Ākhir). Store that as a versioned list profile; do not silently overwrite variants.
- Prior review flagged #85/#86 Indonesian rendering duplication and #80 gloss for recheck.
- Keep Arabic source, transliteration, translation, commentary, personal note and AI explanation distinct.

## Full public inventory and limits

The companion CSV at inventory/bjo163-public-repositories.csv lists all 148 public repository metadata results from the owner search on 2026-11-22. It is not a full code, license, privacy, deployment or private-resource audit.

Other repositories have metadata-only dispositions until individually reviewed. Candidate groups include legacy MoonWitness prototypes; third-party AI/coding-agent forks; communication/media automation; ISP/infrastructure; data/platform forks; and unrelated experiments. Do not assume unrelated public repositories belong in MoonWitness or that public visibility grants usage rights.

README blob SHAs above are not repository commit SHAs. During actual archiving capture source HEADs, refs, tags and tree snapshots.

## Required next actions

1. Freeze/mirror public and private repos, branches, tags, LFS assets, issues, wiki, releases, Actions artifacts and package/container registries.
2. Resolve licenses, notices, trademarks, third-party provenance and private-data consent per source.
3. Reconcile each item with target packages; do not duplicate domain ownership.
4. Preserve exact source metadata and map each requirement to one target owner; use clean-room implementation only.
5. Do not create an import manifest or copy material under the current K0-006 decision. If an external artifact becomes necessary, reopen K0-006 and obtain source-specific rights/privacy approval before any byte is copied.
6. Add acceptance evidence to the existing roadmap/governance for each locally authored capability.
7. Retire the old owner only after the full preservation and retirement gates pass.
