import { MILLISECONDS_PER_MINUTE } from '@moonwitness/types';

export type NotificationChannel = 'desktop' | 'whatsapp' | 'email' | 'webhook';

export type NotificationSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_PRIORITY: Record<NotificationSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface QuietHoursWindow {
  /** Start minute of day in user's local time (0..1439), e.g. 22:00 = 1320. */
  readonly startMinuteOfDay: number;
  /** End minute of day in user's local time (0..1439), e.g. 07:00 = 420. */
  readonly endMinuteOfDay: number;
  /** UTC offset in minutes (e.g. +420 for UTC+7, -300 for UTC-5). Defaults to 0 (UTC). */
  readonly timezoneOffsetMinutes?: number;
}

export interface UserNotificationPolicy {
  readonly userId: string;
  /** Channels enabled for each severity level. */
  readonly channelsBySeverity: Readonly<
    Partial<Record<NotificationSeverity, readonly NotificationChannel[]>>
  >;
  /** Fallback channels when severity is not explicitly mapped. */
  readonly defaultChannels?: readonly NotificationChannel[];
  /** Optional per-user quiet hours. Overridable ONLY by `critical` severity. */
  readonly quietHours?: QuietHoursWindow;
}

export interface RoutableNotification {
  readonly id: string;
  readonly userId: string;
  readonly severity: NotificationSeverity;
  readonly category: string;
  readonly title: string;
  readonly body: string;
  /** Optional explicit deduplication key. Defaults to `${userId}:${category}:${title}`. */
  readonly dedupeKey?: string;
  readonly createdAtMs: number;
}

export type RouteAction =
  'deliver' | 'suppressed_quiet_hours' | 'suppressed_duplicate' | 'no_channels';

export interface RouteDecision {
  readonly notificationId: string;
  readonly action: RouteAction;
  readonly channels: readonly NotificationChannel[];
  readonly quietHoursOverridden: boolean;
  readonly queuedForDigest: boolean;
  readonly duplicateOfId?: string;
}

export interface DigestGroup {
  readonly category: string;
  readonly highestSeverity: NotificationSeverity;
  readonly count: number;
  readonly items: readonly RoutableNotification[];
}

export interface DigestBatch {
  readonly userId: string;
  readonly compiledAtMs: number;
  readonly totalItems: number;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly countsBySeverity: Readonly<Record<NotificationSeverity, number>>;
  readonly groups: readonly DigestGroup[];
}

export interface NotificationRouterOptions {
  /** Sliding-window deduplication interval in milliseconds. Defaults to 5 minutes (300_000 ms). */
  readonly dedupeWindowMs?: number;
}

function validateMinuteOfDay(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 1439) {
    throw new Error(`${label} must be an integer between 0 and 1439`);
  }
}

/**
 * Determines whether `timestampMs` falls inside `window`, supporting both same-day
 * ranges (e.g., 13:00-15:00) and overnight wrap-around ranges (e.g., 22:00-07:00).
 */
export function isWithinQuietHours(timestampMs: number, window: QuietHoursWindow): boolean {
  validateMinuteOfDay(window.startMinuteOfDay, 'startMinuteOfDay');
  validateMinuteOfDay(window.endMinuteOfDay, 'endMinuteOfDay');

  const offsetMin = window.timezoneOffsetMinutes ?? 0;
  const localMs = timestampMs + offsetMin * MILLISECONDS_PER_MINUTE;
  const date = new Date(localMs);
  const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();

  if (window.startMinuteOfDay === window.endMinuteOfDay) {
    return false;
  }
  if (window.startMinuteOfDay < window.endMinuteOfDay) {
    return minuteOfDay >= window.startMinuteOfDay && minuteOfDay < window.endMinuteOfDay;
  }
  // Overnight wrap-around (e.g. 22:00 -> 07:00)
  return minuteOfDay >= window.startMinuteOfDay || minuteOfDay < window.endMinuteOfDay;
}

/**
 * Multi-channel priority notification router (`desktop`, `whatsapp`, `email`, `webhook`)
 * with per-user quiet-hours suppression (overridable ONLY by `critical` severity),
 * sliding-window deduplication, and digest batch compilation.
 */
export class NotificationRouter {
  private readonly policies = new Map<string, UserNotificationPolicy>();
  private readonly dedupeWindowMs: number;
  /** Map from composite dedupe key -> { lastSeenMs, firstNotificationId } */
  private readonly recentFingerprints = new Map<
    string,
    { lastSeenMs: number; notificationId: string }
  >();
  /** Per-user queued notifications awaiting digest compilation. */
  private readonly digestQueue = new Map<string, RoutableNotification[]>();

  constructor(options: NotificationRouterOptions = {}) {
    const windowMs = options.dedupeWindowMs ?? 300_000;
    if (!Number.isFinite(windowMs) || windowMs < 0) {
      throw new Error('dedupeWindowMs must be a non-negative finite number');
    }
    this.dedupeWindowMs = windowMs;
  }

  setUserPolicy(policy: UserNotificationPolicy): void {
    this.policies.set(policy.userId, policy);
  }

  private resolveChannels(
    policy: UserNotificationPolicy | undefined,
    severity: NotificationSeverity
  ): NotificationChannel[] {
    if (!policy) {
      return severity === 'critical' ? ['desktop', 'whatsapp', 'email', 'webhook'] : ['desktop'];
    }
    const mapped = policy.channelsBySeverity[severity] ?? policy.defaultChannels ?? [];
    return [...new Set(mapped)];
  }

  private fingerprint(notification: RoutableNotification): string {
    return (
      notification.dedupeKey ??
      `${notification.userId}:${notification.category}:${notification.title}`
    );
  }

  private pruneExpiredFingerprints(nowMs: number): void {
    if (this.dedupeWindowMs === 0) {
      this.recentFingerprints.clear();
      return;
    }
    for (const [key, entry] of this.recentFingerprints.entries()) {
      if (nowMs - entry.lastSeenMs >= this.dedupeWindowMs) {
        this.recentFingerprints.delete(key);
      }
    }
  }

  route(
    notification: RoutableNotification,
    nowMs: number = notification.createdAtMs
  ): RouteDecision {
    this.pruneExpiredFingerprints(nowMs);

    const key = this.fingerprint(notification);
    const existing = this.recentFingerprints.get(key);
    if (existing && nowMs - existing.lastSeenMs < this.dedupeWindowMs) {
      return {
        notificationId: notification.id,
        action: 'suppressed_duplicate',
        channels: [],
        quietHoursOverridden: false,
        queuedForDigest: false,
        duplicateOfId: existing.notificationId,
      };
    }

    this.recentFingerprints.set(key, { lastSeenMs: nowMs, notificationId: notification.id });

    const policy = this.policies.get(notification.userId);
    const channels = this.resolveChannels(policy, notification.severity);
    if (channels.length === 0) {
      return {
        notificationId: notification.id,
        action: 'no_channels',
        channels: [],
        quietHoursOverridden: false,
        queuedForDigest: false,
      };
    }

    const inQuietHours = policy?.quietHours ? isWithinQuietHours(nowMs, policy.quietHours) : false;
    if (inQuietHours && notification.severity !== 'critical') {
      const queue = this.digestQueue.get(notification.userId) ?? [];
      queue.push(notification);
      this.digestQueue.set(notification.userId, queue);
      return {
        notificationId: notification.id,
        action: 'suppressed_quiet_hours',
        channels: [],
        quietHoursOverridden: false,
        queuedForDigest: true,
      };
    }

    return {
      notificationId: notification.id,
      action: 'deliver',
      channels,
      quietHoursOverridden: inQuietHours && notification.severity === 'critical',
      queuedForDigest: false,
    };
  }

  /**
   * Compiles and drains the queued digest notifications for `userId`.
   * Returns `null` if no notifications are queued.
   */
  compileDigest(userId: string, compiledAtMs: number = Date.now()): DigestBatch | null {
    const items = this.digestQueue.get(userId);
    if (!items || items.length === 0) {
      return null;
    }
    this.digestQueue.delete(userId);

    const countsBySeverity: Record<NotificationSeverity, number> = {
      info: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    const byCategory = new Map<string, RoutableNotification[]>();
    let windowStartMs = items[0]!.createdAtMs;
    let windowEndMs = items[0]!.createdAtMs;

    for (const item of items) {
      countsBySeverity[item.severity] += 1;
      if (item.createdAtMs < windowStartMs) windowStartMs = item.createdAtMs;
      if (item.createdAtMs > windowEndMs) windowEndMs = item.createdAtMs;

      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }

    const groups: DigestGroup[] = [];
    for (const [category, groupItems] of byCategory.entries()) {
      const sorted = [...groupItems].sort((a, b) => {
        const prioDiff = SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity];
        return prioDiff !== 0 ? prioDiff : a.createdAtMs - b.createdAtMs;
      });
      groups.push({
        category,
        highestSeverity: sorted[0]!.severity,
        count: sorted.length,
        items: sorted,
      });
    }

    groups.sort((a, b) => {
      const prioDiff = SEVERITY_PRIORITY[b.highestSeverity] - SEVERITY_PRIORITY[a.highestSeverity];
      return prioDiff !== 0 ? prioDiff : b.count - a.count;
    });

    return {
      userId,
      compiledAtMs,
      totalItems: items.length,
      windowStartMs,
      windowEndMs,
      countsBySeverity,
      groups,
    };
  }

  getPendingDigestCount(userId: string): number {
    return this.digestQueue.get(userId)?.length ?? 0;
  }
}
