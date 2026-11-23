import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PSAK_CHART_OF_ACCOUNTS,
  validateJournalEntry,
  mapToPSAKAccount,
  exportToAccurateFormat,
  exportToOdooFormat,
  exportToSAPFormat,
  exportJournalEntry,
  importFromAccurateFormat,
  importFromOdooFormat,
  importFromSAPFormat,
  importJournalEntry,
  ErpLedgerConnector,
  buildJournalEntryFromTransaction,
} from '../src/connectors/erp-ledger.js';

import {
  buildStripePaymentIntent,
  buildXenditPaymentIntent,
  buildMidtransPaymentIntent,
  buildPaymentIntent,
  signRefundPayload,
  verifyRefundSignature,
  dispatchRefund,
  reconcileStripePayouts,
  reconcileXenditPayouts,
  reconcileMidtransPayouts,
  reconcilePayouts,
  PaymentGatewayConnector,
  PaymentIntentRecord,
  RefundRecord,
  PayoutReconciliationRecord,
  buildJournalEntryFromPaymentIntent,
  buildJournalEntryFromRefund,
} from '../src/connectors/payment-gateways.js';

describe('ERP Ledger Connector', () => {
  describe('PSAK Chart of Accounts', () => {
    it('contains 21 standard Indonesian accounts', () => {
      expect(PSAK_CHART_OF_ACCOUNTS.size).toBe(21);
    });

    it('includes required account codes', () => {
      expect(PSAK_CHART_OF_ACCOUNTS.has('1101')).toBe(true); // Kas
      expect(PSAK_CHART_OF_ACCOUNTS.has('1102')).toBe(true); // Bank
      expect(PSAK_CHART_OF_ACCOUNTS.has('4101')).toBe(true); // Pendapatan Jasa
      expect(PSAK_CHART_OF_ACCOUNTS.has('6101')).toBe(true); // Biaya Administrasi
    });

    it('has Indonesian names for all accounts', () => {
      for (const [, account] of PSAK_CHART_OF_ACCOUNTS) {
        expect(account.name_id).toBeDefined();
        expect(account.name_id.length).toBeGreaterThan(0);
      }
    });
  });

  describe('validateJournalEntry', () => {
    const validEntry = {
      lines: [
        { account_code: '1101', debit: 1000000, credit: 0, description: 'Cash received' },
        { account_code: '4101', debit: 0, credit: 1000000, description: 'Revenue' },
      ],
    };

    it('accepts balanced entries', () => {
      const result = validateJournalEntry(validEntry);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects unbalanced entries', () => {
      const unbalanced = {
        lines: [
          { account_code: '1101', debit: 1000000, credit: 0, description: 'Cash' },
          { account_code: '4101', debit: 0, credit: 500000, description: 'Revenue' },
        ],
      };
      const result = validateJournalEntry(unbalanced);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('debit') && e.includes('credit'))).toBe(true);
    });

    it('rejects unknown account codes', () => {
      const unknown = {
        lines: [
          { account_code: '9999', debit: 1000, credit: 0, description: 'Unknown' },
          { account_code: '4101', debit: 0, credit: 1000, description: 'Revenue' },
        ],
      };
      const result = validateJournalEntry(unknown);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown account'))).toBe(true);
    });

    it('rejects lines with both debit and credit', () => {
      const both = {
        lines: [
          { account_code: '1101', debit: 100, credit: 100, description: 'Both' },
          { account_code: '4101', debit: 0, credit: 200, description: 'Revenue' },
        ],
      };
      const result = validateJournalEntry(both);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('both debit and credit'))).toBe(true);
    });

    it('rejects lines with zero amounts on both sides', () => {
      const zero = {
        lines: [
          { account_code: '1101', debit: 0, credit: 0, description: 'Zero' },
          { account_code: '4101', debit: 0, credit: 0, description: 'Revenue' },
        ],
      };
      const result = validateJournalEntry(zero);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('zero amount'))).toBe(true);
    });
  });

  describe('mapToPSAKAccount', () => {
    it('maps exact matches', () => {
      const account = mapToPSAKAccount('1101');
      expect(account).toBeDefined();
      expect(account?.code).toBe('1101');
    });

    it('returns undefined for unknown codes', () => {
      expect(mapToPSAKAccount('9999')).toBeUndefined();
    });
  });

  describe('Export formats', () => {
    const testEntry = {
      id: 'JE-001',
      date: '2024-01-15',
      reference: 'INV-001',
      lines: [
        { account_code: '1101', debit: 1000000, credit: 0, description: 'Cash received' },
        { account_code: '4101', debit: 0, credit: 1000000, description: 'Revenue' },
      ],
    };

    it('exports to Accurate format', () => {
      const result = exportToAccurateFormat(testEntry);
      expect(result).toContain('Journal Entry');
      expect(result).toContain('JE-001');
      expect(result).toContain('1101');
      expect(result).toContain('1000000');
    });

    it('exports to Odoo format', () => {
      const result = exportToOdooFormat(testEntry);
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe('JE-001');
      expect(parsed.line_ids).toHaveLength(2);
    });

    it('exports to SAP format', () => {
      const result = exportToSAPFormat(testEntry);
      expect(result).toContain('BKPF');
      expect(result).toContain('BSEG');
      expect(result).toContain('JE-001');
    });

    it('exportJournalEntry routes to correct formatter', () => {
      expect(exportJournalEntry(testEntry, 'accurate')).toContain('Journal Entry');
      expect(exportJournalEntry(testEntry, 'odoo')).toContain('line_ids');
      expect(exportJournalEntry(testEntry, 'sap')).toContain('BKPF');
      expect(exportJournalEntry(testEntry, 'json')).toContain('"id":"JE-001"');
    });
  });

  describe('Import formats', () => {
    it('imports from Accurate format', () => {
      const csv = `Journal Entry,JE-002,2024-01-16,INV-002
Account,Debit,Credit,Description
1101,2000000,0,Cash received
4101,0,2000000,Revenue`;
      const result = importFromAccurateFormat(csv);
      expect(result.id).toBe('JE-002');
      expect(result.lines).toHaveLength(2);
    });

    it('imports from Odoo format', () => {
      const json = JSON.stringify({
        name: 'JE-003',
        date: '2024-01-17',
        ref: 'INV-003',
        line_ids: [
          { account_id: { code: '1101' }, debit: 500000, credit: 0, name: 'Cash' },
          { account_id: { code: '4101' }, debit: 0, credit: 500000, name: 'Revenue' },
        ],
      });
      const result = importFromOdooFormat(json);
      expect(result.id).toBe('JE-003');
      expect(result.lines).toHaveLength(2);
    });

    it('imports from SAP format', () => {
      const csv = `BKPF,BELNR,BLDAT,BLART
BKPF,JE-004,2024.01.18,SA
BSEG,BELNR,KOART,WRBTR,SHKZG,HKONT
BSEG,JE-004,S,3000000,H,1101
BSEG,JE-004,S,3000000,S,4101`;
      const result = importFromSAPFormat(csv);
      expect(result.id).toBe('JE-004');
      expect(result.lines).toHaveLength(2);
    });

    it('importJournalEntry routes to correct parser', () => {
      expect(importJournalEntry('Journal Entry', 'accurate').id).toBeDefined();
      expect(importJournalEntry('{', 'odoo').id).toBeDefined();
      expect(importJournalEntry('BKPF', 'sap').id).toBeDefined();
    });
  });

  describe('ErpLedgerConnector model', () => {
    it('has correct table and fields', () => {
      expect(ErpLedgerConnector.tableName).toBe('integration_erp_ledger_connectors');
      expect(ErpLedgerConnector.jsonAttributes).toContain('field_mapping_json');
    });
  });

  describe('buildJournalEntryFromTransaction', () => {
    it('creates balanced journal entry for payment', () => {
      const tx = { id: 1, amount: 500000, description: 'Invoice payment', companyId: 1 };
      const result = buildJournalEntryFromTransaction(tx);
      expect(result.total).toBe(500000);
      
      const debits = result.lines.filter(l => l.debit > 0).reduce((a, l) => a + l.debit, 0);
      const credits = result.lines.filter(l => l.credit > 0).reduce((a, l) => a + l.credit, 0);
      expect(debits).toBe(credits);
    });
  });
});

describe('Payment Gateways Connector', () => {
  const mockStripeConfig = {
    secretKey: 'sk_test_123',
    webhookSecret: 'whsec_123',
    apiVersion: '2024-04-10',
  };

  const mockXenditConfig = {
    secretKey: 'xnd_development_123',
    webhookToken: 'wht_123',
    isProduction: false,
  };

  const mockMidtransConfig = {
    serverKey: 'SB-Mid-server-123',
    clientKey: 'SB-Mid-client-123',
    isProduction: false,
  };

  const baseRequest = {
    amount: 100000,
    currency: 'IDR',
    companyId: 1,
    customerId: 'cust_123',
    orderId: 'ORD-001',
    description: 'Test payment',
  };

  describe('Payment Intent Builders', () => {
    it('builds Stripe payment intent', () => {
      const result = buildStripePaymentIntent(baseRequest, mockStripeConfig);
      expect(result.gateway).toBe('stripe');
      expect(result.id).toBe('pi_ORD-001');
      expect(result.clientSecret).toContain('pi_ORD-001_secret_');
      expect(result.status).toBe('requires_payment_method');
      expect(result.amount).toBe(100000);
    });

    it('builds Xendit payment intent', () => {
      const result = buildXenditPaymentIntent(baseRequest, mockXenditConfig);
      expect(result.gateway).toBe('xendit');
      expect(result.id).toBe('xnd_ORD-001');
      expect(result.status).toBe('requires_action');
      expect(result.nextAction?.redirectToUrl.url).toContain('checkout.xendit.co');
    });

    it('builds Midtrans payment intent', () => {
      const result = buildMidtransPaymentIntent(baseRequest, mockMidtransConfig);
      expect(result.gateway).toBe('midtrans');
      expect(result.id).toBe('mid_ORD-001');
      expect(result.clientSecret).toContain('snap-mid_ORD-001-');
      expect(result.nextAction?.redirectToUrl.url).toContain('midtrans.com');
    });

    it('buildPaymentIntent routes to correct builder', () => {
      expect(buildPaymentIntent(baseRequest, 'stripe', mockStripeConfig).gateway).toBe('stripe');
      expect(buildPaymentIntent(baseRequest, 'xendit', mockXenditConfig).gateway).toBe('xendit');
      expect(buildPaymentIntent(baseRequest, 'midtrans', mockMidtransConfig).gateway).toBe('midtrans');
    });

    it('throws on unsupported gateway', () => {
      expect(() => buildPaymentIntent(baseRequest, 'unknown' as never, mockStripeConfig))
        .toThrow('Unsupported gateway');
    });
  });

  describe('Refund Signing', () => {
    const refundRequest = {
      paymentIntentId: 'pi_123',
      amount: 50000,
      reason: 'requested_by_customer' as const,
    };

    it('signs Stripe refund with HMAC-SHA256', () => {
      const secret = 'sk_test_secret';
      const signature = signRefundPayload(refundRequest, 'stripe', secret);
      expect(signature).toHaveLength(64); // hex encoded SHA256
      expect(/^[a-f0-9]{64}$/i.test(signature)).toBe(true);
    });

    it('signs Xendit refund with HMAC-SHA256', () => {
      const secret = 'xnd_secret';
      const signature = signRefundPayload(refundRequest, 'xendit', secret);
      expect(signature).toHaveLength(64);
    });

    it('signs Midtrans refund with RSA-SHA256 (base64)', () => {
      const secret = `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD...\n-----END PRIVATE KEY-----`;
      const signature = signRefundPayload(refundRequest, 'midtrans', secret);
      expect(signature.length).toBeGreaterThan(0);
    });

    it('verifies correct signatures', () => {
      const secret = 'test_secret';
      const signature = signRefundPayload(refundRequest, 'stripe', secret);
      expect(verifyRefundSignature('stripe', secret, refundRequest, signature)).toBe(true);
    });

    it('rejects incorrect signatures', () => {
      expect(verifyRefundSignature('stripe', 'wrong_secret', refundRequest, 'invalid')).toBe(false);
    });

    it('throws on unsupported gateway for signing', () => {
      expect(() => signRefundPayload(refundRequest, 'unknown' as never, 'secret'))
        .toThrow('Unsupported gateway for refund signing');
    });
  });

  describe('Refund Dispatch', () => {
    it('dispatches refund for all gateways', () => {
      const request = { paymentIntentId: 'pi_123', amount: 1000, reason: 'duplicate' as const };
      
      expect(dispatchRefund(request, 'stripe', mockStripeConfig).gateway).toBe('stripe');
      expect(dispatchRefund(request, 'xendit', mockXenditConfig).gateway).toBe('xendit');
      expect(dispatchRefund(request, 'midtrans', mockMidtransConfig).gateway).toBe('midtrans');
    });

    it('includes correct status and IDs', () => {
      const result = dispatchRefund(
        { paymentIntentId: 'pi_123', amount: 1000, reason: 'fraudulent' },
        'stripe',
        mockStripeConfig
      );
      expect(result.status).toBe('pending');
      expect(result.id).toContain('re_stripe_');
      expect(result.reason).toBe('fraudulent');
    });
  });

  describe('Payout Reconciliation', () => {
    const gatewayRecords = [
      { id: 'po_1', amount: 100000, currency: 'IDR', status: 'paid' as const, gateway: 'stripe' as const },
      { id: 'po_2', amount: 200000, currency: 'IDR', status: 'paid' as const, gateway: 'stripe' as const },
      { id: 'po_3', amount: 300000, currency: 'IDR', status: 'failed' as const, gateway: 'stripe' as const },
    ];

    const localRecords = [
      { id: 'po_1', amount: 100000, currency: 'IDR' },
      { id: 'po_2', amount: 200001, currency: 'IDR' }, // 1 IDR difference
      { id: 'po_4', amount: 400000, currency: 'IDR' }, // only in local
    ];

    it('reconciles Stripe payouts correctly', () => {
      const result = reconcileStripePayouts(gatewayRecords, localRecords);
      expect(result.matched).toBe(1); // po_1 exact match
      expect(result.discrepancies).toHaveLength(1); // po_2 1 IDR diff
      expect(result.unmatchedGateway).toHaveLength(1); // po_3
      expect(result.unmatchedLocal).toHaveLength(1); // po_4
    });

    it('Xendit and Midtrans use same logic', () => {
      const xenditResult = reconcileXenditPayouts(gatewayRecords, localRecords);
      const midtransResult = reconcileMidtransPayouts(gatewayRecords, localRecords);
      
      expect(xenditResult.matched).toBe(reconcileStripePayouts(gatewayRecords, localRecords).matched);
      expect(midtransResult.matched).toBe(reconcileStripePayouts(gatewayRecords, localRecords).matched);
    });

    it('reconcilePayouts routes to correct gateway', () => {
      expect(reconcilePayouts(gatewayRecords, localRecords, 'stripe').matched).toBe(1);
      expect(reconcilePayouts(gatewayRecords, localRecords, 'xendit').matched).toBe(1);
      expect(reconcilePayouts(gatewayRecords, localRecords, 'midtrans').matched).toBe(1);
    });
  });

  describe('Models', () => {
    it('PaymentGatewayConnector has correct fields', () => {
      expect(PaymentGatewayConnector.tableName).toBe('integration_payment_gateway_connectors');
      expect(PaymentGatewayConnector.jsonAttributes).toContain('config_json');
    });

    it('PaymentIntentRecord has correct fields', () => {
      expect(PaymentIntentRecord.tableName).toBe('integration_payment_intents');
      expect(PaymentIntentRecord.jsonAttributes).toContain('metadata_json');
    });

    it('RefundRecord has correct fields', () => {
      expect(RefundRecord.tableName).toBe('integration_refunds');
    });

    it('PayoutReconciliationRecord has correct fields', () => {
      expect(PayoutReconciliationRecord.tableName).toBe('integration_payout_reconciliations');
      expect(PayoutReconciliationRecord.jsonAttributes).toContain('details_json');
    });
  });

  describe('Journal Entry Builders', () => {
    const mockPaymentIntent: InstanceType<typeof PaymentIntentRecord> = {
      amount: 100000,
      order_id: 'ORD-001',
      gateway: 'stripe' as const,
    } as InstanceType<typeof PaymentIntentRecord>;

    it('builds journal entry from payment intent', () => {
      const result = buildJournalEntryFromPaymentIntent(mockPaymentIntent, 2900);
      
      const debits = result.lines.filter(l => l.debit > 0).reduce((a, l) => a + l.debit, 0);
      const credits = result.lines.filter(l => l.credit > 0).reduce((a, l) => a + l.credit, 0);
      expect(debits).toBe(credits);
      expect(result.total).toBe(100000);
      expect(result.lines.some(l => l.account_code === '1101')).toBe(true);
      expect(result.lines.some(l => l.account_code === '4101')).toBe(true);
      expect(result.lines.some(l => l.account_code === '6101')).toBe(true); // fee
    });

    it('builds journal entry from refund', () => {
      const mockRefund: InstanceType<typeof RefundRecord> = {
        amount: 50000,
        external_id: 're_123',
      } as InstanceType<typeof RefundRecord>;

      const result = buildJournalEntryFromRefund(mockRefund, 100000);
      
      const debits = result.lines.filter(l => l.debit > 0).reduce((a, l) => a + l.debit, 0);
      const credits = result.lines.filter(l => l.credit > 0).reduce((a, l) => a + l.credit, 0);
      expect(debits).toBe(credits);
      expect(result.total).toBe(50000);
      expect(result.lines.some(l => l.account_code === '4101')).toBe(true); // revenue reversal
      expect(result.lines.some(l => l.account_code === '1101')).toBe(true); // cash outflow
    });
  });
});