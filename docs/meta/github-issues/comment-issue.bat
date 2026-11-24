@echo off
cd /d z:\repo\mw-xv
gh issue comment 208 --repo A-L-L-A-H/mw-xv --body "orm-income-ledger adds 10 more lint warnings: consistent-type-imports (7 adapters + seed.ts + seed-manifest.ts), no-unused-vars (seed-manifest.ts: Context, IncomeStream), prefer-const (seed-manifest.ts: skipped). All fixable."