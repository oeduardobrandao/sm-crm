\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, arquivos (20261115000005_acesso_por_cliente_c3_arquivos.sql):
-- files, folders and post_file_links.
-- A file's client is its folder's, resolved by walking parent_id up to a source
-- folder (client/client_reports -> source_id, workflow -> workflows.cliente_id,
-- post -> workflow_posts.cliente_id, root_clients or no folder -> no client).
-- Restricted member reads: files/folders of clients he accesses; files linked to
-- a post he sees (his own post in a hidden client included); his own uploads;
-- the root "Clientes" container (navigation only). Writes strict: upload/insert
-- into a client he can't access or without client denied; moving needs source
-- and destination; delete strict except his own client-less upload. Links follow
-- the visible post AND need the file visible (no laundering a hidden file
-- through a link); unlink strict; re-parenting a link needs the source post.
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
-- a file row (as superuser)
create or replace function pg_temp.mkfile(p_conta uuid, p_folder bigint, p_by uuid, p_name text)
returns bigint language sql as $f$
  insert into files (conta_id, folder_id, r2_key, name, kind, mime_type, size_bytes, uploaded_by)
  values (p_conta, p_folder, 'k/' || p_name, p_name, 'image', 'image/png', 1, p_by)
  returning id;
$f$;

do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_restr uuid := gen_random_uuid();
  v_ca bigint; v_cb bigint;
  v_wa bigint; v_wb bigint;
  v_pa bigint; v_pb_own bigint; v_pb_other bigint;
  v_membro bigint;
  -- folders
  v_root bigint; v_fca bigint; v_fcb bigint; v_fwa bigint; v_fwb bigint;
  v_fpa bigint; v_fpb_own bigint; v_fpb_other bigint;
  v_ua bigint; v_ua2 bigint; v_ub bigint; v_uroot bigint; v_cyc1 bigint; v_cyc2 bigint; v_rep_a bigint;
  -- files
  f_a bigint; f_a2 bigint; f_a3 bigint; f_a_sub bigint; f_b bigint; f_b_own bigint; f_b_linked_own bigint; f_b_linked_other bigint;
  f_null_own bigint; f_null_own2 bigint; f_null_other bigint; f_root_other bigint; f_cycle bigint;
  -- links
  l_own bigint; l_other bigint; l_a bigint;
  v_n bigint; v_expected bigint; v_err text; v_t text; v_id bigint;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@acar.test'), (v_todos, 'todos@acar.test'), (v_restr, 'restr@acar.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_todos, v_ws, 'agent'), (v_restr, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_todos, v_restr);

  -- clients, workflows and posts under service-role claims: the folder_sync_*
  -- triggers create root_clients, client, workflow and post folders
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;

  -- restricted to A; B hidden
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_restr, v_ca);
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Restr', v_restr) returning id into v_membro;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_owner, v_ws, v_ca, 'WA', 'ativo') returning id into v_wa;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_owner, v_ws, v_cb, 'WB', 'ativo') returning id into v_wb;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wa, v_ws, 'pA') returning id into v_pa;
  insert into workflow_posts (workflow_id, conta_id, titulo, responsavel_id) values (v_wb, v_ws, 'pBown', v_membro) returning id into v_pb_own;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wb, v_ws, 'pBother') returning id into v_pb_other;

  select id into strict v_root from folders where conta_id = v_ws and source_type = 'root_clients';
  select id into strict v_fca from folders where conta_id = v_ws and source_type = 'client' and source_id = v_ca;
  select id into strict v_fcb from folders where conta_id = v_ws and source_type = 'client' and source_id = v_cb;
  select id into strict v_fwa from folders where conta_id = v_ws and source_type = 'workflow' and source_id = v_wa;
  select id into strict v_fwb from folders where conta_id = v_ws and source_type = 'workflow' and source_id = v_wb;
  select id into strict v_fpa from folders where conta_id = v_ws and source_type = 'post' and source_id = v_pa;
  select id into strict v_fpb_own from folders where conta_id = v_ws and source_type = 'post' and source_id = v_pb_own;
  select id into strict v_fpb_other from folders where conta_id = v_ws and source_type = 'post' and source_id = v_pb_other;
  insert into folders (conta_id, parent_id, name, source, source_type, source_id)
    values (v_ws, v_fca, 'Relatórios', 'system', 'client_reports', v_ca) returning id into v_rep_a;

  -- user folders: under A (and a nested one), under B, at the root, and a parent_id cycle
  insert into folders (conta_id, parent_id, name) values (v_ws, v_fca, 'uA') returning id into v_ua;
  insert into folders (conta_id, parent_id, name) values (v_ws, v_ua, 'uA2') returning id into v_ua2;
  insert into folders (conta_id, parent_id, name) values (v_ws, v_fcb, 'uB') returning id into v_ub;
  insert into folders (conta_id, parent_id, name) values (v_ws, null, 'uRoot') returning id into v_uroot;
  insert into folders (conta_id, parent_id, name) values (v_ws, null, 'cyc1') returning id into v_cyc1;
  insert into folders (conta_id, parent_id, name) values (v_ws, v_cyc1, 'cyc2') returning id into v_cyc2;
  update folders set parent_id = v_cyc2 where id = v_cyc1;

  f_a := pg_temp.mkfile(v_ws, v_ua, v_owner, 'fA');
  f_a2 := pg_temp.mkfile(v_ws, v_ua, v_owner, 'fA2');
  f_a3 := pg_temp.mkfile(v_ws, v_ua, v_owner, 'fA3');
  f_a_sub := pg_temp.mkfile(v_ws, v_ua2, v_owner, 'fAsub');
  f_b := pg_temp.mkfile(v_ws, v_ub, v_owner, 'fB');
  f_b_own := pg_temp.mkfile(v_ws, v_ub, v_restr, 'fBown');
  f_b_linked_own := pg_temp.mkfile(v_ws, v_fpb_own, v_owner, 'fBlinkedOwn');
  f_b_linked_other := pg_temp.mkfile(v_ws, v_fpb_other, v_owner, 'fBlinkedOther');
  f_null_own := pg_temp.mkfile(v_ws, null, v_restr, 'fNullOwn');
  f_null_own2 := pg_temp.mkfile(v_ws, null, v_restr, 'fNullOwn2');
  f_null_other := pg_temp.mkfile(v_ws, null, v_owner, 'fNullOther');
  f_root_other := pg_temp.mkfile(v_ws, v_uroot, v_owner, 'fRootOther');
  f_cycle := pg_temp.mkfile(v_ws, v_cyc1, v_owner, 'fCycle');

  insert into post_file_links (post_id, file_id, conta_id) values (v_pb_own, f_b_linked_own, v_ws) returning id into l_own;
  insert into post_file_links (post_id, file_id, conta_id) values (v_pb_other, f_b_linked_other, v_ws) returning id into l_other;
  insert into post_file_links (post_id, file_id, conta_id) values (v_pa, f_a2, v_ws) returning id into l_a;
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------
  -- resolver
  -- ---------------------------------------------------------------
  v_n := pg_temp.n_as(v_restr, format('select count(*) from (select public.folder_cliente_id(%s) c) x where c = %s', v_ua2, v_ca));
  assert v_n = 1, 'resolver_user_folder_walks_to_client: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from (select public.folder_cliente_id(%s) c) x where c = %s', v_fpb_own, v_cb));
  assert v_n = 1, 'resolver_post_folder_uses_post_client: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from (select public.folder_cliente_id(%s) c) x where c = %s', v_fwa, v_ca));
  assert v_n = 1, 'resolver_workflow_folder_uses_workflow_client: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from (select public.folder_cliente_id(%s) c) x where c = %s', v_rep_a, v_ca));
  assert v_n = 1, 'resolver_client_reports_folder: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from (select public.folder_cliente_id(%s) c) x where c is null', v_root));
  assert v_n = 1, 'resolver_root_clients_no_client: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from (select public.folder_cliente_id(%s) c) x where c is null', v_cyc1));
  assert v_n = 1, 'resolver_cycle_returns_null: ' || v_n;
  v_n := pg_temp.n_as(v_restr, 'select count(*) from (select public.folder_cliente_id(null) c) x where c is null');
  assert v_n = 1, 'resolver_null_folder_no_client: ' || v_n;

  -- ---------------------------------------------------------------
  -- files: read
  -- ---------------------------------------------------------------
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id in (%s, %s, %s)', f_a, f_a2, f_a_sub));
  assert v_n = 3, 'file_in_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id = %s', f_b));
  assert v_n = 0, 'file_in_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id = %s', f_b_linked_own));
  assert v_n = 1, 'file_linked_to_own_b_post_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id = %s', f_b_linked_other));
  assert v_n = 0, 'file_linked_to_other_b_post_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id in (%s, %s, %s)', f_null_other, f_root_other, f_cycle));
  assert v_n = 0, 'client_less_file_of_other_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id in (%s, %s)', f_null_own, f_null_own2));
  assert v_n = 2, 'own_client_less_file_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id = %s', f_b_own));
  assert v_n = 1, 'own_upload_in_b_visible: ' || v_n;

  -- ---------------------------------------------------------------
  -- folders: read
  -- ---------------------------------------------------------------
  v_n := pg_temp.n_as(v_restr, format('select count(*) from folders where id in (%s, %s, %s, %s, %s, %s)', v_fca, v_fwa, v_fpa, v_ua, v_ua2, v_rep_a));
  assert v_n = 6, 'folders_of_a_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from folders where id in (%s, %s, %s, %s, %s)', v_fcb, v_fwb, v_fpb_own, v_fpb_other, v_ub));
  assert v_n = 0, 'folders_of_b_hidden: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from folders where id = %s', v_root));
  assert v_n = 1, 'root_clients_container_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from folders where id in (%s, %s, %s)', v_uroot, v_cyc1, v_cyc2));
  assert v_n = 0, 'client_less_folders_hidden: ' || v_n;
  -- the CRM's client-folder lookup (ArquivosTab, getClientFolderId)
  v_n := pg_temp.n_as(v_restr, format('select count(*) from folders where source_type = ''client'' and source_id = %s', v_cb));
  assert v_n = 0, 'client_folder_lookup_of_b_empty: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from folders where source_type = ''client'' and source_id = %s', v_ca));
  assert v_n = 1, 'client_folder_lookup_of_a: ' || v_n;

  -- ---------------------------------------------------------------
  -- post_file_links: read
  -- ---------------------------------------------------------------
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_file_links where id in (%s, %s)', l_own, l_a));
  assert v_n = 2, 'links_of_visible_posts_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from post_file_links where id = %s', l_other));
  assert v_n = 0, 'link_of_hidden_post_hidden: ' || v_n;

  -- ---------------------------------------------------------------
  -- files: writes
  -- ---------------------------------------------------------------
  v_err := pg_temp.err_as(v_restr, format(
    'insert into files (conta_id, folder_id, r2_key, name, kind, mime_type, size_bytes, uploaded_by) values (%L, %s, ''k/up'', ''up'', ''image'', ''image/png'', 1, %L)',
    v_ws, v_ub, v_restr));
  assert v_err = '42501', 'upload_into_b_folder_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into files (conta_id, folder_id, r2_key, name, kind, mime_type, size_bytes, uploaded_by) values (%L, %s, ''k/up'', ''up'', ''image'', ''image/png'', 1, %L)',
    v_ws, v_fpb_own, v_restr));
  assert v_err = '42501', 'upload_into_own_b_post_folder_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into files (conta_id, folder_id, r2_key, name, kind, mime_type, size_bytes, uploaded_by) values (%L, null, ''k/up'', ''up'', ''image'', ''image/png'', 1, %L)',
    v_ws, v_restr));
  assert v_err = '42501', 'upload_without_folder_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into files (conta_id, folder_id, r2_key, name, kind, mime_type, size_bytes, uploaded_by) values (%L, %s, ''k/up'', ''up'', ''image'', ''image/png'', 1, %L)',
    v_ws, v_uroot, v_restr));
  assert v_err = '42501', 'upload_into_client_less_folder_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into files (conta_id, folder_id, r2_key, name, kind, mime_type, size_bytes, uploaded_by) values (%L, %s, ''k/up'', ''up'', ''image'', ''image/png'', 1, %L)',
    v_ws, v_ua, v_restr));
  assert v_err is null, 'upload_into_a_folder_ok: ' || coalesce(v_err, '');

  v_err := pg_temp.errm_as(v_restr, format('update files set folder_id = %s where id = %s', v_ub, f_a));
  assert v_err = 'client_scope_restricted', 'move_file_a_to_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('update files set folder_id = null where id = %s', f_a));
  assert v_err = 'client_scope_restricted', 'move_file_a_out_to_root_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('update files set folder_id = %s where id = %s', v_ua, f_b_own));
  assert v_err = 'client_scope_restricted', 'move_own_upload_out_of_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('update files set folder_id = %s where id = %s', v_ua, f_b_linked_own));
  assert v_err = 'client_scope_restricted', 'move_own_b_post_file_to_a_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.rows_as(v_restr, format('update files set folder_id = %s where id = %s', v_ub, f_b));
  assert v_n = 0, 'move_hidden_file_no_rows: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update files set folder_id = %s where id = %s', v_ua, f_null_own));
  assert v_n = 1, 'move_own_client_less_to_a_ok: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update files set folder_id = %s where id = %s', v_ua2, f_a));
  assert v_n = 1, 'move_within_a_ok: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update files set name = ''renamed'' where id = %s', f_b_linked_own));
  assert v_n = 1, 'rename_file_of_own_b_post_ok: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update files set name = ''renamed'' where id = %s', f_b_own));
  assert v_n = 1, 'rename_own_upload_in_b_ok: ' || v_n;
  v_err := pg_temp.errm_as(v_restr, format('update files set uploaded_by = %L where id = %s', v_restr, f_a));
  assert v_err = 'author_immutable', 'uploaded_by_rewrite_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_todos, format('update files set uploaded_by = %L where id = %s', v_todos, f_a));
  assert v_err = 'author_immutable', 'uploaded_by_rewrite_denied_for_todos_too: ' || coalesce(v_err, 'ok');

  v_n := pg_temp.rows_as(v_restr, format('delete from files where id = %s', f_null_own2));
  assert v_n = 1, 'delete_own_client_less_file_ok: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from files where id = %s', f_b_own));
  assert v_n = 0, 'delete_own_upload_in_b_denied: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from files where id = %s', f_b));
  assert v_n = 0, 'delete_hidden_file_denied: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from files where id = %s', f_null_other));
  assert v_n = 0, 'delete_client_less_file_of_other_denied: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from files where id = %s', f_a));
  assert v_n = 1, 'delete_file_in_a_ok: ' || v_n;
  assert (select count(*) from files where id in (f_b_own, f_b, f_null_other)) = 3, 'denied deletes left the rows';

  -- ---------------------------------------------------------------
  -- folders: writes
  -- ---------------------------------------------------------------
  v_err := pg_temp.err_as(v_restr, format('insert into folders (conta_id, parent_id, name) values (%L, %s, ''x'')', v_ws, v_ub));
  assert v_err = '42501', 'create_folder_in_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into folders (conta_id, parent_id, name) values (%L, null, ''x'')', v_ws));
  assert v_err = '42501', 'create_root_folder_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into folders (conta_id, parent_id, name) values (%L, %s, ''x'')', v_ws, v_root));
  assert v_err = '42501', 'create_folder_under_root_clients_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format(
    'insert into folders (conta_id, parent_id, name, source, source_type, source_id) values (%L, %s, ''x'', ''system'', ''post'', %s)',
    v_ws, v_ua, v_pb_other));
  assert v_err = '42501', 'create_folder_tagged_as_b_post_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format(
    'insert into folders (conta_id, parent_id, name, source, source_type, source_id) values (%L, %s, ''x'', ''system'', ''workflow'', %s)',
    v_ws, v_ub, v_wa));
  assert v_err = 'client_scope_restricted', 'create_a_tagged_folder_inside_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into folders (conta_id, parent_id, name) values (%L, %s, ''newA'')', v_ws, v_ua));
  assert v_err is null, 'create_folder_in_a_ok: ' || coalesce(v_err, '');

  v_err := pg_temp.err_as(v_restr, format('update folders set parent_id = %s where id = %s', v_ub, v_ua2));
  assert v_err = '42501', 'move_folder_a_into_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('update folders set parent_id = null where id = %s', v_ua2));
  assert v_err = '42501', 'move_folder_a_to_root_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.errm_as(v_restr, format('update folders set parent_id = %s where id = %s', v_fwb, v_fpa));
  assert v_err = 'client_scope_restricted', 'move_a_post_folder_inside_b_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('update folders set source_type = ''post'', source_id = %s, source = ''system'' where id = %s', v_pb_other, v_ua2));
  assert v_err = '42501', 'retag_folder_as_b_post_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.rows_as(v_restr, format('update folders set parent_id = %s where id = %s', v_ua, v_ub));
  assert v_n = 0, 'move_hidden_folder_no_rows: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update folders set name = ''Clientes!'' where id = %s', v_root));
  assert v_n = 0, 'root_clients_not_renamable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from folders where id = %s', v_root));
  assert v_n = 0, 'root_clients_not_deletable: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('update folders set name = ''uA renamed'' where id = %s', v_ua));
  assert v_n = 1, 'rename_folder_in_a_ok: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from folders where id = %s', v_ub));
  assert v_n = 0, 'delete_folder_in_b_denied: ' || v_n;
  -- deleting an accessible subfolder: files inside go to the root (FK SET NULL),
  -- which the files guard must not mistake for a move out of A
  v_err := pg_temp.errm_as(v_restr, format('delete from folders where id = %s', v_ua2));
  assert v_err is null, 'delete_subfolder_in_a_with_files_ok: ' || coalesce(v_err, '');
  assert (select folder_id from files where id = f_a_sub) is null, 'subfolder delete: file moved to the root';
  assert not exists (select 1 from folders where id = v_ua2), 'subfolder deleted';
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id = %s', f_a_sub));
  assert v_n = 0, 'orphaned_file_of_other_now_client_less_hidden: ' || v_n;

  -- own post title in hidden client: folder_sync_post renames the (hidden) post folder
  v_n := pg_temp.rows_as(v_restr, format('update workflow_posts set titulo = ''pBown renamed'' where id = %s', v_pb_own));
  assert v_n = 1, 'own_b_post_rename_ok: ' || v_n;
  assert (select name from folders where id = v_fpb_own) = 'pBown renamed', 'own_b_post_folder_renamed_by_trigger';

  -- ---------------------------------------------------------------
  -- post_file_links: writes
  -- ---------------------------------------------------------------
  v_err := pg_temp.err_as(v_restr, format('insert into post_file_links (post_id, file_id, conta_id) values (%s, %s, %L)', v_pb_own, f_b, v_ws));
  assert v_err = '42501', 'link_hidden_file_to_own_post_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into post_file_links (post_id, file_id, conta_id) values (%s, %s, %L)', v_pa, f_b, v_ws));
  assert v_err = '42501', 'link_hidden_file_to_a_post_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into post_file_links (post_id, file_id, conta_id) values (%s, %s, %L)', v_pb_own, f_b_linked_other, v_ws));
  assert v_err = '42501', 'link_file_of_hidden_post_to_own_post_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.n_as(v_restr, format('select count(*) from files where id in (%s, %s)', f_b, f_b_linked_other));
  assert v_n = 0, 'hidden_files_stay_hidden_after_denied_links: ' || v_n;
  v_err := pg_temp.err_as(v_restr, format('insert into post_file_links (post_id, file_id, conta_id) values (%s, %s, %L)', v_pb_other, f_a3, v_ws));
  assert v_err = '42501', 'link_into_hidden_post_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, format('insert into post_file_links (post_id, file_id, conta_id) values (%s, %s, %L)', v_pa, f_a3, v_ws));
  assert v_err is null, 'link_a_file_to_a_post_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.err_as(v_restr, format('insert into post_file_links (post_id, file_id, conta_id) values (%s, %s, %L)', v_pb_own, f_null_own, v_ws));
  assert v_err is null, 'link_own_upload_to_own_b_post_ok: ' || coalesce(v_err, '');

  v_err := pg_temp.err_as(v_restr, format('update post_file_links set file_id = %s where id = %s', f_b, l_own));
  assert v_err = '42501', 'relink_own_link_to_hidden_file_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.rows_as(v_restr, format('update post_file_links set sort_order = 5 where id = %s', l_own));
  assert v_n = 1, 'reorder_link_of_own_b_post_ok: ' || v_n;
  v_err := pg_temp.errm_as(v_restr, format('update post_file_links set post_id = %s where id = %s', v_pa, l_own));
  assert v_err = 'client_scope_restricted', 'reparent_link_of_own_b_post_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.rows_as(v_restr, format('delete from post_file_links where id = %s', l_own));
  assert v_n = 0, 'unlink_from_own_b_post_denied: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from post_file_links where id = %s', l_other));
  assert v_n = 0, 'unlink_from_hidden_post_denied: ' || v_n;
  v_n := pg_temp.rows_as(v_restr, format('delete from post_file_links where id = %s', l_a));
  assert v_n = 1, 'unlink_from_a_post_ok: ' || v_n;

  -- ---------------------------------------------------------------
  -- RPC get_or_create_client_reports_folder
  -- ---------------------------------------------------------------
  v_err := pg_temp.errm_as(v_restr, format('select public.get_or_create_client_reports_folder(%s)', v_cb));
  assert v_err = 'not_found', 'reports_folder_of_b_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.n_as(v_restr, format('select public.get_or_create_client_reports_folder(%s)', v_ca));
  assert v_n = v_rep_a, 'reports_folder_of_a_ok: ' || coalesce(v_n::text, 'null');
  v_n := pg_temp.n_as(v_todos, format('select public.get_or_create_client_reports_folder(%s)', v_cb));
  assert v_n is not null, 'todos_reports_folder_of_b_ok';

  -- ---------------------------------------------------------------
  -- todos_counts_unchanged + the todos agent writes anywhere
  -- ---------------------------------------------------------------
  foreach v_t in array array['files', 'folders', 'post_file_links'] loop
    execute format('select count(*) from %I where conta_id = %L', v_t, v_ws) into v_expected;
    v_n := pg_temp.n_as(v_todos, format('select count(*) from %I', v_t));
    assert v_n = v_expected, format('todos_counts_unchanged (%s): %s vs %s', v_t, v_n, v_expected);
    v_n := pg_temp.n_as(v_owner, format('select count(*) from %I', v_t));
    assert v_n = v_expected, format('owner_counts_unchanged (%s): %s vs %s', v_t, v_n, v_expected);
  end loop;
  v_err := pg_temp.err_as(v_todos, format(
    'insert into files (conta_id, folder_id, r2_key, name, kind, mime_type, size_bytes, uploaded_by) values (%L, null, ''k/t'', ''t'', ''image'', ''image/png'', 1, %L)',
    v_ws, v_todos));
  assert v_err is null, 'todos_upload_without_folder_ok: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_todos, format('update files set folder_id = %s where id = %s', v_ua, f_b));
  assert v_n = 1, 'todos_move_file_b_to_a_ok: ' || v_n;
  v_err := pg_temp.err_as(v_todos, format('insert into folders (conta_id, parent_id, name) values (%L, null, ''tRoot'')', v_ws));
  assert v_err is null, 'todos_create_root_folder_ok: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_todos, format('update folders set parent_id = %s where id = %s', v_fca, v_ub));
  assert v_n = 1, 'todos_move_folder_b_to_a_ok: ' || v_n;
  v_n := pg_temp.rows_as(v_todos, format('delete from post_file_links where id = %s', l_other));
  assert v_n = 1, 'todos_unlink_in_b_ok: ' || v_n;
  v_err := pg_temp.err_as(v_todos, format('insert into post_file_links (post_id, file_id, conta_id) values (%s, %s, %L)', v_pb_other, f_b_linked_other, v_ws));
  assert v_err is null, 'todos_link_in_b_ok: ' || coalesce(v_err, '');
  v_n := pg_temp.rows_as(v_todos, format('delete from files where id = %s', f_root_other));
  assert v_n = 1, 'todos_delete_client_less_file_ok: ' || v_n;
end $$;

-- explain_todos_short_circuits on files: my_client_scope_all() is an initplan
-- and comes first in the OR, so no resolver, can_access_cliente or link lookup
-- runs per row for the todos agent.
select set_config('request.jwt.claims', json_build_object('sub', (select u.id from auth.users u where u.email = 'todos@acar.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_plan text := ''; v_json json; r record;
begin
  for r in execute 'explain (verbose, costs off) select * from files' loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
  assert v_plan ~ 'Output: my_client_scope_all\(\)' and v_plan !~ 'Filter:[^\n]*my_client_scope_all',
    'files: my_client_scope_all is an initplan: ' || v_plan;
  -- PG 17 prints the initplan as (InitPlan N).col1, older versions as $N
  assert v_plan ~ 'Filter:[^\n]*(\(InitPlan [0-9]+\)\.col1|\$[0-9]+) OR ',
    'files: scope initplan comes first in the filter: ' || v_plan;
  execute 'explain (format json) select * from files' into v_json;
  assert v_json::text ~ '"Subplan Name": "InitPlan', 'files: JSON plan has an InitPlan: ' || v_json::text;
  -- the only SubPlan is the pre-existing hashed conta_id IN (...), built once
  assert replace(v_json -> 0 -> 'Plan' ->> 'Filter', 'hashed SubPlan', '') !~ 'SubPlan',
    'files: no per-row SubPlan: ' || v_json::text;
  execute 'explain (format json) select * from folders' into v_json;
  assert replace(v_json -> 0 -> 'Plan' ->> 'Filter', 'hashed SubPlan', '') !~ 'SubPlan',
    'folders: no per-row SubPlan: ' || v_json::text;
  execute 'explain (format json) select * from post_file_links' into v_json;
  assert v_json::text ~ '"Subplan Name": "InitPlan', 'post_file_links: JSON plan has an InitPlan: ' || v_json::text;
end $$;
reset role;

-- function_privileges: helpers callable by authenticated (policies), trigger
-- functions never; anon never; service_role always
do $$
declare v_f text;
begin
  foreach v_f in array array['public.folder_cliente_id(bigint)',
      'public.folder_row_cliente_id(text,bigint,bigint)', 'public.file_linked_to_visible_post(bigint)'] loop
    assert has_function_privilege('authenticated', v_f, 'EXECUTE'), 'helper executable by authenticated: ' || v_f;
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'helper not executable by anon: ' || v_f;
    assert has_function_privilege('service_role', v_f, 'EXECUTE'), 'helper executable by service_role: ' || v_f;
  end loop;
  foreach v_f in array array['public.guard_file_scope_update()', 'public.guard_folder_scope_parent()'] loop
    assert not has_function_privilege('authenticated', v_f, 'EXECUTE'), 'trigger fn not executable by authenticated: ' || v_f;
    assert not has_function_privilege('anon', v_f, 'EXECUTE'), 'trigger fn not executable by anon: ' || v_f;
    assert has_function_privilege('service_role', v_f, 'EXECUTE'), 'trigger fn executable by service_role: ' || v_f;
  end loop;
  -- the security-definer resolver is not inlinable and the link check stays invoker
  assert (select prosecdef from pg_proc where oid = 'public.folder_cliente_id(bigint)'::regprocedure), 'folder_cliente_id is definer';
  assert not (select prosecdef from pg_proc where oid = 'public.file_linked_to_visible_post(bigint)'::regprocedure),
    'file_linked_to_visible_post is invoker (keeps post_file_links RLS)';
end $$;

rollback;
\echo 99_acesso_por_cliente_arquivos: ok
