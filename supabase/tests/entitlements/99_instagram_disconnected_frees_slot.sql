\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Migration 20261122000001: a 'disconnected' instagram_accounts row no longer
-- holds a plan slot, and reconnecting it (UPDATE back to active) is checked
-- against the same limit. Free plan: max_instagram_accounts = 1.
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_ws uuid;
  v_a bigint; v_b bigint; v_c bigint;
  v_blocked boolean;
begin
  insert into auth.users (id) values (v_uid);
  -- free plan for the Instagram limit (1), with room for the three clientes
  v_ws := et_make_workspace('free', '{"max_clients": 10}'::jsonb);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'A', 'A', '#000') returning id into v_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'B', 'B', '#000') returning id into v_b;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_c;

  insert into instagram_accounts (client_id, instagram_user_id) values (v_a, 'ig-a');

  -- 1. active A holds the only slot: B is blocked
  v_blocked := false;
  begin insert into instagram_accounts (client_id, instagram_user_id) values (v_b, 'ig-b');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_instagram_accounts%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'B must block while A is active';

  -- 2. expired / revoked A still holds the slot
  update instagram_accounts set authorization_status = 'expired' where client_id = v_a;
  v_blocked := false;
  begin insert into instagram_accounts (client_id, instagram_user_id) values (v_b, 'ig-b');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'expired A must still count';

  -- expired -> active is a reconnect of a counted row: never blocked
  update instagram_accounts set authorization_status = 'active' where client_id = v_a;

  -- 3. disconnected A frees the slot: B connects
  update instagram_accounts set authorization_status = 'disconnected', encrypted_access_token = ''
   where client_id = v_a;
  insert into instagram_accounts (client_id, instagram_user_id) values (v_b, 'ig-b');

  -- 4. updating other columns of the disconnected row is not a reconnect
  update instagram_accounts set username = 'still-disconnected' where client_id = v_a;
  update instagram_accounts set authorization_status = 'disconnected' where client_id = v_a;

  -- 5. reconnecting A while B holds the slot is blocked
  v_blocked := false;
  begin update instagram_accounts set authorization_status = 'active' where client_id = v_a;
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_instagram_accounts%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'reconnecting A must block while B holds the only slot';
  assert (select authorization_status from instagram_accounts where client_id = v_a) = 'disconnected',
    'blocked reconnect must leave A disconnected';

  -- a third client is blocked too (A does not count, B does)
  v_blocked := false;
  begin insert into instagram_accounts (client_id, instagram_user_id) values (v_c, 'ig-c');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'C must block while B is active';

  -- 6. once B disconnects, A reconnects
  update instagram_accounts set authorization_status = 'disconnected' where client_id = v_b;
  update instagram_accounts set authorization_status = 'active' where client_id = v_a;

  -- 7. a higher limit allows the reconnect alongside another active account
  update workspace_plan_overrides
     set resource_overrides = resource_overrides || '{"max_instagram_accounts": 2}'::jsonb
   where workspace_id = v_ws;
  update instagram_accounts set authorization_status = 'active' where client_id = v_b;

  raise notice 'PASS 99_instagram_disconnected_frees_slot';
end $$;
rollback;
