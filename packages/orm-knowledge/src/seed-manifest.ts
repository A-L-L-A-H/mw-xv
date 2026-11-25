import type { AddonSeedManifest } from '@moonwitness/orm-base';
import { seedKnowledgeReferenceData } from './seed.js';

export const knowledgeSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: seedKnowledgeReferenceData,
};
