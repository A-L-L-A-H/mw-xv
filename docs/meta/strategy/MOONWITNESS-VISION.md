# MoonWitness — Product Vision

Status: approved direction for consolidation; implementation remains staged. Prepared: 2026-11-22.

## Product thesis

**MoonWitness is a source-grounded knowledge, creation, and collaboration platform.** It helps people preserve records, understand context, relate evidence, create meaningful work, and collaborate without losing provenance or confusing machine-generated suggestions with human decisions.

Historical projects become domain experiences inside one platform, not competing products: MoonWitness Corpus/RGBL, ROCKSOUL research, GOD PROMISE, MoonWitness Radio, community collaboration, engineering tools, AI and communications.

## Four platform verbs

1. **PRESERVE** — keep originals, editions, artifacts, rights, checksums, attribution and revision history.
2. **UNDERSTAND** — organize claims, context, evidence, counter-evidence, uncertainty and interpretation.
3. **CREATE** — turn approved or clearly labeled material into articles, stories, posters, comics, artwork, audio, video and interactive experiences.
4. **CONNECT** — let people, teams, projects, channels and bounded AI capabilities collaborate under explicit access rules.

## Product layers

### Foundation

One canonical data and operations layer: ORM, addon registry, identity/access, tenant boundaries, storage metadata, audit, jobs, workflow, outbox, integration and notifications.

### Domains

- **Corpus:** source artifacts, works, editions, passages and ingestion recipes.
- **Knowledge:** claims, evidence, provenance, concepts and research records.
- **Research:** review, comparison, uncertainty, witness handling and explainable relations.
- **Creation:** projects, series, entries, briefs, artifacts, revisions and publication.
- **Community:** profiles, discussion, contributions, proposals and moderation.
- **Communication:** channel adapters, messages, inbox and delivery events.
- **AI Workforce:** bounded agents, work contracts, capabilities, evidence, evaluation and obligations.

Domain boundaries define responsibility; they do not require a new package for each concept.

### Experiences

- **Board:** administration, projects, research, review and content management.
- **Desktop:** local-first engineering and AI workbench.
- **Public Web:** discovery and reading.
- **Radio / Messaging:** publishing and communication using approved channel adapters.

## Product principles

1. One canonical platform and one authoritative owner for each data class.
2. Reuse existing addons and packages before adding a model, runtime or service.
3. Preserve source provenance and rights; unknown rights mean no redistribution of source bytes.
4. Separate original text, translation, paraphrase, interpretation, personal notes and AI suggestions.
5. Correlation is not causation; similarity is not identity; testimony is not automatically a verified event.
6. Human review remains explicit for consequential decisions and publication.
7. AI work is bounded by capability grants, tenant scope, work contracts, budgets, expiry and verifiable acceptance.
8. Preserve original files and hashes; derived artifacts link to sources.
9. Prefer artwork-first 2D assets (SVG, PNG, APNG, WebM, Lottie and approved audio). 3D is optional, never a prerequisite.
10. A plan, README, checkbox or model self-report is not proof that a feature works. Record exact commit and test evidence.

## What MoonWitness is not

- An automatic authority declaring ultimate religious, historical, scientific or legal truth.
- An AI preacher, judge or unreviewable decision engine.
- A reason to duplicate ORM, IAM, storage, AI runtime, workflow, message store or UI framework.
- A bulk importer of every legacy repository.
- A guarantee that all source material is licensed for redistribution.
- Production-certified merely because a repository has a release-candidate label.

## Product families

| Family               | Examples                                             | Canonical treatment                                             |
| -------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Knowledge            | RGBL, Key Witness, source corpus                     | One corpus/knowledge/research pipeline                          |
| Creative collections | GOD PROMISE, ROCKSOUL, MoonWitness Radio             | Collections/projects within Creation                            |
| Evidence domains     | Story, Event, Person, Law, Perspective, Relationship | Typed records and relations in Research/Knowledge               |
| Collaboration        | Community, contributions, discussions                | Participation workflow, separate from research truth            |
| Engineering          | ROCKSOUL FLOW, Repo Radar, Plan Forge, Proof Gate    | Capabilities in existing Desktop / AI Runtime                   |
| Communications       | MOONSKY, Telegram/WhatsApp                           | Existing integration/notification/channel capabilities first    |
| Time research        | Antikythera / M-Time                                 | Optional bounded research module; preserve authority boundaries |

## Success criteria

Every in-scope source has an immutable inventory and disposition; each imported artifact has source repository, commit, path, rights decision and digest; each domain has one canonical owner; target packages are reused unless a documented gap justifies an addition; AI output is traceable; no legacy service or dependency is silently required; and old repositories are retired only after the migration acceptance gates pass.
