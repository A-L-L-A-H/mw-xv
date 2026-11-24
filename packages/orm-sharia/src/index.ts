export { manifest } from './manifest.js';
export {
  ShariaContract,
  ProfitSharingDistribution,
  ZakatAssessment,
  WaqfAsset,
  HalalComplianceAudit,
} from './models/index.js';
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
