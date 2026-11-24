Found during hourly audit:

**File(s):** packages/orm-income-ledger/src/adapters/*.ts, packages/orm-income-ledger/src/seed-manifest.ts, packages/orm-income-ledger/src/seed.ts
**Type:** rule-violation
**Suggestion:** Fix ESLint warnings:
- 7 adapter files: use `import type` for Context, IncomeEntry, IncomeStream
- seed-manifest.ts: remove unused imports (Context, IncomeStream), change `let skipped = 0` to `const skipped = 0`
- seed.ts: use `import type` for Context, IncomeStream