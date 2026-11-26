# Six-Hourly AntisloP Idea Engine — Summary (Z:\repo\mw-xv)

## Signals Fetched

| Source | Result | Notes |
|--------|--------|-------|
| GitHub Trending (typescript, stars>500, pushed>7d) | 35 repos returned | Top candidates: morluto/rea (477k stars, agentic repos), firecrawl/firecrawl (209k, AI knowledge infra), anomalyco/opencode (229k, coding agent), n8n-io/n8n (212k, workflow automation), deepseek-ai/deepseek-harness (286k, plugin paradigm), microsoft/vscode (195k, editor) |
| arXiv API (cs.AI+cs.LG+cs.SE, last 7 days) | Empty / offline | API returned no data |
| Papers with Code (last 30, ordering=-published) | Empty / offline | API returned no data |
| npm Trending (keywords: ai,typescript,observability,devtools) | Stale 2022 data | Score-sorted results dominated by typescript-eslint packages; no fresh signal |

## MW-XV Capability Map (grounding)

- **Memory primitives**: `packages/ai-runtime/src/sleep-dream.ts` — `runNonRemConsolidation`, `runRemDreamSelfProbe`, `reconsolidateMemoryFeedback` with episodic/semantic decay, salience scoring, cross-domain probing
- **A2A protocol**: `apps/control-plane/a2a.go` — envelope signing, fencing tokens, delegation depth, private mesh routing, `IsPrivateMeshIP`/`IsPrivateMeshHost` CIDR validation
- **Classification router**: `packages/ai-runtime/src/classification-router.ts` — `cloud_eligible` / `local_only` / `restricted` data classifications
- **API surface**: `apps/api/src/` — REST/JSON-RPC routes, cloud infrastructure
- **ISP layer**: `apps/isp/src/radius_protocol.rs` — Radius packet decode/encode, PAP/CHAP verification
- **ORM layer**: 40+ `orm-*` packages — `orm-base`, `orm-ai`, `orm-workflow`, `orm-notification`, `orm-storage`, etc.

## Novelty Scoring & Dedupe

**Dedupe check**: Two `[IDEA]` issues already exist in mw-xv GitHub: #269 `[IDEA] Deterministic Schema Synthesis from Requirements: SpecSyn-Grounded Addon Generator` and #270 `[IDEA] Schema-Versioned Agent Memory: Domain Model as Evolving Agent State`. Both are unrelated to memory evaporation or mesh escape.

**Novelty criteria met**: Not in codebase (no grep hits for "forgetful agent", "context reset", "memory pruning", "mesh escape", "cloud delegate" across mw-xv); not in ROADMAP.md; no open issues matching the concepts; technically feasible within mw-xv primitives (A2A envelope already exists, classification router already has `cloud_eligible`, sleep-dream consolidation engine already exists).

### Top 2 Ideas (scored 0-100):

1. **[IDEA] Forgetful Agent: Intentional Memory Evaporation for Context-Window Reset** (Issue #341) — Score: ~82
   - Leverages existing `runNonRemConsolidation` engine
   - Contrarian: industry chases larger context windows; strategic forgetting is higher-leverage
   - First spike: `packages/ai-runtime/src/forgetful-agent.ts` stub + test

2. **[IDEA] Mesh Escape Hatch: Cloud-Eligible A2A Delegation Beyond Private Mesh** (Issue #342) — Score: ~78
   - Leverages existing A2A envelope + classification router `cloud_eligible` path
   - Contrarian: most frameworks lock in or open everything; a gated bridge is the contrarian path
   - First spike: `apps/api/src/routes/cloud-gateway.ts` + `apps/api/tests/cloud-gateway.test.ts`

## Issues Created

| Issue | Title | URL |
|-------|-------|-----|
| #341 | [IDEA] Forgetful Agent: Intentional Memory Evaporation for Context-Window Reset | https://github.com/A-L-L-A-H/mw-xv/issues/341 |
| #342 | [IDEA] Mesh Escape Hatch: Cloud-Eligible A2A Delegation Beyond Private Mesh | https://github.com/A-L-L-A-H/mw-xv/issues/342 |

## First Spike Tasks (ready to implement)

### Idea #1 — Forgetful Agent
- **File**: `packages/ai-runtime/src/forgetful-agent.ts` (stub)
- **Function**: `pruneMemoryContext(memories: EpisodicMemoryItem[], companyId: string, maxItems: number): PruningReport`
- **Test**: `packages/ai-runtime/tests/forgetful-agent.test.ts` — verify top-K retention with synthetic memories spanning importance/confidence spectrum
- **Run**: `pnpm test:unit --filter ai-runtime`

### Idea #2 — Mesh Escape Hatch  
- **File**: `apps/api/src/routes/cloud-gateway.ts` (new route handler)
- **Function**: `handleCloudDelegate(req: Request, env: { MESH_SIGNING_SECRET: string })`
- **Test**: `apps/api/tests/cloud-gateway.test.ts` — mock cloud endpoint, verify mesh verification passes and response has `dataClassification: cloud_eligible`, `delegationDepth: 0`
- **Run**: `pnpm test:unit --filter api` (or targeted test path)

## Notes

- External signals: arXiv and Papers with Code APIs were offline/empty during this run; npm data is fundamentally stale (2022). GitHub Trending is the most reliable signal source for this cycle.
- Both ideas avoid the two existing `[IDEA]` issues (#269, #270) and have no open issues matching their concepts in mw-xv.
- Both are grounded in existing mw-xv primitives (sleep-dream consolidation, A2A envelope, classification router) making them technically feasible without new dependencies.
- The antislop lens: both invert mainstream hype directions (larger context windows vs strategic forgetting; closed mesh vs deliberate, audited egress).