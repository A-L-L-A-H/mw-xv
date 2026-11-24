import type { DurableRunEffects } from './agent-run-executor.js';

/**
 * Process-local registry for the real cloud coding-agent effect.
 *
 * The durable job handler lives in this package, but the runtime configuration
 * (sandbox origin/token, gateway origin, attachment storage) belongs to the
 * hosting app. The app installs a fully composed DurableRunEffects at bootstrap;
 * until then the handler keeps its no-op stub so existing unit tests and
 * unconfigured installations behave exactly as before.
 */
let installedEffect: DurableRunEffects | null = null;

export function setCloudAgentEffect(effect: DurableRunEffects | null): void {
  installedEffect = effect;
}

export function getCloudAgentEffect(): DurableRunEffects | null {
  return installedEffect;
}
