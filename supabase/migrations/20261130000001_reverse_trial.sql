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

-- =============================================================
-- 7) Financeiro e Contratos so leitura sem o plano (decisao do dono do produto).
--    Os gatilhos enforce_plan_feature dessas tabelas disparam so no INSERT; aqui ganham um
--    BEFORE UPDATE. Tabelas que as telas gravam (apps/crm/src/store/finance.ts, unico
--    escritor das telas Financeiro v1 e Contratos):
--      transacoes, transacoes_recorrentes  -> feature_financial
--      contratos                           -> feature_contracts
--    (Financeiro v2 escreve so por RPCs nas tabelas financeiro_*, fora deste escopo; o MCP
--    usa service role.)
--    Pulado quando auth.uid() e nulo (service role, crons, sync legado do Financeiro v2) e
--    quando pg_trigger_depth() > 1 (escrita feita por outro gatilho, inclusive o SET NULL
--    de cliente_id quando um cliente e apagado). Sem gatilho de DELETE: apagar cliente ou
--    workspace cascateia nessas tabelas e um guard quebraria isso para todo Free.
--    Mesma checagem de enforce_plan_feature (modo 'direct'); uma funcao de gatilho nao pode
--    chamar outra, entao a regra e repetida aqui.
-- =============================================================
create or replace function public.enforce_plan_feature_on_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_feature_key text := TG_ARGV[0];
  v_ws_col      text := TG_ARGV[1];
  v_ws_id       uuid;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return NEW;
  end if;
  execute format('select (($1).%I)::uuid', v_ws_col) using NEW into v_ws_id;
  if v_ws_id is null then
    return NEW;
  end if;
  if not effective_plan_feature(v_ws_id, v_feature_key) then
    raise exception 'feature_disabled:%', v_feature_key using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

revoke all on function public.enforce_plan_feature_on_update() from public, anon, authenticated;

drop trigger if exists trg_feature_financial_update on public.transacoes;
create trigger trg_feature_financial_update
  before update on public.transacoes
  for each row execute function public.enforce_plan_feature_on_update('feature_financial', 'conta_id');

drop trigger if exists trg_feature_financial_update on public.transacoes_recorrentes;
create trigger trg_feature_financial_update
  before update on public.transacoes_recorrentes
  for each row execute function public.enforce_plan_feature_on_update('feature_financial', 'conta_id');

drop trigger if exists trg_feature_contracts_update on public.contratos;
create trigger trg_feature_contracts_update
  before update on public.contratos
  for each row execute function public.enforce_plan_feature_on_update('feature_contracts', 'conta_id');

-- =============================================================
-- 8) RPCs que separam por plano. Cada uma redefinida a partir do corpo mais recente (citado
--    acima de cada uma). Mudar a lista de colunas de um `returns table` exige DROP antes,
--    entao os grants sao refeitos no fim da secao.
-- =============================================================
-- get_nurture_candidates: corpo de 20261119000001 + exclui plan_source 'trial' + ex_reverse_trial.
drop function if exists public.get_nurture_candidates(timestamptz);
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
  has_instagram boolean,
  ex_reverse_trial boolean
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
           u.last_sign_in_at,
           (ws.reverse_trial_outcome is not distinct from 'downgraded') as ex_reverse_trial
    from own o
    join workspaces ws on ws.id = o.workspace_id
    join auth.users u on u.id = o.user_id
    join profiles p on p.id = o.user_id
    cross join clk
    where extract(isodow from clk.local) between 1 and 5
      and extract(hour from clk.local) between 9 and 11
      and ws.demo_created_at is null
      -- teste reverso em andamento fica fora; depois da queda o nurture pode voltar
      and ws.plan_source not in ('manual', 'trial')
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
         r.has_instagram,
         r.ex_reverse_trial
  from ranked r
  cross join used
  where not r.new_entry or r.rn <= greatest(0, 15 - used.n)
  order by r.new_entry, r.last_sign_in_at desc nulls last, r.workspace_id
  limit 50
$$;
-- get_welcome_email_candidates: corpo de 20260730000001 + reverse_trial_offer.
drop function if exists public.get_welcome_email_candidates();
create or replace function get_welcome_email_candidates()
returns table (user_id uuid, email text, nome text, attempts int, reverse_trial_offer boolean)
language sql
security definer
set search_path = public
as $$
  select c.user_id, c.email, c.nome, c.attempts,
         -- chave ligada e um workspace criado pela pessoa vai (ou ja foi) para o teste
         -- reverso automatico: o e-mail troca o bloco do teste de 30 dias pelo de 14 dias
         (coalesce((select sw.enabled from _reverse_trial_switch() sw), false)
          and exists (
            select 1 from workspaces w2
             where w2.created_by = c.user_id
               and (reverse_trial_eligible(w2.id, c.user_id, 'signup')
                    or (w2.plan_source = 'trial' and w2.reverse_trial_started_at is not null)))
         ) as reverse_trial_offer
  from (
    select distinct u.id as user_id, u.email::text as email, p.nome,
           coalesce(le.attempts, 0) as attempts, u.email_confirmed_at
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
  ) c
  order by c.email_confirmed_at asc, c.user_id asc
  limit 50
$$;
-- get_trial_reminder_candidates: corpo de 20261102000001 + reverse_trial_conversion.
drop function if exists public.get_trial_reminder_candidates();
create or replace function get_trial_reminder_candidates()
returns table (
  workspace_id uuid,
  workspace_name text,
  owner_email text,
  owner_nome text,
  plan_name text,
  provider text,
  amount_cents int,
  amount_interval text,
  billing_interval text,
  first_charge_at timestamptz,
  attempts int,
  reverse_trial_conversion boolean
)
language sql
security definer
set search_path = public
as $$
  select ws.id,
         ws.name,
         u.email::text,
         p.nome,
         coalesce(pl.name, s.plan_id),
         s.provider,
         s.amount_cents,
         s.amount_interval,
         s.billing_interval,
         s.current_period_end,
         case
           when le.id is null or le.ref_at is distinct from s.current_period_end then 0
           else le.attempts
         end,
         ws.reverse_trial_card_added_at is not null
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
  left join plans pl on pl.id = s.plan_id
  left join lifecycle_emails le
    on le.email_type = 'trial_reminder' and le.workspace_id = ws.id
  where s.status = 'trialing'
    and s.cancel_at_period_end = false
    and s.current_period_end is not null
    and s.current_period_end between now() + interval '3 days'
                                 and now() + interval '7 days 1 hour'
    and (s.switched_from_stripe_subscription_id is null
         or s.switched_from_trialing is true)
    and u.email is not null
    and (le.id is null
         or le.ref_at is distinct from s.current_period_end
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 30))
  order by s.current_period_end asc, ws.id asc
  limit 50
$$;
-- get_loops_trait_candidates: corpo de 20260803000004 + any_reverse_trial e reverse_trial_ends_at.
drop function if exists public.get_loops_trait_candidates();
create or replace function get_loops_trait_candidates()
returns table (
  user_id uuid, email text, nome text, days_since_signup int,
  workspace_count int, any_free boolean,
  any_reverse_trial boolean, reverse_trial_ends_at timestamptz
)
language sql security definer set search_path = public as $$
  select u.id, u.email::text, p.nome,
         extract(epoch from (now() - u.email_confirmed_at))::int / 86400,
         count(ws.id)::int,
         -- any_free MUST stay consistent with the event RPCs' definition of a
         -- free workspace: effective default plan AND no trialing/active
         -- subscription. plan_id alone is not sufficient -- it drifts out of
         -- sync with the real subscription state (Stripe webhook lag, a manual
         -- action in the Stripe dashboard, plan_source = 'manual'), which is
         -- exactly why all three event RPCs carry the same workspace_subscriptions
         -- exclusion. If the two definitions diverge again, a genuinely paying
         -- customer whose plan_id still resolves to the default plan reports
         -- any_free = true, and the trait sync files them into whatever Loops
         -- segment keys on it -- free-to-paid campaigns targeting someone who
         -- already pays. The symptom is silent mis-segmentation that nobody
         -- notices, so keep this expression and the RPCs' clause in lockstep.
         --
         -- The subscription exclusion belongs INSIDE the per-workspace
         -- expression bool_or aggregates, never in the WHERE clause: a WHERE
         -- would drop the user's paid workspaces from the row set entirely and
         -- silently deflate workspace_count, which must stay a count of ALL
         -- owned workspaces regardless of plan. A correlated `not exists` is
         -- used rather than a join partly to keep this byte-identical to the
         -- clause the three event RPCs carry, and partly because it cannot
         -- affect count(ws.id) even if workspace_subscriptions ever stops being
         -- one row per workspace (today workspace_id is its primary key,
         -- 20260609120003).
         bool_or(
           coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
           and not exists (
             select 1 from workspace_subscriptions s
             where s.workspace_id = ws.id and s.status in ('trialing', 'active')
           )
         ),
         -- teste reverso em andamento: segmento proprio, nunca contado como pagante Pro
         coalesce(bool_or(ws.plan_source = 'trial'), false),
         max(ws.reverse_trial_ends_at) filter (where ws.plan_source = 'trial')
  from auth.users u
  join profiles p on p.id = u.id
  join workspace_members wm on wm.user_id = u.id and wm.role = 'owner'
  join workspaces ws on ws.id = wm.workspace_id
  left join loops_contacts lc on lc.user_id = u.id
  where p.marketing_opt_in = true
    and u.email is not null
    and u.email_confirmed_at is not null
    -- A contact deletion is OWED at the vendor for this person's previous
    -- address. Syncing traits now would overwrite synced_email and strand that
    -- address at Loops permanently -- see the block comment above this function.
    -- Written as a correlated `not exists` rather than folded into the `lc` left
    -- join below on purpose: for a never-synced user (no lc row), `lc.deleted_at
    -- is null` is TRUE and `lc.synced_email is distinct from u.email::text` is
    -- also TRUE (`is distinct from` is two-valued and never yields NULL), so
    -- `not (lc.deleted_at is null and ...)` evaluates to `not(TRUE and TRUE)` =
    -- FALSE -- which would silently drop everyone who has no loops_contacts row
    -- at all.
    and not exists (
      select 1 from loops_contacts lc2
      where lc2.user_id = u.id
        and lc2.deleted_at is null
        and lc2.synced_email is distinct from u.email::text
    )
  group by u.id, u.email, p.nome, u.email_confirmed_at, lc.synced_at
  -- The ordering IS the convergence mechanism: this RPC has no time window
  -- and no ledger exclusion, so without a rotating order the same first-200
  -- users by uuid would re-sync forever and everyone past #200 would never
  -- sync at all, silently. Never-synced users (lc.synced_at is null, thanks
  -- to loops_contacts.user_id being nullable-unique per Task 2) sort first,
  -- then the stalest previous sync, so each run advances the frontier.
  order by lc.synced_at asc nulls first, u.id
  limit 200
$$;
-- get_crisp_sync_candidates: corpo de 20260804000011 + segmento teste_sem_cartao e reverse_trial_ends_at.
drop function if exists public.get_crisp_sync_candidates();
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
  people_id            text,
  reverse_trial_ends_at text
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
      ws.reverse_trial_ends_at                as reverse_trial_ends_at,
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
      -- teste reverso (sem cartao): segmento proprio; 'trial' segue sendo o teste com cartao
      bool_or(m.plan_source = 'trial')                  as any_reverse_trial,
      max(m.reverse_trial_ends_at) filter (where m.plan_source = 'trial') as reverse_trial_ends_at,
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
      -- data (nao contador): so muda se o fim do teste mudar
      to_char(a.reverse_trial_ends_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as reverse_trial_ends_at,
      (
        select coalesce(array_agg(seg order by seg), array[]::text[])
        from unnest(
          array[case when a.papel = 'owner' then 'owner' else 'membro' end]
          || case when a.any_trial   then array['trial']        else array[]::text[] end
          || case when a.any_reverse_trial then array['teste_sem_cartao'] else array[]::text[] end
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
        coalesce(y.reverse_trial_ends_at, '')      || '|' ||
        coalesce(array_to_string(y.segments, ','), '')
      ) as fingerprint
    from payload y
  )
  select
    f.user_id, f.email, f.nome, f.phone, f.papel, f.plano, f.assinatura,
    f.plan_source, f.workspaces, f.workspace_count, f.clientes, f.cliente_desde,
    f.primary_workspace_id, f.segments, f.fingerprint, cc.synced_people_id,
    f.reverse_trial_ends_at
  from fingerprinted f
  left join crisp_contacts cc on cc.user_id = f.user_id
  -- A deletion is OWED, in either of two shapes -- mirroring
  -- record_crisp_contact's refusal exactly, or the RPC would refuse a candidate
  -- this query keeps offering every sweep:
  --
  -- (a) this person's OWN row still names a previous address;
  -- (b) ANY OTHER row -- including an ORPHAN whose user_id was nulled by the
  --     FK when the account was hard-deleted -- still owes a deletion for THIS
  --     address. synced_email is not unique, so two live rows can name the same
  --     address and a per-user predicate cannot see across them. The
  --     interleaving: invite-user hard-deletes a confirmed user and the address
  --     is re-invited as a new auth.users row; an overlapping run's deletion
  --     sweep erases the profile at that address while this run reports the new
  --     user as synced, whose fingerprint then suppresses re-sync indefinitely.
  --
  -- Written as a correlated `not exists` rather than folded into the left join
  -- above ON PURPOSE, and it must STAY that way: `is distinct from` is
  -- two-valued and never yields NULL, so for a never-synced user the folded
  -- form evaluates to `not (TRUE and TRUE)` = FALSE and silently drops everyone
  -- with no ledger row -- which on first deployment is every single user.
  where not exists (
    select 1 from crisp_contacts cc2
    where cc2.deleted_at is null
      and (
        (cc2.user_id = f.user_id and cc2.synced_email is distinct from f.email)
        or (cc2.user_id is distinct from f.user_id and cc2.synced_email = f.email)
      )
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
-- admin_list_workspaces v10: corpo de 20261127000001 + reverse_trial_ends_at/outcome e status teste_sem_cartao.
CREATE OR REPLACE FUNCTION admin_list_workspaces(
  p_search        text        DEFAULT NULL,
  p_plan_id       text        DEFAULT NULL,
  p_offset        int         DEFAULT 0,
  p_limit         int         DEFAULT 20,
  p_as_of         timestamptz DEFAULT NULL,
  p_status        text        DEFAULT NULL,
  p_has_overrides boolean     DEFAULT NULL,
  p_activity      text        DEFAULT NULL,
  p_created_since timestamptz DEFAULT NULL,
  p_sort          text        DEFAULT 'created_at',
  p_dir           text        DEFAULT 'desc'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH default_plan AS (
  SELECT id, name FROM plans WHERE is_default = true LIMIT 1
),
args AS (
  -- v9: p_plan_id, p_status and p_activity each take one value or a comma-separated list
  -- (OR within a filter, AND across filters). Blank entries are dropped; unknown status and
  -- activity values are ignored, so a list with no known value does not filter (the same
  -- "unknown means no filter" rule v5 had for a single value). Plan ids are not validated:
  -- an unknown id matches nothing, as before. NULL, '' and an all-blank list mean no filter.
  -- Readers write `= ANY((SELECT x FROM args)::text[])`: without the cast Postgres reads
  -- ANY(subquery) and compares text to text[].
  SELECT
    NULLIF(ARRAY(SELECT DISTINCT btrim(x) FROM unnest(string_to_array(p_plan_id, ',')) x
                  WHERE btrim(x) <> ''), '{}') AS plan_ids,
    NULLIF(ARRAY(SELECT DISTINCT btrim(x) FROM unnest(string_to_array(p_status, ',')) x
                  WHERE btrim(x) IN ('ativo', 'teste', 'pendente', 'cancelado', 'sem_assinatura',
                                     'teste_sem_cartao')),
           '{}') AS statuses,
    NULLIF(ARRAY(SELECT DISTINCT btrim(x) FROM unnest(string_to_array(p_activity, ',')) x
                  WHERE btrim(x) IN ('7d', '30d', 'dormente', 'nunca')), '{}') AS activities
),
flags AS (
  -- NULL-safe: p_sort may arrive as a literal NULL, and NULL here would make the CASEs below
  -- take their ELSE arm silently. IS NOT DISTINCT FROM keeps this a plain boolean.
  SELECT ((SELECT activities FROM args) IS NOT NULL
          OR p_sort IS NOT DISTINCT FROM 'last_activity_at') AS needs_full
),
base AS (
  SELECT b.*
    FROM (
      SELECT
        w.id,
        w.name,
        w.logo_url,
        w.created_at,
        w.created_by,
        (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
        (SELECT count(*) FROM clientes c WHERE c.conta_id = w.id)              AS client_count,
        COALESCE(pl.name, (SELECT name FROM default_plan))                     AS plan_name,
        w.plan_source,
        w.reverse_trial_ends_at,
        w.reverse_trial_outcome,
        EXISTS (
          SELECT 1 FROM workspace_plan_overrides o
           WHERE o.workspace_id = w.id
             AND (o.resource_overrides IS NOT NULL OR o.feature_overrides IS NOT NULL)
        ) AS has_overrides,
        s.status AS sub_status
        FROM workspaces w
        LEFT JOIN plans pl ON pl.id = w.plan_id
        -- At most one subscription row per workspace: the previous revision's LATERAL had no
        -- LIMIT either, so it relied on the same invariant. A plain join cannot multiply rows.
        LEFT JOIN workspace_subscriptions s ON s.workspace_id = w.id
       WHERE (p_search IS NULL
              OR w.name ILIKE '%' || p_search || '%'
              OR EXISTS (
                   SELECT 1
                     FROM workspace_members m
                     JOIN auth.users u ON u.id = m.user_id
                    WHERE m.workspace_id = w.id
                      AND m.role = 'owner'
                      AND u.email ILIKE '%' || p_search || '%'))
         AND ((SELECT plan_ids FROM args) IS NULL
              OR COALESCE(w.plan_id, (SELECT id FROM default_plan)) = ANY((SELECT plan_ids FROM args)::text[]))
         AND w.created_at <= COALESCE(p_as_of, now())
         AND (p_created_since IS NULL OR w.created_at >= p_created_since)
         -- One arm per group, ORed: sem_assinatura is an IS NULL check, so the groups cannot
         -- collapse into a single `s.status = ANY(...)`.
         AND ((SELECT statuses FROM args) IS NULL
              OR ('ativo'          = ANY((SELECT statuses FROM args)::text[]) AND s.status = 'active')
              OR ('teste'          = ANY((SELECT statuses FROM args)::text[]) AND s.status = 'trialing')
              OR ('pendente'       = ANY((SELECT statuses FROM args)::text[])
                  AND s.status IN ('past_due', 'unpaid', 'incomplete'))
              OR ('cancelado'      = ANY((SELECT statuses FROM args)::text[])
                  AND s.status IN ('canceled', 'incomplete_expired', 'paused'))
              -- Covers both "no row" (LEFT JOIN miss) and "row with NULL status".
              OR ('sem_assinatura' = ANY((SELECT statuses FROM args)::text[]) AND s.status IS NULL)
              -- v10: teste reverso em andamento (Pro sem cartao)
              OR ('teste_sem_cartao' = ANY((SELECT statuses FROM args)::text[]) AND w.plan_source = 'trial'))
    ) b
   -- has_overrides is a target-list expression, so it is filtered one level up rather than
   -- spelling the EXISTS out twice.
   WHERE (p_has_overrides IS NULL OR b.has_overrides = p_has_overrides)
),
prepage AS (
  -- Cheap ranking, used only when last_activity_at is not part of the ordering or the filters.
  SELECT b.id, row_number() OVER (
    ORDER BY
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'client_count' THEN b.client_count
                                                WHEN 'member_count' THEN b.member_count END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'client_count' THEN b.client_count
                                                 WHEN 'member_count' THEN b.member_count END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(b.name)
                                                WHEN 'plan' THEN lower(b.plan_name) END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(b.name)
                                                 WHEN 'plan' THEN lower(b.plan_name) END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'created_at' THEN b.created_at END) END ASC  NULLS FIRST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'created_at' THEN b.created_at END) END DESC NULLS LAST,
      b.created_at DESC,
      b.id ASC
  ) AS rn
  FROM base b
  WHERE NOT (SELECT needs_full FROM flags)
),
target_ids AS (
  SELECT COALESCE(
    CASE WHEN (SELECT needs_full FROM flags)
         THEN (SELECT array_agg(b.id) FROM base b)
         ELSE (SELECT array_agg(p.id) FROM prepage p
                WHERE p.rn > p_offset AND p.rn <= p_offset + p_limit)
    END, '{}'::uuid[]) AS ids
),
activity AS (
  SELECT a.workspace_id, a.last_activity_at
    FROM admin_workspace_last_activity((SELECT ids FROM target_ids)) a
),
filtered AS (
  SELECT b.*, la.last_activity_at
    FROM base b
    LEFT JOIN activity la ON la.workspace_id = b.id
   WHERE ((SELECT activities FROM args) IS NULL
          OR ('7d'       = ANY((SELECT activities FROM args)::text[])
              AND la.last_activity_at >= now() - interval '7 days')
          OR ('30d'      = ANY((SELECT activities FROM args)::text[])
              AND la.last_activity_at >= now() - interval '30 days')
          OR ('dormente' = ANY((SELECT activities FROM args)::text[])
              AND la.last_activity_at <  now() - interval '30 days')
          OR ('nunca'    = ANY((SELECT activities FROM args)::text[]) AND la.last_activity_at IS NULL))
),
page AS (
  SELECT f.*, row_number() OVER (
    ORDER BY
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'client_count' THEN f.client_count
                                                WHEN 'member_count' THEN f.member_count END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'client_count' THEN f.client_count
                                                 WHEN 'member_count' THEN f.member_count END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(f.name)
                                                WHEN 'plan' THEN lower(f.plan_name) END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(f.name)
                                                 WHEN 'plan' THEN lower(f.plan_name) END) END DESC NULLS LAST,
      -- NULLS FIRST on asc: "least active first" must surface never-active workspaces.
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'created_at'       THEN f.created_at
                                                WHEN 'last_activity_at' THEN f.last_activity_at END) END ASC  NULLS FIRST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'created_at'       THEN f.created_at
                                                 WHEN 'last_activity_at' THEN f.last_activity_at END) END DESC NULLS LAST,
      f.created_at DESC,
      f.id ASC
  ) AS rn
  FROM filtered f
)
SELECT jsonb_build_object(
  'total',                (SELECT count(*) FROM filtered),
  'total_members',        (SELECT COALESCE(sum(member_count), 0) FROM filtered),
  'total_clients',        (SELECT COALESCE(sum(client_count), 0) FROM filtered),
  'total_instagram_accounts',        (SELECT count(*)
                                        FROM instagram_accounts ia
                                        JOIN clientes c ON c.id = ia.client_id
                                       WHERE c.conta_id IN (SELECT id FROM filtered)),
  'total_instagram_accounts_active', (SELECT count(*)
                                        FROM instagram_accounts ia
                                        JOIN clientes c ON c.id = ia.client_id
                                       WHERE c.conta_id IN (SELECT id FROM filtered)
                                         AND ia.authorization_status = 'active'),
  'total_with_overrides', (SELECT count(*) FROM filtered WHERE has_overrides),
  'workspaces',           COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'id',               p.id,
                'name',             p.name,
                'logo_url',         p.logo_url,
                'created_at',       p.created_at,
                'last_activity_at', p.last_activity_at,
                'member_count',     p.member_count,
                'client_count',     p.client_count,
                'plan_name',        p.plan_name,
                'plan_source',      p.plan_source,
                'reverse_trial_ends_at', p.reverse_trial_ends_at,
                'reverse_trial_outcome', p.reverse_trial_outcome,
                'has_overrides',    p.has_overrides,
                'owner',            own.owner_json,
                'subscription',     sub.sub_json
              ) ORDER BY p.rn)
       -- The page window is applied BEFORE the LATERALs so the owner lookup and the
       -- subscription JSON are built only for the rows actually returned.
       FROM (SELECT * FROM page WHERE rn > p_offset AND rn <= p_offset + p_limit) p
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'name',             COALESCE(pr.nome, 'Unknown'),
           'email',            COALESCE(u.email, 'Unknown'),
           'telefone',         pr.telefone,
           'marketing_opt_in', COALESCE(pr.marketing_opt_in, false)
         ) AS owner_json
           FROM workspace_members m
           LEFT JOIN profiles pr ON pr.id = m.user_id
           LEFT JOIN auth.users u ON u.id = m.user_id
          WHERE m.workspace_id = p.id AND m.role = 'owner'
          ORDER BY (m.user_id = p.created_by) DESC, m.joined_at ASC, m.user_id ASC
          LIMIT 1
       ) own ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'provider',             s.provider,
           'status',               s.status,
           'plan_name',            sp.name,
           'billing_interval',     s.billing_interval,
           'amount_cents',         COALESCE(
                                     s.amount_cents,
                                     CASE WHEN s.billing_interval = 'year'
                                          THEN sp.price_brl_annual ELSE sp.price_brl END),
           'currency',             CASE
                                     WHEN s.amount_cents IS NOT NULL THEN s.currency
                                     WHEN (CASE WHEN s.billing_interval = 'year'
                                                THEN sp.price_brl_annual ELSE sp.price_brl END) IS NOT NULL
                                          THEN 'brl'
                                     ELSE NULL
                                   END,
           'interval',             COALESCE(s.amount_interval, s.billing_interval),
           'discount_label',       s.discount_label,
           'failed_payment_count', COALESCE(s.failed_payment_count, 0),
           'current_period_end',   s.current_period_end
         ) AS sub_json
           FROM workspace_subscriptions s
           LEFT JOIN plans sp ON sp.id = s.plan_id
          WHERE s.workspace_id = p.id
       ) sub ON true),
    '[]'::jsonb)
);
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.get_nurture_candidates(timestamptz)',
    'public.get_welcome_email_candidates()',
    'public.get_trial_reminder_candidates()',
    'public.get_loops_trait_candidates()',
    'public.get_crisp_sync_candidates()',
    'public.admin_list_workspaces(text,text,int,int,timestamptz,text,boolean,text,timestamptz,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- =============================================================
-- 9) Candidatos dos e-mails do teste reverso (lifecycle-email-cron, service role).
--    email_type:
--      reverse_trial_ending      : teste em andamento a ate 3 dias do fim; ref_at = ends_at
--      reverse_trial_ended       : outcome downgraded, antes da pausa do Hub; ref_at = ended_at
--      reverse_trial_hub_pausing : no dia anterior a pausa (ended_at + 7 dias), com link do
--                                  Hub ativo; ref_at = hub_pause_at
--    ended/hub_pausing so enquanto o workspace segue no Free (um webhook atrasado que
--    reescreveu para converted, ou qualquer plano pago/cortesia, tira o workspace).
--    Ledger (lifecycle_emails, unico por (email_type, workspace_id)), padrao do
--    trial_reminder: sem linha -> candidato; ref_at diferente -> candidato de novo com
--    attempts 0 (fim movido pelo Admin, nova queda depois de uma reversao); claim nao
--    entregue com mais de 1h e < 30 tentativas -> retentativa.
--    Destinatario: dono atual (created_by se ainda dono, senao o mais antigo), como
--    get_trial_reminder_candidates / _nurture_current_owner.
-- =============================================================
create or replace function public.get_reverse_trial_email_candidates(p_now timestamptz default now())
returns table (
  workspace_id uuid,
  user_id uuid,
  email text,
  nome text,
  workspace_name text,
  email_type text,
  ref_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  hub_pause_at timestamptz,
  plan_name text,
  price_cents int,
  attempts int
)
language sql
stable
security definer
set search_path = public
as $$
  with dflt as (
    select id from plans where is_default limit 1
  ),
  cand as (
    select w.id as workspace_id, 'reverse_trial_ending'::text as email_type,
           w.reverse_trial_ends_at as ref_at
      from workspaces w
     where w.plan_source = 'trial'
       and w.reverse_trial_ends_at > p_now
       and w.reverse_trial_ends_at <= p_now + interval '3 days'
    union all
    select w.id, 'reverse_trial_ended', w.reverse_trial_ended_at
      from workspaces w
     where w.reverse_trial_outcome = 'downgraded'
       and w.reverse_trial_ended_at is not null
       and p_now < w.reverse_trial_ended_at + interval '7 days'
       and w.plan_source is distinct from 'manual'
       and coalesce(w.plan_id, (select id from dflt)) = (select id from dflt)
    union all
    select w.id, 'reverse_trial_hub_pausing', w.reverse_trial_ended_at + interval '7 days'
      from workspaces w
     where w.reverse_trial_outcome = 'downgraded'
       and w.reverse_trial_ended_at is not null
       and p_now >= w.reverse_trial_ended_at + interval '6 days'
       and p_now <  w.reverse_trial_ended_at + interval '7 days'
       and w.plan_source is distinct from 'manual'
       and coalesce(w.plan_id, (select id from dflt)) = (select id from dflt)
       and exists (
         select 1 from client_hub_tokens t
          where t.conta_id = w.id and t.is_active and t.expires_at > p_now)
  )
  select w.id,
         o.user_id,
         u.email::text,
         p.nome,
         w.name,
         c.email_type,
         c.ref_at,
         w.reverse_trial_ends_at,
         w.reverse_trial_ended_at,
         case when w.reverse_trial_ended_at is not null
              then w.reverse_trial_ended_at + interval '7 days' end,
         coalesce(pl.name, w.reverse_trial_plan_id),
         pl.price_brl,
         case
           when le.id is null or le.ref_at is distinct from c.ref_at then 0
           else le.attempts
         end
    from cand c
    join workspaces w on w.id = c.workspace_id
    cross join lateral (select _nurture_current_owner(w.id) as user_id) o
    join auth.users u on u.id = o.user_id
    left join profiles p on p.id = o.user_id
    left join plans pl on pl.id = coalesce(w.reverse_trial_plan_id, 'pro')
    left join lifecycle_emails le
      on le.email_type = c.email_type and le.workspace_id = w.id
   where u.email is not null
     and (le.id is null
          or le.ref_at is distinct from c.ref_at
          or (le.delivered_at is null
              and le.sent_at <= p_now - interval '1 hour'
              and le.attempts < 30))
   order by c.ref_at asc, w.id asc
   limit 100
$$;

revoke all on function public.get_reverse_trial_email_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.get_reverse_trial_email_candidates(timestamptz) to service_role;
