export type ShariaContractType = 'murabahah' | 'mudharabah' | 'musyarakah' | 'ijarah';

export interface ZakatCalculationInput {
  companyId: number;
  assessmentDate: string;
  hijriYear: number;
  zakatType: 'maal' | 'fitrah' | 'profession' | 'trade' | 'agriculture' | 'livestock' | 'rikaz';
  assetCategory:
    'gold' | 'silver' | 'cash' | 'receivables' | 'inventory' | 'investment' | 'property' | 'other';
  grossAssetsMinor: number;
  deductibleLiabilitiesMinor: number;
  nisabGoldPricePerGramMinor?: number;
  zakatRateBps?: number;
}

export interface ZakatCalculationResult {
  nisabThresholdMinor: number;
  netZakatableMinor: number;
  zakatDueMinor: number;
  nisabMet: boolean;
  grossAssetsMinor: number;
  deductibleLiabilitiesMinor: number;
  zakatRateBps: number;
}

export interface ProfitSharingInput {
  contractId: number;
  periodStart: string;
  periodEnd: string;
  grossProfitMinor: number;
  operatingExpensesMinor: number;
  distributionDate: string;
  approvedById: number;
  notes?: string;
}

export interface ProfitSharingResult {
  netProfitMinor: number;
  customerShareMinor: number;
  companyShareMinor: number;
  journalEntryRef: string;
  journalLines: JournalLine[];
  merkleRoot: string;
}

export interface JournalLine {
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  description: string;
}

export interface ContractValidationInput {
  type: ShariaContractType;
  assetValueMinor: number;
  profitMarginMinor?: number;
  profitSharingRatio?: string;
  financingAmountMinor?: number;
  tenorMonths?: number;
  dsnMuiReference: string;
  ribaFreeConfirmed: boolean;
  ghararFreeConfirmed: boolean;
}

export interface ContractValidationResult {
  valid: boolean;
  violations: string[];
  contractType: ShariaContractType;
}

export interface MerkleTrailNode {
  event: 'acquisition' | 'valuation' | 'yield_distribution' | 'transfer' | 'disbursement';
  timestamp: string;
  valueMinor: number;
  description: string;
  hash: string;
}

export interface WaqfMerkleInput {
  assetId: number;
  trail: MerkleTrailNode[];
}

export interface WaqfMerkleResult {
  merkleRoot: string;
  trail: MerkleTrailNode[];
  verified: boolean;
}
