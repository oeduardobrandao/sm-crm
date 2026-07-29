-- Lifecycle emails: ledger + candidate RPCs + backfill seeds.
-- Spec: docs/superpowers/specs/2026-07-29-lifecycle-emails-design.md
-- Consumed by the lifecycle-email-cron edge function (service-role only).

-- 1) Ledger. sent_at = last claim/attempt; delivered_at = Resend accepted.
-- A row with delivered_at NULL, sent_at older than 1 hour, and attempts < 30
-- is a STALE claim: its subject becomes a candidate again and is re-sent with
-- the same Resend Idempotency-Key (deduped by Resend for 24h), so ambiguous
-- failures neither duplicate nor permanently suppress an email. attempts >= 30
-- is terminal (~30 hourly retries outlasts the 24h key window and a full-day
-- outage): the recipient is treated as permanently unreachable, visible in
-- cron_failures history. The 1h freshness gate also means failing claims are
-- excluded from ~3 of every 4 runs, so they cannot starve the batch.
create table if not exists lifecycle_emails (
  id           uuid primary key default gen_random_uuid(),
  email_type   text not null,
  user_id      uuid null references auth.users(id) on delete cascade,
  workspace_id uuid null references workspaces(id) on delete cascade,
  sent_at      timestamptz not null default now(),
  delivered_at timestamptz null,
  attempts     int not null default 0
);

-- Plain UNIQUE constraints, NOT partial unique indexes: PostgREST's on_conflict
-- (the claim upsert) cannot target a partial index. NULLs are distinct, so
-- welcome rows dedupe on (type, user_id) and thank-you rows on
-- (type, workspace_id); the cross-type NULL columns never collide.
alter table lifecycle_emails
  add constraint lifecycle_emails_user_type unique (email_type, user_id),
  add constraint lifecycle_emails_workspace_type unique (email_type, workspace_id);

alter table lifecycle_emails enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) touches this.

-- 2) Welcome candidates: confirmed self-serve users not yet delivered, not
-- freshly claimed, not attempt-capped. Self-serve discriminator is BOTH:
--   (a) workspaces.created_by = the user (set on the self-serve trigger path), AND
--   (b) no conta_id in the signup metadata — the trigger's invite branch is only
--       entered when conta_id metadata is present, and (b) covers the invite-path
--       fallback (20260719000002's COALESCE(ws_created_by, NEW.id)) where a
--       missing workspace with no prior owner gets created_by = the INVITED user,
--       which (a) alone would misclassify as self-serve.
-- No time window: the welcome seed below is the eligibility boundary, so
-- outages delay emails instead of dropping them.
create or replace function get_welcome_email_candidates()
returns table (user_id uuid, email text, nome text, attempts int)
language sql
security definer
set search_path = public
as $$
  select distinct on (u.id) u.id, u.email::text, p.nome, coalesce(le.attempts, 0)
  from auth.users u
  join workspaces ws on ws.created_by = u.id
  join workspace_members wm
    on wm.user_id = u.id and wm.workspace_id = ws.id and wm.role = 'owner'
  left join profiles p on p.id = u.id
  left join lifecycle_emails le
    on le.email_type = 'welcome' and le.user_id = u.id
  where u.email_confirmed_at is not null
    and u.email is not null
    and nullif(u.raw_user_meta_data ->> 'conta_id', '') is null
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 30))
  order by u.id, u.email_confirmed_at asc
  limit 50
$$;

-- 3) Thank-you candidates: trialing/active subscriptions not yet delivered and
-- not freshly claimed, with the primary owner resolved deterministically:
-- workspaces.created_by if still an owner member, else oldest owner by
-- joined_at, tie-broken by user_id. Workspaces with no resolvable owner/email
-- produce no candidate row (they cannot occupy the batch; they become eligible
-- if an owner appears later). Deterministic order: oldest subscription first.
create or replace function get_thankyou_email_candidates()
returns table (workspace_id uuid, workspace_name text, owner_email text, owner_nome text, attempts int)
language sql
security definer
set search_path = public
as $$
  select ws.id, ws.name, u.email::text, p.nome, coalesce(le.attempts, 0)
  from workspace_subscriptions s
  join workspaces ws on ws.id = s.workspace_id
  cross join lateral (
    select wm.user_id
    from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) owner_pick
  join auth.users u on u.id = owner_pick.user_id
  left join profiles p on p.id = owner_pick.user_id
  left join lifecycle_emails le
    on le.email_type = 'subscription_thanks' and le.workspace_id = ws.id
  where s.status in ('trialing', 'active')
    and u.email is not null
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 30))
  order by s.created_at asc, ws.id asc
  limit 50
$$;

-- 4) Lock both RPCs to the service role. GRANT explicitly: REVOKE FROM PUBLIC
-- alone also strips service_role (bit this repo before — check proacl, not
-- has_function_privilege).
revoke all on function get_welcome_email_candidates() from public, anon, authenticated;
grant execute on function get_welcome_email_candidates() to service_role;
revoke all on function get_thankyou_email_candidates() from public, anon, authenticated;
grant execute on function get_thankyou_email_candidates() to service_role;

-- 5) Backfill seeds (terminal rows: delivered_at set, nothing is mailed).
--
-- Thank-you: only rows where stripe_subscription_id IS NOT NULL. Row existence
-- is NOT the boundary — billing-checkout creates a placeholder row holding only
-- stripe_customer_id before the user completes Stripe Checkout, and a checkout
-- in flight during this deploy must still be thanked when it completes. A
-- subscription id means a subscription actually started at some point (any
-- status). Idempotent via ON CONFLICT DO NOTHING.
insert into lifecycle_emails (email_type, workspace_id, delivered_at)
select 'subscription_thanks', s.workspace_id, now()
from workspace_subscriptions s
where s.stripe_subscription_id is not null
on conflict do nothing;

-- Welcome: every currently confirmed self-serve owner (same join AND conta_id
-- metadata check as the RPC). This replaces a time-window: post-migration, ANY
-- confirmed self-serve owner without a ledger row gets the email, whenever
-- they confirm.
insert into lifecycle_emails (email_type, user_id, delivered_at)
select distinct 'welcome', u.id, now()
from auth.users u
join workspaces ws on ws.created_by = u.id
join workspace_members wm
  on wm.user_id = u.id and wm.workspace_id = ws.id and wm.role = 'owner'
where u.email_confirmed_at is not null
  and nullif(u.raw_user_meta_data ->> 'conta_id', '') is null
on conflict do nothing;
