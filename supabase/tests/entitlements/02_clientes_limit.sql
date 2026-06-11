\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_blocked boolean := false;
begin
  v_ws := et_make_workspace('free'); -- max_clients = 2
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C1', 'C1', '#000');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C2', 'C2', '#000');
  begin
    insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C3', 'C3', '#000'); -- 3rd, over limit
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_clients%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'third client insert should have been blocked';
  raise notice 'PASS 02_clientes_limit';
end $$;
rollback;

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); i int;
begin
  -- override raises the limit
  v_ws := et_make_workspace('free', '{"max_clients": 3}'::jsonb);
  for i in 1..3 loop
    insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C'||i, 'C'||i, '#000');
  end loop; -- 3 allowed by override
  -- max plan: unlimited
  v_ws := et_make_workspace('max');
  for i in 1..10 loop
    insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'M'||i, 'M'||i, '#000');
  end loop;
  raise notice 'PASS 02_clientes override/unlimited';
end $$;
rollback;
