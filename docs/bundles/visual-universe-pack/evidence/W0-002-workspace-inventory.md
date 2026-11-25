# W0-002 — Workspace inventory

Source: current `pnpm-workspace.yaml`, package manifests, and `pnpm -r list --depth -1` on 2026-11-25. The workspace has 26 packages and nine pnpm apps. `apps/todo` was retired (see ADR 0008); current apps: `apps/api`, `apps/board`, `apps/desktop`, `apps/docs`, `apps/ui-catalog`, `apps/agent-observability`, `apps/agent-sandbox`, `apps/control-plane`, `apps/isp`. Root scripts/CI are not counted as packages.

## Apps

| App               | Workspace package         | Visual relevance                                      |
| ----------------- | ------------------------- | ----------------------------------------------------- |
| `apps/api`        | `@moonwitness/api`        | API and addon lifecycle; no visual runtime dependency |
| `apps/board`      | `@moonwitness/board`      | Product UI; depends on assets, client, types, UI      |
| `apps/desktop`    | `@moonwitness/desktop`    | Tauri desktop client; no assets/UI dependency         |
| `apps/docs`       | `@moonwitness/docs`       | Documentation site; depends on assets and UI          |
| `apps/ui-catalog` | `@moonwitness/ui-catalog` | Existing UI catalog; depends on assets and UI         |

## Packages

`@moonwitness/ai-evaluation`, `@moonwitness/ai-mcp`, `@moonwitness/ai-runtime`, `@moonwitness/assets`, `@moonwitness/auth`, `@moonwitness/client`, `@moonwitness/corpus`, `@moonwitness/eslint-config`, `@moonwitness/jobs`, `@moonwitness/knowledge`, `@moonwitness/local-ai`, `@moonwitness/logger`, `@moonwitness/orm`, `@moonwitness/orm-ai`, `@moonwitness/orm-base`, `@moonwitness/orm-integration`, `@moonwitness/orm-knowledge`, `@moonwitness/orm-notification`, `@moonwitness/orm-organization`, `@moonwitness/orm-request`, `@moonwitness/orm-storage`, `@moonwitness/orm-whatsapp`, `@moonwitness/orm-workflow`, `@moonwitness/research`, `@moonwitness/types`, `@moonwitness/ui`.

## Visual package edges

- `@moonwitness/board` → `@moonwitness/assets`, `@moonwitness/ui` (plus client/types).
- `@moonwitness/docs` → `@moonwitness/assets`, `@moonwitness/ui`.
- `@moonwitness/ui-catalog` → `@moonwitness/assets`, `@moonwitness/ui`.
- No ORM/API/desktop dependency on the visual packages was found in current manifests.
- The catalog already exists; no second catalog/package is justified. No scene runtime package is justified by the current single production consumer (`apps/board`).

## Direct workspace dependency graph

The following are all direct `workspace:*` edges read from current package manifests. Packages omitted from this list have no workspace dependency.

- `@moonwitness/api` → `ai-runtime`, `auth`, `client`, `corpus`, `jobs`, `knowledge`, `local-ai`, `logger`, `orm`, `orm-ai`, `orm-base`, `orm-integration`, `orm-knowledge`, `orm-notification`, `orm-organization`, `orm-request`, `orm-storage`, `orm-whatsapp`, `orm-workflow`, `research`, `types`.
- `@moonwitness/board` → `assets`, `client`, `types`, `ui`.
- `@moonwitness/desktop` → `ai-mcp`, `ai-runtime`, `jobs`, `logger`, `orm`, `orm-ai`, `orm-base`, `orm-knowledge`, `orm-notification`, `orm-organization`, `orm-storage`, `orm-workflow`, `types`.
- `@moonwitness/docs` → `assets`, `ui`.
- `@moonwitness/ui-catalog` → `assets`, `ui`.
- `@moonwitness/ai-evaluation` → `ai-runtime`, `orm-ai`, `types`.
- `@moonwitness/ai-mcp` → `ai-runtime`, `orm`, `orm-ai`, `orm-base`, `orm-knowledge`, `types`.
- `@moonwitness/ai-runtime` → `logger`, `orm-integration`, `types`.
- `@moonwitness/auth` → `orm`, `orm-base`.
- `@moonwitness/client` → `types`.
- `@moonwitness/corpus` → `knowledge`.
- `@moonwitness/jobs` → `orm`, `orm-base`.
- `@moonwitness/orm` → `types`.
- `@moonwitness/orm-ai` → `jobs`, `orm`, `orm-base`, `orm-organization`, `orm-storage`, `orm-workflow`.
- `@moonwitness/orm-base` → `orm`, `types`.
- `@moonwitness/orm-integration` → `jobs`, `orm`, `orm-base`, `types`.
- `@moonwitness/orm-knowledge` → `corpus`, `jobs`, `knowledge`, `orm`, `orm-base`, `orm-notification`, `orm-workflow`, `research`.
- `@moonwitness/orm-notification` → `jobs`, `orm`, `orm-base`, `types`.
- `@moonwitness/orm-organization` → `orm`, `orm-base`.
- `@moonwitness/orm-request` → `jobs`, `orm`, `orm-base`, `orm-notification`, `orm-workflow`.
- `@moonwitness/orm-storage` → `orm`, `types`.
- `@moonwitness/orm-whatsapp` → `orm`, `orm-base`.
- `@moonwitness/orm-workflow` → `jobs`, `orm`, `orm-base`, `orm-notification`, `types`.
- `@moonwitness/research` → `knowledge`.

Verification:

- `pnpm -r list --depth -1` — exit 0.
- `pnpm-workspace.yaml` and root/package manifests inspected — exit 0.
- Workspace-local dependency edges were collected from all app/package manifests; lists above show all visual edges relevant to this project.
- The direct-edge list above covers all workspace packages and apps.
