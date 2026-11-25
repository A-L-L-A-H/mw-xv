# Wave 5 — CLI, Standalone MCP Server, Portable Skill & Dogfood (`T31`–`T36`)

**ADR Reference:** `.plan/plan-taskos-cognitive-workgraph/ADR-003-plan-taskos-cognitive-workgraph.md` (Decisions 5, 7)
**Depends On:** `T30`
**Hard Rule:** Both CLI and MCP server MUST work offline in ANY external Git repository with zero MoonWitness-specific runtime dependencies!

---

## - [x] T31 — Implement Standalone MCP Tool Handlers & Stdio JSON-RPC Server (`src/mcp/`)

- **Owner File(s):** `packages/plan-taskos/src/mcp/tools.ts`, `packages/plan-taskos/src/mcp/stdio-server.ts`
  - `packages/plan-taskos/src/mcp/tools.ts` (CREATE)
  - `packages/plan-taskos/src/mcp/stdio-server.ts` (CREATE)
- **Depends On:** `T29`
- **Exact Spec:** `tools.ts`: implement typed MCP tool schemas & handlers over `BrainStorageDriver` + `repoRoot`:
  - `tools.ts`: implement typed MCP tool schemas & handlers over `BrainStorageDriver` + `repoRoot`:
    - Read tools: `plan_list`, `plan_dag`, `plan_next` (returns `O(1)` Micro-Brief), `plan_recall` (hybrid BM25+Ollama), `plan_impact` (2-hop blast radius), `plan_graph` (subgraph JSON).
    - Controlled write tools (enabled when `--allow-write` flag passed; read-only by default!): `plan_claim`, `plan_verify`, `plan_complete`, `plan_fail`, `plan_sync`.
  - `stdio-server.ts`: hand-rolled zero-dependency JSON-RPC 2.0 stdio transport (`initialize`, `tools/list`, `tools/call`, `ping`), clean shutdown on stdin EOF, zero console.log pollution on stdout (diagnostics strictly on stderr!).
- **DO NOT:** Write any non-JSON-RPC log bytes to `process.stdout`.
- **Acceptance Criteria:** `initialize` -> `tools/list` -> `tools/call` (`plan_list`, `plan_recall`, `plan_impact`) responds with valid JSON-RPC frames.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/mcp/tools.ts packages/plan-taskos/src/mcp/stdio-server.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-5-cli-mcp-skill-and-dogfood.md -m "feat(plan-taskos): T31 add standalone stdio mcp server and cognitive brain tool handlers"
  ```

---

## - [x] T32 — Implement Full `plan-taskos` CLI Binary (`src/cli.ts`)

- **Owner File(s):** `packages/plan-taskos/src/cli.ts`
  - `packages/plan-taskos/src/cli.ts` (CREATE)
- **Depends On:** `T31`
- **Exact Spec:** Add `#!/usr/bin/env node` shebang and zero-dependency argument parser supporting `--json`, `--plan <id>`, `--repo <path>`, `--check`, `--apply`:
  - Add `#!/usr/bin/env node` shebang and zero-dependency argument parser supporting `--json`, `--plan <id>`, `--repo <path>`, `--check`, `--apply`:
    - `init <plan-id> --title <title>`: scaffolds `.plan/<plan-id>/` (`manifest.json`, `ADR-001`, `waves/W0.json`, `specs/W0.md`, `.plan/<plan-id>.md`).
    - `lint [plan-id]`: runs AJV schema + spec parity + Disjoint Write-Ownership Prover + cycle check + proof chain check (exits `1` on any error).
    - `reindex`: rebuilds `.plan/.brain/taskos.sqlite` deterministically from Git shards + `episodes.jsonl` + invariants.
    - `dag [plan-id]`: outputs wave stats, ready/active/blocked counts, and Boss Critical Path.
    - `next [plan-id] [--claim --agent <rt> --session <id>] [--format brief|json]`: emits `O(1)` Cognitive Micro-Brief for next ready task.
    - `recall <query>` & `impact <file-or-urn>`: runs Brain hybrid search & 2-hop blast radius.
    - `claim <task-id>`, `verify <task-id>`, `complete <task-id> [--commit]`, `fail <task-id> --reason <msg>`, `block <task-id> --reason <msg>`.
    - `sleep`: runs Non-REM episodic memory consolidation & invariant proposal report.
    - `sync [--target md|taskos|docs|github|orm] [--check]`: runs Split-Authority projection adapters.
    - `intake --github-issue <json-path>`: creates intake draft task.
    - `export-swarm [plan-id] [--wave W1] [--max-parallel 4]`: prints disjoint `/swarm` briefs.
    - `mcp [--allow-write]`: starts stdio JSON-RPC MCP server.
- **DO NOT:** Print secrets or mutate Git when `--check` / dry-run is active.
- **Acceptance Criteria:** `bun --filter @moonwitness/plan-taskos build` compiles `dist/cli.js` and `node packages/plan-taskos/dist/cli.js --help` exits `0`.
- **Expected Output:** Help output printed and exit `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos build; if ($?) { node packages/plan-taskos/dist/cli.js --help }`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/cli.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-5-cli-mcp-skill-and-dogfood.md -m "feat(plan-taskos): T32 implement full plan-taskos cli with brain, proof runner, and sync commands"
  ```

---

## - [x] T33 — Author Portable Agent Skill & Templates (`packages/plan-taskos/skill/`)

- **Owner File(s):** `packages/plan-taskos/skill/SKILL.md`, `packages/plan-taskos/skill/mcp-manifest.json`, `packages/plan-taskos/skill/templates/manifest.template.json`, `packages/plan-taskos/skill/templates/wave.template.json`, `packages/plan-taskos/skill/templates/adr.template.md`, `packages/plan-taskos/skill/templates/spec.template.md`
  - `packages/plan-taskos/skill/SKILL.md` (CREATE)
  - `packages/plan-taskos/skill/mcp-manifest.json` (CREATE)
  - `packages/plan-taskos/skill/templates/manifest.template.json` (CREATE)
  - `packages/plan-taskos/skill/templates/wave.template.json` (CREATE)
  - `packages/plan-taskos/skill/templates/adr.template.md` (CREATE)
  - `packages/plan-taskos/skill/templates/spec.template.md` (CREATE)
- **Depends On:** `T32`
- **Exact Spec:** `skill/SKILL.md`: YAML frontmatter (`name: plan-taskos`, concise `description`), documenting:
  - `skill/SKILL.md`: YAML frontmatter (`name: plan-taskos`, concise `description`), documenting:
    1. When to use (planning multi-step features, executing atomic micro-tasks, querying Brain memory/impact, or orchestrating disjoint `/swarm` waves in MoonWitness or any external repo).
    2. Authoring protocol (Adaptive sizing: sharded `waves/*.json` + `specs/*.md` + `ADR-NNN.md` + `plan-taskos lint`).
    3. 5-command Flash Autonomous Loop (`plan-taskos reindex` -> `plan-taskos next --claim` -> edit ONLY `owner_files` -> `plan-taskos complete <id> --commit` -> `plan-taskos sync`).
    4. Multi-plane projection rules (ORM, Docs, TaskOS v2, GitHub `wave`/`task` folding) & Non-REM `plan-taskos sleep`.
  - `skill/mcp-manifest.json`: ready-to-paste MCP server entry (`command: "npx"`, `args: ["@moonwitness/plan-taskos", "mcp"]`) listing all read/write tools.
  - Templates: minimal valid starter templates passing `plan-taskos lint` out of the box!
- **Acceptance Criteria:** `SKILL.md` has valid YAML frontmatter; all JSON templates parse cleanly and match `schemas/*.schema.json`.
- **Expected Output:** `T33 OK` and exit `0`.
- **Verify:** `node -e "const fs=require('fs'); const s=fs.readFileSync('packages/plan-taskos/skill/SKILL.md','utf8'); if(!s.startsWith('---')||!s.includes('name: plan-taskos')) process.exit(1); for(const j of ['mcp-manifest.json','templates/manifest.template.json','templates/wave.template.json']) JSON.parse(fs.readFileSync('packages/plan-taskos/skill/'+j,'utf8')); console.log('T33 OK')"`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/skill/SKILL.md packages/plan-taskos/skill/mcp-manifest.json packages/plan-taskos/skill/templates/manifest.template.json packages/plan-taskos/skill/templates/wave.template.json packages/plan-taskos/skill/templates/adr.template.md packages/plan-taskos/skill/templates/spec.template.md .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-5-cli-mcp-skill-and-dogfood.md -m "feat(plan-taskos): T33 add portable agent skill, mcp manifest, and starter plan templates"
  ```

---

## - [ ] T34 — Install Workspace Skill Mirror at `.agents/skills/plan-taskos/SKILL.md`

- **Owner File(s):** `.agents/skills/plan-taskos/SKILL.md`
  - `.agents/skills/plan-taskos/SKILL.md` (CREATE)
- **Depends On:** `T33`
- **Exact Spec:** Mirror `packages/plan-taskos/skill/SKILL.md` into `.agents/skills/plan-taskos/SKILL.md` with MoonWitness workspace command shortcuts (`bun run plan:lint`, `bun run plan:next`, `bun run plan:reindex`, `bun run plan:sync`) and integration notes for `hybrid-swarm-dag` (`INV-008`) and `frontier-research-scout`.
  - Mirror `packages/plan-taskos/skill/SKILL.md` into `.agents/skills/plan-taskos/SKILL.md` with MoonWitness workspace command shortcuts (`bun run plan:lint`, `bun run plan:next`, `bun run plan:reindex`, `bun run plan:sync`) and integration notes for `hybrid-swarm-dag` (`INV-008`) and `frontier-research-scout`.
- **Acceptance Criteria:** `.agents/skills/plan-taskos/SKILL.md` passes `node scripts/check-docs.mjs` with zero broken links.
- **Expected Output:** `check-docs.mjs` exits `0`.
- **Verify:** `node scripts/check-docs.mjs`
- **Commit:**
  ```powershell
  git commit --only .agents/skills/plan-taskos/SKILL.md .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-5-cli-mcp-skill-and-dogfood.md -m "docs(skills): T34 install workspace plan-taskos skill in .agents/skills"
  ```

---

## - [ ] T35 — Add Root `package.json` Convenience Scripts for `plan-taskos`

- **Owner File(s):** `package.json`
  - `package.json` (MODIFY — `scripts` only)
- **Depends On:** `T32`
- **Exact Spec:** Add 5 scripts to root `package.json`:
  - Add 5 scripts to root `package.json`:
    - `"plan:lint": "node packages/plan-taskos/dist/cli.js lint"`
    - `"plan:reindex": "node packages/plan-taskos/dist/cli.js reindex"`
    - `"plan:next": "node packages/plan-taskos/dist/cli.js next"`
    - `"plan:sync": "node packages/plan-taskos/dist/cli.js sync"`
    - `"plan:mcp": "node packages/plan-taskos/dist/cli.js mcp"`
- **DO NOT:** Alter `engines.node`, `dependencies`, or existing scripts.
- **Acceptance Criteria:** Root `package.json` is valid JSON and all 5 `plan:*` scripts are defined.
- **Expected Output:** `T35 OK` and exit `0`.
- **Verify:** `node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); for(const k of ['plan:lint','plan:reindex','plan:next','plan:sync','plan:mcp']) if(!p.scripts[k]) process.exit(1); console.log('T35 OK')"`
- **Commit:**
  ```powershell
  git commit --only package.json .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-5-cli-mcp-skill-and-dogfood.md -m "chore(scripts): T35 add plan:lint, plan:reindex, plan:next, plan:sync, and plan:mcp scripts"
  ```

---

## - [ ] T36 — Add Wave 5 CLI + MCP E2E Tests & Dogfood on Live `.plan/`

- **Owner File(s):** `packages/plan-taskos/tests/cli-e2e.test.ts`, `packages/plan-taskos/tests/mcp-server.test.ts`
  - `packages/plan-taskos/tests/cli-e2e.test.ts` (CREATE)
  - `packages/plan-taskos/tests/mcp-server.test.ts` (CREATE)
- **Depends On:** `T33`, `T34`, `T35`
- **Exact Spec:** `cli-e2e.test.ts`: runs real `dist/cli.js` subprocess in temp repo testing full lifecycle: `init -> lint -> reindex -> dag -> next --claim -> complete -> sleep -> sync --check -> export-swarm`.
  - `cli-e2e.test.ts`: runs real `dist/cli.js` subprocess in temp repo testing full lifecycle: `init -> lint -> reindex -> dag -> next --claim -> complete -> sleep -> sync --check -> export-swarm`.
  - `mcp-server.test.ts`: spawns `dist/cli.js mcp` over stdio pipes and asserts JSON-RPC `initialize`, `tools/list`, `plan_list`, `plan_recall`, `plan_impact`, and read-only guard rejecting `plan_complete` when `--allow-write` is absent!
  - Live Dogfood Check: run `bun run plan:reindex; if ($?) { bun run plan:lint -- --json }` against the real `.plan/` directory (indexing all 3 plans cleanly!).
- **Acceptance Criteria:** All `@moonwitness/plan-taskos` tests pass 100% AND live `.plan/` dogfood reindex + lint exits `0`.
- **Expected Output:** Vitest + live `plan:reindex` + `plan:lint` exit `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos build; if ($?) { bun --filter @moonwitness/plan-taskos test }; if ($?) { bun run plan:reindex }; if ($?) { bun run plan:lint }`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/tests/cli-e2e.test.ts packages/plan-taskos/tests/mcp-server.test.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-5-cli-mcp-skill-and-dogfood.md -m "test(plan-taskos): T36 add cli/mcp e2e tests and verify live .plan dogfood reindex"
  ```
