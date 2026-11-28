import { scoreChurnRisk } from './churn-scorer.js';
import type {
  ChurnRiskBand,
  ChurnSignalInput,
  CustomerRetentionContact,
  RetentionChannel,
  RetentionDispatchRecord,
  RetentionOfferDispatcher,
  RetentionOfferTemplate,
  RetentionRateLimitPolicy,
  RetentionRateLimitStore,
  RetentionWorkflowResult,
} from './types.js';

const BAND_RANK: Record<ChurnRiskBand, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const DEFAULT_CHANNEL_COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72 hours
const DEFAULT_ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_MAX_OFFERS_PER_WINDOW = 3;
const DEFAULT_CHANNEL_PRIORITY: RetentionChannel[] = ['whatsapp', 'email'];

export const DEFAULT_RETENTION_OFFERS: Record<string, RetentionOfferTemplate> = {
  RETENTION_VIP_30: {
    offerCode: 'RETENTION_VIP_30',
    title: '30% VIP Continuity Credit',
    discountPct: 30,
    validDays: 7,
    messageBody:
      'We value your partnership. Claim 30% off your next billing cycle plus priority onboarding support.',
  },
  RETENTION_SAVE_20: {
    offerCode: 'RETENTION_SAVE_20',
    title: '20% Retention Credit',
    discountPct: 20,
    validDays: 7,
    messageBody:
      'Stay with us and unlock 20% off your upcoming renewal along with a dedicated health check.',
  },
  RETENTION_CHECKIN_10: {
    offerCode: 'RETENTION_CHECKIN_10',
    title: '10% Loyalty Appreciation',
    discountPct: 10,
    validDays: 14,
    messageBody:
      'Need a hand getting more value? Here is 10% off your next invoice and a quick check-in link.',
  },
};

export class InMemoryRetentionRateLimitStore implements RetentionRateLimitStore {
  private readonly byKey = new Map<string, RetentionDispatchRecord>();
  private readonly byCustomer = new Map<string, RetentionDispatchRecord[]>();

  private customerKey(tenantId: string, customerId: string): string {
    return `${tenantId}::${customerId}`;
  }

  getByIdempotencyKey(key: string): RetentionDispatchRecord | undefined {
    return this.byKey.get(key);
  }

  listCustomerDispatches(tenantId: string, customerId: string): RetentionDispatchRecord[] {
    return this.byCustomer.get(this.customerKey(tenantId, customerId)) ?? [];
  }

  recordDispatch(record: RetentionDispatchRecord): void {
    this.byKey.set(record.idempotencyKey, record);
    const key = this.customerKey(record.tenantId, record.customerId);
    const existing = this.byCustomer.get(key) ?? [];
    existing.push(record);
    this.byCustomer.set(key, existing);
  }
}

export interface RetentionOfferWorkflowOptions {
  dispatcher: RetentionOfferDispatcher;
  store?: RetentionRateLimitStore;
  policy?: RetentionRateLimitPolicy;
  offers?: Record<string, RetentionOfferTemplate>;
  nowMs?: () => number;
}

export class RetentionOfferWorkflow {
  private readonly dispatcher: RetentionOfferDispatcher;
  private readonly store: RetentionRateLimitStore;
  private readonly minBand: ChurnRiskBand;
  private readonly channelCooldownMs: number;
  private readonly rollingWindowMs: number;
  private readonly maxOffersPerWindow: number;
  private readonly channelPriority: RetentionChannel[];
  private readonly offers: Record<string, RetentionOfferTemplate>;
  private readonly nowMs: () => number;

  constructor(options: RetentionOfferWorkflowOptions) {
    this.dispatcher = options.dispatcher;
    this.store = options.store ?? new InMemoryRetentionRateLimitStore();
    this.minBand = options.policy?.minBand ?? 'high';
    this.channelCooldownMs = options.policy?.channelCooldownMs ?? DEFAULT_CHANNEL_COOLDOWN_MS;
    this.rollingWindowMs = options.policy?.rollingWindowMs ?? DEFAULT_ROLLING_WINDOW_MS;
    this.maxOffersPerWindow = options.policy?.maxOffersPerWindow ?? DEFAULT_MAX_OFFERS_PER_WINDOW;
    this.channelPriority = options.policy?.channelPriority ?? DEFAULT_CHANNEL_PRIORITY;
    this.offers = options.offers ?? DEFAULT_RETENTION_OFFERS;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  async evaluateAndDispatch(params: {
    signals: ChurnSignalInput;
    contact: CustomerRetentionContact;
    idempotencyKey: string;
  }): Promise<RetentionWorkflowResult> {
    const currentMs = this.nowMs();
    const nowIso = new Date(currentMs).toISOString();
    const assessment = scoreChurnRisk(params.signals, { now: () => nowIso });

    const existing = this.store.getByIdempotencyKey(params.idempotencyKey);
    if (existing) {
      return {
        status: 'duplicate',
        reason: `Idempotency key ${params.idempotencyKey} already dispatched`,
        assessment,
        channel: existing.channel,
        offer: this.offers[existing.offerCode],
        receipt: existing.receipt,
      };
    }

    if (params.contact.suppressed) {
      return {
        status: 'skipped',
        reason: 'Customer is suppressed from retention outreach',
        assessment,
      };
    }

    if (BAND_RANK[assessment.band] < BAND_RANK[this.minBand]) {
      return {
        status: 'skipped',
        reason: `Risk band ${assessment.band} is below threshold ${this.minBand}`,
        assessment,
      };
    }

    const offerCode = assessment.recommendedOfferCode;
    const offer = offerCode ? this.offers[offerCode] : undefined;
    if (!offer) {
      return {
        status: 'skipped',
        reason: 'No retention offer template configured for risk band',
        assessment,
      };
    }

    const history = this.store.listCustomerDispatches(
      params.signals.tenantId,
      params.signals.customerId
    );
    const windowStart = currentMs - this.rollingWindowMs;
    const recentInWindow = history.filter((entry) => entry.sentAtMs >= windowStart);

    if (recentInWindow.length >= this.maxOffersPerWindow) {
      return {
        status: 'rate_limited',
        reason: `Customer reached rolling window cap (${this.maxOffersPerWindow} offers)`,
        assessment,
        offer,
      };
    }

    let eligibleChannelCount = 0;
    let selected: { channel: RetentionChannel; destination: string } | null = null;

    for (const channel of this.channelPriority) {
      const destination = this.resolveChannelDestination(params.contact, channel);
      if (!destination) continue;
      eligibleChannelCount += 1;

      const lastOnChannel = history
        .filter((entry) => entry.channel === channel)
        .reduce<number>((latest, entry) => Math.max(latest, entry.sentAtMs), -Infinity);

      if (currentMs - lastOnChannel < this.channelCooldownMs) {
        continue;
      }

      selected = { channel, destination };
      break;
    }

    if (eligibleChannelCount === 0) {
      return {
        status: 'skipped',
        reason: 'No opted-in WhatsApp or Email destination available',
        assessment,
        offer,
      };
    }

    if (!selected) {
      return {
        status: 'rate_limited',
        reason: 'All opted-in retention channels are within cooldown window',
        assessment,
        offer,
      };
    }

    const receipt = await this.dispatcher.send({
      idempotencyKey: params.idempotencyKey,
      customerId: params.signals.customerId,
      tenantId: params.signals.tenantId,
      channel: selected.channel,
      destination: selected.destination,
      offer,
      riskScore: assessment.score,
      riskBand: assessment.band,
      dispatchedAt: nowIso,
    });

    this.store.recordDispatch({
      idempotencyKey: params.idempotencyKey,
      customerId: params.signals.customerId,
      tenantId: params.signals.tenantId,
      channel: selected.channel,
      offerCode: offer.offerCode,
      sentAtMs: currentMs,
      receipt,
    });

    return {
      status: 'dispatched',
      assessment,
      channel: selected.channel,
      offer,
      receipt,
    };
  }

  private resolveChannelDestination(
    contact: CustomerRetentionContact,
    channel: RetentionChannel
  ): string | null {
    if (channel === 'whatsapp') {
      const phone = contact.whatsappPhone?.trim();
      return contact.whatsappOptIn && phone ? phone : null;
    }
    const email = contact.email?.trim();
    return contact.emailOptIn && email ? email : null;
  }
}
