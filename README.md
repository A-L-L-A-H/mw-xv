# mw-xv — MoonWitness board and execution engine

**Repository:** [`A-L-L-A-H/mw-xv`](https://github.com/A-L-L-A-H/mw-xv) · **Stack:** TypeScript · Bun (1.4.5) · Node 24 · Fastify · Next.js · PostgreSQL/SQLite

## What it does

Metadata-driven business monorepo: declarative models and addons generate REST and JSON-RPC APIs, a Next.js board, Moon City visual universe, job workers, and planning/operations tooling.

## Quick start

```bash
cp .env.example .env
# Start PostgreSQL (or docker compose -f deploy/compose/docker-compose.yml up -d postgres) and set JWT_SECRET in .env
bun install
bun run build
bun run dev
```

## Verify

```bash
bun test
bun run typecheck
bun run verify
```

## Configuration

- **Ports:** API `3000`, board `5173`, desktop API `4242`; the fleet manifest publishes `3001`.
- **Key configuration:** PostgreSQL connection, RID OIDC settings, WhatsApp drivers (`cloud-api` / `baileys` / `gowa`, `WHATSAPP_ALLOW_UNOFFICIAL_IN_PROD=true` default), and service URLs in `.env.example`.

## Notes

The README keeps the maintained summary aligned with the active workspace (`2` apps, `59` packages). Run `bun run preflight:fast` for fast local static boundary checks before pushing.

---

## Active workspace reference

Monorepo version: `1.0.0-rc.1` · Package manager: `bun@1.4.5`

### Applications (`apps/*`)

| App          | Package              | Scripts                                                                                                                                                                     |
| ------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`   | `@moonwitness/api`   | `attachments:reconcile`, `build`, `db:migrate`, `dev`, `jobs:outbox`, `jobs:scheduler`, `jobs:worker`, `reset:superadmin-password`, `revoke:auth-sessions`, `start`, `test` |
| `apps/board` | `@moonwitness/board` | `build`, `dev`, `lint`, `preview`, `start`, `start:built`, `typecheck`                                                                                                      |

### Packages (`packages/*` — 59 total)

- **Core & Runtime:** `@moonwitness/types`, `@moonwitness/logger`, `@moonwitness/auth`, `@moonwitness/client`, `@moonwitness/jobs`, `@moonwitness/orm`, `@moonwitness/orm-base`, `@moonwitness/orm-cli`, `@moonwitness/ui`, `@moonwitness/assets`, `@moonwitness/eslint-config`
- **AI, Knowledge & Research:** `@moonwitness/ai-evaluation`, `@moonwitness/ai-mcp`, `@moonwitness/ai-runtime`, `@moonwitness/local-ai`, `@moonwitness/knowledge`, `@moonwitness/corpus`, `@moonwitness/research`, `@moonwitness/mcp-moonwitness`, `@moonwitness/pack-ai`
- **Domain & Vertical Add-ons:** `orm-a2a`, `orm-accounting`, `orm-ai`, `orm-automation-core`, `orm-bot-orchestrator`, `orm-catalog`, `orm-clinical`, `orm-cloud`, `orm-compliance`, `orm-content-factory`, `orm-crm`, `orm-ecommerce-sync`, `orm-governance`, `orm-helpdesk`, `orm-hr`, `orm-identity`, `orm-income-ledger`, `orm-integration`, `orm-inventory`, `orm-isp`, `orm-knowledge`, `orm-notification`, `orm-observability`, `orm-organization`, `orm-project`, `orm-public-services`, `orm-request`, `orm-rnd`, `orm-sales`, `orm-sensor`, `orm-sharia`, `orm-signal`, `orm-sim`, `orm-storage`, `orm-subscription`, `orm-whatsapp`, `orm-workflow`, `@moonwitness/pack-verticals`, `paas-template-pack-moonwitness`

Root commands: `bun run api:addon:check`, `bun run agent:boundary:check`, `bun run architecture:check`, `bun run attachments:reconcile`, `bun run automation:check:action-pins`, `bun run automation:check:action-tags`, `bun run automation:check:secrets`, `bun run board:budget`, `bun run board:ui:check`, `bun run build`, `bun run ci:affected`, `bun run db:migrate`, `bun run dev`, `bun run dev:api`, `bun run dev:board`, `bun run evolution:check`, `bun run format`, `bun run format:check`, `bun run hooks:install`, `bun run jobs:outbox`, `bun run jobs:scheduler`, `bun run jobs:worker`, `bun run lint`, `bun run lint:fix`, `bun run lint:ui`, `bun run node:parity`, `bun run plan:lint`, `bun run plan:mcp`, `bun run plan:next`, `bun run plan:reindex`, `bun run plan:sync`, `bun run preflight:fast`, `bun run prepare`, `bun run reset:superadmin-password`, `bun run revoke:auth-sessions`, `bun run standard:check`, `bun run start`, `bun run start:built`, `bun run test`, `bun run test:e2e:visual`, `bun run test:ui`, `bun run test:unit`, `bun run test:unit:built`, `bun run test:unit:ci`, `bun run typecheck`, `bun run ui:check`, `bun run ui:design:audit`, `bun run ui:design:check`, `bun run ui:design:report`, `bun run verify`.

Centralized developer guides live in [`mw-docs`](../mw-docs/mw-xv/guide/index.md).
