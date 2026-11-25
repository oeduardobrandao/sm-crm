-- Teste reverso: 14 dias de Pro sem cartao para donos novos
-- (spec docs/superpowers/specs/2026-11-24-reverse-trial-design.md,
--  plano docs/superpowers/plans/2026-11-24-reverse-trial.md).
--
-- Aditiva e segura antes de qualquer codigo: colunas novas, a chave de liga e desliga
-- (desligada) e funcoes novas. Nada comeca enquanto platform_settings.reverse_trial_enabled
-- estiver com enabled = false.
--
-- Pode ser reaplicada (if not exists / create or replace / drop ... if exists).
--
-- Rollback: desligue a chave. NUNCA limpe as colunas reverse_trial_* nem
-- profiles.reverse_trial_used_at: sao o registro de "um teste por pessoa".

-- =============================================================
-- 1) Colunas
-- =============================================================
alter table public.workspaces
  add column if not exists reverse_trial_started_at    timestamptz null,
  add column if not exists reverse_trial_ends_at       timestamptz null,
  add column if not exists reverse_trial_plan_id       text null references public.plans(id),
  add column if not exists reverse_trial_ended_at      timestamptz null,
  add column if not exists reverse_trial_outcome       text null,
  add column if not exists reverse_trial_card_added_at timestamptz null,
  add column if not exists reverse_trial_first_paid_at timestamptz null;

alter table public.workspaces drop constraint if exists workspaces_reverse_trial_outcome_check;
alter table public.workspaces add constraint workspaces_reverse_trial_outcome_check
  check (reverse_trial_outcome is null
         or reverse_trial_outcome in ('converted', 'downgraded', 'ended_by_admin'));

comment on column public.workspaces.reverse_trial_started_at is
  'Inicio do teste reverso (14 dias de Pro sem cartao). Nunca limpo.';
comment on column public.workspaces.reverse_trial_ends_at is
  'Fim agendado do teste reverso. O Admin pode mover enquanto plan_source = trial.';
comment on column public.workspaces.reverse_trial_plan_id is
  'Plano concedido no teste reverso (pro no lancamento).';
comment on column public.workspaces.reverse_trial_ended_at is
  'Quando o teste reverso terminou de fato (conversao, queda para o Free ou Admin).';
comment on column public.workspaces.reverse_trial_outcome is
  'converted | downgraded | ended_by_admin. Reescrito so pelo webhook atrasado e pela reversao de conversao nunca paga.';
comment on column public.workspaces.reverse_trial_card_added_at is
  'Quando uma assinatura paga foi vinculada durante o teste (funil).';
comment on column public.workspaces.reverse_trial_first_paid_at is
  'Primeiro pagamento confirmado da assinatura vinculada no teste (invoice.paid > 0 ou primeira cobranca paga do Pagar.me).';

alter table public.profiles
  add column if not exists reverse_trial_used_at timestamptz null;

comment on column public.profiles.reverse_trial_used_at is
  'Quando esta pessoa comecou um teste reverso. Um por pessoa, para sempre. Nunca limpo. Sem grant de UPDATE para authenticated (allowlist de 20260729000002).';

-- plan_source aceita 'trial' (lista de 20261030000001 + trial)
alter table public.workspaces drop constraint if exists workspaces_plan_source_check;
alter table public.workspaces add constraint workspaces_plan_source_check
  check (plan_source in ('system','stripe','manual','pagarme','demo','trial'));

-- workspaces tem GRANT ALL para authenticated no projeto hospedado e a policy
-- ws_update_owner_admin deixa dono/admin atualizar qualquer coluna. As colunas do teste so
-- mudam pelas funcoes SECURITY DEFINER abaixo: o guard recusa quando o comando vem direto
-- do cliente (current_user authenticated/anon). Dentro de uma funcao SECURITY DEFINER o
-- current_user e o dono da funcao, entao as funcoes passam; auth.uid() nao serve aqui
-- porque continua preenchido dentro delas.
create or replace function public.workspaces_guard_reverse_trial()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (NEW.reverse_trial_started_at    is distinct from OLD.reverse_trial_started_at
       or NEW.reverse_trial_ends_at       is distinct from OLD.reverse_trial_ends_at
       or NEW.reverse_trial_plan_id       is distinct from OLD.reverse_trial_plan_id
       or NEW.reverse_trial_ended_at      is distinct from OLD.reverse_trial_ended_at
       or NEW.reverse_trial_outcome       is distinct from OLD.reverse_trial_outcome
       or NEW.reverse_trial_card_added_at is distinct from OLD.reverse_trial_card_added_at
       or NEW.reverse_trial_first_paid_at is distinct from OLD.reverse_trial_first_paid_at
       or ((NEW.plan_source = 'trial') is distinct from (OLD.plan_source = 'trial')))
  then
    raise exception 'reverse_trial_read_only' using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_workspaces_guard_reverse_trial on public.workspaces;
create trigger trg_workspaces_guard_reverse_trial
  before update on public.workspaces
  for each row execute function public.workspaces_guard_reverse_trial();

-- =============================================================
-- 2) Chave de liga e desliga (sem deploy). Service role only.
--    {"enabled": bool, "enabled_at": timestamptz|null}. enabled_at e carimbado na primeira
--    vez que enabled vira true (trigger), e so workspaces criados depois dele comecam
--    sozinhos (p_source = 'signup'); os Free antigos so pelo cartao do dashboard.
-- =============================================================
create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.platform_settings is
  'Chaves da plataforma lidas por funcoes SQL e edge functions sem deploy. Service role only.';

alter table public.platform_settings enable row level security;
revoke all on table public.platform_settings from public, anon, authenticated;
grant select, insert, update on table public.platform_settings to service_role;

insert into public.platform_settings (key, value)
values ('reverse_trial_enabled', '{"enabled": false, "enabled_at": null}'::jsonb)
on conflict (key) do nothing;

create or replace function public.platform_settings_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  NEW.updated_at := now();
  if NEW.key = 'reverse_trial_enabled'
     and coalesce((NEW.value ->> 'enabled')::boolean, false)
     and coalesce(NEW.value ->> 'enabled_at', '') = '' then
    NEW.value := jsonb_set(NEW.value, '{enabled_at}', to_jsonb(now()));
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_platform_settings_stamp on public.platform_settings;
create trigger trg_platform_settings_stamp
  before insert or update on public.platform_settings
  for each row execute function public.platform_settings_stamp();

create or replace function public._reverse_trial_switch(out enabled boolean, out enabled_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((s.value ->> 'enabled')::boolean, false),
         nullif(s.value ->> 'enabled_at', '')::timestamptz
    from (select 1) one
    left join platform_settings s on s.key = 'reverse_trial_enabled'
$$;

-- "Ja assinou": mesmo formato do paid_ws de get_nurture_candidates (20261119000001).
create or replace function public._workspace_ever_paid(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_subscriptions s
     where s.workspace_id = p_workspace
       and (s.ever_subscribed_at is not null
            or s.stripe_subscription_id is not null
            or s.pagarme_subscription_id is not null
            or s.status in ('active', 'trialing', 'past_due'))
  )
$$;

-- =============================================================
-- 3) Elegibilidade (service_role). Tudo de:
--    - p_user e dono do workspace;
--    - workspace no Free, plan_source nao manual/demo/trial, nao demo, nunca assinou, nunca
--      teve teste reverso;
--    - a pessoa nunca teve teste reverso e nao e dona de outro workspace que assinou ou
--      teve teste reverso;
--    - chave ligada; p_source = 'signup' exige workspace criado a partir de enabled_at.
-- =============================================================
create or replace function public.reverse_trial_eligible(p_workspace uuid, p_user uuid, p_source text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select sw.enabled
       and p_source in ('signup', 'nudge')
       and (p_source = 'nudge'
            or (sw.enabled_at is not null and w.created_at >= sw.enabled_at))
       and exists (select 1 from plans pl where pl.id = 'pro')
       and exists (
         select 1 from workspace_members m
          where m.workspace_id = w.id and m.user_id = p_user and m.role = 'owner')
       and coalesce(w.plan_id, (select id from plans where is_default limit 1))
           = (select id from plans where is_default limit 1)
       and w.plan_source not in ('manual', 'demo', 'trial')
       and w.demo_created_at is null
       and w.reverse_trial_started_at is null
       and not _workspace_ever_paid(w.id)
       and pr.reverse_trial_used_at is null
       and not exists (
         select 1
           from workspace_members m2
           join workspaces w2 on w2.id = m2.workspace_id
          where m2.user_id = p_user and m2.role = 'owner'
            and (w2.reverse_trial_started_at is not null or _workspace_ever_paid(w2.id)))
      from workspaces w
      join profiles pr on pr.id = p_user
     cross join _reverse_trial_switch() sw
     where w.id = p_workspace
  ), false)
$$;

-- =============================================================
-- 4) Oferta para o CRM (authenticated): {enabled, eligible, auto} do workspace ativo.
-- =============================================================
create or replace function public.reverse_trial_offer()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_enabled boolean;
begin
  select enabled into v_enabled from _reverse_trial_switch();
  if v_uid is null then
    return jsonb_build_object('enabled', coalesce(v_enabled, false), 'eligible', false, 'auto', false);
  end if;
  v_ws := get_my_conta_id();
  return jsonb_build_object(
    'enabled',  coalesce(v_enabled, false),
    'eligible', v_ws is not null and reverse_trial_eligible(v_ws, v_uid, 'nudge'),
    'auto',     v_ws is not null and reverse_trial_eligible(v_ws, v_uid, 'signup'));
end;
$$;

-- =============================================================
-- 5) Inicio (authenticated). Workspace ativo, so o dono. Trava o perfil (um teste por
--    pessoa, mesmo com dois workspaces comecando ao mesmo tempo) e depois o workspace,
--    confere de novo a elegibilidade e grava. Idempotente: um teste em andamento e
--    devolvido como started.
-- =============================================================
create or replace function public.start_reverse_trial(p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  w record;
  v_enabled boolean;
  v_ends timestamptz;
begin
  if v_uid is null or p_source is null or p_source not in ('signup', 'nudge') then
    return jsonb_build_object('started', false, 'ends_at', null, 'reason', 'not_eligible');
  end if;

  v_ws := get_my_conta_id();
  if v_ws is null then
    return jsonb_build_object('started', false, 'ends_at', null, 'reason', 'not_eligible');
  end if;

  perform 1 from profiles where id = v_uid for update;
  select * into w from workspaces where id = v_ws for update;
  if not found then
    return jsonb_build_object('started', false, 'ends_at', null, 'reason', 'not_eligible');
  end if;

  -- teste ja em andamento: devolve o mesmo fim (so para o dono)
  if w.plan_source = 'trial' and w.reverse_trial_started_at is not null
     and exists (select 1 from workspace_members m
                  where m.workspace_id = v_ws and m.user_id = v_uid and m.role = 'owner') then
    return jsonb_build_object('started', true, 'ends_at', w.reverse_trial_ends_at);
  end if;

  select enabled into v_enabled from _reverse_trial_switch();
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('started', false, 'ends_at', null, 'reason', 'disabled');
  end if;

  if not reverse_trial_eligible(v_ws, v_uid, p_source) then
    return jsonb_build_object('started', false, 'ends_at', null, 'reason', 'not_eligible');
  end if;

  v_ends := now() + interval '14 days';

  update workspaces
     set plan_id = 'pro',
         plan_source = 'trial',
         reverse_trial_started_at = now(),
         reverse_trial_ends_at = v_ends,
         reverse_trial_plan_id = 'pro',
         trial_offer_seen_at = coalesce(trial_offer_seen_at, now())
   where id = v_ws;

  update profiles
     set reverse_trial_used_at = coalesce(reverse_trial_used_at, now())
   where id = v_uid;

  return jsonb_build_object('started', true, 'ends_at', v_ends);
end;
$$;

-- =============================================================
-- Grants. REVOKE FROM PUBLIC sozinho nao tira o EXECUTE que o Supabase da a
-- anon/authenticated: nomeia cada papel e concede explicitamente.
-- =============================================================
revoke all on function public.workspaces_guard_reverse_trial() from public, anon, authenticated;
revoke all on function public.platform_settings_stamp() from public, anon, authenticated;

revoke all on function public._reverse_trial_switch() from public, anon, authenticated;
grant execute on function public._reverse_trial_switch() to service_role;

revoke all on function public._workspace_ever_paid(uuid) from public, anon, authenticated;
grant execute on function public._workspace_ever_paid(uuid) to service_role;

revoke all on function public.reverse_trial_eligible(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_trial_eligible(uuid, uuid, text) to service_role;

revoke all on function public.reverse_trial_offer() from public, anon;
grant execute on function public.reverse_trial_offer() to authenticated, service_role;

revoke all on function public.start_reverse_trial(text) from public, anon;
grant execute on function public.start_reverse_trial(text) to authenticated, service_role;
