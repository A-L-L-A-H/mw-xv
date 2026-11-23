---
name: mw-boundaries
description: Read-only boundaries for agent-owned surfaces in the MoonWitness monorepo — packages/mcp-moonwitness and plugins/moonwitness must never define models/addons nor issue database writes. Use when writing or reviewing agent tooling, MCP server code, or plugin skills.
---

# MoonWitness Agent Boundaries

## Surfaces governed

- `packages/mcp-moonwitness/src/**`
- `plugins/moonwitness/**`

## Hard rules

1. NO `defineModel` calls. Models live in `packages/orm-*` only.
2. NO `defineAddon` calls. Manifests live in `packages/orm-*` only and are enumerated
   read-only through `apps/api/src/addons/registry.ts` `API_ADDONS[]`.
3. NO database write statements. Any SQL mutation verb (INSERT, UPDATE, DELETE) is forbidden
   in any source, template literal, or markdown under the governed surfaces.
   The MCP server executes SELECT queries exclusively.
4. The MCP server's write-denial layer is part of the contract:
   - `mw_query` filters out any field with `kind === 'password'` and any field name matching
     `/password|secret|token|hash/i` before returning rows.
5. Enforcement gate: `pnpm agent:boundary:check`
   (`node --test scripts/check-addon-agent-boundary.test.mjs && node scripts/check-addon-agent-boundary.mjs`).
   It must pass before any commit touching the governed surfaces.

## If a violation appears

Fix at the source: move model/addon definitions into the appropriate `packages/orm-*`
package and register them in `apps/api/src/addons/registry.ts`. Never widen the gate's
allowlists — `LEGACY_WRITE_ALLOWLIST` must remain empty per learned invariants.
