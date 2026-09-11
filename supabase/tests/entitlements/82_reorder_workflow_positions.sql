\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- reorder_workflow_positions: suite da migration
--   20260917000001_reorder_workflow_positions_rpc.sql
-- Espelha 71_board_ordem.sql: impersonacao de `authenticated`, lock em ordem
-- estavel + count(*) all-or-nothing, e o triplo has_function_privilege.

-- 0. sem workspace ativo -> not_authenticated
begin;
do $$
declare v_no_user uuid := gen_random_uuid(); v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_no_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_workflow_positions(array[1]::bigint[], array[0]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'not_authenticated', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'caller sem workspace ativo deve levantar not_authenticated';
  execute 'reset role';
  raise notice 'PASS 82.0 not_authenticated';
end $$;
rollback;

-- 1. happy path: reordena tres fluxos da propria conta em uma chamada
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid(); v_cli bigint;
  v_a bigint; v_b bigint; v_c bigint; v_pa int; v_pb int; v_pc int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user, v_ws, v_cli, 'A', 'ativo', 0) returning id into v_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user, v_ws, v_cli, 'B', 'ativo', 1) returning id into v_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user, v_ws, v_cli, 'C', 'ativo', 2) returning id into v_c;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform reorder_workflow_positions(array[v_c, v_a, v_b], array[0, 1, 2]::integer[]);
  execute 'reset role';

  select position into v_pa from workflows where id = v_a;
  select position into v_pb from workflows where id = v_b;
  select position into v_pc from workflows where id = v_c;
  assert v_pc = 0 and v_pa = 1 and v_pb = 2,
    format('esperado C=0 A=1 B=2, obtido A=%s B=%s C=%s', v_pa, v_pb, v_pc);
  raise notice 'PASS 82.1 happy path';
end $$;
rollback;

-- 2. all-or-nothing entre contas: um fluxo alheio no lote -> workflow_not_found e nada muda
begin;
do $$
declare
  v_ws uuid; v_ws_other uuid; v_user uuid := gen_random_uuid(); v_user_o uuid := gen_random_uuid();
  v_cli bigint; v_cli_o bigint; v_mine bigint; v_theirs bigint; v_raised boolean := false; v_pos int;
begin
  v_ws := et_make_workspace('pro');
  v_ws_other := et_make_workspace('pro');
  insert into auth.users (id) values (v_user), (v_user_o);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner'), (v_user_o, v_ws_other, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  update profiles set conta_id = v_ws_other, active_workspace_id = v_ws_other where id = v_user_o;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user_o, v_ws_other, 'O', 'O', '#000') returning id into v_cli_o;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user, v_ws, v_cli, 'MINE', 'ativo', 5) returning id into v_mine;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user_o, v_ws_other, v_cli_o, 'THEIRS', 'ativo', 5) returning id into v_theirs;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_workflow_positions(array[v_mine, v_theirs], array[0, 1]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'lote com fluxo de outra conta deve levantar workflow_not_found';
  select position into v_pos from workflows where id = v_mine;
  assert v_pos = 5, format('fluxo proprio deveria ficar intacto (5), obtido %s', v_pos);
  raise notice 'PASS 82.2 all-or-nothing entre contas';
end $$;
rollback;

-- 3. argumentos invalidos: arrays de tamanhos diferentes
begin;
do $$
declare v_ws uuid; v_user uuid := gen_random_uuid(); v_raised boolean := false;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_workflow_positions(array[1, 2]::bigint[], array[0]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'arrays de tamanhos diferentes devem levantar invalid_arguments';
  raise notice 'PASS 82.3 invalid_arguments';
end $$;
rollback;

-- 4. ACL: anon nao executa; authenticated e service_role executam
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.reorder_workflow_positions(bigint[], integer[])', 'execute'),
    'anon nao pode executar reorder_workflow_positions';
  assert has_function_privilege('authenticated', 'public.reorder_workflow_positions(bigint[], integer[])', 'execute'),
    'authenticated deve executar reorder_workflow_positions';
  assert has_function_privilege('service_role', 'public.reorder_workflow_positions(bigint[], integer[])', 'execute'),
    'service_role deve executar reorder_workflow_positions';
  raise notice 'PASS 82.4 ACL';
end $$;
rollback;

-- 5. argumentos invalidos: NULL dentro de p_positions
begin;
do $$
declare v_ws uuid; v_user uuid := gen_random_uuid(); v_raised boolean := false;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_workflow_positions(array[1]::bigint[], array[null]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'NULL em p_positions deve levantar invalid_arguments';
  raise notice 'PASS 82.5 invalid_arguments (NULL em p_positions)';
end $$;
rollback;
