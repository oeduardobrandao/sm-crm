\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, agenda, analytics e relatórios
-- (20261117000006_acesso_por_cliente_c4_agenda_analytics.sql).
-- Agenda: agenda_eventos is an "é dele" root (organizer, or participant through
-- agenda_participantes); an event without client shows only through é dele;
-- occurrences, participants and answers follow the visible event. Writes go
-- only through the SECURITY DEFINER RPCs: create strict (accessible client, no
-- client-less event for a restricted member), edit/resolve on a visible event,
-- delete strict (accessible client, or his own client-less event), no
-- relocation out of or into a client he can't access (trigger
-- zz_client_scope_guard, which also lets the 'seguintes' split copy keep its
-- origin's client), organizer immutable, no self-invite into a hidden client.
-- Analytics (Instagram, TikTok, reports, Hub tokens, connect links, client
-- messages, comment automations and their contacts/sends/analyses): strict by
-- the client of the row or of its parent, no é dele. A report layout can only
-- reference images visible at their source (file_visible_at_source), so
-- report_document_files never carries a hidden file into a visible report.
-- RPCs: agenda_listar, the agenda write RPCs, get_mensagens_*, hub_token_*.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventory: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

begin;
-- analytics_report_paths_not_writable (catalog, BEFORE parity hands out ALL):
-- only the service-role generators write the stored file paths the edges sign
do $$
declare v_col text;
begin
  foreach v_col in array array['storage_path', 'html_storage_path', 'report_url'] loop
    assert not has_column_privilege('authenticated', 'public.analytics_reports', v_col, 'INSERT')
       and not has_column_privilege('authenticated', 'public.analytics_reports', v_col, 'UPDATE'),
      'analytics_report_paths_not_writable_by_authenticated: ' || v_col;
    assert not has_column_privilege('anon', 'public.analytics_reports', v_col, 'INSERT')
       and not has_column_privilege('anon', 'public.analytics_reports', v_col, 'UPDATE'),
      'analytics_report_paths_not_writable_by_anon: ' || v_col;
  end loop;
  assert has_column_privilege('authenticated', 'public.analytics_reports', 'client_id', 'UPDATE')
     and has_column_privilege('authenticated', 'public.analytics_reports', 'client_id', 'INSERT'),
    'analytics_reports keeps the other columns writable';
  assert not has_column_privilege('authenticated', 'public.report_documents', 'pdf_storage_path', 'UPDATE'),
    'report_documents_pdf_storage_path_not_writable';
end $$;
update plans set feature_agenda = true, feature_mensagens = true, feature_instagram_automation = true;
select et_grant_hosted_parity();
-- production grants of the tables whose privileges matter here (parity would
-- hand out ALL): agenda SELECT-only, report_documents SELECT + UPDATE (layout, title)
revoke all on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas from anon, authenticated;
grant select on public.agenda_eventos, public.agenda_ocorrencias, public.agenda_participantes, public.agenda_respostas to authenticated;
revoke all on public.report_documents from anon, authenticated;
grant select on public.report_documents to authenticated;
grant update (layout, title) on public.report_documents to authenticated;
-- analytics_reports: the migration's column grants (no storage_path,
-- html_storage_path, report_url for authenticated; parity would restore ALL)
revoke insert, update on public.analytics_reports from anon, authenticated;
grant insert (id, conta_id, client_id, instagram_account_id, report_month, generated_at, status,
              ai_content, ai_status, ai_error, include_ai, generation_error, retry_count,
              last_emailed_at, locked_at, locked_by, email_kpis) on public.analytics_reports to authenticated;
grant update (conta_id, client_id, instagram_account_id, report_month, generated_at, status,
              ai_content, ai_status, ai_error, include_ai, generation_error, retry_count,
              last_emailed_at, locked_at, locked_by, email_kpis) on public.analytics_reports to authenticated;

-- ids shared between the DO blocks
create temp table _fx (k text primary key, v text not null);
create or replace function pg_temp.fx(p_k text) returns text language sql as $f$
  select v from _fx where k = p_k;
$f$;

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
-- error message of a statement run WITHOUT RLS but with p_user's claims (the
-- SECURITY DEFINER path: triggers still see auth.uid())
create or replace function pg_temp.errm_claims(p_user uuid, p_sql text) returns text language plpgsql as $f$
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
-- base agenda create payload (every key present, as the form sends it) merged with overrides
create or replace function pg_temp.payload(p jsonb default '{}') returns jsonb language sql as $f$
  select jsonb_build_object(
    'titulo', 'Evento', 'descricao', null, 'local', null, 'link_reuniao', null,
    'tipo', 'gravacao', 'cor', null, 'cliente_id', null, 'privado', false, 'dia_inteiro', false,
    'tz', 'America/Sao_Paulo', 'inicio_local', '2026-11-10T14:00:00', 'fim_local', '2026-11-10T15:00:00',
    'lembretes', jsonb_build_array(10), 'regra', null) || p;
$f$;
create or replace function pg_temp.semanal(p_dias int[]) returns jsonb language sql as $f$
  select jsonb_build_object('freq','weekly','intervalo',1,'dias_semana',to_jsonb(p_dias),'mensal_modo',null,
                            'mensal_ordinal',null,'ate',null,'contagem',null);
$f$;
-- create an event as p_user through the RPC, returns the event id
create or replace function pg_temp.criar(p_user uuid, p jsonb, parts uuid[] default '{}') returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select c.evento_id into v from public.agenda_evento_criar(p, parts) c;
  execute 'reset role';
  return v;
end $f$;
-- occurrence of an event on a date (superuser lookup)
create or replace function pg_temp.oc(p_ev bigint, p_d date) returns bigint language sql as $f$
  select o.id from public.agenda_ocorrencias o where o.evento_id = p_ev and o.data_original = p_d;
$f$;
create or replace function pg_temp.oc1(p_ev bigint) returns bigint language sql as $f$
  select o.id from public.agenda_ocorrencias o where o.evento_id = p_ev order by o.data_original limit 1;
$f$;
-- a file row (as superuser)
create or replace function pg_temp.mkfile(p_conta uuid, p_folder bigint, p_by uuid, p_name text)
returns bigint language sql as $f$
  insert into files (conta_id, folder_id, r2_key, name, kind, mime_type, size_bytes, uploaded_by, width, height)
  values (p_conta, p_folder, 'k/' || p_name, p_name, 'image', 'image/png', 1, p_by, 10, 10)
  returning id;
$f$;
-- report layout with one image block per file id
create or replace function pg_temp.lay(p_ids bigint[]) returns jsonb language sql as $f$
  select jsonb_build_object('version', 1, 'blocks', coalesce((
    select jsonb_agg(jsonb_build_object('id', 'i' || n, 'type', 'image', 'size', 'full', 'config',
             jsonb_build_object('file_id', x, 'width', 10, 'height', 10)) order by n)
      from unnest(p_ids) with ordinality as t(x, n)), '[]'::jsonb));
$f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;
grant select on _fx to authenticated;

-- =============================================================
-- block 1: fixtures
-- =============================================================
do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_radm uuid := gen_random_uuid();
  v_ca bigint; v_cb bigint;
  v_fca bigint; v_fcb bigint;
  ig_a uuid; ig_b uuid; tt_a uuid; tt_b uuid;
  igp_a uuid; igp_b uuid; v_tag bigint;
  ica_a uuid; ica_b uuid; iac_a uuid; iac_b uuid;
  f_a bigint; f_a2 bigint; f_b bigint;
  rd_a uuid; rd_b uuid;
  tok_a uuid; tok_b uuid;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@acag.test'), (v_todos, 'todos@acag.test'), (v_restr, 'restr@acag.test'), (v_radm, 'radm@acag.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_todos, v_ws, 'agent'), (v_restr, v_ws, 'agent'), (v_radm, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_todos, v_restr, v_radm);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;
  -- restricted members (agent and admin) assigned to A; B hidden
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id in (v_restr, v_radm);
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca), (v_ws, v_radm, v_ca);

  select id into strict v_fca from folders where conta_id = v_ws and source_type = 'client' and source_id = v_ca;
  select id into strict v_fcb from folders where conta_id = v_ws and source_type = 'client' and source_id = v_cb;

  -- Instagram / TikTok
  insert into instagram_accounts (client_id, instagram_user_id) values (v_ca, 'ig-a') returning id into ig_a;
  insert into instagram_accounts (client_id, instagram_user_id) values (v_cb, 'ig-b') returning id into ig_b;
  insert into instagram_posts (instagram_account_id, instagram_post_id, posted_at) values (ig_a, 'pa1', now()) returning id into igp_a;
  insert into instagram_posts (instagram_account_id, instagram_post_id, posted_at) values (ig_a, 'pa2', now());
  insert into instagram_posts (instagram_account_id, instagram_post_id, posted_at) values (ig_b, 'pb1', now()) returning id into igp_b;
  insert into instagram_follower_history (instagram_account_id, date, follower_count) values (ig_a, '2026-11-01', 10), (ig_b, '2026-11-01', 20);
  insert into instagram_analytics_cache (instagram_account_id, cache_key) values (ig_a, 'acag-a'), (ig_b, 'acag-b');
  insert into instagram_post_tags (conta_id, tag_name) values (v_ws, 'acag') returning id into v_tag;
  insert into instagram_post_tag_assignments (post_id, tag_id) values (igp_a, v_tag), (igp_b, v_tag);
  insert into instagram_comment_analyses (conta_id, instagram_account_id, ig_user_id, scope, comments_analyzed, comments_count_at_analysis, result, model)
    values (v_ws, ig_a, 'ig-a', 'account', 1, 1, '{}', 'm'), (v_ws, ig_b, 'ig-b', 'account', 1, 1, '{}', 'm');
  insert into tiktok_accounts (client_id, tiktok_open_id) values (v_ca, 'tt-a') returning id into tt_a;
  insert into tiktok_accounts (client_id, tiktok_open_id) values (v_cb, 'tt-b') returning id into tt_b;
  insert into tiktok_posts (tiktok_account_id, tiktok_video_id) values (tt_a, 'va'), (tt_b, 'vb');
  insert into tiktok_follower_history (tiktok_account_id, date, follower_count) values (tt_a, '2026-11-01', 1), (tt_b, '2026-11-01', 2);

  -- comment automations, contacts, sends
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_ca, 'auto A', '{oi}', 'msg') returning id into ica_a;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_cb, 'auto B', '{oi}', 'msg') returning id into ica_b;
  insert into instagram_automation_contacts (conta_id, client_id, commenter_id, first_interaction_at, last_interaction_at)
    values (v_ws, v_ca, 'c-a', now(), now()) returning id into iac_a;
  insert into instagram_automation_contacts (conta_id, client_id, commenter_id, first_interaction_at, last_interaction_at)
    values (v_ws, v_cb, 'c-b', now(), now()) returning id into iac_b;
  insert into instagram_automation_contact_automations (contact_id, conta_id, automation_id, automation_name, first_interaction_at, last_interaction_at)
    values (iac_a, v_ws, ica_a, 'auto A', now(), now()), (iac_b, v_ws, ica_b, 'auto B', now(), now());
  insert into instagram_automation_sends (comment_id, automation_id, conta_id, comment_created_at)
    values ('cm-a', ica_a, v_ws, now()), ('cm-b', ica_b, v_ws, now());

  -- reports, hub tokens, connect links, client messages
  insert into analytics_reports (conta_id, client_id, report_month) values (v_ws, v_ca, '2026-10'), (v_ws, v_cb, '2026-10'), (v_ws, null, '2026-09');
  f_a := pg_temp.mkfile(v_ws, v_fca, v_owner, 'acag-fA');
  f_a2 := pg_temp.mkfile(v_ws, v_fca, v_owner, 'acag-fA2');
  f_b := pg_temp.mkfile(v_ws, v_fcb, v_owner, 'acag-fB');
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws, v_ca, '2026-10-01', '2026-10-31', pg_temp.lay(array[f_a])) returning id into rd_a;
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws, v_cb, '2026-10-01', '2026-10-31', pg_temp.lay(array[f_b])) returning id into rd_b;
  insert into client_hub_tokens (cliente_id, conta_id) values (v_ca, v_ws) returning id into tok_a;
  insert into client_hub_tokens (cliente_id, conta_id) values (v_cb, v_ws) returning id into tok_b;
  insert into instagram_connect_links (cliente_id, conta_id, created_by, expires_at)
    values (v_ca, v_ws, v_owner, now() + interval '1 day'), (v_cb, v_ws, v_owner, now() + interval '1 day');
  insert into mensagens (conta_id, cliente_id, content, is_workspace_user)
    values (v_ws, v_ca, 'oi A', false), (v_ws, v_cb, 'oi B', false);
  perform set_config('request.jwt.claims', '', true);

  insert into _fx values
    ('ws', v_ws), ('owner', v_owner), ('todos', v_todos), ('restr', v_restr), ('radm', v_radm),
    ('ca', v_ca), ('cb', v_cb), ('fca', v_fca), ('fcb', v_fcb),
    ('ig_a', ig_a), ('ig_b', ig_b), ('tt_a', tt_a), ('tt_b', tt_b), ('igp_a', igp_a), ('igp_b', igp_b),
    ('ica_a', ica_a), ('ica_b', ica_b), ('iac_a', iac_a), ('iac_b', iac_b),
    ('f_a', f_a), ('f_a2', f_a2), ('f_b', f_b), ('rd_a', rd_a), ('rd_b', rd_b),
    ('tok_a', tok_a), ('tok_b', tok_b);
end $$;

-- =============================================================
-- block 2: analytics, reports, tokens, messages: strict by client
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_todos uuid := pg_temp.fx('todos');
  v_owner uuid := pg_temp.fx('owner');
  v_restr uuid := pg_temp.fx('restr');
  v_ca bigint := pg_temp.fx('ca'); v_cb bigint := pg_temp.fx('cb');
  ig_a uuid := pg_temp.fx('ig_a'); ig_b uuid := pg_temp.fx('ig_b');
  tt_a uuid := pg_temp.fx('tt_a'); tt_b uuid := pg_temp.fx('tt_b');
  ica_a uuid := pg_temp.fx('ica_a'); ica_b uuid := pg_temp.fx('ica_b');
  rd_a uuid := pg_temp.fx('rd_a'); rd_b uuid := pg_temp.fx('rd_b');
  tok_b uuid := pg_temp.fx('tok_b');
  f_a bigint := pg_temp.fx('f_a'); f_a2 bigint := pg_temp.fx('f_a2'); f_b bigint := pg_temp.fx('f_b');
  v_n bigint; v_err text; v_t text;
  r record;
begin
  -- per table: (rows the restricted member sees, query). Every table here has
  -- exactly one fixture row per client (instagram_posts: two in A, one in B;
  -- analytics_reports: one more without client).
  for r in select * from (values
      ('instagram_accounts', 1::bigint),
      ('instagram_posts', 2),
      ('instagram_follower_history', 1),
      ('instagram_analytics_cache', 1),
      ('instagram_post_tag_assignments', 1),
      ('instagram_comment_analyses', 1),
      ('tiktok_accounts', 1),
      ('tiktok_posts', 1),
      ('tiktok_follower_history', 1),
      ('instagram_comment_automations', 1),
      ('instagram_automation_contacts', 1),
      ('instagram_automation_contact_automations', 1),
      ('instagram_automation_sends', 1),
      ('analytics_reports', 1),
      ('report_documents', 1),
      ('report_document_files', 1),
      ('client_hub_tokens', 1),
      ('instagram_connect_links', 1),
      ('mensagens', 1)) as t(tbl, expected) loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I', r.tbl));
    assert v_n = r.expected, format('restricted_sees_only_a (%s): %s, expected %s', r.tbl, v_n, r.expected);
  end loop;

  -- ig_metrics_of_b_hidden
  v_n := pg_temp.n_as(v_restr, format('select count(*) from instagram_posts where instagram_account_id = %L', ig_b));
  assert v_n = 0, 'ig_metrics_of_b_hidden (posts): ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from instagram_follower_history where instagram_account_id = %L', ig_b));
  assert v_n = 0, 'ig_metrics_of_b_hidden (followers): ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from instagram_account_last_post where instagram_account_id = %L', ig_b));
  assert v_n = 0, 'ig_last_post_view_of_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from instagram_account_last_post where instagram_account_id = %L', ig_a));
  assert v_n = 1, 'ig_last_post_view_of_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from tiktok_follower_history where tiktok_account_id = %L', tt_b));
  assert v_n = 0, 'tiktok_metrics_of_b_hidden: ' || v_n;
  -- report_of_b_hidden
  v_n := pg_temp.n_as(v_restr, format('select count(*) from report_documents where id = %L', rd_b));
  assert v_n = 0, 'report_of_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from report_document_files where report_id = %L', rd_b));
  assert v_n = 0, 'report_files_of_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from analytics_reports where client_id is null'));
  assert v_n = 0, 'analytics_report_without_client_hidden: ' || v_n;
  -- a report file link opens no file: files keep the 4c rules
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id = %s', f_b));
  assert v_n = 0, 'report_link_does_not_open_file: ' || v_n;
  -- tokens of a hidden client are never readable
  v_n := pg_temp.n_as(v_restr, format('select count(*) from client_hub_tokens where id = %L', tok_b));
  assert v_n = 0, 'hub_token_of_b_hidden: ' || v_n;

  -- ---- writes: strict ----
  v_err := pg_temp.err_as(v_restr, format('insert into instagram_accounts (client_id, instagram_user_id) values (%s, ''x-b'')', v_cb));
  assert v_err = '42501', 'insert_ig_account_into_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('update instagram_accounts set client_id = %s where id = %L', v_cb, ig_a));
  assert v_err = '42501', 'move_ig_account_to_b_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.rows_as(v_restr, format('update instagram_accounts set username = ''x'' where id = %L', ig_b));
  assert v_n = 0, 'update_ig_account_of_b_noop: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from instagram_posts where instagram_account_id = %L', ig_b));
  assert v_n = 0, 'delete_ig_posts_of_b_noop: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format('insert into instagram_posts (instagram_account_id, instagram_post_id) values (%L, ''x'')', ig_b));
  assert v_err = '42501', 'insert_ig_post_into_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into tiktok_accounts (client_id, tiktok_open_id) values (%s, ''x-b'')', v_cb));
  assert v_err = '42501', 'insert_tiktok_account_into_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('update tiktok_accounts set client_id = %s where id = %L', v_cb, tt_a));
  assert v_err = '42501', 'move_tiktok_account_to_b_denied: ' || coalesce(v_err, 'ok');

  v_err := pg_temp.err_as(v_restr, format('insert into analytics_reports (conta_id, client_id, report_month) values (%L, %s, ''2026-11'')', v_ws, v_cb));
  assert v_err = '42501', 'insert_analytics_report_into_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into analytics_reports (conta_id, client_id, report_month) values (%L, null, ''2026-11'')', v_ws));
  assert v_err = '42501', 'insert_analytics_report_without_client_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into analytics_reports (conta_id, client_id, report_month) values (%L, %s, ''2026-11'')', v_ws, v_ca));
  assert v_err is null, 'insert_analytics_report_into_a_ok: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_restr, format('delete from analytics_reports where client_id = %s', v_cb));
  assert v_n = 0, 'delete_analytics_report_of_b_noop: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format('update analytics_reports set client_id = %s where client_id = %s', v_cb, v_ca));
  assert v_err = '42501', 'move_analytics_report_to_b_denied: ' || coalesce(v_err, 'ok');

  -- report file paths: no authenticated caller writes them (only the service-role
  -- generators do; the edges sign the stored path), so every path shape is
  -- refused by privilege, whatever its encoding
  foreach v_t in array array[
      format('reports/%s/%s/2026-10.pdf', v_ws, v_cb),
      format('reports/%s/%s/%%2e%%2e/%s/2026-10.pdf', v_ws, v_ca, v_cb),
      format('reports/%s/%s/..\%s\2026-10.pdf', v_ws, v_ca, v_cb),
      format('reports/%s/%s/./2026-10.pdf', v_ws, v_ca)] loop
    v_err := pg_temp.err_as(v_restr, format('insert into analytics_reports (conta_id, client_id, report_month, storage_path) values (%L, %s, ''2026-08'', %L)', v_ws, v_ca, v_t));
    assert v_err = '42501', format('analytics_report_insert_path_denied (%s): %s', v_t, coalesce(v_err, 'ok'));
    v_err := pg_temp.err_as(v_restr, format('update analytics_reports set storage_path = %L where client_id = %s', v_t, v_ca));
    assert v_err = '42501', format('analytics_report_update_pdf_path_denied (%s): %s', v_t, coalesce(v_err, 'ok'));
    v_err := pg_temp.err_as(v_restr, format('update analytics_reports set html_storage_path = %L where client_id = %s', v_t, v_ca));
    assert v_err = '42501', format('analytics_report_update_html_path_denied (%s): %s', v_t, coalesce(v_err, 'ok'));
  end loop;
  v_err := pg_temp.err_as(v_restr, format('update analytics_reports set report_url = ''https://x'' where client_id = %s', v_ca));
  assert v_err = '42501', 'analytics_report_update_report_url_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_todos, format('update analytics_reports set storage_path = %L where client_id = %s', format('reports/%s/%s/2026-10.pdf', v_ws, v_cb), v_ca));
  assert v_err = '42501', 'todos_analytics_report_path_not_writable_either: ' || coalesce(v_err, 'ok');
  -- account: only one of the row's own client
  v_err := pg_temp.errm_as(v_restr, format('insert into analytics_reports (conta_id, client_id, report_month, instagram_account_id) values (%L, %s, ''2026-07'', %L)',
             v_ws, v_ca, ig_b));
  assert v_err = 'client_scope_restricted', 'analytics_report_with_b_account_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('insert into analytics_reports (conta_id, client_id, report_month, instagram_account_id) values (%L, %s, ''2026-06'', %L)',
             v_ws, v_ca, ig_a));
  assert v_err is null, 'analytics_report_own_client_account_ok: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_todos, format('update analytics_reports set instagram_account_id = %L where client_id = %s and report_month = ''2026-06''', ig_b, v_ca));
  assert v_n = 1, 'todos_analytics_report_account_unchanged: ' || v_n;
  -- other signed paths in these tables are not writable by authenticated
  assert not has_column_privilege('authenticated', 'public.report_documents', 'pdf_storage_path', 'UPDATE'),
    'report_documents_pdf_storage_path_not_writable';

  v_n := pg_temp.rows_as(v_restr, format('update report_documents set title = ''x'' where id = %L', rd_b));
  assert v_n = 0, 'update_report_of_b_noop: ' || v_n;
  -- report layout: a new image must be visible at its source (no hidden file
  -- laundered into a visible report through report_document_files)
  v_err := pg_temp.errm_as(v_restr, format('update report_documents set layout = %L where id = %L', pg_temp.lay(array[f_a, f_b]), rd_a));
  assert v_err = 'client_scope_restricted', 'report_layout_with_hidden_file_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.rows_as(v_restr, format('update report_documents set layout = %L where id = %L', pg_temp.lay(array[f_a, f_a2]), rd_a));
  assert v_n = 1, 'report_layout_with_visible_files_ok: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update report_documents set title = ''t'' where id = %L', rd_a));
  assert v_n = 1, 'report_title_update_in_a_ok: ' || v_n;

  v_err := pg_temp.err_as(v_restr, format('insert into client_hub_tokens (cliente_id, conta_id) values (%s, %L)', v_cb, v_ws));
  assert v_err = '42501', 'insert_hub_token_for_b_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.rows_as(v_restr, format('update client_hub_tokens set is_active = false where id = %L', tok_b));
  assert v_n = 0, 'update_hub_token_of_b_noop: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format('insert into instagram_connect_links (cliente_id, conta_id, created_by, expires_at) values (%s, %L, %L, now() + interval ''1 day'')', v_cb, v_ws, v_restr));
  assert v_err = '42501', 'insert_connect_link_for_b_denied: ' || coalesce(v_err, 'ok');

  v_err := pg_temp.err_as(v_restr, format('insert into mensagens (conta_id, cliente_id, content, is_workspace_user, author_user_id) values (%L, %s, ''x'', true, %L)', v_ws, v_cb, v_restr));
  assert v_err = '42501', 'insert_message_to_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into mensagens (conta_id, cliente_id, content, is_workspace_user, author_user_id) values (%L, %s, ''x'', true, %L)', v_ws, v_ca, v_restr));
  assert v_err is null, 'insert_message_to_a_ok: ' || coalesce(v_err, '');

  v_err := pg_temp.err_as(v_restr, format('insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message) values (%L, %s, ''x'', ''{oi}'', ''m'')', v_ws, v_cb));
  assert v_err = '42501', 'insert_automation_into_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('update instagram_comment_automations set client_id = %s where id = %L', v_cb, ica_a));
  assert v_err = '42501', 'move_automation_to_b_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.rows_as(v_restr, format('update instagram_comment_automations set name = ''x'' where id = %L', ica_b));
  assert v_n = 0, 'update_automation_of_b_noop: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from instagram_comment_automations where id = %L', ica_b));
  assert v_n = 0, 'delete_automation_of_b_noop: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update instagram_comment_automations set name = ''A2'' where id = %L', ica_a));
  assert v_n = 1, 'update_automation_of_a_ok: ' || v_n;

  -- the todos agent and the owner write in B
  v_n := pg_temp.rows_as(v_todos, format('update instagram_comment_automations set name = ''B2'' where id = %L', ica_b));
  assert v_n = 1, 'todos_update_automation_of_b_ok: ' || v_n;
  v_err := pg_temp.err_as(v_todos, format('insert into analytics_reports (conta_id, client_id, report_month) values (%L, null, ''2026-12'')', v_ws));
  assert v_err is null, 'todos_insert_report_without_client_ok: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_todos, format('update report_documents set layout = %L where id = %L', pg_temp.lay(array[f_b, f_a]), rd_b));
  assert v_n = 1, 'todos_report_layout_any_file_ok: ' || v_n;
  v_err := pg_temp.err_as(v_todos, format('insert into mensagens (conta_id, cliente_id, content, is_workspace_user, author_user_id) values (%L, %s, ''x'', true, %L)', v_ws, v_cb, v_todos));
  assert v_err is null, 'todos_message_to_b_ok: ' || coalesce(v_err, '');
end $$;

-- =============================================================
-- block 3: agenda tables and RPCs
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_owner uuid := pg_temp.fx('owner');
  v_todos uuid := pg_temp.fx('todos');
  v_restr uuid := pg_temp.fx('restr');
  v_radm uuid := pg_temp.fx('radm');
  v_ca bigint := pg_temp.fx('ca'); v_cb bigint := pg_temp.fx('cb');
  e_a bigint; e_a2 bigint; e_b bigint; e_b2 bigint; e_bpart bigint; e_borg bigint;
  e_no bigint; e_noown bigint; e_noown2 bigint; e_nopart bigint; e_bser bigint; e_tail bigint;
  v_vis bigint[]; v_all bigint[];
  v_n bigint; v_expected bigint; v_err text; v_id bigint; v_feed jsonb; v_rm bigint; v_oc bigint;
begin
  perform set_config('app.agenda_hoje', '2026-11-02', true);
  -- events created by the owner through the RPC (one occurrence each, 2026-11-10)
  e_a := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eA', 'cliente_id', v_ca)));
  e_a2 := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eA2', 'cliente_id', v_ca)));
  e_b := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eB', 'cliente_id', v_cb)));
  e_b2 := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eB2', 'cliente_id', v_cb, 'compartilhado_cliente', true)));
  e_bpart := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eBpart', 'cliente_id', v_cb)), array[v_restr, v_radm]);
  e_borg := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eBorg', 'cliente_id', v_cb)));
  e_no := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eNo')));
  e_noown := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eNoOwn')));
  e_noown2 := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eNoOwn2')));
  e_nopart := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eNoPart')), array[v_restr]);
  e_bser := pg_temp.criar(v_owner, pg_temp.payload(jsonb_build_object('titulo', 'eBser', 'cliente_id', v_cb,
              'inicio_local', '2026-11-09T09:00:00', 'fim_local', '2026-11-09T10:00:00', 'regra', pg_temp.semanal('{1}'))), array[v_radm]);
  -- the restricted agent organizes eBorg / eNoOwn / eNoOwn2 (superuser, no claims)
  perform set_config('request.jwt.claims', '', true);
  update agenda_eventos set organizador_id = v_restr where id in (e_borg, e_noown, e_noown2);
  update agenda_participantes set user_id = v_restr where evento_id in (e_borg, e_noown, e_noown2) and user_id = v_owner;
  -- per-occurrence answers: his on a visible event, the owner's on a hidden one
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta)
    values (pg_temp.oc1(e_bpart), v_ws, v_restr, 'talvez'), (pg_temp.oc1(e_b), v_ws, v_owner, 'sim');

  v_vis := array[e_a, e_a2, e_bpart, e_borg, e_noown, e_noown2, e_nopart];
  v_all := v_vis || array[e_b, e_b2, e_no, e_bser];

  -- ---- reads ----
  v_n := pg_temp.n_as(v_restr, format('select count(*) from agenda_eventos where id = any (%L::bigint[])', v_all));
  assert v_n = cardinality(v_vis), 'restricted_sees_visible_events: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from agenda_eventos where id in (%s, %s)', e_noown, e_nopart));
  assert v_n = 2, 'agenda_event_own_without_client_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from agenda_eventos where id = %s', e_no));
  assert v_n = 0, 'agenda_event_without_client_of_other_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from agenda_eventos where id in (%s, %s)', e_b, e_bser));
  assert v_n = 0, 'agenda_event_in_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from agenda_eventos where id in (%s, %s)', e_bpart, e_borg));
  assert v_n = 2, 'agenda_event_own_in_b_visible: ' || v_n;
  select count(*) into v_expected from agenda_ocorrencias where evento_id = any (v_vis);
  v_n := pg_temp.n_as(v_restr, format('select count(*) from agenda_ocorrencias where evento_id = any (%L::bigint[])', v_all));
  assert v_n = v_expected, format('occurrences_follow_event: %s vs %s', v_n, v_expected);
  select count(*) into v_expected from agenda_participantes where evento_id = any (v_vis);
  v_n := pg_temp.n_as(v_restr, format('select count(*) from agenda_participantes where evento_id = any (%L::bigint[])', v_all));
  assert v_n = v_expected, format('participants_follow_event: %s vs %s', v_n, v_expected);
  v_n := pg_temp.n_as(v_restr, 'select count(*) from agenda_respostas');
  assert v_n = 1, 'answers_follow_event: ' || v_n;
  -- the radm admin (participant of eBpart and eBser) sees them; eB/eB2 stay hidden
  v_n := pg_temp.n_as(v_radm, format('select count(*) from agenda_eventos where id in (%s, %s, %s, %s)', e_bpart, e_bser, e_b, e_b2));
  assert v_n = 2, 'radm_sees_only_own_b_events: ' || v_n;

  -- agenda_listar: same set, client name of a hidden client only through context
  select count(*) into v_expected from agenda_ocorrencias o
   where o.evento_id = any (v_vis) and not o.cancelada and o.inicio < '2026-12-31' and o.fim > '2026-11-02';
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.agenda_listar(''2026-11-02'', ''2026-12-31'') l where l.evento_id = any (%L::bigint[])', v_all));
  assert v_n = v_expected, format('agenda_listar_scoped: %s vs %s', v_n, v_expected);
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.agenda_listar(''2026-11-02'', ''2026-12-31'') l where l.evento_id = %s and l.cliente_id = %s and l.cliente_nome is null', e_bpart, v_cb));
  assert v_n = 1, 'agenda_listar_own_b_event_without_client_name: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.agenda_listar(''2026-11-02'', ''2026-12-31'') l where l.evento_id = %s and l.cliente_nome = ''A''', e_a));
  assert v_n = 1, 'agenda_listar_a_event_with_client_name: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.agenda_listar(null, null, %s)', pg_temp.oc1(e_b)));
  assert v_n = 0, 'agenda_listar_single_occurrence_of_b_hidden: ' || v_n;
  select count(*) into v_expected from agenda_ocorrencias o
   where o.evento_id = any (v_all) and not o.cancelada and o.inicio < '2026-12-31' and o.fim > '2026-11-02';
  v_n := pg_temp.n_as(v_todos, format('select count(*) from public.agenda_listar(''2026-11-02'', ''2026-12-31'') l where l.evento_id = any (%L::bigint[])', v_all));
  assert v_n = v_expected, format('todos_agenda_listar_unchanged: %s vs %s', v_n, v_expected);
  v_n := pg_temp.n_as(v_todos, format('select count(*) from public.agenda_listar(''2026-11-02'', ''2026-12-31'') l where l.evento_id = %s and l.cliente_nome = ''B''', e_bpart));
  assert v_n = 1, 'todos_agenda_listar_client_name: ' || v_n;

  -- agenda_feed_eventos (service role, token of the member): participant-only by construction
  insert into agenda_feed_tokens (user_id, conta_id, token) values (v_restr, v_ws, 'acag-feed-restr');
  insert into agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
    values (v_ws, e_bpart, current_date + 400, now() + interval '1 day', now() + interval '25 hours'),
           (v_ws, e_b, current_date + 400, now() + interval '1 day', now() + interval '25 hours');
  v_feed := public.agenda_feed_eventos('acag-feed-restr');
  assert v_feed->>'estado' = 'ok', 'feed: ' || coalesce(v_feed::text, 'null');
  assert exists (select 1 from jsonb_array_elements(v_feed->'eventos') x where (x->>'evento_id')::bigint = e_bpart),
    'agenda_feed_own_b_event_included';
  assert not exists (select 1 from jsonb_array_elements(v_feed->'eventos') x where (x->>'evento_id')::bigint = any (array[e_b, e_no, e_a])),
    'agenda_feed_only_participant_events: ' || (v_feed->'eventos')::text;

  -- ---- create: strict ----
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_evento_criar(%L::jsonb, ''{}''::uuid[])',
             pg_temp.payload(jsonb_build_object('cliente_id', v_cb))));
  assert v_err = 'client_scope_restricted', 'agenda_create_in_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_evento_criar(%L::jsonb, ''{}''::uuid[])', pg_temp.payload()));
  assert v_err = 'client_scope_restricted', 'agenda_create_without_client_denied_for_restricted: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_evento_criar(%L::jsonb, ''{}''::uuid[])',
             pg_temp.payload(jsonb_build_object('cliente_id', v_ca))));
  assert v_err is null, 'agenda_create_in_a_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select public.agenda_evento_criar(%L::jsonb, ''{}''::uuid[])', pg_temp.payload()));
  assert v_err is null, 'todos_agenda_create_without_client_ok: ' || coalesce(v_err, '');

  -- ---- edit: visible event only; no relocation ----
  v_err := pg_temp.errm_as(v_radm, format('select public.agenda_evento_editar(%s, ''todas'', ''{"titulo":"x"}''::jsonb)', pg_temp.oc1(e_b2)));
  assert v_err = 'agenda: este evento não existe mais', 'agenda_edit_hidden_b_event_by_restricted_admin_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_evento_editar(%s, ''todas'', ''{"titulo":"meu"}''::jsonb)', pg_temp.oc1(e_borg)));
  assert v_err is null, 'agenda_edit_own_b_event_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_evento_editar(%s, ''todas'', %L::jsonb)', pg_temp.oc1(e_borg), jsonb_build_object('cliente_id', v_ca)));
  assert v_err = 'client_scope_restricted', 'agenda_move_own_b_event_to_a_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_radm, format('select public.agenda_evento_editar(%s, ''todas'', %L::jsonb)', pg_temp.oc1(e_a), jsonb_build_object('cliente_id', v_cb)));
  assert v_err = 'client_scope_restricted', 'agenda_move_a_event_to_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_radm, format('select public.agenda_evento_editar(%s, ''todas'', %L::jsonb)', pg_temp.oc1(e_a), jsonb_build_object('cliente_id', null)));
  assert v_err = 'client_scope_restricted', 'agenda_detach_a_event_from_client_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_evento_editar(%s, ''todas'', %L::jsonb)', pg_temp.oc1(e_noown2), jsonb_build_object('cliente_id', v_ca)));
  assert v_err is null, 'agenda_give_own_client_less_event_an_accessible_client_ok: ' || coalesce(v_err, '');
  -- the 'seguintes' split of his own series in B keeps working; the tail can't leave B
  v_err := pg_temp.errm_as(v_radm, format('select public.agenda_evento_editar(%s, ''seguintes'', ''{"titulo":"tail"}''::jsonb)', pg_temp.oc(e_bser, '2026-11-16')));
  assert v_err is null, 'agenda_split_own_b_series_ok: ' || coalesce(v_err, '');
  select id into e_tail from agenda_eventos where serie_origem_id = e_bser;
  assert e_tail is not null and (select cliente_id from agenda_eventos where id = e_tail) = v_cb, 'agenda_split_tail_stays_in_b';
  v_err := pg_temp.errm_as(v_radm, format('select public.agenda_evento_editar(%s, ''seguintes'', %L::jsonb)',
             pg_temp.oc(e_tail, '2026-11-23'), jsonb_build_object('cliente_id', v_ca)));
  assert v_err = 'client_scope_restricted', 'agenda_split_out_of_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_owner, format('select public.agenda_evento_editar(%s, ''todas'', %L::jsonb)', pg_temp.oc1(e_b), jsonb_build_object('cliente_id', v_ca)));
  assert v_err is null, 'owner_agenda_move_b_event_to_a_ok: ' || coalesce(v_err, '');

  -- ---- delete: strict ----
  v_err := pg_temp.errm_as(v_radm, format('select public.agenda_evento_excluir(%s, ''todas'')', pg_temp.oc1(e_b2)));
  assert v_err = 'agenda: este evento não existe mais', 'agenda_delete_hidden_b_event_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_evento_excluir(%s, ''todas'')', pg_temp.oc1(e_borg)));
  assert v_err = 'client_scope_restricted', 'agenda_delete_own_b_event_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_radm, format('select public.agenda_evento_excluir(%s, ''esta'')', pg_temp.oc(e_tail, '2026-11-30')));
  assert v_err = 'client_scope_restricted', 'agenda_cancel_occurrence_of_own_b_series_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_evento_excluir(%s, ''todas'')', pg_temp.oc1(e_nopart)));
  assert v_err is not null, 'agenda_delete_client_less_event_of_other_denied';
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_evento_excluir(%s, ''todas'')', pg_temp.oc1(e_noown)));
  assert v_err is null, 'agenda_delete_own_client_less_event_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_radm, format('select public.agenda_evento_excluir(%s, ''todas'')', pg_temp.oc1(e_a2)));
  assert v_err is null, 'agenda_delete_a_event_ok: ' || coalesce(v_err, '');

  -- ---- respond: participant (é dele) ----
  v_err := pg_temp.errm_as(v_restr, format('select public.agenda_responder(%s, ''sim'', ''todas'')', pg_temp.oc1(e_bpart)));
  assert v_err is null, 'agenda_respond_own_b_event_ok: ' || coalesce(v_err, '');

  -- ---- reschedule request of a hidden event ----
  v_oc := pg_temp.oc1(e_b2);
  insert into agenda_remarcacoes (conta_id, cliente_id, ocorrencia_id, inicio_sugerido, fim_sugerido)
    values (v_ws, v_cb, v_oc, '2026-11-11 14:00+00', '2026-11-11 15:00+00') returning id into v_rm;
  v_err := pg_temp.errm_as(v_radm, format('select public.agenda_remarcacao_resolver(%s, false)', v_rm));
  assert v_err = 'agenda: este evento não existe mais', 'agenda_resolve_reschedule_of_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_owner, format('select public.agenda_remarcacao_resolver(%s, false)', v_rm));
  assert v_err is null, 'owner_agenda_resolve_reschedule_ok: ' || coalesce(v_err, '');

  -- ---- definer-path guards (claims set, no RLS) ----
  v_err := pg_temp.errm_claims(v_radm, format('insert into agenda_participantes (evento_id, conta_id, user_id) values (%s, %L, %L)', e_b2, v_ws, v_radm));
  assert v_err = 'client_scope_restricted', 'agenda_self_invite_into_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_claims(v_owner, format('insert into agenda_participantes (evento_id, conta_id, user_id) values (%s, %L, %L)', e_b2, v_ws, v_radm));
  assert v_err is null, 'non_restricted_invites_restricted_to_b_event_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_claims(v_restr, format('update agenda_eventos set organizador_id = %L where id = %s', v_restr, e_no));
  assert v_err = 'author_immutable', 'agenda_organizer_immutable: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_claims(v_restr, format('insert into agenda_eventos (conta_id, organizador_id, titulo, dtstart, duracao_min, cliente_id) values (%L, %L, ''x'', ''2026-11-10 10:00'', 30, %s)', v_ws, v_restr, v_cb));
  assert v_err = 'client_scope_restricted', 'agenda_definer_insert_into_b_denied: ' || coalesce(v_err, 'ok');
end $$;

-- =============================================================
-- block 4: message and Hub token RPCs
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_todos uuid := pg_temp.fx('todos');
  v_restr uuid := pg_temp.fx('restr');
  v_ca bigint := pg_temp.fx('ca'); v_cb bigint := pg_temp.fx('cb');
  tok_a uuid := pg_temp.fx('tok_a'); tok_b uuid := pg_temp.fx('tok_b');
  v_n bigint; v_err text;
begin
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.get_mensagens_conversas() where cliente_id = %s', v_cb));
  assert v_n = 0, 'mensagens_conversas_of_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.get_mensagens_conversas() where cliente_id = %s', v_ca));
  assert v_n = 1, 'mensagens_conversas_of_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.get_mensagens_feed() where cliente_id = %s', v_cb));
  assert v_n = 0, 'mensagens_feed_of_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.get_mensagens_feed(null, %s)', v_cb));
  assert v_n = 0, 'mensagens_feed_filtered_to_b_empty: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.get_mensagens_feed() where cliente_id = %s', v_ca));
  assert v_n >= 1, 'mensagens_feed_of_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.get_mensagens_unread() where cliente_id = %s', v_cb));
  assert v_n = 0, 'mensagens_unread_of_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from public.get_mensagens_unread() where cliente_id = %s', v_ca));
  assert v_n = 1, 'mensagens_unread_of_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_todos, format('select count(*) from public.get_mensagens_conversas() where cliente_id in (%s, %s)', v_ca, v_cb));
  assert v_n = 2, 'todos_mensagens_conversas_unchanged: ' || v_n;
  v_n := pg_temp.n_as(v_todos, format('select count(*) from public.get_mensagens_unread() where cliente_id in (%s, %s)', v_ca, v_cb));
  assert v_n = 2, 'todos_mensagens_unread_unchanged: ' || v_n;
  -- the Hub path (no user, p_conta_id) is unchanged
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.get_mensagens_feed(v_ws, v_cb);
  assert v_n >= 1, 'hub_mensagens_feed_unchanged: ' || v_n;

  v_err := pg_temp.errm_as(v_restr, format('select public.hub_token_rotate(%L)', tok_b));
  assert v_err = 'not_found', 'hub_token_rotate_of_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('select public.hub_token_extend(%L)', tok_b));
  assert v_err = 'not_found', 'hub_token_extend_of_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('select public.hub_token_rotate(%L)', tok_a));
  assert v_err is null, 'hub_token_rotate_of_a_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.errm_as(v_todos, format('select public.hub_token_extend(%L)', tok_b));
  assert v_err is null, 'todos_hub_token_extend_of_b_ok: ' || coalesce(v_err, '');
end $$;

-- =============================================================
-- block 5: todos_counts_unchanged (every touched table), exempt tables, view
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_todos uuid := pg_temp.fx('todos');
  v_owner uuid := pg_temp.fx('owner');
  v_restr uuid := pg_temp.fx('restr');
  v_ca bigint := pg_temp.fx('ca');
  ig_a uuid := pg_temp.fx('ig_a');
  v_t text; v_expected bigint; v_n bigint;
  v_where text;
begin
  foreach v_t in array array['agenda_eventos', 'agenda_ocorrencias', 'agenda_participantes', 'agenda_respostas',
      'analytics_reports', 'client_hub_tokens', 'instagram_accounts', 'instagram_analytics_cache',
      'instagram_automation_contact_automations', 'instagram_automation_contacts', 'instagram_automation_sends',
      'instagram_comment_analyses', 'instagram_comment_automations', 'instagram_connect_links',
      'instagram_follower_history', 'instagram_post_tag_assignments', 'instagram_posts', 'mensagens',
      'report_document_files', 'report_documents', 'tiktok_accounts', 'tiktok_follower_history', 'tiktok_posts'] loop
    v_where := case v_t
      when 'instagram_accounts' then format('client_id in (select id from clientes where conta_id = %L)', v_ws)
      when 'tiktok_accounts' then format('client_id in (select id from clientes where conta_id = %L)', v_ws)
      when 'instagram_posts' then format('instagram_account_id in (select ia.id from instagram_accounts ia join clientes c on c.id = ia.client_id where c.conta_id = %L)', v_ws)
      when 'instagram_follower_history' then format('instagram_account_id in (select ia.id from instagram_accounts ia join clientes c on c.id = ia.client_id where c.conta_id = %L)', v_ws)
      when 'instagram_analytics_cache' then format('instagram_account_id in (select ia.id from instagram_accounts ia join clientes c on c.id = ia.client_id where c.conta_id = %L)', v_ws)
      when 'instagram_post_tag_assignments' then format('tag_id in (select id from instagram_post_tags where conta_id = %L)', v_ws)
      when 'tiktok_posts' then format('tiktok_account_id in (select ta.id from tiktok_accounts ta join clientes c on c.id = ta.client_id where c.conta_id = %L)', v_ws)
      when 'tiktok_follower_history' then format('tiktok_account_id in (select ta.id from tiktok_accounts ta join clientes c on c.id = ta.client_id where c.conta_id = %L)', v_ws)
      else format('conta_id = %L', v_ws) end;
    execute format('select count(*) from %I where %s', v_t, v_where) into v_expected;
    assert v_expected > 0, 'fixture row missing: ' || v_t;
    v_n := pg_temp.n_as(v_todos, format('select count(*) from %I', v_t));
    assert v_n = v_expected, format('todos_counts_unchanged (%s): %s vs %s', v_t, v_n, v_expected);
    v_n := pg_temp.n_as(v_owner, format('select count(*) from %I', v_t));
    assert v_n = v_expected, format('owner_counts_unchanged (%s): %s vs %s', v_t, v_n, v_expected);
  end loop;

  -- exempt tables: RLS on and no policy any signed-in user matches (only
  -- service_role, or the legacy USING (auth.role() = 'service_role'))
  foreach v_t in array array['agenda_convidados', 'agenda_emails_cliente', 'agenda_lembretes', 'agenda_remarcacoes',
      'agenda_respostas_cliente', 'agenda_respostas_convidado', 'gbp_locations', 'gbp_metrics_daily',
      'gbp_rating_daily', 'gbp_reviews', 'gbp_search_keywords_monthly', 'youtube_channels', 'youtube_channel_daily',
      'youtube_demographics', 'youtube_traffic_daily', 'youtube_video_daily', 'youtube_videos', 'youtube_pdf_purges',
      'mensagens_last_seen', 'tiktok_post_metrics_daily', 'instagram_account_metrics_daily',
      'instagram_account_metrics_monthly', 'instagram_story_insights', 'tiktok_account_metrics_daily'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass), 'exempt_rls_on: ' || v_t;
    assert not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v_t
                         and p.roles <> array['service_role']::name[]
                         and coalesce(p.qual, '') <> '(auth.role() = ''service_role''::text)'),
      'exempt_only_service_role_policies: ' || v_t;
  end loop;
  -- with rows present (and parity's ALL grants), the restricted and todos members read none
  insert into mensagens_last_seen (conta_id, user_id, last_seen_at) values (v_ws, v_owner, now());
  insert into mensagens_last_seen (conta_id, cliente_id, last_seen_at) values (v_ws, v_ca, now());
  insert into instagram_account_metrics_daily (instagram_account_id, snapshot_date) values (ig_a, '2026-11-01');
  foreach v_t in array array['mensagens_last_seen', 'instagram_account_metrics_daily', 'agenda_remarcacoes'] loop
    v_n := pg_temp.n_as(v_restr, format('select count(*) from %I', v_t));
    assert v_n = 0, format('exempt_unreadable_by_restricted (%s): %s', v_t, v_n);
    v_n := pg_temp.n_as(v_todos, format('select count(*) from %I', v_t));
    assert v_n = 0, format('exempt_unreadable_by_todos (%s): %s', v_t, v_n);
  end loop;

  assert (select coalesce(reloptions, '{}') @> array['security_invoker=true'] from pg_class
           where oid = 'public.instagram_account_last_post'::regclass),
    'instagram_account_last_post_is_security_invoker';
end $$;

-- =============================================================
-- block 6: explain_todos_short_circuits + zero scope calls for todos
-- =============================================================
set local track_functions = 'all';
-- the plan has a filter "((InitPlan N).col1 OR can_access_cliente(" and InitPlan N
-- is my_client_scope_all() (not some other initplan of the same plan, such as
-- has_permission or get_my_conta_id)
create or replace function pg_temp.assert_scope_initplan(p_plan text, p_label text) returns void language plpgsql as $f$
declare v_n text;
begin
  v_n := (regexp_match(p_plan, 'Filter:[^\n]*\(\(InitPlan ([0-9]+)\)\.col1 OR can_access_cliente\('))[1];
  assert v_n is not null, p_label || ': scope initplan comes first in an OR with can_access_cliente: ' || p_plan;
  assert p_plan ~ ('InitPlan ' || v_n || '\n\s*->  Result\n\s*Output: my_client_scope_all\(\)'),
    p_label || ': InitPlan ' || v_n || ' is my_client_scope_all(): ' || p_plan;
end $f$;
grant execute on function pg_temp.assert_scope_initplan(text, text) to authenticated;
do $$
declare v_plan text := ''; r record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select u.id from auth.users u where u.email = 'todos@acag.test'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  for r in execute 'explain (verbose, costs off) select * from instagram_accounts' loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  perform pg_temp.assert_scope_initplan(v_plan, 'instagram_accounts');
  v_plan := '';
  for r in execute 'explain (verbose, costs off) select * from agenda_eventos' loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  perform pg_temp.assert_scope_initplan(v_plan, 'agenda_eventos');
  -- children: the parent's subquery carries the scope initplan (instagram_posts via
  -- instagram_accounts, agenda_ocorrencias via agenda_eventos)
  v_plan := '';
  for r in execute 'explain (verbose, costs off) select * from instagram_posts' loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  perform pg_temp.assert_scope_initplan(v_plan, 'instagram_posts');
  v_plan := '';
  for r in execute 'explain (verbose, costs off) select * from agenda_ocorrencias' loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  perform pg_temp.assert_scope_initplan(v_plan, 'agenda_ocorrencias');
  execute 'reset role';
end $$;

create or replace function pg_temp.scope_calls() returns bigint language sql as $f$
  select coalesce(sum(calls), 0)::bigint from pg_stat_xact_user_functions where funcname = 'can_access_cliente';
$f$;
do $$
declare
  v_todos uuid := pg_temp.fx('todos');
  v_restr uuid := pg_temp.fx('restr');
  c0 bigint; c1 bigint; c2 bigint; v_t text;
begin
  c0 := pg_temp.scope_calls();
  foreach v_t in array array['instagram_accounts', 'instagram_posts', 'instagram_follower_history', 'instagram_analytics_cache',
      'tiktok_posts', 'tiktok_follower_history', 'agenda_eventos', 'agenda_ocorrencias', 'agenda_participantes',
      'agenda_respostas', 'instagram_automation_sends', 'instagram_comment_analyses', 'report_document_files',
      'report_documents', 'mensagens', 'client_hub_tokens'] loop
    perform pg_temp.n_as(v_todos, format('select count(*) from %I', v_t));
  end loop;
  c1 := pg_temp.scope_calls();
  assert c1 - c0 = 0, 'todos_pays_zero_can_access_cliente_calls: ' || (c1 - c0);
  -- the counter works: the restricted member's reads do call it
  perform pg_temp.n_as(v_restr, 'select count(*) from instagram_posts');
  perform pg_temp.n_as(v_restr, 'select count(*) from agenda_ocorrencias');
  c2 := pg_temp.scope_calls();
  assert c2 > c1, 'track_functions is counting can_access_cliente: ' || c2;
end $$;

-- =============================================================
-- block 7: function privileges
-- =============================================================
do $$
declare v_f text;
begin
  foreach v_f in array array['public.guard_agenda_evento_scope()', 'public.guard_agenda_participante_scope()',
      'public.guard_report_layout_files()', 'public.guard_analytics_report_refs()'] loop
    assert not has_function_privilege('authenticated', v_f, 'EXECUTE'), 'not executable by authenticated: ' || v_f;
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'not executable by anon: ' || v_f;
    assert has_function_privilege('service_role', v_f, 'EXECUTE'), 'executable by service_role: ' || v_f;
  end loop;
  foreach v_f in array array['public.agenda_listar(timestamp with time zone, timestamp with time zone, bigint)',
      'public.agenda_evento_editar(bigint, text, jsonb, uuid[])', 'public.agenda_evento_excluir(bigint, text)',
      'public.agenda_remarcacao_resolver(bigint, boolean, text)', 'public.hub_token_rotate(uuid)',
      'public.hub_token_extend(uuid)', 'public.agenda_pode_ver_evento(bigint, boolean, uuid)'] loop
    assert has_function_privilege('authenticated', v_f, 'EXECUTE'), 'executable by authenticated: ' || v_f;
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'not executable by anon: ' || v_f;
  end loop;
  foreach v_f in array array['public.get_mensagens_conversas()',
      'public.get_mensagens_feed(uuid, bigint, timestamp with time zone, integer, text, bigint)',
      'public.get_mensagens_unread(uuid, bigint)'] loop
    assert has_function_privilege('authenticated', v_f, 'EXECUTE'), 'executable by authenticated: ' || v_f;
  end loop;
  assert not has_function_privilege('authenticated', 'public.agenda_feed_eventos(text)', 'EXECUTE'),
    'agenda_feed_eventos stays service_role only';
end $$;

-- mensagens_rpcs_not_anon: the no-user branch of these RPCs takes any
-- p_conta_id (the Hub reaches it through hub-mensagens with service role), so
-- anon must not execute them; authenticated and service_role keep EXECUTE
do $$
declare v_f text; v_err text; v_ws uuid := pg_temp.fx('ws');
begin
  foreach v_f in array array['public.get_mensagens_conversas()',
      'public.get_mensagens_feed(uuid, bigint, timestamp with time zone, integer, text, bigint)',
      'public.get_mensagens_unread(uuid, bigint)', 'public.mark_mensagens_seen(uuid, bigint)'] loop
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'mensagens_rpc_not_executable_by_anon: ' || v_f;
    assert has_function_privilege('authenticated', v_f, 'EXECUTE'), 'mensagens_rpc_executable_by_authenticated: ' || v_f;
    assert has_function_privilege('service_role', v_f, 'EXECUTE'), 'mensagens_rpc_executable_by_service_role: ' || v_f;
  end loop;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin
    perform public.get_mensagens_feed(v_ws, null);
    v_err := null;
  exception when others then
    v_err := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  assert v_err = '42501', 'anon_call_get_mensagens_feed_denied: ' || coalesce(v_err, 'ok');
end $$;

rollback;
\echo 99_acesso_por_cliente_agenda: ok
