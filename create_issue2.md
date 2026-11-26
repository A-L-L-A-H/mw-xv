## Inspiration
 GitHub Copilot X early access (2023) provider rotation demo - showed provider swapping but without formal verification contracts or audit trails. The demo was gimmicky, not engineering-grade.

## The Gap
 mw-xv has multiple AI providers configured (openai-adapter, anthropic-adapter, ollama-adapter, local-openai-adapter) but no formal system for:
1. Verifying provider contract compliance before routing
2. Auditing provider response quality in production
3. Automatically rotating/swapping providers based on verified performance
4. Maintaining provider capability matrices that can be inspected and audited

Current provider switching is ad-hoc in `packages/ai-runtime/src/providers/shared.js` with no verification, no audit, and no governance.

## Sketch
This idea introduces `formal-provider-verification` system that:
1. Defines provider capability contracts as TypeScript types in `packages/ai-runtime/src/providers/contracts.ts`
2. Implements automated verification that runs on every provider response:
   - Validates response schema against contracted interface
   - Measures latency, cost-per-token, success rate per provider
   - Scores providers on: accuracy, latency, cost, safety
3. Maintains a live provider rank matrix that's inspectable via `pnpm view:providers`
4. Auto-rotates to highest-ranked viable provider when current provider fails verification
5. Generates audit logs for all provider rotations and verification failures
6. Integrates with `risk-policy.js` to adjust risk thresholds based on provider health

The implementation would live in:
- `packages/ai-runtime/src/providers/contracts.ts` - contract definitions
- `packages/ai-runtime/src/providers/verification.ts` - verification engine
- `packages/ai-runtime/src/providers/ranking.ts` - provider ranking algorithm
- `scripts/view:providers` - CLI to view provider status

## Why Antislop
 Most AI tooling treats providers as interchangeable commodities with static fallbacks. Building formal verification contracts, ranking, and audit trails is contrarian - it adds engineering rigor rather than cutting corners. The "just use OpenAI and fall back to Ollama if it's down" approach is mainstream hype. Formal provider verification is weird (in a good way), high-leverage because it prevents silent failures and improves reliability without increasing costs. It's the kind of infrastructure work that separates research toys from production-grade systems.

## First Spike Task
- [ ] Create `packages/ai-runtime/src/providers/contracts.ts` with OpenAI/Anthropic/Ollama/Local adapter contracts
- [ ] Implement `packages/ai-runtime/src/providers/verification.ts` basic verification loop
- [ ] Add `packages/ai-runtime/src/providers/ranking.ts` simple ranking based on success rate
- [ ] Write integration test verifying provider switch on verification failure
- [ ] Add `scripts/view:providers` CLI command

## References
- Internal: packages/ai-runtime/src/providers/shared.js
- Internal: packages/ai-runtime/src/risk-policy.js
- Design: ADR 0007 - AI Corporation Addon-First Architecture