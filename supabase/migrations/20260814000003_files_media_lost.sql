-- Reconciliation marker for the 2026-08 media-loss incident: rows whose R2
-- object is confirmed gone (no surviving copy anywhere) get media_lost_at set.
-- The integrity canary excludes marked rows so it only alarms on NEW damage;
-- storage accounting subtracts them; the rows themselves are kept as the
-- honest record of what each workspace lost.
ALTER TABLE files ADD COLUMN media_lost_at timestamptz;

COMMENT ON COLUMN files.media_lost_at IS
  'Set when the R2 object was confirmed permanently lost (2026-08 incident reconciliation). Kept as record; excluded from integrity canary and storage accounting.';
