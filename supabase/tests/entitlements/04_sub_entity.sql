\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_blocked boolean := false; i int;
begin
  -- free max_active_workflows_per_client = 1, scoped per cliente_id, only status='ativo'
  -- workflows.user_id has FK -> auth.users(id); insert a real user first
  insert into auth.users (id) values (v_uid);
  v_ws := et_make_workspace('free');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W1', 'ativo');
  -- an archived one must NOT count
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W-old', 'arquivado');
  begin
    insert into workflows (user_id, conta_id, cliente_id, titulo, status)
      values (v_uid, v_ws, v_cli, 'W2', 'ativo'); -- 2nd active for client => block
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'second active workflow for client must block';
  raise notice 'PASS 04_sub_entity';
end $$;
rollback;

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_n int;
begin
  v_ws := et_make_workspace('free'); -- max_clients = 2
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'A', 'A', '#000');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'B', 'B', '#000');
  select count(*) into v_n from clientes where conta_id = v_ws;
  assert v_n = 2, 'exactly two clients';
  raise notice 'PASS 04 lock-path smoke';
end $$;
rollback;
