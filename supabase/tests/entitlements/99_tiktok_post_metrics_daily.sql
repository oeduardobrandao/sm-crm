\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Historico diario por video do TikTok (migration 20261103000001).
-- (a) authenticated e anon: permission denied em SELECT e INSERT;
-- (b) service_role insere e le;
-- (c) apagar o tiktok_posts da conta NAO apaga o historico (sem FK, chave e o video id);
-- (d) apagar a conta (tiktok_accounts) apaga o historico (ON DELETE CASCADE).
begin;
-- A tabela sob teste e excluida: a parity grant concederia ALL a anon/authenticated
-- e desfaria o REVOKE da migration. Ver doc de p_exclude em _helpers.sql.
select et_grant_hosted_parity(array['tiktok_post_metrics_daily']);
do $$
declare
  v_ws       uuid;
  v_u        uuid := gen_random_uuid();
  v_cli      bigint;
  v_acct     uuid;
  v_n        int;
  v_views    bigint;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_u) on conflict do nothing;
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_u, 'Cliente TT', 'CT', '#000') returning id into v_cli;
  insert into tiktok_accounts (client_id, tiktok_open_id, username)
    values (v_cli, 'tt_open_hist', 'tt_hist') returning id into v_acct;
  insert into tiktok_posts (tiktok_account_id, tiktok_video_id, title, posted_at)
    values (v_acct, 'vid-1', 'Video 1', now());

  -- O REVOKE da migration, checado direto no ACL.
  assert not has_table_privilege('authenticated', 'public.tiktok_post_metrics_daily', 'SELECT'),
    'authenticated tem SELECT em tiktok_post_metrics_daily';
  assert not has_table_privilege('authenticated', 'public.tiktok_post_metrics_daily', 'INSERT'),
    'authenticated tem INSERT em tiktok_post_metrics_daily';
  assert not has_table_privilege('anon', 'public.tiktok_post_metrics_daily', 'SELECT'),
    'anon tem SELECT em tiktok_post_metrics_daily';
  assert not has_table_privilege('anon', 'public.tiktok_post_metrics_daily', 'INSERT'),
    'anon tem INSERT em tiktok_post_metrics_daily';

  -- ---- (a) authenticated e anon: permission denied de fato ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    perform 1 from tiktok_post_metrics_daily;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated conseguiu SELECT';

  v_rejected := false;
  begin
    insert into tiktok_post_metrics_daily (tiktok_account_id, tiktok_video_id, snapshot_date, views)
      values (v_acct, 'vid-1', current_date, 1);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated conseguiu INSERT';

  execute 'reset role';
  execute 'set local role anon';

  v_rejected := false;
  begin
    perform 1 from tiktok_post_metrics_daily;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'anon conseguiu SELECT';

  v_rejected := false;
  begin
    insert into tiktok_post_metrics_daily (tiktok_account_id, tiktok_video_id, snapshot_date, views)
      values (v_acct, 'vid-1', current_date, 1);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'anon conseguiu INSERT';

  execute 'reset role';

  -- ---- (b) service_role insere e le ----
  execute 'set local role service_role';

  insert into tiktok_post_metrics_daily
    (tiktok_account_id, tiktok_video_id, snapshot_date, views, likes, comments, shares)
    values (v_acct, 'vid-1', date '2026-10-27', 5000000000, 10, 2, 1),
           (v_acct, 'vid-1', date '2026-10-28', 5000000100, 11, 2, 1);
  select count(*) into v_n from tiktok_post_metrics_daily where tiktok_account_id = v_acct;
  assert v_n = 2, format('service_role deveria ler 2 linhas, leu %s', v_n);
  select views into v_views from tiktok_post_metrics_daily
    where tiktok_account_id = v_acct and snapshot_date = date '2026-10-28';
  assert v_views = 5000000100, 'views e bigint (valor acima de int4 deveria caber)';

  -- chave primaria: mesmo video no mesmo dia nao duplica
  v_rejected := false;
  begin
    insert into tiktok_post_metrics_daily (tiktok_account_id, tiktok_video_id, snapshot_date, views)
      values (v_acct, 'vid-1', date '2026-10-28', 1);
  exception when unique_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'PK (conta, video, dia) nao barrou duplicata';

  execute 'reset role';

  -- ---- (c) apagar o tiktok_posts mantem o historico ----
  delete from tiktok_posts where tiktok_account_id = v_acct;
  select count(*) into v_n from tiktok_post_metrics_daily where tiktok_account_id = v_acct;
  assert v_n = 2, format('historico deveria sobreviver ao delete de tiktok_posts, restaram %s', v_n);

  -- ---- (d) apagar a conta apaga o historico ----
  delete from tiktok_accounts where id = v_acct;
  select count(*) into v_n from tiktok_post_metrics_daily where tiktok_account_id = v_acct;
  assert v_n = 0, format('historico deveria sumir com a conta, restaram %s', v_n);
end;
$$;
rollback;
