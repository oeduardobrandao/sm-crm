\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Moeda de cobrança do workspace (migration 20261205000001).
--
-- Prova:
--   1. dono autenticado NÃO muda billing_currency nem billing_currency_locked_at
--      (42501 workspace_billing_columns_read_only), mas ainda grava name;
--   2. cadastro com metadata market=us nasce 'usd'; sem market, 'brl'; convidado
--      com market=us não mexe no workspace que o recebe;
--   3. billing_currency_set muda a moeda enquanto destravada; depois de
--      billing_currency_lock devolve false e o valor fica; o lock devolve a
--      moeda vigente e mantém o primeiro locked_at numa segunda chamada;
--   4. authenticated e anon não executam as duas RPCs; service_role executa;
--   5. moeda fora de ('brl','usd') levanta erro; lock de workspace inexistente
--      levanta workspace_not_found;
--   6. workspace que já chegou a um provedor (linha de workspace_subscriptions com
--      stripe_customer_id, stripe_subscription_id, pagarme_customer_id ou
--      pagarme_subscription_id) não troca de moeda mesmo com locked_at nulo (o
--      backfill da migration trava os existentes pelo mesmo predicado); linha sem
--      nenhum id de provedor não trava.

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws     uuid;
  v_owner  uuid := gen_random_uuid();
  v_us     uuid := gen_random_uuid();
  v_br     uuid := gen_random_uuid();
  v_inv    uuid := gen_random_uuid();
  v_host   uuid := gen_random_uuid();
  v_us_ws  uuid;
  v_br_ws  uuid;
  v_host_ws uuid;
  v_cur    text;
  v_ok     boolean;
  v_rows   bigint;
  v_msg    text;
  v_state  text;
  v_col    text;
  v_lock1  timestamptz;
  v_lock2  timestamptz;
  v_fn     text;
  v_pcol   text;
  v_pws    uuid;
begin
  -- 1. guard.
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update workspaces set name = 'ET currency renamed' where id = v_ws;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'name update by owner must affect 1 row, affected %', v_rows;
  end if;

  foreach v_col in array array['billing_currency = ''usd''', 'billing_currency_locked_at = now()'] loop
    v_msg := null; v_state := null;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      execute format('update public.workspaces set %s where id = $1', v_col) using v_ws;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    end;
    reset role;
    if v_state is distinct from '42501' or v_msg is distinct from 'workspace_billing_columns_read_only' then
      raise exception '"%" by owner must raise the guard, got % %', v_col, v_state, v_msg;
    end if;
  end loop;
  select billing_currency into v_cur from workspaces where id = v_ws;
  if v_cur <> 'brl' then
    raise exception 'billing_currency changed despite the guard: %', v_cur;
  end if;

  -- 2. cadastro por mercado.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_us, 'usd-signup@example.com', jsonb_build_object('empresa', 'US Co', 'market', 'us'));
  select conta_id into v_us_ws from profiles where id = v_us;
  select billing_currency into v_cur from workspaces where id = v_us_ws;
  if v_cur is distinct from 'usd' then
    raise exception 'market=us signup must create a usd workspace, got %', v_cur;
  end if;

  insert into auth.users (id, email, raw_user_meta_data)
    values (v_br, 'brl-signup@example.com', jsonb_build_object('empresa', 'BR Co'));
  select conta_id into v_br_ws from profiles where id = v_br;
  select billing_currency into v_cur from workspaces where id = v_br_ws;
  if v_cur is distinct from 'brl' then
    raise exception 'signup without market must stay brl, got %', v_cur;
  end if;

  -- convidado com market=us: o workspace anfitrião não muda.
  v_host_ws := et_make_workspace('free');
  insert into auth.users (id) values (v_host);
  insert into invites (conta_id, email, role, invited_by, status, expires_at)
    values (v_host_ws, 'usd-invitee@example.com', 'agent', v_host, 'pending', now() + interval '7 days');
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_inv, 'usd-invitee@example.com',
            jsonb_build_object('conta_id', v_host_ws::text, 'market', 'us'));
  if not exists (select 1 from profiles where id = v_inv and conta_id = v_host_ws) then
    raise exception 'invitee should have joined workspace %', v_host_ws;
  end if;
  select billing_currency into v_cur from workspaces where id = v_host_ws;
  if v_cur is distinct from 'brl' then
    raise exception 'invitee with market=us must not change the host workspace, got %', v_cur;
  end if;

  -- 3. set / lock (service_role).
  set local role service_role;
  select billing_currency_set(v_ws, 'usd') into v_ok;
  reset role;
  select billing_currency into v_cur from workspaces where id = v_ws;
  if v_ok is distinct from true or v_cur <> 'usd' then
    raise exception 'set on unlocked workspace must return true and set usd: % %', v_ok, v_cur;
  end if;

  set local role service_role;
  select billing_currency_lock(v_ws) into v_cur;
  reset role;
  if v_cur <> 'usd' then
    raise exception 'lock must return the current currency, got %', v_cur;
  end if;
  select billing_currency_locked_at into v_lock1 from workspaces where id = v_ws;
  if v_lock1 is null then
    raise exception 'lock must stamp billing_currency_locked_at';
  end if;

  -- now() é constante na transação: fixa um locked_at antigo para provar o COALESCE.
  update workspaces set billing_currency_locked_at = '2020-01-01T00:00:00Z' where id = v_ws;
  select billing_currency_locked_at into v_lock1 from workspaces where id = v_ws;
  set local role service_role;
  select billing_currency_lock(v_ws) into v_cur;
  select billing_currency_set(v_ws, 'brl') into v_ok;
  reset role;
  select billing_currency_locked_at, billing_currency into v_lock2, v_cur from workspaces where id = v_ws;
  if v_lock2 is distinct from v_lock1 then
    raise exception 'second lock must keep the first locked_at: % vs %', v_lock1, v_lock2;
  end if;
  if v_ok is distinct from false or v_cur <> 'usd' then
    raise exception 'set after lock must return false and keep usd: % %', v_ok, v_cur;
  end if;

  -- 4. EXECUTE só do service_role.
  foreach v_fn in array array[
    'public.billing_currency_lock(uuid)',
    'public.billing_currency_set(uuid, text)'
  ] loop
    if has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'anon/authenticated must not EXECUTE %', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'service_role must EXECUTE %', v_fn;
    end if;
  end loop;

  v_state := null;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform billing_currency_set(v_ws, 'brl');
  exception when insufficient_privilege then
    v_state := '42501';
  end;
  reset role;
  if v_state is distinct from '42501' then
    raise exception 'authenticated must not call billing_currency_set';
  end if;

  v_state := null;
  set local role authenticated;
  begin
    perform billing_currency_lock(v_ws);
  exception when insufficient_privilege then
    v_state := '42501';
  end;
  reset role;
  if v_state is distinct from '42501' then
    raise exception 'authenticated must not call billing_currency_lock';
  end if;

  -- 5. entradas inválidas.
  v_msg := null;
  begin
    perform billing_currency_set(v_br_ws, 'eur');
  exception when others then
    get stacked diagnostics v_msg = message_text;
  end;
  if v_msg is distinct from 'invalid_billing_currency' then
    raise exception 'billing_currency_set with eur must raise invalid_billing_currency, got %', v_msg;
  end if;
  select billing_currency into v_cur from workspaces where id = v_br_ws;
  if v_cur <> 'brl' then
    raise exception 'invalid currency changed the value: %', v_cur;
  end if;

  v_msg := null;
  begin
    perform billing_currency_lock(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_msg = message_text;
  end;
  if v_msg is distinct from 'workspace_not_found' then
    raise exception 'lock of unknown workspace must raise workspace_not_found, got %', v_msg;
  end if;

  -- 6. linha de provedor trava a moeda, com ou sem locked_at.
  foreach v_pcol in array array[
    'stripe_customer_id', 'stripe_subscription_id', 'pagarme_customer_id', 'pagarme_subscription_id'
  ] loop
    v_pws := et_make_workspace('free');
    execute format(
      'insert into workspace_subscriptions (workspace_id, %I, status) values ($1, $2, ''active'')',
      v_pcol
    ) using v_pws, 'et_' || v_pcol || '_' || replace(v_pws::text, '-', '');
    select billing_currency_locked_at into v_lock1 from workspaces where id = v_pws;
    if v_lock1 is not null then
      raise exception 'fixture: % workspace must start unlocked', v_pcol;
    end if;
    set local role service_role;
    select billing_currency_set(v_pws, 'usd') into v_ok;
    reset role;
    select billing_currency into v_cur from workspaces where id = v_pws;
    if v_ok is distinct from false or v_cur <> 'brl' then
      raise exception 'set with a % row must return false and keep brl: % %', v_pcol, v_ok, v_cur;
    end if;
  end loop;

  -- linha sem id de provedor (só status): não trava.
  v_pws := et_make_workspace('free');
  insert into workspace_subscriptions (workspace_id, status) values (v_pws, 'canceled');
  set local role service_role;
  select billing_currency_set(v_pws, 'usd') into v_ok;
  reset role;
  select billing_currency into v_cur from workspaces where id = v_pws;
  if v_ok is distinct from true or v_cur <> 'usd' then
    raise exception 'set with a provider-less row must return true and set usd: % %', v_ok, v_cur;
  end if;

  raise notice 'usd billing currency: ok';
end $$;
rollback;
