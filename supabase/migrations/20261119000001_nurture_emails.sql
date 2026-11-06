-- Nurture por e-mail para donos de workspace que nunca assinaram
-- (spec docs/superpowers/specs/2026-11-05-nurture-never-paid-design.md).
--
-- Additive and safe before any code: a new nullable column on profiles, a new
-- ledger table and three new functions. Nothing reads them until the nurture
-- edge function ships.
--
-- Rollback: drop get_nurture_candidates, claim_nurture_email and
-- _nurture_current_owner. KEEP the nurture_emails rows: they are the
-- "never send twice" ledger, and deleting them would let a re-deploy mail the
-- same people again. Keep profiles.nurture_opt_out_at too (it records an
-- unsubscribe the person asked for).

-- =============================================================
-- 1) Opt-out marker on profiles, writable by the owner of the row.
-- =============================================================
alter table public.profiles
  add column if not exists nurture_opt_out_at timestamptz null;

comment on column public.profiles.nurture_opt_out_at is
  'Quando a pessoa se descadastrou dos e-mails de nurture (contas que nunca assinaram). null = recebe. Lido por get_nurture_candidates().';

-- profiles has a column-level UPDATE allowlist for authenticated
-- (20260729000002_profiles_write_lockdown.sql). Add only the new column.
grant update (nurture_opt_out_at) on public.profiles to authenticated;

-- Post-condition: the exact UPDATE column set for authenticated. Same query
-- as 20260729000002; a surviving table-level grant shows up as every column.
do $$
declare
  v_expected text[] := array[
    'empresa', 'marketing_opt_in', 'nome', 'nurture_opt_out_at',
    'onboarding_complete', 'telefone', 'whatsapp'];
  v_actual text[];
begin
  select array_agg(column_name::text order by column_name) into v_actual
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'profiles'
     and grantee = 'authenticated' and privilege_type = 'UPDATE';

  if v_actual is distinct from v_expected then
    raise exception 'authenticated UPDATE columns on profiles are %, expected %',
      coalesce(array_to_string(v_actual, ','), '<none>'),
      array_to_string(v_expected, ',');
  end if;
end $$;

-- =============================================================
-- 2) Ledger: one row per (workspace, step). Service role only.
-- =============================================================
create table if not exists public.nurture_emails (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  step text not null check (step in ('a1','a2','a3','a4','b1','b2','b3','b4')),
  recipient_user_id uuid not null,
  sent_at timestamptz not null,
  -- First claim of this step. Never moved by a retry: retries stop 20h after
  -- it, inside Resend's 24h Idempotency-Key window, so a retry can never
  -- double-send. Past that the step is abandoned and the sequence ends.
  first_claimed_at timestamptz not null default now(),
  delivered_at timestamptz null,
  attempts int not null default 1,
  unique (workspace_id, step)
);

comment on table public.nurture_emails is
  'Ledger do nurture de contas que nunca assinaram: uma linha por workspace e passo (a1..a4 sem cliente, b1..b4 com cliente). sent_at = ultimo claim; first_claimed_at = primeiro claim (retentativa so ate 20h depois dele, dentro das 24h de idempotencia do Resend); delivered_at = entrega confirmada. Nunca apagar: e o registro de "nunca mandar duas vezes".';

create index if not exists nurture_emails_recipient_delivered_idx
  on public.nurture_emails (recipient_user_id, delivered_at);

alter table public.nurture_emails enable row level security;

-- No policies: only service_role (which bypasses RLS) touches this table.
revoke all on table public.nurture_emails from public, anon, authenticated;
grant select, insert, update on table public.nurture_emails to service_role;
revoke all on sequence public.nurture_emails_id_seq from public, anon, authenticated;
grant usage, select on sequence public.nurture_emails_id_seq to service_role;

-- =============================================================
-- 3) Current owner: same pick as get_trial_reminder_candidates
--    (20261102000001): created_by if still an owner, else oldest owner by
--    joined_at, tie by user_id.
-- =============================================================
create or replace function public._nurture_current_owner(p_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select wm.user_id
  from workspace_members wm
  join workspaces ws on ws.id = wm.workspace_id
  where wm.workspace_id = p_workspace_id and wm.role = 'owner'
  order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
  limit 1
$$;

-- =============================================================
-- 4) Candidates. Consumed by the nurture cron (service role). Returns nothing
--    outside Monday-Friday 9h00-11h59 America/Sao_Paulo.
--
--    Eligible (owner, workspace): owner is the current owner; workspace not
--    demo, plan_source <> 'manual', at most 180 days old, never subscribed
--    (same predicate as hasEverSubscribed in _shared/billing-logic.ts, plus
--    status outside active/trialing/past_due); the person owns no other
--    workspace that ever subscribed; profiles.conta_id is this workspace;
--    not opted out; account at least 72h old.
--
--    72h cap per person: nurture delivered (or claimed in the last hour),
--    welcome, and subscription_thanks / trial_reminder of any workspace the
--    person currently owns. One sequence per person: a nurture row on another
--    workspace blocks this one.
--
--    Step: a pending claim is retried (stale, < 30 attempts, first claimed
--    less than 20h ago, same recipient as the current owner) or waited on
--    (fresh); a pending claim first claimed 20h ago or more, or claimed for
--    a previous owner, is abandoned and ends the sequence (a retry past
--    Resend's 24h idempotency window could send twice); a4/b4 delivered
--    ends it; segment b when there is any b row or
--    at least one client; A -> B only before a4; steps 2/3/4 are due 4/9/16
--    days after the delivery of step 1 of the current segment.
--
--    Quota: at most 15 new entries (a1/b1 for a workspace with no nurture row)
--    per Sao Paulo day, counted from ledger entry rows claimed that day; most
--    recent sign-in first. Continuations are not limited.
-- =============================================================
create or replace function public.get_nurture_candidates(p_now timestamptz default now())
returns table (
  user_id uuid,
  workspace_id uuid,
  email text,
  nome text,
  workspace_name text,
  workspace_created_at timestamptz,
  email_type text,
  step text,
  attempts int,
  client_count int,
  first_client_name text,
  has_instagram boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with clk as (
    select (p_now at time zone 'America/Sao_Paulo') as local
  ),
  paid_ws as (
    select s.workspace_id
    from workspace_subscriptions s
    where s.ever_subscribed_at is not null
       or s.stripe_subscription_id is not null
       or s.pagarme_subscription_id is not null
       or s.status in ('active', 'trialing', 'past_due')
  ),
  own as (
    select o.workspace_id, o.user_id
    from (
      select ws.id as workspace_id, _nurture_current_owner(ws.id) as user_id
      from workspaces ws
    ) o
    where o.user_id is not null
  ),
  eligible as (
    select o.user_id,
           ws.id as workspace_id,
           u.email::text as email,
           p.nome,
           ws.name as workspace_name,
           ws.created_at as workspace_created_at,
           u.last_sign_in_at
    from own o
    join workspaces ws on ws.id = o.workspace_id
    join auth.users u on u.id = o.user_id
    join profiles p on p.id = o.user_id
    cross join clk
    where extract(isodow from clk.local) between 1 and 5
      and extract(hour from clk.local) between 9 and 11
      and ws.demo_created_at is null
      and ws.plan_source <> 'manual'
      and ws.created_at > p_now - interval '180 days'
      -- the person owns no workspace (this one included) that ever subscribed
      and not exists (
        select 1 from own o2 join paid_ws pw on pw.workspace_id = o2.workspace_id
        where o2.user_id = o.user_id
      )
      and p.conta_id = ws.id
      and p.nurture_opt_out_at is null
      and u.email is not null
      and u.created_at <= p_now - interval '72 hours'
      -- 72h cap
      and not exists (
        select 1 from nurture_emails n
        where n.recipient_user_id = o.user_id
          and (n.delivered_at > p_now - interval '72 hours'
               or (n.delivered_at is null and n.sent_at > p_now - interval '1 hour'))
      )
      and not exists (
        select 1 from lifecycle_emails le
        where le.email_type = 'welcome' and le.user_id = o.user_id
          and le.delivered_at > p_now - interval '72 hours'
      )
      and not exists (
        select 1 from lifecycle_emails le
        join own o3 on o3.workspace_id = le.workspace_id
        where o3.user_id = o.user_id
          and le.email_type in ('subscription_thanks', 'trial_reminder')
          and le.delivered_at > p_now - interval '72 hours'
      )
      -- one sequence per person
      and not exists (
        select 1 from nurture_emails n
        where n.recipient_user_id = o.user_id and n.workspace_id <> ws.id
      )
  ),
  st as (
    select e.*,
           cc.client_count,
           fc.first_client_name,
           ig.has_instagram,
           r.n_rows,
           r.has_b,
           r.a1_at,
           r.b1_at,
           r.max_a,
           r.max_b,
           r.end_delivered,
           pend.step as pend_step,
           pend.attempts as pend_attempts,
           pend.sent_at as pend_sent_at,
           pend.first_claimed_at as pend_first_claimed_at,
           pend.recipient_user_id as pend_recipient
    from eligible e
    cross join lateral (
      select count(*)::int as client_count from clientes c where c.conta_id = e.workspace_id
    ) cc
    left join lateral (
      select c.nome as first_client_name
      from clientes c where c.conta_id = e.workspace_id
      order by c.created_at, c.id
      limit 1
    ) fc on true
    cross join lateral (
      select exists (
        select 1 from instagram_accounts ia
        join clientes c on c.id = ia.client_id
        where c.conta_id = e.workspace_id and ia.authorization_status = 'active'
      ) as has_instagram
    ) ig
    cross join lateral (
      select count(*)::int as n_rows,
             coalesce(bool_or(n.step like 'b%'), false) as has_b,
             max(n.delivered_at) filter (where n.step = 'a1') as a1_at,
             max(n.delivered_at) filter (where n.step = 'b1') as b1_at,
             max(substr(n.step, 2)::int) filter (where n.step like 'a%' and n.delivered_at is not null) as max_a,
             max(substr(n.step, 2)::int) filter (where n.step like 'b%' and n.delivered_at is not null) as max_b,
             coalesce(bool_or(n.step in ('a4', 'b4') and n.delivered_at is not null), false) as end_delivered
      from nurture_emails n where n.workspace_id = e.workspace_id
    ) r
    left join lateral (
      select n.step, n.attempts, n.sent_at, n.first_claimed_at, n.recipient_user_id
      from nurture_emails n
      where n.workspace_id = e.workspace_id and n.delivered_at is null
      order by n.sent_at desc
      limit 1
    ) pend on true
  ),
  chosen as (
    select s.*,
           case
             when s.pend_step is not null then
               case
                 when s.pend_sent_at > p_now - interval '1 hour' then null
                 -- abandoned: past the 20h retry bound, or claimed for a
                 -- previous owner (the claim would refuse it anyway)
                 when s.pend_first_claimed_at <= p_now - interval '20 hours' then null
                 when s.pend_recipient is distinct from s.user_id then null
                 when s.pend_attempts < 30 then s.pend_step
                 else null
               end
             when s.end_delivered then null
             when s.has_b or s.client_count >= 1 then
               case
                 -- A -> B only before a4: a delivered a4 already ended the
                 -- sequence above, an undelivered one took the pending branch
                 when not s.has_b then 'b1'
                 when s.b1_at is null or s.max_b is null then null
                 when p_now >= s.b1_at + make_interval(days => case s.max_b when 1 then 4 when 2 then 9 else 16 end)
                   then 'b' || (s.max_b + 1)
                 else null
               end
             else
               case
                 when s.n_rows = 0 then 'a1'
                 when s.a1_at is null or s.max_a is null then null
                 when p_now >= s.a1_at + make_interval(days => case s.max_a when 1 then 4 when 2 then 9 else 16 end)
                   then 'a' || (s.max_a + 1)
                 else null
               end
           end as next_step,
           case when s.pend_step is not null then s.pend_attempts else 0 end as next_attempts
    from st s
  ),
  flagged as (
    select c.*,
           (c.next_step in ('a1', 'b1') and c.n_rows = 0) as new_entry
    from chosen c
    where c.next_step is not null
  ),
  used as (
    select count(*)::int as n
    from nurture_emails n
    cross join clk
    where (n.step = 'a1'
           or (n.step = 'b1' and not exists (
                 select 1 from nurture_emails a
                 where a.workspace_id = n.workspace_id and a.step = 'a1')))
      and (n.sent_at at time zone 'America/Sao_Paulo')::date = clk.local::date
  ),
  ranked as (
    select f.*,
           row_number() over (
             partition by f.new_entry
             order by f.last_sign_in_at desc nulls last, f.workspace_id
           ) as rn
    from flagged f
  )
  select r.user_id,
         r.workspace_id,
         r.email,
         r.nome,
         r.workspace_name,
         r.workspace_created_at,
         'nurture_' || r.next_step,
         r.next_step,
         r.next_attempts,
         r.client_count,
         r.first_client_name,
         r.has_instagram
  from ranked r
  cross join used
  where not r.new_entry or r.rn <= greatest(0, 15 - used.n)
  order by r.new_entry, r.last_sign_in_at desc nulls last, r.workspace_id
  limit 50
$$;

-- =============================================================
-- 5) Claim. Returns attempts after the claim, or null when refused: invalid
--    step, recipient is not the current owner (owner changed between read
--    and send), recipient opted out, step already delivered, a fresh claim
--    (< 1h) in flight, the retry budget (30) spent, or the first claim is
--    20h old or more (Resend dedupes an Idempotency-Key for 24h only).
-- =============================================================
create or replace function public.claim_nurture_email(
  p_workspace_id uuid,
  p_step text,
  p_recipient_user_id uuid,
  p_now timestamptz default now()
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts int;
begin
  if p_step is null
     or p_step not in ('a1','a2','a3','a4','b1','b2','b3','b4')
     or p_recipient_user_id is null
     or _nurture_current_owner(p_workspace_id) is distinct from p_recipient_user_id
     or exists (
       select 1 from profiles p
       where p.id = p_recipient_user_id and p.nurture_opt_out_at is not null
     ) then
    return null;
  end if;

  insert into nurture_emails as ne
    (workspace_id, step, recipient_user_id, sent_at, first_claimed_at, attempts)
  values (p_workspace_id, p_step, p_recipient_user_id, p_now, p_now, 1)
  on conflict (workspace_id, step) do update
    set sent_at = p_now,
        attempts = ne.attempts + 1
    where ne.delivered_at is null
      and ne.sent_at <= p_now - interval '1 hour'
      and ne.attempts < 30
      and ne.first_claimed_at > p_now - interval '20 hours'
      and ne.recipient_user_id = p_recipient_user_id
  returning ne.attempts into v_attempts;

  return v_attempts;
end
$$;

-- =============================================================
-- 6) Grants. REVOKE FROM PUBLIC alone also strips service_role: name every
--    role and GRANT explicitly. Verify with proacl.
-- =============================================================
revoke all on function public._nurture_current_owner(uuid) from public, anon, authenticated;
grant execute on function public._nurture_current_owner(uuid) to service_role;

revoke all on function public.get_nurture_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.get_nurture_candidates(timestamptz) to service_role;

revoke all on function public.claim_nurture_email(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_nurture_email(uuid, text, uuid, timestamptz) to service_role;
