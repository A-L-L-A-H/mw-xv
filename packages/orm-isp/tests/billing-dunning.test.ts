import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ISP_DUNNING_POLICY,
  computeDaysPastDue,
  evaluateSubscriberDunning,
  planIspDunningBatch,
  type IspDunningCandidate,
} from '../src/index.js';

function makeCandidate(overrides: Partial<IspDunningCandidate> = {}): IspDunningCandidate {
  return {
    subscriberId: 101,
    companyId: 1,
    username: 'cust-101@isp',
    subscriptionId: 501,
    invoiceId: 'INV-2026-11-001',
    amountDueMinor: 350_000,
    currency: 'IDR',
    dueDate: '2026-11-01',
    currentStatus: 'active',
    nasIp: '10.10.0.1',
    acctSessionId: 'sess-101',
    framedIpAddress: '100.64.0.101',
    ...overrides,
  };
}

describe('billing-dunning (ISP progressive dunning policy)', () => {
  it('validates strict calendar dates and computes exact days past due', () => {
    expect(computeDaysPastDue('2026-11-01', '2026-11-01')).toBe(0);
    expect(computeDaysPastDue('2026-11-01', '2026-10-30')).toBe(-2);
    expect(computeDaysPastDue('2026-10-31', '2026-11-10')).toBe(10);

    expect(() => computeDaysPastDue('2026-02-30', '2026-11-01')).toThrow();
    expect(() => computeDaysPastDue('2026-11-01', '11-01-2026')).toThrow();
    expect(() =>
      evaluateSubscriberDunning(makeCandidate(), { asOfDate: new Date('invalid') })
    ).toThrow();
  });

  it('progresses deterministically across all 7 dunning stages', () => {
    const candidate = makeCandidate({ dueDate: '2026-11-01' });

    const current = evaluateSubscriberDunning(candidate, { asOfDate: '2026-11-01' });
    expect(current.stage).toBe('current');
    expect(current.action).toBe('none');
    expect(current.daysPastDue).toBe(0);
    expect(current.notice).toBeUndefined();

    const reminder1 = evaluateSubscriberDunning(candidate, {
      asOfDate: '2026-11-02',
    });
    expect(reminder1.stage).toBe('reminder_1');
    expect(reminder1.action).toBe('send_notice');
    expect(reminder1.notice?.template).toBe('isp_dunning_reminder_1');
    expect(reminder1.notice?.channel).toBe('whatsapp');

    const reminder2 = evaluateSubscriberDunning(candidate, { asOfDate: '2026-11-04' });
    expect(reminder2.stage).toBe('reminder_2');
    expect(reminder2.action).toBe('send_notice');
    expect(reminder2.notice?.template).toBe('isp_dunning_reminder_2');

    const grace = evaluateSubscriberDunning(candidate, { asOfDate: '2026-11-06' });
    expect(grace.stage).toBe('grace_warning');
    expect(grace.action).toBe('send_notice');
    expect(grace.notice?.template).toBe('isp_dunning_grace_warning');

    const walled = evaluateSubscriberDunning(candidate, { asOfDate: '2026-11-08' });
    expect(walled.stage).toBe('walled_garden');
    expect(walled.action).toBe('apply_walled_garden');
    expect(walled.walledGardenProfile).toBe(DEFAULT_ISP_DUNNING_POLICY.walledGardenProfileName);
    expect(walled.notice?.template).toBe('isp_dunning_walled_garden');

    const suspended = evaluateSubscriberDunning(candidate, { asOfDate: '2026-11-11' });
    expect(suspended.stage).toBe('suspended');
    expect(suspended.action).toBe('suspend_and_disconnect');
    expect(suspended.disconnectPayload).toEqual({
      username: 'cust-101@isp',
      nasIp: '10.10.0.1',
      acctSessionId: 'sess-101',
      framedIpAddress: '100.64.0.101',
    });

    const terminated = evaluateSubscriberDunning(candidate, { asOfDate: '2026-12-01' });
    expect(terminated.stage).toBe('terminated');
    expect(terminated.action).toBe('terminate');
    expect(terminated.notice?.channel).toBe('email');
    expect(terminated.disconnectPayload?.username).toBe('cust-101@isp');
  });

  it('reactivates suspended subscribers when invoice is settled', () => {
    const decision = evaluateSubscriberDunning(
      makeCandidate({ amountDueMinor: 0, currentStatus: 'suspended' }),
      { asOfDate: '2026-11-15' }
    );

    expect(decision.stage).toBe('current');
    expect(decision.action).toBe('reactivate');
    expect(decision.lateFeeMinor).toBe(0);
    expect(decision.totalPayableMinor).toBe(0);

    const activeSettled = evaluateSubscriberDunning(
      makeCandidate({ amountDueMinor: 0, currentStatus: 'active' }),
      { asOfDate: '2026-11-15' }
    );
    expect(activeSettled.action).toBe('none');
  });

  it('respects dispute holds, billing exemptions, and already-terminated accounts', () => {
    const disputed = evaluateSubscriberDunning(makeCandidate({ isDisputed: true }), {
      asOfDate: '2026-11-25',
      policy: { lateFeeBps: 500, flatLateFeeMinor: 10_000 },
    });
    expect(disputed.stage).toBe('current');
    expect(disputed.action).toBe('none');
    expect(disputed.lateFeeMinor).toBe(0);
    expect(disputed.totalPayableMinor).toBe(350_000);
    expect(disputed.reason).toContain('dispute');

    const exempt = evaluateSubscriberDunning(makeCandidate({ isExempt: true }), {
      asOfDate: '2026-11-25',
      policy: { lateFeeBps: 500 },
    });
    expect(exempt.action).toBe('none');
    expect(exempt.lateFeeMinor).toBe(0);
    expect(exempt.reason).toContain('exempt');

    const terminated = evaluateSubscriberDunning(
      makeCandidate({ currentStatus: 'terminated' }),
      { asOfDate: '2026-12-15' }
    );
    expect(terminated.stage).toBe('terminated');
    expect(terminated.action).toBe('none');
  });

  it('computes BPS and flat late fees when overdue and builds deterministic idempotency keys', () => {
    const decision = evaluateSubscriberDunning(
      makeCandidate({ amountDueMinor: 200_000, companyId: 7, subscriberId: 42 }),
      {
        asOfDate: '2026-11-08',
        policy: {
          lateFeeBps: 250, // 2.5% = 5_000
          flatLateFeeMinor: 2_500,
          walledGardenProfileName: 'iso-walled-garden',
        },
      }
    );

    expect(decision.lateFeeMinor).toBe(7_500);
    expect(decision.totalPayableMinor).toBe(207_500);
    expect(decision.notice?.totalPayableMinor).toBe(207_500);
    expect(decision.walledGardenProfile).toBe('iso-walled-garden');
    expect(decision.idempotencyKey).toBe('isp-dunning|7|42|INV-2026-11-001|walled_garden');
  });

  it('orders batch decisions deterministically and aggregates stage/action totals', () => {
    const batch = planIspDunningBatch(
      [
        makeCandidate({ subscriberId: 2, companyId: 1, invoiceId: 'INV-2', dueDate: '2026-11-19' }), // reminder_1 (1d)
        makeCandidate({ subscriberId: 3, companyId: 1, invoiceId: 'INV-3', dueDate: '2026-10-20' }), // terminated (31d)
        makeCandidate({ subscriberId: 4, companyId: 1, invoiceId: 'INV-4', dueDate: '2026-11-10' }), // suspended (10d)
        makeCandidate({ subscriberId: 5, companyId: 1, invoiceId: 'INV-5', dueDate: '2026-11-13' }), // walled_garden (7d)
        makeCandidate({
          subscriberId: 6,
          companyId: 1,
          invoiceId: 'INV-6',
          amountDueMinor: 0,
          currentStatus: 'suspended',
        }), // reactivate
        makeCandidate({ subscriberId: 7, companyId: 1, invoiceId: 'INV-7', dueDate: '2026-11-25' }), // current
      ],
      {
        asOfDate: '2026-11-20',
        policy: { flatLateFeeMinor: 1_000 },
      }
    );

    expect(batch.asOfDate).toBe('2026-11-20');
    expect(batch.evaluated).toBe(6);
    expect(batch.decisions.map((d) => d.action)).toEqual([
      'terminate',
      'suspend_and_disconnect',
      'apply_walled_garden',
      'reactivate',
      'send_notice',
      'none',
    ]);
    expect(batch.countsByStage.terminated).toBe(1);
    expect(batch.countsByStage.suspended).toBe(1);
    expect(batch.countsByStage.walled_garden).toBe(1);
    expect(batch.countsByStage.reminder_1).toBe(1);
    expect(batch.countsByStage.current).toBe(2);
    expect(batch.countsByAction.terminate).toBe(1);
    expect(batch.countsByAction.suspend_and_disconnect).toBe(1);
    expect(batch.countsByAction.apply_walled_garden).toBe(1);
    expect(batch.countsByAction.reactivate).toBe(1);
    expect(batch.countsByAction.send_notice).toBe(1);
    expect(batch.countsByAction.none).toBe(1);
    expect(batch.totalOverdueMinor).toBe(4 * 350_000);
    expect(batch.totalLateFeeMinor).toBe(4_000);
  });

  it('rejects invalid policy thresholds and empty identifiers', () => {
    expect(() =>
      evaluateSubscriberDunning(makeCandidate({ username: '   ' }), { asOfDate: '2026-11-05' })
    ).toThrow();
    expect(() =>
      evaluateSubscriberDunning(makeCandidate(), {
        asOfDate: '2026-11-05',
        policy: { reminder1Day: 5, reminder2Day: 3 },
      })
    ).toThrow();
  });
});
