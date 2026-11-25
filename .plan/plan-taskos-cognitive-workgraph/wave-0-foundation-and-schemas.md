# Wave 0 — Foundation, Packaging & Schemas (`T01`–`T05`)

**ADR Reference:** `.plan/plan-taskos-cognitive-workgraph/ADR-003-plan-taskos-cognitive-workgraph.md` (Decisions 1, 2, 7)
**Rule:** Execute 1 micro-task -> verify -> check `[x]` here & Master -> atomic `git commit --only`.

---

## - [x] T01 — Scaffold `packages/plan-taskos` Package Manifest & Update `.gitignore`

- **Owner File(s):** `packages/plan-taskos/package.json`, `packages/plan-taskos/tsconfig.json`, `packages/plan-taskos/tsconfig.check.json`, `packages/plan-taskos/vitest.config.ts`, `.gitignore`
  - `packages/plan-taskos/package.json` (CREATE)
  - `packages/plan-taskos/tsconfig.json` (CREATE)
  - `packages/plan-taskos/tsconfig.check.json` (CREATE)
  - `packages/plan-taskos/vitest.config.ts` (CREATE)
  - `.gitignore` (MODIFY — append `.plan/.brain/` and `.plan/*/.leases.local.json`)
- **Depends On:** None
- **Exact Spec:** Create `packages/plan-taskos/package.json`:
  - Create `packages/plan-taskos/package.json`:
    - `"name": "@moonwitness/plan-taskos"`, `"version": "1.0.0-rc.1"`, `"type": "module"`, `"engines": { "node": "24.x" }`.
    - `"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`, `"bin": { "plan-taskos": "./dist/cli.js" }`.
    - `"files": ["dist", "schemas", "skill"]`.
    - `"exports"`: `.` (`./dist/index.js`), `./cli` (`./dist/cli.js`), `./schemas/*` (`./schemas/*`).
    - `"scripts"`: `"build": "tsc -p tsconfig.json"`, `"typecheck": "tsc --noEmit -p tsconfig.check.json"`, `"test": "tsc --noEmit -p tsconfig.check.json && vitest run"`.
    - `"dependencies"`: ONLY `"@moonwitness/types": "workspace:*"`, `"ajv": "^8.20.0"`, `"ajv-formats": "^3.0.1"` (ZERO ORM, UI, Fastify, React, or `better-sqlite3`!).
    - `"devDependencies"`: `"@types/node": "^26.6.4"`, `"typescript": "~5.7.3"`, `"vitest": "^5.0.3"`.
  - Create `tsconfig.json` extending `../../tsconfig.base.json` (`rootDir: "src"`, `outDir: "dist"`, `include: ["src/**/*.ts"]`) and `tsconfig.check.json` (`noEmit: true`, `include: ["src/**/*.ts", "tests/**/*.ts"]`).
  - Create `vitest.config.ts` with `testTimeout: 30000`, `include: ['tests/**/*.test.ts']`.
  - Append `.plan/.brain/` and `.plan/*/.leases.local.json` to root `.gitignore`.
- **DO NOT:** Add `@moonwitness/orm*`, `@moonwitness/ui`, `fastify`, or `better-sqlite3` to `packages/plan-taskos/package.json`.
- **Acceptance Criteria:** `packages/plan-taskos/package.json` parses cleanly with `engines.node === "24.x"`. `.gitignore` ignores `.plan/.brain/` and `.plan/*/.leases.local.json`.
- **Expected Output:** `T01 OK` and exit `0`.
- **Verify:** `node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('packages/plan-taskos/package.json','utf8')); const g=fs.readFileSync('.gitignore','utf8'); if(p.name!=='@moonwitness/plan-taskos'||p.engines.node!=='24.x'||!g.includes('.plan/.brain/')) process.exit(1); console.log('T01 OK')"`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/package.json packages/plan-taskos/tsconfig.json packages/plan-taskos/tsconfig.check.json packages/plan-taskos/vitest.config.ts .gitignore .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-0-foundation-and-schemas.md -m "build(plan-taskos): T01 scaffold package manifest, tsconfig, vitest, and brain gitignore"
  ```

---

## - [x] T02 — Register `packages/plan-taskos/package.json` in Both Dockerfiles & Sync `bun.lock`

- **Owner File(s):** `Dockerfile`, `apps/whatsapp/Dockerfile`, `bun.lock`
  - `Dockerfile` (MODIFY)
  - `apps/whatsapp/Dockerfile` (MODIFY)
  - `bun.lock` (MODIFY if changed)
- **Depends On:** `T01`
- **Exact Spec:** Insert `COPY packages/plan-taskos/package.json ./packages/plan-taskos/package.json` before `bun install --frozen-lockfile` in BOTH `Dockerfile` and `apps/whatsapp/Dockerfile`.
  - Insert `COPY packages/plan-taskos/package.json ./packages/plan-taskos/package.json` before `bun install --frozen-lockfile` in BOTH `Dockerfile` and `apps/whatsapp/Dockerfile`.
  - Run `bun install --frozen-lockfile --dry-run`; if lockfile needs update for the new workspace package, run `bun install` and verify `bun install --frozen-lockfile --dry-run` exits `0`.
- **DO NOT:** Remove or reorder existing `COPY` lines or change Docker base images.
- **Acceptance Criteria:** `node --test scripts/docker-workspace-manifests.test.mjs` passes with `fail 0`. `bun install --frozen-lockfile --dry-run` exits `0`.
- **Expected Output:** Manifest test PASS and zero lockfile drift.
- **Verify:** `node --test scripts/docker-workspace-manifests.test.mjs; if ($?) { bun install --frozen-lockfile --dry-run }`
- **Commit:**
  ```powershell
  git commit --only Dockerfile apps/whatsapp/Dockerfile bun.lock .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-0-foundation-and-schemas.md -m "build(docker): T02 register plan-taskos workspace manifest in dockerfiles and bun.lock"
  ```

---

## - [x] T03 — Author JSON Schemas 2020-12 (`manifest`, `wave`, `proof`, `document`)

- **Owner File(s):** `packages/plan-taskos/schemas/manifest.schema.json`, `packages/plan-taskos/schemas/wave.schema.json`, `packages/plan-taskos/schemas/proof.schema.json`, `packages/plan-taskos/schemas/document.schema.json`
  - `packages/plan-taskos/schemas/manifest.schema.json` (CREATE)
  - `packages/plan-taskos/schemas/wave.schema.json` (CREATE)
  - `packages/plan-taskos/schemas/proof.schema.json` (CREATE)
  - `packages/plan-taskos/schemas/document.schema.json` (CREATE)
- **Depends On:** `T01`
- **Exact Spec:** All 4 schemas declare `"$schema": "https://json-schema.org/draft/2020-12/schema"` and `"additionalProperties": false` on strict core objects:
  - All 4 schemas declare `"$schema": "https://json-schema.org/draft/2020-12/schema"` and `"additionalProperties": false` on strict core objects:
    1. `manifest.schema.json`: `schema_version` (`"1.0.0"`), `plan_id` (`^[a-z0-9][a-z0-9-]{1,63}$`), `title`, `repo` (`{ org, name, target_branch }`), `adr_file`, `execution_policy` (`{ max_attempts_per_task, default_model_tier, escalation_chain, require_clean_scope, auto_commit }`), `projections` (`{ github_fold_mode: "plan"|"wave"|"task", taskos_project, orm_project_code }`), `waves[]` (`{ id, title, wave_file, spec_file, depends_on[] }`), `documents[]`.
    2. `wave.schema.json`: `schema_version`, `plan_id`, `wave_id`, `title`, `tasks[]` containing the full 6-plane `PlanTaskIR` (`urn`, `code`, `kind`, `parent_urn`, `title`, `lifecycle`, `governance`, `graph`, `knowledge`, `verification`, `projections`).
    3. `proof.schema.json`: `schema_version`, `task_urn`, `code`, `parent_proof_hashes[]` (64-hex SHA-256 array), `commands[]` (`{ cmd, exit_code, duration_ms, stdout_sha256, stderr_sha256, redacted_excerpt }`), `diff_files[]`, `owner_files_verified` (`boolean`), `acceptance_criteria_state[]`, `commit_sha`, `model_tier`, `agent_runtime`, `verified_at`, `envelope_sha256`.
    4. `document.schema.json`: aligned with `docs/tasks/tasks.schema.json#document` (`urn`, `slug`, `layer: raw|brain|wiki|blueprints|specs`, `title`, `path`, `status: draft|in_review|accepted|implemented|superseded|archived`, `linked_task_urns[]`, `tags[]`).
- **DO NOT:** Allow untyped arbitrary top-level fields on `proof.schema.json`.
- **Acceptance Criteria:** All 4 schema files parse as valid JSON and compile with `ajv` (`Ajv2020` / `ajv-formats`) with zero errors.
- **Expected Output:** `T03 OK` and exit `0`.
- **Verify:** `node -e "const fs=require('fs'); for(const f of ['manifest','wave','proof','document']){ const s=JSON.parse(fs.readFileSync('packages/plan-taskos/schemas/'+f+'.schema.json','utf8')); if(!s.properties||!s.required) process.exit(1); } console.log('T03 OK')"`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/schemas/manifest.schema.json packages/plan-taskos/schemas/wave.schema.json packages/plan-taskos/schemas/proof.schema.json packages/plan-taskos/schemas/document.schema.json .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-0-foundation-and-schemas.md -m "feat(plan-taskos): T03 add 2020-12 json schemas for manifest, wave, proof, and document"
  ```

---

## - [ ] T04 — Implement URN Grammar, POSIX Path Normalizer & Secret Redaction Membrane

- **Owner File(s):** `packages/plan-taskos/src/core/urn.ts`, `packages/plan-taskos/src/core/paths.ts`, `packages/plan-taskos/src/core/redaction.ts`
  - `packages/plan-taskos/src/core/urn.ts` (CREATE)
  - `packages/plan-taskos/src/core/paths.ts` (CREATE)
  - `packages/plan-taskos/src/core/redaction.ts` (CREATE)
- **Depends On:** `T02`, `T03`
- **Exact Spec:** `urn.ts`:
  - `urn.ts`:
    - `buildWorkUrn({ org, repo, planId, waveId?, taskId?, acId? })` -> `urn:mw:work:<org>/<repo>:<planId>[:<waveId>[/<taskId>[#<acId>]]]`.
    - `buildDocUrn({ org, repo, slug })`, `buildFileUrn(posixPath)`, `buildInvariantUrn(invId)`, `buildMemoryUrn(memoryId)`.
    - `parseWorkUrn(raw)` returning typed components or `null` (fail-closed regex validation).
    - `normalizeOrmTaskCode(rawCode)` normalizing dotted IDs (`M0.01` -> `M0_01`) to match `^[A-Za-z][A-Za-z0-9_-]{1,63}$` while preserving exact URN for `external_ref`.
  - `paths.ts`:
    - `normalizeRepoPath(raw)`: converts `\` -> `/`, strips leading `./`, collapses `//`, rejects empty, absolute (`/`, `C:`), NUL bytes, or `..` traversal segments (throws explicit error).
    - `globMatchesPath(pattern, filePath)` & `globsMayOverlap(patternA, patternB)`: deterministic POSIX glob matching (`*`, `**`, `?`) and static conservative overlap proof (returns `true` whenever any path could satisfy both patterns, e.g., `packages/orm-cloud/src/**` overlaps `packages/orm-cloud/src/http.ts`).
  - `redaction.ts`:
    - `redactSensitiveText(input, knownSecrets?)`: scrubs `Bearer <tok>`, `sk-*`, `ghp_*`, `gho_*`, `github_pat_*`, `postgres://user:pass@`, `MW_SETUP_TOKEN=...`, `JWT_SECRET=...`, `PASSWORD=...`, `SECRET=...`, private key blocks, and custom `knownSecrets`, returning `{ text, redacted: boolean }`.
    - `sha256Hex(value)` and `canonicalJson(value)` (deterministic sorted-key JSON serializer).
- **DO NOT:** Use `path.join` for serialized graph keys or store unredacted secrets in any output.
- **Acceptance Criteria:** `packages/plan-taskos` compiles cleanly under `tsc --noEmit -p tsconfig.check.json`.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/core/urn.ts packages/plan-taskos/src/core/paths.ts packages/plan-taskos/src/core/redaction.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-0-foundation-and-schemas.md -m "feat(plan-taskos): T04 add canonical urn grammar, posix path/glob guard, and secret redaction"
  ```

---

## - [ ] T05 — Define 6-Plane TypeScript Contracts & `ProjectionAdapter` SPI (`src/core/types.ts`)

- **Owner File(s):** `packages/plan-taskos/src/core/types.ts`
  - `packages/plan-taskos/src/core/types.ts` (CREATE)
- **Depends On:** `T04`
- **Exact Spec:** Export readonly TypeScript interfaces mirroring all 4 JSON Schemas and the 6 planes:
  - Export readonly TypeScript interfaces mirroring all 4 JSON Schemas and the 6 planes:
    - `WorkStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'blocked' | 'done' | 'skipped' | 'cancelled'`
    - `DeliveryStage = 'local' | 'verified_dev' | 'in_main' | 'released' | 'na'`
    - `ModelTier = 'flash' | 'neon' | 'argon' | 'human'`
    - `RiskTier = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'`
    - `DocLayer = 'raw' | 'brain' | 'wiki' | 'blueprints' | 'specs'`
    - `GitHubFoldMode = 'plan' | 'wave' | 'task'`
    - `PlanManifest`, `WaveDefinition`, `WaveFile`, `PlanTaskIR`, `AcceptanceCriterionIR`, `VerifyCommandIR`, `ProofEnvelope`, `DocumentNodeIR`, `LoadedPlanBundle` (with `format: 'plan-taskos/v1' | 'legacy-markdown'`).
    - `AuthorityPlane = 'git_spec' | 'proof_runner' | 'ci_delivery' | 'orm_enterprise' | 'github_human' | 'docs_knowledge'`
    - `ProjectionAdapter<TPlanOut = unknown>` SPI: `{ readonly name: string; readonly authorityPlanes: readonly AuthorityPlane[]; planSync(bundle, options): Promise<ProjectionDiff>; applySync(bundle, diff, options): Promise<ProjectionApplyResult> }`.
- **DO NOT:** Import `@moonwitness/orm*` or any database/HTTP framework types.
- **Acceptance Criteria:** Strict TypeScript check passes (`tsc --noEmit`).
- **Expected Output:** Exit `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/core/types.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-0-foundation-and-schemas.md -m "feat(plan-taskos): T05 define 6-plane workgraph ir contracts and projection adapter spi"
  ```
