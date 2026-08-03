-- Mark internal / seeded workspaces so the background crons skip them.
--
-- Motivation: the "DK TESTE" workspace holds seeded demo clientes whose
-- instagram_accounts carry 19-character placeholder strings in
-- encrypted_access_token. Every instagram-sync-cron and instagram-refresh-cron
-- run tries to decrypt them, throws "Failed to decode base64", and files a
-- cron_failures row plus an alert e-mail. As of 2026-08-03 that is 155 refresh
-- failures and 56 sync failures against 4 accounts that can never succeed. The
-- same workspace owns the only tiktok_accounts row ("App Review - META TEST
-- USER", used for TikTok/Meta app review), which fails both TikTok crons every
-- run for an unrelated reason.
--
-- A workspace-level flag is used rather than flipping auto_sync_enabled on the
-- individual accounts because (a) it survives someone re-enabling sync from the
-- UI, (b) it covers Instagram and TikTok with one mechanism, and (c) it gives
-- future internal workspaces a single switch instead of per-table cleanup.
--
-- The crons fail OPEN on this flag: if the workspaces lookup errors, nothing is
-- excluded. Skipping a paying customer is far worse than one wasted sync of a
-- test account.

-- Originally pushed to prod as 20260803000001, before PR #282 landed a
-- paywall_hits migration on that same version prefix. Renumbered above main's
-- tail so the version-guard passes and #282's migration is not shadowed. Every
-- statement below is idempotent, so re-applying under the new version on an
-- environment that already ran the old one is a no-op.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN workspaces.is_internal IS
  'Internal/seed workspace. Background crons (instagram-sync, instagram-refresh, tiktok-sync, tiktok-refresh) skip its accounts so placeholder credentials do not generate recurring failure alerts. Does not affect the app UI, RLS, or billing.';

-- workspaces has table-level grants (all 27 columns granted to anon,
-- authenticated, service_role), not the column-level allowlist that `clientes`
-- and `membros` use, so the new column inherits SELECT automatically and needs
-- no GRANT bookkeeping.

-- Prod's seeded test workspace. A no-op in every other environment, which is
-- the intent: staging and local seed their own ids and can be flagged by hand.
UPDATE workspaces
   SET is_internal = true
 WHERE id = 'e68bdbc3-baf0-4807-b905-0807ac4e0253';
