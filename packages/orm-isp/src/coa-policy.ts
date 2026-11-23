export type CoaActionKind = 'none' | 'throttle' | 'disconnect';

export type SubscriberLifecycleStatus = 'active' | 'suspended' | 'terminated';

export interface CoaBandwidthProfile {
  readonly name: string;
  readonly downloadKbps: number;
  readonly uploadKbps: number;
  readonly burstDownloadKbps?: number | null;
  readonly burstUploadKbps?: number | null;
  readonly burstPeriodSeconds?: number | null;
}

export interface CoaNasTarget {
  readonly nasIp: string;
  readonly coaPort?: number | null;
  readonly secret: string;
  readonly vendor?: string | null;
  readonly healthStatus?: 'healthy' | 'degraded' | 'offline' | null;
  readonly isActive?: boolean;
}

export interface CoaSessionUsage {
  readonly sessionId: string;
  readonly username: string;
  readonly framedIpAddress?: string | null;
  readonly totalBytesUsed: number;
  readonly sessionDurationSeconds?: number;
}

export interface CoaQuotaPolicy {
  readonly quotaBytes: number;
  readonly throttleThresholdRatio?: number;
  readonly throttleDownloadRatio?: number;
  readonly throttleUploadRatio?: number;
  readonly minThrottleKbps?: number;
  readonly disconnectOnHardQuota?: boolean;
}

export interface CoaPlanInput {
  readonly subscriberStatus: SubscriberLifecycleStatus;
  readonly session: CoaSessionUsage;
  readonly profile: CoaBandwidthProfile;
  readonly nas: CoaNasTarget;
  readonly policy: CoaQuotaPolicy;
}

export interface CoaRadiusAttributes {
  readonly 'User-Name': string;
  readonly 'Acct-Session-Id': string;
  readonly 'NAS-IP-Address': string;
  readonly 'Framed-IP-Address'?: string;
  readonly 'Mikrotik-Rate-Limit'?: string;
  readonly 'WISPr-Bandwidth-Max-Down'?: number;
  readonly 'WISPr-Bandwidth-Max-Up'?: number;
}

export interface CoaActionPayload {
  readonly idempotencyKey: string;
  readonly action: Exclude<CoaActionKind, 'none'>;
  readonly coaCode: 40 | 43;
  readonly nasIp: string;
  readonly coaPort: number;
  readonly redactedSecret: string;
  readonly attributes: CoaRadiusAttributes;
  readonly targetDownloadKbps?: number;
  readonly targetUploadKbps?: number;
}

export interface CoaPlanResult {
  readonly action: CoaActionKind;
  readonly reason: string;
  readonly valid: boolean;
  readonly validationErrors: readonly string[];
  readonly usageRatio: number;
  readonly payload?: CoaActionPayload;
}

export interface CoaBatchPlanResult {
  readonly plans: readonly CoaPlanResult[];
  readonly dispatchable: readonly CoaActionPayload[];
  readonly invalidCount: number;
  readonly skippedDuplicates: number;
}

export const DEFAULT_COA_PORT = 3799;
export const REDACTED_SECRET = '[REDACTED]';

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;

export function redactRadiusSecret(_secret: string | null | undefined): string {
  return REDACTED_SECRET;
}

export function isValidNasIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return false;
  if (IPV4_REGEX.test(trimmed)) return true;
  if (trimmed.includes(':') && IPV6_REGEX.test(trimmed) && trimmed.length >= 2) {
    return true;
  }
  return false;
}

export function validateCoaNasTarget(nas: CoaNasTarget): readonly string[] {
  const errors: string[] = [];
  if (!isValidNasIp(nas.nasIp)) {
    errors.push(`Invalid NAS IP address: "${nas.nasIp}"`);
  }
  const port = nas.coaPort ?? DEFAULT_COA_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`Invalid CoA UDP port: ${String(port)}`);
  }
  if (!nas.secret || nas.secret.trim().length < 4) {
    errors.push('RADIUS shared secret must be at least 4 non-whitespace characters');
  }
  if (nas.isActive === false) {
    errors.push(`NAS ${nas.nasIp} is inactive`);
  }
  if (nas.healthStatus === 'offline') {
    errors.push(`NAS ${nas.nasIp} is offline`);
  }
  return errors;
}

function buildIdempotencyKey(
  action: Exclude<CoaActionKind, 'none'>,
  nasIp: string,
  sessionId: string,
  username: string,
  rateSpec?: string
): string {
  const parts = [action, nasIp.trim(), sessionId.trim(), username.trim()];
  if (rateSpec) parts.push(rateSpec);
  return parts.join('|');
}

export function formatMikrotikRateLimit(downloadKbps: number, uploadKbps: number): string {
  return `${Math.max(1, Math.floor(uploadKbps))}k/${Math.max(1, Math.floor(downloadKbps))}k`;
}

export function planCoaAction(input: CoaPlanInput): CoaPlanResult {
  const { subscriberStatus, session, profile, nas, policy } = input;
  const quotaBytes = Math.max(0, policy.quotaBytes);
  const usedBytes = Math.max(0, session.totalBytesUsed);
  const usageRatio = quotaBytes > 0 ? usedBytes / quotaBytes : 0;

  const throttleThreshold = policy.throttleThresholdRatio ?? 0.8;
  const throttleDownRatio = policy.throttleDownloadRatio ?? 0.25;
  const throttleUpRatio = policy.throttleUploadRatio ?? 0.25;
  const minThrottleKbps = Math.max(64, policy.minThrottleKbps ?? 128);
  const disconnectOnHardQuota = policy.disconnectOnHardQuota ?? true;

  let action: CoaActionKind = 'none';
  let reason = 'within_quota';

  if (subscriberStatus === 'terminated' || subscriberStatus === 'suspended') {
    action = 'disconnect';
    reason = `subscriber_${subscriberStatus}`;
  } else if (quotaBytes > 0 && usedBytes >= quotaBytes && disconnectOnHardQuota) {
    action = 'disconnect';
    reason = 'hard_quota_exceeded';
  } else if (quotaBytes > 0 && (usedBytes >= quotaBytes || usageRatio >= throttleThreshold)) {
    action = 'throttle';
    reason = usedBytes >= quotaBytes ? 'hard_quota_throttle' : 'soft_quota_throttle';
  }

  if (action === 'none') {
    return {
      action: 'none',
      reason,
      valid: true,
      validationErrors: [],
      usageRatio,
    };
  }

  const validationErrors = [...validateCoaNasTarget(nas)];
  if (!session.sessionId.trim()) {
    validationErrors.push('Session ID is required for CoA dispatch');
  }
  if (!session.username.trim()) {
    validationErrors.push('Username is required for CoA dispatch');
  }

  if (validationErrors.length > 0) {
    return {
      action,
      reason,
      valid: false,
      validationErrors,
      usageRatio,
    };
  }

  const coaPort = nas.coaPort ?? DEFAULT_COA_PORT;
  const baseAttributes: CoaRadiusAttributes = {
    'User-Name': session.username.trim(),
    'Acct-Session-Id': session.sessionId.trim(),
    'NAS-IP-Address': nas.nasIp.trim(),
    ...(session.framedIpAddress ? { 'Framed-IP-Address': session.framedIpAddress.trim() } : {}),
  };

  if (action === 'disconnect') {
    return {
      action: 'disconnect',
      reason,
      valid: true,
      validationErrors: [],
      usageRatio,
      payload: {
        idempotencyKey: buildIdempotencyKey(
          'disconnect',
          nas.nasIp,
          session.sessionId,
          session.username
        ),
        action: 'disconnect',
        coaCode: 40,
        nasIp: nas.nasIp.trim(),
        coaPort,
        redactedSecret: redactRadiusSecret(nas.secret),
        attributes: baseAttributes,
      },
    };
  }

  const targetDownloadKbps = Math.max(
    minThrottleKbps,
    Math.min(profile.downloadKbps, Math.floor(profile.downloadKbps * throttleDownRatio))
  );
  const targetUploadKbps = Math.max(
    minThrottleKbps,
    Math.min(profile.uploadKbps, Math.floor(profile.uploadKbps * throttleUpRatio))
  );
  const rateLimit = formatMikrotikRateLimit(targetDownloadKbps, targetUploadKbps);

  return {
    action: 'throttle',
    reason,
    valid: true,
    validationErrors: [],
    usageRatio,
    payload: {
      idempotencyKey: buildIdempotencyKey(
        'throttle',
        nas.nasIp,
        session.sessionId,
        session.username,
        rateLimit
      ),
      action: 'throttle',
      coaCode: 43,
      nasIp: nas.nasIp.trim(),
      coaPort,
      redactedSecret: redactRadiusSecret(nas.secret),
      targetDownloadKbps,
      targetUploadKbps,
      attributes: {
        ...baseAttributes,
        'Mikrotik-Rate-Limit': rateLimit,
        'WISPr-Bandwidth-Max-Down': targetDownloadKbps * 1000,
        'WISPr-Bandwidth-Max-Up': targetUploadKbps * 1000,
      },
    },
  };
}

export function planCoaBatch(inputs: readonly CoaPlanInput[]): CoaBatchPlanResult {
  const plans = inputs.map((item) => planCoaAction(item));
  const seenKeys = new Set<string>();
  const dispatchable: CoaActionPayload[] = [];
  let invalidCount = 0;
  let skippedDuplicates = 0;

  for (const plan of plans) {
    if (!plan.valid) {
      invalidCount += 1;
      continue;
    }
    if (!plan.payload) continue;
    if (seenKeys.has(plan.payload.idempotencyKey)) {
      skippedDuplicates += 1;
      continue;
    }
    seenKeys.add(plan.payload.idempotencyKey);
    dispatchable.push(plan.payload);
  }

  // Deterministic ordering: disconnects first, then throttles, then by idempotencyKey
  dispatchable.sort((a, b) => {
    if (a.action !== b.action) {
      return a.action === 'disconnect' ? -1 : 1;
    }
    return a.idempotencyKey.localeCompare(b.idempotencyKey);
  });

  return {
    plans,
    dispatchable,
    invalidCount,
    skippedDuplicates,
  };
}
