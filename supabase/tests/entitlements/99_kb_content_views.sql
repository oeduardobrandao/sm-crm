\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Contagem de visualizações da Central de Ajuda (migration 20261001000001).
-- (a) grants: tabela fechada para anon/authenticated; record_kb_view só authenticated;
--     kb_view_stats só service_role. (b) record_kb_view ignora conteúdo oculto, deduplica
--     por 30 min, exige exatamente um alvo. (c) kb_view_stats: janelas 30d/total, pessoas
--     únicas, conclusões só de quem tem visualização registrada, admins excluídos NA LEITURA.
begin;
-- kb_content_views é excluída: a parity grant concederia ALL e desfaria o REVOKE sob teste.
select et_grant_hosted_parity(array['kb_content_views']);
do $$
declare
  v_ua        uuid := gen_random_uuid();
  v_ub        uuid := gen_random_uuid();
  v_adm       uuid := gen_random_uuid();
  v_s_pub     uuid;
  v_s_draft   uuid;
  v_art_pub   uuid;
  v_art_draft uuid;
  v_v_ok      bigint;
  v_v_pending bigint;
  v_v_hidden  bigint;
  v_n         int;
  v_rejected  boolean;
  r           record;
begin
  -- ---- (a) grants ----
  assert not has_table_privilege('authenticated', 'public.kb_content_views', 'SELECT'),
    'authenticated tem SELECT em kb_content_views';
  assert not has_table_privilege('authenticated', 'public.kb_content_views', 'INSERT'),
    'authenticated tem INSERT em kb_content_views';
  assert not has_table_privilege('authenticated', 'public.kb_content_views', 'UPDATE'),
    'authenticated tem UPDATE em kb_content_views';
  assert not has_table_privilege('anon', 'public.kb_content_views', 'SELECT'),
    'anon tem SELECT em kb_content_views';
  assert not has_function_privilege('anon', 'public.record_kb_view(uuid,bigint)', 'EXECUTE'),
    'anon nao pode executar record_kb_view';
  assert has_function_privilege('authenticated', 'public.record_kb_view(uuid,bigint)', 'EXECUTE'),
    'authenticated precisa executar record_kb_view';
  assert not has_function_privilege('authenticated', 'public.kb_view_stats()', 'EXECUTE'),
    'authenticated nao pode executar kb_view_stats';
  assert not has_function_privilege('anon', 'public.kb_view_stats()', 'EXECUTE'),
    'anon nao pode executar kb_view_stats';
  assert has_function_privilege('service_role', 'public.kb_view_stats()', 'EXECUTE'),
    'service_role precisa executar kb_view_stats';

  -- ---- fixtures ----
  insert into auth.users (id) values (v_ua), (v_ub), (v_adm);
  insert into platform_admins (user_id, email) values (v_adm, 'adm@kbviews.test');

  insert into kb_articles (title, slug, category, status) values ('Pub', 'kbv-pub', 'geral', 'published')
    returning id into v_art_pub;
  insert into kb_articles (title, slug, category, status) values ('Draft', 'kbv-draft', 'geral', 'draft')
    returning id into v_art_draft;

  insert into kb_video_series (title, slug, status) values ('S', 'kbv-s', 'published') returning id into v_s_pub;
  insert into kb_video_series (title, slug, status) values ('D', 'kbv-d', 'draft') returning id into v_s_draft;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_pub, 'Ok', 'kbv-ok', 'published', 'kbv-uid-ok', 'ready', 'https://x.test/ok.m3u8', 100)
    returning id into v_v_ok;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status)
    values (v_s_pub, 'Pend', 'kbv-pend', 'published', 'kbv-uid-pend', 'pending')
    returning id into v_v_pending;
  insert into kb_videos (series_id, title, slug, status, stream_uid, stream_status, hls_url, duration_seconds)
    values (v_s_draft, 'Hid', 'kbv-hid', 'published', 'kbv-uid-hid', 'ready', 'https://x.test/h.m3u8', 30)
    returning id into v_v_hidden;

  -- ---- (b) record_kb_view como A ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  perform record_kb_view(p_article_id => v_art_pub);
  perform record_kb_view(p_article_id => v_art_pub);          -- dedupe 30 min
  perform record_kb_view(p_article_id => v_art_draft);        -- oculto: silencioso
  perform record_kb_view(p_article_id => gen_random_uuid());  -- inexistente: silencioso
  perform record_kb_view(p_video_id => v_v_ok);
  perform record_kb_view(p_video_id => v_v_pending);          -- não pronto
  perform record_kb_view(p_video_id => v_v_hidden);           -- série rascunho

  v_rejected := false;
  begin
    perform record_kb_view(p_article_id => v_art_pub, p_video_id => v_v_ok);
  exception when invalid_parameter_value then v_rejected := true;
  end;
  assert v_rejected, 'record_kb_view aceitou dois alvos';

  v_rejected := false;
  begin
    perform record_kb_view();
  exception when invalid_parameter_value then v_rejected := true;
  end;
  assert v_rejected, 'record_kb_view aceitou nenhum alvo';

  v_rejected := false;
  begin
    perform 1 from kb_content_views;
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'authenticated leu kb_content_views direto';
  execute 'reset role';

  select count(*) into v_n from kb_content_views where user_id = v_ua and article_id = v_art_pub;
  assert v_n = 1, format('dedupe falhou: %s linhas para o artigo publicado', v_n);
  select count(*) into v_n from kb_content_views where article_id = v_art_draft;
  assert v_n = 0, 'artigo rascunho foi registrado';
  select count(*) into v_n from kb_content_views where video_id in (v_v_pending, v_v_hidden);
  assert v_n = 0, 'video oculto foi registrado';
  select count(*) into v_n from kb_content_views where user_id = v_ua and video_id = v_v_ok;
  assert v_n = 1, 'video pronto nao foi registrado';

  -- passada a janela de 30 min, uma nova visualização conta
  update kb_content_views set viewed_at = now() - interval '31 minutes' where user_id = v_ua and article_id = v_art_pub;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform record_kb_view(p_article_id => v_art_pub);
  execute 'reset role';
  select count(*) into v_n from kb_content_views where user_id = v_ua and article_id = v_art_pub;
  assert v_n = 2, format('apos 31 min deveria haver 2 linhas, ha %s', v_n);

  -- admin é registrado normalmente (exclusão é na leitura)
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform record_kb_view(p_article_id => v_art_pub);
  perform record_kb_view(p_video_id => v_v_ok);
  execute 'reset role';
  select count(*) into v_n from kb_content_views where user_id = v_adm;
  assert v_n = 2, 'visualizacao de admin deveria ser gravada';

  -- B: uma visualização antiga (40 dias) do artigo
  insert into kb_content_views (article_id, user_id, viewed_at) values (v_art_pub, v_ub, now() - interval '40 days');

  -- conclusões: A concluiu (tem view), B concluiu sem view (pré-feature), admin concluiu
  insert into kb_video_progress (user_id, video_id, position_seconds, completed_at) values
    (v_ua, v_v_ok, 100, now()), (v_ub, v_v_ok, 100, now()), (v_adm, v_v_ok, 100, now());

  -- ---- (c) kb_view_stats ----
  select * into r from kb_view_stats() where kind = 'article' and item_id = v_art_pub::text;
  -- A: 2 views (ambas < 30d: now()-31min e now()); B: 1 view de 40 dias; admin excluído
  assert r.views_30d = 2, format('artigo views_30d = %s, esperado 2', r.views_30d);
  assert r.users_30d = 1, format('artigo users_30d = %s, esperado 1', r.users_30d);
  assert r.views_total = 3, format('artigo views_total = %s, esperado 3', r.views_total);
  assert r.users_total = 2, format('artigo users_total = %s, esperado 2', r.users_total);
  assert r.completed_total is null, 'artigo nao tem completed_total';

  select * into r from kb_view_stats() where kind = 'video' and item_id = v_v_ok::text;
  assert r.views_total = 1, format('video views_total = %s, esperado 1 (admin excluido)', r.views_total);
  assert r.completed_total = 1,
    format('video completed_total = %s, esperado 1 (B sem view, admin excluido)', r.completed_total);

  select count(*) into v_n from kb_view_stats() where item_id in (v_art_draft::text, v_v_pending::text);
  assert v_n = 0, 'itens sem visualizacao nao devem aparecer';

  -- promover A a admin remove views e conclusões dele; remover devolve
  insert into platform_admins (user_id, email) values (v_ua, 'a@kbviews.test');
  select count(*) into v_n from kb_view_stats() where kind = 'video' and item_id = v_v_ok::text;
  assert v_n = 0, 'video deveria sumir: unico viewer virou admin';
  select * into r from kb_view_stats() where kind = 'article' and item_id = v_art_pub::text;
  assert r.views_total = 1 and r.users_total = 1, format('apos promover A: total=%s users=%s', r.views_total, r.users_total);

  delete from platform_admins where user_id = v_ua;
  select * into r from kb_view_stats() where kind = 'video' and item_id = v_v_ok::text;
  assert r.views_total = 1 and r.completed_total = 1, 'remover admin deveria devolver views e conclusoes';

  -- usuário apagado: views ficam no total, saem das pessoas únicas
  delete from kb_video_progress where user_id = v_ub;
  -- o seed de workspace cria um workflow_templates por usuario; user_id NOT NULL barra o SET NULL
  delete from workflow_templates where user_id = v_ub;
  delete from auth.users where id = v_ub;
  select * into r from kb_view_stats() where kind = 'article' and item_id = v_art_pub::text;
  assert r.views_total = 3 and r.users_total = 1,
    format('apos apagar B: total=%s users=%s', r.views_total, r.users_total);
end $$;
rollback;
