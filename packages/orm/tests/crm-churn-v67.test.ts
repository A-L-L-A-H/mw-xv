import { describe, expect, it } from 'bun:test';
import {
  InMemoryRetentionRateLimitStore,
  RetentionOfferWorkflow,
  scoreChurnRisk,
  type ChurnSignalInput,
  type CustomerRetentionContact,
  type RetentionOfferDispatchRequest,
  type RetentionOfferDispatcher,
} from '../src/crm/index.js';

function makeHealthySignals(overrides?: Partial<ChurnSignalInput>): ChurnSignalInput {
  return {
    customerId: 'cust-001',
    tenantId: 'tenant-acme',
    daysSinceLastActive: 2,
    overdueInvoiceCount: 0,
    failedPaymentCount30d: 0,
    openSupportTickets: 0,
    criticalSupportTickets: 0,
    usageDeltaPct: 5,
    daysToRenewal: 60,
    ...overrides,
  };
}

function makeContact(overrides?: Partial<CustomerRetentionContact>): CustomerRetentionContact {
  return {
    customerId: 'cust-001',
    tenantId: 'tenant-acme',
    displayName: 'Budi Santoso',
    whatsappPhone: '+6281234567890',
    email: 'budi@acme.id',
    whatsappOptIn: true,
    emailOptIn: true,
    ...overrides,
  };
}

function makeRecordingDispatcher() {
  const sent: RetentionOfferDispatchRequest[] = [];
  const dispatcher: RetentionOfferDispatcher = {
    send(request) {
      sent.push(request);
      return {
        idempotencyKey: request.idempotencyKey,
        channel: request.channel,
        accepted: true,
        providerMessageId: `msg-${sent.length}`,
        dispatchedAt: request.dispatchedAt,
      };
    },
  };
  return { sent, dispatcher };
}

describe('V67 CRM churn risk scorer', () => {
  it('scores healthy customers as low risk with no offer', () => {
    const assessment = scoreChurnRisk(makeHealthySignals(), {
      now: () => '2026-11-27T10:00:00.000Z',
    });
    expect(assessment.score).toBe(0);
    expect(assessment.band).toBe('low');
    expect(assessment.factors).toHaveLength(0);
    expect(assessment.recommendedOfferCode).toBeNull();
  });

  it('scores high-risk and critical customers with sorted factor attribution', () => {
    const critical = scoreChurnRisk(
      makeHealthySignals({
        daysSinceLastActive: 35,
        overdueInvoiceCount: 2,
        failedPaymentCount30d: 2,
        openSupportTickets: 2,
        criticalSupportTickets: 1,
        usageDeltaPct: -65,
        daysToRenewal: 5,
      })
    );
    expect(critical.score).toBeGreaterThanOrEqual(80);
    expect(critical.band).toBe('critical');
    expect(critical.recommendedOfferCode).toBe('RETENTION_VIP_30');
    expect(critical.factors[0]?.code).toBe('inactivity');
  });
});

describe('V67 CRM rate-limited WA/Email retention workflow', () => {
  it('skips low-risk and suppressed customers', async () => {
    const { sent, dispatcher } = makeRecordingDispatcher();
    const workflow = new RetentionOfferWorkflow({ dispatcher });

    const lowRes = await workflow.evaluateAndDispatch({
      signals: makeHealthySignals(),
      contact: makeContact(),
      idempotencyKey: 'evt-low-1',
    });
    expect(lowRes.status).toBe('skipped');
    expect(sent).toHaveLength(0);

    const suppressedRes = await workflow.evaluateAndDispatch({
      signals: makeHealthySignals({
        daysSinceLastActive: 35,
        overdueInvoiceCount: 2,
        usageDeltaPct: -50,
      }),
      contact: makeContact({ suppressed: true }),
      idempotencyKey: 'evt-suppressed-1',
    });
    expect(suppressedRes.status).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('dispatches via WhatsApp first, falls back to Email during WA cooldown, and rate-limits when both are cooling down', async () => {
    let now = Date.parse('2026-11-27T00:00:00.000Z');
    const { sent, dispatcher } = makeRecordingDispatcher();
    const store = new InMemoryRetentionRateLimitStore();
    const workflow = new RetentionOfferWorkflow({
      dispatcher,
      store,
      nowMs: () => now,
      policy: {
        channelCooldownMs: 24 * 60 * 60 * 1000,
        rollingWindowMs: 30 * 24 * 60 * 60 * 1000,
        maxOffersPerWindow: 3,
      },
    });

    const highRiskSignals = makeHealthySignals({
      daysSinceLastActive: 32,
      overdueInvoiceCount: 2,
      usageDeltaPct: -45,
    });

    // 1st trigger -> WhatsApp
    const first = await workflow.evaluateAndDispatch({
      signals: highRiskSignals,
      contact: makeContact(),
      idempotencyKey: 'evt-1',
    });
    expect(first.status).toBe('dispatched');
    expect(first.channel).toBe('whatsapp');
    expect(sent).toHaveLength(1);

    // Duplicate idempotency key -> no re-send
    const dup = await workflow.evaluateAndDispatch({
      signals: highRiskSignals,
      contact: makeContact(),
      idempotencyKey: 'evt-1',
    });
    expect(dup.status).toBe('duplicate');
    expect(sent).toHaveLength(1);

    // 2nd trigger 1 hour later -> WA is cooling down, falls back to Email
    now += 60 * 60 * 1000;
    const second = await workflow.evaluateAndDispatch({
      signals: highRiskSignals,
      contact: makeContact(),
      idempotencyKey: 'evt-2',
    });
    expect(second.status).toBe('dispatched');
    expect(second.channel).toBe('email');
    expect(sent).toHaveLength(2);

    // 3rd trigger 1 hour later -> both WA and Email cooling down -> rate_limited
    now += 60 * 60 * 1000;
    const third = await workflow.evaluateAndDispatch({
      signals: highRiskSignals,
      contact: makeContact(),
      idempotencyKey: 'evt-3',
    });
    expect(third.status).toBe('rate_limited');
    expect(sent).toHaveLength(2);

    // After cooldown expires -> WhatsApp eligible again (3rd offer in window)
    now += 25 * 60 * 60 * 1000;
    const fourth = await workflow.evaluateAndDispatch({
      signals: highRiskSignals,
      contact: makeContact(),
      idempotencyKey: 'evt-4',
    });
    expect(fourth.status).toBe('dispatched');
    expect(fourth.channel).toBe('whatsapp');
    expect(sent).toHaveLength(3);

    // After another cooldown -> rolling window cap (3) blocks further offers
    now += 25 * 60 * 60 * 1000;
    const fifth = await workflow.evaluateAndDispatch({
      signals: highRiskSignals,
      contact: makeContact(),
      idempotencyKey: 'evt-5',
    });
    expect(fifth.status).toBe('rate_limited');
    expect(fifth.reason).toContain('rolling window cap');
    expect(sent).toHaveLength(3);
  });
});
