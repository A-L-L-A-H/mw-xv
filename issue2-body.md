## Inspiration
GitHub Trending: firecrawl/firecrawl and anomalyco/opencode (agentic repos redefining workflow boundaries)
arXiv/arxiv API: Empty (offline)
Papers with Code: Empty (offline)
npm Trending: Stale 2022 data — npm trends not viable as fresh signal

## The Gap
mw-xv's control-plane (`apps/control-plane/`) and A2A protocol implement a robust mesh-based inter-agent communication layer with A2A envelope signing, fencing tokens, delegation depth limits, and private-mesh routing. Yet there is no "mesh escape hatch": when an agent's target endpoint leaves the private mesh (e.g., cross-company, internet destination), the system rejects the request with a hard error and no fallback. This forces every agent to remain mesh-bound, losing the ability to reach external services without custom gateway code.

## Sketch
Design a "mesh escape" primitive that gracefully routes A2A envelopes beyond the private mesh boundary:
- Add a `dataClassification: "restricted"` → `"cloud_eligible"` upgrade path in the classification router
- Implement a Cloud Gateway service (`apps/api/src/routes/cloud-gateway.ts`) that accepts A2A envelopes with `dataClassification: restricted` and forwards them via authenticated outbound HTTP to a Cloudflare Workers endpoint
- The gateway performs identity translation: converts A2A sourceAgentId → JWT subject, companyId → org slug, and signs with a short-lived token
- Return a `cloud-eligible` response envelope with `delegationDepth: 0` and a `forwardReference` that downstream code can poll for completion
- Expose a new `POST /api/a2a/cloud-delegate` route that triggers this flow
- Write a test: `apps/api/tests/cloud-gateway.test.ts` that starts a mock gateway, sends a restricted A2A envelope, and verifies the cloud-eligible response

This opens the control-plane to the public internet without abandoning the mesh security model — it adds a deliberate, audited bridge.

## Why Antislop
Mainstream hype builds walled gardens (closed AI platforms, proprietary agent frameworks). The contrarian position: the real power is in deliberate, gated interoperability. Most agent frameworks either lock you in (no egress) or open everything (no security). A controlled mesh-escape bridge is weird because it admits the mesh isn't the final form; it's high-leverage because it lets mw-xv agents services external APIs without sacrificing the fencing/authorization guarantees that make the platform trustworthy.

## First Spike Task
File: `apps/api/src/routes/cloud-gateway.ts` (new route handler)
Function: `handleCloudDelegate(req: Request, env: { MESH_SIGNING_SECRET: string })` — receive A2A envelope, verify mesh auth, forward to cloud endpoint, return cloud-eligible response
Test: `apps/api/tests/cloud-gateway.test.ts` — mock the cloud endpoint, verify mesh verification passes and response has `dataClassification: cloud_eligible`, `delegationDepth: 0`
Run: `pnpm test:unit --filter api` (or targeted test path)

## References
- apps/control-plane/a2a.go — existing A2A envelope verification and mesh routing
- packages/ai-runtime/src/classification-router.ts — data classification system
- GitHub search: no open issues matching "mesh escape", "cloud delegate", "a2a cloud", "gateway" in mw-xv

## License
MIT