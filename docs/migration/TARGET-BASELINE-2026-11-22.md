# Target Baseline Snapshot

Prepared: 2026-11-22. Repository: A-L-L-A-H/mw-xv. Branch: dev. HEAD observed before this docs batch: 0b0d0a54609148fddd875204be7a8e0e5e365eb4.

## Verified from target files

- README describes a TypeScript monorepo centered on the MoonWitness ORM, programmatic addons, PostgreSQL, Fastify API, Next.js Board, jobs/scheduler/outbox, storage, knowledge and AI.
- apps/api/src/addons/registry.ts assembles base, auth, jobs, integration, WhatsApp, request, notification, organization, project, CRM, sales, subscription, workflow, knowledge, storage, ISP, cloud and AI addons; it also registers research, Story Workbench, privacy, publication and AI routes.
- packages/corpus documents deterministic offline JSON ingestion, SHA-256-pinned recipes and a pinned local Qur'an passage sample; it does not infer source rights.
- packages/orm-knowledge states witness examples are synthetic-only; real testimony is gated on authorization, intake, privacy and retention.
- packages/orm-ai documents work contracts, capability grants, runs, artifact manifests, obligations, taskforces and memory candidates.
- Root ROADMAP reported 82 open checklist cards on 2026-11-22. This is a roadmap count, not a feature-completeness score.
- README badges say Node.js 22, while root package.json declares engines.node 24.x; reconcile docs/toolchain policy.

## Source references

- https://github.com/A-L-L-A-H/mw-xv/blob/dev/README.md
- https://github.com/A-L-L-A-H/mw-xv/blob/dev/apps/api/src/addons/registry.ts
- https://github.com/A-L-L-A-H/mw-xv/blob/dev/packages/corpus/README.md
- https://github.com/A-L-L-A-H/mw-xv/blob/dev/packages/orm-knowledge/README.md
- https://github.com/A-L-L-A-H/mw-xv/blob/dev/packages/orm-ai/README.md
- https://github.com/A-L-L-A-H/mw-xv/blob/dev/ROADMAP.md
- https://github.com/A-L-L-A-H/mw-xv/blob/dev/package.json

This is a documentation-level baseline, not a local build, complete code audit, legal opinion or hosted CI result.
