-- M19.06: 64-bit accounting counters with Gigawords support.
--
-- RFC 2869 Acct-Input-Gigawords (52) / Acct-Output-Gigawords (53) count how
-- many times the corresponding 32-bit octet counter wrapped. The live-path
-- normalized totals are stored as 64-bit values so multi-GiB sessions no
-- longer lose the high bits.

ALTER TABLE radius_sessions
  ADD COLUMN acct_input_octets64 INTEGER NOT NULL DEFAULT 0
    CHECK (acct_input_octets64 >= 0);

ALTER TABLE radius_sessions
  ADD COLUMN acct_output_octets64 INTEGER NOT NULL DEFAULT 0
    CHECK (acct_output_octets64 >= 0);

-- Backfill existing rows from the 32-bit columns (no Gigawords history was
-- recorded before this migration, so the low bits are all we have).
UPDATE radius_sessions
SET acct_input_octets64 = acct_input_octets,
    acct_output_octets64 = acct_output_octets;
