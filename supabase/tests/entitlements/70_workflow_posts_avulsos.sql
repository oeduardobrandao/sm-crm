\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Posts avulsos (fora de fluxo): entitlements/RLS/trigger suite for the four
-- migrations in .superpowers/sdd/2026-08-29-posts-avulsos-plan (Tasks 1-4):
--   20260830000001_workflow_posts_cliente_id.sql          -- cliente_id column,
--     derivation trigger, direct-PATCH guard, avulso limit bucket
--   20260830000002_avulso_claim_reorder_ica.sql            -- claim_posts_for_*,
--     reorder_post_schedules, ICA family read cliente_id directly
--   20260830000003_avulso_notifications_folders_views.sql  -- trg_notify_*,
--     folder_sync_post, get_client_health_aggregates, mensagens
--   20260830000004_post_detach_attach_rpcs.sql              -- detach_posts_from_flow
--     / attach_posts_to_flow RPCs (the only sanctioned move path)
--
-- Brief item 10 (Estudio create_design/attach_design attaching to an avulso)
-- is NOT covered below: the whole Estudio feature (create_design/attach_design/
-- save_design_blob/detach_design/finalize_design_render + the designs/
-- post_designs/design_asset_refs/ai_image_generations tables) was dropped by
-- 20260722000002_drop_estudio_objects.sql, merged via PR #240 well before this
-- plan started -- confirmed via grep, neither the functions nor the `designs`
-- table exist in the current schema. 20260830000003's own trailer comment
-- reaches the same conclusion. There is no "attach a design to an avulso"
-- code path left to test.
--
-- Concurrency: the two advisory-lock deadlock fixes documented at the top of
-- 20260830000004 (the ':post_move' key serializing detach against attach; the
-- ':max_posts_per_workflow' key reordered ahead of the workflow row lock to
-- avoid a race against a concurrent INSERT) need two simultaneous connections
-- to exercise -- a single-connection psql suite cannot reproduce a 40P01
-- deadlock. Not faked here; what IS single-connection testable -- ownership,
-- limit-boundary correctness, all-or-nothing rejection, folder/property
-- preservation -- is covered below.

-- =====================================================================
-- 1. Backfill/derivation (migration 1): sync_workflow_post_cliente trigger
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_ws_b uuid; v_uid uuid := gen_random_uuid();
  v_cli bigint; v_cli_b bigint; v_wf bigint; v_wf_b bigint;
  v_post bigint; v_raised boolean;
begin
  v_ws := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_b, 'CB', 'CB', '#000') returning id into v_cli_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws_b, v_cli_b, 'WF-B', 'ativo') returning id into v_wf_b;

  -- 1a. insert with workflow_id only -> cliente_id derived from the workflow
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf, v_ws, 'attached') returning id into v_post;
  assert (select cliente_id from workflow_posts where id = v_post) = v_cli,
    'cliente_id must be derived from the workflow on insert';

  -- 1b. avulso (no workflow_id) with no cliente_id -> raise
  v_raised := false;
  begin
    insert into workflow_posts (conta_id, titulo) values (v_ws, 'no-client');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'independent post requires cliente_id', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'independent post without cliente_id must raise';

  -- 1c. avulso with an explicit cliente_id succeeds and keeps workflow_id null
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli, 'avulso') returning id into v_post;
  assert (select workflow_id from workflow_posts where id = v_post) is null,
    'avulso insert must keep workflow_id null';

  -- 1d. FK cross-tenant: cliente_id from another workspace, conta_id here -> raise
  v_raised := false;
  begin
    insert into workflow_posts (conta_id, cliente_id, titulo)
      values (v_ws, v_cli_b, 'cross-tenant');
  exception when foreign_key_violation then
    v_raised := true;
  end;
  assert v_raised, 'cliente_id from another workspace must be rejected by the composite FK';

  -- 1e. bonus: workflow_id from another workspace (conta_id mismatch) -> the
  -- trigger's own guard raises before the FK is even reached
  v_raised := false;
  begin
    insert into workflow_posts (workflow_id, conta_id, titulo)
      values (v_wf_b, v_ws, 'wrong-workspace-workflow');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow belongs to another workspace', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a workflow from another workspace must be rejected';

  raise notice 'PASS 70.1 backfill/derivation';
end $$;
rollback;

-- =====================================================================
-- 2. Direct PATCH of workflow_id/cliente_id (migration 1):
--    post_a0_sync_cliente's post_move_requires_rpc guard, impersonating
--    `authenticated` -- RLS alone would ALLOW this (same workspace), only
--    the trigger blocks it (same pattern as 40_cliente_tables_tenant_isolation).
--    Also pins the silent cliente_id-spoof neutralization.
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_wf_a bigint; v_wf_b bigint;
  v_post_attached bigint; v_post_avulso bigint;
  v_raised boolean; v_cliente_after bigint;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'B', 'B', '#000') returning id into v_cli_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli_a, 'WF-A', 'ativo') returning id into v_wf_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli_b, 'WF-B', 'ativo') returning id into v_wf_b;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_a, v_ws, 'attached') returning id into v_post_attached;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli_a, 'avulso') returning id into v_post_avulso;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 2a. direct workflow_id patch (same workspace, different flow) -> blocked
  v_raised := false;
  begin
    update workflow_posts set workflow_id = v_wf_b where id = v_post_attached;
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_move_requires_rpc', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'direct workflow_id PATCH must be rejected outside the RPC';

  -- 2b. direct cliente_id patch on an avulso -> blocked
  v_raised := false;
  begin
    update workflow_posts set cliente_id = v_cli_b where id = v_post_avulso;
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_move_requires_rpc', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'direct cliente_id PATCH on an avulso must be rejected outside the RPC';

  -- 2c. silent spoof neutralization: a bulk UPDATE that only scopes by
  -- "workflow_id IS NOT NULL" and tries to repoint cliente_id on an attached
  -- post completes WITHOUT raising -- the trigger re-derives cliente_id from
  -- the workflow before the guard compares OLD/NEW, so the spoofed value
  -- never survives and the guard never even sees a change. Pinned per the
  -- task-5 adjustments (documented, not accidental).
  update workflow_posts set cliente_id = v_cli_b
   where id = v_post_attached and workflow_id is not null;
  select cliente_id into v_cliente_after from workflow_posts where id = v_post_attached;
  assert v_cliente_after = v_cli_a,
    format('spoofed cliente_id must be neutralized by re-derivation, got %s', v_cliente_after);

  execute 'reset role';
  raise notice 'PASS 70.2 direct PATCH guard + spoof neutralization';
end $$;
rollback;

-- =====================================================================
-- 3. Avulso-per-client limit bucket (migration 1): trg_limit_posts_avulsos,
--    independent from trg_limit_posts (the in-flow bucket) and from other
--    clients. Uses 'free' (max_posts_per_workflow = 5), matching the
--    convention in 05_more_count_limits.sql section 3.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint; v_wf bigint;
  v_blocked boolean; i int;
begin
  insert into auth.users (id) values (v_uid);
  v_ws := et_make_workspace('free'); -- max_posts_per_workflow = 5
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'B', 'B', '#000') returning id into v_cli_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli_a, 'WF', 'ativo') returning id into v_wf;

  -- 3a. 5 avulsos OK for client A, 6th blocked
  for i in 1..5 loop
    insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_cli_a, 'avulso-A'||i);
  end loop;
  v_blocked := false;
  begin
    insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_cli_a, 'avulso-A6');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_posts_per_workflow%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'sixth avulso for client A must be blocked';

  -- 3b. posts IN a flow of the SAME client do not count against the (maxed
  -- out) avulso bucket, and are limited independently by their own bucket
  for i in 1..5 loop
    insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf, v_ws, 'flow-A'||i);
  end loop; -- all 5 succeed even though client A's avulso bucket is already maxed
  v_blocked := false;
  begin
    insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf, v_ws, 'flow-A6');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_posts_per_workflow%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'sixth in-flow post must still be blocked by its own (separate) bucket';

  -- 3c. a second, independent client gets its own avulso bucket
  for i in 1..5 loop
    insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_cli_b, 'avulso-B'||i);
  end loop; -- no cross-counting from client A

  raise notice 'PASS 70.3 avulso limit bucket';
end $$;
rollback;

-- =====================================================================
-- 4. detach_posts_from_flow bypasses the avulso limit entirely (pinned
--    behavior -- block-new policy: the bucket is only enforced on creation)
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint; v_post bigint;
  v_result jsonb; i int; v_count bigint;
begin
  v_ws := et_make_workspace('free'); -- max_posts_per_workflow = 5 (avulso bucket)
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;

  -- client already at the avulso bucket limit (5)
  for i in 1..5 loop
    insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_cli, 'avulso'||i);
  end loop;
  -- one more post, still IN the flow (untouched by the avulso bucket)
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf, v_ws, 'to-detach')
    returning id into v_post;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  select detach_posts_from_flow(array[v_post]) into v_result;
  assert (v_result->>'ok')::boolean, format('detach must succeed even above the avulso limit, got %s', v_result);
  assert (v_result->>'detached')::int = 1, format('expected detached=1, got %s', v_result->>'detached');

  select count(*) into v_count from workflow_posts
   where cliente_id = v_cli and workflow_id is null;
  assert v_count = 6, format('client must now have 6 avulsos (limit bypassed on detach), got %s', v_count);

  raise notice 'PASS 70.4 detach bypasses avulso limit';
end $$;
rollback;

-- =====================================================================
-- 5. detach_posts_from_flow: ownership, status/custom_status_id/
--    post_property_values preservation, p_archive_empty_flow, folder reparent
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_ws_other uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_cli_other bigint;
  v_wf_a bigint; v_wf_b bigint;
  v_post_a1 bigint; v_post_a2 bigint; v_post_b1 bigint; v_post_b2 bigint;
  v_post_other bigint;
  v_status_def uuid; v_tpl bigint; v_propdef bigint;
  v_result jsonb; v_raised boolean;
  v_status_after text; v_custom_after uuid; v_ppv_count int; v_ppv_value jsonb;
  v_client_folder bigint; v_post_a1_folder_parent bigint;
  v_wf_a_status text; v_wf_b_status text;
begin
  v_ws := et_make_workspace('pro');
  v_ws_other := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_other, 'CO', 'CO', '#000') returning id into v_cli_other;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF-A', 'ativo') returning id into v_wf_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF-B', 'ativo') returning id into v_wf_b;

  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (v_wf_a, v_ws, 'A1', 'revisao_interna') returning id into v_post_a1;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_a, v_ws, 'A2') returning id into v_post_a2;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_b, v_ws, 'B1') returning id into v_post_b1;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_b, v_ws, 'B2') returning id into v_post_b2;

  -- a post that belongs to a DIFFERENT workspace entirely (ownership test)
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws_other, v_cli_other, 'other-ws') returning id into v_post_other;

  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Em design', 'revisao_interna') returning id into v_status_def;
  update workflow_posts set custom_status_id = v_status_def where id = v_post_a1;

  insert into workflow_templates (user_id, conta_id, nome)
    values (v_user, v_ws, 'TPL') returning id into v_tpl;
  insert into template_property_definitions (template_id, conta_id, name, type)
    values (v_tpl, v_ws, 'Nota', 'text') returning id into v_propdef;
  insert into post_property_values (post_id, property_definition_id, value)
    values (v_post_a1, v_propdef, '"hello"'::jsonb);

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 5a. empty array -> post_ids_required
  v_raised := false;
  begin
    perform detach_posts_from_flow(array[]::bigint[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_ids_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'empty post_ids array must raise post_ids_required';

  -- 5b. ownership mismatch (a post from another workspace) -> post_not_found
  v_raised := false;
  begin
    perform detach_posts_from_flow(array[v_post_other]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'detaching a post from another workspace must raise post_not_found';

  -- 5c. status / custom_status_id / post_property_values survive the detach,
  -- and the post's folder reparents from the flow folder to the client folder
  select id into v_client_folder from folders
   where conta_id = v_ws and source_type = 'client' and source_id = v_cli;

  select detach_posts_from_flow(array[v_post_a1]) into v_result;
  assert (v_result->>'ok')::boolean and (v_result->>'detached')::int = 1,
    format('detach of A1 must succeed, got %s', v_result);

  select status, custom_status_id into v_status_after, v_custom_after
    from workflow_posts where id = v_post_a1;
  assert v_status_after = 'revisao_interna', format('status must be preserved, got %s', v_status_after);
  assert v_custom_after = v_status_def, 'custom_status_id must be preserved by detach';

  select count(*), (array_agg(value))[1] into v_ppv_count, v_ppv_value
    from post_property_values where post_id = v_post_a1;
  assert v_ppv_count = 1, format('post_property_values row must survive detach, got %s rows', v_ppv_count);
  assert v_ppv_value = '"hello"'::jsonb, 'post_property_values.value must be untouched by detach';

  select f.parent_id into v_post_a1_folder_parent from folders f
   where f.conta_id = v_ws and f.source_type = 'post' and f.source_id = v_post_a1;
  assert v_post_a1_folder_parent = v_client_folder,
    format('detached post folder must reparent to the client folder, got parent %s (client folder is %s)',
      v_post_a1_folder_parent, v_client_folder);

  -- 5d. p_archive_empty_flow only archives flows that end up EMPTY from
  -- THIS batch -- WF-A's last post empties it (archived); WF-B keeps B2
  -- (not archived)
  select detach_posts_from_flow(array[v_post_a2], true) into v_result; -- WF-A's last remaining post
  assert (v_result->'archived_workflow_ids') @> to_jsonb(array[v_wf_a]),
    format('WF-A must be archived once empty, got %s', v_result);
  select status into v_wf_a_status from workflows where id = v_wf_a;
  assert v_wf_a_status = 'arquivado', format('WF-A must be archived, got %s', v_wf_a_status);

  select detach_posts_from_flow(array[v_post_b1], true) into v_result; -- WF-B keeps B2
  assert not (v_result->'archived_workflow_ids' @> to_jsonb(array[v_wf_b])),
    format('WF-B must NOT be archived while B2 remains, got %s', v_result);
  select status into v_wf_b_status from workflows where id = v_wf_b;
  assert v_wf_b_status = 'ativo', format('WF-B must remain ativo, got %s', v_wf_b_status);

  raise notice 'PASS 70.5 detach_posts_from_flow';
end $$;
rollback;

-- =====================================================================
-- 6. attach_posts_to_flow: ownership, avulso-only, active-workflow guard,
--    same-client guard, deterministic ordem, folder reparent
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_wf_active bigint; v_wf_inactive bigint;
  v_post_avulso_a1 bigint; v_post_avulso_a2 bigint; v_post_avulso_b bigint;
  v_post_attached bigint;
  v_result jsonb; v_raised boolean;
  v_ordem_a1 int; v_ordem_a2 int;
  v_wf_folder bigint; v_post_folder_parent bigint;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'B', 'B', '#000') returning id into v_cli_b;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli_a, 'WF-active', 'ativo') returning id into v_wf_active;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli_a, 'WF-arquivado', 'arquivado') returning id into v_wf_inactive;

  -- a pre-existing attached post gives WF-active a non-zero max(ordem)
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem)
    values (v_wf_active, v_ws, 'existing', 4) returning id into v_post_attached;

  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli_a, 'avulso-A1') returning id into v_post_avulso_a1;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli_a, 'avulso-A2') returning id into v_post_avulso_a2;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli_b, 'avulso-B') returning id into v_post_avulso_b;

  -- 6-pre. workspace_not_found: no auth context at all (postgres, auth.uid() is null)
  v_raised := false;
  begin
    perform attach_posts_to_flow(array[v_post_avulso_a1], v_wf_active);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workspace_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'attach without an active workspace must raise workspace_not_found';

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 6a. empty array -> post_ids_required
  v_raised := false;
  begin
    perform attach_posts_to_flow(array[]::bigint[], v_wf_active);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_ids_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'empty post_ids array must raise post_ids_required';

  -- 6b. workflow_not_found
  v_raised := false;
  begin
    perform attach_posts_to_flow(array[v_post_avulso_a1], -1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a nonexistent workflow must raise workflow_not_found';

  -- 6c. workflow_not_active
  v_raised := false;
  begin
    perform attach_posts_to_flow(array[v_post_avulso_a1], v_wf_inactive);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_active', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'attaching into an arquivado workflow must raise workflow_not_active';

  -- 6d. post_already_in_flow (target is already attached)
  v_raised := false;
  begin
    perform attach_posts_to_flow(array[v_post_attached], v_wf_active);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_already_in_flow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'attaching an already-attached post must raise post_already_in_flow';

  -- 6e. post_belongs_to_another_client
  v_raised := false;
  begin
    perform attach_posts_to_flow(array[v_post_avulso_b], v_wf_active);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_belongs_to_another_client', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'attaching another client''s avulso must raise post_belongs_to_another_client';

  -- 6f. success: ordem = max(ordem) + row_number() by ascending id
  -- (NOT by array order -- posts are passed [a2, a1], reversed on purpose),
  -- and the post's folder reparents from the client folder to the flow folder
  select id into v_wf_folder from folders
   where conta_id = v_ws and source_type = 'workflow' and source_id = v_wf_active;

  select attach_posts_to_flow(array[v_post_avulso_a2, v_post_avulso_a1], v_wf_active) into v_result;
  assert (v_result->>'ok')::boolean and (v_result->>'attached')::int = 2,
    format('attach of 2 avulsos must succeed, got %s', v_result);

  select ordem into v_ordem_a1 from workflow_posts where id = v_post_avulso_a1;
  select ordem into v_ordem_a2 from workflow_posts where id = v_post_avulso_a2;
  assert v_ordem_a1 = 5 and v_ordem_a2 = 6,
    format('ordem must be assigned by ascending id regardless of array order, got a1=%s a2=%s',
      v_ordem_a1, v_ordem_a2);

  select f.parent_id into v_post_folder_parent from folders f
   where f.conta_id = v_ws and f.source_type = 'post' and f.source_id = v_post_avulso_a1;
  assert v_post_folder_parent = v_wf_folder,
    format('attached post folder must reparent to the flow folder, got %s (flow folder is %s)',
      v_post_folder_parent, v_wf_folder);

  raise notice 'PASS 70.6 attach_posts_to_flow';
end $$;
rollback;

-- =====================================================================
-- 6b. attach_posts_to_flow: plan limit is enforced, all-or-nothing on the
--     whole batch (a small override keeps the numbers deterministic)
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint;
  v_wf_stage1 bigint; v_wf_stage2 bigint; v_wf_stage3 bigint;
  v_post1 bigint; v_post2 bigint; v_post3 bigint;
  v_raised boolean; v_result jsonb;
begin
  -- The override caps EVERY bucket in this workspace (trg_limit_posts,
  -- trg_limit_posts_avulsos, and attach's own check all read the same
  -- effective_plan_limit('max_posts_per_workflow')) -- so the 3 posts this
  -- test needs cannot be created directly as 3 avulsos, or attached 3-deep
  -- to one flow: either would trip an INSERT-time limiter before this test
  -- even gets to exercise attach's own check. Instead: one post per
  -- disposable flow (each flow's own count of 1 is comfortably under 2),
  -- then detach all three at once -- detach never enforces this limit
  -- (pinned in section 4) -- so all three land as avulsos uncounted by any
  -- bucket, free for attach's own check to be the one that says no.
  v_ws := et_make_workspace('pro', '{"max_posts_per_workflow": 2}'::jsonb);
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF-stage-1', 'ativo') returning id into v_wf_stage1;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF-stage-2', 'ativo') returning id into v_wf_stage2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF-stage-3', 'ativo') returning id into v_wf_stage3;

  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_stage1, v_ws, 'p1') returning id into v_post1;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_stage2, v_ws, 'p2') returning id into v_post2;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_stage3, v_ws, 'p3') returning id into v_post3;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  select detach_posts_from_flow(array[v_post1, v_post2, v_post3]) into v_result;
  assert (v_result->>'detached')::int = 3, format('staging detach must free all 3 posts, got %s', v_result);

  -- WF has 0 posts, limit is 2: attaching all 3 at once must be rejected whole
  v_raised := false;
  begin
    perform attach_posts_to_flow(array[v_post1, v_post2, v_post3], v_wf);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'plan_limit_exceeded:max_posts_per_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'attaching 3 posts into a workflow limited to 2 must raise plan_limit_exceeded';
  assert (select workflow_id from workflow_posts where id = v_post1) is null,
    'a rejected batch must not partially attach any post';

  -- attaching exactly the limit (2) succeeds
  select attach_posts_to_flow(array[v_post1, v_post2], v_wf) into v_result;
  assert (v_result->>'attached')::int = 2, format('expected attached=2, got %s', v_result);

  raise notice 'PASS 70.6b attach_posts_to_flow limit enforcement';
end $$;
rollback;

-- =====================================================================
-- 7. claim_posts_for_publishing regression (migration 2): an avulso post is
--    claimable and does not get stuck, now that the JOIN workflows/clientes
--    was replaced by reading wp.cliente_id directly
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_ig_acct uuid; v_post bigint;
  v_claimed_client bigint; v_processing_at timestamptz;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into instagram_accounts (client_id, instagram_user_id, encrypted_access_token)
    values (v_cli, 'ig_user', 'enc') returning id into v_ig_acct;

  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, status, scheduled_at)
    values (v_ws, v_cli, 'avulso-agendado', 'feed', 'agendado', now() - interval '10 minutes')
    returning id into v_post;

  create temp table ig_claim_container on commit drop as
    select * from claim_posts_for_publishing('container', 25);

  assert exists (select 1 from ig_claim_container where post_id = v_post),
    'an avulso post due for the container phase must be claimed';
  select client_id into v_claimed_client from ig_claim_container where post_id = v_post;
  assert v_claimed_client = v_cli, format('claim must return the correct client_id, got %s', v_claimed_client);

  select publish_processing_at into v_processing_at from workflow_posts where id = v_post;
  assert v_processing_at is not null, 'claimed avulso must not stay stuck (processing marker unset)';

  raise notice 'PASS 70.7 claim_posts_for_publishing avulso regression';
end $$;
rollback;

-- =====================================================================
-- 8. reorder_post_schedules accepts avulso ids of the given client
--    (migration 2 -- ownership checks read cliente_id/conta_id directly)
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint; v_new_at timestamptz := now() + interval '2 days';
  v_result jsonb; v_scheduled_after timestamptz;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (v_ws, v_cli, 'avulso', 'rascunho') returning id into v_post;

  select reorder_post_schedules(
    v_cli, v_ws,
    jsonb_build_array(jsonb_build_object('post_id', v_post, 'scheduled_at', v_new_at)),
    array['rascunho','revisao_interna','aprovado_interno','enviado_cliente','aprovado_cliente','correcao_cliente']
  ) into v_result;

  assert (v_result->>'ok')::boolean and (v_result->>'updated')::int = 1,
    format('reorder must accept the avulso id, got %s', v_result);
  select scheduled_at into v_scheduled_after from workflow_posts where id = v_post;
  assert v_scheduled_after = v_new_at, 'avulso scheduled_at must be updated';

  raise notice 'PASS 70.8 reorder_post_schedules avulso';
end $$;
rollback;

-- =====================================================================
-- 9. Notifications on an avulso post (migration 3): trg_notify_post_publish_failed
--    and a mencoes mention, both with the null-safe '/entregas?post=' link
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_mentioned_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint;
  v_membro bigint;
  v_notif record;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user), (v_admin), (v_mentioned_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_admin, v_ws, 'admin');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'ClienteX', 'CX', '#000') returning id into v_cli;
  insert into membros (user_id, conta_id, nome, cargo, tipo, crm_user_id)
    values (v_user, v_ws, 'Mencionado', 'Redator', 'clt', v_mentioned_user)
    returning id into v_membro;

  insert into workflow_posts (conta_id, cliente_id, titulo, status, scheduled_at)
    values (v_ws, v_cli, 'avulso-falha', 'agendado', now() - interval '1 hour')
    returning id into v_post;

  -- 9a. publish-failed notification carries the null-safe '?post=' link and client_name
  update workflow_posts
     set status = 'falha_publicacao', publish_error_code = 'TOKEN_EXPIRED'
   where id = v_post;

  select * into v_notif from notifications
   where workspace_id = v_ws and type = 'post_publish_failed'
     and (metadata->>'post_id')::bigint = v_post;
  assert v_notif.id is not null, 'publish-failed notification must be created for an avulso';
  assert v_notif.link = '/entregas?post=' || v_post,
    format('link must be the null-safe avulso form, got %s', v_notif.link);
  assert v_notif.metadata->>'client_name' = 'ClienteX',
    format('client_name must be resolved without the workflows join, got %s', v_notif.metadata->>'client_name');

  -- 9b. a mention on a workflow_post host (avulso) notifies with the same link shape
  insert into mencoes (conta_id, host_type, host_id, mentioned_membro_id, author_id)
    values (v_ws, 'workflow_post', v_post, v_membro, v_user);

  select * into v_notif from notifications
   where workspace_id = v_ws and type = 'mention' and user_id = v_mentioned_user;
  assert v_notif.id is not null, 'mention on an avulso host must notify the mentioned membro';
  assert v_notif.link = '/entregas?post=' || v_post,
    format('mention link must be the null-safe avulso form, got %s', v_notif.link);

  raise notice 'PASS 70.9 notifications on avulso posts';
end $$;
rollback;

-- =====================================================================
-- 10. Estudio (create_design/attach_design attaching to an avulso post):
--     NOT applicable. 20260722000002_drop_estudio_objects.sql removed the
--     whole feature (create_design/attach_design/save_design_blob/
--     detach_design/finalize_design_render + the designs/post_designs/
--     design_asset_refs/ai_image_generations tables) well before this plan
--     started (merged via PR #240) -- confirmed via grep, neither the
--     functions nor the `designs` table exist in the current schema.
--     20260830000003's own trailer comment reaches the same conclusion.
--     There is no "attach a design to an avulso" code path left to test.
-- =====================================================================

-- =====================================================================
-- 11. ACL: claim_posts_for_publishing / claim_posts_for_tiktok_publishing
--     must stay unreachable to anon/authenticated (pins the strong REVOKE;
--     regression test for the hosted-only default-privileges hole where
--     Supabase's default ACL grants EXECUTE to anon/authenticated on new
--     functions unless explicitly revoked)
-- =====================================================================
do $$
begin
  assert has_function_privilege('anon', 'claim_posts_for_publishing(text,int)', 'EXECUTE') = false,
    'anon must not be able to call claim_posts_for_publishing';
  assert has_function_privilege('authenticated', 'claim_posts_for_publishing(text,int)', 'EXECUTE') = false,
    'authenticated must not be able to call claim_posts_for_publishing';
  assert has_function_privilege('service_role', 'claim_posts_for_publishing(text,int)', 'EXECUTE') = true,
    'service_role must still be able to call claim_posts_for_publishing';

  assert has_function_privilege('anon', 'claim_posts_for_tiktok_publishing(text,int)', 'EXECUTE') = false,
    'anon must not be able to call claim_posts_for_tiktok_publishing';
  assert has_function_privilege('authenticated', 'claim_posts_for_tiktok_publishing(text,int)', 'EXECUTE') = false,
    'authenticated must not be able to call claim_posts_for_tiktok_publishing';
  assert has_function_privilege('service_role', 'claim_posts_for_tiktok_publishing(text,int)', 'EXECUTE') = true,
    'service_role must still be able to call claim_posts_for_tiktok_publishing';

  raise notice 'PASS 70.11 claim RPCs ACL';
end $$;
