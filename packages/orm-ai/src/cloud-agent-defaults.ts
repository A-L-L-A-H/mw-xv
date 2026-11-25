import type { WorkspaceCheckKind } from '@moonwitness/ai-runtime';
import type { ArtifactVerificationStatus } from './models/constants.js';

/**
 * Single source of truth for library-safe cloud coding-agent defaults.
 *
 * These values are intentionally free of any host configuration: no endpoint,
 * credential, registry digest or repository label is derived from them. The
 * hosting app supplies authority inputs (including pinned sandbox refs)
 * explicitly; this module only provides bounded, deterministic defaults.
 */

export const CLOUD_AGENT_CHECK_KIND = 'pnpm-typecheck' as const satisfies WorkspaceCheckKind;

/** Fixed command templates. RPC callers select a check kind, never a command. */
export const CLOUD_AGENT_CHECK_COMMANDS: Readonly<Record<WorkspaceCheckKind, readonly string[]>> = {
  'node-test': ['node', '--test'],
  'pnpm-test': ['pnpm', 'test'],
  'pnpm-typecheck': ['pnpm', 'typecheck'],
  'pnpm-lint': ['pnpm', 'lint'],
  'pnpm-build': ['pnpm', 'build'],
  'vitest-run': ['pnpm', 'exec', 'vitest', 'run'],
  'tsc-noemit': ['pnpm', 'exec', 'tsc', '--noEmit'],
};

/** Manifest command derived solely from the approved check kind. */
export const CLOUD_AGENT_MANIFEST_COMMAND: readonly string[] =
  CLOUD_AGENT_CHECK_COMMANDS[CLOUD_AGENT_CHECK_KIND];

export const DEFAULT_SANDBOX_CPU_CORES = 0.5;
export const DEFAULT_SANDBOX_MEMORY_MB = 512;
export const DEFAULT_SANDBOX_TIMEOUT_MS = 30_000;
export const DEFAULT_SANDBOX_MAX_OUTPUT_BYTES = 1_048_576;
export const DEFAULT_SANDBOX_PIDS_LIMIT = 64;

export const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_MAX_DURATION_MS = 120_000;

/** Produced but not accepted; promotion is never automatic. */
export const EVIDENCE_VERIFICATION_STATUS: ArtifactVerificationStatus = 'checked';
