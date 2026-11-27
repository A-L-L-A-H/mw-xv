import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  processPaymentWebhook,
  verifyPaymentWebhook,
  OrderToCashBridge,
  renderInvoiceHtml,
  type PaymentWebhookVerificationInput,
} from '../src/index.js';

describe('T26-T29: payment-webhooks, ledger-revenue-bridge, invoice-renderer', () => {
  const secretKey = 'test-secret-gateway-key';

  it('verifies and processes Midtrans SHA-512 settlement webhook', () => {
    const orderId = 'INV-2026-001';
    const statusCode = '200';
    const grossAmount = '350000.00';
    const signature = createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${secretKey}`)
      .digest('hex');

    const input: PaymentWebhookVerificationInput = {
      provider: 'midtrans',
      headers: {},
      rawBody: JSON.stringify({
        order_id: orderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        signature_key: signature,
        transaction_status: 'settlement',
        custom_field1: 'user-isp-1',
      }),
      parsedBody: {
        order_id: orderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        signature_key: signature,
        transaction_status: 'settlement',
        custom_field1: 'user-isp-1',
      },
      secretKey,
    };

    const result = processPaymentWebhook(input);
    expect(result.isValid ?? result.isAuthentic).toBe(true);
    expect(result.shouldUnsuspend).toBe(true);
    expect(result.event?.subscriberUsername).toBe('user-isp-1');
    expect(result.event?.amountMinor).toBe(350000);
  });

  it('verifies and processes Xendit callback token webhook', () => {
    const input: PaymentWebhookVerificationInput = {
      provider: 'xendit',
      headers: { 'x-callback-token': secretKey },
      rawBody: '{}',
      parsedBody: {
        id: 'xendit-event-1',
        external_id: 'INV-2026-002',
        payer_email: 'user-isp-2@client.net',
        amount: 500000,
        status: 'PAID',
      },
      secretKey,
    };

    const result = processPaymentWebhook(input);
    expect(result.isAuthentic).toBe(true);
    expect(result.shouldUnsuspend).toBe(true);
    expect(result.event?.invoiceId).toBe('INV-2026-002');
  });

  it('verifies and processes Tripay HMAC-SHA256 webhook', () => {
    const rawBody = JSON.stringify({
      reference: 'TRIPAY-REF-1',
      merchant_ref: 'INV-2026-003',
      customer_email: 'user-isp-3@isp.net',
      total_amount: 150000,
      status: 'PAID',
    });
    const signature = createHmac('sha256', secretKey).update(rawBody).digest('hex');

    const input: PaymentWebhookVerificationInput = {
      provider: 'tripay',
      headers: { 'x-callback-signature': signature },
      rawBody,
      parsedBody: JSON.parse(rawBody),
      secretKey,
    };

    const result = processPaymentWebhook(input);
    expect(result.isAuthentic).toBe(true);
    expect(result.shouldUnsuspend).toBe(true);
  });

  it('verifies and processes Duitku MD5 webhook', () => {
    const merchantCode = 'D1234';
    const amount = '200000';
    const merchantOrderId = 'INV-2026-004';
    const signature = createHash('md5')
      .update(`${merchantCode}${amount}${merchantOrderId}${secretKey}`)
      .digest('hex');

    const input: PaymentWebhookVerificationInput = {
      provider: 'duitku',
      headers: {},
      rawBody: '{}',
      parsedBody: {
        merchantCode,
        amount,
        merchantOrderId,
        resultCode: '00',
        signature,
      },
      secretKey,
    };

    const result = processPaymentWebhook(input);
    expect(result.isAuthentic).toBe(true);
    expect(result.shouldUnsuspend).toBe(true);
  });

  it('rejects tampered webhook signatures', () => {
    const input: PaymentWebhookVerificationInput = {
      provider: 'midtrans',
      headers: {},
      rawBody: '{}',
      parsedBody: {
        order_id: 'INV-1',
        status_code: '200',
        gross_amount: '100',
        signature_key: 'fake-signature',
      },
      secretKey,
    };

    const result = processPaymentWebhook(input);
    expect(result.isAuthentic).toBe(false);
    expect(result.shouldUnsuspend).toBe(false);
  });

  it('posts double-entry invoice and settlement with Sharia Zakat calculation', () => {
    const bridge = new OrderToCashBridge();

    const invoice = bridge.postInvoice({
      invoiceId: 'INV-ISP-100',
      subscriberId: 101,
      username: 'subscriber-101',
      amountMinor: 111000,
      taxRateBps: 1100,
      issueDate: '2026-11-01',
      idempotencyKey: 'idemp-inv-100',
      isShariaCompliant: true,
    });

    expect(invoice.isBalanced).toBe(true);
    expect(invoice.totalDebitMinor).toBe(111000);
    expect(invoice.isShariaCompliant).toBe(true);

    const settlement = bridge.postSettlement({
      settlementId: 'SET-100',
      invoiceId: 'INV-ISP-100',
      username: 'subscriber-101',
      amountMinor: 111000,
      settlementDate: '2026-11-05',
      idempotencyKey: 'idemp-set-100',
      calculateZakat: true,
      zakatBps: 250,
    });

    expect(settlement.isBalanced).toBe(true);
    expect(settlement.zakatMinor).toBe(2775); // 2.5% of 111,000 = 2775
  });

  it('renders clean HTML invoice', () => {
    const html = renderInvoiceHtml({
      invoiceId: 'INV-RENDER-1',
      companyName: 'MoonWitness ISP',
      subscriberId: 'SUB-1',
      subscriberName: 'John Doe',
      billingPeriod: 'Nov 2026',
      issueDate: '2026-11-01',
      dueDate: '2026-11-10',
      items: [
        {
          description: 'Broadband 50Mbps',
          quantity: 1,
          unitPriceMinor: 300000,
          amountMinor: 300000,
        },
      ],
      subtotalMinor: 300000,
      taxMinor: 33000,
      totalMinor: 333000,
      currency: 'IDR',
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('INV-RENDER-1');
    expect(html).toContain('John Doe');
    expect(html).toContain('Rp 333.000');
  });
});
