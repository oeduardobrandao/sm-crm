\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, tarefas, ideias e contexto
-- (20261115000004_acesso_por_cliente_c2_tarefas_ideias.sql): tarefas and their
-- children (subtarefas, tags, comments, events, series, mentions), ideias and
-- theirs (files, reactions), the linha editorial, and the client context
-- tables (brand, brand files, briefings, briefing questions) plus Hub pages.
-- Item roots (tarefas, tarefa_series, ideias): read and UPDATE = scope OR "é dele";
-- INSERT and DELETE strict; relocating an own item, rewriting its author and
-- self-assigning into a client he can't access are refused by
-- guard_client_scope_item. Children follow the visible parent; DELETE on the
-- parent of a client he can't access only for rows he wrote. Linha editorial:
-- strict (no "é dele"). Context tables: readable with can_see_cliente_context,
-- written strictly.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventory: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

begin;
-- Tables whose migrations REVOKE and grant per column keep their real grants,
-- so the "a column grant already pins it" claims are tested, not masked.
select et_grant_hosted_parity(array['tarefa_series', 'tarefa_comentarios', 'tarefa_eventos',
  'linhas_editoriais', 'linha_editorial_itens', 'linha_editorial_respostas', 'linha_editorial_colunas']);

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
-- error message of a statement run WITHOUT RLS but with p_user's claims (what a
-- SECURITY DEFINER RPC called by p_user does), or NULL on success
create or replace function pg_temp.errm_definer_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  begin
    execute p_sql;
  exception when others then
    perform set_config('request.jwt.claims', '', true);
    return sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
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

-- Children of one tarefa (as superuser): a subtask, a tag link, a comment by
-- p_author and a mention by p_author. Events come from the tarefas triggers.
create or replace function pg_temp.seed_tarefa_children(p_tarefa bigint, p_conta uuid, p_author uuid, p_tag bigint, p_membro bigint)
returns void language plpgsql as $f$
begin
  insert into subtarefas (tarefa_id, conta_id, titulo) values (p_tarefa, p_conta, 's');
  insert into tarefa_tag_links (tarefa_id, tag_id, conta_id) values (p_tarefa, p_tag, p_conta);
  insert into tarefa_comentarios (conta_id, tarefa_id, author_id, conteudo) values (p_conta, p_tarefa, p_author, 'c');
  insert into mencoes (conta_id, host_type, host_id, mentioned_membro_id, author_id)
    values (p_conta, 'tarefa', p_tarefa, p_membro, p_author);
end $f$;

-- Children of one ideia (as superuser): a file link and a reaction.
create or replace function pg_temp.seed_ideia_children(p_ideia uuid, p_conta uuid, p_membro bigint)
returns void language plpgsql as $f$
declare v_file bigint;
begin
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (p_conta, 'f/' || p_ideia, 'f.png', 'image', 'image/png', 1) returning id into v_file;
  insert into ideia_files (ideia_id, file_id, conta_id) values (p_ideia, v_file, p_conta);
  insert into ideia_reactions (ideia_id, membro_id, emoji) values (p_ideia, p_membro, '👍');
end $f$;

-- Context rows of one client (as superuser): brand, a brand file, a briefing,
-- a briefing question and a Hub page.
create or replace function pg_temp.seed_context(p_cli bigint, p_conta uuid)
returns void language plpgsql as $f$
declare v_b uuid;
begin
  insert into hub_brand (cliente_id, primary_color) values (p_cli, '#000');
  insert into hub_brand_files (cliente_id, name, file_url, file_type) values (p_cli, 'logo', 'https://x.test/l.png', 'image');
  insert into briefings (cliente_id, conta_id, title) values (p_cli, p_conta, 'b') returning id into v_b;
  insert into hub_briefing_questions (cliente_id, conta_id, question, briefing_id) values (p_cli, p_conta, 'q', v_b);
  insert into hub_pages (conta_id, cliente_id, title, content) values (p_conta, p_cli, 'p', '{}');
end $f$;

do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_ws_x uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_ca bigint; v_ca2 bigint; v_cb bigint; v_cc bigint; v_cd bigint; v_ce bigint; v_cx bigint;
  v_membro bigint; v_membro_todos bigint; v_membro_owner bigint; v_tag bigint;
  v_ta bigint; v_tb bigint; v_tb_own bigint; v_tb_auth bigint; v_tb_own2 bigint; v_tb_ser bigint;
  v_tnull bigint; v_tnull_own bigint; v_tnull_auth bigint; v_ta_own bigint; v_ta2 bigint;
  v_sa bigint; v_sa3 bigint; v_sb bigint; v_sb_own bigint; v_se_own bigint; v_sa2 bigint;
  v_ia uuid; v_ib uuid; v_ib_own uuid; v_ib_sol_own uuid; v_ia_sol uuid; v_id_own uuid;
  v_la uuid; v_lb uuid; v_la_item uuid; v_lb_item uuid;
  v_n bigint; v_expected bigint; v_err text; v_t text;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@acta.test'), (v_todos, 'todos@acta.test'),
    (v_restr, 'restr@acta.test'), (v_other, 'other@acta.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_todos, v_ws, 'agent'),
    (v_restr, v_ws, 'agent'), (v_other, v_ws_x, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_todos, v_restr);
  update profiles set conta_id = v_ws_x, active_workspace_id = v_ws_x where id = v_other;
  update plans set feature_ideas = true, feature_linha_editorial = true
   where id in (select plan_id from workspaces where id in (v_ws, v_ws_x));

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A2', 'A2', '#111', 'ativo') returning id into v_ca2;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'C', 'C', '#333', 'ativo') returning id into v_cc;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'D', 'D', '#444', 'ativo') returning id into v_cd;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'E', 'E', '#555', 'ativo') returning id into v_ce;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_other, v_ws_x, 'X', 'X', '#666', 'ativo') returning id into v_cx;

  -- restricted to A and A2; B, C, D, E hidden. B: own tarefa + own post; C: nothing
  -- of his; D: an own ideia only; E: an own tarefa series only.
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca), (v_ws, v_restr, v_ca2);
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Restr', v_restr) returning id into v_membro;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Todos', v_todos) returning id into v_membro_todos;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Owner', v_owner) returning id into v_membro_owner;
  insert into tarefa_tags (conta_id, nome) values (v_ws, 'tag') returning id into v_tag;

  -- tarefa series (A, A2, B other, B own by responsavel, E own by author)
  insert into tarefa_series (conta_id, user_id, freq, intervalo, modo, inicio, titulo, cliente_id)
    values (v_ws, v_owner, 'daily', 1, 'calendario', current_date, 'sA', v_ca) returning id into v_sa;
  insert into tarefa_series (conta_id, user_id, freq, intervalo, modo, inicio, titulo, cliente_id)
    values (v_ws, v_owner, 'daily', 1, 'calendario', current_date, 'sA2', v_ca2) returning id into v_sa2;
  insert into tarefa_series (conta_id, user_id, freq, intervalo, modo, inicio, titulo, cliente_id)
    values (v_ws, v_owner, 'daily', 1, 'calendario', current_date, 'sB', v_cb) returning id into v_sb;
  insert into tarefa_series (conta_id, user_id, freq, intervalo, modo, inicio, titulo, cliente_id, responsavel_id)
    values (v_ws, v_owner, 'daily', 1, 'calendario', current_date, 'sBown', v_cb, v_membro) returning id into v_sb_own;
  insert into tarefa_series (conta_id, user_id, freq, intervalo, modo, inicio, titulo, cliente_id)
    values (v_ws, v_restr, 'daily', 1, 'calendario', current_date, 'sEown', v_ce) returning id into v_se_own;

  -- tarefas
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id) values (v_ws, v_owner, 'tA', 'pendente', v_ca) returning id into v_ta;
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id, responsavel_id) values (v_ws, v_owner, 'tAown', 'pendente', v_ca, v_membro) returning id into v_ta_own;
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id) values (v_ws, v_owner, 'tA2', 'pendente', v_ca2) returning id into v_ta2;
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id) values (v_ws, v_owner, 'tB', 'pendente', v_cb) returning id into v_tb;
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id, responsavel_id) values (v_ws, v_owner, 'tBown', 'pendente', v_cb, v_membro) returning id into v_tb_own;
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id) values (v_ws, v_restr, 'tBauth', 'pendente', v_cb) returning id into v_tb_auth;
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id, responsavel_id) values (v_ws, v_owner, 'tBown2', 'pendente', v_cb, v_membro) returning id into v_tb_own2;
  -- own task in B whose series (sB) is not his: the series is hidden from him
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id, responsavel_id, serie_id, data_limite)
    values (v_ws, v_owner, 'tBser', 'pendente', v_cb, v_membro, v_sb, current_date) returning id into v_tb_ser;
  insert into tarefas (conta_id, user_id, titulo, status) values (v_ws, v_owner, 'tNull', 'pendente') returning id into v_tnull;
  insert into tarefas (conta_id, user_id, titulo, status, responsavel_id) values (v_ws, v_owner, 'tNullown', 'pendente', v_membro) returning id into v_tnull_own;
  -- a task he created himself, with no client
  insert into tarefas (conta_id, user_id, titulo, status) values (v_ws, v_restr, 'tNullauth', 'pendente') returning id into v_tnull_auth;

  perform pg_temp.seed_tarefa_children(v_ta, v_ws, v_owner, v_tag, v_membro_todos);
  perform pg_temp.seed_tarefa_children(v_tb, v_ws, v_owner, v_tag, v_membro_todos);
  perform pg_temp.seed_tarefa_children(v_tb_own, v_ws, v_owner, v_tag, v_membro_todos);
  perform pg_temp.seed_tarefa_children(v_tnull_own, v_ws, v_owner, v_tag, v_membro_todos);
  -- his own comment and mention on the hidden tarefa tB (child "é dele")
  insert into tarefa_comentarios (conta_id, tarefa_id, author_id, conteudo) values (v_ws, v_tb, v_restr, 'meu');
  insert into mencoes (conta_id, host_type, host_id, mentioned_membro_id, author_id)
    values (v_ws, 'tarefa', v_tb, v_membro_owner, v_restr);

  -- ideias (A, B other, B own, own solicitacoes for the conversion, D own)
  insert into ideias (workspace_id, cliente_id, titulo, tipo, origem) values (v_ws, v_ca, 'iA', 'ideia', 'agencia') returning id into v_ia;
  insert into ideias (workspace_id, cliente_id, titulo, tipo, origem) values (v_ws, v_cb, 'iB', 'ideia', 'agencia') returning id into v_ib;
  insert into ideias (workspace_id, cliente_id, titulo, tipo, origem, autor_membro_id) values (v_ws, v_cb, 'iBown', 'ideia', 'agencia', v_membro) returning id into v_ib_own;
  insert into ideias (workspace_id, cliente_id, titulo, tipo, origem, autor_membro_id) values (v_ws, v_cb, 'iBsol', 'solicitacao', 'agencia', v_membro) returning id into v_ib_sol_own;
  insert into ideias (workspace_id, cliente_id, titulo, tipo, origem) values (v_ws, v_ca, 'iAsol', 'solicitacao', 'agencia') returning id into v_ia_sol;
  insert into ideias (workspace_id, cliente_id, titulo, tipo, origem, autor_membro_id) values (v_ws, v_cd, 'iDown', 'ideia', 'agencia', v_membro) returning id into v_id_own;
  perform pg_temp.seed_ideia_children(v_ia, v_ws, v_membro_todos);
  perform pg_temp.seed_ideia_children(v_ib, v_ws, v_membro_todos);
  perform pg_temp.seed_ideia_children(v_ib_own, v_ws, v_membro_todos);

  -- linha editorial: A, and B created by him (creator is not "é dele": strict)
  insert into linhas_editoriais (conta_id, cliente_id, periodo, status, created_by)
    values (v_ws, v_ca, date_trunc('month', current_date)::date, 'rascunho', v_owner) returning id into v_la;
  insert into linhas_editoriais (conta_id, cliente_id, periodo, status, created_by)
    values (v_ws, v_cb, date_trunc('month', current_date)::date, 'rascunho', v_restr) returning id into v_lb;
  insert into linha_editorial_itens (conta_id, linha_id, tipo, titulo, direcao, ordem)
    values (v_ws, v_la, 'feed', 'a', 'd', 1) returning id into v_la_item;
  insert into linha_editorial_itens (conta_id, linha_id, tipo, titulo, direcao, ordem)
    values (v_ws, v_lb, 'feed', 'b', 'd', 1) returning id into v_lb_item;
  insert into linha_editorial_respostas (conta_id, linha_id, item_id, acao, rodada, is_workspace_user, author_user_id)
    values (v_ws, v_la, v_la_item, 'comentario', 0, true, v_owner), (v_ws, v_lb, v_lb_item, 'comentario', 0, true, v_restr);

  -- context rows on every client; an own post in B (4a's context root)
  perform pg_temp.seed_context(v_ca, v_ws);
  perform pg_temp.seed_context(v_cb, v_ws);
  perform pg_temp.seed_context(v_cc, v_ws);
  perform pg_temp.seed_context(v_cd, v_ws);
  perform pg_temp.seed_context(v_ce, v_ws);
  insert into workflow_posts (conta_id, cliente_id, titulo, responsavel_id) values (v_ws, v_cb, 'pBown', v_membro);
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------- tarefas: read
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefas where id = %s', v_ta));
  assert v_n = 1, 'task_in_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefas where id = %s', v_tb));
  assert v_n = 0, 'task_in_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefas where id = %s', v_tb_own));
  assert v_n = 1, 'own_task_in_b_visible (responsavel_id): ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefas where id = %s', v_tb_auth));
  assert v_n = 1, 'authored_task_in_b_visible (user_id): ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefas where id = %s', v_tnull));
  assert v_n = 0, 'task_without_client_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefas where id = %s', v_tnull_own));
  assert v_n = 1, 'own_task_without_client_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, 'select count(*) from tarefas');
  assert v_n = 9, 'restricted sees tA, tAown, tA2, tBown, tBauth, tBown2, tBser, tNullown, tNullauth: ' || v_n;

  -- ---------------------------------------------------------------- tarefas: writes
  v_err := pg_temp.err_as(v_restr, format(
    'insert into tarefas (conta_id, user_id, titulo, status) values (%L, %L, ''x'', ''pendente'')', v_ws, v_restr));
  assert v_err = '42501', 'insert_task_null_client_denied_for_restricted: ' || coalesce(v_err, 'inserted');
  -- not his (author is someone else, no responsavel): only the RLS WITH CHECK refuses it
  v_err := pg_temp.err_as(v_restr, format(
    'insert into tarefas (conta_id, user_id, titulo, status, cliente_id) values (%L, %L, ''x'', ''pendente'', %s)', v_ws, v_owner, v_cb));
  assert v_err = '42501', 'insert_task_into_b_denied (rls): ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into tarefas (conta_id, user_id, titulo, status, cliente_id, responsavel_id) values (%L, %L, ''x'', ''pendente'', %s, %s)', v_ws, v_restr, v_cc, v_membro));
  assert v_err = '42501', 'restricted_cannot_author_task_into_hidden_client: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into tarefas (conta_id, user_id, titulo, status, cliente_id, responsavel_id) values (%L, %L, ''ok'', ''pendente'', %s, %s)', v_ws, v_restr, v_ca, v_membro));
  assert v_err is null, 'insert_task_into_a_allowed: ' || coalesce(v_err, '');
  -- the DEFINER path (no RLS): a tarefa he authors or owns in a client he can't access is refused
  v_err := pg_temp.errm_definer_as(v_restr, format(
    'insert into tarefas (conta_id, user_id, titulo, status, cliente_id) values (%L, %L, ''x'', ''pendente'', %s)', v_ws, v_restr, v_cc));
  assert v_err = 'client_scope_restricted', 'definer_author_task_into_hidden_client_denied: ' || coalesce(v_err, 'inserted');
  perform set_config('request.jwt.claims', json_build_object('sub', v_restr, 'role', 'authenticated')::text, true);
  assert not public.can_see_cliente_context(v_cc), 'no context for C';
  perform set_config('request.jwt.claims', '', true);

  -- own task in B: editable in place (the clientes and series tenant checks
  -- don't need read access to B or to the series)
  v_n := pg_temp.rows_as(v_restr, format('update tarefas set titulo = ''novo'' where id = %s', v_tb_own));
  assert v_n = 1, 'own_task_in_b_editable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update tarefas set status = ''em_andamento'' where id = %s', v_tb_ser));
  assert v_n = 1, 'own_task_in_b_of_hidden_series_editable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update tarefas set titulo = ''novo'' where id = %s', v_tnull_own));
  assert v_n = 1, 'own_task_without_client_editable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update tarefas set titulo = ''y'' where id = %s', v_tb));
  assert v_n = 0, 'hidden_task_not_updatable: ' || v_n;
  -- relocation: source and destination must both be accessible
  v_err := pg_temp.errm_as(v_restr, format('update tarefas set cliente_id = %s where id = %s', v_cc, v_ta_own));
  assert v_err = 'client_scope_restricted', 'move_own_task_to_hidden_client_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('update tarefas set cliente_id = %s where id = %s', v_ca, v_tb_own));
  assert v_err = 'client_scope_restricted', 'move_own_task_out_of_hidden_client_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('update tarefas set cliente_id = null where id = %s', v_tb_own));
  assert v_err = 'client_scope_restricted', 'detach_own_task_from_hidden_client_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('update tarefas set cliente_id = null where id = %s', v_ta_own));
  assert v_err = 'client_scope_restricted', 'move_own_task_to_no_client_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('update tarefas set cliente_id = %s where id = %s', v_ca, v_tnull_own));
  assert v_err = 'client_scope_restricted', 'move_own_task_without_client_to_a_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('update tarefas set cliente_id = %s where id = %s', v_ca2, v_ta_own));
  assert v_err is null, 'move_task_between_accessible_clients_allowed: ' || coalesce(v_err, '');
  -- self-assign (DEFINER path, RLS bypassed)
  v_err := pg_temp.errm_definer_as(v_restr, format('update tarefas set responsavel_id = %s where id = %s', v_membro, v_tb));
  assert v_err = 'client_scope_restricted', 'self_assign_hidden_task_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_definer_as(v_restr, format('update tarefas set responsavel_id = %s where id = %s', v_membro, v_tnull));
  assert v_err = 'client_scope_restricted', 'self_assign_task_without_client_denied: ' || coalesce(v_err, 'updated');
  v_n := pg_temp.rows_as(v_restr, format('update tarefas set responsavel_id = %s where id = %s', v_membro, v_ta));
  assert v_n = 1, 'self_assign_accessible_task_allowed: ' || v_n;
  -- author forge
  v_err := pg_temp.errm_as(v_restr, format('update tarefas set user_id = %L where id = %s', v_restr, v_ta));
  assert v_err = 'author_immutable', 'forge_task_user_id_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_todos, format('update tarefas set user_id = %L where id = %s', v_todos, v_tb));
  assert v_err = 'author_immutable', 'forge_task_user_id_denied_for_todos_too: ' || coalesce(v_err, 'updated');
  -- hand-off of an own hidden task: blocked by the SELECT USING on the new row (ruling)
  v_err := pg_temp.err_as(v_restr, format('update tarefas set responsavel_id = %s where id = %s', v_membro_todos, v_tb_own2));
  assert v_err = '42501', 'own_task_in_b_handoff_blocked_by_select_using: ' || coalesce(v_err, 'updated');
  -- tenant check kept
  v_err := pg_temp.err_as(v_restr, format('update tarefas set conta_id = %L where id = %s', v_ws_x, v_tb_own));
  assert v_err is not null, 'own_task_conta_change_denied: ' || coalesce(v_err, 'updated');
  -- delete strict
  v_n := pg_temp.rows_as(v_restr, format('delete from tarefas where id = %s', v_tb_auth));
  assert v_n = 0, 'own_task_in_b_delete_denied: ' || v_n;
  -- no-client task only assigned to him (created by someone else): delete denied
  v_n := pg_temp.rows_as(v_restr, format('delete from tarefas where id = %s', v_tnull_own));
  assert v_n = 0, 'assigned_task_without_client_delete_denied: ' || v_n;
  -- no-client task he created himself: delete allowed (ruling, round 1)
  v_n := pg_temp.rows_as(v_restr, format('delete from tarefas where id = %s', v_tnull_auth));
  assert v_n = 1, 'own_created_task_without_client_deletable: ' || v_n;

  -- ideia -> tarefa conversion (INVOKER): an own solicitacao in B is visible to
  -- him, the tarefa it would create lands in B and is refused; in A it works
  v_err := pg_temp.err_as(v_restr, format('select convert_solicitacao_em_tarefa(%L, ''t'')', v_ib_sol_own));
  assert v_err = '42501', 'convert_own_solicitacao_in_b_denied: ' || coalesce(v_err, 'converted');
  v_err := pg_temp.err_as(v_restr, format('select convert_solicitacao_em_tarefa(%L, ''t'')', v_ia_sol));
  assert v_err is null, 'convert_solicitacao_in_a_allowed: ' || coalesce(v_err, '');

  -- client deletion: tarefas/series of the deleted client go to NULL (FK SET NULL);
  -- the guard lets that through even when the deleter is restricted
  v_err := pg_temp.errm_definer_as(v_restr, format('delete from clientes where id = %s', v_ca2));
  assert v_err is null, 'restricted_client_delete_cascade_set_null_ok: ' || coalesce(v_err, '');
  assert (select cliente_id from tarefas where id = v_ta2) is null, 'tarefa of deleted client detached';

  -- ---------------------------------------------------------------- tarefa_series
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefa_series where id = %s', v_sa));
  assert v_n = 1, 'series_in_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefa_series where id = %s', v_sb));
  assert v_n = 0, 'series_in_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefa_series where id = %s', v_sb_own));
  assert v_n = 1, 'own_series_in_b_visible (responsavel_id): ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefa_series where id = %s', v_se_own));
  assert v_n = 1, 'authored_series_in_e_visible (user_id): ' || v_n;
  -- authenticated has SELECT only; the DEFINER (RPC) path is guarded
  v_err := pg_temp.err_as(v_restr, format('update tarefa_series set titulo = ''x'' where id = %s', v_sa));
  assert v_err = '42501', 'series_direct_update_denied_by_grant: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_definer_as(v_restr, format(
    'insert into tarefa_series (conta_id, user_id, freq, intervalo, modo, inicio, titulo, cliente_id) values (%L, %L, ''daily'', 1, ''calendario'', current_date, ''x'', %s)', v_ws, v_restr, v_cc));
  assert v_err = 'client_scope_restricted', 'definer_series_into_hidden_client_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.errm_definer_as(v_restr, format(
    'insert into tarefa_series (conta_id, user_id, freq, intervalo, modo, inicio, titulo) values (%L, %L, ''daily'', 1, ''calendario'', current_date, ''x'')', v_ws, v_restr));
  assert v_err = 'client_scope_restricted', 'definer_series_without_client_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.errm_definer_as(v_restr, format('update tarefa_series set cliente_id = %s where id = %s', v_ca, v_sb_own));
  assert v_err = 'client_scope_restricted', 'definer_move_own_series_out_of_hidden_client_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_definer_as(v_restr, format('update tarefa_series set responsavel_id = %s where id = %s', v_membro, v_sb));
  assert v_err = 'client_scope_restricted', 'definer_self_assign_hidden_series_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_definer_as(v_restr, format('update tarefa_series set titulo = ''novo'' where id = %s', v_sb_own));
  assert v_err is null, 'definer_edit_own_series_in_place_allowed: ' || coalesce(v_err, '');
  -- the occurrence a series materializes (serie_id set, only series code can) is
  -- not refused: the series itself was guarded
  v_err := pg_temp.errm_definer_as(v_restr, format(
    'insert into tarefas (conta_id, user_id, titulo, status, cliente_id, responsavel_id, serie_id, data_limite) values (%L, %L, ''occ'', ''pendente'', %s, %s, %s, current_date)', v_ws, v_owner, v_cb, v_membro, v_sb_own));
  assert v_err is null, 'series_occurrence_in_hidden_client_allowed: ' || coalesce(v_err, '');

  -- ---------------------------------------------------------------- tarefa children
  foreach v_t in array array['subtarefas', 'tarefa_tag_links', 'tarefa_comentarios', 'tarefa_eventos'] loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where tarefa_id = %s', v_t, v_ta));
    assert v_n >= 1, format('%s_of_visible_task_visible: %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where tarefa_id = %s', v_t, v_tb_own));
    assert v_n >= 1, format('%s_of_own_task_in_b_visible: %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where tarefa_id = %s', v_t, v_tnull_own));
    assert v_n >= 1, format('%s_of_own_task_without_client_visible: %s', v_t, v_n);
  end loop;
  foreach v_t in array array['subtarefas', 'tarefa_tag_links', 'tarefa_eventos'] loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where tarefa_id = %s', v_t, v_tb));
    assert v_n = 0, format('%s_of_hidden_task_hidden: %s', v_t, v_n);
  end loop;
  -- comments: only his own on the hidden task
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefa_comentarios where tarefa_id = %s', v_tb));
  assert v_n = 1, 'own_comment_on_hidden_task_visible (only his): ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update tarefa_comentarios set conteudo = ''ed'' where tarefa_id = %s and author_id = %L', v_tb, v_restr));
  assert v_n = 0, 'own_comment_on_hidden_task_not_editable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from tarefa_comentarios where tarefa_id = %s and author_id = %L', v_tb, v_restr));
  assert v_n = 1, 'own_comment_on_hidden_task_deletable: ' || v_n;
  -- author/parent pinned by the column grant (UPDATE (conteudo) only)
  v_err := pg_temp.err_as(v_restr, format('update tarefa_comentarios set author_id = %L where tarefa_id = %s', v_restr, v_ta));
  assert v_err = '42501', 'comment_author_pinned_by_grant: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.err_as(v_restr, format('update tarefa_comentarios set tarefa_id = %s where tarefa_id = %s', v_ta, v_tb_own));
  assert v_err = '42501', 'comment_parent_pinned_by_grant: ' || coalesce(v_err, 'updated');
  -- mentions: on visible hosts and his own; on his own hidden task only what he wrote
  v_n := pg_temp.n_as(v_restr, format('select count(*) from mencoes where host_type = ''tarefa'' and host_id = %s', v_ta));
  assert v_n = 1, 'mention_on_visible_task_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from mencoes where host_type = ''tarefa'' and host_id = %s', v_tb));
  assert v_n = 1, 'mention_on_hidden_task_only_his: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from mencoes where host_type = ''tarefa'' and host_id = %s', v_tb_own));
  assert v_n = 0, 'others_mention_on_own_hidden_task_hidden: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format(
    'insert into mencoes (conta_id, host_type, host_id, mentioned_membro_id, author_id) values (%L, ''tarefa'', %s, %s, %L)', v_ws, v_tb, v_membro_todos, v_restr));
  assert v_err = '42501', 'mention_into_hidden_task_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into mencoes (conta_id, host_type, host_id, mentioned_membro_id, author_id) values (%L, ''tarefa'', %s, %s, %L)', v_ws, v_tb_own, v_membro_owner, v_restr));
  assert v_err is null, 'mention_into_own_hidden_task_allowed: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_restr, format('delete from mencoes where host_type = ''tarefa'' and host_id = %s', v_tb_own));
  assert v_n = 1, 'own_mention_on_own_hidden_task_deletable (not the others): ' || v_n;

  -- child writes through the visible parent
  v_err := pg_temp.err_as(v_restr, format('insert into subtarefas (tarefa_id, conta_id, titulo) values (%s, %L, ''x'')', v_tb, v_ws));
  assert v_err = '42501', 'insert_subtask_into_hidden_task_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format('insert into tarefa_tag_links (tarefa_id, tag_id, conta_id) values (%s, %s, %L)', v_tb, v_tag, v_ws));
  assert v_err = '42501', 'insert_tag_into_hidden_task_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format('insert into subtarefas (tarefa_id, conta_id, titulo) values (%s, %L, ''mine'')', v_tb_own, v_ws));
  assert v_err is null, 'insert_subtask_into_own_b_task_allowed: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_restr, format('update subtarefas set concluida = true where tarefa_id = %s', v_tb_own));
  assert v_n = 2, 'subtasks_of_own_b_task_updatable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from subtarefas where tarefa_id = %s', v_ta));
  assert v_n = 1, 'subtask_of_task_in_a_deletable: ' || v_n;
  -- re-parenting a child of his hidden-client task onto a visible task is refused
  v_err := pg_temp.errm_as(v_restr, format('update subtarefas set tarefa_id = %s where tarefa_id = %s', v_ta, v_tb_own));
  assert v_err = 'client_scope_restricted', 'move_subtask_out_of_hidden_task_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('update tarefa_tag_links set tarefa_id = %s where tarefa_id = %s', v_ta_own, v_tb_own));
  assert v_err = 'client_scope_restricted', 'move_tag_out_of_hidden_task_denied: ' || coalesce(v_err, 'updated');
  -- on his own task, whatever its client, subtasks and tags can be removed (ruling, round 1)
  v_n := pg_temp.rows_as(v_restr, format('delete from subtarefas where tarefa_id = %s', v_tb_own));
  assert v_n = 2, 'subtasks_of_own_b_task_deletable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from tarefa_tag_links where tarefa_id = %s', v_tb_own));
  assert v_n = 1, 'tag_removal_on_own_b_task_works: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from subtarefas where tarefa_id = %s', v_tnull_own));
  assert v_n = 1, 'subtask_of_own_task_without_client_deletable: ' || v_n;
  -- still strict on a hidden task that is not his
  v_n := pg_temp.rows_as(v_restr, format('delete from subtarefas where tarefa_id = %s', v_tb));
  assert v_n = 0, 'subtask_of_hidden_task_delete_denied: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from tarefa_tag_links where tarefa_id = %s', v_tb));
  assert v_n = 0, 'tag_of_hidden_task_delete_denied: ' || v_n;

  -- ---------------------------------------------------------------- ideias
  v_n := pg_temp.n_as(v_restr, format('select count(*) from ideias where id = %L', v_ia));
  assert v_n = 1, 'ideia_in_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from ideias where id = %L', v_ib));
  assert v_n = 0, 'ideia_in_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from ideias where id = %L', v_ib_own));
  assert v_n = 1, 'own_ideia_in_b_visible (autor_membro_id): ' || v_n;
  v_err := pg_temp.err_as(v_restr, format(
    'insert into ideias (workspace_id, cliente_id, titulo, tipo, origem) values (%L, %s, ''x'', ''ideia'', ''agencia'')', v_ws, v_cb));
  assert v_err = '42501', 'insert_ideia_into_b_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into ideias (workspace_id, cliente_id, titulo, tipo, origem, autor_membro_id) values (%L, %s, ''x'', ''ideia'', ''agencia'', %s)', v_ws, v_cc, v_membro));
  assert v_err = '42501', 'restricted_cannot_author_ideia_into_hidden_client: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into ideias (workspace_id, cliente_id, titulo, tipo, origem, autor_membro_id) values (%L, %s, ''x'', ''ideia'', ''agencia'', %s)', v_ws, v_ca, v_membro));
  assert v_err is null, 'insert_ideia_into_a_allowed: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_restr, format('update ideias set titulo = ''novo'' where id = %L', v_ib_own));
  assert v_n = 1, 'own_ideia_in_b_editable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update ideias set titulo = ''novo'' where id = %L', v_ib));
  assert v_n = 0, 'hidden_ideia_not_updatable: ' || v_n;
  v_err := pg_temp.errm_as(v_restr, format('update ideias set cliente_id = %s where id = %L', v_ca, v_ib_own));
  assert v_err = 'client_scope_restricted', 'move_own_ideia_out_of_hidden_client_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('update ideias set cliente_id = %s where id = %L', v_cc, v_ia));
  assert v_err is not null, 'move_ideia_to_hidden_client_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_as(v_restr, format('update ideias set autor_membro_id = %s where id = %L', v_membro, v_ia));
  assert v_err = 'author_immutable', 'forge_ideia_author_denied: ' || coalesce(v_err, 'updated');
  v_err := pg_temp.errm_definer_as(v_restr, format('update ideias set autor_membro_id = %s where id = %L', v_membro, v_ib));
  assert v_err = 'author_immutable', 'definer_forge_hidden_ideia_author_denied: ' || coalesce(v_err, 'updated');
  v_n := pg_temp.rows_as(v_restr, format('delete from ideias where id = %L', v_ib_own));
  assert v_n = 0, 'own_ideia_in_b_delete_denied: ' || v_n;

  -- ideia children
  foreach v_t in array array['ideia_files', 'ideia_reactions'] loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where ideia_id = %L', v_t, v_ia));
    assert v_n = 1, format('%s_of_visible_ideia_visible: %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where ideia_id = %L', v_t, v_ib));
    assert v_n = 0, format('%s_of_hidden_ideia_hidden: %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where ideia_id = %L', v_t, v_ib_own));
    assert v_n = 1, format('%s_of_own_ideia_in_b_visible: %s', v_t, v_n);
    v_n := pg_temp.rows_as(v_restr, format('delete from %I where ideia_id = %L', v_t, v_ib_own));
    assert v_n = 0, format('%s_of_own_ideia_in_b_delete_denied: %s', v_t, v_n);
    v_err := pg_temp.errm_as(v_restr, format('update %I set ideia_id = %L where ideia_id = %L', v_t, v_ia, v_ib_own));
    assert v_err = 'client_scope_restricted', format('move_%s_out_of_hidden_ideia_denied: %s', v_t, coalesce(v_err, 'updated'));
  end loop;
  v_err := pg_temp.err_as(v_restr, format('insert into ideia_reactions (ideia_id, membro_id, emoji) values (%L, %s, ''x'')', v_ib, v_membro));
  assert v_err = '42501', 'reaction_on_hidden_ideia_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format('insert into ideia_reactions (ideia_id, membro_id, emoji) values (%L, %s, ''x'')', v_ib_own, v_membro));
  assert v_err is null, 'reaction_on_own_b_ideia_allowed: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_restr, format('delete from ideia_reactions where ideia_id = %L', v_ia));
  assert v_n = 1, 'reaction_on_ideia_in_a_deletable: ' || v_n;

  -- ---------------------------------------------------------------- linha editorial (strict)
  v_n := pg_temp.n_as(v_restr, format('select count(*) from linhas_editoriais where id = %L', v_la));
  assert v_n = 1, 'linha_in_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from linhas_editoriais where id = %L', v_lb));
  assert v_n = 0, 'linha_in_b_hidden_even_if_created_by_him: ' || v_n;
  foreach v_t in array array['linha_editorial_itens', 'linha_editorial_respostas'] loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where linha_id = %L', v_t, v_la));
    assert v_n = 1, format('%s_of_visible_linha_visible: %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where linha_id = %L', v_t, v_lb));
    assert v_n = 0, format('%s_of_hidden_linha_hidden: %s', v_t, v_n);
  end loop;
  v_n := pg_temp.rows_as(v_restr, format('update linhas_editoriais set titulo = ''x'' where id = %L', v_lb));
  assert v_n = 0, 'linha_in_b_not_updatable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update linhas_editoriais set titulo = ''x'' where id = %L', v_la));
  assert v_n = 1, 'linha_in_a_updatable: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format(
    'insert into linha_editorial_itens (conta_id, linha_id, tipo, titulo, direcao, ordem) values (%L, %L, ''feed'', ''x'', ''d'', 2)', v_ws, v_lb));
  -- linha_item_guard (invoker) no longer finds the hidden linha and raises first
  assert v_err is not null, 'insert_item_into_hidden_linha_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into linha_editorial_itens (conta_id, linha_id, tipo, titulo, direcao, ordem) values (%L, %L, ''feed'', ''x'', ''d'', 2)', v_ws, v_la));
  assert v_err is null, 'insert_item_into_visible_linha_allowed: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_restr, format('update linha_editorial_itens set titulo = ''x'' where linha_id = %L', v_lb));
  assert v_n = 0, 'item_of_hidden_linha_not_updatable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from linha_editorial_itens where linha_id = %L', v_lb));
  assert v_n = 0, 'item_of_hidden_linha_not_deletable: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format(
    'insert into linha_editorial_respostas (conta_id, linha_id, acao, is_workspace_user, author_user_id, comentario) values (%L, %L, ''comentario'', true, %L, ''x'')', v_ws, v_lb, v_restr));
  -- linha_resposta_guard (invoker) no longer finds the hidden linha and raises first
  assert v_err is not null, 'comment_into_hidden_linha_denied: ' || coalesce(v_err, 'inserted');

  -- ---------------------------------------------------------------- context tables
  -- brand_profile_of_b_visible_with_own_post (own post + own tarefa in B), D via an
  -- own ideia, E via an own series; C has nothing of his
  foreach v_t in array array['hub_brand', 'hub_brand_files', 'briefings', 'hub_briefing_questions'] loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where cliente_id = %s', v_t, v_ca));
    assert v_n = 1, format('%s_of_a_visible: %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where cliente_id = %s', v_t, v_cb));
    assert v_n = 1, format('brand_profile_of_b_visible_with_own_post (%s): %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where cliente_id = %s', v_t, v_cd));
    assert v_n = 1, format('context_of_d_visible_with_own_ideia (%s): %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where cliente_id = %s', v_t, v_ce));
    assert v_n = 1, format('context_of_e_visible_with_own_series (%s): %s', v_t, v_n);
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I where cliente_id = %s', v_t, v_cc));
    assert v_n = 0, format('brand_profile_of_b_hidden_without_own_item (%s, client C): %s', v_t, v_n);
    -- context is read-only: no update, no delete
    v_n := pg_temp.rows_as(v_restr, format('update %I set cliente_id = cliente_id where cliente_id = %s', v_t, v_cb));
    assert v_n = 0, format('%s_of_context_client_not_updatable: %s', v_t, v_n);
    v_n := pg_temp.rows_as(v_restr, format('delete from %I where cliente_id = %s', v_t, v_cb));
    assert v_n = 0, format('%s_of_context_client_not_deletable: %s', v_t, v_n);
    v_n := pg_temp.rows_as(v_restr, format('update %I set cliente_id = cliente_id where cliente_id = %s', v_t, v_ca));
    assert v_n = 1, format('%s_of_a_updatable: %s', v_t, v_n);
  end loop;
  v_err := pg_temp.err_as(v_restr, format(
    'insert into hub_brand_files (cliente_id, name, file_url, file_type) values (%s, ''n'', ''https://x.test/n'', ''image'')', v_cb));
  assert v_err = '42501', 'insert_brand_file_into_context_client_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into hub_briefing_questions (cliente_id, conta_id, question) values (%s, %L, ''q'')', v_cb, v_ws));
  assert v_err = '42501', 'insert_question_into_context_client_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format('insert into briefings (cliente_id, conta_id, title) values (%s, %L, ''t'')', v_cb, v_ws));
  assert v_err = '42501', 'insert_briefing_into_context_client_denied: ' || coalesce(v_err, 'inserted');
  v_err := pg_temp.err_as(v_restr, format('update hub_briefing_questions set cliente_id = %s where cliente_id = %s', v_cb, v_ca));
  assert v_err = '42501', 'move_question_to_context_client_denied: ' || coalesce(v_err, 'updated');
  -- Hub pages are not context: strict
  v_n := pg_temp.n_as(v_restr, format('select count(*) from hub_pages where cliente_id = %s', v_ca));
  assert v_n = 1, 'hub_page_of_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from hub_pages where cliente_id = %s', v_cb));
  assert v_n = 0, 'hub_page_of_context_client_hidden: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format('insert into hub_pages (conta_id, cliente_id, title, content) values (%L, %s, ''p'', ''{}'')', v_ws, v_cb));
  assert v_err = '42501', 'insert_hub_page_into_b_denied: ' || coalesce(v_err, 'inserted');
  perform set_config('request.jwt.claims', json_build_object('sub', v_restr, 'role', 'authenticated')::text, true);
  assert public.can_see_cliente_context(v_cd), 'own_ideia_gives_context_of_d';
  assert public.can_see_cliente_context(v_ce), 'own_series_gives_context_of_e';
  assert not public.can_see_cliente_context(v_cc), 'no_context_of_c';
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------- SECURITY DEFINER RPCs
  -- tarefa_comentario_enviar: hidden task stays unconfirmed; his own hidden task and A are ok
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_comentario_enviar(%s, ''oi'')', v_tb));
  assert v_err = 'tarefa_not_found', 'rpc_comment_on_hidden_task_denied: ' || coalesce(v_err, 'sent');
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_comentario_enviar(%s, ''oi'')', v_tb_own));
  assert v_err is null, 'rpc_comment_on_own_hidden_task_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_comentario_enviar(%s, ''oi'')', v_ta));
  assert v_err is null, 'rpc_comment_on_task_in_a_allowed: ' || coalesce(v_err, '');
  -- tarefa_serie_criar: strict on the client; promotion of a hidden task stays unconfirmed
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_criar(''{"freq":"daily","intervalo":1,"modo":"ao_concluir"}'', %L, ''{}'', ''{}'')',
    jsonb_build_object('titulo', 'sx', 'status', 'pendente', 'cliente_id', v_cc, 'data_limite', current_date)));
  assert v_err = 'client_scope_restricted', 'rpc_create_series_in_hidden_client_denied: ' || coalesce(v_err, 'created');
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_criar(''{"freq":"daily","intervalo":1,"modo":"ao_concluir"}'', %L, ''{}'', ''{}'')',
    jsonb_build_object('titulo', 'sx', 'status', 'pendente', 'data_limite', current_date)));
  assert v_err = 'client_scope_restricted', 'rpc_create_series_without_client_denied: ' || coalesce(v_err, 'created');
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_criar(''{"freq":"daily","intervalo":1,"modo":"ao_concluir"}'', %L, ''{}'', ''{}'')',
    jsonb_build_object('titulo', 'sx', 'status', 'pendente', 'cliente_id', v_ca, 'data_limite', current_date)));
  assert v_err is null, 'rpc_create_series_in_a_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_criar(''{"freq":"daily","intervalo":1,"modo":"ao_concluir"}'', %L, ''{}'', ''{}'', %s)',
    jsonb_build_object('titulo', 'p', 'status', 'pendente', 'cliente_id', v_ca, 'data_limite', current_date), v_tb));
  assert v_err = 'Tarefa não encontrada neste workspace.', 'rpc_promote_hidden_task_unconfirmed: ' || coalesce(v_err, 'promoted');
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_criar(''{"freq":"daily","intervalo":1,"modo":"ao_concluir"}'', %L, ''{}'', ''{}'', %s)',
    jsonb_build_object('titulo', 'p', 'status', 'pendente', 'cliente_id', v_cb, 'data_limite', current_date), v_tb_own));
  assert v_err = 'client_scope_restricted', 'rpc_promote_own_hidden_task_denied: ' || coalesce(v_err, 'promoted');
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_criar(''{"freq":"daily","intervalo":1,"modo":"ao_concluir"}'', %L, ''{}'', ''{}'', %s)',
    jsonb_build_object('titulo', 'p', 'status', 'pendente', 'cliente_id', v_ca, 'data_limite', current_date), v_tb_own2));
  assert v_err = 'client_scope_restricted', 'rpc_promote_own_hidden_task_into_a_denied (relocation): ' || coalesce(v_err, 'promoted');
  -- tarefa_serie_aplicar_edicao: edit own occurrence in place, never relocate
  select id into v_n from tarefas where titulo = 'occ' and serie_id = v_sb_own;
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_aplicar_edicao(%s, %L, ''{}'', ''{"freq":"daily","intervalo":1,"modo":"calendario"}'')',
    v_n, jsonb_build_object('titulo', 'occ2', 'responsavel_id', v_membro, 'cliente_id', v_cb, 'data_limite', current_date)));
  assert v_err is null, 'rpc_edit_own_occurrence_in_hidden_client_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_aplicar_edicao(%s, %L, ''{}'', ''{"freq":"daily","intervalo":1,"modo":"calendario"}'')',
    v_n, jsonb_build_object('titulo', 'occ3', 'responsavel_id', v_membro, 'cliente_id', v_ca, 'data_limite', current_date)));
  assert v_err = 'client_scope_restricted', 'rpc_relocate_own_occurrence_denied: ' || coalesce(v_err, 'edited');
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_aplicar_edicao(%s, %L, ''{}'', ''{"freq":"daily","intervalo":1,"modo":"calendario"}'')',
    v_tb_ser, jsonb_build_object('titulo', 'x', 'responsavel_id', v_membro, 'cliente_id', v_cb, 'data_limite', current_date)));
  assert v_err = 'Série não encontrada neste workspace.', 'rpc_edit_hidden_series_through_own_occurrence_denied: ' || coalesce(v_err, 'edited');
  v_err := pg_temp.errm_as(v_restr, format(
    'select tarefa_serie_aplicar_edicao(%s, %L, ''{}'', ''{"freq":"daily","intervalo":1,"modo":"calendario"}'')',
    v_tb, jsonb_build_object('titulo', 'x', 'cliente_id', v_cb, 'data_limite', current_date)));
  assert v_err = 'Tarefa não encontrada neste workspace.', 'rpc_edit_hidden_task_unconfirmed: ' || coalesce(v_err, 'edited');
  -- tarefa_serie_definir_estado: own series ok, hidden unconfirmed
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_serie_definir_estado(%s, ''pausar'')', v_sb));
  assert v_err = 'Série não encontrada neste workspace.', 'rpc_pause_hidden_series_unconfirmed: ' || coalesce(v_err, 'paused');
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_serie_definir_estado(%s, ''pausar'')', v_sb_own));
  assert v_err is null, 'rpc_pause_own_series_in_hidden_client_allowed: ' || coalesce(v_err, '');
  -- tarefa_serie_excluir: strict
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_serie_excluir(%s)', v_sb));
  assert v_err = 'Série não encontrada neste workspace.', 'rpc_delete_hidden_series_unconfirmed: ' || coalesce(v_err, 'deleted');
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_serie_excluir(%s)', v_sb_own));
  assert v_err = 'client_scope_restricted', 'rpc_delete_own_series_in_hidden_client_denied: ' || coalesce(v_err, 'deleted');
  -- series in A whose open occurrence an unrestricted member moved to B: ending
  -- it would delete that occurrence, so it is refused
  insert into tarefa_series (conta_id, user_id, freq, intervalo, modo, inicio, titulo, cliente_id)
    values (v_ws, v_owner, 'daily', 1, 'ao_concluir', current_date, 'sA3', v_ca) returning id into v_sa3;
  insert into tarefas (conta_id, user_id, titulo, status, cliente_id, serie_id, data_limite)
    values (v_ws, v_owner, 'occA3movedB', 'pendente', v_cb, v_sa3, current_date);
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_serie_excluir(%s)', v_sa3));
  assert v_err = 'client_scope_restricted', 'rpc_delete_series_with_occurrence_in_hidden_client_denied: ' || coalesce(v_err, 'deleted');
  assert (select count(*) from tarefas where serie_id = v_sa3) = 1, 'occurrence in hidden client survived';
  v_err := pg_temp.errm_as(v_todos, format('select tarefa_serie_excluir(%s)', v_sa3));
  assert v_err is null, 'todos_delete_series_with_occurrence_in_b_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_restr, format('select tarefa_serie_excluir(%s)', v_sa));
  assert v_err is null, 'rpc_delete_series_in_a_allowed: ' || coalesce(v_err, '');
  -- linha editorial RPCs: strict, hidden linha/client unconfirmed
  v_err := pg_temp.errm_as(v_restr, format('select linha_editorial_criar(%s, current_date + 40)', v_cb));
  assert v_err = 'nao_encontrada', 'rpc_create_linha_in_hidden_client_denied: ' || coalesce(v_err, 'created');
  v_err := pg_temp.errm_as(v_restr, format('select linha_editorial_criar(%s, current_date + 40)', v_ca));
  assert v_err is null, 'rpc_create_linha_in_a_allowed: ' || coalesce(v_err, '');
  foreach v_t in array array['linha_editorial_enviar(%L)', 'linha_editorial_recolher(%L)',
      'linha_editorial_converter(%L, null, ''[{"item_id":"00000000-0000-0000-0000-000000000000"}]'')'] loop
    v_err := pg_temp.errm_as(v_restr, format('select ' || v_t, v_lb));
    assert v_err = 'nao_encontrada', format('rpc_%s_on_hidden_linha_denied: %s', split_part(v_t, '(', 1), coalesce(v_err, 'ran'));
  end loop;
  v_err := pg_temp.errm_as(v_restr, format('select linha_editorial_enviar(%L)', v_la));
  assert v_err is null, 'rpc_send_linha_in_a_allowed: ' || coalesce(v_err, '');
  -- deleting a workspace column strips its values from every linha, hidden ones included
  v_err := pg_temp.errm_as(v_restr, format('select linha_editorial_coluna_excluir(%L)',
    (select id from linha_editorial_colunas where conta_id = v_ws order by ordem limit 1)));
  assert v_err = 'client_scope_restricted', 'rpc_restricted_delete_workspace_column_denied: ' || coalesce(v_err, 'deleted');
  v_err := pg_temp.errm_as(v_todos, format('select linha_editorial_coluna_excluir(%L)',
    (select id from linha_editorial_colunas where conta_id = v_ws order by ordem limit 1)));
  assert v_err is null, 'rpc_todos_delete_workspace_column_allowed: ' || coalesce(v_err, '');
  -- the columns table directly: workspace-wide, restricted can't write it (ruling)
  v_n := pg_temp.rows_as(v_restr, format('delete from linha_editorial_colunas where conta_id = %L', v_ws));
  assert v_n = 0, 'restricted_direct_delete_column_denied: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update linha_editorial_colunas set nome = nome || ''x'' where conta_id = %L', v_ws));
  assert v_n = 0, 'restricted_direct_update_column_denied: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format(
    'insert into linha_editorial_colunas (conta_id, nome, tipo, config, ordem) values (%L, ''Nova'', ''text'', ''{}'', 9)', v_ws));
  assert v_err = '42501', 'restricted_direct_insert_column_denied: ' || coalesce(v_err, 'inserted');
  v_n := pg_temp.n_as(v_restr, format('select count(*) from linha_editorial_colunas where conta_id = %L', v_ws));
  assert v_n >= 1, 'restricted_still_reads_columns: ' || v_n;
  v_n := pg_temp.rows_as(v_todos, format('update linha_editorial_colunas set nome = nome || ''x'' where conta_id = %L', v_ws));
  assert v_n >= 1, 'todos_direct_update_column_allowed: ' || v_n;
  v_err := pg_temp.err_as(v_todos, format(
    'insert into linha_editorial_colunas (conta_id, nome, tipo, config, ordem) values (%L, ''Nova'', ''text'', ''{}'', 9)', v_ws));
  assert v_err is null, 'todos_direct_insert_column_allowed: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_todos, format('delete from linha_editorial_colunas where conta_id = %L and nome = ''Nova''', v_ws));
  assert v_n = 1, 'todos_direct_delete_column_allowed: ' || v_n;

  -- ---------------------------------------------------------------- todos / owner unchanged
  foreach v_t in array array['tarefas', 'tarefa_series', 'tarefa_comentarios', 'tarefa_eventos',
      'subtarefas', 'tarefa_tag_links', 'mencoes', 'ideia_files', 'linhas_editoriais',
      'linha_editorial_itens', 'linha_editorial_respostas', 'briefings',
      'hub_briefing_questions', 'hub_pages'] loop
    execute format('select count(*) from %I where conta_id = %L', v_t, v_ws) into v_expected;
    v_n := pg_temp.n_as(v_todos, format('select count(*) from %I', v_t));
    assert v_n = v_expected, format('todos_counts_unchanged (%s): %s vs %s', v_t, v_n, v_expected);
    v_n := pg_temp.n_as(v_owner, format('select count(*) from %I', v_t));
    assert v_n = v_expected, format('owner_counts_unchanged (%s): %s vs %s', v_t, v_n, v_expected);
  end loop;
  select count(*) into v_expected from ideias where workspace_id = v_ws;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from ideias');
  assert v_n = v_expected, format('todos_counts_unchanged (ideias): %s vs %s', v_n, v_expected);
  select count(*) into v_expected from ideia_reactions r join ideias i on i.id = r.ideia_id where i.workspace_id = v_ws;
  v_n := pg_temp.n_as(v_todos, 'select count(*) from ideia_reactions');
  assert v_n = v_expected, format('todos_counts_unchanged (ideia_reactions): %s vs %s', v_n, v_expected);
  foreach v_t in array array['hub_brand', 'hub_brand_files'] loop
    execute format('select count(*) from %I x join clientes c on c.id = x.cliente_id where c.conta_id = %L', v_t, v_ws) into v_expected;
    v_n := pg_temp.n_as(v_todos, format('select count(*) from %I', v_t));
    assert v_n = v_expected, format('todos_counts_unchanged (%s): %s vs %s', v_t, v_n, v_expected);
  end loop;
  -- the todos agent still writes anywhere in the workspace
  v_err := pg_temp.err_as(v_todos, format(
    'insert into tarefas (conta_id, user_id, titulo, status) values (%L, %L, ''t'', ''pendente'')', v_ws, v_todos));
  assert v_err is null, 'todos_insert_task_without_client_allowed: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('update tarefas set cliente_id = %s where id = %s', v_cc, v_tb));
  assert v_err is null, 'todos_move_task_between_clients: ' || coalesce(v_err, '');
  v_err := pg_temp.err_as(v_todos, format(
    'insert into ideias (workspace_id, cliente_id, titulo, tipo, origem) values (%L, %s, ''x'', ''ideia'', ''agencia'')', v_ws, v_cb));
  assert v_err is null, 'todos_insert_ideia_into_b: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_todos, format('update hub_brand set primary_color = ''#fff'' where cliente_id = %s', v_cb));
  assert v_n = 1, 'todos_update_brand_in_b: ' || v_n;
  v_n := pg_temp.rows_as(v_todos, format('delete from subtarefas where tarefa_id = %s', v_tb));
  assert v_n >= 1, 'todos_delete_subtasks_in_b: ' || v_n;
  v_n := pg_temp.rows_as(v_todos, format('delete from tarefas where id = %s', v_tb_auth));
  assert v_n = 1, 'todos_delete_task_in_b: ' || v_n;
  v_n := pg_temp.rows_as(v_todos, format('delete from ideias where id = %L', v_ib));
  assert v_n = 1, 'todos_delete_ideia_in_b: ' || v_n;
  -- non_restricted_member_can_assign_restricted_to_b_task (the intended path to "é dele")
  v_n := pg_temp.rows_as(v_todos, format('update tarefas set responsavel_id = %s where id = %s', v_membro, v_tnull));
  assert v_n = 1, 'non_restricted_member_can_assign_restricted_to_task: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tarefas where id = %s', v_tnull));
  assert v_n = 1, 'assigned_task_now_visible: ' || v_n;
end $$;

-- explain_todos_short_circuits on tarefas: my_client_scope_all() and
-- my_membro_ids() are initplans, so can_access_cliente never runs per row.
select set_config('request.jwt.claims', json_build_object('sub', (select u.id from auth.users u where u.email = 'todos@acta.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_plan text := ''; v_json json; r record;
begin
  for r in execute 'explain (verbose, costs off) select * from tarefas' loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  assert v_plan ~ 'Output: my_client_scope_all\(\)' and v_plan !~ 'Filter:[^\n]*my_client_scope_all',
    'tarefas: my_client_scope_all is an initplan: ' || v_plan;
  assert v_plan ~ 'Output: my_membro_ids\(\)' and v_plan !~ 'Filter:[^\n]*my_membro_ids',
    'tarefas: my_membro_ids is an initplan: ' || v_plan;
  assert v_plan ~ 'Filter:[^\n]*(\(InitPlan [0-9]+\)\.col1|\$[0-9]+) OR can_access_cliente\(',
    'tarefas: scope initplan comes first in the filter: ' || v_plan;
  execute 'explain (format json) select * from tarefas' into v_json;
  assert v_json::text ~ '"Subplan Name": "InitPlan', 'tarefas: JSON plan has an InitPlan: ' || v_json::text;
  assert replace(v_json -> 0 -> 'Plan' ->> 'Filter', 'hashed SubPlan', '') !~ 'SubPlan',
    'tarefas: no per-row SubPlan: ' || v_json::text;
end $$;
reset role;

-- function_privileges: helpers callable by authenticated (policies), trigger
-- functions never; anon never; service_role always
do $$
declare v_f text;
begin
  foreach v_f in array array['public.cliente_in_active_conta(bigint)', 'public.tarefa_serie_in_active_conta(bigint)'] loop
    assert has_function_privilege('authenticated', v_f, 'EXECUTE'), 'helper executable by authenticated: ' || v_f;
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'helper not executable by anon: ' || v_f;
    assert has_function_privilege('service_role', v_f, 'EXECUTE'), 'helper executable by service_role: ' || v_f;
  end loop;
  foreach v_f in array array['public.guard_client_scope_item()', 'public.guard_scope_child_reparent()'] loop
    assert not has_function_privilege('authenticated', v_f, 'EXECUTE'), 'trigger fn not executable by authenticated: ' || v_f;
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'trigger fn not executable by anon: ' || v_f;
    assert has_function_privilege('service_role', v_f, 'EXECUTE'), 'trigger fn executable by service_role: ' || v_f;
  end loop;
  -- the gated RPCs keep their grants (CREATE OR REPLACE keeps the ACL)
  foreach v_f in array array['public.tarefa_serie_criar(jsonb,jsonb,bigint[],text[],bigint)',
      'public.tarefa_serie_aplicar_edicao(bigint,jsonb,bigint[],jsonb,boolean)',
      'public.tarefa_serie_definir_estado(bigint,text)', 'public.tarefa_serie_excluir(bigint)',
      'public.tarefa_comentario_enviar(bigint,text)', 'public.linha_editorial_criar(bigint,date)',
      'public.linha_editorial_enviar(uuid)', 'public.linha_editorial_recolher(uuid)',
      'public.linha_editorial_converter(uuid,bigint,jsonb)', 'public.linha_editorial_coluna_excluir(uuid)'] loop
    assert has_function_privilege('authenticated', v_f, 'EXECUTE'), 'rpc executable by authenticated: ' || v_f;
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'rpc not executable by anon: ' || v_f;
  end loop;
end $$;

rollback;
\echo 99_acesso_por_cliente_tarefas: ok
