import {
  requireAuth,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequestBase,
  type AuthenticatedContext,
} from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import { planCoaBatch, type CoaPlanInput, type SubscriberLifecycleStatus } from './coa-policy.js';
import {
  aggregateRadiusAccounting,
  type RadiusAccountingPacket,
  type RadiusAcctStatusType,
  type SubscriberQuotaSpec,
} from './accounting-aggregator.js';

function parseCoaPlanInput(item: unknown): CoaPlanInput | null {
  if (!isRecord(item)) return null;
  const subscriberStatus = item.subscriberStatus as SubscriberLifecycleStatus;
  if (!['active', 'suspended', 'terminated'].includes(subscriberStatus)) return null;

  if (
    !isRecord(item.session) ||
    !isRecord(item.profile) ||
    !isRecord(item.nas) ||
    !isRecord(item.policy)
  ) {
    return null;
  }

  const session = item.session;
  if (
    typeof session.sessionId !== 'string' ||
    typeof session.username !== 'string' ||
    typeof session.totalBytesUsed !== 'number'
  ) {
    return null;
  }

  const profile = item.profile;
  if (
    typeof profile.name !== 'string' ||
    typeof profile.downloadKbps !== 'number' ||
    typeof profile.uploadKbps !== 'number'
  ) {
    return null;
  }

  const nas = item.nas;
  if (typeof nas.nasIp !== 'string' || typeof nas.secret !== 'string') {
    return null;
  }

  const policy = item.policy;
  if (typeof policy.quotaBytes !== 'number') {
    return null;
  }

  return {
    subscriberStatus,
    session: {
      sessionId: session.sessionId,
      username: session.username,
      totalBytesUsed: session.totalBytesUsed,
      ...(typeof session.framedIpAddress === 'string'
        ? { framedIpAddress: session.framedIpAddress }
        : {}),
      ...(typeof session.sessionDurationSeconds === 'number'
        ? { sessionDurationSeconds: session.sessionDurationSeconds }
        : {}),
    },
    profile: {
      name: profile.name,
      downloadKbps: profile.downloadKbps,
      uploadKbps: profile.uploadKbps,
      ...(typeof profile.burstDownloadKbps === 'number'
        ? { burstDownloadKbps: profile.burstDownloadKbps }
        : {}),
      ...(typeof profile.burstUploadKbps === 'number'
        ? { burstUploadKbps: profile.burstUploadKbps }
        : {}),
      ...(typeof profile.burstPeriodSeconds === 'number'
        ? { burstPeriodSeconds: profile.burstPeriodSeconds }
        : {}),
    },
    nas: {
      nasIp: nas.nasIp,
      secret: nas.secret,
      ...(typeof nas.coaPort === 'number' ? { coaPort: nas.coaPort } : {}),
      ...(typeof nas.vendor === 'string' ? { vendor: nas.vendor } : {}),
      ...(typeof nas.healthStatus === 'string' &&
      ['healthy', 'degraded', 'offline'].includes(nas.healthStatus)
        ? { healthStatus: nas.healthStatus as 'healthy' | 'degraded' | 'offline' }
        : {}),
      ...(typeof nas.isActive === 'boolean' ? { isActive: nas.isActive } : {}),
    },
    policy: {
      quotaBytes: policy.quotaBytes,
      ...(typeof policy.throttleThresholdRatio === 'number'
        ? { throttleThresholdRatio: policy.throttleThresholdRatio }
        : {}),
      ...(typeof policy.throttleDownloadRatio === 'number'
        ? { throttleDownloadRatio: policy.throttleDownloadRatio }
        : {}),
      ...(typeof policy.throttleUploadRatio === 'number'
        ? { throttleUploadRatio: policy.throttleUploadRatio }
        : {}),
      ...(typeof policy.minThrottleKbps === 'number'
        ? { minThrottleKbps: policy.minThrottleKbps }
        : {}),
      ...(typeof policy.disconnectOnHardQuota === 'boolean'
        ? { disconnectOnHardQuota: policy.disconnectOnHardQuota }
        : {}),
    },
  };
}

function parseRadiusPacket(item: unknown): RadiusAccountingPacket | null {
  if (!isRecord(item)) return null;
  if (
    typeof item.acctUniqueSessionId !== 'string' ||
    typeof item.acctSessionId !== 'string' ||
    typeof item.username !== 'string' ||
    typeof item.nasIp !== 'string' ||
    typeof item.acctStatusType !== 'string' ||
    !['Start', 'Interim-Update', 'Stop'].includes(item.acctStatusType) ||
    typeof item.eventTimestampMs !== 'number'
  ) {
    return null;
  }
  return {
    acctUniqueSessionId: item.acctUniqueSessionId,
    acctSessionId: item.acctSessionId,
    username: item.username,
    nasIp: item.nasIp,
    acctStatusType: item.acctStatusType as RadiusAcctStatusType,
    eventTimestampMs: item.eventTimestampMs,
    ...(typeof item.acctInputOctets === 'number' ? { acctInputOctets: item.acctInputOctets } : {}),
    ...(typeof item.acctOutputOctets === 'number'
      ? { acctOutputOctets: item.acctOutputOctets }
      : {}),
    ...(typeof item.acctInputGigawords === 'number'
      ? { acctInputGigawords: item.acctInputGigawords }
      : {}),
    ...(typeof item.acctOutputGigawords === 'number'
      ? { acctOutputGigawords: item.acctOutputGigawords }
      : {}),
    ...(typeof item.acctSessionTimeSeconds === 'number'
      ? { acctSessionTimeSeconds: item.acctSessionTimeSeconds }
      : {}),
    ...(typeof item.framedIpAddress === 'string' ? { framedIpAddress: item.framedIpAddress } : {}),
  };
}

function parseQuotaSpec(item: unknown): SubscriberQuotaSpec | null {
  if (!isRecord(item)) return null;
  if (
    typeof item.username !== 'string' ||
    typeof item.quotaBytes !== 'number' ||
    typeof item.overagePricePerGbMinor !== 'number'
  ) {
    return null;
  }
  return {
    username: item.username,
    quotaBytes: item.quotaBytes,
    overagePricePerGbMinor: item.overagePricePerGbMinor,
  };
}

export const ispHardeningHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post<{ Body: unknown }>('/api/isp/coa/plan', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [req.body];

    const parsedInputs: CoaPlanInput[] = [];
    for (const rawItem of items) {
      const parsed = parseCoaPlanInput(rawItem);
      if (!parsed) {
        return reply.code(400).send({ success: false, error: 'Invalid CoA plan input structure' });
      }
      parsedInputs.push(parsed);
    }

    const result = planCoaBatch(parsedInputs);
    return reply.code(200).send({ success: true, data: result });
  });

  app.post<{ Body: unknown }>('/api/isp/accounting/aggregate', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    if (!Array.isArray(req.body.packets)) {
      return reply.code(400).send({ success: false, error: 'packets array is required' });
    }

    const packets: RadiusAccountingPacket[] = [];
    for (const raw of req.body.packets) {
      const parsed = parseRadiusPacket(raw);
      if (!parsed) {
        return reply
          .code(400)
          .send({ success: false, error: 'Invalid accounting packet structure' });
      }
      packets.push(parsed);
    }

    const nowMs = typeof req.body.nowMs === 'number' ? req.body.nowMs : Date.now();
    const quotas: SubscriberQuotaSpec[] = [];
    if (Array.isArray(req.body.quotas)) {
      for (const q of req.body.quotas) {
        const parsed = parseQuotaSpec(q);
        if (parsed) quotas.push(parsed);
      }
    }

    const staleSessionThresholdSeconds =
      typeof req.body.staleSessionThresholdSeconds === 'number'
        ? req.body.staleSessionThresholdSeconds
        : undefined;
    const nasSilentThresholdSeconds =
      typeof req.body.nasSilentThresholdSeconds === 'number'
        ? req.body.nasSilentThresholdSeconds
        : undefined;
    const duplicateStormRatioThreshold =
      typeof req.body.duplicateStormRatioThreshold === 'number'
        ? req.body.duplicateStormRatioThreshold
        : undefined;

    const result = aggregateRadiusAccounting(packets, {
      nowMs,
      ...(staleSessionThresholdSeconds !== undefined ? { staleSessionThresholdSeconds } : {}),
      ...(nasSilentThresholdSeconds !== undefined ? { nasSilentThresholdSeconds } : {}),
      ...(duplicateStormRatioThreshold !== undefined ? { duplicateStormRatioThreshold } : {}),
      ...(quotas.length > 0 ? { quotas } : {}),
    });

    return reply.code(200).send({ success: true, data: result });
  });
};
