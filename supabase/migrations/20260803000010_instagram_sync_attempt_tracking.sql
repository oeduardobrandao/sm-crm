-- Track sync ATTEMPTS, not just successes, so the sync queue cannot be jammed
-- by accounts that fail permanently.
--
-- instagram-sync-cron claims a bounded batch ordered by staleness. Until now
-- that ordering read `last_synced_at`, which is written only on the success
-- path, after every Graph API call has returned. An account that fails before
-- that point (a token that will not decrypt, a revoked authorization, a
-- persistent Graph error) never advances the column, so it stays permanently at
-- the head of the ordering and is re-selected on every single run. Enough of
-- them and they occupy the whole batch forever while healthy accounts behind
-- them are never synced.
--
-- This was not hypothetical. The four seeded DK TESTE accounts sat at
-- last_synced_at = 2026-04-13 from April until 2026-08-03, failing identically
-- on every run. Flagging that workspace internal moved those four out of the
-- queue but left the mechanism intact, so the next corrupted real token would
-- have landed in the same hole.
--
-- `last_sync_attempt_at` is stamped on every attempt regardless of outcome,
-- which turns the queue from "longest without a success" into "longest without
-- an attempt". A failing account keeps being retried but rotates to the back
-- each time instead of blocking the queue. Eligibility still keys off
-- `last_synced_at` (the 6h staleness window), so "has not synced in 6h" keeps
-- its existing meaning.

ALTER TABLE instagram_accounts
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;

COMMENT ON COLUMN instagram_accounts.last_sync_attempt_at IS
  'When instagram-sync-cron last ATTEMPTED this account, success or failure. Orders the sync queue. Distinct from last_synced_at, which records the last SUCCESSFUL sync and drives the staleness window.';

-- instagram_accounts has table-level grants (all columns to anon, authenticated,
-- service_role), not the column-level allowlist that `clientes` and `membros`
-- use, so the new column inherits SELECT and needs no GRANT bookkeeping.

-- Seed the queue position from the last successful sync. Without this every row
-- starts NULL, the whole table ties at the head of the first ordering, and the
-- id tie-break decides the first batch arbitrarily.
UPDATE instagram_accounts
   SET last_sync_attempt_at = last_synced_at
 WHERE last_sync_attempt_at IS NULL
   AND last_synced_at IS NOT NULL;

-- Matches the cron's claim query: filter on the two status columns, order by
-- attempt time (NULLs first, i.e. never attempted goes first) then id.
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_sync_queue
  ON instagram_accounts (last_sync_attempt_at NULLS FIRST, id)
  WHERE authorization_status = 'active' AND auto_sync_enabled;
