\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, clientes (20261115000002_acesso_por_cliente_b_clientes.sql):
-- the clientes policies, clientes_v, get_cliente_contexto, the import gate and
-- get_client_health_aggregates (INVOKER, inherits the clientes policy).
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md

begin;
select et_grant_hosted_parity();

-- count(*) of a query as p_user (authenticated)
create or replace function pg_temp.n_as(p_user uuid, p_sql text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
-- SQLSTATE raised by a statement as p_user, or NULL on success
create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    return sqlstate;
  end;
  execute 'reset role';
  return null;
end $f$;
-- rows affected by a statement as p_user
create or replace function pg_temp.rows_as(p_user uuid, p_sql text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  get diagnostics v = row_count;
  execute 'reset role';
  return v;
end $f$;
-- import_commit_row error message (called as service_role, like data-import)
create or replace function pg_temp.import_err(p_conta uuid, p_job bigint, p_key text, p_payload jsonb)
returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.import_commit_row(p_conta, p_job, p_key, 'cliente', p_payload);
  return null;
exception when others then
  return sqlerrm;
end $f$;

do $$
declare
  v_ws_a uuid := et_make_workspace('max');
  v_ws_b uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_c1 bigint; v_c2 bigint; v_c3 bigint; v_cb bigint;
  v_membro bigint; v_job_r bigint; v_job_t bigint;
  v_n bigint; v_expected bigint; v_err text; v_ids bigint[];
  v_row record;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@accc.test'), (v_todos, 'todos@accc.test'),
    (v_restr, 'restr@accc.test'), (v_other, 'other@accc.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws_a, 'owner'), (v_todos, v_ws_a, 'agent'),
    (v_restr, v_ws_a, 'agent'), (v_other, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_owner, v_todos, v_restr);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_other;

  -- service_role claims for the fixtures: enforce_cliente_foto_owner_admin
  -- refuses foto_url from a caller with no role.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws_a, 'C1', 'C1', '#111', 'ativo') returning id into v_c1;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws_a, 'C2', 'C2', '#222', 'ativo') returning id into v_c2;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status, foto_url) values (v_owner, v_ws_a, 'C3', 'C3', '#333', 'ativo', 'https://x.test/c3.png') returning id into v_c3;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_other, v_ws_b, 'CB', 'CB', '#444', 'ativo') returning id into v_cb;

  -- restricted to C1; C2 and C3 hidden
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws_a and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws_a, v_restr, v_c1);
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws_a, 'Restr', v_restr) returning id into v_membro;

  -- restricted_sees_assigned_in_view
  v_n := pg_temp.n_as(v_restr, format('select count(*) from clientes_v where id = %s', v_c1));
  assert v_n = 1, 'restricted_sees_assigned_in_view: ' || v_n;
  v_n := pg_temp.n_as(v_restr, 'select count(*) from clientes_v');
  assert v_n = 1, 'restricted sees only the assigned client in clientes_v: ' || v_n;
  -- restricted_hidden_not_in_view
  v_n := pg_temp.n_as(v_restr, format('select count(*) from clientes_v where id in (%s, %s)', v_c2, v_c3));
  assert v_n = 0, 'restricted_hidden_not_in_view: ' || v_n;
  -- restricted_hidden_not_in_table
  v_n := pg_temp.n_as(v_restr, format('select count(*) from clientes where id in (%s, %s)', v_c2, v_c3));
  assert v_n = 0, 'restricted_hidden_not_in_table: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from clientes where id = %s', v_c1));
  assert v_n = 1, 'restricted sees the assigned client in the table: ' || v_n;

  -- restricted_insert_cliente_denied (RLS, 42501; no valor_mensal so the
  -- financial guard cannot be the one refusing)
  v_err := pg_temp.err_as(v_restr, format(
    'insert into clientes (user_id, conta_id, nome, sigla, cor) values (%L, %L, ''RX'', ''RX'', ''#000'')',
    v_restr, v_ws_a));
  assert v_err = '42501', 'restricted_insert_cliente_denied: ' || coalesce(v_err, 'inserted');
  -- todos agent can still insert (the WITH CHECK is not always false)
  v_err := pg_temp.err_as(v_todos, format(
    'insert into clientes (user_id, conta_id, nome, sigla, cor) values (%L, %L, ''TX'', ''TX'', ''#000'')',
    v_todos, v_ws_a));
  assert v_err is null, 'todos_insert_cliente_allowed: ' || coalesce(v_err, '');

  -- restricted UPDATE / DELETE: hidden = 0 rows, assigned = 1 row
  v_n := pg_temp.rows_as(v_restr, format('update clientes set email = ''h@x.test'' where id = %s', v_c2));
  assert v_n = 0, 'restricted_update_hidden_zero_rows: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update clientes set email = ''a@x.test'' where id = %s', v_c1));
  assert v_n = 1, 'restricted_update_assigned_one_row: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from clientes where id = %s', v_c2));
  assert v_n = 0, 'restricted_delete_hidden_zero_rows: ' || v_n;
  -- UPDATE cannot move a row out of scope either (WITH CHECK)
  assert (select email from clientes where id = v_c2) is distinct from 'h@x.test', 'hidden client untouched';

  -- todos_sees_all
  v_n := pg_temp.n_as(v_todos, 'select count(*) from clientes_v');
  assert v_n = 4, 'todos_sees_all (view, C1..C3 + TX): ' || v_n;
  -- todos_counts_unchanged: exactly the superuser's conta-filtered counts
  select count(*) into v_expected from clientes where conta_id = v_ws_a;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from clientes');
  assert v_n = v_expected, format('todos_counts_unchanged (table): %s vs %s', v_n, v_expected);
  v_n := pg_temp.n_as(v_todos, 'select count(*) from clientes_v');
  assert v_n = v_expected, format('todos_counts_unchanged (view): %s vs %s', v_n, v_expected);
  v_n := pg_temp.n_as(v_owner, 'select count(*) from clientes_v');
  assert v_n = v_expected, format('owner sees all (view): %s vs %s', v_n, v_expected);
  -- tenant isolation unchanged
  v_n := pg_temp.n_as(v_other, 'select count(*) from clientes_v');
  assert v_n = 1, 'other workspace sees only its own client: ' || v_n;

  -- context_rpc_without_own_item_empty
  v_n := pg_temp.n_as(v_restr, format('select count(*) from get_cliente_contexto(%s)', v_c3));
  assert v_n = 0, 'context_rpc_without_own_item_empty: ' || v_n;
  -- context_rpc_with_own_post_returns_row
  insert into workflow_posts (conta_id, cliente_id, titulo, responsavel_id) values (v_ws_a, v_c3, 'P', v_membro);
  perform set_config('request.jwt.claims', json_build_object('sub', v_restr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_row from public.get_cliente_contexto(v_c3);
  reset role;
  assert v_row.id = v_c3 and v_row.nome = 'C3' and v_row.sigla = 'C3' and v_row.cor = '#333'
     and v_row.foto_url = 'https://x.test/c3.png',
    'context_rpc_with_own_post_returns_row: ' || coalesce(v_row::text, 'no row');
  -- assigned client: context too
  v_n := pg_temp.n_as(v_restr, format('select count(*) from get_cliente_contexto(%s)', v_c1));
  assert v_n = 1, 'context rpc: assigned client returns row: ' || v_n;
  -- context_does_not_add_to_view (nor to the table)
  v_n := pg_temp.n_as(v_restr, format('select count(*) from clientes_v where id = %s', v_c3));
  assert v_n = 0, 'context_does_not_add_to_view: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from clientes where id = %s', v_c3));
  assert v_n = 0, 'context_does_not_add_to_table: ' || v_n;
  -- foreign workspace client never returned, even to its owner's peers
  v_n := pg_temp.n_as(v_todos, format('select count(*) from get_cliente_contexto(%s)', v_cb));
  assert v_n = 0, 'context rpc: foreign client empty: ' || v_n;
  -- grants: anon cannot execute
  assert not has_function_privilege('anon', 'public.get_cliente_contexto(bigint)', 'execute'), 'context rpc not for anon';
  assert has_function_privilege('authenticated', 'public.get_cliente_contexto(bigint)', 'execute'), 'context rpc for authenticated';

  -- get_client_health_aggregates_only_assigned
  perform set_config('request.jwt.claims', json_build_object('sub', v_restr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select array_agg(client_id order by client_id) into v_ids from public.get_client_health_aggregates(28);
  reset role;
  assert v_ids = array[v_c1], 'get_client_health_aggregates_only_assigned: ' || coalesce(v_ids::text, 'null');
  perform set_config('request.jwt.claims', json_build_object('sub', v_todos, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.get_client_health_aggregates(28);
  reset role;
  select count(*) into v_expected from clientes where conta_id = v_ws_a and status = 'ativo';
  assert v_n = v_expected, format('health aggregates unchanged for todos: %s vs %s', v_n, v_expected);

  -- import_commit_row: restricted job creator cannot create (or merge into) a client
  insert into import_jobs (conta_id, created_by, source, total_rows) values (v_ws_a, v_restr, 'notion', 2) returning id into v_job_r;
  insert into import_jobs (conta_id, created_by, source, total_rows) values (v_ws_a, v_todos, 'notion', 2) returning id into v_job_t;
  v_err := pg_temp.import_err(v_ws_a, v_job_r, 'r1', '{"nome":"Novo"}'::jsonb);
  assert v_err = 'client_scope_restricted', 'import_restricted_create_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.import_err(v_ws_a, v_job_r, 'r2', jsonb_build_object('mergeClienteId', v_c1, 'email', 'm@x.test'));
  assert v_err = 'client_scope_restricted', 'import_restricted_merge_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.import_err(v_ws_a, v_job_t, 't1', '{"nome":"Novo"}'::jsonb);
  assert v_err is null, 'import_todos_create_allowed: ' || coalesce(v_err, '');
end $$;

-- initplan: my_client_scope_all() runs once per query, not per row
select set_config('request.jwt.claims', json_build_object('sub', (select wm.user_id from workspace_members wm join clientes c on c.conta_id = wm.workspace_id where c.nome = 'TX' and wm.role = 'agent' and wm.client_scope = 'todos' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_plan text := ''; r record;
begin
  -- As an initplan the call is the Output of a one-shot Result node; per row
  -- it would sit inside the scan's Filter instead.
  for r in execute 'explain (verbose, costs off) select * from clientes_v' loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  assert v_plan ~ 'Output: my_client_scope_all\(\)' and v_plan !~ 'Filter:[^\n]*my_client_scope_all',
    'clientes_v: my_client_scope_all is an initplan: ' || v_plan;
  v_plan := '';
  for r in execute 'explain (verbose, costs off) select id from clientes' loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  assert v_plan ~ 'Output: my_client_scope_all\(\)' and v_plan !~ 'Filter:[^\n]*my_client_scope_all',
    'clientes policy: my_client_scope_all is an initplan: ' || v_plan;
end $$;
reset role;

rollback;
\echo 99_acesso_por_cliente_clientes: ok
