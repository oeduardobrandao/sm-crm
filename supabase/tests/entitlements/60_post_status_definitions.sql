\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Custom post statuses: definitions table (migration 20260805000001).
-- 1. Plan gate blocks INSERT on free, allows on start.
-- 2. Live-name uniqueness is case/whitespace-insensitive and frees the name
--    after archiving.
-- 3. RLS: any member reads; only owner/admin write (agent INSERT rejected,
--    agent UPDATE silently filtered).
-- 4. z1 clears a cross-tenant custom_status_id pointer on workflow_posts.

-- 1. Feature gate (free.feature_custom_properties = false, start = true)
begin;
do $$
declare v_ws uuid; v_blocked boolean := false;
begin
  v_ws := et_make_workspace('free');
  begin
    insert into post_status_definitions (conta_id, nome, behaves_as)
      values (v_ws, 'Em design', 'revisao_interna');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_custom_properties%',
      format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'definition insert must block when feature off';

  v_ws := et_make_workspace('start');
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Em design', 'revisao_interna');
  raise notice 'PASS 60 feature gate';
end $$;
rollback;

-- 2. Live-name uniqueness
begin;
do $$
declare v_ws uuid; v_id uuid; v_blocked boolean := false;
begin
  v_ws := et_make_workspace('start');
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Em design', 'revisao_interna') returning id into v_id;
  begin
    insert into post_status_definitions (conta_id, nome, behaves_as)
      values (v_ws, '  em DESIGN ', 'rascunho');
  exception when unique_violation then
    v_blocked := true;
  end;
  assert v_blocked, 'live duplicate name (case/space-insensitive) must block';

  update post_status_definitions set arquivado = true where id = v_id;
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Em design', 'revisao_interna'); -- name freed after archive
  raise notice 'PASS 60 live-name uniqueness';
end $$;
rollback;

-- 3. RLS: agent reads but cannot write; admin writes
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_admin uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_id uuid;
  v_seen bigint;
  v_rows bigint;
  v_rejected boolean := false;
begin
  -- pro: feature_custom_properties on AND max_team_members = 3 (start only
  -- allows 1 member, which would trip the count limit before RLS is tested)
  v_ws := et_make_workspace('pro');

  insert into auth.users (id) values (v_admin), (v_agent);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_admin, v_ws, 'admin'), (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'admin'
    where id = v_admin;
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'agent'
    where id = v_agent;

  -- admin: INSERT + UPDATE allowed
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Em design', 'revisao_interna') returning id into v_id;
  update post_status_definitions set cor = '#7c5cff' where id = v_id;

  -- agent: SELECT sees the definition (kanban/labels need it)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  select count(*) into v_seen from post_status_definitions where conta_id = v_ws;
  assert v_seen = 1, format('agent should read definitions, saw %s', v_seen);

  -- agent: INSERT rejected by RLS WITH CHECK
  begin
    insert into post_status_definitions (conta_id, nome, behaves_as)
      values (v_ws, 'Hack', 'rascunho');
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  assert v_rejected, 'agent INSERT must be rejected';

  -- agent: UPDATE silently filtered by RLS USING (0 rows)
  update post_status_definitions set nome = 'Hacked' where id = v_id;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('agent UPDATE must affect 0 rows, affected %s', v_rows);

  reset role;
  raise notice 'PASS 60 RLS owner-admin write, member read';
end $$;
rollback;

-- 4. Cross-tenant pointer cleared by z1
begin;
do $$
declare
  v_ws_a uuid; v_ws_b uuid; v_uid uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint; v_post bigint; v_def_b uuid;
  v_custom uuid; v_status text;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_a, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws_a, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf, v_ws_a, 'P1') returning id into v_post;
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws_b, 'Alheio', 'enviado_cliente') returning id into v_def_b;

  update workflow_posts set custom_status_id = v_def_b where id = v_post;

  select custom_status_id, status into v_custom, v_status
    from workflow_posts where id = v_post;
  assert v_custom is null, 'cross-tenant pointer must be cleared';
  assert v_status = 'rascunho',
    format('status must not follow a foreign definition, got %s', v_status);
  raise notice 'PASS 60 cross-tenant pointer cleared';
end $$;
rollback;
