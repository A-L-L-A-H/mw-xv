-- Per-subscriber quota configuration, usage windows, and quota-disconnect bookkeeping.

ALTER TABLE subscribers
  ADD COLUMN quota_bytes INTEGER NOT NULL DEFAULT 0 CHECK (quota_bytes >= 0);
ALTER TABLE subscribers
  ADD COLUMN quota_reset_cadence TEXT NOT NULL DEFAULT 'never'
  CHECK (quota_reset_cadence IN ('never', 'daily', 'weekly', 'monthly'));
ALTER TABLE subscribers
  ADD COLUMN quota_used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (quota_used_bytes >= 0);
ALTER TABLE subscribers
  ADD COLUMN last_quota_reset_at TEXT NOT NULL DEFAULT (datetime('now'));

ALTER TABLE radius_sessions
  ADD COLUMN quota_disconnect_sent INTEGER NOT NULL DEFAULT 0 CHECK (quota_disconnect_sent IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_subscribers_quota_reset
  ON subscribers(quota_reset_cadence, last_quota_reset_at);
