\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- reorder_fluxos_board (migration 20260919000008). Cobre:
-- 92.0 happy path misto: fluxos e processos renumerados numa chamada
-- 92.1 all-or-nothing entre contas
-- 92.2 argumentos invalidos (tamanhos diferentes, tudo vazio)
-- 92.3 ACL e permissao por papel; revisao do processo intocada
-- 92.4 duplicatas: id repetido e posicao repetida entre os dois arrays

create or replace function pg_temp.et_rb_env(
  out ws uuid, out usr uuid, out cli bigint, out wa bigint, out wb bigint,
  out pa bigint, out pb bigint, out proca bigint, out procb bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position) values (usr, ws, cli, 'A', 'ativo', 0) returning id into wa;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position) values (usr, ws, cli, 'B', 'ativo', 1) returning id into wb;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (ws, cli, 'P1') returning id into pa;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (ws, cli, 'P2') returning id into pb;
  insert into post_processes (conta_id, post_id, assinatura, board_position) values (ws, pa, '0|Copy|padrao', 2) returning id into proca;
  insert into post_processes (conta_id, post_id, assinatura, board_position) values (ws, pb, '0|Copy|padrao', 3) returning id into procb;
end $$;

-- 92.0
begin;
do $$
declare e record; v int;
begin
  select * into e from pg_temp.et_rb_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- nova ordem da coluna: procb, wa, proca, wb
  perform reorder_fluxos_board(array[e.wa, e.wb], array[1, 3]::integer[],
                               array[e.procb, e.proca], array[0, 2]::integer[]);
  execute 'reset role';
  select position into v from workflows where id = e.wa;      assert v = 1, format('wa=%s', v);
  select position into v from workflows where id = e.wb;      assert v = 3, format('wb=%s', v);
  select board_position into v from post_processes where id = e.proca; assert v = 2, format('proca=%s', v);
  select board_position into v from post_processes where id = e.procb; assert v = 0, format('procb=%s', v);
  raise notice 'PASS 92.0 renumeracao mista da coluna inteira';
end $$;
rollback;

-- 92.1
begin;
do $$
declare e record; g record; v_raised boolean := false; v int;
begin
  select * into e from pg_temp.et_rb_env();
  select * into g from pg_temp.et_rb_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_fluxos_board(array[e.wa, g.wa], array[0, 1]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'fluxo de outra conta no lote derruba tudo';
  select position into v from workflows where id = e.wa; assert v = 0, 'nada foi gravado';

  v_raised := false;
  begin
    perform reorder_fluxos_board('{}'::bigint[], '{}'::integer[], array[e.proca, g.proca], array[0, 1]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'processo de outra conta no lote derruba tudo';
  select board_position into v from post_processes where id = e.proca; assert v = 2, 'nada foi gravado';
  raise notice 'PASS 92.1 all-or-nothing entre contas';
end $$;
rollback;

-- 92.2
begin;
do $$
declare e record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rb_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_fluxos_board(array[e.wa, e.wb], array[0]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'arrays de tamanhos diferentes sao invalid_arguments';

  v_raised := false;
  begin
    perform reorder_fluxos_board('{}'::bigint[], '{}'::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'chamada sem nenhum id e invalid_arguments';
  raise notice 'PASS 92.2 argumentos invalidos';
end $$;
rollback;

-- 92.3
begin;
do $$
declare e record; v_ver uuid := gen_random_uuid(); v_role uuid; v_raised boolean := false; v int;
begin
  select * into e from pg_temp.et_rb_env();
  assert not has_function_privilege('anon', 'public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[])', 'execute'),
    'anon nao executa reorder_fluxos_board';
  assert has_function_privilege('authenticated', 'public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[])', 'execute'),
    'authenticated executa reorder_fluxos_board';

  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions) values (e.ws, 'ver', '{"entregas":"ver"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, e.ws, 'agent', v_role);
  update profiles set conta_id = e.ws, active_workspace_id = e.ws where id = v_ver;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ver, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_fluxos_board(array[e.wa], array[5]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'permission_denied', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'entregas=ver nao reordena';
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform reorder_fluxos_board('{}'::bigint[], '{}'::integer[], array[e.proca], array[9]::integer[]);
  execute 'reset role';
  select revisao into v from post_processes where id = e.proca;
  assert v = 1, format('reordenar nao incrementa revisao, obtido %s', v);
  raise notice 'PASS 92.3 ACL, permissao e revisao intocada';
end $$;
rollback;

-- 92.4
begin;
do $$
declare e record; v_raised boolean := false; v int;
begin
  select * into e from pg_temp.et_rb_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform reorder_fluxos_board(array[e.wa, e.wa], array[0, 1]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'id de fluxo repetido e invalid_arguments';

  v_raised := false;
  begin
    perform reorder_fluxos_board('{}'::bigint[], '{}'::integer[], array[e.proca, e.proca], array[0, 1]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'id de processo repetido e invalid_arguments';

  -- Posicao e um espaco de indices SO por coluna: o empate e checado sobre os
  -- dois arrays concatenados, nao dentro de cada um.
  v_raised := false;
  begin
    perform reorder_fluxos_board(array[e.wa], array[1]::integer[], array[e.proca], array[1]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'posicao repetida entre fluxo e processo e invalid_arguments';

  v_raised := false;
  begin
    perform reorder_fluxos_board(array[e.wa, e.wb], array[2, 2]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'posicao repetida dentro do mesmo array e invalid_arguments';

  -- Nulo em qualquer um dos quatro arrays cai no mesmo codigo, como no molde.
  v_raised := false;
  begin
    perform reorder_fluxos_board(array[e.wa, e.wb], array[0, null]::integer[], '{}'::bigint[], '{}'::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'posicao nula e invalid_arguments';
  execute 'reset role';

  select position into v from workflows where id = e.wa;      assert v = 0, 'nada foi gravado em wa';
  select position into v from workflows where id = e.wb;      assert v = 1, 'nada foi gravado em wb';
  select board_position into v from post_processes where id = e.proca; assert v = 2, 'nada foi gravado em proca';
  select board_position into v from post_processes where id = e.procb; assert v = 3, 'nada foi gravado em procb';

  -- Id de fluxo igual a id de processo NAO e duplicata: tabelas e sequences
  -- diferentes. Esparso tambem passa: densidade nao e exigida (Decisao 19).
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform reorder_fluxos_board(array[e.wa], array[0]::integer[], array[e.proca], array[7]::integer[]);
  execute 'reset role';
  select position into v from workflows where id = e.wa;      assert v = 0, 'coluna esparsa e aceita (fluxo)';
  select board_position into v from post_processes where id = e.proca; assert v = 7, 'coluna esparsa e aceita (processo)';
  raise notice 'PASS 92.4 duplicatas de id e de posicao';
end $$;
rollback;
