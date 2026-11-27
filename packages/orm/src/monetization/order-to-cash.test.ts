import { describe, expect, it } from 'vitest';
import {
  OrderToCashOrchestrator,
  computeMidtransSignature,
  type KwitansiReceiptPayload,
} from './index.js';
import type { EntitlementAction, EntitlementDispatchReceipt } from './types.js';

describe('Order-to-Cash E2E sandbox flow (IDR/QRIS -> Mizan -> mw-echo Kwitansi)', () => {
  it('executes IDR/QRIS settlement, PaaS/ISP activation, Mizan PPh/Zakat, and Kwitansi idempotently', async () => {
    const serverKey = 'SB-Mid-server-sandbox-key-001';
    const orderId = 'ORD-IDR-2026-0001';
    const statusCode = '200';
    const grossAmount = '1000000'; // Rp 1.000.000 integer IDR
    const signatureKey = computeMidtransSignature(orderId, statusCode, grossAmount, serverKey);

    const payload = {
      order_id: orderId,
      transaction_id: 'trx-qris-998877',
      status_code: statusCode,
      gross_amount: grossAmount,
      payment_type: 'qris',
      transaction_status: 'settlement',
      fraud_status: 'accept',
      currency: 'IDR',
      signature_key: signatureKey,
    };
    const rawBody = JSON.stringify(payload);

    const dispatchedEntitlements: EntitlementAction[] = [];
    const dispatchedKwitansis: KwitansiReceiptPayload[] = [];

    const orchestrator = new OrderToCashOrchestrator({
      now: () => '2026-11-27T12:00:00.000Z',
      resolveEntitlements: () => [
        {
          target: 'mw-cp',
          action: 'mw-cp.plan.activate',
          tenantId: 'tenant-barakah-01',
          planCode: 'paas-pro-idr',
          quotaUnits: 10,
        },
        {
          target: 'mw-isp',
          action: 'mw-isp.subscriber.activate',
          subscriberId: 'sub-isp-441',
          profileCode: 'fiber-100mbps',
        },
      ],
      entitlementDispatcher: {
        dispatch(action: EntitlementAction): EntitlementDispatchReceipt {
          dispatchedEntitlements.push(action);
          return {
            target: action.target,
            action: action.action,
            idempotencyKey: action.idempotencyKey,
            accepted: true,
            dispatchedAt: '2026-11-27T12:00:00.000Z',
          };
        },
      },
      kwitansiDispatcher: {
        dispatch(kwitansi: KwitansiReceiptPayload) {
          dispatchedKwitansis.push(kwitansi);
          return {
            dispatched: true,
            messageId: `echo-msg-${kwitansi.receiptNumber}`,
            channel: kwitansi.channel,
            recipient: kwitansi.recipient,
            idempotencyKey: kwitansi.idempotencyKey,
          };
        },
      },
    });

    const first = await orchestrator.processMidtransQrisWebhook({
      payload,
      serverKey,
      tenantId: 'tenant-barakah-01',
      customerName: 'PT Barakah Digital',
      recipient: '+6281234567890',
      channel: 'whatsapp',
      gatewayFeeIdr: 7000,
    });

    expect(first.duplicate).toBe(false);
    expect(first.event.eventType).toBe('payment.settled');
    expect(first.settlement.record.state).toBe('DISPATCHED');
    expect(dispatchedEntitlements).toHaveLength(2);

    // Exact integer Mizan calculations:
    // 0.5% PPh Final UMKM of Rp 1.000.000 = Rp 5.000
    // 2.5% Zakat Maal of Rp 1.000.000 = Rp 25.000
    expect(first.mizanBatch?.pphFinalAmount).toBe(5000);
    expect(first.mizanBatch?.zakatMaalAmount).toBe(25000);
    expect(first.mizanBatch?.balanced).toBe(true);

    // Verified mw-echo Kwitansi payload
    expect(first.kwitansiPayload?.receiptNumber).toBe(`KWT-${orderId}`);
    expect(first.kwitansiPayload?.grossAmountIdr).toBe(1000000);
    expect(first.kwitansiPayload?.gatewayFeeIdr).toBe(7000);
    expect(first.kwitansiPayload?.netAmountIdr).toBe(993000);
    expect(first.kwitansiPayload?.pphFinalIdr).toBe(5000);
    expect(first.kwitansiPayload?.zakatMaalIdr).toBe(25000);
    expect(first.kwitansiPayload?.integritySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.kwitansiDispatch?.dispatched).toBe(true);
    expect(dispatchedKwitansis).toHaveLength(1);

    // Duplicate webhook replay must be strictly idempotent
    const replay = await orchestrator.processMidtransQrisWebhook({
      payload,
      serverKey,
      tenantId: 'tenant-barakah-01',
      customerName: 'PT Barakah Digital',
      recipient: '+6281234567890',
      channel: 'whatsapp',
      gatewayFeeIdr: 7000,
    });

    expect(replay.duplicate).toBe(true);
    expect(dispatchedEntitlements).toHaveLength(2);
    expect(dispatchedKwitansis).toHaveLength(1);
  });
});
