\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint; v_post bigint; v_s text;
begin
  v_ws := et_make_workspace('pro');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W', 'ativo') returning id into v_wf;

  -- reels + instagram keeps the flag
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform, ig_trial_strategy)
    values (v_wf, v_ws, 'P', 'reels', 'instagram', 'auto') returning id into v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s = 'auto', format('flag must survive on reels+instagram, got %s', v_s);

  -- tipo leaves reels => trigger clears it on the SAME update
  update workflow_posts set tipo = 'carrossel' where id = v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s is null, 'flag must clear when tipo leaves reels';

  -- reels + both keeps it
  update workflow_posts set tipo = 'reels', platform = 'both', ig_trial_strategy = 'manual'
    where id = v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s = 'manual', 'flag must survive on reels+both';

  -- platform tiktok-only clears it
  update workflow_posts set platform = 'tiktok' where id = v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s is null, 'flag must clear on tiktok-only';

  -- insert on a non-reels tipo is cleared at insert
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, ig_trial_strategy)
    values (v_wf, v_ws, 'P2', 'feed', 'auto') returning id into v_post;
  select ig_trial_strategy into v_s from workflow_posts where id = v_post;
  assert v_s is null, 'flag must clear at insert on non-reels tipo';

  raise notice 'PASS 30_ig_trial_strategy';
end $$;
rollback;
