\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- get_workflow_post_stats (20261002000010): one row per workflow with the
-- Entregas board's per-status counts. SECURITY INVOKER, so workflow_posts RLS
-- is what keeps another workspace's workflows out; asserted as `authenticated`
-- (the table owner bypasses RLS). anon has no EXECUTE.

begin;
select et_grant_hosted_parity();

do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_user uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_wf_a bigint; v_wf_a2 bigint; v_wf_b bigint;
  v_m1 bigint; v_m2 bigint;
  r record;
  v_rows int;
  v_denied boolean;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');

  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_user, v_ws_a, 'owner'), (v_user, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;
  insert into membros (user_id, conta_id, nome, cargo, tipo)
    values (v_user, v_ws_a, 'M1', 'x', 'clt') returning id into v_m1;
  insert into membros (user_id, conta_id, nome, cargo, tipo)
    values (v_user, v_ws_a, 'M2', 'x', 'clt') returning id into v_m2;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws_a, v_cli_a, 'WF-A', 'ativo') returning id into v_wf_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws_a, v_cli_a, 'WF-A2', 'ativo') returning id into v_wf_a2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws_b, v_cli_b, 'WF-B', 'ativo') returning id into v_wf_b;

  -- WF-A: 8 posts covering every counted status plus two that count only
  -- toward total. responsavel M2 twice, M1 once, two unassigned.
  insert into workflow_posts (workflow_id, conta_id, titulo, status, responsavel_id) values
    (v_wf_a, v_ws_a, 'p1', 'rascunho',          null),
    (v_wf_a, v_ws_a, 'p2', 'revisao_interna',   v_m2),
    (v_wf_a, v_ws_a, 'p3', 'enviado_cliente',   v_m2),
    (v_wf_a, v_ws_a, 'p4', 'aprovado_cliente',  v_m1),
    (v_wf_a, v_ws_a, 'p5', 'agendado',          null),
    (v_wf_a, v_ws_a, 'p6', 'postado',           null),
    (v_wf_a, v_ws_a, 'p7', 'falha_publicacao',  null),
    (v_wf_a, v_ws_a, 'p8', 'aprovado_interno',  null);
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (v_wf_b, v_ws_b, 'b1', 'aprovado_cliente');
  -- v_wf_a2 has no posts.

  -- ---- act as the user: member of BOTH workspaces, active = A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_rows
    from get_workflow_post_stats(array[v_wf_a, v_wf_a2, v_wf_b]);
  assert v_rows = 1, format(
    'get_workflow_post_stats: expected only WF-A (WF-A2 has no posts, WF-B is another workspace), got %s rows',
    v_rows);

  select * into r from get_workflow_post_stats(array[v_wf_a, v_wf_a2, v_wf_b]);
  assert r.workflow_id = v_wf_a, 'get_workflow_post_stats: wrong workflow returned';
  assert r.total = 8, format('total: expected 8, got %s', r.total);
  assert r.aprovado_cliente = 1, format('aprovado_cliente: expected 1, got %s', r.aprovado_cliente);
  assert r.cleared_cliente = 4, format(
    'cleared_cliente (aprovado_cliente+agendado+postado+falha_publicacao): expected 4, got %s',
    r.cleared_cliente);
  assert r.enviado_cliente = 1, format('enviado_cliente: expected 1, got %s', r.enviado_cliente);
  assert r.revisao_interna = 1, format('revisao_interna: expected 1, got %s', r.revisao_interna);
  assert r.responsavel_ids = array[least(v_m1, v_m2), greatest(v_m1, v_m2)], format(
    'responsavel_ids: expected distinct ascending [%s,%s], got %s',
    least(v_m1, v_m2), greatest(v_m1, v_m2), r.responsavel_ids);

  select count(*) into v_rows from get_workflow_post_stats(array[]::bigint[]);
  assert v_rows = 0, 'get_workflow_post_stats: empty id list returned rows';

  -- anon cannot execute it at all.
  execute 'reset role';
  execute 'set local role anon';
  v_denied := false;
  begin
    perform * from get_workflow_post_stats(array[v_wf_a]);
  exception when insufficient_privilege then v_denied := true;
  end;
  assert v_denied, 'get_workflow_post_stats: anon can execute it';
  execute 'reset role';

  raise notice 'PASS 99_workflow_post_stats';
end $$;
rollback;
