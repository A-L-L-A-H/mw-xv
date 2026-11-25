Found during hourly audit:

**File(s):** packages/orm-income-ledger/src/**/*.ts
**Type:** rule-violation
**Suggestion:** Fix missing imports and type errors:

- `Context` not exported from `@moonwitness/orm` (used in 8 files)
- `relations` not exported from `@moonwitness/orm` (models/index.ts)
- `BaseModel` not exported from `@moonwitness/orm-base` (models/index.ts)
- `createContext` not exported from `@moonwitness/orm` (tests/manifest.test.ts)
- `AddonHttpPlugin` type doesn't accept `name` property (http-plugin.ts)
- `AddonModel` type mismatch for all 5 models (manifest.ts)
- `Addon` type doesn't have `namespace` or `seed` properties (manifest.ts, test)
- Implicit `any` types in http-plugin.ts route handlers
