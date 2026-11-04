\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, RPCs SECURITY DEFINER (20261115000008_acesso_por_cliente_d_definer.sql):
-- the RPCs a signed-in user calls on posts, flows, processes, the post
-- discussion, edit suggestions and flow templates follow the same rules as the
-- RLS of the C1 migration, since they run without it:
--   * post: read if its client is accessible or it is "his" (responsavel_id);
--     edits (discussion, suggestion, board order, process) also on his post in
--     a hidden client; move, duplicate and closing a process are strict;
--   * flow (workflows): every write is strict, even when he reads the flow
--     through an own post/etapa;
--   * an id he can't read gets the RPC's own not-found error; an id he reads
--     but can't write, client_scope_restricted (42501);
--   * a status change whose automation hands his hidden post to someone else
--     fails like the direct UPDATE; tarefa_serie_aplicar_edicao can't hand off
--     his occurrence or series in a hidden client either.
-- todos/owner: unchanged (results vs a superuser baseline, zero scope calls).
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
-- error message raised by a statement as p_user, or NULL on success
create or replace function pg_temp.errm_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    return sqlerrm;
  end;
  execute 'reset role';
  return null;
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
create or replace function pg_temp.rev(p_proc bigint) returns integer language sql as $f$
  select revisao from post_processes where id = p_proc;
$f$;
grant execute on function pg_temp.rev(bigint) to authenticated;

do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_ca bigint; v_cb bigint;
  v_membro bigint; v_membro_todos bigint;
  v_tpl_a bigint; v_tpl_b bigint;
  v_wa bigint; v_wa2 bigint; v_wb bigint; v_wbh bigint;
  v_pa bigint; v_pa2 bigint; v_pa3 bigint; v_pb_own bigint; v_pb_other bigint; v_pbh bigint;
  v_av_a bigint; v_av_a2 bigint; v_av_b_own bigint; v_av_b_own2 bigint; v_av_b bigint;
  v_sug_a bigint; v_sug_b_own bigint; v_sug_b bigint;
  v_proc_a bigint; v_proc_b_own bigint; v_proc_b_own2 bigint; v_proc_b bigint;
  v_sb_own bigint; v_tb_occ bigint;
  v_comment_b bigint;
  v_etapas jsonb := '[{"nome":"e1","prazo_dias":1,"tipo_prazo":"corridos","tipo":"padrao"}]';
  v_regra text := '{"freq":"daily","intervalo":1,"modo":"calendario"}';
  v_n bigint; v_expected bigint; v_err text;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@acdf.test'), (v_todos, 'todos@acdf.test'), (v_restr, 'restr@acdf.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_todos, v_ws, 'agent'), (v_restr, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_todos, v_restr);
  update plans set feature_post_processes = true where id in (select plan_id from workspaces where id = v_ws);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;

  -- restricted to A; B hidden
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca);
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Restr', v_restr) returning id into v_membro;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Todos', v_todos) returning id into v_membro_todos;

  -- templates: A's flows use tpl_a only; tpl_b is used by flows of B
  insert into workflow_templates (conta_id, nome, etapas) values (v_ws, 'TA', v_etapas) returning id into v_tpl_a;
  insert into workflow_templates (conta_id, nome, etapas) values (v_ws, 'TB', v_etapas) returning id into v_tpl_b;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status, template_id) values (v_owner, v_ws, v_ca, 'WA', 'ativo', v_tpl_a) returning id into v_wa;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, template_id) values (v_owner, v_ws, v_ca, 'WA2', 'ativo', v_tpl_a) returning id into v_wa2;
  -- WB: he has an own post and an own etapa there (readable as context, never writable)
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, template_id) values (v_owner, v_ws, v_cb, 'WB', 'ativo', v_tpl_b) returning id into v_wb;
  -- WBh: nothing of his
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, template_id) values (v_owner, v_ws, v_cb, 'WBh', 'ativo', v_tpl_b) returning id into v_wbh;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, status) values (v_wa, 0, 'e1', 1, 'ativo'), (v_wa2, 0, 'e1', 1, 'ativo'), (v_wbh, 0, 'e1', 1, 'ativo');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, status, responsavel_id) values (v_wb, 0, 'e1', 1, 'ativo', v_membro);

  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wa, v_ws, 'pA') returning id into v_pa;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wa, v_ws, 'pA2') returning id into v_pa2;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wa, v_ws, 'pA3') returning id into v_pa3;
  insert into workflow_posts (workflow_id, conta_id, titulo, responsavel_id) values (v_wb, v_ws, 'pBown', v_membro) returning id into v_pb_own;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wb, v_ws, 'pBother') returning id into v_pb_other;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wbh, v_ws, 'pBh') returning id into v_pbh;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_ca, 'avA') returning id into v_av_a;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_ca, 'avA2') returning id into v_av_a2;
  insert into workflow_posts (conta_id, cliente_id, titulo, responsavel_id) values (v_ws, v_cb, 'avBown', v_membro) returning id into v_av_b_own;
  insert into workflow_posts (conta_id, cliente_id, titulo, responsavel_id, status) values (v_ws, v_cb, 'avBown2', v_membro, 'aprovado_cliente') returning id into v_av_b_own2;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_cb, 'avB') returning id into v_av_b;

  -- discussion: one thread with one comment on pA, pBown, pBother
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    values (v_pa, v_ws, '', v_owner, 'geral'), (v_pb_own, v_ws, '', v_owner, 'geral'), (v_pb_other, v_ws, '', v_owner, 'geral');
  insert into post_comments (thread_id, author_id, content)
    select t.id, v_owner, 'c' from post_comment_threads t where t.post_id in (v_pa, v_pb_own, v_pb_other);
  select c.id into v_comment_b from post_comments c join post_comment_threads t on t.id = c.thread_id where t.post_id = v_pb_other;

  insert into post_edit_suggestions (post_id, conta_id, token) values (v_pa, v_ws, 'sa') returning id into v_sug_a;
  insert into post_edit_suggestions (post_id, conta_id, token) values (v_pb_own, v_ws, 'sbo') returning id into v_sug_b_own;
  insert into post_edit_suggestions (post_id, conta_id, token) values (v_pb_other, v_ws, 'sb') returning id into v_sug_b;

  -- processes on avulso posts: two steps, the first active
  insert into post_processes (conta_id, post_id, assinatura, estado) values (v_ws, v_av_a, 'x', 'ativo') returning id into v_proc_a;
  insert into post_processes (conta_id, post_id, assinatura, estado) values (v_ws, v_av_b_own, 'x', 'ativo') returning id into v_proc_b_own;
  insert into post_processes (conta_id, post_id, assinatura, estado) values (v_ws, v_av_b, 'x', 'ativo') returning id into v_proc_b;
  insert into post_process_steps (conta_id, process_id, ordem, nome, estado)
    select v_ws, p, 0, 's0', 'ativo' from unnest(array[v_proc_a, v_proc_b_own, v_proc_b]) p;
  insert into post_process_steps (conta_id, process_id, ordem, nome) values (v_ws, v_proc_a, 1, 's1'), (v_ws, v_proc_b_own, 1, 's1');
  -- a step of his on a post he can't read (B, not his): read only
  insert into post_process_steps (conta_id, process_id, ordem, nome, responsavel_id) values (v_ws, v_proc_b, 1, 's1', v_membro);
  -- approval step on his own hidden post, for the reassigning automation
  insert into post_processes (conta_id, post_id, assinatura, estado) values (v_ws, v_av_b_own2, 'x', 'ativo') returning id into v_proc_b_own2;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado) values (v_ws, v_proc_b_own2, 0, 'ap', 'aprovacao_cliente', 'ativo');
  insert into post_process_steps (conta_id, process_id, ordem, nome, prazo_efetivo) values (v_ws, v_proc_b_own2, 1, 's1', now() + interval '1 day');

  -- his series and occurrence in B (é dele by responsavel)
  insert into tarefa_series (conta_id, user_id, freq, intervalo, modo, inicio, titulo, cliente_id, responsavel_id)
    values (v_ws, v_owner, 'daily', 1, 'calendario', current_date, 'sBown', v_cb, v_membro) returning id into v_sb_own;
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id, responsavel_id, serie_id, data_limite)
    values (v_ws, v_owner, 'occ', 'pendente', v_cb, v_membro, v_sb_own, current_date) returning id into v_tb_occ;
  perform set_config('request.jwt.claims', '', true);

  -- =========================================================== discussão
  -- post_discussao_post_do_chamador gates enviar, marcar_lido, seguir, participação
  v_err := pg_temp.errm_as(v_restr, format('select post_discussao_enviar(%s, ''oi'')', v_pb_other));
  assert v_err = 'post_not_found', 'discussao_enviar_hidden_post_unconfirmed: ' || coalesce(v_err, 'sent');
  v_err := pg_temp.errm_as(v_restr, format('select post_discussao_marcar_lido(%s, %s)', v_pb_other, v_comment_b));
  assert v_err = 'post_not_found', 'discussao_marcar_lido_hidden_post_unconfirmed: ' || coalesce(v_err, 'marked');
  v_err := pg_temp.errm_as(v_restr, format('select post_discussao_seguir(%s, true)', v_pb_other));
  assert v_err = 'post_not_found', 'discussao_seguir_hidden_post_unconfirmed: ' || coalesce(v_err, 'followed');
  v_err := pg_temp.errm_as(v_restr, format('select * from get_post_discussao_participacao(%s)', v_pb_other));
  assert v_err = 'post_not_found', 'discussao_participacao_hidden_post_unconfirmed: ' || coalesce(v_err, 'read');
  v_err := pg_temp.errm_as(v_restr, format('select post_discussao_enviar(%s, ''oi'')', v_pb_own));
  assert v_err is null, 'discussao_enviar_own_hidden_post_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_restr, format('select post_discussao_enviar(%s, ''oi'')', v_pa));
  assert v_err is null, 'discussao_enviar_post_in_a_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select post_discussao_enviar(%s, ''oi'')', v_pb_other));
  assert v_err is null, 'todos_discussao_enviar_b_allowed: ' || coalesce(v_err, '');

  -- get_post_discussao_nao_lidas: rows only for posts he reads; todos/owner = baseline
  select count(distinct t.post_id) into v_expected
    from post_comment_threads t join post_comments c on c.thread_id = t.id
    join workflow_posts wp on wp.id = t.post_id
   where wp.workflow_id in (v_wa, v_wb);
  assert v_expected = 3, 'nao_lidas baseline: ' || v_expected;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from get_post_discussao_nao_lidas(null, array[%s, %s]::bigint[])', v_wa, v_wb));
  assert v_n = 2, 'nao_lidas_restricted_only_readable_posts: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from get_post_discussao_nao_lidas(array[%s]::bigint[], null)', v_pb_other));
  assert v_n = 0, 'nao_lidas_restricted_hidden_post_by_id_empty: ' || v_n;
  v_n := pg_temp.n_as(v_todos, format('select count(*) from get_post_discussao_nao_lidas(null, array[%s, %s]::bigint[])', v_wa, v_wb));
  assert v_n = v_expected, 'nao_lidas_todos_unchanged: ' || v_n;
  v_n := pg_temp.n_as(v_owner, format('select count(*) from get_post_discussao_nao_lidas(null, array[%s, %s]::bigint[])', v_wa, v_wb));
  assert v_n = v_expected, 'nao_lidas_owner_unchanged: ' || v_n;

  -- =========================================================== edit suggestions
  v_err := pg_temp.errm_as(v_restr, format('select reject_edit_suggestion(%s)', v_sug_b));
  assert v_err = 'Suggestion not found', 'reject_suggestion_hidden_post_unconfirmed: ' || coalesce(v_err, 'rejected');
  v_err := pg_temp.errm_as(v_restr, format('select accept_edit_suggestion(%s, null, array[''texto''], null)', v_sug_b));
  assert v_err = 'Suggestion not found', 'accept_suggestion_hidden_post_unconfirmed: ' || coalesce(v_err, 'accepted');
  -- past the scope check: the suggestion has no changed field
  v_err := pg_temp.errm_as(v_restr, format('select accept_edit_suggestion(%s, null, array[''texto''], null)', v_sug_a));
  assert v_err = 'no_fields', 'accept_suggestion_in_a_reaches_body: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.errm_as(v_restr, format('select accept_edit_suggestion(%s, null, array[''texto''], null)', v_sug_b_own));
  assert v_err = 'no_fields', 'accept_suggestion_own_hidden_post_reaches_body: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.errm_as(v_restr, format('select reject_edit_suggestion(%s)', v_sug_b_own));
  assert v_err is null, 'reject_suggestion_own_hidden_post_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select reject_edit_suggestion(%s)', v_sug_b));
  assert v_err is null, 'todos_reject_suggestion_b_allowed: ' || coalesce(v_err, '');

  -- =========================================================== board order
  v_err := pg_temp.errm_as(v_restr, format('select reorder_board_posts(array[%s]::bigint[], array[1]::float8[])', v_pb_other));
  assert v_err = 'post_not_found', 'reorder_board_hidden_post_unconfirmed: ' || coalesce(v_err, 'reordered');
  v_err := pg_temp.errm_as(v_restr, format('select reorder_board_posts(array[%s, %s]::bigint[], array[1, 2]::float8[])', v_pb_own, v_pa));
  assert v_err is null, 'reorder_board_own_hidden_and_a_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select reorder_board_posts(array[%s]::bigint[], array[3]::float8[])', v_pb_other));
  assert v_err is null, 'todos_reorder_board_b_allowed: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('select reorder_workflow_positions(array[%s]::bigint[], array[1])', v_wbh));
  assert v_err = 'workflow_not_found', 'reorder_workflows_hidden_unconfirmed: ' || coalesce(v_err, 'reordered');
  v_err := pg_temp.errm_as(v_restr, format('select reorder_workflow_positions(array[%s]::bigint[], array[1])', v_wb));
  assert v_err = 'client_scope_restricted', 'reorder_workflows_readable_by_own_item_strict: ' || coalesce(v_err, 'reordered');
  v_err := pg_temp.errm_as(v_restr, format('select reorder_workflow_positions(array[%s, %s]::bigint[], array[1, 2])', v_wa, v_wa2));
  assert v_err is null, 'reorder_workflows_in_a_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select reorder_workflow_positions(array[%s]::bigint[], array[9])', v_wbh));
  assert v_err is null, 'todos_reorder_workflows_b_allowed: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('select reorder_fluxos_board(array[%s]::bigint[], array[1], ''{}''::bigint[], ''{}''::int[])', v_wb));
  assert v_err = 'client_scope_restricted', 'reorder_fluxos_readable_flow_strict: ' || coalesce(v_err, 'reordered');
  v_err := pg_temp.errm_as(v_restr, format('select reorder_fluxos_board(array[%s]::bigint[], array[1], ''{}''::bigint[], ''{}''::int[])', v_wbh));
  assert v_err = 'workflow_not_found', 'reorder_fluxos_hidden_flow_unconfirmed: ' || coalesce(v_err, 'reordered');
  v_err := pg_temp.errm_as(v_restr, format('select reorder_fluxos_board(''{}''::bigint[], ''{}''::int[], array[%s]::bigint[], array[2])', v_proc_b));
  assert v_err = 'process_not_found', 'reorder_fluxos_hidden_process_unconfirmed: ' || coalesce(v_err, 'reordered');
  v_err := pg_temp.errm_as(v_restr, format('select reorder_fluxos_board(array[%s]::bigint[], array[1], array[%s, %s]::bigint[], array[2, 3])', v_wa, v_proc_b_own, v_proc_a));
  assert v_err is null, 'reorder_fluxos_a_and_own_process_allowed: ' || coalesce(v_err, '');

  -- =========================================================== moves (strict)
  v_err := pg_temp.errm_as(v_restr, format('select attach_posts_to_flow(array[%s]::bigint[], %s)', v_av_b, v_wa));
  assert v_err = 'post_not_found', 'attach_hidden_post_unconfirmed: ' || coalesce(v_err, 'attached');
  v_err := pg_temp.errm_as(v_restr, format('select attach_posts_to_flow(array[%s]::bigint[], %s)', v_av_b_own, v_wa));
  assert v_err = 'client_scope_restricted', 'attach_own_hidden_post_denied: ' || coalesce(v_err, 'attached');
  v_err := pg_temp.errm_as(v_restr, format('select attach_posts_to_flow(array[%s]::bigint[], %s)', v_av_a2, v_wbh));
  assert v_err = 'workflow_not_found', 'attach_into_hidden_flow_unconfirmed: ' || coalesce(v_err, 'attached');
  v_err := pg_temp.errm_as(v_restr, format('select attach_posts_to_flow(array[%s]::bigint[], %s)', v_av_a2, v_wb));
  assert v_err = 'client_scope_restricted', 'attach_into_readable_hidden_flow_denied: ' || coalesce(v_err, 'attached');
  v_err := pg_temp.errm_as(v_restr, format('select attach_posts_to_flow(array[%s]::bigint[], %s)', v_av_a2, v_wa));
  assert v_err is null, 'attach_in_a_allowed: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('select detach_posts_from_flow(array[%s]::bigint[])', v_pb_other));
  assert v_err = 'post_not_found', 'detach_hidden_post_unconfirmed: ' || coalesce(v_err, 'detached');
  v_err := pg_temp.errm_as(v_restr, format('select detach_posts_from_flow(array[%s]::bigint[])', v_pb_own));
  assert v_err = 'client_scope_restricted', 'detach_own_hidden_post_denied: ' || coalesce(v_err, 'detached');
  v_err := pg_temp.errm_as(v_restr, format('select detach_posts_from_flow(array[%s]::bigint[])', v_pa3));
  assert v_err is null, 'detach_in_a_allowed: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('select move_posts_to_existing_flow(array[%s]::bigint[], %s, %s)', v_pb_other, v_wb, v_wbh));
  assert v_err = 'post_not_found', 'move_existing_hidden_post_unconfirmed: ' || coalesce(v_err, 'moved');
  v_err := pg_temp.errm_as(v_restr, format('select move_posts_to_existing_flow(array[%s]::bigint[], %s, %s)', v_pb_own, v_wb, v_wbh));
  assert v_err = 'client_scope_restricted', 'move_existing_own_hidden_post_denied: ' || coalesce(v_err, 'moved');
  v_err := pg_temp.errm_as(v_restr, format('select move_posts_to_existing_flow(array[%s]::bigint[], %s, %s)', v_pa2, v_wa, v_wbh));
  assert v_err = 'workflow_not_found', 'move_existing_into_hidden_flow_unconfirmed: ' || coalesce(v_err, 'moved');
  v_err := pg_temp.errm_as(v_restr, format('select move_posts_to_existing_flow(array[%s]::bigint[], %s, %s)', v_pa2, v_wa, v_wa2));
  assert v_err is null, 'move_existing_in_a_allowed: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('select move_posts_to_new_flow(array[%s]::bigint[], %s, ''n'', 0)', v_pb_other, v_wb));
  assert v_err = 'post_not_found', 'move_new_hidden_post_unconfirmed: ' || coalesce(v_err, 'moved');
  v_err := pg_temp.errm_as(v_restr, format('select move_posts_to_new_flow(array[%s]::bigint[], %s, ''n'', 0)', v_pb_own, v_wb));
  assert v_err = 'client_scope_restricted', 'move_new_own_hidden_post_denied: ' || coalesce(v_err, 'moved');
  v_err := pg_temp.errm_as(v_restr, format('select move_posts_to_new_flow(array[%s]::bigint[], %s, ''n'', 0)', v_pa2, v_wa2));
  assert v_err is null, 'move_new_in_a_allowed: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('select detach_posts_keeping_process(array[%s]::bigint[], %s, ''fp'', now(), gen_random_uuid())', v_pbh, v_wbh));
  assert v_err = 'workflow_not_found', 'detach_keeping_hidden_flow_unconfirmed: ' || coalesce(v_err, 'detached');
  v_err := pg_temp.errm_as(v_restr, format('select detach_posts_keeping_process(array[%s]::bigint[], %s, ''fp'', now(), gen_random_uuid())', v_pb_own, v_wb));
  assert v_err = 'client_scope_restricted', 'detach_keeping_readable_hidden_flow_denied: ' || coalesce(v_err, 'detached');
  -- past the scope check: stale fingerprint
  v_err := pg_temp.errm_as(v_restr, format('select detach_posts_keeping_process(array[%s]::bigint[], %s, ''fp'', now(), gen_random_uuid())', v_pa, v_wa));
  assert v_err = 'workflow_changed', 'detach_keeping_in_a_reaches_body: ' || coalesce(v_err, 'detached');

  v_err := pg_temp.errm_as(v_restr, format('select attach_post_closing_process(%s, %s, 1)', v_av_b, v_wa));
  assert v_err = 'post_not_found', 'attach_closing_hidden_post_unconfirmed: ' || coalesce(v_err, 'attached');
  v_err := pg_temp.errm_as(v_restr, format('select attach_post_closing_process(%s, %s, 1)', v_av_b_own, v_wa));
  assert v_err = 'client_scope_restricted', 'attach_closing_own_hidden_post_denied: ' || coalesce(v_err, 'attached');
  v_err := pg_temp.errm_as(v_restr, format('select attach_post_closing_process(%s, %s, 1)', v_av_a, v_wbh));
  assert v_err = 'workflow_not_found', 'attach_closing_hidden_flow_unconfirmed: ' || coalesce(v_err, 'attached');
  v_err := pg_temp.errm_as(v_restr, format('select attach_post_closing_process(%s, %s, 1)', v_av_a, v_wb));
  assert v_err = 'client_scope_restricted', 'attach_closing_readable_hidden_flow_denied: ' || coalesce(v_err, 'attached');

  -- =========================================================== processes (follow the post)
  v_err := pg_temp.errm_as(v_restr, format('select apply_post_process(%s, %s, ''fp'', 0)', v_av_b, v_tpl_a));
  assert v_err = 'post_not_found', 'apply_process_hidden_post_unconfirmed: ' || coalesce(v_err, 'applied');
  v_err := pg_temp.errm_as(v_restr, format('select apply_post_process(%s, %s, ''fp'', 0)', v_av_b_own, v_tpl_a));
  assert v_err = 'post_has_active_process', 'apply_process_own_hidden_post_reaches_body: ' || coalesce(v_err, 'applied');

  -- his own step on a post he can't read does not open the process to him
  v_err := pg_temp.errm_as(v_restr, format('select transition_post_process(%s, %s, ''voltar'')', v_proc_b, pg_temp.rev(v_proc_b)));
  assert v_err = 'process_not_found', 'transition_hidden_post_own_step_unconfirmed: ' || coalesce(v_err, 'transitioned');
  v_err := pg_temp.errm_as(v_restr, format('select transition_post_process(%s, %s, ''voltar'')', v_proc_b_own, pg_temp.rev(v_proc_b_own)));
  assert v_err = 'no_previous_step', 'transition_own_hidden_post_reaches_body: ' || coalesce(v_err, 'transitioned');
  v_err := pg_temp.errm_as(v_restr, format('select update_post_process_step(%s, %s, 1, null, now() + interval ''2 days'')', v_proc_b, pg_temp.rev(v_proc_b)));
  assert v_err = 'process_not_found', 'update_step_hidden_post_unconfirmed: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('select update_post_process_step(%s, %s, 1, %s, now() + interval ''2 days'')', v_proc_b_own, pg_temp.rev(v_proc_b_own), v_membro_todos));
  assert v_err is null, 'update_step_own_hidden_post_allowed: ' || coalesce(v_err, '');
  -- self-assigning a step on the hidden post stays refused (4a trigger)
  v_err := pg_temp.errm_as(v_restr, format('select update_post_process_step(%s, %s, 1, %s, now() + interval ''2 days'')', v_proc_b_own, pg_temp.rev(v_proc_b_own), v_membro));
  assert v_err = 'client_scope_restricted', 'update_step_self_assign_hidden_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('select resolve_post_process_rascunho_banner(%s, now(), false)', v_proc_b));
  assert v_err = 'process_not_found', 'resolve_process_banner_hidden_unconfirmed: ' || coalesce(v_err, 'resolved');
  v_err := pg_temp.errm_as(v_restr, format('select resolve_post_process_rascunho_banner(%s, now(), false)', v_proc_b_own));
  assert v_err = 'ciclo_changed', 'resolve_process_banner_own_hidden_reaches_body: ' || coalesce(v_err, 'resolved');
  v_err := pg_temp.errm_as(v_restr, format('select remove_post_process(%s, %s)', v_proc_b, pg_temp.rev(v_proc_b)));
  assert v_err = 'process_not_found', 'remove_process_hidden_unconfirmed: ' || coalesce(v_err, 'removed');
  v_err := pg_temp.errm_as(v_restr, format('select remove_post_process(%s, %s)', v_proc_b_own, pg_temp.rev(v_proc_b_own)));
  assert v_err = 'client_scope_restricted', 'remove_process_own_hidden_strict: ' || coalesce(v_err, 'removed');
  v_err := pg_temp.errm_as(v_todos, format('select transition_post_process(%s, %s, ''voltar'')', v_proc_b, pg_temp.rev(v_proc_b)));
  assert v_err = 'no_previous_step', 'todos_transition_b_reaches_body: ' || coalesce(v_err, 'transitioned');

  -- a status change whose automation hands his hidden post to someone else:
  -- same 42501 as the direct UPDATE (4a ruling)
  insert into post_status_automations (conta_id, trigger_status, action_type, config)
    values (v_ws, 'rascunho', 'assign_responsavel', jsonb_build_object('membro_id', v_membro_todos::text));
  v_err := pg_temp.errm_as(v_restr, format(
    'select transition_post_process(%s, %s, ''avancar'', ''voltar_rascunho'', ''aprovado_cliente'')', v_proc_b_own2, pg_temp.rev(v_proc_b_own2)));
  assert v_err = 'client_scope_restricted', 'transition_with_reassigning_automation_denied: ' || coalesce(v_err, 'transitioned');
  assert (select responsavel_id from workflow_posts where id = v_av_b_own2) = v_membro, 'own hidden post kept its responsavel';
  delete from post_status_automations where conta_id = v_ws;
  v_err := pg_temp.errm_as(v_restr, format(
    'select transition_post_process(%s, %s, ''avancar'', ''voltar_rascunho'', ''aprovado_cliente'')', v_proc_b_own2, pg_temp.rev(v_proc_b_own2)));
  assert v_err is null, 'transition_own_hidden_post_status_change_allowed: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('select remove_post_process(%s, %s)', v_proc_a, pg_temp.rev(v_proc_a)));
  assert v_err is null, 'remove_process_in_a_allowed: ' || coalesce(v_err, '');

  -- =========================================================== flow writes (strict)
  v_err := pg_temp.errm_as(v_restr, format('select advance_workflow_from_approval(%s, 0, ''manter'')', v_wbh));
  assert v_err = 'workflow_not_found', 'advance_hidden_flow_unconfirmed: ' || coalesce(v_err, 'advanced');
  v_err := pg_temp.errm_as(v_restr, format('select advance_workflow_from_approval(%s, 0, ''manter'')', v_wb));
  assert v_err = 'client_scope_restricted', 'advance_readable_hidden_flow_denied: ' || coalesce(v_err, 'advanced');
  v_err := pg_temp.errm_as(v_restr, format('select advance_workflow_from_approval(%s, 0, ''manter'')', v_wa));
  assert v_err = 'etapa_changed', 'advance_in_a_reaches_body: ' || coalesce(v_err, 'advanced');
  v_err := pg_temp.errm_as(v_restr, format('select resolve_workflow_rascunho_banner(%s, now(), false)', v_wbh));
  assert v_err = 'workflow_not_found', 'resolve_flow_banner_hidden_unconfirmed: ' || coalesce(v_err, 'resolved');
  v_err := pg_temp.errm_as(v_restr, format('select resolve_workflow_rascunho_banner(%s, now(), false)', v_wb));
  assert v_err = 'client_scope_restricted', 'resolve_flow_banner_readable_hidden_denied: ' || coalesce(v_err, 'resolved');
  v_err := pg_temp.errm_as(v_restr, format('select resolve_workflow_rascunho_banner(%s, now(), false)', v_wa));
  assert v_err = 'ciclo_changed', 'resolve_flow_banner_in_a_reaches_body: ' || coalesce(v_err, 'resolved');
  v_err := pg_temp.errm_as(v_restr, format('select migrate_workflow_template(%s, %s, ''[]'', 0, ''padrao'', %s, 0)', v_wbh, v_tpl_a, v_tpl_b));
  assert v_err = 'workflow_not_found', 'migrate_template_hidden_flow_unconfirmed: ' || coalesce(v_err, 'migrated');
  v_err := pg_temp.errm_as(v_restr, format('select migrate_workflow_template(%s, %s, ''[]'', 0, ''padrao'', %s, 0)', v_wb, v_tpl_a, v_tpl_b));
  assert v_err = 'client_scope_restricted', 'migrate_template_readable_hidden_flow_denied: ' || coalesce(v_err, 'migrated');
  v_err := pg_temp.errm_as(v_restr, format('select migrate_workflow_template(%s, %s, ''[]'', 0, ''padrao'', %s, 0)', v_wa, v_tpl_b, v_tpl_a));
  assert v_err = 'empty_etapas', 'migrate_template_in_a_reaches_body: ' || coalesce(v_err, 'migrated');
  v_err := pg_temp.errm_as(v_todos, format('select advance_workflow_from_approval(%s, 0, ''manter'')', v_wbh));
  assert v_err = 'etapa_changed', 'todos_advance_b_reaches_body: ' || coalesce(v_err, 'advanced');

  -- =========================================================== duplicate (insert in the source client: strict)
  v_err := pg_temp.errm_as(v_restr, format('select duplicate_post(%s, false)', v_pb_other));
  assert v_err = 'not_found', 'duplicate_post_hidden_unconfirmed: ' || coalesce(v_err, 'duplicated');
  v_err := pg_temp.errm_as(v_restr, format('select duplicate_post(%s, false)', v_pb_own));
  assert v_err = 'client_scope_restricted', 'duplicate_own_hidden_post_denied: ' || coalesce(v_err, 'duplicated');
  v_err := pg_temp.errm_as(v_restr, format('select duplicate_post(%s, false)', v_pa));
  assert v_err is null, 'duplicate_post_in_a_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select duplicate_post(%s, false)', v_pb_other));
  assert v_err is null, 'todos_duplicate_post_b_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_restr, format('select duplicate_workflow(%s, false)', v_wbh));
  assert v_err = 'not_found', 'duplicate_workflow_hidden_unconfirmed: ' || coalesce(v_err, 'duplicated');
  v_err := pg_temp.errm_as(v_restr, format('select duplicate_workflow(%s, false)', v_wb));
  assert v_err = 'client_scope_restricted', 'duplicate_readable_hidden_workflow_denied: ' || coalesce(v_err, 'duplicated');
  v_err := pg_temp.errm_as(v_restr, format('select duplicate_workflow(%s, false)', v_wa));
  assert v_err is null, 'duplicate_workflow_in_a_allowed: ' || coalesce(v_err, '');

  -- =========================================================== templates (rewrite every active flow)
  v_err := pg_temp.errm_as(v_restr, format('select update_workflow_template(%s, ''TB2'', %L, ''padrao'')', v_tpl_b, v_etapas));
  assert v_err = 'client_scope_restricted', 'update_template_used_by_hidden_flow_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('select propagate_template_to_workflows(%s)', v_tpl_b));
  assert v_err = 'client_scope_restricted', 'propagate_template_used_by_hidden_flow_denied: ' || coalesce(v_err, 'propagated');
  v_err := pg_temp.errm_as(v_restr, format('select update_workflow_template(%s, ''TA2'', %L, ''padrao'')', v_tpl_a, v_etapas));
  assert v_err is null, 'update_template_only_a_flows_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_restr, format('select propagate_template_to_workflows(%s)', v_tpl_a));
  assert v_err is null, 'propagate_template_only_a_flows_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select update_workflow_template(%s, ''TB3'', %L, ''padrao'')', v_tpl_b, v_etapas));
  assert v_err is null, 'todos_update_template_b_allowed: ' || coalesce(v_err, '');

  -- =========================================================== tarefa_serie_aplicar_edicao hand-off
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_serie_aplicar_edicao(%s, %L, ''{}'', %L)',
    v_tb_occ, jsonb_build_object('titulo', 'occ', 'responsavel_id', v_membro_todos, 'cliente_id', v_cb, 'data_limite', current_date), v_regra));
  assert v_err = 'client_scope_restricted', 'aplicar_edicao_handoff_own_hidden_denied: ' || coalesce(v_err, 'handed off');
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_serie_aplicar_edicao(%s, %L, ''{}'', %L, true)',
    v_tb_occ, jsonb_build_object('titulo', 'occ', 'responsavel_id', v_membro_todos, 'cliente_id', v_cb, 'data_limite', current_date), v_regra));
  assert v_err = 'client_scope_restricted', 'aplicar_edicao_encerrar_handoff_own_hidden_denied: ' || coalesce(v_err, 'handed off');
  assert (select responsavel_id from tarefas where id = v_tb_occ) = v_membro, 'occurrence kept its responsavel';
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_serie_aplicar_edicao(%s, %L, ''{}'', %L)',
    v_tb_occ, jsonb_build_object('titulo', 'occ2', 'responsavel_id', v_membro, 'cliente_id', v_cb, 'data_limite', current_date), v_regra));
  assert v_err is null, 'aplicar_edicao_edit_own_hidden_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select tarefa_serie_aplicar_edicao(%s, %L, ''{}'', %L)',
    v_tb_occ, jsonb_build_object('titulo', 'occ3', 'responsavel_id', v_membro_todos, 'cliente_id', v_cb, 'data_limite', current_date), v_regra));
  assert v_err is null, 'todos_aplicar_edicao_handoff_allowed: ' || coalesce(v_err, '');

  raise notice 'PASS 99_acesso_por_cliente_definer (cases)';
end $$;

-- =============================================================
-- zero scope calls for todos (pg_stat_xact_user_functions)
-- =============================================================
set local track_functions = 'all';
create or replace function pg_temp.scope_calls() returns bigint language sql as $f$
  select coalesce(sum(calls), 0)::bigint from pg_stat_xact_user_functions
   where funcname in ('can_access_cliente', 'my_membro_ids', 'workflow_has_own_item');
$f$;
do $$
declare
  v_todos uuid := (select id from auth.users where email = 'todos@acdf.test');
  v_restr uuid := (select id from auth.users where email = 'restr@acdf.test');
  v_wa bigint := (select id from workflows where titulo = 'WA' and conta_id = (select active_workspace_id from profiles where id = v_todos));
  v_wb bigint := (select id from workflows where titulo = 'WB' and conta_id = (select active_workspace_id from profiles where id = v_todos));
  v_pb bigint := (select id from workflow_posts where titulo = 'pBother');
  c0 bigint; c1 bigint; c2 bigint; v_err text;
begin
  c0 := pg_temp.scope_calls();
  perform pg_temp.n_as(v_todos, format('select count(*) from get_post_discussao_nao_lidas(null, array[%s, %s]::bigint[])', v_wa, v_wb));
  v_err := pg_temp.errm_as(v_todos, format('select reorder_board_posts(array[%s]::bigint[], array[7]::float8[])', v_pb));
  assert v_err is null, 'todos reorder: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select reorder_workflow_positions(array[%s]::bigint[], array[7])', v_wb));
  assert v_err is null, 'todos reorder flows: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select post_discussao_seguir(%s, true)', v_pb));
  assert v_err is null, 'todos seguir: ' || coalesce(v_err, '');
  c1 := pg_temp.scope_calls();
  assert c1 - c0 = 0, 'todos_pays_zero_scope_calls: ' || (c1 - c0);
  -- the counter works: the restricted member's calls do hit the helpers
  perform pg_temp.n_as(v_restr, format('select count(*) from get_post_discussao_nao_lidas(null, array[%s, %s]::bigint[])', v_wa, v_wb));
  perform pg_temp.errm_as(v_restr, format('select reorder_workflow_positions(array[%s]::bigint[], array[7])', v_wb));
  c2 := pg_temp.scope_calls();
  assert c2 > c1, 'track_functions is counting the scope helpers: ' || c2;
end $$;

-- =============================================================
-- function privileges
-- =============================================================
do $$
declare v_f text;
begin
  foreach v_f in array array[
      'public.scope_check_posts(uuid, bigint[], text, text, boolean)',
      'public.scope_check_workflows(uuid, bigint[], text, text)',
      'public.scope_check_processes(uuid, bigint[], boolean)',
      'public.scope_check_template_workflows(uuid, bigint)'] loop
    assert not has_function_privilege('authenticated', v_f, 'EXECUTE'), 'not executable by authenticated: ' || v_f;
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'not executable by anon: ' || v_f;
    assert has_function_privilege('service_role', v_f, 'EXECUTE'), 'executable by service_role: ' || v_f;
  end loop;
  assert not has_function_privilege('authenticated', 'public.post_discussao_post_do_chamador(bigint)', 'EXECUTE'),
    'post_discussao_post_do_chamador stays internal';
  -- the gated RPCs keep their grants: authenticated yes, anon no
  foreach v_f in array array[
      'public.accept_edit_suggestion(bigint, timestamp with time zone, text[], text[])',
      'public.reject_edit_suggestion(bigint)',
      'public.reorder_board_posts(bigint[], double precision[])',
      'public.reorder_workflow_positions(bigint[], integer[])',
      'public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[])',
      'public.attach_posts_to_flow(bigint[], bigint)',
      'public.attach_post_closing_process(bigint, bigint, integer)',
      'public.detach_posts_from_flow(bigint[], boolean)',
      'public.detach_posts_keeping_process(bigint[], bigint, text, timestamp with time zone, uuid, jsonb, boolean)',
      'public.move_posts_to_existing_flow(bigint[], bigint, bigint, boolean)',
      'public.move_posts_to_new_flow(bigint[], bigint, text, integer, boolean)',
      'public.apply_post_process(bigint, bigint, text, integer, jsonb)',
      'public.transition_post_process(bigint, integer, text, text, text, timestamp with time zone)',
      'public.update_post_process_step(bigint, integer, integer, bigint, timestamp with time zone, integer, text)',
      'public.resolve_post_process_rascunho_banner(bigint, timestamp with time zone, boolean)',
      'public.remove_post_process(bigint, integer)',
      'public.advance_workflow_from_approval(bigint, bigint, text, jsonb)',
      'public.resolve_workflow_rascunho_banner(bigint, timestamp with time zone, boolean)',
      'public.migrate_workflow_template(bigint, bigint, jsonb, integer, text, bigint, integer)',
      'public.duplicate_post(bigint, boolean)',
      'public.duplicate_workflow(bigint, boolean)',
      'public.update_workflow_template(bigint, text, jsonb, text)',
      'public.propagate_template_to_workflows(bigint)',
      'public.post_discussao_enviar(bigint, text, bigint)',
      'public.post_discussao_marcar_lido(bigint, bigint)',
      'public.post_discussao_seguir(bigint, boolean)',
      'public.get_post_discussao_participacao(bigint)',
      'public.get_post_discussao_nao_lidas(bigint[], bigint[])',
      'public.tarefa_serie_aplicar_edicao(bigint, jsonb, bigint[], jsonb, boolean)'] loop
    assert has_function_privilege('authenticated', v_f, 'EXECUTE'), 'executable by authenticated: ' || v_f;
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'not executable by anon: ' || v_f;
  end loop;
  raise notice 'PASS 99_acesso_por_cliente_definer';
end $$;

rollback;
