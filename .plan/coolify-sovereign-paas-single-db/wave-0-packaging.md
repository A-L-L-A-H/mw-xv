# Wave 0 — Workspace & Docker Packaging (`M01`–`M03`)

**ADR Reference:** `.plan/coolify-sovereign-paas-single-db/ADR-001-sovereign-paas-single-db.md`
**Rule:** Execute 1 micro-task -> verify -> check `[x]` here & Master -> atomic `git commit --only`.

---

## - [x] M01 — Add `yaml` & `paas-template-pack-coolify` to `packages/orm-cloud/package.json`

- **Owner File (MODIFY):** `packages/orm-cloud/package.json` (lines 22–30)
- **Depends On:** None
- **Exact Spec:** Add alphabetically inside `"dependencies"`:
  ```json
    "paas-template-pack-coolify": "workspace:*",
    "yaml": "^2.8.0"
  ```
- **DO NOT:** Touch `devDependencies`, `scripts`, or existing version pins.
- **Acceptance Criteria:**
  - `packages/orm-cloud/package.json` parses as valid JSON.
  - Both `"paas-template-pack-coolify": "workspace:*"` and `"yaml": "^2.8.0"` exist in `dependencies`.
- **Expected Output:** `M01 OK` and exit `0`.
- **Verify:**
  ```powershell
  node -e "const p=require('./packages/orm-cloud/package.json'); if(p.dependencies['paas-template-pack-coolify']!=='workspace:*' || !p.dependencies.yaml) process.exit(1); console.log('M01 OK')"
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/package.json .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-0-packaging.md -m "build(orm-cloud): M01 declare yaml and paas-template-pack-coolify dependencies"
  ```

---

## - [x] M02 — Add `paas-template-pack-coolify/package.json` COPY to Both Dockerfiles

- **Owner Files (MODIFY):**
  - `Dockerfile` (insert before `bun install --frozen-lockfile`, right after `packages/orm-workflow/package.json`)
  - `apps/whatsapp/Dockerfile` (insert before `bun install --frozen-lockfile`, right after `packages/orm-workflow/package.json`)
- **Depends On:** `M01`
- **Exact Line to Insert in BOTH files:**
  ```dockerfile
  COPY packages/paas-template-pack-coolify/package.json ./packages/paas-template-pack-coolify/package.json
  ```
- **Acceptance Criteria:**
  - `scripts/docker-workspace-manifests.test.mjs` reports `missing = []` (every workspace `package.json` copied before frozen install).
  - `apps/whatsapp/Dockerfile` includes the exact same COPY line before `bun install --frozen-lockfile`.
- **Expected Output:** All tests in `scripts/docker-workspace-manifests.test.mjs` PASS (`fail 0`).
- **Verify:**
  ```powershell
  node --test scripts/docker-workspace-manifests.test.mjs
  ```
- **Commit:**
  ```powershell
  git commit --only Dockerfile apps/whatsapp/Dockerfile .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-0-packaging.md -m "build(docker): M02 copy paas-template-pack-coolify manifest before frozen install"
  ```

---

## - [ ] M03 — Sync `bun.lock` & Verify `@moonwitness/orm-cloud` Build

- **Owner File (MODIFY if changed):** `bun.lock`
- **Depends On:** `M02`
- **Exact Spec:**
  - Run `bun install --frozen-lockfile --dry-run`. If it exits non-zero because `packages/orm-cloud/package.json` changed, run `bun install` (outside sandbox if network/symlink needed) to update `bun.lock` cleanly so frozen install succeeds in Docker!
- **Acceptance Criteria:**
  - `bun install --frozen-lockfile --dry-run` exits `0`.
  - `bun --filter @moonwitness/orm-cloud build` exits `0`.
  - `node --test scripts/docker-workspace-manifests.test.mjs` exits `0`.
- **Expected Output:** Zero TypeScript errors and zero lockfile drift.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { node --test scripts/docker-workspace-manifests.test.mjs }
  ```
- **Commit:** (include `bun.lock` if modified)
  ```powershell
  git commit --only bun.lock .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-0-packaging.md -m "chore(deps): M03 sync bun.lock for orm-cloud coolify template pack"
  ```
