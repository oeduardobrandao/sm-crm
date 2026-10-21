\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for 20260923000001_post_content_versions.sql: post_content_versions
-- carries SELECT-only RLS for `authenticated` (conta_id-scoped) and no
-- INSERT/UPDATE/DELETE policy at all -- only the SECURITY DEFINER trigger
-- (owned by postgres) and service_role may write to it, because this table
-- is meant as dispute evidence between agency and client. This suite proves
-- the two properties directly: tenant isolation on SELECT, and that no
-- client-scoped session can write.
--
-- Row inserts in section 1 are done as the table owner (bypassing RLS on
-- purpose) -- that section is testing SELECT scoping, not the capture
-- trigger. The trigger's own coalescing behaviour is covered separately by
-- 95_post_content_versions_coalescing.sql.

-- =====================================================================
-- 1. Tenant isolation: a workspace user of conta A sees only conta A's
--    post_content_versions rows, never conta B's, even though both posts
--    are visible to their own owning workspace.
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_user_a uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_post_a bigint; v_post_b bigint;
  v_count int;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');

  insert into auth.users (id) values (v_user_a);
  insert into workspace_members (user_id, workspace_id, role) values (v_user_a, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user_a;

  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user_a, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user_a, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws_a, v_cli_a, 'rascunho') returning id into v_post_a;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws_b, v_cli_b, 'rascunho') returning id into v_post_b;

  -- Direct inserts as table owner (bypasses RLS): this section tests SELECT
  -- scoping only, not the capture trigger.
  insert into post_content_versions (post_id, conta_id, conteudo_plain, changed_fields, source)
    values (v_post_a, v_ws_a, 'conta A version', ARRAY['conteudo_plain'], 'workspace_user');
  insert into post_content_versions (post_id, conta_id, conteudo_plain, changed_fields, source)
    values (v_post_b, v_ws_b, 'conta B version', ARRAY['conteudo_plain'], 'workspace_user');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);

  select count(*) into v_count from post_content_versions;
  reset role;

  assert v_count = 1,
    format('conta A workspace user must see exactly 1 row (only its own conta''s), got %s', v_count);

  raise notice 'PASS 94.1 tenant isolation: conta A sees only its own post_content_versions rows';
end $$;
rollback;

-- =====================================================================
-- 2. Write lockdown: an authenticated workspace user cannot INSERT (no
--    matching policy at all -- raises insufficient_privilege / 42501, the
--    same SQLSTATE a plain grant denial would produce, since there is no
--    RLS WITH CHECK to distinguish it from). UPDATE/DELETE against an
--    existing row do NOT raise -- with no applicable policy the implicit
--    USING is `false` for every row, so the statement succeeds but affects
--    zero rows. This only holds because et_grant_hosted_parity() grants
--    base table privileges first; without it these would fail for the
--    wrong reason (a plain grant denial, not RLS).
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_user uuid := gen_random_uuid();
  v_cli bigint;
  v_post bigint;
  v_version bigint;
  v_rows int;
  v_plain text;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_post;

  insert into post_content_versions (post_id, conta_id, conteudo_plain, changed_fields, source)
    values (v_post, v_ws, 'original', ARRAY['conteudo_plain'], 'workspace_user')
    returning id into v_version;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  begin
    insert into post_content_versions (post_id, conta_id, conteudo_plain, changed_fields, source)
      values (v_post, v_ws, 'client-forged', ARRAY['conteudo_plain'], 'workspace_user');
    reset role;
    raise exception 'authenticated was able to INSERT into post_content_versions directly';
  exception when insufficient_privilege then
    null; -- expected
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  update post_content_versions set conteudo_plain = 'tampered' where id = v_version;
  get diagnostics v_rows = row_count;
  reset role;
  assert v_rows = 0,
    format('UPDATE against post_content_versions must affect 0 rows for authenticated (no policy = implicit false), got %s', v_rows);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  delete from post_content_versions where id = v_version;
  get diagnostics v_rows = row_count;
  reset role;
  assert v_rows = 0,
    format('DELETE against post_content_versions must affect 0 rows for authenticated (no policy = implicit false), got %s', v_rows);

  -- The row must be entirely untouched by either no-op.
  select conteudo_plain into v_plain from post_content_versions where id = v_version;
  assert v_plain = 'original',
    format('post_content_versions row must be unchanged after the UPDATE/DELETE no-ops, got %s', v_plain);

  raise notice 'PASS 94.2 write lockdown: authenticated cannot INSERT (42501); UPDATE/DELETE affect 0 rows and leave the row untouched';
end $$;
rollback;
