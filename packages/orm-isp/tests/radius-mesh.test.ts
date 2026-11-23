import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_GB,
  REDACTED_SECRET,
  UINT32_WRAP,
  aggregateRadiusAccounting,
  compute64BitOctets,
  planCoaAction,
  planCoaBatch,
  redactRadiusSecret,
  validateCoaNasTarget,
  type CoaPlanInput,
  type RadiusAccountingPacket,
} from '../src/index.js';

const baseProfile = {
  name: 'Fiber-100M',
  downloadKbps: 100_000,
  uploadKbps: 50_000,
};

const baseNas = {
  nasIp: '10.20.30.1',
  coaPort: 3799,
  secret: 'super-secret-radius-key',
  vendor: 'mikrotik',
  healthStatus: 'healthy' as const,
  isActive: true,
};

describe('coa-policy (RADIUS CoA disconnect & dynamic bandwidth-throttle planner)', () => {
  it('returns none when subscriber is active and below soft throttle threshold', () => {
    const result = planCoaAction({
      subscriberStatus: 'active',
      session: {
        sessionId: 'sess-001',
        username: 'alice@isp',
        framedIpAddress: '100.64.0.10',
        totalBytesUsed: 5 * BYTES_PER_GB,
      },
      profile: baseProfile,
      nas: baseNas,
      policy: { quotaBytes: 10 * BYTES_PER_GB, throttleThresholdRatio: 0.8 },
    });

    expect(result.action).toBe('none');
    expect(result.reason).toBe('within_quota');
    expect(result.valid).toBe(true);
    expect(result.payload).toBeUndefined();
    expect(result.usageRatio).toBeCloseTo(0.5);
  });

  it('plans dynamic CoA throttle with redacted secret when usage crosses soft threshold', () => {
    const result = planCoaAction({
      subscriberStatus: 'active',
      session: {
        sessionId: 'sess-002',
        username: 'bob@isp',
        framedIpAddress: '100.64.0.11',
        totalBytesUsed: 8.5 * BYTES_PER_GB,
      },
      profile: baseProfile,
      nas: baseNas,
      policy: {
        quotaBytes: 10 * BYTES_PER_GB,
        throttleThresholdRatio: 0.8,
        throttleDownloadRatio: 0.2,
        throttleUploadRatio: 0.2,
      },
    });

    expect(result.action).toBe('throttle');
    expect(result.reason).toBe('soft_quota_throttle');
    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload?.coaCode).toBe(43);
    expect(result.payload?.redactedSecret).toBe(REDACTED_SECRET);
    expect(JSON.stringify(result.payload)).not.toContain(baseNas.secret);
    expect(result.payload?.targetDownloadKbps).toBe(20_000);
    expect(result.payload?.targetUploadKbps).toBe(10_000);
    expect(result.payload?.attributes['Mikrotik-Rate-Limit']).toBe('10000k/20000k');
    expect(result.payload?.attributes['WISPr-Bandwidth-Max-Down']).toBe(20_000_000);
    expect(result.payload?.attributes['WISPr-Bandwidth-Max-Up']).toBe(10_000_000);
  });

  it('plans CoA disconnect on hard quota ceiling or suspended/terminated status', () => {
    const hardQuota = planCoaAction({
      subscriberStatus: 'active',
      session: {
        sessionId: 'sess-003',
        username: 'carol@isp',
        totalBytesUsed: 10 * BYTES_PER_GB,
      },
      profile: baseProfile,
      nas: baseNas,
      policy: { quotaBytes: 10 * BYTES_PER_GB, disconnectOnHardQuota: true },
    });

    expect(hardQuota.action).toBe('disconnect');
    expect(hardQuota.reason).toBe('hard_quota_exceeded');
    expect(hardQuota.payload?.coaCode).toBe(40);

    const suspended = planCoaAction({
      subscriberStatus: 'suspended',
      session: {
        sessionId: 'sess-004',
        username: 'dave@isp',
        totalBytesUsed: 0,
      },
      profile: baseProfile,
      nas: baseNas,
      policy: { quotaBytes: 10 * BYTES_PER_GB },
    });

    expect(suspended.action).toBe('disconnect');
    expect(suspended.reason).toBe('subscriber_suspended');
    expect(suspended.payload?.coaCode).toBe(40);
  });

  it('validates NAS target and rejects offline/invalid targets without emitting payload', () => {
    const errors = validateCoaNasTarget({
      nasIp: '999.999.1.1',
      coaPort: 70000,
      secret: 'ab',
      healthStatus: 'offline',
      isActive: false,
    });
    expect(errors.length).toBe(5);
    expect(redactRadiusSecret('anything')).toBe(REDACTED_SECRET);

    const invalidPlan = planCoaAction({
      subscriberStatus: 'terminated',
      session: {
        sessionId: 'sess-005',
        username: 'eve@isp',
        totalBytesUsed: 0,
      },
      profile: baseProfile,
      nas: { ...baseNas, healthStatus: 'offline' },
      policy: { quotaBytes: 10 * BYTES_PER_GB },
    });

    expect(invalidPlan.valid).toBe(false);
    expect(invalidPlan.payload).toBeUndefined();
    expect(invalidPlan.validationErrors[0]).toContain('offline');
  });

  it('deduplicates idempotent CoA batch payloads and orders disconnects before throttles', () => {
    const throttleInput: CoaPlanInput = {
      subscriberStatus: 'active',
      session: { sessionId: 'sess-a', username: 'u1@isp', totalBytesUsed: 9 * BYTES_PER_GB },
      profile: baseProfile,
      nas: baseNas,
      policy: { quotaBytes: 10 * BYTES_PER_GB },
    };
    const disconnectInput: CoaPlanInput = {
      subscriberStatus: 'suspended',
      session: { sessionId: 'sess-z', username: 'u2@isp', totalBytesUsed: 1 * BYTES_PER_GB },
      profile: baseProfile,
      nas: baseNas,
      policy: { quotaBytes: 10 * BYTES_PER_GB },
    };

    const batch = planCoaBatch([throttleInput, disconnectInput, throttleInput]);
    expect(batch.skippedDuplicates).toBe(1);
    expect(batch.invalidCount).toBe(0);
    expect(batch.dispatchable).toHaveLength(2);
    expect(batch.dispatchable[0]?.action).toBe('disconnect');
    expect(batch.dispatchable[1]?.action).toBe('throttle');
  });
});

describe('accounting-aggregator (RADIUS session-to-billing usage aggregator)', () => {
  it('computes 64-bit octets with explicit gigawords and detects implicit 32-bit counter wraps', () => {
    expect(compute64BitOctets(500, 2)).toBe(2 * UINT32_WRAP + 500);

    const t0 = 1_700_000_000_000;
    const packets: RadiusAccountingPacket[] = [
      {
        acctUniqueSessionId: 'uniq-wrap-1',
        acctSessionId: 's-wrap-1',
        username: 'wrap@isp',
        nasIp: '10.0.0.1',
        acctStatusType: 'Start',
        eventTimestampMs: t0,
        acctInputOctets: 0,
        acctOutputOctets: 0,
      },
      {
        acctUniqueSessionId: 'uniq-wrap-1',
        acctSessionId: 's-wrap-1',
        username: 'wrap@isp',
        nasIp: '10.0.0.1',
        acctStatusType: 'Interim-Update',
        eventTimestampMs: t0 + 300_000,
        acctInputOctets: 4_000_000_000,
        acctOutputOctets: 1_000_000,
        acctSessionTimeSeconds: 300,
      },
      {
        // NAS wrapped 32-bit input octets without incrementing gigawords
        acctUniqueSessionId: 'uniq-wrap-1',
        acctSessionId: 's-wrap-1',
        username: 'wrap@isp',
        nasIp: '10.0.0.1',
        acctStatusType: 'Stop',
        eventTimestampMs: t0 + 600_000,
        acctInputOctets: 500_000_000,
        acctOutputOctets: 2_000_000,
        acctSessionTimeSeconds: 600,
      },
    ];

    const result = aggregateRadiusAccounting(packets, { nowMs: t0 + 650_000 });
    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0]!;
    expect(session.counterWrapCount).toBe(1);
    expect(session.totalInputBytes).toBe(UINT32_WRAP + 500_000_000);
    expect(session.totalOutputBytes).toBe(2_000_000);
    expect(session.status).toBe('stopped');
  });

  it('deduplicates retransmitted accounting packets and duplicate Stop packets', () => {
    const t0 = 1_700_000_000_000;
    const stopPkt: RadiusAccountingPacket = {
      acctUniqueSessionId: 'uniq-dup-1',
      acctSessionId: 's-dup-1',
      username: 'dup@isp',
      nasIp: '10.0.0.2',
      acctStatusType: 'Stop',
      eventTimestampMs: t0 + 120_000,
      acctInputOctets: 2 * BYTES_PER_GB,
      acctOutputOctets: 1 * BYTES_PER_GB,
      acctSessionTimeSeconds: 120,
    };

    const packets: RadiusAccountingPacket[] = [
      {
        acctUniqueSessionId: 'uniq-dup-1',
        acctSessionId: 's-dup-1',
        username: 'dup@isp',
        nasIp: '10.0.0.2',
        acctStatusType: 'Start',
        eventTimestampMs: t0,
      },
      stopPkt,
      stopPkt,
      { ...stopPkt, eventTimestampMs: t0 + 125_000 },
    ];

    const result = aggregateRadiusAccounting(packets, {
      nowMs: t0 + 150_000,
      quotas: [
        {
          username: 'dup@isp',
          quotaBytes: 2 * BYTES_PER_GB,
          overagePricePerGbMinor: 250,
        },
      ],
    });

    expect(result.totalDuplicatePacketsDropped).toBe(2);
    expect(result.sessions[0]?.duplicatePacketCount).toBe(2);
    expect(result.sessions[0]?.totalBytes).toBe(3 * BYTES_PER_GB);
    expect(result.overages).toHaveLength(1);
    expect(result.overages[0]?.overageBytes).toBe(1 * BYTES_PER_GB);
    expect(result.overages[0]?.billableOverageGb).toBe(1);
    expect(result.overages[0]?.overageAmountMinor).toBe(250);

    const nasReport = result.nasHealth.find((n) => n.nasIp === '10.0.0.2');
    expect(nasReport?.healthStatus).toBe('degraded');
    expect(nasReport?.alerts).toContain('DUPLICATE_PACKET_STORM');
  });

  it('detects stale/orphan NAS sessions and flags silent NAS as offline', () => {
    const t0 = 1_700_000_000_000;
    const packets: RadiusAccountingPacket[] = [
      {
        acctUniqueSessionId: 'uniq-stale-1',
        acctSessionId: 's-stale-1',
        username: 'orphan@isp',
        nasIp: '10.0.0.9',
        acctStatusType: 'Start',
        eventTimestampMs: t0,
        acctInputOctets: 1024,
        acctOutputOctets: 2048,
      },
    ];

    const result = aggregateRadiusAccounting(packets, {
      nowMs: t0 + 2_000_000, // 2000s later (> 900s stale & > 1800s silent)
      staleSessionThresholdSeconds: 900,
      nasSilentThresholdSeconds: 1800,
    });

    expect(result.staleSessions).toHaveLength(1);
    expect(result.staleSessions[0]?.status).toBe('stale');
    expect(result.nasHealth).toHaveLength(1);
    expect(result.nasHealth[0]?.healthStatus).toBe('offline');
    expect(result.nasHealth[0]?.alerts).toContain('NAS_SILENT');
    expect(result.nasHealth[0]?.alerts).toContain('STALE_SESSIONS_HIGH');
  });
});
