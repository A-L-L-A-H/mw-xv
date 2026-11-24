# Models and addons are defined ONLY in packages/orm-*

- ORM models (`defineModel`) and addon manifests (`defineAddon`) are defined ONLY inside
  workspace addon packages under `packages/orm-*`.
- Every addon manifest is registered ONLY via `apps/api/src/addons/registry.ts`
  `API_ADDONS[]`. Nothing else wires models, addons, or custom routes into the API.
- Custom HTTP routes exist ONLY as `manifest.httpPlugins` entries inside `packages/orm-*`
  packages. New files under `apps/api/src/routes/` are forbidden.
- Agent-owned surfaces (`packages/mcp-moonwitness/src/**`, `plugins/moonwitness/**`) must
  contain zero `defineModel`/`defineAddon` calls and zero write SQL statements (any SQL
  mutation verb: INSERT, UPDATE, DELETE). They enumerate and query read-only.
- Enforcement: `pnpm api:addon:check` (API side) and `pnpm agent:boundary:check`
  (agent side). Allowlists in both gates stay empty; fix violations at the source.
