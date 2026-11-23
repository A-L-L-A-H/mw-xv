export type RadiusAcctStatusType = 'Start' | 'Interim-Update' | 'Stop';

export interface RadiusAccountingPacket {
  readonly acctUniqueSessionId: string;
  readonly acctSessionId: string;
  readonly username: string;
  readonly nasIp: string;
  readonly acctStatusType: RadiusAcctStatusType;
  readonly eventTimestampMs: number;
  readonly acctInputOctets?: number;
  readonly acctOutputOctets?: number;
  readonly acctInputGigawords?: number;
  readonly acctOutputGigawords?: number;
  readonly acctSessionTimeSeconds?: number;
  readonly framedIpAddress?: string | null;
}

export interface AggregatedSessionUsage {
  readonly acctUniqueSessionId: string;
  readonly acctSessionId: string;
  readonly username: string;
  readonly nasIp: string;
  readonly totalInputBytes: number;
  readonly totalOutputBytes: number;
  readonly totalBytes: number;
  readonly sessionDurationSeconds: number;
  readonly packetCount: number;
  readonly duplicatePacketCount: number;
  readonly counterWrapCount: number;
  readonly status: 'active' | 'stopped' | 'stale';
  readonly firstSeenMs: number;
  readonly lastSeenMs: number;
}

export interface SubscriberQuotaSpec {
  readonly username: string;
  readonly quotaBytes: number;
  readonly overagePricePerGbMinor: number;
}

export interface SubscriberOverageReport {
  readonly username: string;
  readonly sessionCount: number;
  readonly totalBytes: number;
  readonly quotaBytes: number;
  readonly overageBytes: number;
  readonly billableOverageGb: number;
  readonly overageAmountMinor: number;
}

export type NasAlertCode = 'STALE_SESSIONS_HIGH' | 'DUPLICATE_PACKET_STORM' | 'NAS_SILENT';

export interface NasHealthReport {
  readonly nasIp: string;
  readonly activeSessions: number;
  readonly stoppedSessions: number;
  readonly staleSessions: number;
  readonly totalPackets: number;
  readonly duplicatePackets: number;
  readonly duplicateRatio: number;
  readonly lastPacketMs: number;
  readonly healthStatus: 'healthy' | 'degraded' | 'offline';
  readonly alerts: readonly NasAlertCode[];
}

export interface AccountingAggregationOptions {
  readonly nowMs: number;
  readonly staleSessionThresholdSeconds?: number;
  readonly nasSilentThresholdSeconds?: number;
  readonly duplicateStormRatioThreshold?: number;
  readonly quotas?: readonly SubscriberQuotaSpec[];
}

export interface AccountingAggregationResult {
  readonly sessions: readonly AggregatedSessionUsage[];
  readonly staleSessions: readonly AggregatedSessionUsage[];
  readonly overages: readonly SubscriberOverageReport[];
  readonly nasHealth: readonly NasHealthReport[];
  readonly totalPacketsProcessed: number;
  readonly totalDuplicatePacketsDropped: number;
}

export const UINT32_WRAP = 4_294_967_296; // 2^32
export const BYTES_PER_GB = 1_073_741_824;

interface SessionAccumulator {
  acctUniqueSessionId: string;
  acctSessionId: string;
  username: string;
  nasIp: string;
  prevInputOctets: number;
  prevOutputOctets: number;
  prevInputGigawords: number;
  prevOutputGigawords: number;
  implicitInputWraps: number;
  implicitOutputWraps: number;
  totalInputBytes: number;
  totalOutputBytes: number;
  sessionDurationSeconds: number;
  packetCount: number;
  duplicatePacketCount: number;
  counterWrapCount: number;
  stopped: boolean;
  firstSeenMs: number;
  lastSeenMs: number;
  seenPacketFingerprints: Set<string>;
}

function packetFingerprint(packet: RadiusAccountingPacket): string {
  return [
    packet.acctUniqueSessionId,
    packet.acctStatusType,
    packet.eventTimestampMs,
    packet.acctInputOctets ?? 0,
    packet.acctOutputOctets ?? 0,
    packet.acctInputGigawords ?? 0,
    packet.acctOutputGigawords ?? 0,
    packet.acctSessionTimeSeconds ?? 0,
  ].join('|');
}

export function compute64BitOctets(octets: number, gigawords: number, implicitWraps = 0): number {
  const safeOctets = Math.max(0, Math.floor(octets));
  const safeGigawords = Math.max(0, Math.floor(gigawords));
  return (safeGigawords + implicitWraps) * UINT32_WRAP + safeOctets;
}

export function aggregateRadiusAccounting(
  packets: readonly RadiusAccountingPacket[],
  options: AccountingAggregationOptions
): AccountingAggregationResult {
  const staleThresholdMs = (options.staleSessionThresholdSeconds ?? 900) * 1000;
  const nasSilentThresholdMs = (options.nasSilentThresholdSeconds ?? 1800) * 1000;
  const duplicateStormThreshold = options.duplicateStormRatioThreshold ?? 0.25;

  // Sort packets deterministically by timestamp, then status order (Start < Interim-Update < Stop)
  const statusRank: Record<RadiusAcctStatusType, number> = {
    Start: 0,
    'Interim-Update': 1,
    Stop: 2,
  };
  const sorted = [...packets].sort(
    (a, b) =>
      a.eventTimestampMs - b.eventTimestampMs ||
      statusRank[a.acctStatusType] - statusRank[b.acctStatusType] ||
      a.acctUniqueSessionId.localeCompare(b.acctUniqueSessionId)
  );

  const sessionsMap = new Map<string, SessionAccumulator>();
  const nasPacketStats = new Map<
    string,
    { total: number; duplicates: number; lastPacketMs: number }
  >();
  let totalDuplicatePacketsDropped = 0;

  for (const pkt of sorted) {
    const nasStat = nasPacketStats.get(pkt.nasIp) ?? {
      total: 0,
      duplicates: 0,
      lastPacketMs: pkt.eventTimestampMs,
    };
    nasStat.total += 1;
    nasStat.lastPacketMs = Math.max(nasStat.lastPacketMs, pkt.eventTimestampMs);
    nasPacketStats.set(pkt.nasIp, nasStat);

    const key = pkt.acctUniqueSessionId.trim();
    const fp = packetFingerprint(pkt);
    const inOctets = Math.max(0, Math.floor(pkt.acctInputOctets ?? 0));
    const outOctets = Math.max(0, Math.floor(pkt.acctOutputOctets ?? 0));
    const inGiga = Math.max(0, Math.floor(pkt.acctInputGigawords ?? 0));
    const outGiga = Math.max(0, Math.floor(pkt.acctOutputGigawords ?? 0));
    const duration = Math.max(0, Math.floor(pkt.acctSessionTimeSeconds ?? 0));

    let acc = sessionsMap.get(key);
    if (!acc) {
      acc = {
        acctUniqueSessionId: key,
        acctSessionId: pkt.acctSessionId,
        username: pkt.username,
        nasIp: pkt.nasIp,
        prevInputOctets: inOctets,
        prevOutputOctets: outOctets,
        prevInputGigawords: inGiga,
        prevOutputGigawords: outGiga,
        implicitInputWraps: 0,
        implicitOutputWraps: 0,
        totalInputBytes: compute64BitOctets(inOctets, inGiga, 0),
        totalOutputBytes: compute64BitOctets(outOctets, outGiga, 0),
        sessionDurationSeconds: duration,
        packetCount: 1,
        duplicatePacketCount: 0,
        counterWrapCount: 0,
        stopped: pkt.acctStatusType === 'Stop',
        firstSeenMs: pkt.eventTimestampMs,
        lastSeenMs: pkt.eventTimestampMs,
        seenPacketFingerprints: new Set([fp]),
      };
      sessionsMap.set(key, acc);
      continue;
    }

    if (acc.seenPacketFingerprints.has(fp)) {
      acc.duplicatePacketCount += 1;
      nasStat.duplicates += 1;
      totalDuplicatePacketsDropped += 1;
      continue;
    }

    // Also drop duplicate Stop packets for an already-stopped session
    if (acc.stopped && pkt.acctStatusType === 'Stop') {
      acc.duplicatePacketCount += 1;
      nasStat.duplicates += 1;
      totalDuplicatePacketsDropped += 1;
      continue;
    }

    acc.seenPacketFingerprints.add(fp);
    acc.packetCount += 1;
    acc.lastSeenMs = Math.max(acc.lastSeenMs, pkt.eventTimestampMs);
    acc.sessionDurationSeconds = Math.max(acc.sessionDurationSeconds, duration);

    // Detect implicit 32-bit counter wrap when NAS does not increment gigawords
    if (inGiga === acc.prevInputGigawords && inOctets < acc.prevInputOctets) {
      acc.implicitInputWraps += 1;
      acc.counterWrapCount += 1;
    }
    if (outGiga === acc.prevOutputGigawords && outOctets < acc.prevOutputOctets) {
      acc.implicitOutputWraps += 1;
      acc.counterWrapCount += 1;
    }

    const candidateIn = compute64BitOctets(inOctets, inGiga, acc.implicitInputWraps);
    const candidateOut = compute64BitOctets(outOctets, outGiga, acc.implicitOutputWraps);

    acc.totalInputBytes = Math.max(acc.totalInputBytes, candidateIn);
    acc.totalOutputBytes = Math.max(acc.totalOutputBytes, candidateOut);
    acc.prevInputOctets = inOctets;
    acc.prevOutputOctets = outOctets;
    acc.prevInputGigawords = inGiga;
    acc.prevOutputGigawords = outGiga;

    if (pkt.acctStatusType === 'Stop') {
      acc.stopped = true;
    }
  }

  const sessions: AggregatedSessionUsage[] = [];
  const staleSessions: AggregatedSessionUsage[] = [];

  for (const acc of sessionsMap.values()) {
    const isStale = !acc.stopped && options.nowMs - acc.lastSeenMs > staleThresholdMs;
    const status: AggregatedSessionUsage['status'] = acc.stopped
      ? 'stopped'
      : isStale
        ? 'stale'
        : 'active';

    const summary: AggregatedSessionUsage = {
      acctUniqueSessionId: acc.acctUniqueSessionId,
      acctSessionId: acc.acctSessionId,
      username: acc.username,
      nasIp: acc.nasIp,
      totalInputBytes: acc.totalInputBytes,
      totalOutputBytes: acc.totalOutputBytes,
      totalBytes: acc.totalInputBytes + acc.totalOutputBytes,
      sessionDurationSeconds: acc.sessionDurationSeconds,
      packetCount: acc.packetCount,
      duplicatePacketCount: acc.duplicatePacketCount,
      counterWrapCount: acc.counterWrapCount,
      status,
      firstSeenMs: acc.firstSeenMs,
      lastSeenMs: acc.lastSeenMs,
    };
    sessions.push(summary);
    if (isStale) {
      staleSessions.push(summary);
    }
  }

  sessions.sort((a, b) => a.acctUniqueSessionId.localeCompare(b.acctUniqueSessionId));
  staleSessions.sort((a, b) => a.acctUniqueSessionId.localeCompare(b.acctUniqueSessionId));

  // Build subscriber overage reports
  const usageByUser = new Map<string, { sessionCount: number; totalBytes: number }>();
  for (const s of sessions) {
    const entry = usageByUser.get(s.username) ?? { sessionCount: 0, totalBytes: 0 };
    entry.sessionCount += 1;
    entry.totalBytes += s.totalBytes;
    usageByUser.set(s.username, entry);
  }

  const overages: SubscriberOverageReport[] = [];
  for (const quota of options.quotas ?? []) {
    const usage = usageByUser.get(quota.username);
    if (!usage) continue;
    const overageBytes = Math.max(0, usage.totalBytes - quota.quotaBytes);
    const billableOverageGb = overageBytes > 0 ? Math.ceil(overageBytes / BYTES_PER_GB) : 0;
    const overageAmountMinor = billableOverageGb * quota.overagePricePerGbMinor;
    overages.push({
      username: quota.username,
      sessionCount: usage.sessionCount,
      totalBytes: usage.totalBytes,
      quotaBytes: quota.quotaBytes,
      overageBytes,
      billableOverageGb,
      overageAmountMinor,
    });
  }
  overages.sort((a, b) => a.username.localeCompare(b.username));

  // Build NAS health reports
  const nasHealth: NasHealthReport[] = [];
  for (const [nasIp, stats] of nasPacketStats.entries()) {
    const nasSessions = sessions.filter((s) => s.nasIp === nasIp);
    const activeSessions = nasSessions.filter((s) => s.status === 'active').length;
    const stoppedSessions = nasSessions.filter((s) => s.status === 'stopped').length;
    const staleCount = nasSessions.filter((s) => s.status === 'stale').length;
    const duplicateRatio = stats.total > 0 ? stats.duplicates / stats.total : 0;
    const alerts: NasAlertCode[] = [];

    const isSilent = options.nowMs - stats.lastPacketMs > nasSilentThresholdMs;
    if (isSilent) {
      alerts.push('NAS_SILENT');
    }
    if (staleCount > 0 && staleCount >= activeSessions) {
      alerts.push('STALE_SESSIONS_HIGH');
    }
    if (duplicateRatio >= duplicateStormThreshold && stats.duplicates >= 2) {
      alerts.push('DUPLICATE_PACKET_STORM');
    }

    const healthStatus: NasHealthReport['healthStatus'] = isSilent
      ? 'offline'
      : alerts.length > 0
        ? 'degraded'
        : 'healthy';

    nasHealth.push({
      nasIp,
      activeSessions,
      stoppedSessions,
      staleSessions: staleCount,
      totalPackets: stats.total,
      duplicatePackets: stats.duplicates,
      duplicateRatio,
      lastPacketMs: stats.lastPacketMs,
      healthStatus,
      alerts,
    });
  }
  nasHealth.sort((a, b) => a.nasIp.localeCompare(b.nasIp));

  return {
    sessions,
    staleSessions,
    overages,
    nasHealth,
    totalPacketsProcessed: packets.length,
    totalDuplicatePacketsDropped,
  };
}
