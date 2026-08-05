\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- z1 reconciliation trigger + widened audit trigger (migration 20260805000001).
-- The invariant under test: custom_status_id set => status = behaves_as, kept
-- consistent on every write path, with audit rows snapshotting the custom
-- status nome.

begin;
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint; v_post bigint;
  v_design uuid; v_copy uuid; v_temp uuid;
  v_custom uuid; v_status text;
  v_ev record;
  v_events_before bigint; v_events_after bigint;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf, v_ws, 'P1') returning id into v_post;
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Em design', 'revisao_interna') returning id into v_design;
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Copy check', 'revisao_interna') returning id into v_copy;

  -- 1. Setting a custom status forces the canonical column and audits it
  update workflow_posts set custom_status_id = v_design where id = v_post;
  select status, custom_status_id into v_status, v_custom
    from workflow_posts where id = v_post;
  assert v_status = 'revisao_interna', format('status must follow behaves_as, got %s', v_status);
  assert v_custom = v_design, 'pointer must persist';

  select * into v_ev from post_status_events
    where post_id = v_post order by id desc limit 1;
  assert v_ev.from_status = 'rascunho' and v_ev.to_status = 'revisao_interna',
    'audit must record the canonical transition';
  assert v_ev.to_custom_status_id = v_design and v_ev.to_custom_nome = 'Em design',
    'audit must snapshot the custom status';

  -- 2. Custom-only move (canonical unchanged) still audited
  update workflow_posts set custom_status_id = v_copy where id = v_post;
  select status, custom_status_id into v_status, v_custom
    from workflow_posts where id = v_post;
  assert v_status = 'revisao_interna' and v_custom = v_copy, 'custom-only move';
  select * into v_ev from post_status_events
    where post_id = v_post order by id desc limit 1;
  assert v_ev.from_custom_nome = 'Em design' and v_ev.to_custom_nome = 'Copy check',
    'custom-only move must produce an audit row with both snapshots';

  -- 3. Unrelated write mentioning status with the same value keeps the pointer
  update workflow_posts set titulo = 'P1b', status = 'revisao_interna' where id = v_post;
  select custom_status_id into v_custom from workflow_posts where id = v_post;
  assert v_custom = v_copy, 'same-value status write must not clear the pointer';

  -- 4. Machine transition via record_post_status_change clears the pointer
  perform record_post_status_change(v_post, 'agendado', 'system');
  select status, custom_status_id into v_status, v_custom
    from workflow_posts where id = v_post;
  assert v_status = 'agendado' and v_custom is null,
    'machine transition must clear the custom pointer';
  select * into v_ev from post_status_events
    where post_id = v_post order by id desc limit 1;
  assert v_ev.from_custom_status_id = v_copy and v_ev.to_custom_status_id is null,
    'audit must record the detachment';

  -- 5. A publish-claim-style update (no status/custom in SET) leaves both alone
  update workflow_posts set status = 'aprovado_cliente', custom_status_id = null
    where id = v_post; -- reset
  update workflow_posts set custom_status_id = v_design where id = v_post;
  select count(*) into v_events_before from post_status_events where post_id = v_post;
  update workflow_posts set publish_processing_at = now() where id = v_post;
  select status, custom_status_id into v_status, v_custom
    from workflow_posts where id = v_post;
  assert v_status = 'revisao_interna' and v_custom = v_design,
    'processing-only update must not touch the pair';
  select count(*) into v_events_after from post_status_events where post_id = v_post;
  assert v_events_after = v_events_before, 'processing-only update must not audit';

  -- 6. Canonical pick with explicit null detaches and applies the status
  update workflow_posts set status = 'aprovado_interno', custom_status_id = null
    where id = v_post;
  select status, custom_status_id into v_status, v_custom
    from workflow_posts where id = v_post;
  assert v_status = 'aprovado_interno' and v_custom is null, 'explicit canonical pick';

  -- 7. Archiving a definition detaches posts, keeping the canonical status
  update workflow_posts set custom_status_id = v_design where id = v_post;
  update post_status_definitions set arquivado = true where id = v_design;
  select status, custom_status_id into v_status, v_custom
    from workflow_posts where id = v_post;
  assert v_custom is null, 'archive must detach posts';
  assert v_status = 'revisao_interna', 'archive must keep the canonical status';
  select * into v_ev from post_status_events
    where post_id = v_post order by id desc limit 1;
  assert v_ev.from_custom_nome = 'Em design' and v_ev.to_custom_status_id is null,
    'archive detach must audit with the nome snapshot';

  -- 8. Pointing at an archived definition is dropped (canonical untouched)
  update workflow_posts set custom_status_id = v_design where id = v_post;
  select status, custom_status_id into v_status, v_custom
    from workflow_posts where id = v_post;
  assert v_custom is null and v_status = 'revisao_interna',
    'archived definition must not be attachable';

  -- 9. Deleting a definition detaches first, snapshotting the nome
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Temporário', 'rascunho') returning id into v_temp;
  update workflow_posts set custom_status_id = v_temp where id = v_post;
  delete from post_status_definitions where id = v_temp;
  select status, custom_status_id into v_status, v_custom
    from workflow_posts where id = v_post;
  assert v_custom is null and v_status = 'rascunho', 'delete must detach posts';
  select * into v_ev from post_status_events
    where post_id = v_post order by id desc limit 1;
  assert v_ev.from_custom_nome = 'Temporário',
    'delete detach must snapshot the nome before the row disappears';

  -- 10. INSERT carrying a custom status is normalized too
  insert into workflow_posts (workflow_id, conta_id, titulo, custom_status_id)
    values (v_wf, v_ws, 'P2', v_copy) returning id into v_post;
  select status, custom_status_id into v_status, v_custom
    from workflow_posts where id = v_post;
  assert v_status = 'revisao_interna' and v_custom = v_copy,
    'INSERT with custom status must be normalized';

  raise notice 'PASS 61 custom status reconcile + audit';
end $$;
rollback;
