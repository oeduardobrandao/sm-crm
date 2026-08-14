\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Instagram comment-to-DM automations (migrations 20260815000002/3).
-- feature_instagram_automation ships dark: DEFAULT false on every plan, so
-- "flag on" in this suite always means an explicit workspace_plan_overrides
-- row, never a plan pick.
--
-- 1-3. instagram_comment_automations: flag-off blocks INSERT; flag-on lets
--      owner/admin write while agent only reads (intentional deviation from
--      post_status_automations, documented in the migration); downgrade
--      (flag back off) keeps the existing row editable/deletable but blocks
--      new INSERTs (block-new/keep-existing, same policy as 06).
-- 4. Structural tenant-safety: the composite FKs ica_client_same_tenant and
--    ias_automation_same_tenant reject cross-workspace pointers even for a
--    caller that bypasses RLS entirely (table owner, standing in for the
--    service-role worker — FK enforcement does not depend on role).
-- 5. instagram_automation_sends: SELECT isolation between workspaces, and
--    confirmation that authenticated cannot write sends directly (service
--    role only, per the migration's RLS policies).

-- 1-3. Feature gate (off -> on -> downgrade) + RLS (owner/admin write, agent
--      read-only)
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_cli bigint;
  v_auto uuid;
  v_seen bigint;
  v_rows bigint;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('pro'); -- feature_instagram_automation defaults false (ship dark)

  insert into auth.users (id) values (v_owner), (v_agent);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'owner'
    where id = v_owner;
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'agent'
    where id = v_agent;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- 1. Flag OFF: owner INSERT fails feature_disabled:feature_instagram_automation
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message)
      values (v_ws, v_cli, 'Promo', array['preco'], 'Chama no DM que te mando o link!');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_instagram_automation%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'owner insert must be blocked while the feature is off';
  reset role;

  -- 2. Flag ON via workspace_plan_overrides.feature_overrides
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_cli, 'Promo', array['preco'], 'Chama no DM que te mando o link!')
    returning id into v_auto;

  -- agent SELECT sees the automation (intentional read access, spec deviation)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  select count(*) into v_seen from instagram_comment_automations where conta_id = v_ws;
  assert v_seen = 1, format('agent should read the automation, saw %s', v_seen);

  -- agent INSERT rejected by RLS WITH CHECK
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message)
      values (v_ws, v_cli, 'Hack', array['x'], 'y');
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  assert v_rejected, 'agent INSERT must be rejected by RLS';

  -- agent UPDATE silently filtered by RLS USING (0 rows)
  update instagram_comment_automations set ativo = false where id = v_auto;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('agent UPDATE must affect 0 rows, affected %s', v_rows);

  -- agent DELETE silently filtered by RLS USING (0 rows)
  delete from instagram_comment_automations where id = v_auto;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('agent DELETE must affect 0 rows, affected %s', v_rows);

  reset role;

  -- 3. Downgrade: flag back off. Existing row stays editable/deletable by
  --    owner/admin; a NEW insert is blocked again (block-new/keep-existing).
  delete from workspace_plan_overrides where workspace_id = v_ws;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  update instagram_comment_automations set ativo = false where id = v_auto;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('owner UPDATE of the existing automation must survive downgrade, affected %s', v_rows);

  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message)
      values (v_ws, v_cli, 'New', array['x'], 'y');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_instagram_automation%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'a NEW insert after downgrade must be blocked again';

  delete from instagram_comment_automations where id = v_auto;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('owner DELETE of the existing automation must survive downgrade, affected %s', v_rows);

  reset role;
  raise notice 'PASS 65 feature gate + RLS + downgrade';
end $$;
rollback;

-- 4. Structural tenant-safety: composite FKs reject cross-workspace pointers
--    even for a caller that bypasses RLS (table owner here, standing in for
--    the service-role worker that owns writes on both tables).
begin;
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_uid uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_auto_a uuid;
  v_rejected boolean;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws_a, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  -- client_id pointing at another workspace's cliente must be rejected
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message)
      values (v_ws_a, v_cli_b, 'Cross', array['x'], 'y');
  exception when foreign_key_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'cross-tenant client_id must be rejected by ica_client_same_tenant';

  -- a real, same-tenant automation to use as the FK target below
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws_a, v_cli_a, 'Real', array['x'], 'y')
    returning id into v_auto_a;

  -- automation_id from ws A paired with conta_id from ws B must be rejected
  v_rejected := false;
  begin
    insert into instagram_automation_sends
      (comment_id, automation_id, conta_id, comment_created_at)
      values ('cross-comment-1', v_auto_a, v_ws_b, now());
  exception when foreign_key_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'cross-tenant (automation_id, conta_id) must be rejected by ias_automation_same_tenant';

  raise notice 'PASS 65 tenant-safety composite FKs';
end $$;
rollback;

-- 5. instagram_automation_sends: SELECT isolation between workspaces, and
--    writes are service-role only (no INSERT policy for authenticated).
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_uid uuid := gen_random_uuid();
  v_member_a uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_auto_a uuid; v_auto_b uuid;
  v_n bigint;
  v_rejected boolean;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values
    (v_ws_a, '{"feature_instagram_automation": true}'::jsonb),
    (v_ws_b, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid), (v_member_a);
  insert into workspace_members (user_id, workspace_id, role) values (v_member_a, v_ws_a, 'agent');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a, role = 'agent'
    where id = v_member_a;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws_a, v_cli_a, 'A1', array['x'], 'y') returning id into v_auto_a;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws_b, v_cli_b, 'B1', array['x'], 'y') returning id into v_auto_b;

  insert into instagram_automation_sends
    (comment_id, automation_id, conta_id, comment_created_at)
    values ('send-a1', v_auto_a, v_ws_a, now());
  insert into instagram_automation_sends
    (comment_id, automation_id, conta_id, comment_created_at)
    values ('send-b1', v_auto_b, v_ws_b, now());

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member_a, 'role', 'authenticated')::text, true);

  select count(*) into v_n from instagram_automation_sends;
  assert v_n = 1, format('member of workspace A must see exactly its own send, saw %s', v_n);

  select count(*) into v_n from instagram_automation_sends where conta_id = v_ws_b;
  assert v_n = 0, 'member of workspace A must not see workspace B sends even when filtering explicitly';

  -- writes are service-role only: no INSERT policy exists for authenticated
  v_rejected := false;
  begin
    insert into instagram_automation_sends
      (comment_id, automation_id, conta_id, comment_created_at)
      values ('send-a2', v_auto_a, v_ws_a, now());
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated must not be able to write sends directly';

  reset role;
  raise notice 'PASS 65 sends RLS isolation';
end $$;
rollback;
