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

-- Renumbered TWICE. Pushed to prod as 20260803000001; PR #282 then landed
-- paywall_hits on that prefix, so this moved to 000006; PR #287 (menções) then
-- landed on 000006, so this moved to 000008.
--
-- Prod history is already correct for the other two PRs: the 000001/000002 rows
-- this migration's first push had claimed were deleted from
-- supabase_migrations.schema_migrations before #282's push, and prod now records
-- paywall_hits, checkout_attempts, loops_* and mencoes under their own versions.
-- What prod does NOT have is a history row for THIS migration, while its DDL is
-- applied. That is why every statement below is idempotent: the next push
-- re-applies it as a no-op and finally records it.
--
-- The version prefix is only checked when the file is authored, but main moves
-- underneath open PRs. Re-verify against origin/main immediately before merge,
-- not just before opening the PR.

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
