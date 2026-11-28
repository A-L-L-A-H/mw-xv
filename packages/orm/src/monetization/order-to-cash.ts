import { createHash } from 'node:crypto';
import { generateMizanSettlementEntries } from './mizan-ledger.js';
import {
  InMemorySettlementStore,
  PaymentSettlementStateMachine,
  type EntitlementResolver,
  type SettlementDeduplicationStore,
} from './settlement-state-machine.js';
import type {
  EntitlementDispatcher,
  EntitlementDispatchReceipt,
  MidtransWebhookPayload,
  MizanJournalBatch,
  SettlementProcessResult,
  VerifiedWebhookEvent,
} from './types.js';
import { verifyMidtransWebhook } from './webhook-adapter.js';

export interface KwitansiReceiptPayload {
  receiptNumber: string;
  orderId: string;
  transactionId: string;
  tenantId: string;
  customerName: string;
  channel: 'whatsapp' | 'email';
  recipient: string;
  currency: 'IDR';
  grossAmountIdr: number;
  gatewayFeeIdr: number;
  netAmountIdr: number;
  pphFinalIdr: number;
  zakatMaalIdr: number;
  entitlements: EntitlementDispatchReceipt[];
  issuedAt: string;
  idempotencyKey: string;
  integritySha256: string;
}

export interface KwitansiDispatchResult {
  dispatched: boolean;
  messageId: string;
  channel: KwitansiReceiptPayload['channel'];
  recipient: string;
  idempotencyKey: string;
}

export interface KwitansiDispatcher {
  dispatch(payload: KwitansiReceiptPayload): Promise<KwitansiDispatchResult> | KwitansiDispatchResult;
}

export interface OrderToCashInput {
  payload: MidtransWebhookPayload;
  serverKey: string;
  tenantId: string;
  customerName: string;
  recipient: string;
  channel?: 'whatsapp' | 'email';
  gatewayFeeIdr?: number;
}

export interface OrderToCashResult {
  event: VerifiedWebhookEvent;
  settlement: SettlementProcessResult;
  duplicate: boolean;
  mizanBatch?: MizanJournalBatch;
  kwitansiPayload?: KwitansiReceiptPayload;
  kwitansiDispatch?: KwitansiDispatchResult;
}

export interface OrderToCashOrchestratorOptions {
  store?: SettlementDeduplicationStore;
  entitlementDispatcher: EntitlementDispatcher;
  resolveEntitlements: EntitlementResolver;
  kwitansiDispatcher: KwitansiDispatcher;
  now?: () => string;
}

function buildKwitansiPayload(params: {
  event: VerifiedWebhookEvent;
  mizanBatch: MizanJournalBatch;
  entitlements: EntitlementDispatchReceipt[];
  tenantId: string;
  customerName: string;
  recipient: string;
  channel: 'whatsapp' | 'email';
  gatewayFeeIdr: number;
  issuedAt: string;
}): KwitansiReceiptPayload {
  const { event, mizanBatch, entitlements, tenantId, customerName, recipient, channel, gatewayFeeIdr, issuedAt } =
    params;
  const receiptNumber = `KWT-${event.orderId}`;
  const idempotencyKey = `mw-echo:kwitansi:${event.provider}:${event.transactionId}`;
  const netAmountIdr = event.amount - gatewayFeeIdr;

  const canonical = JSON.stringify({
    receiptNumber,
    orderId: event.orderId,
    transactionId: event.transactionId,
    tenantId,
    grossAmountIdr: event.amount,
    gatewayFeeIdr,
    netAmountIdr,
    pphFinalIdr: mizanBatch.pphFinalAmount,
    zakatMaalIdr: mizanBatch.zakatMaalAmount,
    idempotencyKey,
  });

  const integritySha256 = createHash('sha256').update(canonical, 'utf8').digest('hex');

  return {
    receiptNumber,
    orderId: event.orderId,
    transactionId: event.transactionId,
    tenantId,
    customerName,
    channel,
    recipient,
    currency: 'IDR',
    grossAmountIdr: event.amount,
    gatewayFeeIdr,
    netAmountIdr,
    pphFinalIdr: mizanBatch.pphFinalAmount,
    zakatMaalIdr: mizanBatch.zakatMaalAmount,
    entitlements,
    issuedAt,
    idempotencyKey,
    integritySha256,
  };
}

/**
 * Closed-loop Order-to-Cash orchestrator:
 * IDR/QRIS webhook -> verified payment.settled -> PaaS/ISP entitlement ->
 * Mizan double-entry (PPh 0.5% + Zakat 2.5%) -> mw-echo Kwitansi dispatch.
 */
export class OrderToCashOrchestrator {
  private readonly stateMachine: PaymentSettlementStateMachine;
  private readonly kwitansiDispatcher: KwitansiDispatcher;
  private readonly now: () => string;

  public constructor(options: OrderToCashOrchestratorOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.kwitansiDispatcher = options.kwitansiDispatcher;
    this.stateMachine = new PaymentSettlementStateMachine({
      store: options.store ?? new InMemorySettlementStore(),
      dispatcher: options.entitlementDispatcher,
      resolveEntitlements: options.resolveEntitlements,
      now: this.now,
    });
  }

  public async processMidtransQrisWebhook(input: OrderToCashInput): Promise<OrderToCashResult> {
    const gatewayFeeIdr = input.gatewayFeeIdr ?? 0;
    if (!Number.isSafeInteger(gatewayFeeIdr) || gatewayFeeIdr < 0) {
      throw new RangeError(`gatewayFeeIdr must be a non-negative safe integer.`);
    }

    const event = verifyMidtransWebhook(input.payload, {
      serverKey: input.serverKey,
      now: this.now,
    });

    const settlement = await this.stateMachine.process(event);
    if (settlement.deduplicated || event.eventType !== 'payment.settled') {
      return {
        event,
        settlement,
        duplicate: settlement.deduplicated,
      };
    }

    const postedAt = this.now();
    const mizanBatch = generateMizanSettlementEntries({
      referenceId: event.orderId,
      grossAmount: event.amount,
      gatewayFee: gatewayFeeIdr,
      currency: 'IDR',
      postedAt,
    });

    const kwitansiPayload = buildKwitansiPayload({
      event,
      mizanBatch,
      entitlements: settlement.record.receipts,
      tenantId: input.tenantId,
      customerName: input.customerName,
      recipient: input.recipient,
      channel: input.channel ?? 'whatsapp',
      gatewayFeeIdr,
      issuedAt: postedAt,
    });

    const kwitansiDispatch = await this.kwitansiDispatcher.dispatch(kwitansiPayload);

    return {
      event,
      settlement,
      duplicate: false,
      mizanBatch,
      kwitansiPayload,
      kwitansiDispatch,
    };
  }
}
