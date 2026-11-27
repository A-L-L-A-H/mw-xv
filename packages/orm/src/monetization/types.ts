export type PaymentProvider = 'midtrans' | 'xendit';

export type PaymentWebhookEventType =
  | 'payment.settled'
  | 'payment.pending'
  | 'payment.failed'
  | 'payment.expired'
  | 'payment.refunded';

export type PaymentChannel = 'snap' | 'qris' | 'virtual_account' | 'other';

export interface MidtransWebhookPayload {
  order_id: string;
  status_code: string | number;
  gross_amount: string | number;
  signature_key: string;
  transaction_status: string;
  fraud_status?: string;
  transaction_id?: string;
  payment_type?: string;
  transaction_time?: string;
  settlement_time?: string;
  currency?: string;
  custom_field1?: string;
  custom_field2?: string;
  custom_field3?: string;
  metadata?: Record<string, unknown>;
}

export interface XenditVaWebhookPayload {
  id: string;
  external_id: string;
  payment_id?: string;
  callback_virtual_account_id?: string;
  bank_code?: string;
  account_number?: string;
  amount?: number;
  currency?: string;
  status?: string;
  transaction_timestamp?: string;
  created?: string;
  updated?: string;
  metadata?: Record<string, unknown>;
}

export interface VerifiedWebhookEvent {
  provider: PaymentProvider;
  channel: PaymentChannel;
  eventType: PaymentWebhookEventType;
  eventKey: string;
  transactionId: string;
  orderId: string;
  amount: number;
  currency: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  raw: unknown;
}

export interface MidtransAdapterConfig {
  serverKey: string;
  now?: () => string;
}

export type XenditVerificationMode = 'callback-token' | 'hmac-sha512' | 'both' | 'either';

export interface XenditAdapterConfig {
  callbackToken?: string;
  hmacSecret?: string;
  verificationMode?: XenditVerificationMode;
  now?: () => string;
}

export type SettlementState =
  | 'INITIATED'
  | 'PENDING'
  | 'SETTLED'
  | 'DISPATCHED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUNDED';

export type EntitlementTarget = 'mw-cp' | 'mw-isp';

export type PaasEntitlementActionType =
  | 'mw-cp.tenant.provision'
  | 'mw-cp.plan.activate'
  | 'mw-cp.quota.topup'
  | 'mw-cp.subscription.renew';

export type IspEntitlementActionType =
  | 'mw-isp.subscriber.activate'
  | 'mw-isp.pppoe.unblock'
  | 'mw-isp.bandwidth.upgrade'
  | 'mw-isp.hotspot.voucher_issue';

export interface PaasEntitlementAction {
  target: 'mw-cp';
  action: PaasEntitlementActionType;
  tenantId: string;
  planCode?: string;
  quotaUnits?: number;
  idempotencyKey: string;
  transactionId: string;
  orderId: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface IspEntitlementAction {
  target: 'mw-isp';
  action: IspEntitlementActionType;
  subscriberId: string;
  routerId?: string;
  profileCode?: string;
  idempotencyKey: string;
  transactionId: string;
  orderId: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export type EntitlementAction = PaasEntitlementAction | IspEntitlementAction;

export type EntitlementActionSpec =
  | {
      target: 'mw-cp';
      action: PaasEntitlementActionType;
      tenantId: string;
      planCode?: string;
      quotaUnits?: number;
      metadata?: Record<string, unknown>;
    }
  | {
      target: 'mw-isp';
      action: IspEntitlementActionType;
      subscriberId: string;
      routerId?: string;
      profileCode?: string;
      metadata?: Record<string, unknown>;
    };

export interface EntitlementDispatchReceipt {
  target: EntitlementTarget;
  action: string;
  idempotencyKey: string;
  accepted: boolean;
  dispatchedAt: string;
  referenceId?: string;
}

export interface EntitlementDispatcher {
  dispatch(action: EntitlementAction): Promise<EntitlementDispatchReceipt> | EntitlementDispatchReceipt;
}

export interface SettlementRecord {
  transactionKey: string;
  orderId: string;
  transactionId: string;
  provider: PaymentProvider;
  state: SettlementState;
  amount: number;
  currency: string;
  processedEventKeys: string[];
  dispatchedActions: EntitlementAction[];
  receipts: EntitlementDispatchReceipt[];
  updatedAt: string;
}

export interface SettlementProcessResult {
  status: 'processed' | 'duplicate' | 'ignored';
  deduplicated: boolean;
  reason?: string;
  state: SettlementState;
  record: SettlementRecord;
  dispatchedActions: EntitlementAction[];
  receipts: EntitlementDispatchReceipt[];
}

export type JournalSide = 'debit' | 'credit';

export interface JournalLine {
  accountCode: string;
  accountName: string;
  side: JournalSide;
  amount: number;
  currency: string;
  memo: string;
}

export interface JournalEntry {
  entryId: string;
  entryType: 'revenue_recognition' | 'pph_final_umkm_reserve' | 'zakat_maal_reserve';
  referenceId: string;
  postedAt: string;
  currency: string;
  lines: JournalLine[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
}

export interface MizanAccountConfig {
  cashClearingCode?: string;
  cashClearingName?: string;
  gatewayFeeCode?: string;
  gatewayFeeName?: string;
  revenueCode?: string;
  revenueName?: string;
  pphExpenseCode?: string;
  pphExpenseName?: string;
  pphReserveCode?: string;
  pphReserveName?: string;
  zakatExpenseCode?: string;
  zakatExpenseName?: string;
  zakatReserveCode?: string;
  zakatReserveName?: string;
}

export type ReserveCalculationBase = 'gross' | 'net_after_fee' | 'net_after_tax';

export interface MizanLedgerInput {
  referenceId: string;
  grossAmount: number;
  gatewayFee?: number;
  currency?: string;
  postedAt?: string;
  zakatBase?: ReserveCalculationBase;
  roundingMode?: 'half-up' | 'floor' | 'trunc';
  accounts?: MizanAccountConfig;
}

export interface MizanJournalBatch {
  referenceId: string;
  currency: string;
  postedAt: string;
  grossAmount: number;
  gatewayFee: number;
  pphFinalAmount: number;
  zakatMaalAmount: number;
  netRetainedAmount: number;
  entries: JournalEntry[];
  consolidatedLines: JournalLine[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
}

export type PiiFieldKind = 'email' | 'phone' | 'nik' | 'npwp' | 'name' | 'address' | 'ip' | 'generic';

export interface AnonymizationOptions {
  secretKey: string;
  fieldKinds?: Record<string, PiiFieldKind>;
  defaultFieldKind?: PiiFieldKind;
  anonymizedAt?: string;
}

export interface AnonymizationResult<T> {
  anonymized: T;
  fieldsAnonymized: string[];
  algorithm: 'HMAC-SHA256';
  reversible: false;
  anonymizedAt: string;
}

export interface UuPdpConsentRecord {
  consentId: string;
  purpose: string;
  granted: boolean;
  grantedAt: string;
  withdrawnAt?: string;
  legalBasis: string;
}

export interface UuPdpDsrExportInput {
  requestId: string;
  subjectId: string;
  tenantId: string;
  exportedAt?: string;
  retentionDays?: number;
  mode?: 'raw' | 'anonymized';
  anonymizationOptions?: AnonymizationOptions;
  profile: Record<string, unknown>;
  consents: UuPdpConsentRecord[];
  transactions?: Array<Record<string, unknown>>;
  entitlements?: Array<Record<string, unknown>>;
  ledgerReferences?: string[];
}

export interface UuPdpDsrBundlePayload {
  schemaVersion: 'uupdp-dsr/v1';
  legalBasis: 'UU No. 27 Tahun 2022 (UU PDP)';
  requestId: string;
  exportedAt: string;
  mode: 'raw' | 'anonymized';
  subject: {
    subjectId: string;
    tenantId: string;
  };
  retentionPolicy: {
    retentionDays: number;
    anonymizationAfterErasure: true;
  };
  profile: Record<string, unknown>;
  consents: UuPdpConsentRecord[];
  transactions: Array<Record<string, unknown>>;
  entitlements: Array<Record<string, unknown>>;
  ledgerReferences: string[];
}

export interface UuPdpDsrBundle extends UuPdpDsrBundlePayload {
  integrity: {
    algorithm: 'SHA-256';
    contentDigest: string;
  };
}
