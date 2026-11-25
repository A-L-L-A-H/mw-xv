## Inspiration
GitHub Trending: morluto/rea and firecrawl/firecrawl (agentic repositories pushing context boundaries)
arXiv/arxiv API: Empty (offline)
npm Trending: Stale 2022 data — npm trends not viable as fresh signal

## The Gap
mw-xv has a sophisticated memory system: packages/ai-runtime/src/sleep-dream.ts, memory-evaluator.ts, runNonRemConsolidation(), runRemDreamSelfProbe(), reconsolidateMemoryFeedback(). The codebase actively builds persistent, curated episodic/semantic memory with consolidation decay, salience scoring, and cross-domain probing. Every new agent run accumulates context without a built-in mechanism for fresh starts.

## Sketch
Design a "forgetful agent" primitive that deliberately evaporates low-salience context before each agent execution cycle. Using the existing runNonRemConsolidation engine as the foundation:
- Auto-generate a salience summary of the last N memory items
- Prune items below a configurable importance/confidence threshold
- Inject a "context reset" marker that downstream code can react to
- Preserve only the top-K most salient items per topic, discarding the rest
- Expose the pruning rationale via a new memoryPruning event that downstream consumers can inspect

This inverts the current trajectory: instead of asking "how do we remember more?", ask "how do we forget strategically so every start feels fresh?"

## Why Antislop
Mainstream hype chases larger context windows, more parameters, bigger training runs. The contrarian position: the real bottleneck is not acquisition but retention. Strategic forgetting is a higher-leverage lever than any amount of parameter budget. This is weird because the industry acts as if memory is infinite; it's high-leverage because a simple pruning algorithm can yield immediate, measurable reductions in context-drift errors.

## First Spike Task
File: packages/ai-runtime/src/forgetful-agent.ts (stub). Function: pruneMemoryContext(memories: EpisodicMemoryItem[], companyId: string, maxItems: number): PruningReport. Test: packages/ai-runtime/tests/forgetful-agent.test.ts — verify top-K retention with synthetic memories spanning importance/confidence spectrum. Run: pnpm test:unit --filter ai-runtime

## References
- packages/ai-runtime/src/sleep-dream.ts — existing consolidation engine
- packages/ai-runtime/src/memory-evaluator.ts — memory evaluation infrastructure
- GitHub search: no open issues matching "forgetful", "evaporation", "context reset", "salience pruning" in mw-xv

## License
MIT