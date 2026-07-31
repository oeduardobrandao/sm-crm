-- Candidate RPCs + atomic claim for the Loops marketing sweep.
-- Spec: docs/superpowers/specs/2026-07-31-loops-lifecycle-marketing-emails-design.md
--
-- Shared predicates in every candidate RPC:
--   1. profiles.marketing_opt_in = true, for the ONE deterministically chosen owner
--   2. effective free plan (null plan_id resolves to the is_default plan)
--   3. 72h cap (prefilter only; claim_marketing_email is the authority)
--   4. ledger exclusion: undelivered, stale >1h, attempts < 20

-- Helper: the single default plan id. plans has a unique partial index
-- guaranteeing at most one is_default row (20260501000002).
create or replace function default_plan_id()
returns text language sql stable set search_path = public as $$
  select id from plans where is_default limit 1
$$;

-- ---------------------------------------------------------------------------
-- Atomic claim. Returns true if the caller won.
--
-- Why a function and not a predicate: two overlapping cron runs both SELECT
-- before either writes, so run A can pick paywall_hit and run B
-- checkout_abandoned for the SAME workspace and both pass a SELECT-time cap.
-- The per-type idempotency key cannot help — it dedupes a type against itself,
-- never two different types against each other.
--
-- The advisory lock is transaction-scoped: it releases on commit or crash with
-- no cleanup path to get wrong.
-- ---------------------------------------------------------------------------
create or replace function claim_marketing_email(
  p_email_type text,
  p_workspace_id uuid,
  p_user_id uuid,
  p_attempts int
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  -- Send-time re-check, inside the lock rather than as a separate round trip.
  -- Between the candidate RPC's SELECT and this call the workspace can have
  -- subscribed or the user can have revoked consent. Re-verifying here makes the
  -- decision atomic with the claim; a separate query would reopen the same race
  -- it is meant to close.
  if not exists (
    select 1 from profiles p
    where p.id = p_user_id and p.marketing_opt_in = true
  ) then
    return false;
  end if;

  if not exists (
    select 1 from workspaces w
    where w.id = p_workspace_id
      and coalesce(w.plan_id, default_plan_id()) = default_plan_id()
  ) then
    return false;
  end if;

  if exists (
    select 1 from workspace_subscriptions s
    where s.workspace_id = p_workspace_id and s.status in ('trialing', 'active')
  ) then
    return false;
  end if;

  if exists (
    select 1 from lifecycle_emails
    where workspace_id = p_workspace_id
      and email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
      and sent_at > now() - interval '72 hours'
      and (delivered_at is not null or sent_at > now() - interval '1 hour')
  ) then
    return false;
  end if;

  -- dormant_signup dedupes on (email_type, user_id); the other two on
  -- (email_type, workspace_id). Both rows carry workspace_id regardless, so the
  -- 72h check above sees every marketing send for the workspace.
  if p_email_type = 'dormant_signup' then
    insert into lifecycle_emails (email_type, workspace_id, user_id, sent_at, attempts)
    values (p_email_type, p_workspace_id, p_user_id, now(), p_attempts)
    on conflict (email_type, user_id) do update
      set sent_at = now(), attempts = excluded.attempts, workspace_id = excluded.workspace_id;
  else
    insert into lifecycle_emails (email_type, workspace_id, user_id, sent_at, attempts)
    values (p_email_type, p_workspace_id, p_user_id, now(), p_attempts)
    on conflict (email_type, workspace_id) do update
      set sent_at = now(), attempts = excluded.attempts;
  end if;

  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Candidate RPCs
-- ---------------------------------------------------------------------------

create or replace function get_paywall_hit_candidates()
returns table (
  workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text,
  owner_nome text, plan_name text, client_count int, feature text,
  clicked_upgrade boolean, attempts int
)
language sql security definer set search_path = public as $$
  select ws.id, ws.name, o.user_id, u.email::text, p.nome,
         pl.name, (select count(*)::int from clientes c where c.conta_id = ws.id),
         h.feature, hc.clicked_upgrade, coalesce(le.attempts, 0)
  from workspaces ws
  cross join lateral (
    select wm.user_id from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) o
  join auth.users u on u.id = o.user_id
  join profiles p on p.id = o.user_id
  left join plans pl on pl.id = coalesce(ws.plan_id, default_plan_id())
  -- Two separate laterals, deliberately: the most recent feature and whether
  -- ANY hit in the window was an upgrade click are different aggregations over
  -- the same rows. Combining them with a window function under LIMIT 1 works but
  -- reads as a bug and breaks the moment someone adds an ORDER BY.
  cross join lateral (
    select ph.feature
    from paywall_hits ph
    where ph.workspace_id = ws.id and ph.hit_at > now() - interval '7 days'
    order by ph.hit_at desc
    limit 1
  ) h
  cross join lateral (
    select coalesce(bool_or(ph.clicked_upgrade), false) as clicked_upgrade
    from paywall_hits ph
    where ph.workspace_id = ws.id and ph.hit_at > now() - interval '7 days'
  ) hc
  left join lifecycle_emails le
    on le.email_type = 'paywall_hit' and le.workspace_id = ws.id
  where p.marketing_opt_in = true
    and u.email is not null
    and coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
    and not exists (
      select 1 from lifecycle_emails le2
      where le2.workspace_id = ws.id
        and le2.email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
        and le2.sent_at > now() - interval '72 hours'
        and (le2.delivered_at is not null or le2.sent_at > now() - interval '1 hour')
    )
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 20))
  order by ws.created_at asc, ws.id asc
  limit 50
$$;

create or replace function get_abandoned_checkout_candidates()
returns table (
  workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text,
  owner_nome text, plan_name text, hours_since_attempt int, attempts int
)
language sql security definer set search_path = public as $$
  select ws.id, ws.name, o.user_id, u.email::text, p.nome,
         pl.name,
         extract(epoch from (now() - a.created_at))::int / 3600,
         coalesce(le.attempts, 0)
  from workspaces ws
  cross join lateral (
    select wm.user_id from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) o
  join auth.users u on u.id = o.user_id
  join profiles p on p.id = o.user_id
  cross join lateral (
    select ca.created_at, ca.plan_id from checkout_attempts ca
    where ca.workspace_id = ws.id
    order by ca.created_at desc
    limit 1
  ) a
  left join plans pl on pl.id = a.plan_id
  left join lifecycle_emails le
    on le.email_type = 'checkout_abandoned' and le.workspace_id = ws.id
  where p.marketing_opt_in = true
    and u.email is not null
    and a.created_at <= now() - interval '24 hours'
    and coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
    -- A cancelled workspace keeps its subscription mirror row, so row existence
    -- is NOT a proxy for paid. Check status.
    and not exists (
      select 1 from workspace_subscriptions s
      where s.workspace_id = ws.id and s.status in ('trialing', 'active')
    )
    and not exists (
      select 1 from lifecycle_emails le2
      where le2.workspace_id = ws.id
        and le2.email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
        and le2.sent_at > now() - interval '72 hours'
        and (le2.delivered_at is not null or le2.sent_at > now() - interval '1 hour')
    )
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 20))
  order by a.created_at asc, ws.id asc
  limit 50
$$;

create or replace function get_dormant_signup_candidates()
returns table (
  workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text,
  owner_nome text, days_since_signup int, attempts int
)
language sql security definer set search_path = public as $$
  select ws.id, ws.name, u.id, u.email::text, p.nome,
         extract(epoch from (now() - u.email_confirmed_at))::int / 86400,
         coalesce(le.attempts, 0)
  from auth.users u
  join workspaces ws on ws.created_by = u.id
  join workspace_members wm
    on wm.user_id = u.id and wm.workspace_id = ws.id and wm.role = 'owner'
  join profiles p on p.id = u.id
  left join lifecycle_emails le
    on le.email_type = 'dormant_signup' and le.user_id = u.id
  where p.marketing_opt_in = true
    and u.email is not null
    and u.email_confirmed_at is not null
    and u.email_confirmed_at <= now() - interval '3 days'
    and u.email_confirmed_at >= now() - interval '14 days'
    -- Self-serve discriminator: BOTH halves required. The invite-path fallback
    -- in 20260719000002 sets created_by to the INVITED user when no workspace
    -- exists, which the created_by join alone would misclassify as self-serve.
    and nullif(u.raw_user_meta_data ->> 'conta_id', '') is null
    and coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
    and not exists (select 1 from clientes c where c.conta_id = ws.id)
    and not exists (
      select 1 from lifecycle_emails le2
      where le2.workspace_id = ws.id
        and le2.email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
        and le2.sent_at > now() - interval '72 hours'
        and (le2.delivered_at is not null or le2.sent_at > now() - interval '1 hour')
    )
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 20))
  order by u.email_confirmed_at asc, u.id asc
  limit 50
$$;

-- Person-level traits only. Workspace facts (name, plan, client count) travel
-- in event properties instead: Loops keys contacts by email, and one person can
-- own several workspaces (max_workspaces_per_user is a real entitlement), so
-- per-workspace traits would be clobbered by whichever workspace synced last.
create or replace function get_loops_trait_candidates()
returns table (
  user_id uuid, email text, nome text, days_since_signup int,
  workspace_count int, any_free boolean
)
language sql security definer set search_path = public as $$
  select u.id, u.email::text, p.nome,
         extract(epoch from (now() - u.email_confirmed_at))::int / 86400,
         count(ws.id)::int,
         bool_or(coalesce(ws.plan_id, default_plan_id()) = default_plan_id())
  from auth.users u
  join profiles p on p.id = u.id
  join workspace_members wm on wm.user_id = u.id and wm.role = 'owner'
  join workspaces ws on ws.id = wm.workspace_id
  where p.marketing_opt_in = true
    and u.email is not null
    and u.email_confirmed_at is not null
  group by u.id, u.email, p.nome, u.email_confirmed_at
  order by u.id
  limit 200
$$;

-- Contacts to remove at Loops: consent revoked, email changed (delete the OLD
-- address), or the account was deleted (user_id nulled by the FK).
create or replace function get_loops_contact_deletions()
returns table (id uuid, synced_email text)
language sql security definer set search_path = public as $$
  select lc.id, lc.synced_email
  from loops_contacts lc
  left join auth.users u on u.id = lc.user_id
  left join profiles p on p.id = lc.user_id
  where lc.deleted_at is null
    and (lc.user_id is null
         or p.marketing_opt_in is distinct from true
         or u.email::text is distinct from lc.synced_email)
  order by lc.synced_at asc
  limit 50
$$;

-- ---------------------------------------------------------------------------
-- Lock everything to the service role.
-- REVOKE FROM PUBLIC alone ALSO strips service_role on this instance (it has
-- bitten this repo before). Grant explicitly, and verify with proacl, not
-- has_function_privilege.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'claim_marketing_email(text,uuid,uuid,int)',
    'get_paywall_hit_candidates()',
    'get_abandoned_checkout_candidates()',
    'get_dormant_signup_candidates()',
    'get_loops_trait_candidates()',
    'get_loops_contact_deletions()',
    'default_plan_id()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill seed: terminal rows so switching the cron on does not blast the
-- entire back catalogue. Same technique as 20260730000001.
-- ---------------------------------------------------------------------------
insert into lifecycle_emails (email_type, workspace_id, delivered_at)
select 'paywall_hit', workspace_id, now() from (
  select distinct workspace_id from paywall_hits
) s
on conflict do nothing;

insert into lifecycle_emails (email_type, workspace_id, delivered_at)
select 'checkout_abandoned', workspace_id, now() from (
  select distinct workspace_id from checkout_attempts
) s
on conflict do nothing;

insert into lifecycle_emails (email_type, user_id, workspace_id, delivered_at)
select distinct 'dormant_signup', u.id, ws.id, now()
from auth.users u
join workspaces ws on ws.created_by = u.id
where u.email_confirmed_at is not null
on conflict do nothing;
