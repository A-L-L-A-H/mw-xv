import { BASIS_POINTS_TOTAL } from '@moonwitness/types';

export const SHARIA_MIZAN_LEDGER_VERSION = 'moonwitness-sharia-mizan-ledger/v1' as const;
export const ZAKAT_RATE_NUMERATOR = 25 as const;
export const ZAKAT_RATE_DENOMINATOR = 1_000 as const;
export const MINIMUM_HAUL_LUNAR_DAYS = 354 as const;
export { BASIS_POINTS_TOTAL };

export type ShariaMizanLedgerErrorCode =
  | 'invalid-identifier'
  | 'invalid-amount'
  | 'invalid-term'
  | 'invalid-party'
  | 'invalid-contract-term'
  | 'unbalanced-journal'
  | 'below-nisab'
  | 'haul-incomplete'
  | 'waqf-disposition-forbidden';

export class ShariaMizanLedgerError extends Error {
  readonly code: ShariaMizanLedgerErrorCode;

  constructor(code: ShariaMizanLedgerErrorCode, message: string) {
    super(message);
    this.name = 'ShariaMizanLedgerError';
    this.code = code;
  }
}

export interface JournalLine {
  readonly id: string;
  readonly accountCode: string;
  readonly debitMinorUnits: number;
  readonly creditMinorUnits: number;
  readonly memo?: string;
}

export interface DoubleEntryJournalInput {
  readonly journalId: string;
  readonly lines: readonly JournalLine[];
}

export interface JournalIssue {
  readonly path: string;
  readonly code: ShariaMizanLedgerErrorCode | 'zero-value-line' | 'dual-sided-line';
  readonly message: string;
}

export interface DoubleEntryInvariantResult {
  readonly journalId: string;
  readonly balanced: boolean;
  readonly totalDebitMinorUnits: number;
  readonly totalCreditMinorUnits: number;
  readonly differenceMinorUnits: number;
  readonly lineCount: number;
  readonly issues: readonly JournalIssue[];
}

export interface CorporateZakatInput {
  readonly entityId: string;
  readonly assessmentId: string;
  readonly zakatableWealthMinorUnits: number;
  readonly nisabThresholdMinorUnits: number;
  readonly haulLunarDays: number;
}

export interface CorporateZakatRate {
  readonly numerator: number;
  readonly denominator: number;
  readonly percent: string;
  readonly rounding: 'floor-to-minor-unit';
}

export interface CorporateZakatResult {
  readonly version: typeof SHARIA_MIZAN_LEDGER_VERSION;
  readonly entityId: string;
  readonly assessmentId: string;
  readonly status: 'due' | 'below-nisab' | 'haul-incomplete';
  readonly rate: CorporateZakatRate;
  readonly zakatableWealthMinorUnits: number;
  readonly nisabThresholdMinorUnits: number;
  readonly haulLunarDays: number;
  readonly haulCompleted: boolean;
  readonly nisabMet: boolean;
  readonly dueMinorUnits: number;
}

export interface ContractParty {
  readonly id: string;
  readonly name: string;
}

export interface MudharabahContractInput {
  readonly contractId: string;
  readonly capitalOwner: ContractParty;
  readonly entrepreneur: ContractParty;
  readonly capitalMinorUnits: number;
  readonly capitalConveyed: boolean;
  readonly capitalOwnerProfitShareBasisPoints: number;
  readonly entrepreneurProfitShareBasisPoints: number;
  readonly principalGuaranteed: boolean;
  readonly lossAllocation: 'capital-owner' | 'capital-owner-except-entrepreneur-misconduct';
  readonly termStart: string;
  readonly termEnd: string;
}

export interface MurabahahContractInput {
  readonly contractId: string;
  readonly seller: ContractParty;
  readonly buyer: ContractParty;
  readonly assetDescription: string;
  readonly acquisitionCostMinorUnits: number;
  readonly disclosedMarginMinorUnits: number;
  readonly salePriceMinorUnits: number;
  readonly marginDisclosed: boolean;
  readonly sellerOwnedBeforeSale: boolean;
  readonly sellerPossessedBeforeSale: boolean;
  readonly deferredPriceFixed: boolean;
  readonly interestAdjustmentApplied: boolean;
  readonly termStart: string;
  readonly termEnd: string;
}

export interface ContractAuditIssue {
  readonly path: string;
  readonly code:
    | 'invalid-party'
    | 'invalid-amount'
    | 'invalid-contract-term'
    | 'profit-split-mismatch'
    | 'principal-guarantee'
    | 'invalid-loss-allocation'
    | 'price-mismatch'
    | 'undisclosed-margin'
    | 'missing-ownership'
    | 'missing-possession'
    | 'unfixed-price'
    | 'interest-adjustment';
  readonly message: string;
}

export interface ShariaContractAudit {
  readonly version: typeof SHARIA_MIZAN_LEDGER_VERSION;
  readonly contractType: 'mudharabah' | 'murabahah';
  readonly contractId: string;
  readonly compliant: boolean;
  readonly issues: readonly ContractAuditIssue[];
}

export type WaqfAssetKind = 'land' | 'building' | 'cash-endowment' | 'productive-enterprise';
export type WaqfAssetDisposition = 'sale' | 'transfer' | 'mortgage';

export interface WaqfAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: WaqfAssetKind;
  readonly location: string;
  readonly endowedAt: string;
  readonly perpetual: true;
  readonly beneficiaries: readonly string[];
  readonly prohibitedDispositions: readonly WaqfAssetDisposition[];
}

export interface WaqfAssetRegistry {
  readonly version: typeof SHARIA_MIZAN_LEDGER_VERSION;
  readonly assets: readonly WaqfAsset[];
  readonly assetsById: Readonly<Record<string, WaqfAsset>>;
}

export interface WaqfDispositionCheck {
  readonly assetId: string;
  readonly disposition: WaqfAssetDisposition;
  readonly allowed: false;
  readonly code: 'waqf-disposition-forbidden';
  readonly reason: string;
}

function requireIdentifier(value: string, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 300) {
    throw new ShariaMizanLedgerError(
      'invalid-identifier',
      `${path} must contain 1 to 300 characters.`
    );
  }
  return value;
}

function requireMinorUnits(value: number, path: string, allowZero: boolean): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) {
    throw new ShariaMizanLedgerError(
      'invalid-amount',
      `${path} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer in minor units.`
    );
  }
  return value;
}

function requireBasisPoints(value: number, path: string): number {
  if (!Number.isInteger(value) || value < 0 || value > BASIS_POINTS_TOTAL) {
    throw new ShariaMizanLedgerError(
      'invalid-amount',
      `${path} must be an integer from 0 to ${BASIS_POINTS_TOTAL}.`
    );
  }
  return value;
}

function safeFromBigInt(value: bigint, path: string): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ShariaMizanLedgerError('invalid-amount', `${path} exceeds the safe integer range.`);
  }
  return Number(value);
}

function requireTerm(termStart: string, termEnd: string): void {
  requireIdentifier(termStart, 'termStart');
  requireIdentifier(termEnd, 'termEnd');
  const start = Date.parse(termStart);
  const end = Date.parse(termEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new ShariaMizanLedgerError(
      'invalid-term',
      'Contract term must have a start before its end.'
    );
  }
}

function requireParty(party: ContractParty, path: string): void {
  requireIdentifier(party?.id, `${path}.id`);
  requireIdentifier(party?.name, `${path}.name`);
}

function auditFromIssues(
  contractType: ShariaContractAudit['contractType'],
  contractId: string,
  issues: ContractAuditIssue[]
): ShariaContractAudit {
  return {
    version: SHARIA_MIZAN_LEDGER_VERSION,
    contractType,
    contractId,
    compliant: issues.length === 0,
    issues: Object.freeze([...issues].sort((left, right) => left.path.localeCompare(right.path))),
  };
}

/** Check that every journal's total debit equals its total credit. */
export function checkDoubleEntryInvariant(
  journal: DoubleEntryJournalInput
): DoubleEntryInvariantResult {
  const journalId = requireIdentifier(journal?.journalId, 'journalId');
  if (!Array.isArray(journal.lines)) {
    throw new ShariaMizanLedgerError('invalid-identifier', 'journal.lines must be an array.');
  }

  const issues: JournalIssue[] = [];
  let debitTotal = 0n;
  let creditTotal = 0n;
  const lineIds = new Set<string>();

  journal.lines.forEach((line, index) => {
    const path = `/lines/${index}`;
    requireIdentifier(line?.id, `${path}/id`);
    requireIdentifier(line?.accountCode, `${path}/accountCode`);
    if (lineIds.has(line.id)) {
      issues.push({
        path: `${path}/id`,
        code: 'invalid-identifier',
        message: `duplicate journal line ID: ${line.id}`,
      });
    }
    lineIds.add(line.id);
    const debit = requireMinorUnits(line.debitMinorUnits, `${path}/debitMinorUnits`, true);
    const credit = requireMinorUnits(line.creditMinorUnits, `${path}/creditMinorUnits`, true);
    if (debit === 0 && credit === 0) {
      issues.push({
        path,
        code: 'zero-value-line',
        message: 'journal line must post a debit or a credit',
      });
    }
    if (debit > 0 && credit > 0) {
      issues.push({
        path,
        code: 'dual-sided-line',
        message: 'journal line must post only one side',
      });
    }
    debitTotal += BigInt(debit);
    creditTotal += BigInt(credit);
  });

  const totalDebitMinorUnits = safeFromBigInt(debitTotal, 'totalDebitMinorUnits');
  const totalCreditMinorUnits = safeFromBigInt(creditTotal, 'totalCreditMinorUnits');
  const difference = debitTotal - creditTotal;
  if (difference !== 0n) {
    issues.push({
      path: '/lines',
      code: 'unbalanced-journal',
      message: `total debit ${totalDebitMinorUnits} differs from total credit ${totalCreditMinorUnits}`,
    });
  }

  return {
    journalId,
    balanced: difference === 0n,
    totalDebitMinorUnits,
    totalCreditMinorUnits,
    differenceMinorUnits: safeFromBigInt(
      difference < 0n ? -difference : difference,
      'differenceMinorUnits'
    ),
    lineCount: journal.lines.length,
    issues: Object.freeze(issues),
  };
}

/** Fail closed when a journal is not balanced. */
export function assertDoubleEntryBalanced(
  journal: DoubleEntryJournalInput
): DoubleEntryInvariantResult {
  const result = checkDoubleEntryInvariant(journal);
  if (!result.balanced) {
    throw new ShariaMizanLedgerError(
      'unbalanced-journal',
      `Journal ${result.journalId} is not balanced.`
    );
  }
  return result;
}

/** Calculate corporate zakat at 2.5% after haul and nisab thresholds are met. */
export function calculateCorporateZakat(input: CorporateZakatInput): CorporateZakatResult {
  const entityId = requireIdentifier(input?.entityId, 'entityId');
  const assessmentId = requireIdentifier(input?.assessmentId, 'assessmentId');
  const wealth = requireMinorUnits(
    input.zakatableWealthMinorUnits,
    'zakatableWealthMinorUnits',
    true
  );
  const nisab = requireMinorUnits(
    input.nisabThresholdMinorUnits,
    'nisabThresholdMinorUnits',
    false
  );
  if (!Number.isSafeInteger(input.haulLunarDays) || input.haulLunarDays < 0) {
    throw new ShariaMizanLedgerError(
      'invalid-term',
      'haulLunarDays must be a non-negative safe integer.'
    );
  }

  const haulCompleted = input.haulLunarDays >= MINIMUM_HAUL_LUNAR_DAYS;
  const nisabMet = wealth >= nisab;
  const status: CorporateZakatResult['status'] = !haulCompleted
    ? 'haul-incomplete'
    : !nisabMet
      ? 'below-nisab'
      : 'due';
  const dueMinorUnits =
    status === 'due'
      ? safeFromBigInt(
          (BigInt(wealth) * BigInt(ZAKAT_RATE_NUMERATOR)) / BigInt(ZAKAT_RATE_DENOMINATOR),
          'dueMinorUnits'
        )
      : 0;

  return {
    version: SHARIA_MIZAN_LEDGER_VERSION,
    entityId,
    assessmentId,
    status,
    rate: {
      numerator: ZAKAT_RATE_NUMERATOR,
      denominator: ZAKAT_RATE_DENOMINATOR,
      percent: '2.5',
      rounding: 'floor-to-minor-unit',
    },
    zakatableWealthMinorUnits: wealth,
    nisabThresholdMinorUnits: nisab,
    haulLunarDays: input.haulLunarDays,
    haulCompleted,
    nisabMet,
    dueMinorUnits,
  };
}

/** Audit a mudharabah partnership for profit split, capital, tenure, and loss rules. */
export function auditMudharabahContract(input: MudharabahContractInput): ShariaContractAudit {
  const contractId = requireIdentifier(input?.contractId, 'contractId');
  requireParty(input.capitalOwner, 'capitalOwner');
  requireParty(input.entrepreneur, 'entrepreneur');
  requireMinorUnits(input.capitalMinorUnits, 'capitalMinorUnits', false);
  requireBasisPoints(
    input.capitalOwnerProfitShareBasisPoints,
    'capitalOwnerProfitShareBasisPoints'
  );
  requireBasisPoints(
    input.entrepreneurProfitShareBasisPoints,
    'entrepreneurProfitShareBasisPoints'
  );
  requireTerm(input.termStart, input.termEnd);

  const issues: ContractAuditIssue[] = [];
  if (input.capitalOwner.id === input.entrepreneur.id) {
    issues.push({
      path: '/entrepreneur',
      code: 'invalid-party',
      message: 'capital owner and entrepreneur must be distinct parties',
    });
  }
  if (!input.capitalConveyed) {
    issues.push({
      path: '/capitalConveyed',
      code: 'invalid-amount',
      message: 'capital must be conveyed to the entrepreneur before profit accrues',
    });
  }
  if (
    input.capitalOwnerProfitShareBasisPoints + input.entrepreneurProfitShareBasisPoints !==
    BASIS_POINTS_TOTAL
  ) {
    issues.push({
      path: '/entrepreneurProfitShareBasisPoints',
      code: 'profit-split-mismatch',
      message: 'profit shares must sum to 10,000 basis points',
    });
  }
  if (input.principalGuaranteed) {
    issues.push({
      path: '/principalGuaranteed',
      code: 'principal-guarantee',
      message: 'mudharabah capital must not be guaranteed by the entrepreneur',
    });
  }
  if (
    input.lossAllocation !== 'capital-owner' &&
    input.lossAllocation !== 'capital-owner-except-entrepreneur-misconduct'
  ) {
    issues.push({
      path: '/lossAllocation',
      code: 'invalid-loss-allocation',
      message: 'losses must remain with the capital owner absent entrepreneur misconduct',
    });
  }

  return auditFromIssues('mudharabah', contractId, issues);
}

/** Audit a murabahah sale for cost-plus price, disclosure, ownership, and fixed price. */
export function auditMurabahahContract(input: MurabahahContractInput): ShariaContractAudit {
  const contractId = requireIdentifier(input?.contractId, 'contractId');
  requireParty(input.seller, 'seller');
  requireParty(input.buyer, 'buyer');
  requireIdentifier(input.assetDescription, 'assetDescription');
  const cost = requireMinorUnits(
    input.acquisitionCostMinorUnits,
    'acquisitionCostMinorUnits',
    false
  );
  const margin = requireMinorUnits(
    input.disclosedMarginMinorUnits,
    'disclosedMarginMinorUnits',
    true
  );
  requireMinorUnits(input.salePriceMinorUnits, 'salePriceMinorUnits', false);
  requireTerm(input.termStart, input.termEnd);

  const issues: ContractAuditIssue[] = [];
  if (input.seller.id === input.buyer.id) {
    issues.push({
      path: '/buyer',
      code: 'invalid-party',
      message: 'seller and buyer must be distinct parties',
    });
  }
  if (BigInt(input.salePriceMinorUnits) !== BigInt(cost) + BigInt(margin)) {
    issues.push({
      path: '/salePriceMinorUnits',
      code: 'price-mismatch',
      message: 'sale price must equal acquisition cost plus disclosed margin',
    });
  }
  if (!input.marginDisclosed) {
    issues.push({
      path: '/marginDisclosed',
      code: 'undisclosed-margin',
      message: 'murabahah margin must be disclosed before the sale',
    });
  }
  if (!input.sellerOwnedBeforeSale) {
    issues.push({
      path: '/sellerOwnedBeforeSale',
      code: 'missing-ownership',
      message: 'seller must own the asset before resale',
    });
  }
  if (!input.sellerPossessedBeforeSale) {
    issues.push({
      path: '/sellerPossessedBeforeSale',
      code: 'missing-possession',
      message: 'seller must take possession before resale',
    });
  }
  if (!input.deferredPriceFixed) {
    issues.push({
      path: '/deferredPriceFixed',
      code: 'unfixed-price',
      message: 'deferred sale price must be fixed at contract formation',
    });
  }
  if (input.interestAdjustmentApplied) {
    issues.push({
      path: '/interestAdjustmentApplied',
      code: 'interest-adjustment',
      message: 'deferred price must not carry interest-based adjustments',
    });
  }

  return auditFromIssues('murabahah', contractId, issues);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}

/** Deterministic initial waqf registry; assets are perpetual and cannot be disposed of. */
export const INITIAL_WAQF_ASSETS: readonly WaqfAsset[] = deepFreeze([
  {
    id: 'mw:waqf-asset:jakarta-madani-pesantren',
    name: 'Pondok Pesantren Madani Jagakarsa',
    kind: 'building',
    location: 'Jagakarsa, Jakarta Selatan, DKI Jakarta',
    endowedAt: '2024-01-15T00:00:00.000Z',
    perpetual: true as const,
    beneficiaries: ['students', 'local-community'],
    prohibitedDispositions: ['sale', 'transfer', 'mortgage'] as const,
  },
  {
    id: 'mw:waqf-asset:bandung-utama-mosque-land',
    name: 'Tanah Wakaf Masjid Raya Bandung Utama',
    kind: 'land',
    location: 'Coblong, Bandung, Jawa Barat',
    endowedAt: '2024-02-01T00:00:00.000Z',
    perpetual: true as const,
    beneficiaries: ['congregation', 'community-programs'],
    prohibitedDispositions: ['sale', 'transfer', 'mortgage'] as const,
  },
  {
    id: 'mw:waqf-asset:semarang-productive-workshop',
    name: 'Bengkel Produktif Wakaf Semarang',
    kind: 'productive-enterprise',
    location: 'Semarang Tengah, Semarang, Jawa Tengah',
    endowedAt: '2024-03-10T00:00:00.000Z',
    perpetual: true as const,
    beneficiaries: ['apprentices', 'low-income-households'],
    prohibitedDispositions: ['sale', 'transfer', 'mortgage'] as const,
  },
  {
    id: 'mw:waqf-asset:tegalrejo-irrigated-farmland',
    name: 'Lahan Pertanian Wakaf Tegalrejo',
    kind: 'land',
    location: 'Tegalrejo, Magelang, Jawa Tengah',
    endowedAt: '2024-04-22T00:00:00.000Z',
    perpetual: true as const,
    beneficiaries: ['farmers', 'food-security-program'],
    prohibitedDispositions: ['sale', 'transfer', 'mortgage'] as const,
  },
]);

/** Build an immutable registry with deterministic asset order and ID lookup. */
export function buildInitialWaqfAssetRegistry(): WaqfAssetRegistry {
  const assetsById = Object.fromEntries(INITIAL_WAQF_ASSETS.map((asset) => [asset.id, asset]));
  return deepFreeze({
    version: SHARIA_MIZAN_LEDGER_VERSION,
    assets: [...INITIAL_WAQF_ASSETS],
    assetsById,
  });
}

/** Locate a waqf asset by its canonical registry ID. */
export function findWaqfAsset(registry: WaqfAssetRegistry, assetId: string): WaqfAsset | undefined {
  requireIdentifier(assetId, 'assetId');
  return registry?.assetsById?.[assetId];
}

/** Waqf assets are perpetual; sale, transfer, and mortgage are never allowed. */
export function checkWaqfAssetDisposition(
  asset: WaqfAsset,
  disposition: WaqfAssetDisposition
): WaqfDispositionCheck {
  if (!asset || !asset.id || !asset.perpetual) {
    throw new ShariaMizanLedgerError('invalid-identifier', 'A perpetual waqf asset is required.');
  }
  if (!asset.prohibitedDispositions.includes(disposition)) {
    throw new ShariaMizanLedgerError(
      'waqf-disposition-forbidden',
      `${disposition} is not a waqf disposition kind.`
    );
  }
  return {
    assetId: asset.id,
    disposition,
    allowed: false,
    code: 'waqf-disposition-forbidden',
    reason: `${disposition} is prohibited because waqf assets are held in perpetuity.`,
  };
}

/** Throw for any attempted sale, transfer, or mortgage of a waqf asset. */
export function assertWaqfAssetDispositionAllowed(
  asset: WaqfAsset,
  disposition: WaqfAssetDisposition
): void {
  const check = checkWaqfAssetDisposition(asset, disposition);
  throw new ShariaMizanLedgerError(check.code, check.reason);
}
