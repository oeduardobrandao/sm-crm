-- RPCs for crisp-sync-cron.
-- Spec: docs/superpowers/specs/2026-08-03-crisp-customer-sync-design.md
--
-- Apply AFTER 20260804000001 (crisp_contacts) and BEFORE deploying the function.

-- ---------------------------------------------------------------------------
-- Write protocol, in two halves. Do NOT collapse them back into one call.
--
-- record_crisp_contact runs BEFORE the vendor write and records the EMAIL ONLY.
-- confirm_crisp_sync runs AFTER a confirmed vendor success and advances the
-- fingerprint + people_id.
--
-- An earlier draft wrote the fingerprint up front to save a round trip. That was
-- wrong: a transient failure on a user's FIRST sync would mark them synchronised
-- while no profile existed at Crisp at all, and get_crisp_sync_candidates would
-- then exclude them until their source data happened to change. Silent,
-- permanent, and worst for exactly the population this sync exists to cover.
-- ---------------------------------------------------------------------------
create or replace function record_crisp_contact(p_user_id uuid, p_email text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  -- Own lock namespace, not the loops_contact one: a collision would only
  -- serialise unrelated callers, but the prefix keeps the two independent.
  -- Transaction-scoped, so it releases on commit or crash.
  perform pg_advisory_xact_lock(hashtextextended('crisp_contact:' || p_user_id::text, 0));

  -- SEND-TIME RE-CHECK against the live row. The advisory lock is
  -- transaction-scoped, so it releases when this function commits -- BEFORE the
  -- vendor call. Between the candidate SELECT and that call the user can change
  -- their email, and the deletion sweep (this run or an overlapping one) can
  -- delete the old profile. Without this check the upsert then RECREATES the
  -- profile that was just erased, and the ledger no longer points at it, so
  -- nothing can ever erase it again.
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and u.email::text = p_email
      and u.email_confirmed_at is not null
  ) then
    return false;
  end if;

  -- A deletion is still OWED at Crisp for a different address on this user's
  -- row. Overwriting synced_email now would strand that address at the vendor
  -- forever, because user_id is UNIQUE and the old value would be gone.
  if exists (
    select 1 from crisp_contacts cc
    where cc.user_id = p_user_id
      and cc.deleted_at is null
      and cc.synced_email is distinct from p_email
  ) then
    return false;
  end if;

  -- Deliberately does NOT touch synced_fingerprint or synced_people_id.
  insert into crisp_contacts (user_id, synced_email, synced_at, deleted_at)
  values (p_user_id, p_email, now(), null)
  on conflict (user_id) do update
    set synced_email = excluded.synced_email,
        synced_at    = excluded.synced_at,
        deleted_at   = null,
        -- Reactivating a swept row: a cached people_id here addresses a profile
        -- the deletion sweep already erased, and handing it to the handler would
        -- 404 that user on every sweep forever. Cleared only on reactivation, so
        -- the normal path still never touches this column.
        synced_people_id = case
          when crisp_contacts.deleted_at is not null then null
          else crisp_contacts.synced_people_id
        end;

  return true;
end $$;

-- coalesce on people_id so a null argument never wipes a known cached id.
create or replace function confirm_crisp_sync(
  p_user_id uuid, p_email text, p_people_id text, p_fingerprint text
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  -- synced_email is part of the predicate, not just user_id: without it a
  -- confirmation for a stale in-flight write can match a row that was swept
  -- AND reactivated for a different address in between. user_id alone cannot
  -- tell those two syncs apart -- only the email this call believes it just
  -- pushed can.
  update crisp_contacts
     set synced_people_id   = coalesce(p_people_id, synced_people_id),
         synced_fingerprint = p_fingerprint,
         synced_at          = now()
   where user_id = p_user_id
     and synced_email = p_email
     and deleted_at is null;

  get diagnostics v_rows = row_count;
  -- FALSE means either: the ledger row moved under us while the vendor call
  -- was in flight (the deletion sweep swept this person between record and
  -- confirm), OR it was swept AND reactivated for a different address before
  -- this call landed, so the row that matches user_id now describes someone
  -- else's in-flight sync. Either way the caller MUST delete the profile it
  -- just wrote, or it is stranded at the vendor with no ledger row able to
  -- select it for erasure. Never widen this WHERE to "fix" the zero-row case
  -- -- that would resurrect a swept row or clobber a reactivated one.
  return v_rows > 0;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles to remove at Crisp: the account was deleted (user_id nulled by the
-- FK) or the email changed (delete the OLD address).
--
-- No consent-revocation branch, unlike get_loops_contact_deletions: this sync
-- has no consent gate because it is support tooling, not marketing. If a
-- support_profile_opt_out flag is ever added it becomes a third `or` here.
-- ---------------------------------------------------------------------------
create or replace function get_crisp_contact_deletions()
returns table (id uuid, synced_email text, synced_people_id text)
language sql security definer set search_path = public as $$
  select cc.id, cc.synced_email, cc.synced_people_id
  from crisp_contacts cc
  left join auth.users u on u.id = cc.user_id
  where cc.deleted_at is null
    and (cc.user_id is null
         or u.email::text is distinct from cc.synced_email)
  order by cc.synced_at asc, cc.id
  limit 50
$$;

-- ---------------------------------------------------------------------------
-- Candidates.
--
-- CANONICAL SERIALISATION IS LOAD-BEARING. The fingerprint is only as good as
-- the determinism of the strings feeding it:
--   * every string_agg carries an explicit ORDER BY, or PostgreSQL may
--     serialise an UNCHANGED membership set differently between runs and
--     re-push everyone, burning the exact quota this exists to protect;
--   * every nullable is coalesce(x,'') before hashing, or one NULL turns the
--     whole concatenation into NULL and every such user hashes identically;
--   * fields are joined with a literal '|' in a fixed order, so a value
--     containing a comma cannot impersonate a field boundary;
--   * segments are sorted before joining.
--
-- cliente_desde is a DATE, not a day counter. A counter changes at every
-- midnight, so hashing it would re-push every user once a day forever, and
-- hashing around it would display a number that is silently wrong.
-- ---------------------------------------------------------------------------
create or replace function get_crisp_sync_candidates()
returns table (
  user_id              uuid,
  email                text,
  nome                 text,
  phone                text,
  papel                text,
  plano                text,
  assinatura           text,
  plan_source          text,
  workspaces           text,
  workspace_count      int,
  clientes             int,
  cliente_desde        text,
  primary_workspace_id uuid,
  segments             text[],
  fingerprint          text,
  people_id            text
)
language sql security definer set search_path = public as $$
  with membership as (
    select
      u.id                                    as user_id,
      u.email::text                           as email,
      -- Crisp REQUIRES a nickname on profile create and replace, and
      -- profiles.nome is NULLABLE (20260301_baseline_schema.sql:27). Without
      -- this fallback a confirmed user with no name 4xxs on every single sweep,
      -- forever. Compatible with, not identical to, the expression
      -- handle_new_user_workspace() uses at signup: the trigger is
      -- COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
      -- which prefers the signup metadata name and applies no btrim/nullif. This
      -- fallback instead reads the settled profiles.nome and guards against a
      -- blank string, since PerfilTab.tsx can leave '' in that column after the
      -- trigger has already run.
      coalesce(nullif(btrim(p.nome), ''), split_part(u.email::text, '@', 1)) as nome,
      -- WhatsApp preferred: matching an inbound WhatsApp is the channel gap
      -- this sync exists to close. btrim + nullif are REQUIRED, not cosmetic --
      -- PerfilTab.tsx writes the raw input straight to both columns, so a
      -- cleared field persists as '' and would otherwise be sent as an empty
      -- phone and hashed as a change.
      coalesce(nullif(btrim(p.whatsapp), ''), nullif(btrim(p.telefone), '')) as phone,
      u.email_confirmed_at                    as confirmed_at,
      wm.role                                 as role,
      wm.joined_at                            as joined_at,
      ws.id                                   as workspace_id,
      ws.name                                 as workspace_name,
      ws.is_internal                          as is_internal,
      ws.plan_source                          as plan_source,
      -- Mirrors resolveEntitlements (_shared/entitlements.ts): plan_id with a
      -- default-plan fallback, and NOTHING else. That is what the product
      -- enforces at every gate, so it is what support must be shown.
      coalesce(ws.plan_id, default_plan_id()) as plan_id,
      s.status                                as sub_status,
      (select count(*)::int from clientes c where c.conta_id = ws.id) as client_count
    from auth.users u
    join profiles p on p.id = u.id
    join workspace_members wm on wm.user_id = u.id
    join workspaces ws on ws.id = wm.workspace_id
    -- workspace_id is the PK of workspace_subscriptions (20260609120003), so
    -- this join cannot multiply rows.
    left join workspace_subscriptions s on s.workspace_id = ws.id
    where u.email is not null
      and u.email_confirmed_at is not null
  ),
  -- The person's PRIMARY workspace: oldest owned, falling back to oldest joined
  -- for members who own none. The workspace_id tiebreak makes the ordering
  -- total, so two runs cannot disagree and the fingerprint cannot oscillate.
  primary_ws as (
    select distinct on (m.user_id)
      m.user_id, m.workspace_id, m.plan_id, m.plan_source, m.sub_status
    from membership m
    order by m.user_id, (m.role = 'owner') desc, m.joined_at asc nulls last, m.workspace_id
  ),
  agg as (
    select
      m.user_id, m.email, m.nome, m.phone,
      max(m.confirmed_at) as confirmed_at,
      -- workspace_members.role, NOT profiles.role: profiles.role is a single
      -- value tied to conta_id (the workspace the account was created against).
      -- Someone who owns one workspace and is an agent in another reads as owner.
      case
        when bool_or(m.role = 'owner') then 'owner'
        when bool_or(m.role = 'admin') then 'admin'
        else 'agent'
      end as papel,
      string_agg(m.workspace_name, ', ' order by m.joined_at asc nulls last, m.workspace_id)
        as workspaces,
      count(*)::int as workspace_count,
      coalesce(sum(m.client_count), 0)::int as clientes,
      bool_and(m.is_internal) as all_internal,
      -- Segments are person-level: bool_or across ALL workspaces, not the
      -- primary one. Someone owning a paid and a free workspace genuinely
      -- carries both `pagante` and `free`, and hiding either would mislead.
      --
      -- 'pagante' follows MRR_STATUSES from _shared/billing-logic.ts exactly:
      -- {active, past_due}. past_due is IN-FORCE revenue that Stripe is
      -- retrying. The Loops predicate deliberately calls that free, because it
      -- answers "should we send a conversion campaign"; support needs the
      -- opposite answer, so the two must NOT be unified.
      bool_or(m.sub_status = 'trialing')                as any_trial,
      bool_or(m.sub_status in ('active', 'past_due'))   as any_paid,
      bool_or(m.sub_status = 'past_due')                as any_overdue,
      bool_or(
        m.plan_id = default_plan_id()
        and (m.sub_status is null
             or m.sub_status not in ('trialing', 'active', 'past_due'))
      ) as any_free
    from membership m
    group by m.user_id, m.email, m.nome, m.phone
  ),
  payload as (
    select
      a.user_id, a.email, a.nome, a.phone, a.papel,
      pl.name                               as plano,
      coalesce(pw.sub_status, 'nenhuma')    as assinatura,
      pw.plan_source                        as plan_source,
      a.workspaces, a.workspace_count, a.clientes,
      to_char(a.confirmed_at at time zone 'utc', 'YYYY-MM-DD') as cliente_desde,
      pw.workspace_id                       as primary_workspace_id,
      (
        select coalesce(array_agg(seg order by seg), array[]::text[])
        from unnest(
          array[case when a.papel = 'owner' then 'owner' else 'membro' end]
          || case when a.any_trial   then array['trial']        else array[]::text[] end
          || case when a.any_paid    then array['pagante']      else array[]::text[] end
          || case when a.any_overdue then array['inadimplente'] else array[]::text[] end
          || case when a.any_free    then array['free']         else array[]::text[] end
        ) as seg
      ) as segments
    from agg a
    join primary_ws pw on pw.user_id = a.user_id
    left join plans pl on pl.id = pw.plan_id
    -- Seed/demo workspaces. Per-USER aggregate, not per-row set membership:
    -- a user with at least one real workspace is still synced.
    where not a.all_internal
  ),
  fingerprinted as (
    select
      y.*,
      md5(
        coalesce(y.email, '')                      || '|' ||
        coalesce(y.nome, '')                       || '|' ||
        coalesce(y.phone, '')                      || '|' ||
        coalesce(y.papel, '')                      || '|' ||
        coalesce(y.plano, '')                      || '|' ||
        coalesce(y.assinatura, '')                 || '|' ||
        coalesce(y.plan_source, '')                || '|' ||
        coalesce(y.workspaces, '')                 || '|' ||
        y.workspace_count::text                    || '|' ||
        y.clientes::text                           || '|' ||
        coalesce(y.cliente_desde, '')              || '|' ||
        coalesce(y.primary_workspace_id::text, '') || '|' ||
        coalesce(array_to_string(y.segments, ','), '')
      ) as fingerprint
    from payload y
  )
  select
    f.user_id, f.email, f.nome, f.phone, f.papel, f.plano, f.assinatura,
    f.plan_source, f.workspaces, f.workspace_count, f.clientes, f.cliente_desde,
    f.primary_workspace_id, f.segments, f.fingerprint, cc.synced_people_id
  from fingerprinted f
  left join crisp_contacts cc on cc.user_id = f.user_id
  -- A deletion is OWED for this person's previous address. Written as a
  -- correlated `not exists` rather than folded into the left join above ON
  -- PURPOSE: `is distinct from` is two-valued and never yields NULL, so for a
  -- never-synced user the folded form evaluates to `not (TRUE and TRUE)` =
  -- FALSE and silently drops everyone with no ledger row -- which on first
  -- deployment is every single user.
  where not exists (
    select 1 from crisp_contacts cc2
    where cc2.user_id = f.user_id
      and cc2.deleted_at is null
      and cc2.synced_email is distinct from f.email
  )
    -- A swept row is UNSYNCED, whatever its fingerprint says: the profile it
    -- described was deleted at the vendor. Without this branch a user who
    -- changes their email and reverts before the new address syncs matches
    -- their own stale hash and is excluded forever, with no profile at Crisp.
    -- Change 1 (markContactDeleted nulls the fingerprint) makes this redundant
    -- on the happy path; it is kept as the backstop for a partial failure.
    and (cc.deleted_at is not null
         or cc.synced_fingerprint is distinct from f.fingerprint)
  order by cc.synced_at asc nulls first, f.user_id
  limit 200
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
    'record_crisp_contact(uuid,text)',
    'confirm_crisp_sync(uuid,text,text,text)',
    'get_crisp_contact_deletions()',
    'get_crisp_sync_candidates()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
