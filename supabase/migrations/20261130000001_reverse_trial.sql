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

-- =============================================================
-- 6) Conversao, fim e pausa do Hub (service_role). Todas travam a linha do workspace
--    (select ... for update) e comparam o estado sob o lock, entao o webhook e a varredura
--    nunca se cruzam. "Assinatura paga em vigor" = status active/trialing com id do
--    provedor; e lida sem lock (grant_pagarme_plan trava assinatura -> workspace, entao um
--    FOR UPDATE na assinatura aqui poderia gerar deadlock).
-- =============================================================
create or replace function public._reverse_trial_default_plan()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id from plans where is_default limit 1
$$;

create or replace function public._workspace_paid_sub_in_force(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_subscriptions s
     where s.workspace_id = p_workspace
       and s.status in ('active', 'trialing')
       and (s.stripe_subscription_id is not null or s.pagarme_subscription_id is not null)
  )
$$;

-- convert_reverse_trial: assinatura paga vinculada (subscribed) num workspace em teste ou
-- que acabou de cair do teste.
--   'converted'      : estava em teste -> plano pago, outcome converted, card_added_at.
--   'rewritten_late' : a varredura ja tinha derrubado o teste, mas o checkout foi aberto
--                      durante ele (ultima tentativa de checkout ate ended_at, webhook em ate
--                      2 dias: a sessao do Stripe expira em 24h) -> plano pago e outcome
--                      reescrito para converted.
--   'not_trial'      : nada foi gravado; o chamador faz a escrita normal (win-back depois
--                      do teste, manual, workspace sem teste, plano invalido).
create or replace function public.convert_reverse_trial(p_workspace uuid, p_plan text, p_source text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
  v_last_checkout timestamptz;
begin
  if p_source is null or p_source not in ('stripe', 'pagarme')
     or p_plan is null or p_plan = _reverse_trial_default_plan()
     or not exists (select 1 from plans where id = p_plan) then
    return 'not_trial';
  end if;

  select * into w from workspaces where id = p_workspace for update;
  if not found or w.plan_source = 'manual' then
    return 'not_trial';
  end if;

  if w.plan_source = 'trial' then
    update workspaces
       set plan_id = p_plan,
           plan_source = p_source,
           reverse_trial_ended_at = now(),
           reverse_trial_outcome = 'converted',
           reverse_trial_card_added_at = coalesce(reverse_trial_card_added_at, now())
     where id = p_workspace;
    return 'converted';
  end if;

  if w.reverse_trial_outcome = 'downgraded' and w.reverse_trial_ended_at is not null
     and now() < w.reverse_trial_ended_at + interval '2 days' then
    select greatest(
             (select max(ca.created_at) from checkout_attempts ca where ca.workspace_id = p_workspace),
             (select max(pa.created_at) from pagarme_checkout_attempts pa where pa.workspace_id = p_workspace))
      into v_last_checkout;
    if v_last_checkout is not null
       and v_last_checkout >= w.reverse_trial_started_at
       and v_last_checkout <= w.reverse_trial_ended_at then
      update workspaces
         set plan_id = p_plan,
             plan_source = p_source,
             reverse_trial_outcome = 'converted',
             reverse_trial_card_added_at = coalesce(reverse_trial_card_added_at, now())
       where id = p_workspace;
      return 'rewritten_late';
    end if;
  end if;

  return 'not_trial';
end;
$$;

-- end_reverse_trial: fim do teste em andamento. Nada acontece se nao for teste ou se uma
-- assinatura paga estiver em vigor (a conversao e quem deve gravar).
create or replace function public.end_reverse_trial(p_workspace uuid, p_outcome text default 'downgraded')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
begin
  if p_outcome is null or p_outcome not in ('downgraded', 'ended_by_admin') then
    return false;
  end if;
  select * into w from workspaces where id = p_workspace for update;
  if not found or w.plan_source is distinct from 'trial' then
    return false;
  end if;
  if _workspace_paid_sub_in_force(p_workspace) then
    return false;
  end if;
  update workspaces
     set plan_id = _reverse_trial_default_plan(),
         plan_source = 'system',
         reverse_trial_ended_at = now(),
         reverse_trial_outcome = p_outcome
   where id = p_workspace;
  return true;
end;
$$;

-- mark_reverse_trial_unpaid: assinatura vinculada no teste caiu (cancelada ou primeira
-- cobranca falhou) sem nenhum pagamento, no dia do fim original ou depois: vira teste
-- derrubado. O chamador ja gravou o plano padrao.
create or replace function public.mark_reverse_trial_unpaid(p_workspace uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
begin
  select * into w from workspaces where id = p_workspace for update;
  if not found
     or w.reverse_trial_outcome is distinct from 'converted'
     or w.reverse_trial_first_paid_at is not null
     or w.reverse_trial_ends_at is null
     or now() < w.reverse_trial_ends_at then
    return false;
  end if;
  update workspaces
     set reverse_trial_outcome = 'downgraded',
         reverse_trial_ended_at = now()
   where id = p_workspace;
  return true;
end;
$$;

-- revert_reverse_trial_conversion: a mesma queda, antes do fim original: volta ao teste ate
-- a data original (cancelar nunca custa dias de teste). card_added_at fica.
create or replace function public.revert_reverse_trial_conversion(p_workspace uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
begin
  select * into w from workspaces where id = p_workspace for update;
  if not found
     or w.plan_source = 'manual'
     or w.reverse_trial_outcome is distinct from 'converted'
     or w.reverse_trial_first_paid_at is not null
     or w.reverse_trial_ends_at is null
     or now() >= w.reverse_trial_ends_at then
    return false;
  end if;
  update workspaces
     set plan_id = coalesce(reverse_trial_plan_id, 'pro'),
         plan_source = 'trial',
         reverse_trial_ended_at = null,
         reverse_trial_outcome = null
   where id = p_workspace;
  return true;
end;
$$;

-- mark_reverse_trial_first_paid: primeiro pagamento da assinatura vinculada no teste. Uma vez.
create or replace function public.mark_reverse_trial_first_paid(p_workspace uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update workspaces
     set reverse_trial_first_paid_at = now()
   where id = p_workspace
     and reverse_trial_card_added_at is not null
     and reverse_trial_first_paid_at is null
$$;

-- hub_workspace_paused: links do Hub pausados 7 dias depois da queda do teste, enquanto o
-- workspace segue no Free (qualquer plano pago ou cortesia libera na hora).
create or replace function public.hub_workspace_paused(p_conta uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select w.reverse_trial_outcome = 'downgraded'
       and w.reverse_trial_ended_at is not null
       and now() >= w.reverse_trial_ended_at + interval '7 days'
       and w.plan_source is distinct from 'manual'
       and coalesce(w.plan_id, _reverse_trial_default_plan()) = _reverse_trial_default_plan()
      from workspaces w
     where w.id = p_conta
  ), false)
$$;

-- grant_pagarme_plan (corpo de 20261030000001 + teste reverso): com a assinatura em vigor,
-- workspace em teste ou recem-derrubado passa por convert_reverse_trial; um teste em
-- andamento nunca e tocado por status fora de vigor (como a conta demo).
create or replace function public.grant_pagarme_plan(
  p_workspace uuid,
  p_plan text,
  p_sub text,
  p_status text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written integer;
  v_ws record;
begin
  perform 1
    from public.workspace_subscriptions s
   where s.workspace_id = p_workspace
     and s.provider = 'pagarme'
     and s.pagarme_subscription_id = p_sub
     and s.status = p_status
   for update;
  if not found then
    return 0;
  end if;

  select w.plan_source, w.reverse_trial_outcome into v_ws
    from public.workspaces w where w.id = p_workspace;
  if (v_ws.plan_source = 'trial' or v_ws.reverse_trial_outcome = 'downgraded')
     and p_status in ('active', 'trialing') then
    if public.convert_reverse_trial(p_workspace, p_plan, 'pagarme') <> 'not_trial' then
      return 1;
    end if;
  end if;

  update public.workspaces w
     set plan_id = p_plan,
         plan_source = 'pagarme'
   -- 'manual' (comp) nunca e sobrescrito. 'demo' e 'trial' so mudam por uma assinatura em
   -- vigor (active/trialing); qualquer outro status deixa a conta como esta.
   where w.id = p_workspace
     and w.plan_source is distinct from 'manual'
     and not (w.plan_source in ('demo', 'trial') and p_status not in ('active','trialing'));
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public._reverse_trial_default_plan()',
    'public._workspace_paid_sub_in_force(uuid)',
    'public.convert_reverse_trial(uuid,text,text)',
    'public.end_reverse_trial(uuid,text)',
    'public.mark_reverse_trial_unpaid(uuid)',
    'public.revert_reverse_trial_conversion(uuid)',
    'public.mark_reverse_trial_first_paid(uuid)',
    'public.hub_workspace_paused(uuid)',
    'public.grant_pagarme_plan(uuid,text,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
