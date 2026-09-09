\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;

create function pg_temp.expect_replace_error(
  ws uuid, uid uuid, link_id bigint, file_id bigint, original_key text, expected_code text
) returns void language plpgsql as $$
begin
  begin
    perform public.post_file_link_replace(ws, uid, link_id, file_id, original_key);
  exception when others then
    assert sqlstate = expected_code, format('Expected %s, got %s: %s', expected_code, sqlstate, sqlerrm);
    return;
  end;
  raise exception 'Replacement should have failed with %', expected_code;
end $$;

do $$
declare
  ws uuid := et_make_workspace('free');
  other_ws uuid := et_make_workspace('free');
  uid uuid := gen_random_uuid();
  client_id bigint; workflow_id bigint; post_id bigint; other_post bigint; foreign_post bigint;
  old_file bigint; new_file bigint; third_file bigint; foreign_file bigint;
  link_id bigint; other_link bigint; foreign_link bigint;
  old_key text := 'contas/' || ws || '/files/original.jpg';
  new_key text := 'contas/' || ws || '/files/adjusted.jpg';
  status_value text;
  function_oid oid := 'public.post_file_link_replace(uuid,uuid,bigint,bigint,text)'::regprocedure;
begin
  insert into auth.users (id) values (uid);
  insert into workspace_members (workspace_id, user_id, role) values (ws, uid, 'owner') on conflict do nothing;
  update profiles set active_workspace_id = ws, conta_id = ws where id = uid;
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (ws, uid, 'Media replacement', 'MR', '#000') returning id into client_id;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (ws, client_id, uid, 'Media adjustment workflow', 'ativo') returning id into workflow_id;
  insert into workflow_posts (conta_id, workflow_id, titulo, tipo, status)
    values (ws, workflow_id, 'Edited post', 'feed', 'rascunho') returning id into post_id;
  insert into workflow_posts (conta_id, workflow_id, titulo, tipo, status)
    values (ws, workflow_id, 'Shared original', 'feed', 'rascunho') returning id into other_post;
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (other_ws, uid, 'Other workspace', 'OW', '#000') returning id into client_id;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (other_ws, client_id, uid, 'Foreign workflow', 'ativo') returning id into workflow_id;
  insert into workflow_posts (conta_id, workflow_id, titulo, tipo, status)
    values (other_ws, workflow_id, 'Foreign post', 'feed', 'rascunho') returning id into foreign_post;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (ws, old_key, 'original.jpg', 'image', 'image/jpeg', 100) returning id into old_file;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (ws, new_key, 'adjusted.jpg', 'image', 'image/jpeg', 100) returning id into new_file;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (ws, 'contas/'||ws||'/files/third.jpg', 'third.jpg', 'image', 'image/jpeg', 100) returning id into third_file;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (other_ws, 'contas/'||other_ws||'/files/foreign.jpg', 'foreign.jpg', 'image', 'image/jpeg', 100) returning id into foreign_file;
  insert into post_file_links (conta_id, post_id, file_id, sort_order, is_cover)
    values (ws, post_id, old_file, 4, true) returning id into link_id;
  insert into post_file_links (conta_id, post_id, file_id)
    values (ws, other_post, old_file) returning id into other_link;
  insert into post_file_links (conta_id, post_id, file_id)
    values (other_ws, foreign_post, foreign_file) returning id into foreign_link;

  perform pg_temp.expect_replace_error(ws, uid, foreign_link, new_file, old_key, 'P0404');
  perform pg_temp.expect_replace_error(ws, uid, link_id, foreign_file, old_key, 'P0404');
  perform pg_temp.expect_replace_error(other_ws, uid, foreign_link, foreign_file, old_key, 'P0403');
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, 'stale-key', 'P0409');
  update files set media_lost_at = now() where id = new_file;
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0400');
  update files set media_lost_at = null, kind = 'document' where id = new_file;
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0400');
  update files set kind = 'image' where id = new_file;

  foreach status_value in array array['agendado', 'postado'] loop
    update workflow_posts set status = status_value where id = post_id;
    perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
  end loop;
  update workflow_posts set status = 'rascunho', published_at = null, publish_processing_at = now() where id = post_id;
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
  update workflow_posts set publish_processing_at = null, tiktok_publish_processing_at = now() where id = post_id;
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
  update workflow_posts set tiktok_publish_processing_at = null, instagram_container_id = 'prepared-container' where id = post_id;
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
  update workflow_posts set instagram_container_id = null where id = post_id;

  assert public.post_file_link_replace(ws, uid, link_id, new_file, old_key);
  assert (select file_id = new_file and is_cover and sort_order = 4 from post_file_links where id = link_id), 'link identity, cover and order preserved';
  assert (select file_id = old_file from post_file_links where id = other_link), 'other post unaffected';
  assert (select reference_count = 1 from files where id = old_file), 'old count decremented';
  assert (select reference_count = 1 from files where id = new_file), 'new count incremented';
  assert public.post_file_link_replace(ws, uid, link_id, new_file, old_key), 'retry is idempotent';
  assert (select reference_count = 1 from files where id = new_file), 'retry does not double count';
  perform pg_temp.expect_replace_error(ws, uid, link_id, third_file, old_key, 'P0409');

  insert into post_file_links (conta_id, post_id, file_id, sort_order) values (ws, post_id, third_file, 5);
  perform pg_temp.expect_replace_error(ws, uid, link_id, third_file, new_key, 'P0409');
  delete from post_file_links where id = other_link;
  assert (select reference_count = 0 from files where id = old_file), 'unreferenced original retained';
  assert not exists (select 1 from file_deletions where r2_key = old_key), 'no original deletion queued';

  delete from workspace_members where workspace_id = ws and user_id = uid;
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0403');

  -- Inspect explicit ACLs, not owner-implied has_function_privilege results.
  assert exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a
    where p.oid = function_oid and a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE'), 'service role explicit grant';
  assert not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a
    where p.oid = function_oid and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    and a.privilege_type = 'EXECUTE'), 'no client or PUBLIC execution';
  raise notice 'post_file_link_replace: all cases passed';
end $$;
rollback;
