## Inspiration
MW-XV's `packages/ai-runtime/src/policy-fuzzer.ts` (exported from index.ts:62) + `orm-ai` models for `PolicyRule`, `AgentCapability`, `WorkContract`. The policy-fuzzer already generates adversarial inputs to test policy boundaries. But it's used in isolation — not connected to the **live A2A mesh** (`apps/control-plane/a2a.go`, `mesh.go`) where real agents negotiate capabilities and delegate work.

## The Gap
Mainstream "AI safety" = static red-teaming benchmarks (HarmBench, MMLU, custom evals). These test **models in isolation**, not **agent collectives in production** where:
- Agent A delegates to Agent B with a capability grant
- Agent B's policy differs from Agent A's
- The delegation chain creates emergent attack surfaces (confused deputy, capability escalation, covert channels)
- Policies are dynamic (revoked, updated, time-bounded)

No existing framework does **continuous, live, multi-agent policy fuzzing** against a running A2A mesh with real capability delegation.

## Sketch
**Core components (using MW-XV primitives):**

1. **Live Mesh Fuzzer** (`policy-fuzzer.ts` + `a2a-consensus.ts` + `control-plane/mesh.go`): 
   - Deploy a shadow A2A mesh (real `control-plane` binaries, test identities)
   - Register test agents with `orm-ai` `AgentCapability` grants that mirror production capability graphs
   - The fuzzer doesn't just send prompts — it **crafts malicious capability delegations**: "I grant you `read:pii` but the policy says you need `audit:pii-access` — can you trick the mesh into accepting?"

2. **Adversarial Capability Graph Generator**: 
   - Input: production capability graph from `orm-ai` (`agents.capabilities`, `work_contracts.required_capabilities`)
   - Output: minimal adversarial subgraphs that violate least-privilege (e.g., transitive capability leaks, circular delegations, time-bound bypasses)
   - Uses `invariant-synthesizer.ts` to learn invariants from successful fuzzing runs

3. **Continuous Fuzzing Loop** (`jobs` scheduler + `sandbox-runner.ts`):
   - Schedule: on every capability graph change (webhook from `orm-ai` models), spin up shadow mesh in `WorktreeSandbox`
   - Run policy-fuzzer against live mesh endpoints (not unit tests)
   - Emit findings as `orm-security` `PolicyViolation` records with causal proof (`causal-replay.ts`)

4. **Mesh Consensus Verification** (`a2a-consensus.ts`):
   - When fuzzer finds a violation, submit it to the A2A consensus layer: "Agent X claims capability Y was improperly granted"
   - Consensus validators (other agents in mesh) vote on whether it's a real violation vs. fuzzer false positive
   - Verified violations auto-create `WorkContract` remediation tasks (`orm-workflow`)

5. **Red Team Arena Integration** (`redteam-arena.ts`):
   - Winning adversarial delegations become "challenge scenarios" in the Red Team Arena
   - Operators can replay them, modify them, test fixes — all recorded in `merkle-ledger.ts`

## Why Antislop
- **Contrarian**: Everyone fuzzes *models* (prompts). This fuzzes *capability delegation graphs* in a *live mesh*. The attack surface is the **protocol**, not the prompt.
- **Weird**: Uses **A2A consensus** to validate fuzzer findings — the mesh *self-audits* via multi-agent agreement. No human-in-the-loop for triage.
- **High-leverage**: Catches the class of bugs that only exist in **multi-agent production**: confused deputy, capability escalation, covert channels through delegation chains. These are invisible to single-agent red-teaming.

## First Spike Task
1. **File**: `packages/ai-runtime/src/policy-fuzzer.ts` — add `fuzzCapabilityDelegation(mesh: A2AMesh, capabilityGraph: CapabilityGraph): Promise<FuzzingFinding[]>` that generates adversarial delegation chains and tests them against live mesh endpoints.
2. **File**: `apps/control-plane/mesh.go` — add test-only endpoint `POST /test/fuzz/delegate` that accepts a capability delegation request and returns whether the mesh would accept it (dry-run mode, no state mutation).
3. **Test**: `packages/ai-runtime/tests/policy-fuzzer-live.test.ts` — spin up shadow mesh in `WorktreeSandbox`, register two test agents with a known capability leak (A→B→C where C gets A's privilege transitively), run fuzzer, verify it finds the leak, emit `PolicyViolation` with causal proof.

## References
- `packages/ai-runtime/src/policy-fuzzer.ts` (existing primitive)
- `packages/ai-runtime/src/a2a-consensus.ts` (multi-agent verification)
- `packages/ai-runtime/src/invariant-synthesizer.ts` (learn invariants from findings)
- `packages/ai-runtime/src/redteam-arena.ts` (challenge scenario registry)
- `packages/ai-runtime/src/causal-replay.ts` (causal proof for findings)
- `packages/ai-runtime/src/merkle-ledger.ts` (tamper-proof audit trail)
- `apps/control-plane/a2a.go`, `mesh.go` (live A2A mesh implementation)
- `packages/orm-ai/src/models/agents.ts`, `work.ts` (capability graph models)
- `packages/orm-workflow/src/models.ts` (remediation WorkContract)