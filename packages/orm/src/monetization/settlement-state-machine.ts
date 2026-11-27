import type {
  EntitlementAction,
  EntitlementActionSpec,
  EntitlementDispatcher,
  EntitlementDispatchReceipt,
  SettlementProcessResult,
  SettlementRecord,
  SettlementState,
  VerifiedWebhookEvent,
} from './types.js';

/**
 * Persistence contract for webhook idempotency and settlement state transitions.
 */
export interface SettlementDeduplicationStore {
  hasProcessedEvent(eventKey: string): Promise<boolean> | boolean;
  getByTransactionKey(transactionKey: string): Promise<SettlementRecord | undefined> | SettlementRecord | undefined;
  save(record: SettlementRecord): Promise<void> | void;
}

/**
 * Default in-memory deduplication store for single-process execution and unit testing.
 */
export class InMemorySettlementStore implements SettlementDeduplicationStore {
  private readonly recordsByTxKey = new Map<string, SettlementRecord>();
  private readonly seenEventKeys = new Set<string>();

  public hasProcessedEvent(eventKey: string): boolean {
    return this.seenEventKeys.has(eventKey);
  }

  public getByTransactionKey(transactionKey: string): SettlementRecord | undefined {
    const existing = this.recordsByTxKey.get(transactionKey);
    return existing ? cloneRecord(existing) : undefined;
  }

  public save(record: SettlementRecord): void {
    for (const key of record.processedEventKeys) {
      this.seenEventKeys.add(key);
    }
    this.recordsByTxKey.set(record.transactionKey, cloneRecord(record));
  }
}

function cloneRecord(record: SettlementRecord): SettlementRecord {
  return {
    ...record,
    processedEventKeys: [...record.processedEventKeys],
    dispatchedActions: record.dispatchedActions.map((action) => ({ ...action })),
    receipts: record.receipts.map((receipt) => ({ ...receipt })),
  };
}

export type EntitlementResolver = (
  event: VerifiedWebhookEvent
) => Promise<EntitlementActionSpec[]> | EntitlementActionSpec[];

export interface SettlementStateMachineOptions {
  store: SettlementDeduplicationStore;
  dispatcher: EntitlementDispatcher;
  resolveEntitlements: EntitlementResolver;
  now?: () => string;
}

const NON_SETTLEMENT_TRANSITION: Record<
  Exclude<VerifiedWebhookEvent['eventType'], 'payment.settled'>,
  SettlementState
> = {
  'payment.pending': 'PENDING',
  'payment.failed': 'FAILED',
  'payment.expired': 'EXPIRED',
  'payment.refunded': 'REFUNDED',
};

const TERMINAL_SETTLED_STATES = new Set<SettlementState>(['SETTLED', 'DISPATCHED']);

function buildTransactionKey(event: VerifiedWebhookEvent): string {
  return `${event.provider}:${event.orderId}`;
}

function buildEntitlementAction(
  spec: EntitlementActionSpec,
  event: VerifiedWebhookEvent,
  index: number
): EntitlementAction {
  const idempotencyKey = `${event.provider}:${event.transactionId}:${spec.target}:${spec.action}:${index}`;
  if (spec.target === 'mw-cp') {
    return {
      target: 'mw-cp',
      action: spec.action,
      tenantId: spec.tenantId,
      ...(spec.planCode ? { planCode: spec.planCode } : {}),
      ...(spec.quotaUnits !== undefined ? { quotaUnits: spec.quotaUnits } : {}),
      idempotencyKey,
      transactionId: event.transactionId,
      orderId: event.orderId,
      amount: event.amount,
      currency: event.currency,
      ...(spec.metadata ? { metadata: spec.metadata } : {}),
    };
  }
  return {
    target: 'mw-isp',
    action: spec.action,
    subscriberId: spec.subscriberId,
    ...(spec.routerId ? { routerId: spec.routerId } : {}),
    ...(spec.profileCode ? { profileCode: spec.profileCode } : {}),
    idempotencyKey,
    transactionId: event.transactionId,
    orderId: event.orderId,
    amount: event.amount,
    currency: event.currency,
    ...(spec.metadata ? { metadata: spec.metadata } : {}),
  };
}

function createInitialRecord(
  event: VerifiedWebhookEvent,
  transactionKey: string,
  timestamp: string
): SettlementRecord {
  return {
    transactionKey,
    orderId: event.orderId,
    transactionId: event.transactionId,
    provider: event.provider,
    state: 'INITIATED',
    amount: event.amount,
    currency: event.currency,
    processedEventKeys: [],
    dispatchedActions: [],
    receipts: [],
    updatedAt: timestamp,
  };
}

/**
 * Idempotent payment webhook state machine deduplicating by event/transaction key
 * and dispatching typed PaaS (`mw-cp`) and ISP (`mw-isp`) entitlement actions on `payment.settled`.
 */
export class PaymentSettlementStateMachine {
  private readonly store: SettlementDeduplicationStore;
  private readonly dispatcher: EntitlementDispatcher;
  private readonly resolveEntitlements: EntitlementResolver;
  private readonly now: () => string;

  public constructor(options: SettlementStateMachineOptions) {
    this.store = options.store;
    this.dispatcher = options.dispatcher;
    this.resolveEntitlements = options.resolveEntitlements;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async process(event: VerifiedWebhookEvent): Promise<SettlementProcessResult> {
    const transactionKey = buildTransactionKey(event);
    const existing = await this.store.getByTransactionKey(transactionKey);
    const eventSeen = await this.store.hasProcessedEvent(event.eventKey);

    if (eventSeen && existing) {
      return {
        status: 'duplicate',
        deduplicated: true,
        reason: `Duplicate event key: ${event.eventKey}`,
        state: existing.state,
        record: existing,
        dispatchedActions: [],
        receipts: [],
      };
    }

    const timestamp = this.now();
    const record = existing ?? createInitialRecord(event, transactionKey, timestamp);

    if (event.eventType !== 'payment.settled') {
      return this.handleNonSettlementEvent(record, event, timestamp);
    }

    if (TERMINAL_SETTLED_STATES.has(record.state)) {
      record.processedEventKeys.push(event.eventKey);
      record.updatedAt = timestamp;
      await this.store.save(record);
      return {
        status: 'duplicate',
        deduplicated: true,
        reason: `Transaction already in ${record.state} state: ${transactionKey}`,
        state: record.state,
        record,
        dispatchedActions: [],
        receipts: [],
      };
    }

    return this.handleSettlement(record, event, timestamp);
  }

  private async handleNonSettlementEvent(
    record: SettlementRecord,
    event: VerifiedWebhookEvent,
    timestamp: string
  ): Promise<SettlementProcessResult> {
    const nextState =
      NON_SETTLEMENT_TRANSITION[
        event.eventType as Exclude<VerifiedWebhookEvent['eventType'], 'payment.settled'>
      ];

    // Prevent stale pending events from regressing an already settled/dispatched payment.
    if (TERMINAL_SETTLED_STATES.has(record.state) && nextState !== 'REFUNDED') {
      record.processedEventKeys.push(event.eventKey);
      record.updatedAt = timestamp;
      await this.store.save(record);
      return {
        status: 'ignored',
        deduplicated: true,
        reason: `Ignored ${event.eventType} for already settled transaction.`,
        state: record.state,
        record,
        dispatchedActions: [],
        receipts: [],
      };
    }

    record.state = nextState;
    record.transactionId = event.transactionId;
    record.processedEventKeys.push(event.eventKey);
    record.updatedAt = timestamp;
    await this.store.save(record);

    return {
      status: 'processed',
      deduplicated: false,
      state: record.state,
      record,
      dispatchedActions: [],
      receipts: [],
    };
  }

  private async handleSettlement(
    record: SettlementRecord,
    event: VerifiedWebhookEvent,
    timestamp: string
  ): Promise<SettlementProcessResult> {
    const specs = await this.resolveEntitlements(event);
    const actions = specs.map((spec, index) => buildEntitlementAction(spec, event, index));
    const receipts: EntitlementDispatchReceipt[] = [];

    for (const action of actions) {
      const receipt = await this.dispatcher.dispatch(action);
      receipts.push(receipt);
    }

    record.state = 'DISPATCHED';
    record.transactionId = event.transactionId;
    record.amount = event.amount;
    record.currency = event.currency;
    record.processedEventKeys.push(event.eventKey);
    record.dispatchedActions.push(...actions);
    record.receipts.push(...receipts);
    record.updatedAt = timestamp;
    await this.store.save(record);

    return {
      status: 'processed',
      deduplicated: false,
      state: record.state,
      record,
      dispatchedActions: actions,
      receipts,
    };
  }
}
