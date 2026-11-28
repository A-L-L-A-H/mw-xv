export type ChurnRiskBand = 'low' | 'medium' | 'high' | 'critical';

export type RetentionChannel = 'whatsapp' | 'email';

export interface ChurnSignalInput {
  customerId: string;
  tenantId: string;
  /** Days since last meaningful product activity or login. */
  daysSinceLastActive: number;
  /** Number of overdue invoices currently unpaid. */
  overdueInvoiceCount: number;
  /** Number of failed payment attempts in the last 30 days. */
  failedPaymentCount30d: number;
  /** Number of open unresolved support tickets. */
  openSupportTickets: number;
  /** Number of open critical/high-severity support tickets. */
  criticalSupportTickets: number;
  /** Percentage change in usage vs previous 30d baseline (e.g. -45 means 45% drop). */
  usageDeltaPct: number;
  /** Days until subscription/contract renewal (negative if past due). */
  daysToRenewal?: number;
  /** Monthly recurring revenue in minor/major currency units for prioritization. */
  mrrAmount?: number;
  currency?: string;
}

export interface ChurnRiskFactor {
  code:
    | 'inactivity'
    | 'overdue_invoices'
    | 'failed_payments'
    | 'support_friction'
    | 'usage_drop'
    | 'renewal_proximity';
  label: string;
  points: number;
  detail: string;
}

export interface ChurnRiskAssessment {
  customerId: string;
  tenantId: string;
  score: number;
  band: ChurnRiskBand;
  factors: ChurnRiskFactor[];
  recommendedOfferCode: string | null;
  evaluatedAt: string;
}

export interface CustomerRetentionContact {
  customerId: string;
  tenantId: string;
  displayName: string;
  whatsappPhone?: string | null;
  email?: string | null;
  whatsappOptIn: boolean;
  emailOptIn: boolean;
  suppressed?: boolean;
}

export interface RetentionOfferTemplate {
  offerCode: string;
  title: string;
  discountPct: number;
  validDays: number;
  messageBody: string;
}

export interface RetentionOfferDispatchRequest {
  idempotencyKey: string;
  customerId: string;
  tenantId: string;
  channel: RetentionChannel;
  destination: string;
  offer: RetentionOfferTemplate;
  riskScore: number;
  riskBand: ChurnRiskBand;
  dispatchedAt: string;
}

export interface RetentionOfferDispatchReceipt {
  idempotencyKey: string;
  channel: RetentionChannel;
  accepted: boolean;
  providerMessageId: string;
  dispatchedAt: string;
}

export interface RetentionOfferDispatcher {
  send(
    request: RetentionOfferDispatchRequest
  ): Promise<RetentionOfferDispatchReceipt> | RetentionOfferDispatchReceipt;
}

export interface RetentionRateLimitPolicy {
  /** Minimum risk band required to trigger a retention offer. Default: 'high'. */
  minBand?: ChurnRiskBand;
  /** Cooldown between offers on the same channel for a customer (ms). Default: 72h. */
  channelCooldownMs?: number;
  /** Rolling window duration for maxOffersPerWindow (ms). Default: 30d. */
  rollingWindowMs?: number;
  /** Maximum total offers across all channels per customer in rollingWindowMs. Default: 3. */
  maxOffersPerWindow?: number;
  /** Preferred channel order. Default: ['whatsapp', 'email']. */
  channelPriority?: RetentionChannel[];
}

export interface RetentionDispatchRecord {
  idempotencyKey: string;
  customerId: string;
  tenantId: string;
  channel: RetentionChannel;
  offerCode: string;
  sentAtMs: number;
  receipt: RetentionOfferDispatchReceipt;
}

export interface RetentionRateLimitStore {
  getByIdempotencyKey(key: string): RetentionDispatchRecord | undefined;
  listCustomerDispatches(tenantId: string, customerId: string): RetentionDispatchRecord[];
  recordDispatch(record: RetentionDispatchRecord): void;
}

export type RetentionWorkflowStatus = 'dispatched' | 'duplicate' | 'rate_limited' | 'skipped';

export interface RetentionWorkflowResult {
  status: RetentionWorkflowStatus;
  reason?: string;
  assessment: ChurnRiskAssessment;
  channel?: RetentionChannel;
  offer?: RetentionOfferTemplate;
  receipt?: RetentionOfferDispatchReceipt;
}
