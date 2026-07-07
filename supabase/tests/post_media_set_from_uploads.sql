\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_wf bigint; v_post bigint; v_res jsonb;
  v_u uuid := gen_random_uuid(); v_cli bigint;
begin
  v_ws := et_make_workspace('free');  -- free plan → effective storage quota 100MB (see 20_storage_rpcs.sql)
  insert into auth.users (id) values (v_u) on conflict do nothing;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws, v_u, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_u, 'wf', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'p', 'feed', 'rascunho') returning id into v_post;

  -- (1) set 3 items → 3 links, sort 0..2, cover=item0, tipo carrossel
  v_res := post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/a.jpg','size_bytes',10,'mime_type','image/jpeg'),
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/b.jpg','size_bytes',10,'mime_type','image/jpeg'),
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/c.jpg','size_bytes',10,'mime_type','image/jpeg')));
  assert (v_res->>'item_count')::int = 3, 'item_count 3';
  assert v_res->>'tipo' = 'carrossel', 'tipo carrossel';
  assert (select count(*) from post_file_links where post_id = v_post) = 3, '3 links';
  assert (select count(*) from post_file_links where post_id = v_post and is_cover) = 1, '1 cover';
  assert (select sort_order from post_file_links l join files f on f.id=l.file_id
          where l.post_id=v_post and f.r2_key='contas/'||v_ws||'/files/a.jpg') = 0, 'a is sort 0';

  -- (3) idempotent resend of the SAME r2_keys → no new files, storage unchanged
  declare v_used_before bigint; v_files_before int; begin
    select storage_used_bytes into v_used_before from workspaces where id = v_ws;
    select count(*) into v_files_before from files where conta_id = v_ws;
    perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/a.jpg','size_bytes',10,'mime_type','image/jpeg'),
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/b.jpg','size_bytes',10,'mime_type','image/jpeg'),
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/c.jpg','size_bytes',10,'mime_type','image/jpeg')));
    assert (select storage_used_bytes from workspaces where id=v_ws) = v_used_before, 'storage unchanged on resend';
    assert (select count(*) from files where conta_id=v_ws) = v_files_before, 'no new files on resend';
  end;

  -- (4) replace with DIFFERENT images → old unreused files GC'd (reference_count hit 0)
  perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/x.jpg','size_bytes',10,'mime_type','image/jpeg')));
  assert not exists (select 1 from files where conta_id=v_ws and r2_key='contas/'||v_ws||'/files/b.jpg'),
    'old file b GC-deleted';
  assert (select tipo from workflow_posts where id=v_post) = 'feed', 'tipo back to feed (1 item)';

  -- (6) status flip: correcao_cliente → revisao_interna; enviado_cliente stays
  update workflow_posts set status='correcao_cliente' where id=v_post;
  perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/y.jpg','size_bytes',10,'mime_type','image/jpeg')));
  assert (select status from workflow_posts where id=v_post) = 'revisao_interna', 'correcao→revisao';
  update workflow_posts set status='enviado_cliente' where id=v_post;
  perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/z.jpg','size_bytes',10,'mime_type','image/jpeg')));
  assert (select status from workflow_posts where id=v_post) = 'enviado_cliente', 'enviado stays';

  -- (7) rejections
  declare v_threw boolean; begin
    update workflow_posts set status='aprovado_interno' where id=v_post;
    v_threw := false;
    begin perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/q.jpg','size_bytes',10,'mime_type','image/jpeg')));
    exception when sqlstate 'P0001' then assert sqlerrm like 'post_not_editable:%'; v_threw:=true; end;
    assert v_threw, 'not-editable rejected';
    -- design attached
    update workflow_posts set status='rascunho' where id=v_post;
    insert into designs (conta_id, post_id, format, doc_r2_key, doc_hash, doc_bytes)
      values (v_ws, v_post, 'feed', 'dk','dh',10);
    v_threw := false;
    begin perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/w.jpg','size_bytes',10,'mime_type','image/jpeg')));
    exception when sqlstate 'P0001' then assert sqlerrm like 'design_attached%'; v_threw:=true; end;
    assert v_threw, 'design_attached rejected';
  end;

  raise notice 'post_media_set_from_uploads: all cases passed';
end $$;
rollback;
