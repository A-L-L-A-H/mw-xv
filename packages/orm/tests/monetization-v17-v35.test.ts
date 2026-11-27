import type * as VitestNamespace from 'vitest';
import {
  InMemorySettlementStore,
  PaymentSettlementStateMachine,
  PPH_FINAL_UMKM_BPS,
  WebhookVerificationError,
  ZAKAT_MAAL_BPS,
  anonymizePiiRecord,
  anonymizePiiValue,
  calculateBasisPointsAmount,
  computeMidtransSignature,
  computeXenditHmacSignature,
  constantTimeEqual,
  exportUuPdpDsrBundle,
  generateMizanSettlementEntries,
  serializeUuPdpDsrBundle,
  summarizeJournalBalance,
  verifyMidtransWebhook,
  verifyUuPdpDsrBundleIntegrity,
  verifyXenditVaWebhook,
  type EntitlementAction,
  type EntitlementDispatchReceipt,
  type MidtransWebhookPayload,
} from '../src/monetization/index.js';

const runnerModuleName = process.env.VITEST ? 'vitest' : ['bun', 'test'].join(':');
const { describe, expect, it } = (await import(
  /* @vite-ignore */ runnerModuleName
)) as typeof VitestNamespace;

describe('monetization V17, V18, V21, V35', () => {
  describe('V17: Midtrans Snap/QRIS & Xendit VA webhook adapters', () => {
    it('performs constant-time comparison and rejects empty values', () => {
      expect(constantTimeEqual('secret-token-123', 'secret-token-123')).toBe(true);
      expect(constantTimeEqual('secret-token-123', 'secret-token-124')).toBe(false);
      expect(constantTimeEqual('short', 'much-longer-token')).toBe(false);
      expect(constantTimeEqual('', '')).toBe(false);
    });

    it('verifies Midtrans Snap/QRIS SHA512 signature and normalizes settlement event', () => {
      const serverKey = 'SB-Mid-server-TESTKEY123';
      const orderId = 'ORD-QRIS-2026-001';
      const statusCode = '200';
      const grossAmount = '150000.00';
      const signatureKey = computeMidtransSignature(orderId, statusCode, grossAmount, serverKey);

      const payload: MidtransWebhookPayload = {
        order_id: orderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        signature_key: signatureKey.toUpperCase(),
        transaction_status: 'settlement',
        transaction_id: 'mid-tx-9001',
        payment_type: 'qris',
        settlement_time: '2026-11-27T09:00:00Z',
      };

      const verified = verifyMidtransWebhook(payload, { serverKey });
      expect(verified.provider).toBe('midtrans');
      expect(verified.channel).toBe('qris');
      expect(verified.eventType).toBe('payment.settled');
      expect(verified.orderId).toBe(orderId);
      expect(verified.transactionId).toBe('mid-tx-9001');
      expect(verified.amount).toBe(150000);
      expect(verified.currency).toBe('IDR');
      expect(verified.eventKey).toBe('midtrans:ORD-QRIS-2026-001:payment.settled:mid-tx-9001');
    });

    it('rejects tampered Midtrans signatures', () => {
      const serverKey = 'SB-Mid-server-TESTKEY123';
      const signatureKey = computeMidtransSignature('ORD-1', '200', '100000.00', serverKey);
      expect(() =>
        verifyMidtransWebhook(
          {
            order_id: 'ORD-1',
            status_code: '200',
            gross_amount: '999999.00',
            signature_key: signatureKey,
            transaction_status: 'settlement',
          },
          { serverKey }
        )
      ).toThrow(WebhookVerificationError);
    });

    it('verifies Xendit VA webhook with x-callback-token and HMAC-SHA512', () => {
      const rawBody = JSON.stringify({
        id: 'xnd-cb-77',
        external_id: 'INV-ISP-77',
        payment_id: 'xnd-pay-77',
        bank_code: 'BCA',
        account_number: '8800123456',
        amount: 250000,
        status: 'PAID',
        transaction_timestamp: '2026-11-27T09:05:00Z',
      });
      const callbackToken = 'xnd-callback-secret-abc';
      const hmacSecret = 'xnd-hmac-secret-xyz';
      const hmacSig = computeXenditHmacSignature(rawBody, hmacSecret);

      const verified = verifyXenditVaWebhook(
        rawBody,
        {
          'X-Callback-Token': callbackToken,
          'X-Callback-Signature': hmacSig,
        },
        { callbackToken, hmacSecret, verificationMode: 'both' }
      );

      expect(verified.provider).toBe('xendit');
      expect(verified.channel).toBe('virtual_account');
      expect(verified.eventType).toBe('payment.settled');
      expect(verified.orderId).toBe('INV-ISP-77');
      expect(verified.transactionId).toBe('xnd-pay-77');
      expect(verified.amount).toBe(250000);
      expect(verified.metadata.bankCode).toBe('BCA');
    });

    it('rejects Xendit webhook when callback token or HMAC fails', () => {
      const rawBody = JSON.stringify({ id: 'xnd-1', external_id: 'ORD-2', amount: 10000 });
      expect(() =>
        verifyXenditVaWebhook(
          rawBody,
          { 'x-callback-token': 'wrong-token' },
          { callbackToken: 'expected-token' }
        )
      ).toThrow(WebhookVerificationError);

      expect(() =>
        verifyXenditVaWebhook(
          rawBody,
          { 'x-callback-signature': 'deadbeef' },
          { hmacSecret: 'expected-hmac-secret' }
        )
      ).toThrow(WebhookVerificationError);
    });
  });

  describe('V18: Idempotent payment.settled webhook state machine', () => {
    it('dispatches typed mw-cp and mw-isp entitlements once and deduplicates replays', async () => {
      const store = new InMemorySettlementStore();
      const dispatched: EntitlementAction[] = [];
      const machine = new PaymentSettlementStateMachine({
        store,
        now: () => '2026-11-27T10:00:00Z',
        dispatcher: {
          dispatch(action): EntitlementDispatchReceipt {
            dispatched.push(action);
            return {
              target: action.target,
              action: action.action,
              idempotencyKey: action.idempotencyKey,
              accepted: true,
              dispatchedAt: '2026-11-27T10:00:00Z',
              referenceId: `rcpt-${dispatched.length}`,
            };
          },
        },
        resolveEntitlements(event) {
          if (event.orderId.startsWith('PAAS-')) {
            return [
              {
                target: 'mw-cp',
                action: 'mw-cp.plan.activate',
                tenantId: 'tenant-alpha',
                planCode: 'pro-monthly',
              },
              {
                target: 'mw-cp',
                action: 'mw-cp.quota.topup',
                tenantId: 'tenant-alpha',
                quotaUnits: 1000,
              },
            ];
          }
          return [
            {
              target: 'mw-isp',
              action: 'mw-isp.pppoe.unblock',
              subscriberId: 'sub-99',
              routerId: 'mikrotik-core-1',
              profileCode: 'fiber-100m',
            },
          ];
        },
      });

      const serverKey = 'SB-Mid-server-STATEKEY';
      const pendingPayload: MidtransWebhookPayload = {
        order_id: 'PAAS-101',
        status_code: '201',
        gross_amount: '300000.00',
        signature_key: computeMidtransSignature('PAAS-101', '201', '300000.00', serverKey),
        transaction_status: 'pending',
        transaction_id: 'tx-paas-101',
      };
      const pendingEvent = verifyMidtransWebhook(pendingPayload, { serverKey });
      const pendingRes = await machine.process(pendingEvent);
      expect(pendingRes.status).toBe('processed');
      expect(pendingRes.state).toBe('PENDING');
      expect(dispatched).toHaveLength(0);

      const settledPayload: MidtransWebhookPayload = {
        order_id: 'PAAS-101',
        status_code: '200',
        gross_amount: '300000.00',
        signature_key: computeMidtransSignature('PAAS-101', '200', '300000.00', serverKey),
        transaction_status: 'settlement',
        transaction_id: 'tx-paas-101',
      };
      const settledEvent = verifyMidtransWebhook(settledPayload, { serverKey });
      const firstSettle = await machine.process(settledEvent);
      expect(firstSettle.status).toBe('processed');
      expect(firstSettle.deduplicated).toBe(false);
      expect(firstSettle.state).toBe('DISPATCHED');
      expect(firstSettle.dispatchedActions).toHaveLength(2);
      expect(firstSettle.dispatchedActions[0].target).toBe('mw-cp');
      expect(dispatched).toHaveLength(2);

      // Exact replay deduplicated by eventKey
      const replay1 = await machine.process(settledEvent);
      expect(replay1.status).toBe('duplicate');
      expect(replay1.deduplicated).toBe(true);
      expect(replay1.dispatchedActions).toHaveLength(0);
      expect(dispatched).toHaveLength(2);

      // Different eventKey for same already-settled transactionKey is also deduplicated
      const replayDifferentEventKey = {
        ...settledEvent,
        eventKey: 'midtrans:PAAS-101:payment.settled:tx-paas-101-retry',
      };
      const replay2 = await machine.process(replayDifferentEventKey);
      expect(replay2.status).toBe('duplicate');
      expect(replay2.deduplicated).toBe(true);
      expect(dispatched).toHaveLength(2);

      // Stale pending event cannot regress DISPATCHED state
      const stalePending = { ...pendingEvent, eventKey: 'midtrans:PAAS-101:payment.pending:late' };
      const staleRes = await machine.process(stalePending);
      expect(staleRes.status).toBe('ignored');
      expect(staleRes.state).toBe('DISPATCHED');

      // ISP settlement dispatch via Xendit VA
      const ispRaw = JSON.stringify({
        id: 'xnd-isp-1',
        external_id: 'ISP-SUB-99',
        payment_id: 'pay-isp-99',
        amount: 200000,
        status: 'SETTLED',
      });
      const ispEvent = verifyXenditVaWebhook(
        ispRaw,
        { 'x-callback-token': 'isp-tok' },
        { callbackToken: 'isp-tok' }
      );
      const ispRes = await machine.process(ispEvent);
      expect(ispRes.status).toBe('processed');
      expect(ispRes.dispatchedActions).toHaveLength(1);
      expect(ispRes.dispatchedActions[0]).toMatchObject({
        target: 'mw-isp',
        action: 'mw-isp.pppoe.unblock',
        subscriberId: 'sub-99',
        routerId: 'mikrotik-core-1',
      });
    });
  });

  describe('V21: Mizan double-entry ledger generator', () => {
    it('auto-posts balanced PPh Final 0.5% UMKM and 2.5% Zakat Maal reserve entries', () => {
      expect(PPH_FINAL_UMKM_BPS).toBe(50);
      expect(ZAKAT_MAAL_BPS).toBe(250);
      expect(calculateBasisPointsAmount(1_000_000, PPH_FINAL_UMKM_BPS)).toBe(5_000);
      expect(calculateBasisPointsAmount(1_000_000, ZAKAT_MAAL_BPS)).toBe(25_000);

      const batch = generateMizanSettlementEntries({
        referenceId: 'ORD-MIZAN-1',
        grossAmount: 1_000_000,
        gatewayFee: 4_500,
        currency: 'IDR',
        postedAt: '2026-11-27T10:15:00Z',
      });

      expect(batch.balanced).toBe(true);
      expect(batch.pphFinalAmount).toBe(5_000);
      expect(batch.zakatMaalAmount).toBe(25_000);
      expect(batch.netRetainedAmount).toBe(965_500);
      expect(batch.entries).toHaveLength(3);
      expect(batch.totalDebits).toBe(batch.totalCredits);
      expect(batch.totalDebits).toBe(1_030_000);

      for (const entry of batch.entries) {
        expect(entry.balanced).toBe(true);
        expect(entry.totalDebits).toBe(entry.totalCredits);
        const check = summarizeJournalBalance(entry.lines);
        expect(check.balanced).toBe(true);
      }

      const revenueEntry = batch.entries.find((e) => e.entryType === 'revenue_recognition');
      expect(revenueEntry?.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountCode: '1110', side: 'debit', amount: 995_500 }),
          expect.objectContaining({ accountCode: '5110', side: 'debit', amount: 4_500 }),
          expect.objectContaining({ accountCode: '4100', side: 'credit', amount: 1_000_000 }),
        ])
      );
    });

    it('supports net_after_tax zakat base and rejects invalid amounts', () => {
      const batch = generateMizanSettlementEntries({
        referenceId: 'ORD-MIZAN-2',
        grossAmount: 2_000_000,
        gatewayFee: 10_000,
        zakatBase: 'net_after_tax',
      });
      // PPh = 0.5% of 2,000,000 = 10,000; Zakat base = 2,000,000 - 10,000 - 10,000 = 1,980,000 -> 2.5% = 49,500
      expect(batch.pphFinalAmount).toBe(10_000);
      expect(batch.zakatMaalAmount).toBe(49_500);
      expect(batch.balanced).toBe(true);

      expect(() =>
        generateMizanSettlementEntries({
          referenceId: 'BAD-FEE',
          grossAmount: 10_000,
          gatewayFee: 15_000,
        })
      ).toThrow(RangeError);
    });
  });

  describe('V35: UU PDP DSR JSON bundle exporter & crypto-anonymizer', () => {
    const secretKey = 'uupdp-master-pepper-key-2026-secure';

    it('deterministically and irreversibly anonymizes customer PII fields', () => {
      const a1 = anonymizePiiValue('Budi.Santoso@Example.com ', 'email', 'email', secretKey);
      const a2 = anonymizePiiValue('budi.santoso@example.com', 'email', 'email', secretKey);
      const otherField = anonymizePiiValue('budi.santoso@example.com', 'backupEmail', 'email', secretKey);

      expect(a1).toBe(a2);
      expect(a1).toMatch(/^anon_[0-9a-f]{20}@anonymized\.invalid$/);
      expect(a1).not.toContain('budi');
      expect(a1).not.toBe(otherField);

      const original = {
        customerId: 'cust-42',
        fullName: 'Budi Santoso',
        email: 'budi.santoso@example.com',
        phone: '+62 812-3456-7890',
        nik: '3273010101900001',
        nested: {
          billingAddress: 'Jl. Merdeka No. 1, Bandung',
          plan: 'fiber-100m',
        },
      };

      const res = anonymizePiiRecord(
        original,
        ['fullName', 'email', 'phone', 'nik', 'nested.billingAddress'],
        {
          secretKey,
          fieldKinds: { 'nested.billingAddress': 'address' },
          anonymizedAt: '2026-11-27T11:00:00Z',
        }
      );

      expect(res.algorithm).toBe('HMAC-SHA256');
      expect(res.reversible).toBe(false);
      expect(res.anonymized.customerId).toBe('cust-42');
      expect((res.anonymized.nested as Record<string, unknown>).plan).toBe('fiber-100m');
      expect(res.anonymized.nik).toMatch(/^anon_nik_[0-9a-f]{24}$/);
      expect(res.anonymized.phone).toMatch(/^\+62000\d{12}$/);
      expect(res.fieldsAnonymized).toEqual([
        'email',
        'fullName',
        'nested.billingAddress',
        'nik',
        'phone',
      ]);
      // Input object remains unmutated
      expect(original.email).toBe('budi.santoso@example.com');
    });

    it('exports verifiable UU PDP DSR JSON bundle in raw and anonymized modes', () => {
      const rawBundle = exportUuPdpDsrBundle({
        requestId: 'DSR-2026-001',
        subjectId: 'subj-100',
        tenantId: 'tenant-1',
        exportedAt: '2026-11-27T11:10:00Z',
        profile: {
          email: 'siti@example.co.id',
          phone: '08111222333',
          nik: '3171010101950002',
          tier: 'umkm',
        },
        consents: [
          {
            consentId: 'c-1',
            purpose: 'billing_and_invoicing',
            granted: true,
            grantedAt: '2026-01-01T00:00:00Z',
            legalBasis: 'contract_performance',
          },
        ],
        transactions: [{ orderId: 'ORD-1', amount: 150000, currency: 'IDR' }],
        entitlements: [{ target: 'mw-cp', tenantId: 'tenant-1', status: 'active' }],
        ledgerReferences: ['ORD-MIZAN-1:rev', 'ORD-MIZAN-1:pph05'],
      });

      expect(rawBundle.schemaVersion).toBe('uupdp-dsr/v1');
      expect(rawBundle.legalBasis).toBe('UU No. 27 Tahun 2022 (UU PDP)');
      expect(verifyUuPdpDsrBundleIntegrity(rawBundle)).toBe(true);

      const serialized = serializeUuPdpDsrBundle(rawBundle);
      expect(serialized).toContain('"schemaVersion": "uupdp-dsr/v1"');

      // Tampering invalidates digest
      const tampered = {
        ...rawBundle,
        profile: { ...rawBundle.profile, tier: 'enterprise' },
      };
      expect(verifyUuPdpDsrBundleIntegrity(tampered)).toBe(false);

      const anonBundle = exportUuPdpDsrBundle({
        requestId: 'DSR-2026-002',
        subjectId: 'subj-100',
        tenantId: 'tenant-1',
        exportedAt: '2026-11-27T11:15:00Z',
        mode: 'anonymized',
        anonymizationOptions: { secretKey },
        profile: {
          email: 'siti@example.co.id',
          phone: '08111222333',
          nik: '3171010101950002',
          tier: 'umkm',
        },
        consents: [],
      });

      expect(anonBundle.mode).toBe('anonymized');
      expect(anonBundle.profile.email).toMatch(/^anon_[0-9a-f]{20}@anonymized\.invalid$/);
      expect(anonBundle.profile.nik).toMatch(/^anon_nik_[0-9a-f]{24}$/);
      expect(anonBundle.profile.tier).toBe('umkm');
      expect(verifyUuPdpDsrBundleIntegrity(anonBundle)).toBe(true);
    });
  });
});
