export type DunningStage =
  | 'current'
  | 'reminder_1'
  | 'reminder_2'
  | 'grace_warning'
  | 'walled_garden'
  | 'suspended'
  | 'terminated';

export type DunningActionKind =
  | 'none'
  | 'send_notice'
  | 'apply_walled_garden'
  | 'suspend_and_disconnect'
  | 'terminate'
  | 'reactivate';

export interface IspDunningPolicy {
  readonly reminder1Day?: number;
  readonly reminder2Day?: number;
  readonly graceWarningDay?: number;
  readonly walledGardenDay?: number;
  readonly suspendDay?: number;
  readonly terminateDay?: number;
  readonly lateFeeBps?: number;
  readonly flatLateFeeMinor?: number;
  readonly walledGardenProfileName?: string;
}

export interface ResolvedIspDunningPolicy {
  readonly reminder1Day: number;
  readonly reminder2Day: number;
  readonly graceWarningDay: number;
  readonly walledGardenDay: number;
  readonly suspendDay: number;
  readonly terminateDay: number;
  readonly lateFeeBps: number;
  readonly flatLateFeeMinor: number;
  readonly walledGardenProfileName: string;
}

export interface IspDunningCandidate {
  readonly subscriberId: number;
  readonly companyId: number;
  readonly username: string;
  readonly subscriptionId: number;
  readonly invoiceId: string;
  readonly amountDueMinor: number;
  readonly currency: string;
  readonly dueDate: string;
  readonly currentStatus: 'active' | 'suspended' | 'terminated';
  readonly isDisputed?: boolean;
  readonly isExempt?: boolean;
  readonly nasIp?: string | null;
  readonly acctSessionId?: string | null;
  readonly framedIpAddress?: string | null;
}

export interface IspDunningNotice {
  readonly template: string;
  readonly channel: 'whatsapp' | 'email';
  readonly subscriberId: number;
  readonly username: string;
  readonly invoiceId: string;
  readonly amountDueMinor: number;
  readonly lateFeeMinor: number;
  readonly totalPayableMinor: number;
  readonly currency: string;
  readonly daysPastDue: number;
}

export interface IspDunningDisconnectPayload {
  readonly username: string;
  readonly nasIp: string | null;
  readonly acctSessionId: string | null;
  readonly framedIpAddress: string | null;
}

export interface IspDunningDecision {
  readonly subscriberId: number;
  readonly companyId: number;
  readonly username: string;
  readonly invoiceId: string;
  readonly stage: DunningStage;
  readonly action: DunningActionKind;
  readonly daysPastDue: number;
  readonly lateFeeMinor: number;
  readonly totalPayableMinor: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly notice?: IspDunningNotice;
  readonly walledGardenProfile?: string;
  readonly disconnectPayload?: IspDunningDisconnectPayload;
}

export interface EvaluateSubscriberDunningOptions {
  readonly asOfDate?: string | Date;
  readonly policy?: IspDunningPolicy;
}

export interface IspDunningBatchResult {
  readonly asOfDate: string;
  readonly evaluated: number;
  readonly decisions: readonly IspDunningDecision[];
  readonly countsByStage: Record<DunningStage, number>;
  readonly countsByAction: Record<DunningActionKind, number>;
  readonly totalOverdueMinor: number;
  readonly totalLateFeeMinor: number;
}

export const DEFAULT_ISP_DUNNING_POLICY: ResolvedIspDunningPolicy = Object.freeze({
  reminder1Day: 1,
  reminder2Day: 3,
  graceWarningDay: 5,
  walledGardenDay: 7,
  suspendDay: 10,
  terminateDay: 30,
  lateFeeBps: 0,
  flatLateFeeMinor: 0,
  walledGardenProfileName: 'walled-garden-billing',
});

const MS_PER_DAY = 86_400_000;

const ACTION_PRIORITY: Readonly<Record<DunningActionKind, number>> = {
  terminate: 0,
  suspend_and_disconnect: 1,
  apply_walled_garden: 2,
  reactivate: 3,
  send_notice: 4,
  none: 5,
};

function parseStrictIsoDateUtcMs(value: string, label: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar YYYY-MM-DD date`);
  }
  return parsed.getTime();
}

function normalizeAsOfDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Dunning asOfDate must be a valid Date');
    }
    return value.toISOString().slice(0, 10);
  }
  parseStrictIsoDateUtcMs(value, 'Dunning asOfDate');
  return value;
}

export function computeDaysPastDue(dueDate: string, asOfDate: string): number {
  const dueMs = parseStrictIsoDateUtcMs(dueDate, 'Invoice dueDate');
  const asOfMs = parseStrictIsoDateUtcMs(asOfDate, 'Dunning asOfDate');
  return Math.trunc((asOfMs - dueMs) / MS_PER_DAY);
}

function resolveDunningPolicy(policy?: IspDunningPolicy): ResolvedIspDunningPolicy {
  const resolved: ResolvedIspDunningPolicy = {
    reminder1Day: policy?.reminder1Day ?? DEFAULT_ISP_DUNNING_POLICY.reminder1Day,
    reminder2Day: policy?.reminder2Day ?? DEFAULT_ISP_DUNNING_POLICY.reminder2Day,
    graceWarningDay: policy?.graceWarningDay ?? DEFAULT_ISP_DUNNING_POLICY.graceWarningDay,
    walledGardenDay: policy?.walledGardenDay ?? DEFAULT_ISP_DUNNING_POLICY.walledGardenDay,
    suspendDay: policy?.suspendDay ?? DEFAULT_ISP_DUNNING_POLICY.suspendDay,
    terminateDay: policy?.terminateDay ?? DEFAULT_ISP_DUNNING_POLICY.terminateDay,
    lateFeeBps: policy?.lateFeeBps ?? DEFAULT_ISP_DUNNING_POLICY.lateFeeBps,
    flatLateFeeMinor: policy?.flatLateFeeMinor ?? DEFAULT_ISP_DUNNING_POLICY.flatLateFeeMinor,
    walledGardenProfileName:
      policy?.walledGardenProfileName?.trim() || DEFAULT_ISP_DUNNING_POLICY.walledGardenProfileName,
  };

  const thresholds = [
    resolved.reminder1Day,
    resolved.reminder2Day,
    resolved.graceWarningDay,
    resolved.walledGardenDay,
    resolved.suspendDay,
    resolved.terminateDay,
  ];
  if (thresholds.some((day) => !Number.isInteger(day) || day < 1)) {
    throw new Error('Dunning stage day thresholds must be positive integers');
  }
  for (let i = 1; i < thresholds.length; i += 1) {
    if (thresholds[i]! < thresholds[i - 1]!) {
      throw new Error('Dunning stage day thresholds must be monotonically non-decreasing');
    }
  }
  if (!Number.isFinite(resolved.lateFeeBps) || resolved.lateFeeBps < 0) {
    throw new Error('Dunning lateFeeBps must be a finite non-negative number');
  }
  if (!Number.isFinite(resolved.flatLateFeeMinor) || resolved.flatLateFeeMinor < 0) {
    throw new Error('Dunning flatLateFeeMinor must be a finite non-negative number');
  }

  return resolved;
}

function validateCandidate(candidate: IspDunningCandidate): void {
  if (!candidate.username || !candidate.username.trim()) {
    throw new Error('Dunning candidate requires a non-empty username');
  }
  if (!candidate.invoiceId || !candidate.invoiceId.trim()) {
    throw new Error('Dunning candidate requires a non-empty invoiceId');
  }
  if (!Number.isFinite(candidate.amountDueMinor)) {
    throw new Error('Dunning candidate amountDueMinor must be finite');
  }
}

function buildDunningIdempotencyKey(
  candidate: IspDunningCandidate,
  stage: DunningStage
): string {
  return [
    'isp-dunning',
    candidate.companyId,
    candidate.subscriberId,
    candidate.invoiceId.trim(),
    stage,
  ].join('|');
}

function calculateLateFeeMinor(
  amountDueMinor: number,
  daysPastDue: number,
  policy: ResolvedIspDunningPolicy
): number {
  if (daysPastDue < policy.reminder1Day || amountDueMinor <= 0) {
    return 0;
  }
  const bpsFee = Math.round((amountDueMinor * policy.lateFeeBps) / 10_000);
  const flatFee = Math.round(policy.flatLateFeeMinor);
  return Math.max(0, bpsFee + flatFee);
}

function buildNotice(
  candidate: IspDunningCandidate,
  template: string,
  channel: 'whatsapp' | 'email',
  lateFeeMinor: number,
  daysPastDue: number
): IspDunningNotice {
  const amountDueMinor = Math.max(0, Math.round(candidate.amountDueMinor));
  return {
    template,
    channel,
    subscriberId: candidate.subscriberId,
    username: candidate.username.trim(),
    invoiceId: candidate.invoiceId.trim(),
    amountDueMinor,
    lateFeeMinor,
    totalPayableMinor: amountDueMinor + lateFeeMinor,
    currency: candidate.currency,
    daysPastDue,
  };
}

function buildDisconnectPayload(candidate: IspDunningCandidate): IspDunningDisconnectPayload {
  return {
    username: candidate.username.trim(),
    nasIp: candidate.nasIp ?? null,
    acctSessionId: candidate.acctSessionId ?? null,
    framedIpAddress: candidate.framedIpAddress ?? null,
  };
}

function resolveOverdueStage(
  daysPastDue: number,
  policy: ResolvedIspDunningPolicy
): {
  readonly stage: DunningStage;
  readonly action: DunningActionKind;
  readonly template?: string;
  readonly channel?: 'whatsapp' | 'email';
  readonly reason: string;
} {
  if (daysPastDue >= policy.terminateDay) {
    return {
      stage: 'terminated',
      action: 'terminate',
      template: 'isp_dunning_terminated',
      channel: 'email',
      reason: `Invoice is ${daysPastDue} day(s) past due (terminate threshold ${policy.terminateDay}d)`,
    };
  }
  if (daysPastDue >= policy.suspendDay) {
    return {
      stage: 'suspended',
      action: 'suspend_and_disconnect',
      template: 'isp_dunning_suspended',
      channel: 'whatsapp',
      reason: `Invoice is ${daysPastDue} day(s) past due (suspend threshold ${policy.suspendDay}d)`,
    };
  }
  if (daysPastDue >= policy.walledGardenDay) {
    return {
      stage: 'walled_garden',
      action: 'apply_walled_garden',
      template: 'isp_dunning_walled_garden',
      channel: 'whatsapp',
      reason: `Invoice is ${daysPastDue} day(s) past due (walled-garden threshold ${policy.walledGardenDay}d)`,
    };
  }
  if (daysPastDue >= policy.graceWarningDay) {
    return {
      stage: 'grace_warning',
      action: 'send_notice',
      template: 'isp_dunning_grace_warning',
      channel: 'whatsapp',
      reason: `Invoice is ${daysPastDue} day(s) past due (grace-warning threshold ${policy.graceWarningDay}d)`,
    };
  }
  if (daysPastDue >= policy.reminder2Day) {
    return {
      stage: 'reminder_2',
      action: 'send_notice',
      template: 'isp_dunning_reminder_2',
      channel: 'whatsapp',
      reason: `Invoice is ${daysPastDue} day(s) past due (reminder-2 threshold ${policy.reminder2Day}d)`,
    };
  }
  if (daysPastDue >= policy.reminder1Day) {
    return {
      stage: 'reminder_1',
      action: 'send_notice',
      template: 'isp_dunning_reminder_1',
      channel: 'whatsapp',
      reason: `Invoice is ${daysPastDue} day(s) past due (reminder-1 threshold ${policy.reminder1Day}d)`,
    };
  }
  return {
    stage: 'current',
    action: 'none',
    reason: 'Invoice is within payment term',
  };
}

export function evaluateSubscriberDunning(
  candidate: IspDunningCandidate,
  options: EvaluateSubscriberDunningOptions = {}
): IspDunningDecision {
  validateCandidate(candidate);
  const policy = resolveDunningPolicy(options.policy);
  const asOfDate = normalizeAsOfDate(options.asOfDate ?? new Date());
  const daysPastDue = computeDaysPastDue(candidate.dueDate, asOfDate);
  const amountDueMinor = Math.max(0, Math.round(candidate.amountDueMinor));

  if (amountDueMinor === 0) {
    const isSuspended = candidate.currentStatus === 'suspended';
    return {
      subscriberId: candidate.subscriberId,
      companyId: candidate.companyId,
      username: candidate.username.trim(),
      invoiceId: candidate.invoiceId.trim(),
      stage: 'current',
      action: isSuspended ? 'reactivate' : 'none',
      daysPastDue,
      lateFeeMinor: 0,
      totalPayableMinor: 0,
      idempotencyKey: buildDunningIdempotencyKey(candidate, 'current'),
      reason: isSuspended ? 'Invoice settled; reactivate suspended subscriber' : 'Invoice settled',
    };
  }

  if (candidate.currentStatus === 'terminated') {
    return {
      subscriberId: candidate.subscriberId,
      companyId: candidate.companyId,
      username: candidate.username.trim(),
      invoiceId: candidate.invoiceId.trim(),
      stage: 'terminated',
      action: 'none',
      daysPastDue,
      lateFeeMinor: 0,
      totalPayableMinor: amountDueMinor,
      idempotencyKey: buildDunningIdempotencyKey(candidate, 'terminated'),
      reason: 'Subscriber is already terminated',
    };
  }

  if (candidate.isDisputed || candidate.isExempt) {
    return {
      subscriberId: candidate.subscriberId,
      companyId: candidate.companyId,
      username: candidate.username.trim(),
      invoiceId: candidate.invoiceId.trim(),
      stage: 'current',
      action: 'none',
      daysPastDue,
      lateFeeMinor: 0,
      totalPayableMinor: amountDueMinor,
      idempotencyKey: buildDunningIdempotencyKey(candidate, 'current'),
      reason: candidate.isDisputed ? 'Invoice is under dispute hold' : 'Subscriber is dunning-exempt',
    };
  }

  const transition = resolveOverdueStage(daysPastDue, policy);
  const lateFeeMinor =
    transition.stage === 'current'
      ? 0
      : calculateLateFeeMinor(amountDueMinor, daysPastDue, policy);
  const totalPayableMinor = amountDueMinor + lateFeeMinor;

  return {
    subscriberId: candidate.subscriberId,
    companyId: candidate.companyId,
    username: candidate.username.trim(),
    invoiceId: candidate.invoiceId.trim(),
    stage: transition.stage,
    action: transition.action,
    daysPastDue,
    lateFeeMinor,
    totalPayableMinor,
    idempotencyKey: buildDunningIdempotencyKey(candidate, transition.stage),
    reason: transition.reason,
    ...(transition.template && transition.channel
      ? {
          notice: buildNotice(
            candidate,
            transition.template,
            transition.channel,
            lateFeeMinor,
            daysPastDue
          ),
        }
      : {}),
    ...(transition.action === 'apply_walled_garden'
      ? { walledGardenProfile: policy.walledGardenProfileName }
      : {}),
    ...(transition.action === 'suspend_and_disconnect' || transition.action === 'terminate'
      ? { disconnectPayload: buildDisconnectPayload(candidate) }
      : {}),
  };
}

function emptyStageCounts(): Record<DunningStage, number> {
  return {
    current: 0,
    reminder_1: 0,
    reminder_2: 0,
    grace_warning: 0,
    walled_garden: 0,
    suspended: 0,
    terminated: 0,
  };
}

function emptyActionCounts(): Record<DunningActionKind, number> {
  return {
    none: 0,
    send_notice: 0,
    apply_walled_garden: 0,
    suspend_and_disconnect: 0,
    terminate: 0,
    reactivate: 0,
  };
}

export function planIspDunningBatch(
  candidates: readonly IspDunningCandidate[],
  options: EvaluateSubscriberDunningOptions = {}
): IspDunningBatchResult {
  const asOfDate = normalizeAsOfDate(options.asOfDate ?? new Date());
  const normalizedOptions: EvaluateSubscriberDunningOptions = {
    ...options,
    asOfDate,
  };

  const countsByStage = emptyStageCounts();
  const countsByAction = emptyActionCounts();
  let totalOverdueMinor = 0;
  let totalLateFeeMinor = 0;

  const decisions = candidates.map((candidate) => {
    const decision = evaluateSubscriberDunning(candidate, normalizedOptions);
    countsByStage[decision.stage] += 1;
    countsByAction[decision.action] += 1;
    if (
      decision.daysPastDue > 0 &&
      candidate.amountDueMinor > 0 &&
      candidate.currentStatus !== 'terminated' &&
      !candidate.isDisputed &&
      !candidate.isExempt
    ) {
      totalOverdueMinor += Math.round(candidate.amountDueMinor);
    }
    totalLateFeeMinor += decision.lateFeeMinor;
    return decision;
  });

  decisions.sort((a, b) => {
    const priorityDiff = ACTION_PRIORITY[a.action] - ACTION_PRIORITY[b.action];
    if (priorityDiff !== 0) return priorityDiff;
    if (a.companyId !== b.companyId) return a.companyId - b.companyId;
    if (a.subscriberId !== b.subscriberId) return a.subscriberId - b.subscriberId;
    return a.invoiceId.localeCompare(b.invoiceId);
  });

  return {
    asOfDate,
    evaluated: candidates.length,
    decisions,
    countsByStage,
    countsByAction,
    totalOverdueMinor,
    totalLateFeeMinor,
  };
}
