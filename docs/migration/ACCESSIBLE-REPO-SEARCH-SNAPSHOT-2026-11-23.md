# Accessible GitHub Repository Search Snapshot — 2026-11-23

**Target:** `A-L-L-A-H/mw-xv`  
**Source namespace:** `bjo163/*`  
**Status:** `FACT` — read-only metadata search through the linked GitHub connection  
**Related work:** [Issue #27 — source consolidation](https://github.com/A-L-L-A-H/mw-xv/issues/27)  
**Existing public inventory:** [bjo163-public-repositories.csv](inventory/bjo163-public-repositories.csv)

## Search result

A paginated GitHub repository search for `user:bjo163` was run on 2026-11-23:

| Page | Results |
|---|---:|
| 1 | 100 |
| 2 | 100 |
| 3 | 80 |
| 4 | 0 |
| **Total** | **280 unique repositories** |

There were no duplicate repository names across the three non-empty result pages.

| Visibility | Search results |
|---|---:|
| Public | 148 |
| Private | 132 |
| **Total** | **280** |

## Cross-check against the existing public inventory

- The repository's existing public inventory contains **148 repository rows**.
- All 148 names were present in the live search results.
- No public inventory row was missing from the live search.
- The current search exposed an additional **132 private repositories** to the linked GitHub connection. Their names are intentionally not repeated in this public snapshot.

## Scope and confidence

This verifies the repository metadata returned by the GitHub search interface available to this session. It does **not** prove that every historical repository, deleted repository, transfer, organization-owned repository, Git LFS object or external resource is included.

This snapshot does not inspect or export:
- gists, discussions, wikis or deleted repositories;
- Git LFS objects, releases, package registries or container images;
- GitHub Pages, Actions artifacts, webhooks, secrets, deployments or DNS;
- local-only working copies, backups, generated media or external storage;
- every branch, tag, commit tree, issue, PR and license for all 280 repositories.

The 148-row public CSV remains the public metadata inventory. The 132 private repository names and content remain private; do not copy them into public documentation or mirror their source bytes as part of this snapshot.

## Relationship to current migration policy

The owner-approved K0-006 decision remains in force: no legacy code, corpus records, prompts, fixtures, assets or private archive content may be imported into MW-XV under the current scope. A repository being visible or public does not grant redistribution rights. The existing source matrix's dispositions remain reference / clean-room / research decisions, not migration completion.

## Next P0 work in Issue #27

1. Record exact default-branch HEAD, all branch refs and tags for each in-scope repository.
2. Determine whether owner-controlled mirrors, Git LFS objects and independent restore copies exist.
3. Account for private repos and non-repository resources without exposing private names publicly.
4. Export repository metadata and discussion history under a defined retention and rights scope.
5. Record licenses, third-party notices, privacy constraints and deployment dependencies.
6. Keep the old namespace read-only until preservation and retirement gates pass.

**No source repository was modified, mirrored, archived, deleted or migrated during this search.**
