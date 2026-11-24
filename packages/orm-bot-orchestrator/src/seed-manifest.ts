import type { AddonSeedManifest } from '@moonwitness/orm-base';
import { seedBotOrchestrator, countBotOrchestratorRows, BOT_ORCHESTRATOR_SEED_VERSION } from './seed.js';

export const botOrchestratorSeedManifest: AddonSeedManifest = {
  seedVersion: BOT_ORCHESTRATOR_SEED_VERSION,
  dependencies: ['orm-base'],
  seed: seedBotOrchestrator,
};

export { countBotOrchestratorRows, BOT_ORCHESTRATOR_SEED_VERSION };
