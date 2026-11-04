\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, schema (20261115000001_acesso_por_cliente_a_schema.sql):
-- workspace_members.client_scope / client_scope_rev, workspace_member_clientes,
-- the predicate can_access_cliente (core + wrapper), my_client_scope_all,
-- my_membro_ids, can_see_cliente_context, the owner-only RPC
-- set_member_client_scope, the promote-to-owner trigger, plans.feature_acesso_por_cliente
-- and notifications.cliente_id with its backfill.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md

begin;
-- workspace_member_clientes is excluded: its grants (SELECT only for
-- authenticated) are under test, and the helper would grant ALL on it.
select et_grant_hosted_parity(array['workspace_member_clientes']);

-- can_access_cliente(p_cliente) as p_user (authenticated)
create or replace function pg_temp.cac(p_user uuid, p_cliente bigint) returns boolean language plpgsql as $f$
declare v boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.can_access_cliente(p_cliente);
  execute 'reset role';
  return v;
end $f$;
-- my_client_scope_all() as p_user
create or replace function pg_temp.scope_all(p_user uuid) returns boolean language plpgsql as $f$
declare v boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.my_client_scope_all();
  execute 'reset role';
  return v;
end $f$;
-- can_see_cliente_context(p_cliente) as p_user
create or replace function pg_temp.ctx(p_user uuid, p_cliente bigint) returns boolean language plpgsql as $f$
declare v boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.can_see_cliente_context(p_cliente);
  execute 'reset role';
  return v;
end $f$;
-- my_membro_ids() as p_user
create or replace function pg_temp.membro_ids(p_user uuid) returns bigint[] language plpgsql as $f$
declare v bigint[];
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.my_membro_ids();
  execute 'reset role';
  return v;
end $f$;
-- workspace_member_clientes rows p_user can select
create or replace function pg_temp.wmc_vistos(p_user uuid) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v from public.workspace_member_clientes;
  execute 'reset role';
  return v;
end $f$;
-- error message set_member_client_scope raises, or NULL on success
create or replace function pg_temp.rpc_err(p_actor uuid, p_ws uuid, p_user uuid, p_scope text, p_ids bigint[])
returns text language plpgsql as $f$
begin
  perform public.set_member_client_scope(p_actor, p_ws, p_user, p_scope, p_ids);
  return null;
exception when others then
  return sqlerrm;
end $f$;

do $$
declare
  v_ws_a uuid := et_make_workspace('max');
  v_ws_b uuid := et_make_workspace('max');
  v_owner  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_todos  uuid := gen_random_uuid();
  v_restr  uuid := gen_random_uuid();
  v_restr0 uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_nows   uuid := gen_random_uuid();
  v_c1 bigint; v_c2 bigint; v_c3 bigint; v_cb bigint;
  v_wf bigint; v_post bigint; v_post_b bigint; v_membro bigint;
  v_n bigint; v_rev bigint; v_scope text; v_res jsonb; v_meta jsonb; v_err text;
  v_audit_before bigint;
  v_notif_post uuid; v_notif_wf uuid; v_notif_bad uuid; v_notif_foreign uuid;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@acc.test'), (v_admin, 'admin@acc.test'), (v_todos, 'todos@acc.test'),
    (v_restr, 'restr@acc.test'), (v_restr0, 'restr0@acc.test'), (v_other, 'other@acc.test'),
    (v_nows, 'nows@acc.test');
  -- Signup auto-provisions a workspace owned by each new user; v_nows must end
  -- with no membership at all (get_my_conta_id() resolves NULL).
  delete from workspace_members where user_id = v_nows;

  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws_a, 'owner'), (v_admin, v_ws_a, 'admin'), (v_todos, v_ws_a, 'agent'),
    (v_restr, v_ws_a, 'agent'), (v_restr0, v_ws_a, 'agent'), (v_other, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_owner, v_admin, v_todos, v_restr, v_restr0);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_other;

  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_owner, v_ws_a, 'C1', 'C1', '#000') returning id into v_c1;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_owner, v_ws_a, 'C2', 'C2', '#000') returning id into v_c2;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_owner, v_ws_a, 'C3', 'C3', '#000') returning id into v_c3;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_other, v_ws_b, 'CB', 'CB', '#000') returning id into v_cb;

  -- defaults
  select client_scope, client_scope_rev into v_scope, v_rev from workspace_members where user_id = v_todos and workspace_id = v_ws_a;
  assert v_scope = 'todos' and v_rev = 0, format('defaults: scope=%s rev=%s', v_scope, v_rev);
  assert not (select feature_acesso_por_cliente from plans where id = 'max'), 'plans.feature_acesso_por_cliente is born false';

  -- fixtures as superuser
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws_a and user_id in (v_restr, v_restr0);
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws_a, v_restr, v_c1);

  -- owner_always_true
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws_a and user_id = v_owner;
  assert pg_temp.cac(v_owner, v_c1), 'owner_always_true (wrapper)';
  assert public.can_access_cliente(v_owner, v_ws_a, v_c2), 'owner_always_true (core)';
  assert pg_temp.scope_all(v_owner), 'owner_always_true (my_client_scope_all)';
  update workspace_members set client_scope = 'todos' where workspace_id = v_ws_a and user_id = v_owner;

  -- todos_true
  assert pg_temp.cac(v_todos, v_c1) and pg_temp.cac(v_todos, v_c2), 'todos_true';
  assert pg_temp.scope_all(v_todos), 'todos_true (my_client_scope_all)';
  assert pg_temp.cac(v_admin, v_c2), 'todos_true (admin)';
  -- atribuidos_assigned_true / atribuidos_unassigned_false
  assert pg_temp.cac(v_restr, v_c1), 'atribuidos_assigned_true';
  assert not pg_temp.cac(v_restr, v_c2), 'atribuidos_unassigned_false';
  assert not pg_temp.scope_all(v_restr), 'restricted: my_client_scope_all false';
  -- atribuidos_zero_rows_false
  assert not pg_temp.cac(v_restr0, v_c1) and not pg_temp.cac(v_restr0, v_c2), 'atribuidos_zero_rows_false';
  -- null_cliente_false
  assert not pg_temp.cac(v_restr, null), 'null_cliente_false (wrapper)';
  assert not public.can_access_cliente(v_restr, v_ws_a, null), 'null_cliente_false (core)';
  -- non_member_false
  assert not public.can_access_cliente(v_other, v_ws_a, v_c1), 'non_member_false (core)';
  assert not public.can_access_cliente(v_nows, v_ws_a, v_c1), 'non_member_false (no workspace)';
  assert not pg_temp.cac(v_nows, v_c1), 'non_member_false (wrapper, no membership)';
  assert not pg_temp.scope_all(v_nows), 'non_member_false (my_client_scope_all, no membership)';
  assert not public.can_access_cliente(null, v_ws_a, v_c1), 'core with null user';
  -- other_workspace_false
  assert not public.can_access_cliente(v_restr, v_ws_b, v_cb), 'other_workspace_false (no membership in B)';
  assert not pg_temp.cac(v_restr, v_cb), 'other_workspace_false (restricted asked about B client)';

  -- my_membro_ids + can_see_cliente_context
  assert pg_temp.membro_ids(v_restr) = '{}'::bigint[], 'my_membro_ids empty without a linked membro';
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws_a, 'Restr', v_restr) returning id into v_membro;
  assert pg_temp.membro_ids(v_restr) = array[v_membro], 'my_membro_ids returns the linked membro';
  assert pg_temp.ctx(v_restr, v_c1), 'context: assigned client';
  assert not pg_temp.ctx(v_restr, v_c2), 'context: hidden client with nothing of his';
  assert not pg_temp.ctx(v_restr, null), 'context: null client';
  -- seed as superuser without the restricted claims pg_temp.ctx left behind: the
  -- C2 scope guard on tarefas (zz_client_scope_guard) would read them as his insert
  perform set_config('request.jwt.claims', '', true);
  insert into tarefas (conta_id, user_id, titulo, cliente_id, responsavel_id) values (v_ws_a, v_owner, 'T', v_c2, v_membro);
  assert pg_temp.ctx(v_restr, v_c2), 'context: task he is responsible for';
  assert not pg_temp.cac(v_restr, v_c2), 'context does not widen can_access_cliente';
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_owner, v_ws_a, v_c3, 'W3', 'ativo') returning id into v_wf;
  assert not pg_temp.ctx(v_restr, v_c3), 'context: hidden client c3 before any item';
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, responsavel_id) values (v_wf, 1, 'E', 1, v_membro);
  assert pg_temp.ctx(v_restr, v_c3), 'context: workflow step he is responsible for';
  delete from workflow_etapas where workflow_id = v_wf;
  insert into workflow_posts (conta_id, cliente_id, workflow_id, titulo, responsavel_id) values (v_ws_a, v_c3, v_wf, 'P', v_membro);
  assert pg_temp.ctx(v_restr, v_c3), 'context: post he is responsible for';
  delete from workflow_posts where workflow_id = v_wf;
  perform set_config('request.jwt.claims', '', true);
  insert into tarefas (conta_id, user_id, titulo, cliente_id) values (v_ws_a, v_restr, 'T autor', v_c3);
  assert pg_temp.ctx(v_restr, v_c3), 'context: task he authored';
  delete from tarefas where conta_id = v_ws_a;
  assert not pg_temp.ctx(v_restr, v_c2), 'context gone with the item';

  -- RPC: errors
  assert pg_temp.rpc_err(v_admin, v_ws_a, v_todos, 'atribuidos', array[v_c1]) = 'not_owner', 'rpc_not_owner_raises';
  assert pg_temp.rpc_err(v_other, v_ws_a, v_todos, 'atribuidos', array[v_c1]) = 'not_owner', 'rpc_not_owner_raises (foreign owner)';
  assert pg_temp.rpc_err(v_owner, v_ws_a, v_owner, 'atribuidos', array[v_c1]) = 'target_is_owner', 'rpc_target_owner_raises';
  assert pg_temp.rpc_err(v_owner, v_ws_a, v_other, 'atribuidos', array[v_c1]) = 'target_not_member', 'rpc target_not_member';
  assert pg_temp.rpc_err(v_owner, v_ws_a, v_todos, 'tudo', array[v_c1]) = 'invalid_scope', 'rpc invalid_scope';
  assert pg_temp.rpc_err(v_owner, v_ws_a, v_todos, null, null) = 'invalid_scope', 'rpc invalid_scope (null)';
  -- rpc_feature_off_blocks_atribuidos (flag is false on every plan)
  v_err := pg_temp.rpc_err(v_owner, v_ws_a, v_todos, 'atribuidos', array[v_c1]);
  assert v_err = 'feature_disabled', 'rpc_feature_off_blocks_atribuidos: ' || coalesce(v_err, 'ok');
  -- rpc_feature_off_allows_todos (moving out of atribuidos never needs the flag)
  select count(*) into v_audit_before from audit_log where conta_id = v_ws_a and action = 'member_client_scope_set';
  v_res := public.set_member_client_scope(v_owner, v_ws_a, v_restr, 'todos', array[v_c1]);
  assert v_res = '{"changed": true}'::jsonb, 'rpc_feature_off_allows_todos: ' || v_res::text;
  select client_scope, client_scope_rev into v_scope, v_rev from workspace_members where user_id = v_restr and workspace_id = v_ws_a;
  assert v_scope = 'todos' and v_rev = 1, format('todos: scope=%s rev=%s', v_scope, v_rev);
  assert not exists (select 1 from workspace_member_clientes where user_id = v_restr), 'todos clears the rows';

  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws_a, '{"feature_acesso_por_cliente": true}'::jsonb)
  on conflict (workspace_id) do update set feature_overrides = excluded.feature_overrides;

  -- rpc_foreign_cliente_raises
  assert pg_temp.rpc_err(v_owner, v_ws_a, v_todos, 'atribuidos', array[v_c1, v_cb]) = 'cliente_not_in_workspace', 'rpc_foreign_cliente_raises';
  assert pg_temp.rpc_err(v_owner, v_ws_a, v_todos, 'atribuidos', array[v_c1, null]) = 'cliente_not_in_workspace', 'rpc null id raises';
  assert (select client_scope from workspace_members where user_id = v_todos and workspace_id = v_ws_a) = 'todos', 'failed rpc wrote nothing';

  -- move into atribuidos with the flag on
  v_res := public.set_member_client_scope(v_owner, v_ws_a, v_todos, 'atribuidos', array[v_c1, v_c1]);
  assert v_res = '{"changed": true}'::jsonb, 'rpc into atribuidos: ' || v_res::text;
  select client_scope, client_scope_rev into v_scope, v_rev from workspace_members where user_id = v_todos and workspace_id = v_ws_a;
  assert v_scope = 'atribuidos' and v_rev = 1, format('atribuidos: scope=%s rev=%s', v_scope, v_rev);
  select count(*) into v_n from workspace_member_clientes where user_id = v_todos and workspace_id = v_ws_a;
  assert v_n = 1, 'duplicates collapse: ' || v_n;
  assert (select created_by from workspace_member_clientes where user_id = v_todos) = v_owner, 'created_by = actor';
  assert not pg_temp.cac(v_todos, v_c2) and pg_temp.cac(v_todos, v_c1), 'rpc result honored by the predicate';
  -- audit: scope + count only
  select metadata into v_meta from audit_log
   where conta_id = v_ws_a and action = 'member_client_scope_set' and resource_id = v_todos::text
   order by id desc limit 1;
  assert v_meta = '{"scope": "atribuidos", "count": 1}'::jsonb, 'audit metadata: ' || coalesce(v_meta::text, 'null');

  -- rpc_bumps_rev: list-only change
  v_res := public.set_member_client_scope(v_owner, v_ws_a, v_todos, 'atribuidos', array[v_c1, v_c2]);
  assert v_res = '{"changed": true}'::jsonb, 'rpc_bumps_rev changed';
  select client_scope_rev into v_rev from workspace_members where user_id = v_todos and workspace_id = v_ws_a;
  assert v_rev = 2, 'rpc_bumps_rev: rev=' || v_rev;
  -- no-op: same set, different order, no bump, no audit
  select count(*) into v_audit_before from audit_log where conta_id = v_ws_a and action = 'member_client_scope_set';
  v_res := public.set_member_client_scope(v_owner, v_ws_a, v_todos, 'atribuidos', array[v_c2, v_c1]);
  assert v_res = '{"changed": false}'::jsonb, 'noop: ' || v_res::text;
  assert (select client_scope_rev from workspace_members where user_id = v_todos and workspace_id = v_ws_a) = 2, 'noop keeps rev';
  assert (select count(*) from audit_log where conta_id = v_ws_a and action = 'member_client_scope_set') = v_audit_before, 'noop writes no audit';
  -- empty list is a valid restricted state (zero clients)
  v_res := public.set_member_client_scope(v_owner, v_ws_a, v_todos, 'atribuidos', '{}');
  assert v_res = '{"changed": true}'::jsonb, 'empty list';
  assert not pg_temp.cac(v_todos, v_c1), 'empty list sees zero clients';
  perform public.set_member_client_scope(v_owner, v_ws_a, v_todos, 'atribuidos', array[v_c1]);
  -- already atribuidos with the flag turned off later: editing the list is still allowed
  update workspace_plan_overrides set feature_overrides = '{}'::jsonb where workspace_id = v_ws_a;
  v_res := public.set_member_client_scope(v_owner, v_ws_a, v_todos, 'atribuidos', array[v_c1, v_c2]);
  assert v_res = '{"changed": true}'::jsonb, 'list edit with flag off while already atribuidos';

  -- select_own_rows_only (v_todos: 2 rows, v_restr0: re-seeded 1 row)
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws_a, v_restr0, v_c3);
  assert pg_temp.wmc_vistos(v_todos) = 2, 'own rows: ' || pg_temp.wmc_vistos(v_todos);
  assert pg_temp.wmc_vistos(v_restr0) = 1, 'own rows restr0: ' || pg_temp.wmc_vistos(v_restr0);
  assert pg_temp.wmc_vistos(v_admin) = 0, 'admin sees none: ' || pg_temp.wmc_vistos(v_admin);
  assert pg_temp.wmc_vistos(v_owner) = 3, 'owner sees all of A: ' || pg_temp.wmc_vistos(v_owner);
  assert pg_temp.wmc_vistos(v_other) = 0, 'owner of B sees none of A: ' || pg_temp.wmc_vistos(v_other);
  assert has_table_privilege('authenticated', 'public.workspace_member_clientes', 'SELECT'), 'authenticated SELECT';
  assert not has_table_privilege('authenticated', 'public.workspace_member_clientes', 'INSERT'), 'authenticated has no INSERT';
  assert not has_table_privilege('authenticated', 'public.workspace_member_clientes', 'UPDATE'), 'authenticated has no UPDATE';
  assert not has_table_privilege('authenticated', 'public.workspace_member_clientes', 'DELETE'), 'authenticated has no DELETE';
  assert not has_table_privilege('anon', 'public.workspace_member_clientes', 'SELECT'), 'anon has no SELECT';

  -- promote_to_owner_clears
  select client_scope_rev into v_rev from workspace_members where user_id = v_todos and workspace_id = v_ws_a;
  update workspace_members set role = 'owner' where user_id = v_todos and workspace_id = v_ws_a;
  assert (select client_scope from workspace_members where user_id = v_todos and workspace_id = v_ws_a) = 'todos', 'promote_to_owner_clears scope';
  assert (select client_scope_rev from workspace_members where user_id = v_todos and workspace_id = v_ws_a) = v_rev + 1, 'promote bumps rev';
  assert not exists (select 1 from workspace_member_clientes where user_id = v_todos), 'promote_to_owner_clears rows';
  -- re-saving an owner's role does not bump
  update workspace_members set role = 'owner' where user_id = v_todos and workspace_id = v_ws_a;
  assert (select client_scope_rev from workspace_members where user_id = v_todos and workspace_id = v_ws_a) = v_rev + 1, 'owner re-save keeps rev';
  -- demotion leaves todos
  update workspace_members set role = 'admin' where user_id = v_todos and workspace_id = v_ws_a;
  assert (select client_scope from workspace_members where user_id = v_todos and workspace_id = v_ws_a) = 'todos', 'demotion leaves todos';

  -- cascade_cliente_delete
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws_a, v_restr, v_c3);
  delete from clientes where id = v_c3;
  assert not exists (select 1 from workspace_member_clientes where cliente_id = v_c3), 'cascade_cliente_delete';
  -- cascade_member_remove
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws_a, v_restr0, v_c1);
  delete from workspace_members where user_id = v_restr0 and workspace_id = v_ws_a;
  assert not exists (select 1 from workspace_member_clientes where user_id = v_restr0), 'cascade_member_remove';
  -- FK: no row for a client of another workspace
  begin
    insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws_a, v_restr, v_cb);
    assert false, 'cross-workspace client row accepted';
  exception when foreign_key_violation then null;
  end;

  -- null_uid_unrestricted
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role authenticated';
  assert public.my_client_scope_all(), 'null_uid_unrestricted: my_client_scope_all';
  assert public.can_access_cliente(v_c2), 'null_uid_unrestricted: can_access_cliente';
  assert public.can_see_cliente_context(v_c2), 'null_uid_unrestricted: can_see_cliente_context';
  execute 'reset role';

  -- notifications_backfill
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_owner, v_ws_a, v_c2, 'W2', 'ativo') returning id into v_wf;
  insert into workflow_posts (conta_id, cliente_id, workflow_id, titulo) values (v_ws_a, v_c1, null, 'Avulso') returning id into v_post;
  insert into workflow_posts (conta_id, cliente_id, workflow_id, titulo) values (v_ws_b, v_cb, null, 'B') returning id into v_post_b;
  insert into notifications (workspace_id, user_id, type, metadata)
    values (v_ws_a, v_restr, 'post_assigned', jsonb_build_object('post_id', v_post, 'workflow_id', null)) returning id into v_notif_post;
  insert into notifications (workspace_id, user_id, type, metadata)
    values (v_ws_a, v_restr, 'workflow_completed', jsonb_build_object('workflow_id', v_wf)) returning id into v_notif_wf;
  insert into notifications (workspace_id, user_id, type, metadata)
    values (v_ws_a, v_restr, 'post_assigned', '{"post_id": "abc"}'::jsonb) returning id into v_notif_bad;
  insert into notifications (workspace_id, user_id, type, metadata)
    values (v_ws_a, v_restr, 'post_assigned', jsonb_build_object('post_id', v_post_b)) returning id into v_notif_foreign;
  update notifications set cliente_id = null where id in (v_notif_post, v_notif_wf, v_notif_bad, v_notif_foreign);
  perform public._notifications_backfill_cliente_id();
  assert (select cliente_id from notifications where id = v_notif_post) = v_c1, 'notifications_backfill: post';
  assert (select cliente_id from notifications where id = v_notif_wf) = v_c2, 'notifications_backfill: workflow';
  assert (select cliente_id from notifications where id = v_notif_bad) is null, 'notifications_backfill: non-numeric id left alone';
  assert (select cliente_id from notifications where id = v_notif_foreign) is null, 'notifications_backfill: post of another workspace left alone';

  -- ACLs
  assert has_function_privilege('service_role', 'public.can_access_cliente(uuid,uuid,bigint)', 'execute'), 'core: service_role';
  assert not has_function_privilege('authenticated', 'public.can_access_cliente(uuid,uuid,bigint)', 'execute'), 'core: no authenticated';
  assert not has_function_privilege('anon', 'public.can_access_cliente(uuid,uuid,bigint)', 'execute'), 'core: no anon';
  assert has_function_privilege('authenticated', 'public.can_access_cliente(bigint)', 'execute'), 'wrapper: authenticated';
  assert not has_function_privilege('anon', 'public.can_access_cliente(bigint)', 'execute'), 'wrapper: no anon';
  assert has_function_privilege('authenticated', 'public.my_client_scope_all()', 'execute'), 'my_client_scope_all: authenticated';
  assert not has_function_privilege('anon', 'public.my_client_scope_all()', 'execute'), 'my_client_scope_all: no anon';
  assert has_function_privilege('authenticated', 'public.my_membro_ids()', 'execute'), 'my_membro_ids: authenticated';
  assert not has_function_privilege('anon', 'public.my_membro_ids()', 'execute'), 'my_membro_ids: no anon';
  assert has_function_privilege('authenticated', 'public.can_see_cliente_context(bigint)', 'execute'), 'context: authenticated';
  assert not has_function_privilege('anon', 'public.can_see_cliente_context(bigint)', 'execute'), 'context: no anon';
  assert has_function_privilege('service_role', 'public.set_member_client_scope(uuid,uuid,uuid,text,bigint[])', 'execute'), 'rpc: service_role';
  assert not has_function_privilege('authenticated', 'public.set_member_client_scope(uuid,uuid,uuid,text,bigint[])', 'execute'), 'rpc: no authenticated';
  assert not has_function_privilege('anon', 'public.set_member_client_scope(uuid,uuid,uuid,text,bigint[])', 'execute'), 'rpc: no anon';
  assert not has_function_privilege('authenticated', 'public._notifications_backfill_cliente_id()', 'execute'), 'backfill: no authenticated';
  assert not has_function_privilege('service_role', 'public._notifications_backfill_cliente_id()', 'execute'), 'backfill: no service_role';

  raise notice 'PASS 99_acesso_por_cliente_schema';
end $$;
rollback;
