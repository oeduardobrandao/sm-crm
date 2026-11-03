\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, posts e fluxos (20261115000003_acesso_por_cliente_c1_posts.sql):
-- workflows, workflow_posts and every table that hangs off them (etapas, media,
-- threads, comments, approvals, versions, notes, references, targets, events,
-- processes, select options, portal tokens).
-- Roots (workflows, workflow_posts): read = scope OR "é dele" (posts only), write =
-- scope with no "é dele". Children: read and write through the visible parent.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventory: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

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

-- One row in every post child table for p_post (as superuser). p_author writes
-- the authored rows; participant rows go to every user in p_participants.
create or replace function pg_temp.seed_post_children(
  p_post bigint, p_conta uuid, p_author uuid, p_participants uuid[], p_prop bigint)
returns void language plpgsql as $f$
declare v_thread bigint; v_note bigint; v_appr bigint; v_proc bigint; v_u uuid;
begin
  insert into post_media (conta_id, post_id, r2_key, kind, mime_type, size_bytes, original_filename, uploaded_by)
    values (p_conta, p_post, 'k/' || p_post, 'image', 'image/png', 1, 'a.png', p_author);
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (p_post, p_conta, 'q', p_author, 'conteudo') returning id into v_thread;
  insert into post_comments (thread_id, author_id, content) values (v_thread, p_author, 'c');
  insert into post_content_versions (post_id, conta_id, source) values (p_post, p_conta, 'system');
  foreach v_u in array p_participants loop
    insert into post_discussao_participantes (post_id, conta_id, user_id) values (p_post, p_conta, v_u);
  end loop;
  insert into post_edit_suggestions (post_id, conta_id, token) values (p_post, p_conta, 't' || p_post);
  insert into post_media_notes (conta_id, post_id, slide_index_at_creation, media_kind, visibility, author_kind, author_user_id, body)
    values (p_conta, p_post, 0, 'image', 'internal', 'team', p_author, 'n') returning id into v_note;
  insert into post_media_note_replies (note_id, conta_id, author_kind, author_user_id, body)
    values (v_note, p_conta, 'team', p_author, 'r');
  insert into post_approvals (post_id, action) values (p_post, 'mensagem') returning id into v_appr;
  insert into post_approval_media_notes (post_approval_id, note_id) values (v_appr, v_note);
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento, created_by)
    values (p_conta, p_post, 'x', 'encerrado', 'removido', p_author) returning id into v_proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome) values (p_conta, v_proc, 1, 's');
  insert into post_process_events (conta_id, post_id, process_id, evento, origem)
    values (p_conta, p_post, v_proc, 'aplicado', 'system');
  insert into post_references (post_id, conta_id, kind, url) values (p_post, p_conta, 'link', 'https://x.test/r');
  insert into post_status_events (post_id, conta_id, to_status, source) values (p_post, p_conta, 'rascunho', 'system');
  insert into post_property_values (post_id, property_definition_id, value) values (p_post, p_prop, '"v"');
  -- post_targets: seeded by workflow_posts_z6_seed_targets on insert
  if not exists (select 1 from post_targets where post_id = p_post) then
    insert into post_targets (conta_id, post_id, platform) values (p_conta, p_post, 'geral');
  end if;
end $f$;

do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_ws_x uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_ca bigint; v_cb bigint; v_cc bigint; v_cd bigint; v_cx bigint;
  v_wa bigint; v_wb bigint; v_wx bigint;
  v_pa bigint; v_pb_own bigint; v_pb_other bigint; v_av_a bigint; v_av_b bigint; v_av_a_own bigint; v_pd bigint;
  v_ea bigint; v_eb_own bigint; v_eb_other bigint; v_ex bigint;
  v_membro bigint; v_membro_todos bigint; v_tpl bigint; v_prop bigint;
  v_proc_d bigint; v_step_own bigint; v_step_other bigint;
  v_n bigint; v_expected bigint; v_err text; v_t text; v_sql text;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@acpo.test'), (v_todos, 'todos@acpo.test'),
    (v_restr, 'restr@acpo.test'), (v_other, 'other@acpo.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_todos, v_ws, 'agent'),
    (v_restr, v_ws, 'agent'), (v_other, v_ws_x, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_todos, v_restr);
  update profiles set conta_id = v_ws_x, active_workspace_id = v_ws_x where id = v_other;
  update plans set feature_post_processes = true where id in (select plan_id from workspaces where id in (v_ws, v_ws_x));

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'C', 'C', '#333', 'ativo') returning id into v_cc;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'D', 'D', '#444', 'ativo') returning id into v_cd;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_other, v_ws_x, 'X', 'X', '#555', 'ativo') returning id into v_cx;

  -- restricted to A; B, C, D hidden
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca);
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Restr', v_restr) returning id into v_membro;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Todos', v_todos) returning id into v_membro_todos;

  insert into workflow_templates (conta_id, nome) values (v_ws, 'T') returning id into v_tpl;
  insert into template_property_definitions (template_id, conta_id, name, type) values (v_tpl, v_ws, 'P', 'text') returning id into v_prop;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_owner, v_ws, v_ca, 'WA', 'ativo') returning id into v_wa;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_owner, v_ws, v_cb, 'WB', 'ativo') returning id into v_wb;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_other, v_ws_x, v_cx, 'WX', 'ativo') returning id into v_wx;

  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wa, v_ws, 'pA') returning id into v_pa;
  insert into workflow_posts (workflow_id, conta_id, titulo, responsavel_id) values (v_wb, v_ws, 'pBown', v_membro) returning id into v_pb_own;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wb, v_ws, 'pBother') returning id into v_pb_other;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_ca, 'avA') returning id into v_av_a;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_cb, 'avB') returning id into v_av_b;
  insert into workflow_posts (conta_id, cliente_id, titulo, responsavel_id) values (v_ws, v_ca, 'avAown', v_membro) returning id into v_av_a_own;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_cd, 'pD') returning id into v_pd;

  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias) values (v_wa, 1, 'eA', 1) returning id into v_ea;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, responsavel_id) values (v_wb, 1, 'eBown', 1, v_membro) returning id into v_eb_own;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias) values (v_wb, 2, 'eBother', 1) returning id into v_eb_other;
  -- cross-tenant: an etapa in another workspace naming the restricted member's membros.id
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, responsavel_id) values (v_wx, 1, 'eX', 1, v_membro) returning id into v_ex;

  perform pg_temp.seed_post_children(v_pa, v_ws, v_owner, array[v_restr, v_todos], v_prop);
  perform pg_temp.seed_post_children(v_pb_own, v_ws, v_owner, array[v_restr, v_todos], v_prop);
  perform pg_temp.seed_post_children(v_pb_other, v_ws, v_owner, array[v_restr, v_todos], v_prop);
  -- the restricted member's own upload / thread on a hidden post (child "é dele")
  insert into post_media (conta_id, post_id, r2_key, kind, mime_type, size_bytes, original_filename, uploaded_by)
    values (v_ws, v_pb_other, 'k/own', 'image', 'image/png', 1, 'own.png', v_restr);
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (v_pb_other, v_ws, 'own', v_restr, 'conteudo');

  -- workflow children
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label) values (v_wa, v_prop, v_ws, 'a'), (v_wb, v_prop, v_ws, 'b');
  insert into portal_tokens (workflow_id, conta_id) values (v_wa, v_ws), (v_wb, v_ws);
  insert into portal_approvals (workflow_etapa_id, token, action) values (v_ea, 'ta', 'mensagem'), (v_eb_other, 'tb', 'mensagem');
  insert into workflow_events (workflow_id, conta_id, event_type, source) values (v_wa, v_ws, 'fluxo_editado', 'system'), (v_wb, v_ws, 'fluxo_editado', 'system');

  -- process on D (hidden, no own post) whose step is assigned to the restricted member
  insert into post_processes (conta_id, post_id, assinatura, estado) values (v_ws, v_pd, 'x', 'ativo') returning id into v_proc_d;
  insert into post_process_steps (conta_id, process_id, ordem, nome, responsavel_id) values (v_ws, v_proc_d, 1, 'own', v_membro) returning id into v_step_own;
  insert into post_process_steps (conta_id, process_id, ordem, nome) values (v_ws, v_proc_d, 2, 'other') returning id into v_step_other;
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------- roots
  -- post_in_a_visible
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_posts where id = %s', v_pa));
  assert v_n = 1, 'post_in_a_visible: ' || v_n;
  -- post_in_b_hidden
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_posts where id = %s', v_pb_other));
  assert v_n = 0, 'post_in_b_hidden: ' || v_n;
  -- own_post_in_b_visible (responsavel_id -> membros.crm_user_id)
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_posts where id = %s', v_pb_own));
  assert v_n = 1, 'own_post_in_b_visible: ' || v_n;
  -- other_post_in_b_of_same_workflow_hidden: only the own one of wB shows
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_posts where workflow_id = %s', v_wb));
  assert v_n = 1, 'other_post_in_b_of_same_workflow_hidden: ' || v_n;
  -- avulso_post_no_workflow_uses_own_cliente_id
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_posts where id = %s', v_av_a));
  assert v_n = 1, 'avulso_post_no_workflow_uses_own_cliente_id (A visible): ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_posts where id = %s', v_av_b));
  assert v_n = 0, 'avulso_post_no_workflow_uses_own_cliente_id (B hidden): ' || v_n;
  v_n := pg_temp.n_as(v_restr, 'select count(*) from workflow_posts');
  assert v_n = 4, 'restricted sees pA, avA, avAown and pBown only: ' || v_n;

  -- workflows: no "é dele" (user_id is not authorship, ruling), so wB stays hidden
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflows where id = %s', v_wa));
  assert v_n = 1, 'workflow_in_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflows where id = %s', v_wb));
  assert v_n = 0, 'workflow_in_b_hidden_even_with_own_items: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update workflows set titulo = titulo where id = %s', v_wb));
  assert v_n = 0, 'workflow_in_b_not_updatable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from workflows where id = %s', v_wb));
  assert v_n = 0, 'workflow_in_b_not_deletable: ' || v_n;

  -- workflow_etapas: through the workflow, plus "é dele" by responsavel_id
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_etapas where id = %s', v_ea));
  assert v_n = 1, 'etapa_in_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_etapas where id = %s', v_eb_other));
  assert v_n = 0, 'etapa_in_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_etapas where id = %s', v_eb_own));
  assert v_n = 1, 'own_etapa_in_b_visible: ' || v_n;
  -- own_etapa_cross_tenant_hidden: responsavel_id alone never crosses workspaces
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_etapas where id = %s', v_ex));
  assert v_n = 0, 'own_etapa_cross_tenant_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_todos, format('select count(*) from workflow_etapas where id = %s', v_ex));
  assert v_n = 0, 'todos does not see the other workspace etapa: ' || v_n;

  -- ---------------------------------------------------------------- writes on roots
  -- insert_post_into_b_denied (avulso in B and post in wB)
  v_err := pg_temp.err_as(v_restr, format(
    'insert into workflow_posts (conta_id, cliente_id, titulo) values (%L, %s, ''x'')', v_ws, v_cb));
  assert v_err = '42501', 'insert_post_into_b_denied (avulso): ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into workflow_posts (workflow_id, conta_id, titulo) values (%s, %L, ''x'')', v_wb, v_ws));
  assert v_err = '42501', 'insert_post_into_b_denied (in wB): ' || coalesce(v_err, 'inserted');
  -- insert into A still allowed
  v_err := pg_temp.err_as(v_restr, format(
    'insert into workflow_posts (conta_id, cliente_id, titulo) values (%L, %s, ''ok'')', v_ws, v_ca));
  assert v_err is null, 'insert_post_into_a_allowed: ' || coalesce(v_err, '');
  -- restricted_cannot_author_into_hidden_client_then_see_context: a post or etapa
  -- naming himself as responsavel in C is refused, so C never becomes "dele"
  v_err := pg_temp.err_as(v_restr, format(
    'insert into workflow_posts (conta_id, cliente_id, titulo, responsavel_id) values (%L, %s, ''x'', %s)', v_ws, v_cc, v_membro));
  assert v_err = '42501', 'restricted_cannot_author_into_hidden_client (post): ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, responsavel_id) values (%s, 9, ''x'', 1, %s)', v_wb, v_membro));
  assert v_err = '42501', 'restricted_cannot_author_into_hidden_client (etapa): ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (%L, %L, %s, ''x'', ''ativo'')', v_restr, v_ws, v_cc));
  assert v_err = '42501', 'restricted_cannot_create_workflow_in_hidden_client: ' || coalesce(v_err, 'inserted');
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_posts where cliente_id = %s', v_cc));
  assert v_n = 0, 'restricted_cannot_author_into_hidden_client (no row): ' || v_n;
  perform set_config('request.jwt.claims', json_build_object('sub', v_restr, 'role', 'authenticated')::text, true);
  assert not public.can_see_cliente_context(v_cc), 'restricted_cannot_author_into_hidden_client: no context for C';
  perform set_config('request.jwt.claims', '', true);

  -- move_own_post_to_hidden_client_denied (the move guard opened, so only RLS refuses)
  perform set_config('app.allow_post_move', 'on', true);
  v_err := pg_temp.err_as(v_restr, format('update workflow_posts set cliente_id = %s where id = %s', v_cb, v_av_a_own));
  assert v_err = '42501', 'move_own_post_to_hidden_client_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.err_as(v_restr, format('update workflow_posts set cliente_id = %s where id = %s', v_cb, v_av_a));
  assert v_err = '42501', 'move_post_to_hidden_client_denied: ' || coalesce(v_err, 'updated');
  perform set_config('app.allow_post_move', '', true);
  -- own_post_in_hidden_client_read_only: WITH CHECK has no "é dele"
  v_err := pg_temp.err_as(v_restr, format('update workflow_posts set titulo = ''y'' where id = %s', v_pb_own));
  assert v_err = '42501', 'own_post_in_hidden_client_read_only: ' || coalesce(v_err, 'updated');
  v_n := pg_temp.rows_as(v_restr, format('update workflow_posts set titulo = ''y'' where id = %s', v_pb_other));
  assert v_n = 0, 'hidden_post_not_updatable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update workflow_posts set titulo = ''y'' where id = %s', v_pa));
  assert v_n = 1, 'visible_post_updatable: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format('update workflows set cliente_id = %s where id = %s', v_cb, v_wa));
  assert v_err = '42501', 'move_workflow_to_hidden_client_denied: ' || coalesce(v_err, 'updated');
  v_n := pg_temp.rows_as(v_restr, format('update workflow_etapas set nome = nome where id = %s', v_eb_other));
  assert v_n = 0, 'hidden_etapa_not_updatable: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format('update workflow_etapas set nome = ''z'' where id = %s', v_eb_own));
  assert v_err = '42501', 'own_etapa_in_hidden_workflow_read_only: ' || coalesce(v_err, 'updated');

  -- ---------------------------------------------------------------- children
  -- own_post_in_b_media_visible (uploaded_by is the owner: visible only through the post)
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_media where post_id = %s', v_pb_own));
  assert v_n = 1, 'own_post_in_b_media_visible: ' || v_n;
  -- post_discussao_of_hidden_post_hidden (the row is his own; it follows the post)
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_discussao_participantes where post_id = %s', v_pb_other));
  assert v_n = 0, 'post_discussao_of_hidden_post_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_discussao_participantes where post_id in (%s, %s)', v_pa, v_pb_own));
  assert v_n = 2, 'post_discussao_of_visible_posts_visible: ' || v_n;

  -- every post child: pA and pBown visible, pBother hidden (rows authored by the owner)
  foreach v_t in array array['post_content_versions', 'post_edit_suggestions',
      'post_media_notes', 'post_processes', 'post_process_events', 'post_references',
      'post_status_events', 'post_targets', 'post_approvals', 'post_property_values'] loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where post_id = %s', v_t, v_pb_other));
    assert v_n = 0, format('%s_of_hidden_post_hidden: %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where post_id = %s', v_t, v_pa));
    assert v_n >= 1, format('%s_of_visible_post_visible: %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where post_id = %s', v_t, v_pb_own));
    assert v_n >= 1, format('%s_of_own_post_in_b_visible: %s', v_t, v_n);
  end loop;
  -- grandchildren
  v_sql := 'select count(*) from post_comments c join post_comment_threads t on t.id = c.thread_id where t.post_id = %s';
  v_n := pg_temp.n_as(v_restr, format(v_sql, v_pb_other));
  assert v_n = 0, 'post_comments_of_hidden_post_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_comments where thread_id in (select id from post_comment_threads where post_id = %s)', v_pb_own));
  assert v_n = 1, 'post_comments_of_own_post_visible: ' || v_n;
  foreach v_t in array array['post_media_note_replies', 'post_approval_media_notes'] loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where note_id in (select id from post_media_notes where post_id = %s)', v_t, v_pb_own));
    assert v_n = 1, format('%s_of_own_post_visible: %s', v_t, v_n);
  end loop;
  -- seen as superuser: the restricted member cannot reach the hidden post's notes at all
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_media_note_replies where note_id in (%s)',
    (select string_agg(id::text, ',') from post_media_notes where post_id = v_pb_other)));
  assert v_n = 0, 'post_media_note_replies_of_hidden_post_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_approval_media_notes where note_id in (%s)',
    (select string_agg(id::text, ',') from post_media_notes where post_id = v_pb_other)));
  assert v_n = 0, 'post_approval_media_notes_of_hidden_post_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_process_steps where process_id in (%s)',
    (select string_agg(id::text, ',') from post_processes where post_id = v_pb_other)));
  assert v_n = 0, 'post_process_steps_of_hidden_post_hidden: ' || v_n;

  -- child "é dele": his own upload / thread on a hidden post stays visible
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_media where post_id = %s', v_pb_other));
  assert v_n = 1, 'own_upload_on_hidden_post_visible (only his): ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_comment_threads where post_id = %s', v_pb_other));
  assert v_n = 1, 'own_thread_on_hidden_post_visible (only his): ' || v_n;

  -- post_process_steps "é dele": his step in D's process, not the other step
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_process_steps where id = %s', v_step_own));
  assert v_n = 1, 'own_process_step_in_hidden_client_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_process_steps where id = %s', v_step_other));
  assert v_n = 0, 'other_process_step_in_hidden_client_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_processes where id = %s', v_proc_d));
  assert v_n = 0, 'process_of_hidden_post_hidden: ' || v_n;
  perform set_config('request.jwt.claims', json_build_object('sub', v_restr, 'role', 'authenticated')::text, true);
  assert public.can_see_cliente_context(v_cd), 'own_process_step_gives_context_of_d';
  assert public.can_see_cliente_context(v_cb), 'own_post_gives_context_of_b';
  perform set_config('request.jwt.claims', '', true);

  -- workflow children: wA visible, wB hidden
  foreach v_t in array array['workflow_select_options', 'portal_tokens', 'workflow_events'] loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where workflow_id = %s', v_t, v_wb));
    assert v_n = 0, format('%s_of_hidden_workflow_hidden: %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where workflow_id = %s', v_t, v_wa));
    assert v_n >= 1, format('%s_of_visible_workflow_visible: %s', v_t, v_n);
  end loop;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from portal_approvals where workflow_etapa_id = %s', v_eb_other));
  assert v_n = 0, 'portal_approvals_of_hidden_etapa_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from portal_approvals where workflow_etapa_id = %s', v_ea));
  assert v_n = 1, 'portal_approvals_of_visible_etapa_visible: ' || v_n;

  -- child writes go through the visible parent
  v_err := pg_temp.err_as(v_restr, format(
    'insert into post_media (conta_id, post_id, r2_key, kind, mime_type, size_bytes, original_filename) values (%L, %s, ''k/x'', ''image'', ''image/png'', 1, ''x.png'')', v_ws, v_pb_other));
  assert v_err = '42501', 'insert_media_into_hidden_post_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into post_media (conta_id, post_id, r2_key, kind, mime_type, size_bytes, original_filename) values (%L, %s, ''k/y'', ''image'', ''image/png'', 1, ''y.png'')', v_ws, v_pa));
  assert v_err is null, 'insert_media_into_visible_post_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field) values (%s, %L, ''q'', %L, ''conteudo'')', v_pb_other, v_ws, v_restr));
  assert v_err = '42501', 'insert_thread_into_hidden_post_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into post_targets (conta_id, post_id, platform) values (%L, %s, ''tiktok'')', v_ws, v_pb_other));
  assert v_err = '42501', 'insert_target_into_hidden_post_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into post_edit_suggestions (post_id, conta_id, token, status) values (%s, %L, ''z'', ''rejected'')', v_pb_other, v_ws));
  assert v_err = '42501', 'insert_suggestion_into_hidden_post_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into portal_tokens (workflow_id, conta_id) values (%s, %L)', v_wb, v_ws));
  assert v_err = '42501', 'insert_portal_token_into_hidden_workflow_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label) values (%s, %s, %L, ''z'')', v_wb, v_prop, v_ws));
  assert v_err = '42501', 'insert_select_option_into_hidden_workflow_denied: ' || coalesce(v_err, 'inserted');
  v_n := pg_temp.rows_as(v_restr, format('delete from post_media where post_id = %s and uploaded_by <> %L', v_pb_other, v_restr));
  assert v_n = 0, 'delete_media_of_hidden_post_denied: ' || v_n;

  -- ---------------------------------------------------------------- todos / owner unchanged
  foreach v_t in array array['workflows', 'workflow_posts', 'post_comment_threads',
      'post_content_versions', 'post_edit_suggestions', 'post_media', 'post_media_notes',
      'post_media_note_replies', 'post_process_events', 'post_processes', 'post_process_steps',
      'post_references', 'post_status_events', 'post_targets', 'workflow_events',
      'workflow_select_options', 'portal_tokens'] loop
    execute format('select count(*) from %I where conta_id = %L', v_t, v_ws) into v_expected;
    v_n := pg_temp.n_as(v_todos, format('select count(*) from %I', v_t));
    assert v_n = v_expected, format('todos_counts_unchanged (%s): %s vs %s', v_t, v_n, v_expected);
    v_n := pg_temp.n_as(v_owner, format('select count(*) from %I', v_t));
    assert v_n = v_expected, format('owner_counts_unchanged (%s): %s vs %s', v_t, v_n, v_expected);
  end loop;
  -- post_discussao_participantes: own rows only, as before
  select count(*) into v_expected from post_discussao_participantes where conta_id = v_ws and user_id = v_todos;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from post_discussao_participantes');
  assert v_n = v_expected and v_n = 3, format('todos_counts_unchanged (post_discussao_participantes): %s vs %s', v_n, v_expected);
  -- tables without conta_id: the baseline goes through the parent
  select count(*) into v_expected from workflow_etapas e join workflows w on w.id = e.workflow_id where w.conta_id = v_ws;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from workflow_etapas');
  assert v_n = v_expected, format('todos_counts_unchanged (workflow_etapas): %s vs %s', v_n, v_expected);
  select count(*) into v_expected from post_comments c join post_comment_threads t on t.id = c.thread_id where t.conta_id = v_ws;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from post_comments');
  assert v_n = v_expected, format('todos_counts_unchanged (post_comments): %s vs %s', v_n, v_expected);
  select count(*) into v_expected from post_approvals a join workflow_posts p on p.id = a.post_id where p.conta_id = v_ws;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from post_approvals');
  assert v_n = v_expected, format('todos_counts_unchanged (post_approvals): %s vs %s', v_n, v_expected);
  select count(*) into v_expected from post_property_values a join workflow_posts p on p.id = a.post_id where p.conta_id = v_ws;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from post_property_values');
  assert v_n = v_expected, format('todos_counts_unchanged (post_property_values): %s vs %s', v_n, v_expected);
  select count(*) into v_expected from post_approval_media_notes a join post_media_notes n on n.id = a.note_id where n.conta_id = v_ws;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from post_approval_media_notes');
  assert v_n = v_expected, format('todos_counts_unchanged (post_approval_media_notes): %s vs %s', v_n, v_expected);
  select count(*) into v_expected from portal_approvals a join workflow_etapas e on e.id = a.workflow_etapa_id join workflows w on w.id = e.workflow_id where w.conta_id = v_ws;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from portal_approvals');
  assert v_n = v_expected, format('todos_counts_unchanged (portal_approvals): %s vs %s', v_n, v_expected);
  -- the todos agent still writes anywhere in the workspace
  v_err := pg_temp.err_as(v_todos, format(
    'insert into workflow_posts (conta_id, cliente_id, titulo) values (%L, %s, ''t'')', v_ws, v_cb));
  assert v_err is null, 'todos_insert_post_into_b_allowed: ' || coalesce(v_err, '');

  -- non_restricted_member_can_assign_restricted_to_b_post (the intended path to "é dele")
  v_n := pg_temp.rows_as(v_todos, format('update workflow_posts set responsavel_id = %s where id = %s', v_membro, v_pb_other));
  assert v_n = 1, 'non_restricted_member_can_assign_restricted_to_b_post: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from workflow_posts where id = %s', v_pb_other));
  assert v_n = 1, 'assigned_b_post_now_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_media where post_id = %s', v_pb_other));
  assert v_n = 2, 'assigned_b_post_media_now_visible: ' || v_n;
end $$;

-- explain_todos_short_circuits: as the todos agent, my_client_scope_all() (and
-- my_membro_ids()) are initplans, so can_access_cliente never runs per row.
select set_config('request.jwt.claims', json_build_object('sub', (select u.id from auth.users u where u.email = 'todos@acpo.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_plan text := ''; v_json json; r record;
begin
  for r in execute 'explain (verbose, costs off) select * from workflow_posts' loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  assert v_plan ~ 'Output: my_client_scope_all\(\)' and v_plan !~ 'Filter:[^\n]*my_client_scope_all',
    'workflow_posts: my_client_scope_all is an initplan: ' || v_plan;
  assert v_plan ~ 'Output: my_membro_ids\(\)' and v_plan !~ 'Filter:[^\n]*my_membro_ids',
    'workflow_posts: my_membro_ids is an initplan: ' || v_plan;
  -- scope term first in the OR, so the todos agent short-circuits before can_access_cliente
  -- PG 17 prints the initplan as (InitPlan N).col1, older versions as $N
  assert v_plan ~ 'Filter:[^\n]*(\(InitPlan [0-9]+\)\.col1|\$[0-9]+) OR can_access_cliente\(',
    'workflow_posts: scope initplan comes first in the filter: ' || v_plan;
  execute 'explain (format json) select * from workflow_posts' into v_json;
  assert v_json::text ~ '"Subplan Name": "InitPlan', 'workflow_posts: JSON plan has an InitPlan: ' || v_json::text;
  -- the only SubPlan is the pre-existing hashed conta_id IN (...), built once;
  -- nothing in the scope term is a per-row SubPlan
  assert replace(v_json -> 0 -> 'Plan' ->> 'Filter', 'hashed SubPlan', '') !~ 'SubPlan',
    'workflow_posts: no per-row SubPlan: ' || v_json::text;
end $$;
reset role;

rollback;
\echo 99_acesso_por_cliente_posts: ok
