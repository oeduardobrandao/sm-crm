\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- 1. client_hub_tokens COUNT limit on start (max_hub_tokens = 5).
--    Uses start because free has feature_hub_portal OFF (the feature gate would block first;
--    that path is covered in 11_feature_triggers). The count trigger is scoped by conta_id.
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_blocked boolean := false; i int;
begin
  v_ws := et_make_workspace('start'); -- max_hub_tokens = 5
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  for i in 1..5 loop
    insert into client_hub_tokens (cliente_id, conta_id) values (v_cli, v_ws);
  end loop; -- 5 allowed
  begin
    insert into client_hub_tokens (cliente_id, conta_id) values (v_cli, v_ws); -- 6th => block
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_hub_tokens%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'sixth hub token insert should have been blocked';
  raise notice 'PASS 05 hub_tokens count';
end $$;
rollback;

-- 2. workflow_templates COUNT limit on free (max_workflow_templates = 1), scoped by conta_id.
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_blocked boolean := false;
begin
  insert into auth.users (id) values (v_uid); -- workflow_templates.user_id FK -> auth.users
  v_ws := et_make_workspace('free'); -- max_workflow_templates = 1
  insert into workflow_templates (user_id, conta_id, nome) values (v_uid, v_ws, 'T1'); -- 1 allowed
  begin
    insert into workflow_templates (user_id, conta_id, nome) values (v_uid, v_ws, 'T2'); -- 2nd => block
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_workflow_templates%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'second workflow template insert should have been blocked';
  raise notice 'PASS 05 workflow_templates count';
end $$;
rollback;

-- 3. workflow_posts COUNT limit on free (max_posts_per_workflow = 5), scoped by workflow_id.
--    5 OK in workflow A, 6th blocked; a SECOND workflow B still allows inserts (no cross-counting).
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint;
        v_wfa bigint; v_wfb bigint; v_blocked boolean := false; i int;
begin
  insert into auth.users (id) values (v_uid); -- workflows.user_id FK -> auth.users
  v_ws := et_make_workspace('free'); -- max_posts_per_workflow = 5
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF-A', 'ativo') returning id into v_wfa;
  -- WF-B is 'arquivado': free.max_active_workflows_per_client = 1 only counts active workflows,
  -- so a second active workflow for the same cliente would be blocked. Post counting is scoped
  -- by workflow_id alone (no status predicate), so an archived workflow still accepts posts.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF-B', 'arquivado') returning id into v_wfb;

  for i in 1..5 loop
    insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wfa, v_ws, 'A'||i);
  end loop; -- 5 allowed in workflow A
  begin
    insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wfa, v_ws, 'A6'); -- 6th => block
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_posts_per_workflow%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'sixth post in workflow A should have been blocked';

  -- second workflow is counted independently: 5 inserts must succeed
  for i in 1..5 loop
    insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wfb, v_ws, 'B'||i);
  end loop; -- no cross-counting from workflow A
  raise notice 'PASS 05 workflow_posts count (scoped per workflow)';
end $$;
rollback;

-- 4. template_property_definitions COUNT limit on start (feature_custom_properties ON,
--    max_custom_properties_per_template = 5), scoped by template_id.
--    5 OK in template A, 6th blocked; a SECOND template B still allows inserts.
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid();
        v_tpla bigint; v_tplb bigint; v_blocked boolean := false; i int;
begin
  insert into auth.users (id) values (v_uid); -- workflow_templates.user_id FK -> auth.users
  v_ws := et_make_workspace('start'); -- max_custom_properties_per_template = 5
  insert into workflow_templates (user_id, conta_id, nome) values (v_uid, v_ws, 'TPL-A') returning id into v_tpla;
  insert into workflow_templates (user_id, conta_id, nome) values (v_uid, v_ws, 'TPL-B') returning id into v_tplb;

  for i in 1..5 loop
    insert into template_property_definitions (template_id, conta_id, name, type)
      values (v_tpla, v_ws, 'P'||i, 'text');
  end loop; -- 5 allowed in template A
  begin
    insert into template_property_definitions (template_id, conta_id, name, type)
      values (v_tpla, v_ws, 'P6', 'text'); -- 6th => block
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_custom_properties_per_template%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'sixth property in template A should have been blocked';

  -- second template is counted independently: 5 inserts must succeed
  for i in 1..5 loop
    insert into template_property_definitions (template_id, conta_id, name, type)
      values (v_tplb, v_ws, 'Q'||i, 'text');
  end loop; -- no cross-counting from template A
  raise notice 'PASS 05 template_property_definitions count (scoped per template)';
end $$;
rollback;
