## Inspiration
MW-XV's `packages/ai-runtime/src/causal-replay.ts` primitive (exported from `ai-runtime` index.ts:55). This is a **causal replay engine** — not just logging, but recording the full causal DAG of an agent run: every decision, tool call, model output, state transition, with explicit causal edges.

## The Gap
Mainstream "AI observability" = logs + metrics + traces (Datadog, LangSmith, Langfuse). These are **post-hoc, linear, and opaque**. You see *what* happened, not *why*, and you cannot ask "what if the model had chosen X instead of Y at step 3?"

MW-XV has the primitive but no **operator-facing time-travel debugger** that lets you:
- Replay the exact causal chain of any agent run
- Fork at any causal node (decision point) and explore counterfactuals
- Compare actual vs. counterfactual outcomes side-by-side
- Attach causal replays to PCW proofs (`pcw-verifier.ts`) for verifiable debugging

## Sketch
**Core components (using MW-XV primitives):**

1. **Causal Recorder** (`causal-replay.ts` + `merkle-ledger.ts`): Wrap `AgentHarness.run()` to emit a causal DAG where each node = {decision, tool_call, model_output, state_delta, parent_causes[]}. Hash each node into a merkle ledger for tamper-proof replay.

2. **Time-Travel UI** (Board addon): A `CausalReplayPanel` in `apps/board/src/components/ai/` that loads a causal replay by run ID, renders the DAG as an interactive graph (cytoscape.js or react-flow), lets operators click any node to "rewind to here", then fork with a modified input.

3. **Counterfactual Forker**: On fork, spin up a `WorktreeSandbox` (`apps/desktop` R0) with the replay's execution packet (`prompt-forge.ts`), inject the modified decision at the fork point, run to completion, diff the resulting causal DAG against original.

4. **PCW Integration**: Export both original + counterfactual causal DAGs as `ProofCarryingWork` artifacts (`pcw-verifier.ts:5-state check matrix`). Verifier confirms the fork only changed the intended decision node — all else identical.

5. **Obligation Monitor Hook** (`obligation-monitor.ts`): When a causal replay reveals a policy violation (e.g., agent accessed unauthorized data), auto-create an `ObligationDriftFinding` with the causal proof.

## Why Antislop
- **Contrarian**: Everyone builds "observability dashboards" (passive). This builds **active causal reasoning** — you don't watch, you *interrogate*.
- **Weird**: Counterfactual forking of *running AI agents* is not a mainstream pattern. It treats agent runs as **reproducible, forkable computations** like git branches.
- **High-leverage**: Solves the #1 blocker for AI in production: "I can't debug why it did that, and I can't prove it won't do it again." Causal replay + merkle proof = **verifiable debugging**.

## First Spike Task
1. **File**: `packages/ai-runtime/src/causal-replay.ts` — add `recordCausalRun(harness: AgentHarness, input: AgentInput): Promise<CausalDAG>` that wraps `harness.run()` and emits the causal DAG with merkle roots.
2. **File**: `packages/ai-runtime/src/causal-replay.ts` — add `forkAtNode(dag: CausalDAG, nodeId: string, modifiedInput: AgentInput): Promise<CausalDAG>` that re-executes from the fork point using `WorktreeSandbox.compileExecutionPacket`.
3. **Test**: `packages/ai-runtime/tests/causal-replay.test.ts` — record a simple agent run, fork at a tool-call node with a modified tool result, verify the forked DAG diverges only at/after the fork point, and merkle roots before fork match.

## References
- `packages/ai-runtime/src/causal-replay.ts` (existing primitive)
- `packages/ai-runtime/src/merkle-ledger.ts` (tamper-proof hashing)
- `packages/ai-runtime/src/pcw-verifier.ts` (proof-carrying work verification)
- `packages/ai-runtime/src/prompt-forge.ts` (execution packet compilation)
- `apps/desktop/src/worktree-sandbox.ts` (R0 sandbox for forking)
- `apps/board/src/components/ai/` (target UI location)