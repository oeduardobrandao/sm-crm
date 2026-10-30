\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;

-- mcp_attach_post_file_v2 (migration 20261109000001): the multi-image card's attach. Checks what the
-- card expected (link id for a replace, link count for an append) under the post lock, runs v1 and,
-- with p_trim_after, drops the links after p_position, all in one transaction.

create function pg_temp.img(ws uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'r2_key', 'contas/' || ws || '/files/' || gen_random_uuid() || '.png',
    'name', 'imagem-do-chat.png', 'kind', 'image', 'mime_type', 'image/png',
    'size_bytes', 10, 'width', '1080', 'height', '1350');
$$;

create function pg_temp.seed_links(ws uuid, post bigint, n int, cover_at int default 0) returns void language plpgsql as $$
declare i int; fid bigint;
begin
  for i in 0..n - 1 loop
    insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
      values (ws, 'contas/' || ws || '/files/' || gen_random_uuid() || '.jpg', 's.jpg', 'image', 'image/jpeg', 10)
      returning id into fid;
    insert into post_file_links (conta_id, post_id, file_id, origin, sort_order, is_cover)
      values (ws, post, fid, 'manual', i, i = cover_at);
  end loop;
end $$;

create function pg_temp.link_at(post bigint, pos int) returns bigint language sql as $$
  select id from (select id, row_number() over (order by sort_order, id) as p
                    from post_file_links where post_id = post) o where o.p = pos;
$$;

create function pg_temp.expect_error(
  ws uuid, post bigint, actor uuid, f jsonb, pos int, repl boolean, exp_count int, exp_link bigint,
  trim_after boolean, expected_state text, expected_msg text
) returns void language plpgsql as $$
begin
  begin
    perform public.mcp_attach_post_file_v2(ws, post, actor, f, pos, repl, exp_count, exp_link, trim_after);
  exception when others then
    assert sqlstate = expected_state,
      format('expected %s/%s, got %s: %s', expected_state, expected_msg, sqlstate, sqlerrm);
    assert sqlerrm = expected_msg, format('expected message %s, got %s', expected_msg, sqlerrm);
    return;
  end;
  raise exception 'v2 should have failed with %', expected_msg;
end $$;

do $$
declare
  v_ws uuid := et_make_workspace('pro');
  v_u uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint;
  v_app bigint; v_rep bigint; v_cov bigint; v_full bigint;
  v_res jsonb;
  v_link bigint;
  v_files_before int;
  v_fn regprocedure :=
    'public.mcp_attach_post_file_v2(uuid,bigint,uuid,jsonb,integer,boolean,integer,bigint,boolean)'::regprocedure;
begin
  -- (0) EXECUTE: explicit ACL is service_role only (aclexplode, not owner-implied privileges)
  assert (select prosecdef from pg_proc where oid = v_fn), 'SECURITY DEFINER';
  assert exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a
    where p.oid = v_fn and a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE'),
    'service role explicit grant';
  assert not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a
    where p.oid = v_fn and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    and a.privilege_type = 'EXECUTE'), 'no client or PUBLIC execution';

  insert into auth.users (id) values (v_u), (v_outsider) on conflict do nothing;
  insert into workspace_members (workspace_id, user_id, role) values (v_ws, v_u, 'owner') on conflict do nothing;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws, v_u, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_u, 'wf', 'ativo') returning id into v_wf;

  -- (1) append with the right count; a retry of the same step (first try committed) is refused
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'app', 'carrossel', 'rascunho') returning id into v_app;
  perform pg_temp.seed_links(v_ws, v_app, 2);
  v_res := mcp_attach_post_file_v2(v_ws, v_app, v_u, pg_temp.img(v_ws), 3, false, 2, null, false);
  assert (v_res->>'sort_order')::int = 2, format('appended at sort 2: %s', v_res);
  assert (v_res->>'trimmed')::int = 0, 'nothing trimmed';
  assert (select count(*) from post_file_links where post_id = v_app) = 3, '3 links';
  perform pg_temp.expect_error(v_ws, v_app, v_u, pg_temp.img(v_ws), 3, false, 2, null, false, 'P0001', 'stale_post');
  assert (select count(*) from post_file_links where post_id = v_app) = 3, 'retry did not duplicate';
  -- an append with no expectation is refused too
  perform pg_temp.expect_error(v_ws, v_app, v_u, pg_temp.img(v_ws), 4, false, null, null, false, 'P0001', 'stale_post');

  -- (2) replace checks the link id at that position and keeps it
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'rep', 'carrossel', 'revisao_interna') returning id into v_rep;
  perform pg_temp.seed_links(v_ws, v_rep, 3);
  v_link := pg_temp.link_at(v_rep, 2);
  perform pg_temp.expect_error(v_ws, v_rep, v_u, pg_temp.img(v_ws), 2, true, null, pg_temp.link_at(v_rep, 1), false,
    'P0001', 'stale_post');
  perform pg_temp.expect_error(v_ws, v_rep, v_u, pg_temp.img(v_ws), 2, true, null, null, false, 'P0001', 'stale_post');
  v_res := mcp_attach_post_file_v2(v_ws, v_rep, v_u, pg_temp.img(v_ws), 2, true, null, v_link, false);
  assert (v_res->>'link_id')::bigint = v_link, 'replace keeps the link id';
  -- a retried replace still matches and replaces the same slide again
  v_res := mcp_attach_post_file_v2(v_ws, v_rep, v_u, pg_temp.img(v_ws), 2, true, null, v_link, false);
  assert (select count(*) from post_file_links where post_id = v_rep) = 3, 'still 3 links';

  -- (3) replace + trim: 5 slides, cover on slide 5, replace slide 2 and drop 3..5 in one go
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'cov', 'carrossel', 'correcao_cliente') returning id into v_cov;
  perform pg_temp.seed_links(v_ws, v_cov, 5, 4);
  select count(*) into v_files_before from files where conta_id = v_ws;
  v_res := mcp_attach_post_file_v2(v_ws, v_cov, v_u, pg_temp.img(v_ws), 2, true, null, pg_temp.link_at(v_cov, 2), true);
  assert (v_res->>'trimmed')::int = 3, format('3 trimmed: %s', v_res);
  assert (select count(*) from post_file_links where post_id = v_cov) = 2, '2 links left';
  assert (select array_agg(sort_order order by sort_order) from post_file_links where post_id = v_cov) = array[0, 1],
    'contiguous 0..1';
  assert (select count(*) from post_file_links where post_id = v_cov and is_cover) = 1, 'cover moved to a kept slide';
  assert (select count(*) from files where conta_id = v_ws) = v_files_before + 1, 'old files stay in Arquivos';
  assert (select status from workflow_posts where id = v_cov) = 'revisao_interna', 'v1 status move kept';

  -- (4) a raise inside v1 rolls back the whole step (no trim without the attach)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'full', 'carrossel', 'rascunho') returning id into v_full;
  perform pg_temp.seed_links(v_ws, v_full, 3);
  perform pg_temp.expect_error(v_ws, v_full, v_u, '{"r2_key":"elsewhere/x.png","mime_type":"image/png"}'::jsonb,
    1, true, null, pg_temp.link_at(v_full, 1), true, 'P0001', 'invalid_file');
  assert (select count(*) from post_file_links where post_id = v_full) = 3, 'nothing trimmed after a failed attach';

  -- (5) membership and tenancy
  perform pg_temp.expect_error(v_ws, v_app, v_outsider, pg_temp.img(v_ws), 4, false, 3, null, false,
    'P0403', 'workspace_unavailable');
  perform pg_temp.expect_error(v_ws, -1, v_u, pg_temp.img(v_ws), 1, false, 0, null, false, 'P0001', 'post_not_found');

  raise notice 'mcp_attach_post_file_v2: all assertions passed';
end;
$$;

rollback;
