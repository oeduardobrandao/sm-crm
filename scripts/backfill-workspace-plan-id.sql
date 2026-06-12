\set ON_ERROR_STOP on
-- ============================================================================
-- Backfill workspaces.plan_id
--
-- RUN THIS ON PROD *BEFORE* applying the paywall enforcement migrations
-- (20260611130001 … 20260611150001). Order matters:
--
--     1. psql -f scripts/backfill-workspace-plan-id.sql   (this file)
--     2. npx supabase db push --linked                    (enforcement triggers)
--     3. npx supabase functions deploy …                  (paywall edge fns)
--
-- WHY: the enforcement triggers read workspaces.plan_id. A NULL plan_id falls
-- back to the is_default plan — and prod currently has NO default plan — so the
-- resolver returns fail-closed 0 (every insert blocked). This gives every
-- existing workspace an explicit plan so no live customer is gated.
--
-- Idempotent: only fills rows where plan_id IS NULL. Re-running is a no-op.
--
-- Resolution priority:
--   1. live Stripe subscription      -> sub.plan_id,       plan_source = 'stripe'
--   2. legacy admin comp             -> overrides.plan_id, plan_source = 'manual'
--   3. everyone else (grandfather)   -> 'max' (unlimited), plan_source = 'system'
--      Grandfathered as system-owned so a future checkout lets Stripe take over.
--      (prod also has an unlimited 'lifetime' plan — change the bucket-3 UPDATE
--       below if you'd rather grandfather onto that instead of 'max'.)
-- ============================================================================

begin;

\echo '--- BEFORE: plan_id / plan_source distribution ---'
select coalesce(plan_id, '(null)') as plan_id, plan_source, count(*)
  from workspaces
 group by 1, 2
 order by 1, 2;

-- 1. Live Stripe subscription wins (incl. dunning: past_due / unpaid still have access).
update workspaces w
   set plan_id = s.plan_id,
       plan_source = 'stripe'
  from workspace_subscriptions s
 where w.plan_id is null
   and s.workspace_id = w.id
   and s.plan_id is not null
   and s.status in ('active', 'trialing', 'past_due', 'unpaid');

-- 2. Legacy admin comp (the deprecated workspace_plan_overrides.plan_id source).
update workspaces w
   set plan_id = o.plan_id,
       plan_source = 'manual'
  from workspace_plan_overrides o
 where w.plan_id is null
   and o.workspace_id = w.id
   and o.plan_id is not null;

-- 3. Grandfather everyone else to 'max' (unlimited), system-owned.
update workspaces
   set plan_id = 'max',
       plan_source = 'system'
 where plan_id is null;

\echo '--- AFTER: plan_id / plan_source distribution ---'
select coalesce(plan_id, '(null)') as plan_id, plan_source, count(*)
  from workspaces
 group by 1, 2
 order by 1, 2;

-- Safety: no workspace may be left without a plan before enforcement goes live.
do $$
declare n int;
begin
  select count(*) into n from workspaces where plan_id is null;
  if n > 0 then
    raise exception 'backfill incomplete: % workspaces still have NULL plan_id', n;
  end if;
end $$;

commit;
\echo 'Backfill complete.'
