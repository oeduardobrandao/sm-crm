\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- board_ordem + reorder_board_posts: entitlements/ACL suite for the migration
--   20260901000020_workflow_posts_board_ordem.sql
--
-- board_ordem is a nullable fractional rank on workflow_posts (Trello-style
-- manual ordering for the board of Publicacoes); reorder_board_posts is the
-- sanctioned RPC that writes N (id, ordem) pairs in one call, conta-scoped,
-- all-or-nothing on ownership.
--
-- Follows the conventions of 70_workflow_posts_avulsos.sql: et_make_workspace,
-- impersonating `authenticated` via profiles.active_workspace_id +
-- request.jwt.claims + `set local role authenticated`, the FOR UPDATE lock
-- followed by a separate count(*) for all-or-nothing ownership, and the
-- has_function_privilege triple (anon/authenticated/service_role) for ACL.

-- =====================================================================
-- 0. bonus: no active workspace (no profile row for this sub) -> not_authenticated
-- =====================================================================
begin;
do $$
declare
  v_no_user uuid := gen_random_uuid();
  v_raised boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_no_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    perform reorder_board_posts(array[1]::bigint[], array[1]::double precision[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'not_authenticated', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a caller with no active workspace must raise not_authenticated';

  execute 'reset role';
  raise notice 'PASS 71.0 not_authenticated guard';
end $$;
rollback;

-- =====================================================================
-- 1. Happy path: tenant A's authenticated user reorders two of its own posts
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post_a1 bigint; v_post_a2 bigint;
  v_ordem_a1 double precision; v_ordem_a2 double precision;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli, 'avulso-1') returning id into v_post_a1;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli, 'avulso-2') returning id into v_post_a2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  perform reorder_board_posts(array[v_post_a1, v_post_a2], array[2048, 1024]::double precision[]);

  execute 'reset role';

  select board_ordem into v_ordem_a1 from workflow_posts where id = v_post_a1;
  select board_ordem into v_ordem_a2 from workflow_posts where id = v_post_a2;
  assert v_ordem_a1 = 2048, format('expected board_ordem=2048 for post 1, got %s', v_ordem_a1);
  assert v_ordem_a2 = 1024, format('expected board_ordem=1024 for post 2, got %s', v_ordem_a2);

  raise notice 'PASS 71.1 happy path reorder';
end $$;
rollback;

-- =====================================================================
-- 2. NULL element clears the rank (post falls back to automatic ordering)
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint; v_ordem double precision;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, titulo, board_ordem)
    values (v_ws, v_cli, 'avulso', 512) returning id into v_post;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  perform reorder_board_posts(array[v_post], array[null::double precision]);

  execute 'reset role';
  select board_ordem into v_ordem from workflow_posts where id = v_post;
  assert v_ordem is null, format('expected board_ordem cleared to NULL, got %s', v_ordem);

  raise notice 'PASS 71.2 NULL element clears board_ordem';
end $$;
rollback;

-- =====================================================================
-- 3. All-or-nothing cross-tenant: one post from another workspace in the
--    batch raises post_not_found and leaves the caller's own post untouched
-- =====================================================================
begin;
do $$
declare
  v_ws_a uuid; v_ws_b uuid; v_user uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_post_a1 bigint; v_post_b1 bigint;
  v_raised boolean; v_ordem_after double precision;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user;

  -- v_user is reused as the row-owner attribute for tenant B's cliente too
  -- (same technique as 70_workflow_posts_avulsos.sql section 5): user_id on
  -- `clientes` is just a creator reference, not a workspace-membership check.
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  insert into workflow_posts (conta_id, cliente_id, titulo, board_ordem)
    values (v_ws_a, v_cli_a, 'a1', 100) returning id into v_post_a1;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws_b, v_cli_b, 'b1') returning id into v_post_b1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    perform reorder_board_posts(array[v_post_a1, v_post_b1], array[2048, 1024]::double precision[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'reordering with a post from another tenant must raise post_not_found';

  execute 'reset role';
  select board_ordem into v_ordem_after from workflow_posts where id = v_post_a1;
  assert v_ordem_after = 100,
    format('tenant A post must be unchanged after the rejected all-or-nothing batch, got %s', v_ordem_after);

  raise notice 'PASS 71.3 all-or-nothing cross-tenant rejection';
end $$;
rollback;

-- =====================================================================
-- 4. Arity mismatch between p_post_ids and p_ordens raises invalid_arguments
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post_1 bigint; v_post_2 bigint;
  v_raised boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli, 'p1') returning id into v_post_1;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli, 'p2') returning id into v_post_2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    perform reorder_board_posts(array[v_post_1, v_post_2], array[2048]::double precision[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'mismatched array lengths must raise invalid_arguments';

  execute 'reset role';
  raise notice 'PASS 71.4 arity mismatch';
end $$;
rollback;

-- =====================================================================
-- 5. ACL pinned: authenticated keeps EXECUTE, anon does not, service_role
--    (used by cron/backoffice paths) keeps it too -- same technique as
--    70_workflow_posts_avulsos.sql section 11.
-- =====================================================================
do $$
begin
  assert has_function_privilege('authenticated', 'public.reorder_board_posts(bigint[], double precision[])', 'EXECUTE') = true,
    'authenticated must be able to call reorder_board_posts';
  assert has_function_privilege('anon', 'public.reorder_board_posts(bigint[], double precision[])', 'EXECUTE') = false,
    'anon must not be able to call reorder_board_posts';
  assert has_function_privilege('service_role', 'public.reorder_board_posts(bigint[], double precision[])', 'EXECUTE') = true,
    'service_role must still be able to call reorder_board_posts';

  raise notice 'PASS 71.5 reorder_board_posts ACL';
end $$;
