\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Guard das colunas de cobrança/plano de workspaces e lockdown de
-- workspace_plan_overrides (migration 20261129000002).
--
-- Prova:
--   1. dono e admin autenticados NÃO mudam plan_id nem plan_source (42501 com a
--      mensagem do guard, não um 42501 de grant/RLS), nem as demais colunas
--      guardadas; o valor fica igual depois;
--   2. o mesmo ator ainda grava name (1 linha afetada), então a negação acima é
--      do guard e não da RLS filtrando a linha;
--   3. service_role muda o plano direto, grant_pagarme_plan (DEFINER, como o
--      webhook) muda o plano, e mark_trial_offer_seen() chamado pelo dono
--      autenticado ainda grava trial_offer_seen_at (DEFINER, auth.uid() setado);
--   4. authenticated não tem grant em workspace_plan_overrides e, mesmo com o
--      grant que o ACL padrão hospedado daria, a RLS recusa ler, alterar e inserir.
--
-- et_grant_hosted_parity exclui workspace_plan_overrides: o REVOKE dela é o que
-- está sob teste.

begin;
select et_grant_hosted_parity(array['workspace_plan_overrides']);
do $$
declare
  v_ws     uuid;
  v_ws2    uuid;
  v_owner  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_actor  uuid;
  v_rows   bigint;
  v_plan   text;
  v_src    text;
  v_seen   timestamptz;
  v_msg    text;
  v_state  text;
  v_n      int;
  v_col    text;
begin
  -- Nasce no 'max' só para caber dono + admin (o free tem 1 assento), depois
  -- desce para o free como o backend faria: o ataque é subir para 'max'.
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin);
  update workspaces set plan_id = 'free', plan_source = 'system' where id = v_ws;

  foreach v_actor in array array[v_owner, v_admin] loop
    -- 2. coluna comum: passa e afeta exatamente 1 linha.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update workspaces set name = 'ET guard renamed' where id = v_ws;
    get diagnostics v_rows = row_count;
    reset role;
    if v_rows <> 1 then
      raise exception 'name update by % must affect 1 row, affected %', v_actor, v_rows;
    end if;

    -- 1. plan_id e plan_source: 42501 do guard.
    foreach v_col in array array['plan_id', 'plan_source'] loop
      v_msg := null; v_state := null;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        if v_col = 'plan_id' then
          update workspaces set plan_id = 'max' where id = v_ws;
        else
          update workspaces set plan_source = 'manual' where id = v_ws;
        end if;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      end;
      reset role;
      if v_state is distinct from '42501' or v_msg is distinct from 'workspace_billing_columns_read_only' then
        raise exception '% update by % must raise 42501 workspace_billing_columns_read_only, got % %',
          v_col, v_actor, v_state, v_msg;
      end if;
    end loop;

    -- as demais colunas guardadas.
    foreach v_col in array array[
      'trial_offer_seen_at = now()',
      'storage_used_bytes = 12345',
      'storage_quota_bytes = 1',
      'demo_created_at = now()',
      'is_internal = true',
      'billing_currency = ''usd''',
      'billing_currency_locked_at = now()'
    ] loop
      v_msg := null; v_state := null;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        execute format('update public.workspaces set %s where id = $1', v_col) using v_ws;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      end;
      reset role;
      if v_state is distinct from '42501' or v_msg is distinct from 'workspace_billing_columns_read_only' then
        raise exception '"%" by % must raise the guard, got % %', v_col, v_actor, v_state, v_msg;
      end if;
    end loop;

    -- reescrever o mesmo valor (IS NOT DISTINCT) não é mudança: passa.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update workspaces set plan_id = 'free', plan_source = 'system', name = 'ET same plan' where id = v_ws;
    get diagnostics v_rows = row_count;
    reset role;
    if v_rows <> 1 then
      raise exception 'same-value plan write by % must pass, affected %', v_actor, v_rows;
    end if;
  end loop;

  select plan_id, plan_source into v_plan, v_src from workspaces where id = v_ws;
  if v_plan <> 'free' or v_src <> 'system' then
    raise exception 'plan changed despite the guard: % / %', v_plan, v_src;
  end if;

  -- anon: a policy de UPDATE já recusa (0 linhas ou permission denied em
  -- has_permission, que anon não executa); o guard é a segunda trava. Aqui
  -- basta que o plano não mude.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    update workspaces set plan_id = 'max' where id = v_ws;
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  if (select plan_id from workspaces where id = v_ws) <> 'free' then
    raise exception 'anon changed plan_id';
  end if;

  -- 3a. mark_trial_offer_seen() pelo dono autenticado (DEFINER) grava.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform mark_trial_offer_seen();
  reset role;
  select trial_offer_seen_at into v_seen from workspaces where id = v_ws;
  if v_seen is null then
    raise exception 'mark_trial_offer_seen() by the owner must still stamp trial_offer_seen_at';
  end if;

  -- 3b. grant_pagarme_plan (DEFINER, chamada pelo webhook como service_role).
  insert into workspace_subscriptions
    (workspace_id, provider, pagarme_customer_id, pagarme_subscription_id, status)
    values (v_ws, 'pagarme', 'cus_et_guard', 'sub_et_guard', 'active');
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  select grant_pagarme_plan(v_ws, 'max', 'sub_et_guard', 'active') into v_n;
  reset role;
  select plan_id, plan_source into v_plan, v_src from workspaces where id = v_ws;
  if v_n <> 1 or v_plan <> 'max' or v_src <> 'pagarme' then
    raise exception 'grant_pagarme_plan must change the plan: n=% % / %', v_n, v_plan, v_src;
  end if;

  -- 3c. service_role direto (platform-admin, stripe-webhook via plan-writer).
  set local role service_role;
  update workspaces set plan_id = 'free', plan_source = 'manual', storage_used_bytes = 0
   where id = v_ws;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 or (select plan_id from workspaces where id = v_ws) <> 'free' then
    raise exception 'service_role must change the plan directly, affected %', v_rows;
  end if;

  -- 4. workspace_plan_overrides: authenticated não insere (sem grant).
  v_state := null;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into workspace_plan_overrides (workspace_id, plan_id, feature_overrides)
      values (v_ws, 'max', '{"feature_mcp": true}'::jsonb);
  exception when insufficient_privilege then
    v_state := '42501';
  end;
  reset role;
  if v_state is distinct from '42501' then
    raise exception 'authenticated must not insert into workspace_plan_overrides';
  end if;
  if exists (select 1 from workspace_plan_overrides where workspace_id = v_ws) then
    raise exception 'override row was written';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.workspace_plan_overrides'::regclass) then
    raise exception 'workspace_plan_overrides must have RLS enabled';
  end if;
  if has_table_privilege('authenticated', 'public.workspace_plan_overrides', 'INSERT')
     or has_table_privilege('anon', 'public.workspace_plan_overrides', 'INSERT') then
    raise exception 'anon/authenticated must not hold INSERT on workspace_plan_overrides';
  end if;

  -- 4b. Mesmo que um ACL padrão devolva o grant (como o do Supabase hospedado
  -- faz em tabela nova), a RLS sem policy segura: insert recusado e leitura
  -- vazia, inclusive da linha que a service role gravou.
  v_ws2 := et_make_workspace('free');
  insert into workspace_plan_overrides (workspace_id, plan_id) values (v_ws, 'free');
  grant all on table public.workspace_plan_overrides to anon, authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from workspace_plan_overrides;
  update workspace_plan_overrides set feature_overrides = '{"feature_mcp": true}'::jsonb
   where workspace_id = v_ws;
  get diagnostics v_rows = row_count;
  v_state := null;
  begin
    insert into workspace_plan_overrides (workspace_id, plan_id, feature_overrides)
      values (v_ws2, 'max', '{"feature_mcp": true}'::jsonb);
  exception when insufficient_privilege then
    v_state := '42501';
  end;
  reset role;
  if v_n <> 0 then
    raise exception 'authenticated read % override rows despite RLS', v_n;
  end if;
  if v_rows <> 0 then
    raise exception 'authenticated updated % override rows despite RLS', v_rows;
  end if;
  if v_state is distinct from '42501' then
    raise exception 'authenticated insert into workspace_plan_overrides must be refused by RLS';
  end if;
  if effective_plan_feature(v_ws2, 'feature_mcp') then
    raise exception 'override granted feature_mcp';
  end if;

  raise notice 'workspace billing column guard: ok';
end $$;
rollback;
