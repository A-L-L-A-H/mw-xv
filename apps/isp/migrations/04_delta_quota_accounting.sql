-- Delta-based quota accounting: track how many octets per session have already
-- been accumulated into subscribers.quota_used_bytes, so that repeated
-- Access-Requests or interim updates never double-count session traffic.

ALTER TABLE radius_sessions
  ADD COLUMN quota_accumulated_octets INTEGER NOT NULL DEFAULT 0
    CHECK (quota_accumulated_octets >= 0);

CREATE INDEX IF NOT EXISTS idx_radius_sessions_username_active
  ON radius_sessions(username, status);
