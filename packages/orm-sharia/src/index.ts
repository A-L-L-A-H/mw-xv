export { manifest } from './manifest.js';
export { seed as seedShariaReferenceData, SHARIA_SEED_VERSION } from './seed.js';
export { shariaSeedManifest } from './seed-manifest.js';
export type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
export { ShariaContract, ProfitSharingDistribution, ZakatAssessment, WaqfAsset, HalalComplianceAudit } from './models/index.js';
export type { ShariaContractType, ShariaContractStatus } from './models/index.js';
export { views } from './views.js';
export { httpPlugin } from './http-plugin.js';
export {
  calculateZakat,
  distributeProfitSharing,
  validateShariaContract,
  computeWaqfMerkle,
  appendWaqfMerkleEvent,
  type ZakatCalculationInput,
  type ZakatCalculationResult,
  type ProfitSharingInput,
  type ProfitSharingResult,
  type JournalLine,
  type ContractValidationInput,
  type ContractValidationResult,
  type MerkleTrailNode,
  type WaqfMerkleInput,
  type WaqfMerkleResult,
} from './sharia-engine.js';
