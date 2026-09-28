\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Tutoriais em vídeo da Central de Ajuda (migration 20260928120001).
-- (a) authenticated só vê vídeo publicado + pronto de série publicada;
-- (b) não escreve no catálogo; (c) RPC de progresso: preserva completed_at,
-- recorta posição, recusa vídeo invisível; (d) progresso é por usuário;
-- (e) anon não executa a RPC; (f) CHECK: ready exige hls_url.
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ua         uuid := gen_random_uuid();
  v_ub         uuid := gen_random_uuid();
  v_s_pub      uuid;
  v_s_draft    uuid;
  v_v_ok       bigint;
  v_v_draft    bigint;
  v_v_pending  bigint;
  v_v_hidden_s bigint;
  v_ids        bigint[];
  v_n          int;
  v_pos        numeric;
  v_completed  timestamptz;
  v_rejected   boolean;
begin
  -- et_grant_hosted_parity() grants ALL on every table (hosted default ACL), so every
  -- rejection below comes from RLS, not from missing table grants: an RLS WITH CHECK
  -- failure raises insufficient_privilege (42501), and an UPDATE with no matching policy
  -- silently affects 0 rows. Function EXECUTE grants are untouched by the helper.
  insert into auth.users (id) values (v_ua), (v_ub);

  insert into kb_video_series (title, slug, status) values ('Primeiros passos', 'primeiros-passos', 'published')
    returning id into v_s_pub;
  insert into kb_video_series (title, slug, status) values ('Rascunho', 'serie-rascunho', 'draft')
    returning id into v_s_draft;

  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_pub, 'Ok', 'ok', 'published', 'uid-ok', 'ready', 'https://x.test/ok.m3u8', 100)
    returning id into v_v_ok;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_pub, 'Rascunho', 'video-rascunho', 'draft', 'uid-draft', 'ready', 'https://x.test/d.m3u8', 50)
    returning id into v_v_draft;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status)
    values (v_s_pub, 'Processando', 'processando', 'published', 'uid-pending', 'pending')
    returning id into v_v_pending;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_draft, 'Serie oculta', 'serie-oculta', 'published', 'uid-hidden', 'ready', 'https://x.test/h.m3u8', 30)
    returning id into v_v_hidden_s;

  -- ---- (a) visibilidade como A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select coalesce(array_agg(id order by id), '{}') into v_ids from kb_videos;
  assert v_ids = array[v_v_ok], format('A deveria ver so o video pronto e publicado, viu %s', v_ids);
  select count(*) into v_n from kb_video_series;
  assert v_n = 1, format('A deveria ver so a serie publicada, viu %s', v_n);

  -- ---- (b) sem escrita no catálogo ----
  v_rejected := false;
  begin
    insert into kb_video_series (title, slug) values ('Invasor', 'invasor');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated conseguiu inserir serie';

  update kb_videos set title = 'hack' where id = v_v_ok;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'authenticated conseguiu atualizar kb_videos';

  -- ---- (c) RPC de progresso ----
  perform save_kb_video_progress(v_v_ok, 50, false);
  perform save_kb_video_progress(v_v_ok, 95, true);
  perform save_kb_video_progress(v_v_ok, 10, false);
  select position_seconds, completed_at into v_pos, v_completed
    from kb_video_progress where user_id = v_ua and video_id = v_v_ok;
  assert v_completed is not null, 'completed_at foi apagado por um save com p_completed = false';
  assert v_pos = 10, format('posicao deveria ser a ultima gravada (10), foi %s', v_pos);

  perform save_kb_video_progress(v_v_ok, 500, false);
  select position_seconds into v_pos from kb_video_progress where user_id = v_ua and video_id = v_v_ok;
  assert v_pos = 100, format('posicao acima da duracao deveria virar 100, foi %s', v_pos);

  perform save_kb_video_progress(v_v_ok, -5, false);
  select position_seconds into v_pos from kb_video_progress where user_id = v_ua and video_id = v_v_ok;
  assert v_pos = 0, format('posicao negativa deveria virar 0, foi %s', v_pos);

  v_rejected := false;
  begin
    perform save_kb_video_progress(v_v_draft, 1, false);
  exception when no_data_found then
    v_rejected := true;
  end;
  assert v_rejected, 'RPC aceitou progresso de video em rascunho';

  v_rejected := false;
  begin
    insert into kb_video_progress (user_id, video_id) values (v_ub, v_v_ok);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'A conseguiu gravar progresso com user_id de B';
  execute 'reset role';

  -- ---- (d) B não vê o progresso de A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from kb_video_progress;
  assert v_n = 0, 'B enxerga progresso de A';
  execute 'reset role';

  -- ---- (e) grants da RPC ----
  assert has_function_privilege('anon', 'public.save_kb_video_progress(bigint,numeric,boolean)', 'EXECUTE') = false,
    'anon nao pode executar save_kb_video_progress';
  assert has_function_privilege('authenticated', 'public.save_kb_video_progress(bigint,numeric,boolean)', 'EXECUTE') = true,
    'authenticated precisa executar save_kb_video_progress';

  -- ---- (f) CHECK ready exige hls_url ----
  v_rejected := false;
  begin
    insert into kb_videos (series_id, title, slug, stream_status) values (v_s_pub, 'Sem hls', 'sem-hls', 'ready');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'ready sem hls_url foi aceito';
end $$;
rollback;
