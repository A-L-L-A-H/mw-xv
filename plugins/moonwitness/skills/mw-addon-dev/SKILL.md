---
name: mw-addon-dev
description: Develop MoonWitness addon packages correctly — models, manifests, and HTTP plugins live ONLY in packages/orm-* workspace packages and are registered via apps/api/src/addons/registry.ts API_ADDONS[]. Use when creating or extending an addon, defining models, or exposing custom routes.
---

# MoonWitness Addon Development

## Non-negotiable placement rules

- ORM models are defined ONLY inside workspace addon packages under `packages/orm-*`.
- Addon manifests (`defineAddon({ name, models, httpPlugins, ... })`) are defined ONLY in
  `packages/orm-*` packages.
- Custom HTTP routes are defined ONLY as `manifest.httpPlugins` entries inside a
  `packages/orm-*` addon package. Never create route files under `apps/api/src/routes/`.
- Registration happens ONLY in `apps/api/src/addons/registry.ts` via the `API_ADDONS[]` array.
  Add your package's manifest export to that array; do not wire routes or models anywhere else.

## Workflow

1. Scaffold or locate the addon package under `packages/orm-*` (follow `packages/orm-base`
   conventions: type module, `exports: ./dist/index.js`, `build=tsc`,
   `test = tsc -p tsconfig.check.json && vitest run`, tsconfig extends `../../tsconfig.base.json`).
2. Define models with `defineModel('<addon>.<entity>', { fields: { ... } })`.
   Static `modelName` values follow the `addon.entity` convention (e.g. `base.user`).
3. Export the addon manifest via `defineAddon({...})` from the package entrypoint.
4. Register the manifest in `apps/api/src/addons/registry.ts` `API_ADDONS[]`.
5. Verify: `pnpm api:addon:check` must pass. `apps/api/src` must contain zero
   `defineModel`/`defineAddon` calls and zero `BaseModel` subclasses.

## Forbidden

- `defineModel` or `defineAddon` anywhere outside `packages/orm-*`.
- `BaseModel` subclasses outside `packages/orm-*`.
- New files under `apps/api/src/routes/`.
- Direct `./routes/*` imports in `apps/api/src/app.ts`.
