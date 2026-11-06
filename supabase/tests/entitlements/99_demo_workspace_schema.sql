\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Conta demo criada pelo Admin (migration 20261030000001_demo_workspace_schema.sql):
--   * workspaces.plan_source aceita 'demo'
--   * workspaces.demo_created_at / demo_created_by (marcador da conta demo)
--   * grant_pagarme_plan: uma conta demo recebe o plano pago quando a assinatura Pagar.me esta
--     em vigor (active/trialing), e continua demo quando a assinatura nao esta em vigor
--   * admin_list_workspaces devolve 'plan_source' por workspace
-- Cada caso roda no proprio begin/rollback para uma falha cedo nao mascarar as outras.

-- 99d-1: plan_source = 'demo' e aceito; valor invalido continua barrado pelo check.
begin;
do $$
declare
  v_ws uuid;
  v_src text;
  v_failed boolean := false;
begin
  v_ws := et_make_workspace('free');
  update public.workspaces set plan_source = 'demo' where id = v_ws;
  select plan_source into v_src from public.workspaces where id = v_ws;
  if v_src is distinct from 'demo' then
    raise exception '99d-1: plan_source demo nao gravado: %', v_src;
  end if;

  begin
    update public.workspaces set plan_source = 'bogus' where id = v_ws;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception '99d-1: plan_source bogus deveria violar o check';
  end if;

  -- colunas do marcador existem e sao anulaveis
  update public.workspaces set demo_created_at = now(), demo_created_by = null where id = v_ws;
  raise notice 'PASS 99d-1';
end $$;
rollback;

-- 99d-2: demo + assinatura pagarme active: grava o plano, retorna 1, plan_source vira pagarme,
-- demo_created_at nao muda.
begin;
do $$
declare
  v_ws uuid;
  v_n int;
  v_plan text;
  v_src text;
  v_marker timestamptz := '2026-01-02 03:04:05+00';
  v_after timestamptz;
begin
  v_ws := et_make_workspace('free');
  update public.workspaces set plan_source = 'demo', demo_created_at = v_marker where id = v_ws;
  insert into public.workspace_subscriptions
    (workspace_id, provider, pagarme_customer_id, pagarme_subscription_id, status)
    values (v_ws, 'pagarme', 'cus_99d2', 'sub_99d2', 'active');

  select public.grant_pagarme_plan(v_ws, 'max', 'sub_99d2', 'active') into v_n;
  if v_n <> 1 then raise exception '99d-2: esperava 1 linha, veio %', v_n; end if;
  select plan_id, plan_source, demo_created_at into v_plan, v_src, v_after
    from public.workspaces where id = v_ws;
  if v_plan <> 'max' or v_src <> 'pagarme' then
    raise exception '99d-2: plano/origem errados: % / %', v_plan, v_src;
  end if;
  if v_after is distinct from v_marker then
    raise exception '99d-2: demo_created_at mudou: %', v_after;
  end if;
  raise notice 'PASS 99d-2';
end $$;
rollback;

-- 99d-2b: demo + assinatura trialing tambem converte.
begin;
do $$
declare
  v_ws uuid;
  v_n int;
  v_src text;
begin
  v_ws := et_make_workspace('free');
  update public.workspaces set plan_source = 'demo' where id = v_ws;
  insert into public.workspace_subscriptions
    (workspace_id, provider, pagarme_customer_id, pagarme_subscription_id, status)
    values (v_ws, 'pagarme', 'cus_99d2b', 'sub_99d2b', 'trialing');
  select public.grant_pagarme_plan(v_ws, 'max', 'sub_99d2b', 'trialing') into v_n;
  select plan_source into v_src from public.workspaces where id = v_ws;
  if v_n <> 1 or v_src <> 'pagarme' then
    raise exception '99d-2b: esperava 1/pagarme, veio %/%', v_n, v_src;
  end if;
  raise notice 'PASS 99d-2b';
end $$;
rollback;

-- 99d-3: demo + assinatura canceled: retorna 0 e a conta segue demo no mesmo plano.
begin;
do $$
declare
  v_ws uuid;
  v_n int;
  v_plan text;
  v_src text;
begin
  v_ws := et_make_workspace('free');
  update public.workspaces set plan_source = 'demo' where id = v_ws;
  insert into public.workspace_subscriptions
    (workspace_id, provider, pagarme_customer_id, pagarme_subscription_id, status)
    values (v_ws, 'pagarme', 'cus_99d3', 'sub_99d3', 'canceled');

  select public.grant_pagarme_plan(v_ws, 'max', 'sub_99d3', 'canceled') into v_n;
  if v_n <> 0 then raise exception '99d-3: esperava 0 linhas, veio %', v_n; end if;
  select plan_id, plan_source into v_plan, v_src from public.workspaces where id = v_ws;
  if v_plan <> 'free' or v_src <> 'demo' then
    raise exception '99d-3: conta demo foi alterada: % / %', v_plan, v_src;
  end if;
  raise notice 'PASS 99d-3';
end $$;
rollback;

-- 99d-4: regressao: manual continua retornando 0 mesmo com assinatura active.
begin;
do $$
declare
  v_ws uuid;
  v_n int;
  v_plan text;
begin
  v_ws := et_make_workspace('free'); -- plan_source = 'manual'
  insert into public.workspace_subscriptions
    (workspace_id, provider, pagarme_customer_id, pagarme_subscription_id, status)
    values (v_ws, 'pagarme', 'cus_99d4', 'sub_99d4', 'active');

  select public.grant_pagarme_plan(v_ws, 'max', 'sub_99d4', 'active') into v_n;
  if v_n <> 0 then raise exception '99d-4: manual esperava 0 linhas, veio %', v_n; end if;
  select plan_id into v_plan from public.workspaces where id = v_ws;
  if v_plan <> 'free' then raise exception '99d-4: comp manual sobrescrito: %', v_plan; end if;
  raise notice 'PASS 99d-4';
end $$;
rollback;

-- 99d-5: admin_list_workspaces expoe plan_source por workspace.
begin;
do $$
declare
  v_ws uuid;
  v jsonb;
begin
  v_ws := et_make_workspace('free');
  update public.workspaces set plan_source = 'demo', name = 'ET demo list 99d5' where id = v_ws;

  execute 'set local role service_role';
  v := admin_list_workspaces(p_search := 'ET demo list 99d5');
  if (v -> 'workspaces' -> 0 ->> 'plan_source') is distinct from 'demo' then
    raise exception '99d-5: plan_source ausente ou errado: %', v -> 'workspaces' -> 0;
  end if;
  raise notice 'PASS 99d-5';
end $$;
rollback;
