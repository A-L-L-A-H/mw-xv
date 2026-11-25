/**
 * Local mirror of `@moonwitness/ai-runtime`'s WORKSPACE_LIMITS.
 *
 * The sidecar is built from its own Docker context and must not load runtime
 * code from outside `apps/agent-sandbox`. Cross-package imports are `import
 * type` only; tests assert this mirror stays in sync with the shared contract.
 */
export const WORKSPACE_LIMITS = Object.freeze({
  cpuCores: { min: 0.25, max: 4 },
  memoryMb: { min: 128, max: 4096 },
  pidsLimit: { min: 16, max: 256 },
  timeoutMs: { min: 1_000, max: 120_000 },
  outputBytes: { min: 1_024, max: 1_048_576 },
  allowedPaths: 128,
  commitMessageBytes: 512,
});
