-- Validação do claim por destino (20261013000003) e da paridade de
-- mark_platform_published copiado para frente (20261013000002). Casos:
--   (a) mark_platform_published('instagram') num post só Instagram -> postado (paridade)
--   (b) both: só o lado IG concluído, destino TikTok pendente -> segue agendado
--   (c) mark_platform_published('tiktok') nesse post -> postado; estado no destino,
--       colunas tiktok_* congeladas
--   (d) claim init: devolve as colunas do contrato; ignora post sem destino TikTok,
--       conta inativa e stories; não deixa trava em linha que não devolve
--   (e) claim do IG (inalterado): pula post both com instagram_media_id
--   (f) claim retry: destino falha + retry_count < 3 + post em agendado/falha_publicacao
--   (g) init: só com data vencida; destino re-enfileirado (agendado) com post em
--       falha_publicacao entra; re-enfileirado com data futura NÃO entra; pendente só
--       com post agendado
--   (h) status: destino processando com publish_ref, sem filtro de status do post
--   (i) ORDER BY scheduled_at
--   (j) o claim antigo devolve zero linhas e não trava nada
--
-- Plano 'pro' (limites folgados para a quantidade de posts da fixture).
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws  uuid;
  v_u   uuid := gen_random_uuid();
  v_cli bigint; v_cli2 bigint;
  v_wf  bigint; v_wf2  bigint;
  v_tt_acct uuid;

  v_post_ig bigint; v_post_both bigint;
  v_post_ig_only bigint; v_post_tt_valid bigint; v_post_tt_inactive bigint; v_post_stories bigint;
  v_post_both_guard_container bigint; v_post_both_guard_publish bigint;
  v_post_both_valid_publish bigint; v_post_both_guard_retry bigint;
  v_retry_valid bigint; v_retry_agendado bigint; v_retry_maxed bigint; v_retry_rascunho bigint;
  v_requeued_falha bigint; v_requeued_future bigint; v_pend_falha bigint; v_pend_future bigint;
  v_status_moved bigint; v_status_noref bigint;
  v_order_late bigint; v_order_early bigint;
  v_old bigint;
  v_order bigint[];
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_u) on conflict do nothing;

  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_u, 'Cliente A', 'CA', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_u, 'wf', 'ativo') returning id into v_wf;
  insert into instagram_accounts (client_id, instagram_user_id, encrypted_access_token)
    values (v_cli, 'ig_user_1', 'enc_ig');
  insert into tiktok_accounts (client_id, tiktok_open_id, username, authorization_status,
                                encrypted_access_token, encrypted_refresh_token, access_token_expires_at)
    values (v_cli, 'tt_open_1', 'tt_user', 'active', 'enc_tt_a', 'enc_tt_r', now() + interval '1 day')
    returning id into v_tt_acct;

  -- (a) paridade do ramo Instagram
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-ig', 'feed', 'agendado', 'instagram', now() - interval '1 hour')
    returning id into v_post_ig;
  perform mark_platform_published(v_post_ig, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'media_ig_1', 'instagram_permalink', 'https://instagram.com/p/1'));
  assert (select status from workflow_posts where id = v_post_ig) = 'postado', '(a) postado';
  assert (select instagram_media_id from workflow_posts where id = v_post_ig) = 'media_ig_1', '(a) media';
  assert (select publish_processing_at from workflow_posts where id = v_post_ig) is null, '(a) trava IG limpa';

  -- (b) both: IG pronto, TikTok pendente
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-both', 'feed', 'agendado', 'both', now() + interval '1 hour')
    returning id into v_post_both;
  perform mark_platform_published(v_post_both, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'media_both_1'));
  assert (select status from workflow_posts where id = v_post_both) = 'agendado', '(b) segue agendado';
  assert (select status from post_targets where post_id = v_post_both and platform = 'tiktok') = 'pendente',
    '(b) destino TikTok intacto';

  -- (c) TikTok concluído pelo caminho legado -> postado, estado no destino
  perform mark_platform_published(v_post_both, 'tiktok', 'system', null,
    jsonb_build_object('tiktok_post_id', 'tt_vid_1', 'tiktok_post_url', 'https://tiktok.com/@x/video/1'));
  assert (select status from workflow_posts where id = v_post_both) = 'postado', '(c) postado';
  assert (select status = 'publicado' and external_id = 'tt_vid_1'
                 and permalink = 'https://tiktok.com/@x/video/1'
            from post_targets where post_id = v_post_both and platform = 'tiktok'), '(c) destino publicado';
  assert (select tiktok_publish_status is null and tiktok_post_id is null
            from workflow_posts where id = v_post_both), '(c) colunas tiktok_* congeladas';

  -- (d) init: filtros e contrato de retorno
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-ig-only', 'feed', 'agendado', 'instagram', now() - interval '1 hour')
    returning id into v_post_ig_only;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at, tiktok_caption)
    values (v_wf, v_ws, 'p-tt-valid', 'feed', 'agendado', 'tiktok', now() - interval '1 hour', 'legenda tt')
    returning id into v_post_tt_valid;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-stories', 'stories', 'agendado', 'tiktok', now() - interval '1 hour')
    returning id into v_post_stories;
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_u, 'Cliente B', 'CB', '#111') returning id into v_cli2;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli2, v_u, 'wf2', 'ativo') returning id into v_wf2;
  insert into tiktok_accounts (client_id, tiktok_open_id, username, authorization_status)
    values (v_cli2, 'tt_open_2', 'tt_user_2', 'expired');
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf2, v_ws, 'p-tt-inactive', 'feed', 'agendado', 'tiktok', now() - interval '1 hour')
    returning id into v_post_tt_inactive;

  -- (g) fixtures do init (antes do primeiro claim de init)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-requeued-falha', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour')
    returning id into v_requeued_falha;
  update post_targets set status = 'agendado' where post_id = v_requeued_falha and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-requeued-future', 'feed', 'agendado', 'tiktok', now() + interval '3 days')
    returning id into v_requeued_future;
  update post_targets set status = 'agendado' where post_id = v_requeued_future and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-pend-falha', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour')
    returning id into v_pend_falha;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-pend-future', 'feed', 'agendado', 'tiktok', now() + interval '3 days')
    returning id into v_pend_future;

  -- (i) ordem: o mais antigo primeiro
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-order-late', 'feed', 'agendado', 'tiktok', now() - interval '5 minutes')
    returning id into v_order_late;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-order-early', 'feed', 'agendado', 'tiktok', now() - interval '5 days')
    returning id into v_order_early;

  -- (j) antes de qualquer claim novo: o antigo não devolve nem trava nada
  assert (select count(*) from claim_posts_for_tiktok_publishing('init', 25)) = 0, '(j) claim antigo vazio';
  assert (select count(*) from claim_posts_for_tiktok_publishing('retry', 25)) = 0, '(j) retry antigo vazio';
  assert (select processing_at from post_targets where post_id = v_post_tt_valid and platform = 'tiktok') is null,
    '(j) claim antigo nao trava';

  create temp table tt_claim_init on commit drop as
    select row_number() over () as rn, c.* from claim_tiktok_targets_for_publishing('init', 25) c;

  assert exists (select 1 from tt_claim_init where post_id = v_post_tt_valid), '(d) post TikTok valido';
  assert not exists (select 1 from tt_claim_init where post_id = v_post_ig_only), '(d) sem destino TikTok';
  assert not exists (select 1 from tt_claim_init where post_id = v_post_stories), '(d) stories';
  assert not exists (select 1 from tt_claim_init where post_id = v_post_tt_inactive), '(d) conta inativa';
  assert (select processing_at from post_targets where post_id = v_post_tt_inactive and platform = 'tiktok') is null,
    '(d) nenhuma trava em linha que o claim nao devolveu';
  assert (select processing_at from post_targets where post_id = v_post_tt_valid and platform = 'tiktok') is not null,
    '(d) trava no destino devolvido';
  assert (select tiktok_publish_processing_at from workflow_posts where id = v_post_tt_valid) is null,
    '(d) coluna legada de trava nao e tocada';
  assert (select conta_id = v_ws and cliente_id = v_cli and tipo = 'feed' and caption = 'legenda tt'
                 and tiktok_account_id = v_tt_acct and tiktok_username = 'tt_user'
                 and publish_ref is null and retry_count = 0
                 and target_id = (select id from post_targets where post_id = v_post_tt_valid and platform = 'tiktok')
            from tt_claim_init where post_id = v_post_tt_valid), '(d) contrato de retorno';

  -- (g)
  assert exists (select 1 from tt_claim_init where post_id = v_requeued_falha),
    '(g) re-enfileirado com post em falha_publicacao';
  assert not exists (select 1 from tt_claim_init where post_id = v_requeued_future),
    '(g) re-enfileirado com data futura fica (spec §2f: scheduled_at <= now())';
  assert (select processing_at from post_targets where post_id = v_requeued_future and platform = 'tiktok') is null,
    '(g) re-enfileirado com data futura nao e travado';
  assert not exists (select 1 from tt_claim_init where post_id = v_pend_falha),
    '(g) pendente com post em falha_publicacao fica';
  assert not exists (select 1 from tt_claim_init where post_id = v_pend_future),
    '(g) pendente com data futura fica';

  -- (i)
  select array_agg(post_id order by rn) into v_order
    from tt_claim_init where post_id in (v_order_early, v_order_late);
  assert v_order = array[v_order_early, v_order_late], format('(i) ordem %s', v_order);
  assert (select max(rn) from tt_claim_init where post_id = v_order_early)
       < (select min(rn) from tt_claim_init where post_id = v_post_tt_valid), '(i) mais antigo antes';

  -- (e) claim do IG inalterado
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_container_id, instagram_media_id)
    values (v_wf, v_ws, 'p-guard-container', 'feed', 'agendado', 'both', now() - interval '1 hour',
            null, 'already_published_container')
    returning id into v_post_both_guard_container;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_container_id, instagram_media_id)
    values (v_wf, v_ws, 'p-guard-publish', 'feed', 'agendado', 'both', now() - interval '1 hour',
            'container_x', 'already_published_publish')
    returning id into v_post_both_guard_publish;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_container_id, instagram_media_id, ig_caption)
    values (v_wf, v_ws, 'p-valid-publish', 'feed', 'agendado', 'both', now() - interval '1 hour',
            'container_y', null, 'legenda ig')
    returning id into v_post_both_valid_publish;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_media_id, publish_retry_count)
    values (v_wf, v_ws, 'p-guard-retry', 'feed', 'falha_publicacao', 'both', now() - interval '1 hour',
            'already_published_retry', 0)
    returning id into v_post_both_guard_retry;

  create temp table ig_claim_container on commit drop as
    select * from claim_posts_for_publishing('container', 25);
  assert not exists (select 1 from ig_claim_container where post_id = v_post_both_guard_container), '(e) container';
  assert not exists (select 1 from ig_claim_container where post_id = v_post_tt_valid), '(e) TikTok so nunca no IG';
  create temp table ig_claim_publish on commit drop as
    select * from claim_posts_for_publishing('publish', 25);
  assert not exists (select 1 from ig_claim_publish where post_id = v_post_both_guard_publish), '(e) publish';
  assert exists (select 1 from ig_claim_publish where post_id = v_post_both_valid_publish), '(e) controle positivo';
  create temp table ig_claim_retry on commit drop as
    select * from claim_posts_for_publishing('retry', 25);
  assert not exists (select 1 from ig_claim_retry where post_id = v_post_both_guard_retry), '(e) retry';

  -- (f) retry
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-retry-valid', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour')
    returning id into v_retry_valid;
  update post_targets set status = 'falha', retry_count = 1, publish_ref = 'pub-r1'
   where post_id = v_retry_valid and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-retry-agendado', 'feed', 'agendado', 'both', now() - interval '1 hour')
    returning id into v_retry_agendado;
  update post_targets set status = 'falha', retry_count = 1
   where post_id = v_retry_agendado and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-retry-maxed', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour')
    returning id into v_retry_maxed;
  update post_targets set status = 'falha', retry_count = 3
   where post_id = v_retry_maxed and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-retry-rascunho', 'feed', 'rascunho', 'tiktok', now() - interval '1 hour')
    returning id into v_retry_rascunho;
  update post_targets set status = 'falha', retry_count = 1
   where post_id = v_retry_rascunho and platform = 'tiktok';

  create temp table tt_claim_retry on commit drop as
    select * from claim_tiktok_targets_for_publishing('retry', 25);
  assert exists (select 1 from tt_claim_retry where post_id = v_retry_valid and publish_ref = 'pub-r1'
                                                 and retry_count = 1), '(f) falha + falha_publicacao';
  assert exists (select 1 from tt_claim_retry where post_id = v_retry_agendado),
    '(f) falha com post de volta em agendado (flap do IG)';
  assert not exists (select 1 from tt_claim_retry where post_id = v_retry_maxed), '(f) retry_count 3';
  assert not exists (select 1 from tt_claim_retry where post_id = v_retry_rascunho), '(f) post fora de publicacao';

  -- (h) status
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-status-moved', 'feed', 'aprovado_cliente', 'tiktok', now() - interval '1 hour')
    returning id into v_status_moved;
  update post_targets set status = 'processando', publish_ref = 'pub-h1'
   where post_id = v_status_moved and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-status-noref', 'feed', 'agendado', 'tiktok', now() - interval '1 hour')
    returning id into v_status_noref;
  update post_targets set status = 'processando' where post_id = v_status_noref and platform = 'tiktok';

  create temp table tt_claim_status on commit drop as
    select * from claim_tiktok_targets_for_publishing('status', 25);
  assert exists (select 1 from tt_claim_status where post_id = v_status_moved and publish_ref = 'pub-h1'),
    '(h) processando com post movido para aprovado_cliente';
  assert not exists (select 1 from tt_claim_status where post_id = v_status_noref), '(h) sem publish_ref';
  -- trava fresca: o mesmo destino não volta no claim seguinte
  assert not exists (select 1 from claim_tiktok_targets_for_publishing('status', 25) c
                      where c.post_id = v_status_moved), '(h) trava fresca segura o destino';

  -- (j) depois de tudo: o claim antigo continua vazio
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-old', 'feed', 'agendado', 'tiktok', now() - interval '1 hour')
    returning id into v_old;
  assert (select count(*) from claim_posts_for_tiktok_publishing('init', 25)) = 0, '(j) antigo segue vazio';
  assert (select processing_at from post_targets where post_id = v_old and platform = 'tiktok') is null,
    '(j) antigo nao trava o destino novo';

  raise notice 'tiktok_publishing_rpcs: all cases (a)-(j) passed';
end $$;
rollback;
