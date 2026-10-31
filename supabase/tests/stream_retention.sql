\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;

-- Vídeo já no Stream (stream_uid + 'ready'), sem link nenhum.
create function pg_temp.mk_video(ws uuid) returns bigint language plpgsql as $$
declare
  v_id bigint;
  v_key text := 'contas/' || ws || '/files/' || gen_random_uuid() || '.mp4';
begin
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes,
                     stream_uid, stream_status)
    values (ws, v_key, v_key || '.jpg', 'video.mp4', 'video', 'video/mp4', 100,
            'uid-' || gen_random_uuid(), 'ready')
    returning id into v_id;
  return v_id;
end $$;

create function pg_temp.mk_post(ws uuid, wf bigint, st text, pub timestamptz, created timestamptz)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into workflow_posts (conta_id, workflow_id, titulo, tipo, status, published_at, created_at)
    values (ws, wf, 'Post ' || st, 'feed', st, pub, created)
    returning id into v_id;
  return v_id;
end $$;

create temp table claim_result (id bigint, stream_uid text) on commit drop;

create function pg_temp.released(p_id bigint, p_uid text) returns boolean language sql as $$
  select exists (select 1 from pg_temp.claim_result r where r.id = p_id and r.stream_uid = p_uid)
$$;

do $$
declare
  ws uuid := et_make_workspace('pro');
  other_ws uuid := et_make_workspace('pro');
  uid uuid := gen_random_uuid();
  client_id bigint; wf bigint; other_wf bigint;
  old_postado bigint; fresh_enviado bigint; foreign_live bigint; agendado_post bigint;
  stale_rascunho bigint; revived_rascunho bigint; corrupt_postado bigint;
  f_shared bigint; f_old bigint; f_foreign bigint; f_library bigint;
  f_parked bigint; f_parked_young bigint; f_revived bigint; f_corrupt bigint;
  v_id bigint; v_status text;
  uid_old text; uid_foreign text; uid_library text; uid_corrupt text;
begin
  insert into auth.users (id) values (uid);
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (ws, uid, 'Stream retention', 'SR', '#000') returning id into client_id;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (ws, client_id, uid, 'Stream workflow', 'ativo') returning id into wf;
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (other_ws, uid, 'Other workspace', 'OW', '#000') returning id into client_id;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (other_ws, client_id, uid, 'Foreign workflow', 'ativo') returning id into other_wf;

  -- ---------- Default 'parked' no INSERT ----------
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes)
    values (ws, 'contas/'||ws||'/files/lib.mp4', 'contas/'||ws||'/files/lib.jpg', 'lib.mp4', 'video', 'video/mp4', 100)
    returning id into v_id;
  assert (select stream_status = 'parked' from files where id = v_id), 'video with NULL stream_status defaults to parked';
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes, stream_status)
    values (ws, 'contas/'||ws||'/files/ref.mp4', 'contas/'||ws||'/files/ref.jpg', 'ref.mp4', 'video', 'video/mp4', 100, 'skipped')
    returning id into v_id;
  assert (select stream_status = 'skipped' from files where id = v_id), 'skipped video stays skipped';
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (ws, 'contas/'||ws||'/files/img.jpg', 'img.jpg', 'image', 'image/jpeg', 100)
    returning id into v_id;
  assert (select stream_status is null from files where id = v_id), 'image stream_status stays NULL';

  -- ---------- stream_post_is_live ----------
  assert stream_post_is_live('agendado', null, now() - interval '200 days', 7, 60), 'agendado is live with no time limit';
  assert stream_post_is_live('falha_publicacao', null, now() - interval '200 days', 7, 60), 'falha_publicacao is live with no time limit';
  assert stream_post_is_live('postado', now() - interval '3 days', now() - interval '200 days', 7, 60), 'postado 3 days ago is live';
  assert not stream_post_is_live('postado', now() - interval '8 days', now(), 7, 60), 'postado 8 days ago is not live';
  assert not stream_post_is_live('postado', null, now(), 7, 60), 'postado with NULL published_at is not live';
  assert stream_post_is_live('enviado_cliente', null, now() - interval '59 days', 7, 60), 'enviado_cliente moved 59 days ago is live';
  assert not stream_post_is_live('rascunho', null, now() - interval '61 days', 7, 60), 'rascunho idle 61 days is not live';

  -- ---------- Posts ----------
  old_postado := pg_temp.mk_post(ws, wf, 'postado', now() - interval '30 days', now() - interval '40 days');
  fresh_enviado := pg_temp.mk_post(ws, wf, 'enviado_cliente', null, now() - interval '90 days');
  insert into post_status_events (post_id, conta_id, from_status, to_status, source, created_at)
    values (fresh_enviado, ws, 'rascunho', 'enviado_cliente', 'system', now() - interval '1 day');
  agendado_post := pg_temp.mk_post(ws, wf, 'agendado', null, now() - interval '200 days');
  foreign_live := pg_temp.mk_post(other_ws, other_wf, 'agendado', null, now());
  -- Movimento vem de post_status_events, não de created_at quando há evento.
  stale_rascunho := pg_temp.mk_post(ws, wf, 'rascunho', null, now() - interval '100 days');
  revived_rascunho := pg_temp.mk_post(ws, wf, 'rascunho', null, now() - interval '100 days');
  insert into post_status_events (post_id, conta_id, from_status, to_status, source, created_at)
    values (revived_rascunho, ws, 'enviado_cliente', 'rascunho', 'system', now() - interval '2 days');

  -- 'postado' com published_at nulo: dado corrompido, conta como publicado há muito tempo.
  alter table workflow_posts disable trigger workflow_posts_set_published_at;
  corrupt_postado := pg_temp.mk_post(ws, wf, 'postado', null, now());
  alter table workflow_posts enable trigger workflow_posts_set_published_at;
  assert (select published_at is null from workflow_posts where id = corrupt_postado), 'corrupt postado fixture has NULL published_at';

  -- ---------- Arquivos ----------
  f_shared := pg_temp.mk_video(ws);
  insert into post_file_links (conta_id, post_id, file_id) values (ws, old_postado, f_shared);
  insert into post_file_links (conta_id, post_id, file_id) values (ws, fresh_enviado, f_shared);

  f_old := pg_temp.mk_video(ws);
  insert into post_file_links (conta_id, post_id, file_id) values (ws, old_postado, f_old);
  select stream_uid into uid_old from files where id = f_old;

  -- Link com conta_id de outro workspace, apontando para post vivo do outro workspace.
  f_foreign := pg_temp.mk_video(ws);
  insert into post_file_links (conta_id, post_id, file_id) values (other_ws, foreign_live, f_foreign);
  select stream_uid into uid_foreign from files where id = f_foreign;

  f_library := pg_temp.mk_video(ws);
  select stream_uid into uid_library from files where id = f_library;

  f_corrupt := pg_temp.mk_video(ws);
  insert into post_file_links (conta_id, post_id, file_id) values (ws, corrupt_postado, f_corrupt);
  select stream_uid into uid_corrupt from files where id = f_corrupt;

  f_revived := pg_temp.mk_video(ws);
  insert into post_file_links (conta_id, post_id, file_id) values (ws, revived_rascunho, f_revived);
  v_id := pg_temp.mk_video(ws);
  insert into post_file_links (conta_id, post_id, file_id) values (ws, stale_rascunho, v_id);

  -- ---------- Elegibilidade ----------
  assert stream_file_is_eligible(f_shared, 7, 60), 'file linked to old postado AND fresh enviado_cliente is eligible';
  assert not stream_file_is_eligible(f_old, 7, 60), 'file linked only to 30-day postado is not eligible';
  assert not stream_file_is_eligible(f_foreign, 7, 60), 'cross-tenant link never makes a file eligible';
  assert not stream_file_is_eligible(f_library, 7, 60), 'library-only video is not eligible';
  assert not stream_file_is_eligible(f_corrupt, 7, 60), 'postado with NULL published_at is not eligible';
  assert stream_file_is_eligible(f_revived, 7, 60), 'recent status event keeps an old post live';
  assert not stream_file_is_eligible(v_id, 7, 60), 'old post with no status event is idle';

  -- ---------- stream_release_claim ----------
  insert into pg_temp.claim_result select * from stream_release_claim(50, 7, 60);
  assert not exists (select 1 from pg_temp.claim_result where id = f_shared), 'eligible shared file is not released';
  assert not exists (select 1 from pg_temp.claim_result where id = f_revived), 'revived post file is not released';
  assert pg_temp.released(f_old, uid_old), 'file of 30-day postado is released with its uid';
  assert pg_temp.released(f_foreign, uid_foreign), 'cross-tenant linked file is released';
  assert pg_temp.released(f_library, uid_library), 'library-only video is released';
  assert pg_temp.released(f_corrupt, uid_corrupt), 'NULL published_at postado file is released';
  assert (select stream_status = 'parked' and stream_uid is null from files where id = f_old), 'released row is parked with NULL uid';
  assert (select stream_status = 'ready' and stream_uid is not null from files where id = f_shared), 'eligible row untouched';
  assert not exists (select 1 from files where id = v_id and stream_uid is not null), 'idle post file released';

  delete from pg_temp.claim_result;
  insert into pg_temp.claim_result select * from stream_release_claim(50, 7, 60);
  assert not exists (select 1 from pg_temp.claim_result where id in (f_old, f_foreign, f_library, f_corrupt)), 'second claim returns nothing for already released rows';

  -- ---------- stream_ingest_candidates ----------
  assert not exists (select 1 from stream_ingest_candidates(1000, 7, 60) c where c.id = f_library), 'library-only video is not an ingest candidate';
  assert not exists (select 1 from stream_ingest_candidates(1000, 7, 60) c where c.id = f_foreign), 'cross-tenant linked video is not an ingest candidate';

  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes, created_at)
    values (ws, 'contas/'||ws||'/files/parked.mp4', 'contas/'||ws||'/files/parked.jpg', 'parked.mp4', 'video', 'video/mp4', 100,
            now() - interval '20 minutes')
    returning id into f_parked;
  insert into post_file_links (conta_id, post_id, file_id) values (ws, agendado_post, f_parked);
  assert (select stream_status = 'parked' from files where id = f_parked), 'fixture parked';
  assert exists (select 1 from stream_ingest_candidates(20, 7, 60) c where c.id = f_parked), 'parked video of live post, 20 min old, is an ingest candidate';

  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes, created_at)
    values (ws, 'contas/'||ws||'/files/young.mp4', 'contas/'||ws||'/files/young.jpg', 'young.mp4', 'video', 'video/mp4', 100,
            now() - interval '5 minutes')
    returning id into f_parked_young;
  insert into post_file_links (conta_id, post_id, file_id) values (ws, agendado_post, f_parked_young);
  assert not exists (select 1 from stream_ingest_candidates(1000, 7, 60) c where c.id = f_parked_young), 'video created 5 minutes ago is not yet a candidate';

  -- Skipped nunca entra, mesmo ligado a post vivo.
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes, stream_status, created_at)
    values (ws, 'contas/'||ws||'/files/sk.mp4', 'contas/'||ws||'/files/sk.jpg', 'sk.mp4', 'video', 'video/mp4', 100, 'skipped',
            now() - interval '1 hour')
    returning id into v_id;
  insert into post_file_links (conta_id, post_id, file_id) values (ws, agendado_post, v_id);
  assert not exists (select 1 from stream_ingest_candidates(1000, 7, 60) c where c.id = v_id), 'skipped video is never an ingest candidate';

  -- ---------- Grants ----------
  assert not has_function_privilege('authenticated', 'stream_release_claim(int,int,int)', 'execute'), 'authenticated cannot claim';
  assert not has_function_privilege('anon', 'stream_release_claim(int,int,int)', 'execute'), 'anon cannot claim';
  assert not has_function_privilege('authenticated', 'stream_ingest_candidates(int,int,int)', 'execute'), 'authenticated cannot list candidates';
  assert not has_function_privilege('anon', 'stream_ingest_candidates(int,int,int)', 'execute'), 'anon cannot list candidates';
  assert has_function_privilege('service_role', 'stream_release_claim(int,int,int)', 'execute'), 'service_role can claim';
  assert has_function_privilege('service_role', 'stream_ingest_candidates(int,int,int)', 'execute'), 'service_role can list candidates';

  raise notice 'stream_retention: all cases passed';
end $$;

rollback;
