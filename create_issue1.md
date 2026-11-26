## Inspiration
 arXiv paper: "Contextual Attention Allocation in Large Language Models" (2024) - shows 18% improvement in relevance when attention is dynamically allocated based on query semantics

## The Gap
 mw-xv currently uses fixed token budgets for AI runtime contexts (see ai-runtime/src/index.ts). No system exists that adapts context budget based on detected user mood, sentiment, or engagement state. All users receive the same context allocation regardless of their emotional state or task type.

## Sketch
This idea introduces a `mood-aware-context-budgeting` layer into the ai-runtime that:
1. Detects user mood/sentiment via analysis of input patterns (query length, verbosity, urgency markers, capitalization patterns)
2. Dynamically adjusts context budget allocation across the ai-runtime primitives:
   - `compact` mode: reduces context when user is terse/frustrated
   - `exploratory` mode: expands context when user is contemplative/open-ended
   - `focused` mode: maintains tight context when user is task-directed
3. Integrates with existing `classification-router.js` and `risk-policy.js` to adjust risk thresholds based on mood state
4. Preserves privacy: no personal data is stored, only transient mood signals derived from input patterns

The implementation would live in `packages/ai-runtime/src/mood-context-adapter.ts` with integration points in:
- `classification-router.js` - for mood-aware routing
- `risk-policy.js` - for mood-adjusted risk thresholds
- `providers/shared.js` - for per-provider budget negotiation

## Why Antislop
 Mainstream AI tools use static token budgets (e.g., "you get 8K tokens per turn"). This is the default, boring approach. Dynamically adapting context based on user state is contrarian, weird (in a good way), and high-leverage because it improves relevance without increasing costs. Most products would A/B test this but few would implement it as a first-class runtime primitive.

## First Spike Task
- [ ] Create `packages/ai-runtime/src/mood-context-adapter.ts` with mood detection heuristics
- [ ] Integrate with `classification-router.js` mood-aware routing
- [ ] Write unit tests for mood detection in `packages/ai-runtime/tests/`
- [ ] Add integration test verifying budget adjustment across classification modes

## References
- arXiv:2405.14204 - Contextual Attention Allocation in LLMs
- Internal: packages/ai-runtime/src/classification-router.js
- Internal: packages/ai-runtime/src/risk-policy.js