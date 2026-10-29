\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;

-- mcp_send_post_to_client: the card's "Enviar ao cliente" write. Runs as the
-- service role (EXECUTE for service_role only), rechecks membership, records the
-- send as a workspace_user event with the actor, and answers a code instead of
-- raising when the post moved.
do $$
declare
  v_ws uuid := et_make_workspace('pro');  -- custom statuses need feature_custom_properties
  v_other_ws uuid := et_make_workspace('free');
  v_u uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint; v_post bigint;
  v_other_cli bigint; v_other_wf bigint; v_foreign bigint;
  v_custom uuid;
  v_res text;
  v_threw boolean;
  v_fn regprocedure := 'public.mcp_send_post_to_client(uuid,bigint,text,uuid)'::regprocedure;
begin
  -- (0) EXECUTE: service_role only
  assert not has_function_privilege('anon', v_fn, 'EXECUTE'), 'anon must not execute';
  assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'authenticated must not execute';
  assert has_function_privilege('service_role', v_fn, 'EXECUTE'), 'service_role executes';
  assert (select prosecdef from pg_proc where oid = v_fn), 'SECURITY DEFINER';

  insert into auth.users (id) values (v_u) on conflict do nothing;
  insert into workspace_members (workspace_id, user_id, role) values (v_ws, v_u, 'owner')
    on conflict do nothing;
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_u, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_u, 'wf', 'ativo') returning id into v_wf;
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Pronto para envio', 'aprovado_interno') returning id into v_custom;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, custom_status_id)
    values (v_wf, v_ws, 'p', 'feed', 'aprovado_interno', v_custom) returning id into v_post;
  assert (select custom_status_id from workflow_posts where id = v_post) = v_custom,
    'fixture: post starts on a custom status';

  -- (1) aprovado_interno → sent; custom status cleared; event with actor + workspace_user
  v_res := mcp_send_post_to_client(v_ws, v_post, 'aprovado_interno', v_u);
  assert v_res = 'sent', format('expected sent, got %s', v_res);
  assert (select status from workflow_posts where id = v_post) = 'enviado_cliente', 'status enviado_cliente';
  assert (select custom_status_id from workflow_posts where id = v_post) is null, 'custom_status_id NULL';
  assert exists (
    select 1 from post_status_events
     where post_id = v_post and from_status = 'aprovado_interno' and to_status = 'enviado_cliente'
       and source = 'workspace_user' and actor_user_id = v_u),
    'post_status_events row with source workspace_user and the actor';

  -- (2) second call → already_sent, no second send event
  v_res := mcp_send_post_to_client(v_ws, v_post, 'aprovado_interno', v_u);
  assert v_res = 'already_sent', format('expected already_sent, got %s', v_res);
  assert (select count(*) from post_status_events
           where post_id = v_post and to_status = 'enviado_cliente') = 1, 'one send event only';
  -- expected status equal to the current one still never re-sends
  v_res := mcp_send_post_to_client(v_ws, v_post, 'enviado_cliente', v_u);
  assert v_res = 'already_sent', format('expected already_sent (expected=enviado), got %s', v_res);

  -- (3) post moved after the card was drawn → stale, row unchanged
  update workflow_posts set status = 'revisao_interna' where id = v_post;
  v_res := mcp_send_post_to_client(v_ws, v_post, 'aprovado_interno', v_u);
  assert v_res = 'stale', format('expected stale, got %s', v_res);
  assert (select status from workflow_posts where id = v_post) = 'revisao_interna', 'stale leaves the row';

  -- (4) approved family → approved (also when the card expected that very status)
  update workflow_posts set status = 'aprovado_cliente' where id = v_post;
  v_res := mcp_send_post_to_client(v_ws, v_post, 'aprovado_interno', v_u);
  assert v_res = 'approved', format('expected approved, got %s', v_res);
  v_res := mcp_send_post_to_client(v_ws, v_post, 'aprovado_cliente', v_u);
  assert v_res = 'approved', format('expected approved (expected=aprovado_cliente), got %s', v_res);
  assert (select status from workflow_posts where id = v_post) = 'aprovado_cliente', 'approved untouched';
  update workflow_posts set status = 'agendado' where id = v_post;
  assert mcp_send_post_to_client(v_ws, v_post, 'agendado', v_u) = 'approved', 'agendado → approved';
  update workflow_posts set status = 'postado' where id = v_post;
  assert mcp_send_post_to_client(v_ws, v_post, 'postado', v_u) = 'approved', 'postado → approved';

  -- (5) falha_publicacao → failed, untouched
  update workflow_posts set status = 'falha_publicacao' where id = v_post;
  v_res := mcp_send_post_to_client(v_ws, v_post, 'falha_publicacao', v_u);
  assert v_res = 'failed', format('expected failed, got %s', v_res);
  assert (select status from workflow_posts where id = v_post) = 'falha_publicacao', 'failed untouched';

  -- (6) other sendable statuses work when expected matches (rascunho, correcao_cliente)
  update workflow_posts set status = 'correcao_cliente' where id = v_post;
  assert mcp_send_post_to_client(v_ws, v_post, 'correcao_cliente', v_u) = 'sent', 'correcao → sent';

  -- (7) another workspace's post id → stale, row unchanged (no status leak)
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_other_ws, v_u, 'O', 'O', '#000') returning id into v_other_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_other_ws, v_other_cli, v_u, 'wf2', 'ativo') returning id into v_other_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_other_wf, v_other_ws, 'foreign', 'feed', 'aprovado_interno') returning id into v_foreign;
  v_res := mcp_send_post_to_client(v_ws, v_foreign, 'aprovado_interno', v_u);
  assert v_res = 'stale', format('foreign post: expected stale, got %s', v_res);
  assert (select status from workflow_posts where id = v_foreign) = 'aprovado_interno', 'foreign row unchanged';
  update workflow_posts set status = 'aprovado_cliente' where id = v_foreign;
  assert mcp_send_post_to_client(v_ws, v_foreign, 'aprovado_interno', v_u) = 'stale',
    'foreign approved post still reads stale, never approved';
  -- unknown post id → stale
  assert mcp_send_post_to_client(v_ws, 999999999, 'aprovado_interno', v_u) = 'stale', 'missing post → stale';

  -- (8) non-member actor → P0403 workspace_unavailable, row unchanged
  update workflow_posts set status = 'aprovado_interno' where id = v_post;
  v_threw := false;
  begin
    perform mcp_send_post_to_client(v_ws, v_post, 'aprovado_interno', v_outsider);
  exception when others then
    assert sqlstate = 'P0403', format('expected P0403, got %s: %s', sqlstate, sqlerrm);
    assert sqlerrm = 'workspace_unavailable', format('expected workspace_unavailable, got %s', sqlerrm);
    v_threw := true;
  end;
  assert v_threw, 'non-member refused';
  assert (select status from workflow_posts where id = v_post) = 'aprovado_interno', 'refused send leaves the row';
  -- a member of v_ws calling for a workspace they do not belong to → refused
  v_threw := false;
  begin
    perform mcp_send_post_to_client(v_other_ws, v_post, 'aprovado_interno', v_u);
  exception when others then
    -- v_u is not a member of v_other_ws
    assert sqlstate = 'P0403', format('cross-workspace: expected P0403, got %s', sqlstate);
    v_threw := true;
  end;
  assert v_threw, 'membership checked against p_conta_id';

  raise notice 'mcp_send_post_to_client: all cases passed';
end $$;
rollback;
