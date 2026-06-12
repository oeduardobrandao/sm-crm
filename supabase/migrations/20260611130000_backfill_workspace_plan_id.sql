-- One-time backfill: give every existing workspace an explicit plan_id BEFORE the
-- enforcement triggers (created in the migrations that follow, 20260611130001+) go
-- live. A NULL plan_id resolves to the is_default plan; prod had no default, so NULL
-- would resolve fail-closed (every insert blocked). Ordered 130000 so it runs first
-- in the push, leaving no window where a live workspace is gated.
--
-- Idempotent: only fills rows where plan_id IS NULL. No-op on a fresh/empty DB.

-- New signups (handle_new_user creates workspaces with plan_id NULL) resolve to Free.
update plans set is_default = true where id = 'free' and is_default = false;

-- 1. Live Stripe subscription wins (incl. dunning past_due/unpaid — still have access).
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

-- 3. Grandfather everyone else to 'max' (unlimited), system-owned so a future
--    checkout lets Stripe take ownership of the plan.
update workspaces
   set plan_id = 'max',
       plan_source = 'system'
 where plan_id is null;
