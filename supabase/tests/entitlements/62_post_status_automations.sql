\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Status-entry automations (migration 20260805000002): z2 trigger behavior.
-- Runs as postgres (table owner); the RLS/feature-gate surface mirrors suite
-- 60 and is covered there for the definitions table — here the focus is the
-- execution semantics.

begin;
do $$
declare
  v_ws uuid; v_ws_b uuid; v_uid uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint; v_post bigint;
  v_design uuid;
  v_membro bigint; v_membro_user uuid := gen_random_uuid();
  v_foreign_membro bigint;
  v_admin uuid := gen_random_uuid();
  v_auto uuid; v_temp uuid;
  v_resp bigint; v_resp_status text; v_count bigint;
  v_notif record;
begin
  v_ws := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_uid), (v_membro_user), (v_admin);
  insert into workspace_members (user_id, workspace_id, role) values (v_admin, v_ws, 'admin');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf, v_ws, 'P1') returning id into v_post;
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Em design', 'revisao_interna') returning id into v_design;
  insert into membros (user_id, conta_id, nome, cargo, tipo, crm_user_id)
    values (v_uid, v_ws, 'Camila', 'Designer', 'clt', v_membro_user)
    returning id into v_membro;
  insert into membros (user_id, conta_id, nome, cargo, tipo)
    values (v_uid, v_ws_b, 'Alheio', 'Designer', 'clt')
    returning id into v_foreign_membro;

  -- 1. Cross-tenant FK: a rule cannot reference another tenant's definition
  begin
    insert into post_status_automations
      (conta_id, trigger_custom_status_id, action_type, config)
      values (v_ws_b, v_design, 'notify', '{"target":"responsavel"}');
    raise exception 'cross-tenant automation FK must be rejected';
  exception when foreign_key_violation then
    null; -- expected
  end;

  -- 2. XOR check: both or neither trigger targets rejected
  begin
    insert into post_status_automations
      (conta_id, trigger_status, trigger_custom_status_id, action_type, config)
      values (v_ws, 'rascunho', v_design, 'notify', '{}');
    raise exception 'double trigger target must be rejected';
  exception when check_violation then
    null; -- expected
  end;

  -- 3. assign_responsavel on entering the custom status
  insert into post_status_automations
    (conta_id, trigger_custom_status_id, action_type, config)
    values (v_ws, v_design, 'assign_responsavel',
            jsonb_build_object('membro_id', v_membro));

  update workflow_posts set custom_status_id = v_design where id = v_post;
  select responsavel_id into v_resp from workflow_posts where id = v_post;
  assert v_resp = v_membro, format('assign automation must set responsavel, got %s', v_resp);

  -- ...and the pre-existing post_assigned notification fired for the membro
  select count(*) into v_count from notifications
    where workspace_id = v_ws and user_id = v_membro_user and type = 'post_assigned';
  assert v_count = 1, format('post_assigned notification expected, got %s', v_count);

  -- 4. assign with a cross-tenant membro_id in config is ignored
  update workflow_posts set status = 'rascunho', custom_status_id = null,
                            responsavel_id = null where id = v_post;
  update post_status_automations
     set config = jsonb_build_object('membro_id', v_foreign_membro)
   where conta_id = v_ws and action_type = 'assign_responsavel';
  update workflow_posts set custom_status_id = v_design where id = v_post;
  select responsavel_id into v_resp from workflow_posts where id = v_post;
  assert v_resp is null, 'foreign membro_id must not be assigned';

  -- 5. notify roles on a canonical trigger (fires via record_post_status_change)
  insert into post_status_automations
    (conta_id, trigger_status, action_type, config)
    values (v_ws, 'falha_publicacao', 'notify',
            '{"target":"roles","roles":["owner","admin"]}');

  perform record_post_status_change(v_post, 'falha_publicacao', 'system');
  -- notifications.id is a uuid: assert on content, never on "latest row".
  select * into v_notif from notifications
    where workspace_id = v_ws and user_id = v_admin and type = 'post_status_automation'
      and metadata->>'status_label' = 'falha_publicacao';
  assert v_notif.id is not null,
    'roles notify must reach the admin with the raw canonical key as label';
  assert v_notif.metadata->>'post_title' = 'P1', 'metadata must carry the post title';

  -- 6. notify with custom trigger carries the definition nome as label
  update workflow_posts set status = 'rascunho', custom_status_id = null where id = v_post;
  insert into post_status_automations
    (conta_id, trigger_custom_status_id, action_type, config)
    values (v_ws, v_design, 'notify', '{"target":"roles","roles":["admin"]}')
    returning id into v_auto;
  update workflow_posts set custom_status_id = v_design where id = v_post;
  select count(*) into v_count from notifications
    where workspace_id = v_ws and user_id = v_admin and type = 'post_status_automation'
      and metadata->>'status_label' = 'Em design';
  assert v_count = 1, format('custom trigger must carry the nome, found %s rows', v_count);

  -- 7. ativo = false is a no-op
  update post_status_automations set ativo = false where id = v_auto;
  update workflow_posts set status = 'rascunho', custom_status_id = null where id = v_post;
  select count(*) into v_count from notifications
    where workspace_id = v_ws and type = 'post_status_automation';
  update workflow_posts set custom_status_id = v_design where id = v_post;
  select count(*) - v_count into v_count from notifications
    where workspace_id = v_ws and type = 'post_status_automation';
  assert v_count = 0, 'inactive automation must not fire';

  -- 8. Malformed config must not abort the status transition
  update post_status_automations set ativo = true, config = '{"membro_id":"abc"}'::jsonb
   where id = v_auto;
  update post_status_automations set config = '{"membro_id":"x"}'::jsonb
   where conta_id = v_ws and action_type = 'assign_responsavel';
  update workflow_posts set status = 'rascunho', custom_status_id = null,
                            responsavel_id = null where id = v_post;
  update workflow_posts set custom_status_id = v_design where id = v_post; -- must not raise
  select status, responsavel_id into v_resp_status, v_resp
    from (select status, responsavel_id from workflow_posts where id = v_post) s;
  assert v_resp_status = 'revisao_interna', 'transition must survive malformed configs';
  assert v_resp is null, 'malformed membro_id must not assign anyone';

  -- 9. Canonical rules fire on a custom-only entry (canonical unchanged),
  --    but NOT on detaching back to the plain canonical
  delete from post_status_automations where conta_id = v_ws; -- clean slate
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Briefing', 'rascunho') returning id into v_temp;
  insert into post_status_automations (conta_id, trigger_status, action_type, config)
    values (v_ws, 'rascunho', 'notify', '{"target":"roles","roles":["admin"]}');
  update workflow_posts set status = 'rascunho', custom_status_id = null where id = v_post;
  select count(*) into v_count from notifications
    where workspace_id = v_ws and type = 'post_status_automation';
  update workflow_posts set custom_status_id = v_temp where id = v_post; -- rascunho -> Briefing
  select count(*) - v_count into v_count from notifications
    where workspace_id = v_ws and type = 'post_status_automation';
  assert v_count = 1,
    format('canonical rule must fire on custom-only entry, fired %s times', v_count);
  select count(*) into v_count from notifications
    where workspace_id = v_ws and type = 'post_status_automation';
  update workflow_posts set custom_status_id = null where id = v_post; -- detach
  select count(*) - v_count into v_count from notifications
    where workspace_id = v_ws and type = 'post_status_automation';
  assert v_count = 0, 'detaching must not re-fire canonical rules';
  -- 9b. A malformed notify rule (scalar roles) must not suppress the valid
  --     rules evaluated after it in the same transition
  insert into post_status_automations (conta_id, trigger_status, action_type, config)
    values (v_ws, 'aprovado_interno', 'notify', '{"target":"roles","roles":"admin"}');
  insert into post_status_automations (conta_id, trigger_status, action_type, config)
    values (v_ws, 'aprovado_interno', 'notify', '{"target":"roles","roles":["admin"]}');
  select count(*) into v_count from notifications
    where workspace_id = v_ws and type = 'post_status_automation';
  update workflow_posts set status = 'aprovado_interno', custom_status_id = null
    where id = v_post;
  select count(*) - v_count into v_count from notifications
    where workspace_id = v_ws and type = 'post_status_automation';
  assert v_count = 1,
    format('valid rule must still notify next to a malformed one, got %s', v_count);

  delete from post_status_definitions where id = v_temp;
  delete from post_status_automations where conta_id = v_ws;
  -- Re-arm a custom-trigger rule so the cascade test below tests a real row.
  insert into post_status_automations (conta_id, trigger_custom_status_id, action_type, config)
    values (v_ws, v_design, 'notify', '{"target":"responsavel"}');

  -- 10. Deleting the definition cascades its automations
  delete from post_status_definitions where id = v_design;
  select count(*) into v_count from post_status_automations
    where conta_id = v_ws and trigger_custom_status_id is not null;
  assert v_count = 0, 'automations must cascade with their definition';

  raise notice 'PASS 62 post status automations';
end $$;
rollback;
