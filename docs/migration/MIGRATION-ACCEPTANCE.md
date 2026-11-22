# Migration Acceptance and Legacy Retirement Gates

Prepared: 2026-11-22. Status: operational checklist. Target: A-L-L-A-H/mw-xv. Legacy owner intended for retirement: bjo163.

## Non-negotiable rules

- Do not delete repositories, account data, packages or deployment resources until all gates pass.
- Preserve source commit, branch, tag and blob identity. README blob SHA is not a repository commit.
- The 148-row inventory covers public owner-search results only. Check private repos, gists, packages, container registries, Pages, Actions artifacts, secrets, deployments and local-only assets.
- Do not copy unknown-license assets, third-party code, credentials, private data or personal conversations by default.
- Reuse target ORM/addons, auth, workflow, storage, research, AI runtime and UI before adding systems.
- Keep sources read-only. Do not rewrite source history.
- Follow protected-branch, CODEOWNER and repository governance gates; no bypass.

## P0 — Freeze and archive

- [ ] Record owner/name, URL, visibility, archive state, default branch, every branch head, tags/releases and exact HEAD SHA.
- [ ] Create an owner-controlled mirror with all refs; verify object connectivity and restore.
- [ ] Capture LFS pointers and actual objects.
- [ ] Export docs, issues, PRs/comments, wiki, discussions, releases, workflows and required artifacts.
- [ ] Record package registries, containers, Pages, deploy URLs, webhooks and dependencies.
- [ ] Record licenses, notices, authorship, copyright/trademark and data rights.
- [ ] Produce SHA-256 manifests for archives and binaries.
- [ ] Store copies in at least two controlled locations and test restoration.
- [ ] Mark failed exports BLOCKED with owner and reason.

Exit: all public/private repos and external artifacts are accounted for; snapshots/checksums are restorable; unresolved items block retirement.

## P1 — Target reconciliation

- [ ] Inspect target dev contracts and package/app inventory at exact candidate SHA.
- [ ] Map each source item to one canonical target domain.
- [ ] Record disposition: ADAPT, ADOPT_SELECTIVELY, REFERENCE_ONLY, RESEARCH_FIRST, ARCHIVE or DO_NOT_IMPORT.
- [ ] Prove each new addon addresses a real gap and does not duplicate orm-*, IAM, storage or AI runtime.
- [ ] Preserve original data separately from normalized/derived records.
- [ ] Verify access policy, tenant scope, audit, retention, revocation/takedown and API surfaces before import.
- [ ] Create target import manifest with source repo/ref/commit/path/hash, rights evidence, transformation and destination.
- [ ] Keep private witness/account/child/conversation data out of public corpus unless approved policy and scoped consent exist.

Exit: every import has provenance and reviewable destination; no unresolved high-risk rights/privacy issue.

## P2 — Data and content

- [ ] Run deterministic dry-run against pinned snapshot.
- [ ] Validate schema, unique IDs, references, encodings and required metadata.
- [ ] Recompute checksums and byte lengths from actual bytes.
- [ ] Separate original text, edition, locator, translation, paraphrase, annotation, interpretation and AI summary.
- [ ] Record conflicts, duplicates, missing sources and uncertainty; do not silently auto-resolve.
- [ ] Rebuild from source and prove deterministic digest matches.
- [ ] Apply rights/publication policy before public activation.
- [ ] Obtain human review of sample records.

Exit: deterministic replay, integrity, quality and rights acceptance pass.

## P3 — Code and asset integration

- [ ] Compare code with target interfaces; prefer bounded adapter/port over bulk copy.
- [ ] Complete license/notices review for upstream/fork-derived code.
- [ ] Run security and dependency scans on selected source commit.
- [ ] Remove secrets, personal data, test credentials and unsafe local paths.
- [ ] Define owner, tests, API contracts, RBAC/tenant rules, observability and rollback.
- [ ] Run relevant unit, integration, PostgreSQL, API, UI/Chromium and security tests.
- [ ] Prove no runtime import, submodule, package, CI fetch, webhook or deploy needs a retiring source.
- [ ] Preserve source commit/path and transformation history.

Exit: exact-SHA checks pass, no unapproved dependency remains, rollback is proven.

## P4 — Experience readiness

- [ ] Board exposes workspaces and clear review/publication status.
- [ ] Desktop provides scoped permissions and verifiable agent evidence.
- [ ] Artwork-first assets render; no 3D prerequisite introduced.
- [ ] Community submissions remain non-canonical until reviewed.
- [ ] Messaging uses platform identity correctly and separates channel operators from user identity.
- [ ] Published content has sources, rights, uncertainty and revision history.

## P5 — Retire bjo163 only after all checks

- [ ] Every 148 public repository records has final disposition.
- [ ] Private repos and non-repository resources accounted for.
- [ ] Mirror archives and recovery copies restore successfully.
- [ ] Requirements, docs, datasets, assets, issues and accepted code have disposition.
- [ ] No DNS, website, service, webhook, CI/CD, package consumer, container, submodule or external link depends on old resources.
- [ ] Rotate/revoke required credentials and deployment secrets.
- [ ] Redirect/document public URLs and communicate deprecation.
- [ ] Confirm ownership and administrative consequences.
- [ ] Obtain explicit owner approval for closure.

Exit: owner approval and evidence are recorded. Until then, keep old owner intact; archive individual repositories only after their own gates pass.

## Evidence record

For every imported item record:
- source repository, ref, exact commit, path and Git blob SHA;
- SHA-256 of exported bytes;
- SPDX license or unknown status, attribution and rights evidence;
- disposition and target path;
- transformation type, reviewer, test commands, target commit and acceptance status.

A repository is migrated only when target commit, import manifest, test evidence and rights/privacy decisions are complete and the target has no hidden dependency on source.

A repository is retired only after its checklist passes and an authorized owner performs the archival/closure action. A plan is not a completed migration.
