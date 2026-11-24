# Domain Ownership and Reuse Map

Status: proposed consolidation contract. Reconcile with accepted ADRs before treating this as schema authorization. Prepared: 2026-11-22.

## Ownership rule

Every canonical data class has exactly one owner. Other packages may reference it, project a read model, or store a derived artifact, but must not become a second authority.

The API remains a thin assembly and HTTP boundary. Durable domain models belong in programmatic workspace addons installed through the existing ORM. Do not create a second ORM, shadow database, traditional migration stream or duplicate AI runner.

## Ownership and first target to inspect

| Domain | Reuse or extend first | Experience | Boundary |
|---|---|---|---|
| Identity, user, company, access | orm-base, auth, orm-organization | Board / API | No legacy local IAM as second authority |
| Project, task, milestone | orm-project, orm-workflow, jobs | Board / Desktop | Reuse before another project system |
| Source bytes, editions, passage locators | corpus, orm-storage | Research / Board | Rights checked separately; source bytes immutable |
| Claims, evidence, provenance, concepts | knowledge, research, orm-knowledge | Research / Board | Separate source facts, claims, assessment and interpretation |
| Story / narrative | Knowledge, Research, Story Workbench | Board / Creation | A story is not automatically an event |
| Event reconstruction | Research / Knowledge | Research | Evidence, counter-evidence, provenance, uncertainty |
| Person, author, witness, transmitter | Research / ORM Knowledge after model review | Research | Source-scoped identity; no alias guessing |
| Law / regulation | Research / Knowledge | Research | Record jurisdiction and authority; not legal advice |
| Perspective / framing | Research | Research | Perspective is not ownership of the phenomenon |
| Cross-domain relation | Research / Knowledge graph | Research | Similarity is not causation or identity |
| Content projects / series / entries | orm-project, orm-workflow, Story Workbench | Board / Public Web | Separate brief, source refs, artifact, revision and publication |
| Artwork / media | packages/assets, packages/ui, UI Catalog, orm-storage | Board / Public Web / Desktop | Artwork-first; rights and attribution required |
| Community participation | Existing identity, project, workflow and notification foundations | Board / Public Web | Proposals start non-canonical; review before knowledge promotion |
| Messaging / channels | orm-integration, orm-whatsapp, orm-notification, orm-storage | Board / Desktop | Channel/operator identity separate from platform identity |
| AI agents / work contracts | orm-ai, ai-runtime, ai-mcp, ai-evaluation, jobs/workflow | Desktop / Board | Capability grants, tenant scope, proof and independent review |
| Private archives | Corpus private intake only under approved policy; ORM Storage | Desktop / Board | Consent, privacy, retention, revocation and tenant scope |
| Temporal/calendar research | Research or isolated optional package after external review | Research | Separate astronomy, calendar criteria, rukyat, jurisdiction and authority |
| Ontology / vocabulary | Knowledge / Research contracts | Research / docs | Reuse only after semantics, scope and rights review |

## Existing target capabilities to reuse

- packages/corpus: deterministic offline JSON ingestion, byte-pinned recipes, immutable releases, raw-artifact hashes and a pinned Qur'an passage sample.
- packages/knowledge and packages/research: source-grounded knowledge and research.
- packages/orm-knowledge: synthetic-only witness models and an early graph storage pilot; this does not authorize real testimony intake.
- packages/orm-project and packages/orm-workflow: project and workflow foundations.
- packages/orm-integration, packages/orm-notification and packages/orm-whatsapp: compare before adopting MOONSKY.
- packages/orm-storage and packages/assets: storage and asset foundations.
- packages/orm-ai, packages/ai-runtime, packages/ai-mcp and packages/ai-evaluation: AI workforce foundation.
- apps/api/src/addons/registry.ts: canonical API addon assembly.
- apps/board: management experience with Story Workbench routes.
- apps/desktop: existing native Tauri workbench; extend rather than introducing another agent runner.
- apps/ui-catalog and packages/ui: component and visual review surface.

Do not infer completeness from a directory name. Verify implementation, package contracts, access policy and tests at the exact candidate commit.

## New package decision rule

Create an addon only when a durable responsibility is not owned by an existing addon, a concrete use case proves a model/API gap, extending the current owner would violate a real boundary or become unsafe, the package has owner/manifest/access/docs/tests/upgrade compatibility, and it does not create a second source of truth.

## Content boundaries

For religious material, preserve exact source, edition, verse locator, translation, commentary, personal note and AI explanation as separate records. Never attribute personal interpretation to revelation. Asmaul Husna numbering must be versioned as a named list/profile; a project-selected sequence may coexist with other scholarly variants rather than rewriting source records.

For historical research, do not turn testimony into fact without corroboration. For legal content, record jurisdiction, force, applicability date and authority. For astronomy/calendar research, do not turn a computed result into a religious authority decision.

Before publication, require source/edition, locator and byte/text verification, license/rights and attribution, reviewer and timestamp, uncertainty/disagreement, content-type label, publication scope and takedown/revocation path.
