\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Reparo da moeda do cadastro dos EUA (migration 20261206000001).
--
-- billing_market_apply() lê o market do próprio auth.users do chamador e, só para
-- market = 'us', dono do workspace ativo, sem trava e sem linha de provedor em
-- workspace_subscriptions, põe billing_currency = 'usd'. Devolve a moeda do
-- workspace ativo depois da chamada.
--
-- Prova:
--   1. dono com market=us cujo workspace ficou 'brl' (trigger falhou) volta 'usd';
--      a segunda chamada devolve 'usd' sem erro;
--   2. dono sem market fica 'brl';
--   3. dono com market=us e billing_currency_locked_at preenchido fica 'brl';
--   4. dono com market=us e linha de workspace_subscriptions com stripe_customer_id
--      fica 'brl';
--   5. membro convidado (conta_id nos metadados, papel agent) com market=us não
--      mexe no workspace anfitrião 'brl';
--   6. o workspace ativo vale sobre o conta_id: dono com market=us cujo
--      active_workspace_id aponta para um workspace onde é agent não muda nenhum
--      dos dois;
--   7. authenticated executa; anon e PUBLIC não.

begin;
select et_grant_hosted_parity();
do $$
declare
  v_us      uuid := gen_random_uuid();
  v_br      uuid := gen_random_uuid();
  v_lock    uuid := gen_random_uuid();
  v_prov    uuid := gen_random_uuid();
  v_inv     uuid := gen_random_uuid();
  v_host    uuid := gen_random_uuid();
  v_multi   uuid := gen_random_uuid();
  v_ws      uuid;
  v_ws2     uuid;
  v_host_ws uuid;
  v_ret     text;
  v_cur     text;
  v_state   text;
  v_fn      text := 'public.billing_market_apply()';
begin
  -- 1. dono dos EUA cujo trigger "falhou": workspace de volta a brl à mão.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_us, 'bma-us@example.com', jsonb_build_object('empresa', 'US Co', 'market', 'us'));
  select conta_id into v_ws from profiles where id = v_us;
  update workspaces set billing_currency = 'brl' where id = v_ws;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_us, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.billing_market_apply() into v_ret;
  reset role;
  select billing_currency into v_cur from workspaces where id = v_ws;
  if v_ret is distinct from 'usd' or v_cur is distinct from 'usd' then
    raise exception 'US owner must be repaired to usd: returned % row %', v_ret, v_cur;
  end if;

  set local role authenticated;
  select public.billing_market_apply() into v_ret;
  reset role;
  select billing_currency into v_cur from workspaces where id = v_ws;
  if v_ret is distinct from 'usd' or v_cur is distinct from 'usd' then
    raise exception 'second call must stay usd: returned % row %', v_ret, v_cur;
  end if;

  -- 2. dono sem market.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_br, 'bma-br@example.com', jsonb_build_object('empresa', 'BR Co'));
  select conta_id into v_ws from profiles where id = v_br;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_br, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.billing_market_apply() into v_ret;
  reset role;
  select billing_currency into v_cur from workspaces where id = v_ws;
  if v_ret is distinct from 'brl' or v_cur is distinct from 'brl' then
    raise exception 'owner without market must stay brl: returned % row %', v_ret, v_cur;
  end if;

  -- 3. dono dos EUA com workspace travado.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_lock, 'bma-lock@example.com', jsonb_build_object('empresa', 'Lock Co', 'market', 'us'));
  select conta_id into v_ws from profiles where id = v_lock;
  update workspaces
     set billing_currency = 'brl', billing_currency_locked_at = now()
   where id = v_ws;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_lock, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.billing_market_apply() into v_ret;
  reset role;
  select billing_currency into v_cur from workspaces where id = v_ws;
  if v_ret is distinct from 'brl' or v_cur is distinct from 'brl' then
    raise exception 'locked workspace must stay brl: returned % row %', v_ret, v_cur;
  end if;

  -- 4. dono dos EUA com linha de provedor (sem trava).
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_prov, 'bma-prov@example.com', jsonb_build_object('empresa', 'Prov Co', 'market', 'us'));
  select conta_id into v_ws from profiles where id = v_prov;
  update workspaces
     set billing_currency = 'brl', billing_currency_locked_at = null
   where id = v_ws;
  insert into workspace_subscriptions (workspace_id, stripe_customer_id, status)
    values (v_ws, 'cus_et_bma_' || replace(v_ws::text, '-', ''), 'active');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_prov, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.billing_market_apply() into v_ret;
  reset role;
  select billing_currency into v_cur from workspaces where id = v_ws;
  if v_ret is distinct from 'brl' or v_cur is distinct from 'brl' then
    raise exception 'provider-backed workspace must stay brl: returned % row %', v_ret, v_cur;
  end if;

  -- 5. convidado com market=us entra num workspace brl.
  v_host_ws := et_make_workspace('free');
  insert into auth.users (id) values (v_host);
  insert into workspace_members (user_id, workspace_id, role) values (v_host, v_host_ws, 'owner');
  insert into invites (conta_id, email, role, invited_by, status, expires_at)
    values (v_host_ws, 'bma-invitee@example.com', 'agent', v_host, 'pending', now() + interval '7 days');
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_inv, 'bma-invitee@example.com',
            jsonb_build_object('conta_id', v_host_ws::text, 'market', 'us'));
  if not exists (select 1 from profiles where id = v_inv and conta_id = v_host_ws) then
    raise exception 'fixture: invitee should have joined workspace %', v_host_ws;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_inv, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.billing_market_apply() into v_ret;
  reset role;
  select billing_currency into v_cur from workspaces where id = v_host_ws;
  if v_ret is distinct from 'brl' or v_cur is distinct from 'brl' then
    raise exception 'invited member must not change the host workspace: returned % row %', v_ret, v_cur;
  end if;

  -- 6. workspace ativo onde o dono dos EUA é só agent.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_multi, 'bma-multi@example.com', jsonb_build_object('empresa', 'Multi Co', 'market', 'us'));
  select conta_id into v_ws from profiles where id = v_multi;
  update workspaces set billing_currency = 'brl' where id = v_ws;
  v_ws2 := et_make_workspace('free');
  insert into workspace_members (user_id, workspace_id, role) values (v_multi, v_ws2, 'agent');
  update profiles set active_workspace_id = v_ws2 where id = v_multi;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_multi, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.billing_market_apply() into v_ret;
  reset role;
  select billing_currency into v_cur from workspaces where id = v_ws2;
  if v_ret is distinct from 'brl' or v_cur is distinct from 'brl' then
    raise exception 'active workspace where caller is agent must stay brl: returned % row %', v_ret, v_cur;
  end if;
  select billing_currency into v_cur from workspaces where id = v_ws;
  if v_cur is distinct from 'brl' then
    raise exception 'non-active owned workspace must not change: %', v_cur;
  end if;

  -- 7. privilégios.
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'authenticated must EXECUTE %', v_fn;
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'anon must not EXECUTE %', v_fn;
  end if;
  if exists (
    select 1
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_fn::regprocedure
       and a.grantee = 0
       and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC must not EXECUTE %', v_fn;
  end if;

  v_state := null;
  set local role anon;
  begin
    perform public.billing_market_apply();
  exception when insufficient_privilege then
    v_state := '42501';
  end;
  reset role;
  if v_state is distinct from '42501' then
    raise exception 'anon must not call billing_market_apply';
  end if;

  raise notice 'billing_market_apply: ok';
end $$;
rollback;
