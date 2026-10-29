\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;

-- mcp_attach_post_file: the card's "attach a chat image to slide N" write.
-- post_file_links.sort_order is 0-based; p_position is 1-based.

-- A fresh uploaded-image payload, the shape the mcp function sends.
create function pg_temp.img(ws uuid, size bigint default 10) returns jsonb language sql as $$
  select jsonb_build_object(
    'r2_key', 'contas/' || ws || '/files/' || gen_random_uuid() || '.png',
    'name', 'imagem-do-chat.png', 'kind', 'image', 'mime_type', 'image/png',
    'size_bytes', size, 'width', '1080', 'height', '1350');
$$;

-- Seeds n links (sort 0..n-1, cover at 0) on a post, inserting files directly.
create function pg_temp.seed_links(ws uuid, post bigint, n int) returns void language plpgsql as $$
declare i int; fid bigint;
begin
  for i in 0..n - 1 loop
    insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
      values (ws, 'contas/' || ws || '/files/' || gen_random_uuid() || '.jpg', 's.jpg', 'image', 'image/jpeg', 10)
      returning id into fid;
    insert into post_file_links (conta_id, post_id, file_id, origin, sort_order, is_cover)
      values (ws, post, fid, 'manual', i, i = 0);
  end loop;
end $$;

create function pg_temp.expect_attach_error(
  ws uuid, post bigint, actor uuid, f jsonb, pos int, repl boolean,
  expected_state text, expected_msg text
) returns void language plpgsql as $$
begin
  begin
    perform public.mcp_attach_post_file(ws, post, actor, f, pos, repl);
  exception when others then
    assert sqlstate = expected_state,
      format('expected %s/%s, got %s: %s', expected_state, expected_msg, sqlstate, sqlerrm);
    assert sqlerrm = expected_msg, format('expected message %s, got %s', expected_msg, sqlerrm);
    return;
  end;
  raise exception 'attach should have failed with %', expected_msg;
end $$;

-- Asserts sort_order on a post is exactly 0..n-1 (contiguous and unique) with one cover.
create function pg_temp.assert_orders(post bigint, n int, label text) returns void language plpgsql as $$
begin
  assert (select count(*) from post_file_links where post_id = post) = n,
    format('%s: expected %s links, got %s', label, n, (select count(*) from post_file_links where post_id = post));
  assert (select array_agg(sort_order order by sort_order) from post_file_links where post_id = post)
         = (select array_agg(g) from generate_series(0, n - 1) g),
    format('%s: sort_order not 0..%s: %s', label, n - 1,
      (select array_agg(sort_order order by sort_order) from post_file_links where post_id = post));
  assert (select count(*) from post_file_links where post_id = post and is_cover) = 1,
    format('%s: expected exactly one cover', label);
end $$;

do $$
declare
  v_ws uuid := et_make_workspace('pro');  -- pro: no per-workflow post cap, 10GB storage quota
  v_other_ws uuid := et_make_workspace('free');
  v_u uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint;
  v_car bigint; v_full bigint; v_feed bigint; v_empty bigint; v_reels bigint; v_gap bigint;
  v_foreign bigint; v_other_cli bigint; v_other_wf bigint;
  v_res jsonb;
  v_old_cover bigint; v_cover_link bigint; v_old_file bigint;
  v_files_before int;
  v_f jsonb;
  v_pub bigint; v_links_before jsonb; v_folder bigint; v_marker text;
  v_fn regprocedure := 'public.mcp_attach_post_file(uuid,bigint,uuid,jsonb,integer,boolean)'::regprocedure;
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

  -- (1) carousel with 3 links (cover at sort 0); append at position 1 → new cover at sort 0
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'car', 'carrossel', 'rascunho') returning id into v_car;
  perform pg_temp.seed_links(v_ws, v_car, 3);
  select id into v_old_cover from post_file_links where post_id = v_car and is_cover;
  select count(*) into v_files_before from files where conta_id = v_ws;
  v_res := mcp_attach_post_file(v_ws, v_car, v_u, pg_temp.img(v_ws), 1, false);
  assert (v_res->>'sort_order')::int = 0, format('append@1 sort 0, got %s', v_res);
  assert (v_res->>'is_cover')::boolean, 'append@1 is the cover';
  assert v_res->>'tipo' = 'carrossel', 'tipo carrossel';
  assert (select is_cover from post_file_links where id = v_old_cover) = false, 'old cover demoted';
  assert (select is_cover from post_file_links where id = (v_res->>'link_id')::bigint), 'new link is cover row';
  assert (select file_id from post_file_links where id = (v_res->>'link_id')::bigint) = (v_res->>'file_id')::bigint,
    'link_id and file_id agree';
  assert (select origin from post_file_links where id = (v_res->>'link_id')::bigint) = 'manual', 'origin manual';
  assert (select sort_order from post_file_links where id = v_old_cover) = 1, 'old cover shifted to sort 1';
  assert (select count(*) from files where conta_id = v_ws) = v_files_before + 1, 'one files row created';
  assert (select uploaded_by from files where id = (v_res->>'file_id')::bigint) = v_u, 'uploaded_by = actor';
  assert (select kind from files where id = (v_res->>'file_id')::bigint) = 'image', 'kind image';
  assert (select width from files where id = (v_res->>'file_id')::bigint) = 1080, 'width kept';
  assert (select reference_count from files where id = (v_res->>'file_id')::bigint) = 1, 'ref count 1';
  perform pg_temp.assert_orders(v_car, 4, 'append@1');

  -- (2) append at position 3 → lands at sort 2, later links shift
  v_res := mcp_attach_post_file(v_ws, v_car, v_u, pg_temp.img(v_ws), 3, false);
  assert (v_res->>'sort_order')::int = 2, format('append@3 sort 2, got %s', v_res);
  assert not (v_res->>'is_cover')::boolean, 'append@3 not cover';
  perform pg_temp.assert_orders(v_car, 5, 'append@3');
  -- append at the end (n + 1)
  v_res := mcp_attach_post_file(v_ws, v_car, v_u, pg_temp.img(v_ws), 6, false);
  assert (v_res->>'sort_order')::int = 5, format('append@6 sort 5, got %s', v_res);
  perform pg_temp.assert_orders(v_car, 6, 'append@end');

  -- (3) replace at position 1 → same link row, still the cover, file swapped, old file kept
  select id, file_id into v_cover_link, v_old_file from post_file_links where post_id = v_car and sort_order = 0;
  v_res := mcp_attach_post_file(v_ws, v_car, v_u, pg_temp.img(v_ws), 1, true);
  assert (v_res->>'link_id')::bigint = v_cover_link, 'replace keeps the link id';
  assert (v_res->>'is_cover')::boolean, 'replace keeps is_cover';
  assert (v_res->>'sort_order')::int = 0, 'replace keeps sort_order';
  assert (v_res->>'file_id')::bigint <> v_old_file, 'replace swaps the file';
  assert (select file_id from post_file_links where id = v_cover_link) = (v_res->>'file_id')::bigint, 'row swapped';
  assert exists (select 1 from files where id = v_old_file), 'old file stays in Arquivos';
  assert (select reference_count from files where id = v_old_file) = 0, 'old file ref count released';
  assert (select reference_count from files where id = (v_res->>'file_id')::bigint) = 1, 'new file ref count 1';
  perform pg_temp.assert_orders(v_car, 6, 'replace@1');

  -- (4) invalid positions
  perform pg_temp.expect_attach_error(v_ws, v_car, v_u, pg_temp.img(v_ws), 12, false, 'P0001', 'invalid_position');
  perform pg_temp.expect_attach_error(v_ws, v_car, v_u, pg_temp.img(v_ws), 8, false, 'P0001', 'invalid_position');
  perform pg_temp.expect_attach_error(v_ws, v_car, v_u, pg_temp.img(v_ws), 0, false, 'P0001', 'invalid_position');
  perform pg_temp.expect_attach_error(v_ws, v_car, v_u, pg_temp.img(v_ws), 7, true, 'P0001', 'invalid_position');
  perform pg_temp.expect_attach_error(v_ws, v_car, v_u, pg_temp.img(v_ws), null, false, 'P0001', 'invalid_position');

  -- (5) 10 links: append → media_full, no files row; replace → ok
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'full', 'carrossel', 'rascunho') returning id into v_full;
  perform pg_temp.seed_links(v_ws, v_full, 10);
  select count(*) into v_files_before from files where conta_id = v_ws;
  perform pg_temp.expect_attach_error(v_ws, v_full, v_u, pg_temp.img(v_ws), 4, false, 'P0001', 'media_full');
  perform pg_temp.expect_attach_error(v_ws, v_full, v_u, pg_temp.img(v_ws), 11, false, 'P0001', 'media_full');
  assert (select count(*) from files where conta_id = v_ws) = v_files_before, 'media_full creates no files row';
  v_res := mcp_attach_post_file(v_ws, v_full, v_u, pg_temp.img(v_ws), 10, true);
  assert (v_res->>'sort_order')::int = 9, 'replace@10 sort 9';
  perform pg_temp.assert_orders(v_full, 10, 'replace at 10 items');

  -- (6) feed with 1 link + append → tipo carrossel
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'feed', 'feed', 'revisao_interna') returning id into v_feed;
  perform pg_temp.seed_links(v_ws, v_feed, 1);
  v_res := mcp_attach_post_file(v_ws, v_feed, v_u, pg_temp.img(v_ws), 2, false);
  assert v_res->>'tipo' = 'carrossel', format('feed + append → carrossel, got %s', v_res);
  assert (select tipo from workflow_posts where id = v_feed) = 'carrossel', 'row tipo carrossel';
  assert (select status from workflow_posts where id = v_feed) = 'revisao_interna', 'revisao stays';
  -- feed with 1 link + replace → stays feed
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'feed1', 'feed', 'rascunho') returning id into v_empty;
  perform pg_temp.seed_links(v_ws, v_empty, 1);
  v_res := mcp_attach_post_file(v_ws, v_empty, v_u, pg_temp.img(v_ws), 1, true);
  assert v_res->>'tipo' = 'feed', 'feed + replace stays feed';
  -- empty feed + append at 1 → cover via auto-cover, tipo stays feed
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'empty', 'feed', 'rascunho') returning id into v_empty;
  perform pg_temp.expect_attach_error(v_ws, v_empty, v_u, pg_temp.img(v_ws), 1, true, 'P0001', 'invalid_position');
  v_res := mcp_attach_post_file(v_ws, v_empty, v_u, pg_temp.img(v_ws), 1, false);
  assert (v_res->>'is_cover')::boolean and (v_res->>'sort_order')::int = 0, 'first media is the cover';
  assert v_res->>'tipo' = 'feed', 'single media stays feed';

  -- (7) tipo and status gates
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'reels', 'reels', 'rascunho') returning id into v_reels;
  perform pg_temp.expect_attach_error(v_ws, v_reels, v_u, pg_temp.img(v_ws), 1, false, 'P0001', 'tipo_not_image:reels');
  update workflow_posts set status = 'aprovado_cliente' where id = v_car;
  perform pg_temp.expect_attach_error(v_ws, v_car, v_u, pg_temp.img(v_ws), 1, false,
    'P0001', 'post_not_editable:aprovado_cliente');
  update workflow_posts set status = 'enviado_cliente' where id = v_car;
  perform pg_temp.expect_attach_error(v_ws, v_car, v_u, pg_temp.img(v_ws), 1, true,
    'P0001', 'post_not_editable:enviado_cliente');

  -- (8) correcao_cliente → revisao_interna, on append and on replace, recorded as a
  -- workspace_user change by p_actor. The settings are cleared before each call, since
  -- an earlier attach in this same transaction already set them.
  update workflow_posts set status = 'correcao_cliente' where id = v_car;
  perform set_config('app.actor_id', '', true);
  perform set_config('app.event_source', '', true);
  delete from post_status_events where post_id = v_car;
  perform mcp_attach_post_file(v_ws, v_car, v_u, pg_temp.img(v_ws), 2, false);
  assert (select status from workflow_posts where id = v_car) = 'revisao_interna', 'append: correcao → revisao';
  assert exists (select 1 from post_status_events
    where post_id = v_car and from_status = 'correcao_cliente' and to_status = 'revisao_interna'
      and source = 'workspace_user' and actor_user_id = v_u), 'append: flip event by the actor';
  update workflow_posts set status = 'correcao_cliente' where id = v_car;
  perform set_config('app.actor_id', '', true);
  perform set_config('app.event_source', '', true);
  delete from post_status_events where post_id = v_car;
  perform mcp_attach_post_file(v_ws, v_car, v_u, pg_temp.img(v_ws), 2, true);
  assert (select status from workflow_posts where id = v_car) = 'revisao_interna', 'replace: correcao → revisao';
  assert exists (select 1 from post_status_events
    where post_id = v_car and from_status = 'correcao_cliente' and to_status = 'revisao_interna'
      and source = 'workspace_user' and actor_user_id = v_u), 'replace: flip event by the actor';
  assert not exists (select 1 from post_status_events where post_id = v_car and source = 'system'),
    'no system-sourced flip';

  -- (9) non-contiguous sort_order (deletes never compact, PATCH writes any value):
  -- positions follow the visible order, and the post ends contiguous
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'gap', 'carrossel', 'rascunho') returning id into v_gap;
  perform pg_temp.seed_links(v_ws, v_gap, 3);
  update post_file_links set sort_order = case sort_order when 1 then 3 when 2 then 7 else 0 end
    where post_id = v_gap;
  v_res := mcp_attach_post_file(v_ws, v_gap, v_u, pg_temp.img(v_ws), 2, false);
  assert (v_res->>'sort_order')::int = 1, format('gap append@2 sort 1, got %s', v_res);
  perform pg_temp.assert_orders(v_gap, 4, 'gap append');
  -- replace at 4 hits the last visible slide (was sort 7)
  v_res := mcp_attach_post_file(v_ws, v_gap, v_u, pg_temp.img(v_ws), 4, true);
  assert (v_res->>'sort_order')::int = 3, 'gap replace@4 sort 3';
  perform pg_temp.assert_orders(v_gap, 4, 'gap replace');

  -- (10) p_file cannot pick another workspace, uploader, kind, folder or thumbnail
  insert into folders (conta_id, name) values (v_ws, 'pasta') returning id into v_folder;
  v_f := pg_temp.img(v_ws) || jsonb_build_object('conta_id', v_other_ws, 'uploaded_by', v_outsider,
    'kind', 'video', 'folder_id', v_folder, 'thumbnail_r2_key', 'contas/' || v_ws || '/files/t.jpg');
  v_res := mcp_attach_post_file(v_ws, v_gap, v_u, v_f, 5, false);
  assert (select conta_id from files where id = (v_res->>'file_id')::bigint) = v_ws, 'file lands in p_conta_id';
  assert (select uploaded_by from files where id = (v_res->>'file_id')::bigint) = v_u, 'uploader is p_actor';
  assert (select kind from files where id = (v_res->>'file_id')::bigint) = 'image', 'kind forced to image';
  assert (select folder_id from files where id = (v_res->>'file_id')::bigint) is null, 'folder_id forced NULL';
  assert (select thumbnail_r2_key from files where id = (v_res->>'file_id')::bigint) is null,
    'thumbnail_r2_key forced NULL';

  -- (10b) invalid_file: key outside contas/<p_conta_id>/files/, or a mime other than JPEG/PNG
  select count(*) into v_files_before from files;
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_u,
    pg_temp.img(v_ws) || jsonb_build_object('r2_key', 'contas/' || v_other_ws || '/files/x.png'),
    1, false, 'P0001', 'invalid_file');
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_u,
    pg_temp.img(v_ws) || jsonb_build_object('r2_key', 'contas/' || v_ws || '/briefing-audio/x.png'),
    1, true, 'P0001', 'invalid_file');
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_u, pg_temp.img(v_ws) - 'r2_key',
    1, false, 'P0001', 'invalid_file');
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_u,
    pg_temp.img(v_ws) || jsonb_build_object('mime_type', 'video/mp4'),
    1, false, 'P0001', 'invalid_file');
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_u,
    pg_temp.img(v_ws) || jsonb_build_object('mime_type', 'image/webp'),
    1, true, 'P0001', 'invalid_file');
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_u, pg_temp.img(v_ws) - 'mime_type',
    1, false, 'P0001', 'invalid_file');
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_u, null, 1, false, 'P0001', 'invalid_file');
  assert (select count(*) from files) = v_files_before, 'invalid_file creates no files row';
  -- JPEG is accepted too
  perform mcp_attach_post_file(v_ws, v_gap, v_u,
    pg_temp.img(v_ws) || jsonb_build_object('mime_type', 'image/jpeg'), 6, false);
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_u, pg_temp.img(v_ws), 8, false, 'P0001', 'invalid_position');

  -- (11) quota_exceeded comes from file_insert_with_quota, nothing linked
  select count(*) into v_files_before from files where conta_id = v_ws;
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_u, pg_temp.img(v_ws, 20000000000), 1, false,
    'P0001', 'quota_exceeded');
  assert (select count(*) from files where conta_id = v_ws) = v_files_before, 'quota: no files row';
  perform pg_temp.assert_orders(v_gap, 6, 'quota refusal leaves links');

  -- (12) another workspace's post → post_not_found; unknown id → post_not_found
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_other_ws, v_u, 'O', 'O', '#000') returning id into v_other_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_other_ws, v_other_cli, v_u, 'wf2', 'ativo') returning id into v_other_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_other_wf, v_other_ws, 'foreign', 'carrossel', 'rascunho') returning id into v_foreign;
  perform pg_temp.expect_attach_error(v_ws, v_foreign, v_u, pg_temp.img(v_ws), 1, false, 'P0001', 'post_not_found');
  perform pg_temp.expect_attach_error(v_ws, 999999999, v_u, pg_temp.img(v_ws), 1, false, 'P0001', 'post_not_found');
  assert (select count(*) from post_file_links where post_id = v_foreign) = 0, 'foreign post untouched';

  -- (13) non-member actor → P0403 workspace_unavailable; membership is per p_conta_id
  perform pg_temp.expect_attach_error(v_ws, v_gap, v_outsider, pg_temp.img(v_ws), 1, false,
    'P0403', 'workspace_unavailable');
  perform pg_temp.expect_attach_error(v_other_ws, v_foreign, v_u, pg_temp.img(v_other_ws), 1, false,
    'P0403', 'workspace_unavailable');

  -- (14) a published post moved back to revisao_interna by a plain UPDATE keeps its
  -- publish markers and is refused (post_published) for append and replace, nothing changed
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'pub', 'carrossel', 'rascunho') returning id into v_pub;
  perform pg_temp.seed_links(v_ws, v_pub, 2);
  update workflow_posts set status = 'postado', instagram_media_id = 'ig-1' where id = v_pub;
  update workflow_posts set status = 'revisao_interna' where id = v_pub;
  assert (select published_at from workflow_posts where id = v_pub) is not null, 'fixture: published_at kept';
  select jsonb_agg(jsonb_build_array(id, file_id, sort_order, is_cover) order by id) into v_links_before
    from post_file_links where post_id = v_pub;
  select count(*) into v_files_before from files;
  perform pg_temp.expect_attach_error(v_ws, v_pub, v_u, pg_temp.img(v_ws), 1, false, 'P0001', 'post_published');
  perform pg_temp.expect_attach_error(v_ws, v_pub, v_u, pg_temp.img(v_ws), 3, false, 'P0001', 'post_published');
  perform pg_temp.expect_attach_error(v_ws, v_pub, v_u, pg_temp.img(v_ws), 1, true, 'P0001', 'post_published');
  assert (select count(*) from files) = v_files_before, 'post_published creates no files row';
  assert (select jsonb_agg(jsonb_build_array(id, file_id, sort_order, is_cover) order by id)
            from post_file_links where post_id = v_pub) = v_links_before, 'post_published leaves links';
  assert (select status from workflow_posts where id = v_pub) = 'revisao_interna', 'post_published leaves status';
  -- each marker alone refuses (same predicate as post_file_link_replace)
  foreach v_marker in array array['published_at', 'instagram_media_id', 'instagram_container_id',
      'publish_processing_at', 'tiktok_publish_processing_at', 'tiktok_initiated', 'tiktok_processing',
      'tiktok_published', 'story_segments'] loop
    update workflow_posts set published_at = null, instagram_media_id = null, instagram_container_id = null,
      publish_processing_at = null, tiktok_publish_processing_at = null, tiktok_publish_status = null,
      story_segments = null, status = 'rascunho'
     where id = v_pub;
    update workflow_posts set
      published_at = case when v_marker = 'published_at' then now() end,
      instagram_media_id = case when v_marker = 'instagram_media_id' then 'ig-2' end,
      instagram_container_id = case when v_marker = 'instagram_container_id' then 'c-1' end,
      publish_processing_at = case when v_marker = 'publish_processing_at' then now() end,
      tiktok_publish_processing_at = case when v_marker = 'tiktok_publish_processing_at' then now() end,
      tiktok_publish_status = case v_marker when 'tiktok_initiated' then 'initiated'
        when 'tiktok_processing' then 'processing' when 'tiktok_published' then 'published' end,
      story_segments = case when v_marker = 'story_segments' then '[]'::jsonb end
     where id = v_pub;
    perform pg_temp.expect_attach_error(v_ws, v_pub, v_u, pg_temp.img(v_ws), 1, true, 'P0001', 'post_published');
  end loop;
  -- markers cleared (and a failed TikTok attempt) → editable again
  update workflow_posts set story_segments = null, tiktok_publish_status = 'failed' where id = v_pub;
  perform mcp_attach_post_file(v_ws, v_pub, v_u, pg_temp.img(v_ws), 1, true);

  raise notice 'mcp_attach_post_file: all cases passed';
end $$;
rollback;
