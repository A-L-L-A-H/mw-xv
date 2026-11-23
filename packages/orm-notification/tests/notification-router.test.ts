import { describe, expect, it } from 'vitest';
import { NotificationRouter, isWithinQuietHours } from '../src/notification-router.js';

describe('Multi-Channel NotificationRouter', () => {
  // 2026-01-15T23:30:00Z (23:30 UTC)
  const NIGHT_UTC_MS = Date.UTC(2026, 0, 15, 23, 30, 0);
  // 2026-01-15T10:00:00Z (10:00 UTC)
  const DAY_UTC_MS = Date.UTC(2026, 0, 15, 10, 0, 0);

  it('evaluates overnight and same-day quiet hours windows accurately', () => {
    const overnight = {
      startMinuteOfDay: 22 * 60,
      endMinuteOfDay: 7 * 60,
      timezoneOffsetMinutes: 0,
    };
    expect(isWithinQuietHours(NIGHT_UTC_MS, overnight)).toBe(true);
    expect(isWithinQuietHours(DAY_UTC_MS, overnight)).toBe(false);

    const afternoon = {
      startMinuteOfDay: 13 * 60,
      endMinuteOfDay: 15 * 60,
      timezoneOffsetMinutes: 0,
    };
    expect(isWithinQuietHours(Date.UTC(2026, 0, 15, 14, 0, 0), afternoon)).toBe(true);
    expect(isWithinQuietHours(DAY_UTC_MS, afternoon)).toBe(false);
  });

  it('suppresses non-critical alerts during quiet hours and allows ONLY critical overrides', () => {
    const router = new NotificationRouter({ dedupeWindowMs: 60_000 });
    router.setUserPolicy({
      userId: 'u1',
      channelsBySeverity: {
        high: ['desktop', 'email'],
        critical: ['desktop', 'whatsapp', 'email', 'webhook'],
      },
      quietHours: { startMinuteOfDay: 22 * 60, endMinuteOfDay: 7 * 60, timezoneOffsetMinutes: 0 },
    });

    const highDecision = router.route({
      id: 'n1',
      userId: 'u1',
      severity: 'high',
      category: 'security',
      title: 'Suspicious login',
      body: 'Login from new IP',
      createdAtMs: NIGHT_UTC_MS,
    });
    expect(highDecision.action).toBe('suppressed_quiet_hours');
    expect(highDecision.queuedForDigest).toBe(true);
    expect(highDecision.quietHoursOverridden).toBe(false);

    const criticalDecision = router.route({
      id: 'n2',
      userId: 'u1',
      severity: 'critical',
      category: 'security',
      title: 'Vault integrity breach',
      body: 'Checksum mismatch detected',
      createdAtMs: NIGHT_UTC_MS + 1000,
    });
    expect(criticalDecision.action).toBe('deliver');
    expect(criticalDecision.quietHoursOverridden).toBe(true);
    expect(criticalDecision.channels).toEqual(['desktop', 'whatsapp', 'email', 'webhook']);
  });

  it('deduplicates alerts within the sliding window and delivers again after window expiry', () => {
    const router = new NotificationRouter({ dedupeWindowMs: 30_000 });
    router.setUserPolicy({
      userId: 'u2',
      channelsBySeverity: { medium: ['desktop', 'webhook'] },
    });

    const first = router.route({
      id: 'a1',
      userId: 'u2',
      severity: 'medium',
      category: 'sync',
      title: 'Sync lag',
      body: 'Lag > 5s',
      createdAtMs: DAY_UTC_MS,
    });
    expect(first.action).toBe('deliver');

    const dup = router.route({
      id: 'a2',
      userId: 'u2',
      severity: 'medium',
      category: 'sync',
      title: 'Sync lag',
      body: 'Lag > 6s',
      createdAtMs: DAY_UTC_MS + 10_000,
    });
    expect(dup.action).toBe('suppressed_duplicate');
    expect(dup.duplicateOfId).toBe('a1');

    // After sliding window expires
    const afterWindow = router.route({
      id: 'a3',
      userId: 'u2',
      severity: 'medium',
      category: 'sync',
      title: 'Sync lag',
      body: 'Lag > 7s',
      createdAtMs: DAY_UTC_MS + 35_000,
    });
    expect(afterWindow.action).toBe('deliver');
  });

  it('compiles queued quiet-hours notifications into a prioritized digest batch', () => {
    const router = new NotificationRouter({ dedupeWindowMs: 5_000 });
    router.setUserPolicy({
      userId: 'u3',
      channelsBySeverity: {
        info: ['email'],
        high: ['desktop', 'email'],
      },
      quietHours: { startMinuteOfDay: 22 * 60, endMinuteOfDay: 7 * 60, timezoneOffsetMinutes: 0 },
    });

    router.route({
      id: 'd1',
      userId: 'u3',
      severity: 'info',
      category: 'billing',
      title: 'Invoice ready',
      body: 'Monthly invoice available',
      createdAtMs: NIGHT_UTC_MS,
    });
    router.route({
      id: 'd2',
      userId: 'u3',
      severity: 'high',
      category: 'security',
      title: 'API key expiring soon',
      body: 'Rotate within 24h',
      createdAtMs: NIGHT_UTC_MS + 60_000,
    });

    expect(router.getPendingDigestCount('u3')).toBe(2);
    const batch = router.compileDigest('u3', NIGHT_UTC_MS + 120_000);
    expect(batch).not.toBeNull();
    expect(batch!.totalItems).toBe(2);
    expect(batch!.countsBySeverity.high).toBe(1);
    expect(batch!.countsBySeverity.info).toBe(1);
    // Highest severity group comes first
    expect(batch!.groups[0]!.category).toBe('security');
    expect(batch!.groups[1]!.category).toBe('billing');
    // Queue is drained after compilation
    expect(router.getPendingDigestCount('u3')).toBe(0);
    expect(router.compileDigest('u3')).toBeNull();
  });
});
