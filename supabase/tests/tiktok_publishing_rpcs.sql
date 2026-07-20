-- pgTAP-style validation for supabase/migrations/20260719000001_tiktok_publishing.sql.
-- Covers the brief's cases (a)-(f):
--   (a) mark_platform_published('instagram') on a platform='instagram' post -> postado (parity)
--   (b) platform='both' post, IG side done, TikTok pending -> stays agendado, instagram_media_id set
--   (c) then mark_platform_published('tiktok') on that post -> postado
--   (d) TikTok claim 'init' ignores platform='instagram' posts and accounts not 'active'
--   (e) IG claim (claim_posts_for_publishing) skips a 'both' post whose instagram_media_id is
--       already set, across the 'container', 'publish' and 'retry' phases, even in status
--       'agendado'/'falha_publicacao' -- this is the double-publish race the migration closes
--   (f) TikTok claim 'retry' requires status='falha_publicacao' AND tiktok_publish_status='failed'
--       AND tiktok_publish_retry_count < 3
--
-- Uses the 'pro' plan (max_posts_per_workflow/max_clients/max_active_workflows_per_client all
-- generous or null/unlimited) rather than 'free' (max_posts_per_workflow=5, too tight for the
-- number of fixture posts this file needs) -- see supabase/seed.sql for the plan catalog.
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws  uuid;
  v_u   uuid := gen_random_uuid();
  v_cli bigint; v_cli2 bigint;
  v_wf  bigint; v_wf2  bigint;
  v_ig_acct uuid;
  v_tt_acct uuid;
  v_tt_acct_inactive uuid;

  v_post_ig   bigint;  -- (a)
  v_post_both bigint;  -- (b) / (c)

  v_post_ig_only        bigint;  -- (d)
  v_post_tt_valid        bigint; -- (d)
  v_post_tt_inactive_acct bigint;-- (d)

  v_post_both_guard_container bigint; -- (e)
  v_post_both_guard_publish   bigint; -- (e)
  v_post_both_valid_publish   bigint; -- (e) positive control
  v_post_both_guard_retry     bigint; -- (e)

  v_post_tt_retry_valid         bigint; -- (f)
  v_post_tt_retry_wrong_status  bigint; -- (f)
  v_post_tt_retry_wrong_pub     bigint; -- (f)
  v_post_tt_retry_maxed         bigint; -- (f)
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_u) on conflict do nothing;

  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_u, 'Cliente A', 'CA', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_u, 'wf', 'ativo') returning id into v_wf;

  insert into instagram_accounts (client_id, instagram_user_id, encrypted_access_token)
    values (v_cli, 'ig_user_1', 'enc_ig') returning id into v_ig_acct;
  insert into tiktok_accounts (client_id, tiktok_open_id, username, authorization_status,
                                encrypted_access_token, encrypted_refresh_token, access_token_expires_at)
    values (v_cli, 'tt_open_1', 'tt_user', 'active', 'enc_tt_a', 'enc_tt_r', now() + interval '1 day')
    returning id into v_tt_acct;

  -- ================================================================
  -- (a) mark_platform_published('instagram') on a platform='instagram' post -> postado (parity)
  -- ================================================================
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-ig', 'feed', 'agendado', 'instagram', now() - interval '1 hour')
    returning id into v_post_ig;

  perform mark_platform_published(v_post_ig, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'media_ig_1', 'instagram_permalink', 'https://instagram.com/p/1'));

  assert (select status from workflow_posts where id = v_post_ig) = 'postado',
    '(a) instagram-only post reaches postado on IG completion';
  assert (select instagram_media_id from workflow_posts where id = v_post_ig) = 'media_ig_1',
    '(a) instagram_media_id written';
  assert (select publish_processing_at from workflow_posts where id = v_post_ig) is null,
    '(a) publish_processing_at cleared';

  -- ================================================================
  -- (b) platform='both': IG side done, TikTok pending -> stays agendado
  -- ================================================================
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-both', 'feed', 'agendado', 'both', now() - interval '1 hour')
    returning id into v_post_both;

  perform mark_platform_published(v_post_both, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'media_both_1'));

  assert (select status from workflow_posts where id = v_post_both) = 'agendado',
    '(b) both-platform post stays agendado after only the IG side completes';
  assert (select instagram_media_id from workflow_posts where id = v_post_both) = 'media_both_1',
    '(b) instagram_media_id set on the both-platform post';
  assert (select tiktok_publish_status from workflow_posts where id = v_post_both) is null,
    '(b) tiktok side still untouched';

  -- ================================================================
  -- (c) then mark_platform_published('tiktok') -> postado
  -- ================================================================
  perform mark_platform_published(v_post_both, 'tiktok', 'system', null,
    jsonb_build_object('tiktok_post_id', 'tt_vid_1', 'tiktok_post_url', 'https://tiktok.com/@x/video/1'));

  assert (select status from workflow_posts where id = v_post_both) = 'postado',
    '(c) both-platform post reaches postado once the TikTok side also completes';
  assert (select tiktok_publish_status from workflow_posts where id = v_post_both) = 'published',
    '(c) tiktok_publish_status is published';
  assert (select tiktok_post_id from workflow_posts where id = v_post_both) = 'tt_vid_1',
    '(c) tiktok_post_id written';

  -- ================================================================
  -- (d) TikTok claim 'init' ignores platform='instagram' posts and inactive accounts
  -- ================================================================
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-ig-only', 'feed', 'agendado', 'instagram', now() - interval '1 hour')
    returning id into v_post_ig_only;

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               tiktok_caption)
    values (v_wf, v_ws, 'p-tt-valid', 'feed', 'agendado', 'tiktok', now() - interval '1 hour', 'legenda tt')
    returning id into v_post_tt_valid;

  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_u, 'Cliente B', 'CB', '#111') returning id into v_cli2;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli2, v_u, 'wf2', 'ativo') returning id into v_wf2;
  insert into tiktok_accounts (client_id, tiktok_open_id, username, authorization_status)
    values (v_cli2, 'tt_open_2', 'tt_user_2', 'expired') returning id into v_tt_acct_inactive;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf2, v_ws, 'p-tt-inactive-acct', 'feed', 'agendado', 'tiktok', now() - interval '1 hour')
    returning id into v_post_tt_inactive_acct;

  create temp table tt_claim_d on commit drop as
    select * from claim_posts_for_tiktok_publishing('init', 25);

  assert exists (select 1 from tt_claim_d where post_id = v_post_tt_valid),
    '(d) platform=tiktok post with an active account is claimed by init';
  assert not exists (select 1 from tt_claim_d where post_id = v_post_ig_only),
    '(d) platform=instagram post is ignored by the tiktok init claim';
  assert not exists (select 1 from tt_claim_d where post_id = v_post_tt_inactive_acct),
    '(d) tiktok post whose account is not active (expired) is not claimed (JOIN excludes it)';

  -- column-mapping / alias sanity for the one row we expect
  assert (select tiktok_account_id from tt_claim_d where post_id = v_post_tt_valid) = v_tt_acct,
    '(d) tiktok_account_id aliased from ta.id';
  assert (select client_id from tt_claim_d where post_id = v_post_tt_valid) = v_cli,
    '(d) client_id aliased from c.id';
  assert (select tiktok_username from tt_claim_d where post_id = v_post_tt_valid) = 'tt_user',
    '(d) tiktok_username aliased from ta.username';
  assert (select caption from tt_claim_d where post_id = v_post_tt_valid) = 'legenda tt',
    '(d) caption resolves to tiktok_caption when present';
  assert (select tiktok_publish_processing_at from workflow_posts where id = v_post_tt_valid) is not null,
    '(d) claimed row got tiktok_publish_processing_at stamped';

  -- ================================================================
  -- (e) IG claim skips a 'both' post whose instagram_media_id is already set,
  --     even in status 'agendado'/'falha_publicacao' -- the double-publish race.
  -- ================================================================
  -- 'container' phase: no container yet, but media already published (race window)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_container_id, instagram_media_id)
    values (v_wf, v_ws, 'p-guard-container', 'feed', 'agendado', 'both', now() - interval '1 hour',
            null, 'already_published_container')
    returning id into v_post_both_guard_container;

  -- 'publish' phase: container present, but media already published (race window)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_container_id, instagram_media_id)
    values (v_wf, v_ws, 'p-guard-publish', 'feed', 'agendado', 'both', now() - interval '1 hour',
            'container_x', 'already_published_publish')
    returning id into v_post_both_guard_publish;

  -- positive control: same shape as the guard-publish row, but media NOT yet set -> must still claim
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_container_id, instagram_media_id, ig_caption)
    values (v_wf, v_ws, 'p-valid-publish', 'feed', 'agendado', 'both', now() - interval '1 hour',
            'container_y', null, 'legenda ig')
    returning id into v_post_both_valid_publish;

  -- 'retry' phase: failed overall, but media already published (race window)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_media_id, publish_retry_count)
    values (v_wf, v_ws, 'p-guard-retry', 'feed', 'falha_publicacao', 'both', now() - interval '1 hour',
            'already_published_retry', 0)
    returning id into v_post_both_guard_retry;

  create temp table ig_claim_container on commit drop as
    select * from claim_posts_for_publishing('container', 25);
  assert not exists (select 1 from ig_claim_container where post_id = v_post_both_guard_container),
    '(e) container phase skips a both-post whose instagram_media_id is already set';
  assert not exists (select 1 from ig_claim_container where post_id = v_post_tt_valid),
    '(e) edit #1: a platform=tiktok-only post (no container, no media_id -- otherwise claimable) is never claimed by the IG claim RPC';

  create temp table ig_claim_publish on commit drop as
    select * from claim_posts_for_publishing('publish', 25);
  assert not exists (select 1 from ig_claim_publish where post_id = v_post_both_guard_publish),
    '(e) publish phase skips a both-post whose instagram_media_id is already set';
  assert exists (select 1 from ig_claim_publish where post_id = v_post_both_valid_publish),
    '(e) publish phase still claims a both-post with a container and no media_id yet (positive control)';
  assert (select client_id from ig_claim_publish where post_id = v_post_both_valid_publish) = v_cli,
    '(e) claim_posts_for_publishing client_id still correct after the guard edits';

  create temp table ig_claim_retry on commit drop as
    select * from claim_posts_for_publishing('retry', 25);
  assert not exists (select 1 from ig_claim_retry where post_id = v_post_both_guard_retry),
    '(e) retry phase skips a both-post whose instagram_media_id is already set';

  -- ================================================================
  -- (f) TikTok claim 'retry' requires falha_publicacao + failed + retry_count < 3
  -- ================================================================
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               tiktok_publish_status, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'p-tt-retry-valid', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour',
            'failed', 1)
    returning id into v_post_tt_retry_valid;

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               tiktok_publish_status, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'p-tt-retry-wrong-status', 'feed', 'agendado', 'tiktok', now() - interval '1 hour',
            'failed', 1)
    returning id into v_post_tt_retry_wrong_status;

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               tiktok_publish_status, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'p-tt-retry-wrong-pubstatus', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour',
            'initiated', 1)
    returning id into v_post_tt_retry_wrong_pub;

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               tiktok_publish_status, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'p-tt-retry-maxed', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour',
            'failed', 3)
    returning id into v_post_tt_retry_maxed;

  create temp table tt_claim_f on commit drop as
    select * from claim_posts_for_tiktok_publishing('retry', 25);

  assert exists (select 1 from tt_claim_f where post_id = v_post_tt_retry_valid),
    '(f) falha_publicacao + failed + retry_count<3 is claimed by retry';
  assert not exists (select 1 from tt_claim_f where post_id = v_post_tt_retry_wrong_status),
    '(f) status <> falha_publicacao is not claimed by retry';
  assert not exists (select 1 from tt_claim_f where post_id = v_post_tt_retry_wrong_pub),
    '(f) tiktok_publish_status <> failed is not claimed by retry';
  assert not exists (select 1 from tt_claim_f where post_id = v_post_tt_retry_maxed),
    '(f) tiktok_publish_retry_count not < 3 is not claimed by retry';

  raise notice 'tiktok_publishing_rpcs: all cases (a)-(f) passed';
end $$;
rollback;
