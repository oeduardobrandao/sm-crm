\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Plataformas por quadro + post_targets (migrations 20261005100001..6).
-- Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md

-- 1. Colunas plataformas: default, CHECK e allowlist de clientes
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
  v_arr text[]; v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W', 'ativo') returning id into v_wf;

  select plataformas into v_arr from workflows where id = v_wf;
  assert v_arr = array['instagram'], format('workflows.plataformas default: %s', v_arr);
  select plataformas_padrao into v_arr from clientes where id = v_cli;
  assert v_arr = array['instagram'], format('clientes.plataformas_padrao default: %s', v_arr);

  v_rejected := false;
  begin update workflows set plataformas = '{}' where id = v_wf;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflows.plataformas vazio foi aceito';

  v_rejected := false;
  begin update workflows set plataformas = array['youtube'] where id = v_wf;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflows.plataformas com youtube foi aceito';

  v_rejected := false;
  begin insert into workflow_templates (user_id, conta_id, nome, etapas, plataformas)
    values (v_uid, v_ws, 'T', '[]'::jsonb, array['instagram','x']);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflow_templates.plataformas invalido foi aceito';

  update workflows set plataformas = array['instagram','geral'] where id = v_wf;

  -- authenticated le a coluna nova direto e pela view
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select plataformas_padrao into v_arr from clientes where id = v_cli;
  assert v_arr = array['instagram'], 'authenticated nao le clientes.plataformas_padrao';
  select plataformas_padrao into v_arr from clientes_v where id = v_cli;
  assert v_arr = array['instagram'], 'clientes_v nao expoe plataformas_padrao';
end $$;
rollback;

-- 2. Seed a partir do quadro, filtro de formato e platform derivado
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_cli_geral bigint;
  v_wf_ig bigint; v_wf_geral bigint; v_wf_mix bigint;
  v_p bigint; v_arr text[]; v_plat text;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor, plataformas_padrao)
    values (v_uid, v_ws, 'G', 'G', '#000', array['geral']) returning id into v_cli_geral;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'IG', 'ativo') returning id into v_wf_ig;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli_geral, 'Geral', 'ativo', array['geral']) returning id into v_wf_geral;
  -- terceiro cliente só para o quadro misto (não é limite de plano: 'start' permite 5 fluxos ativos por cliente)
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'M', 'M', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'Mix', 'ativo', array['instagram','tiktok','geral'])
    returning id into v_wf_mix;

  -- quadro só Instagram: igual a hoje
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_ig, v_ws, 'a', 'feed') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['instagram'] and v_plat = 'instagram',
    format('quadro IG: %s / %s', v_arr, v_plat);

  -- quadro só Geral: platform vira other
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_geral, v_ws, 'b', 'reels') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral'] and v_plat = 'other',
    format('quadro Geral: %s / %s', v_arr, v_plat);

  -- quadro misto, reels: três destinos, platform both
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_mix, v_ws, 'c', 'reels') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram','tiktok'] and v_plat = 'both',
    format('quadro misto reels: %s / %s', v_arr, v_plat);

  -- quadro misto, stories: TikTok não tem stories
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_mix, v_ws, 'd', 'stories') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('quadro misto stories: %s / %s', v_arr, v_plat);

  -- platform explícito manda na parte social (legado: testes e MCP que gravam platform)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf_ig, v_ws, 'e', 'reels', 'tiktok') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  assert v_arr = array['tiktok'], format('platform explicito: %s', v_arr);

  -- avulso usa clientes.plataformas_padrao
  insert into workflow_posts (workflow_id, cliente_id, conta_id, titulo, tipo)
    values (null, v_cli_geral, v_ws, 'f', 'feed') returning id into v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral'] and v_plat = 'other', format('avulso geral: %s / %s', v_arr, v_plat);

  -- RETURNING do insert já traz o platform derivado (z4b é BEFORE INSERT)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_geral, v_ws, 'g', 'feed') returning platform into v_plat;
  assert v_plat = 'other', format('RETURNING platform: %s', v_plat);

  -- reels misto vira stories: TikTok sai, platform vira instagram
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_mix, v_ws, 'h', 'reels') returning id into v_p;
  update workflow_posts set tipo = 'stories' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('reels->stories misto: %s / %s', v_arr, v_plat);
end $$;
rollback;

-- 3. Escrita legada em workflow_posts.platform e escrita direta em post_targets
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint; v_wf_tt bigint;
  v_p bigint; v_p2 bigint; v_arr text[]; v_plat text; v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'W', 'ativo', array['instagram','geral']) returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf, v_ws, 'a', 'reels') returning id into v_p;

  -- PlatformSelector grava tiktok: IG sai, TikTok entra, Geral fica
  update workflow_posts set platform = 'tiktok' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','tiktok'] and v_plat = 'tiktok', format('-> tiktok: %s / %s', v_arr, v_plat);

  update workflow_posts set platform = 'both' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  assert v_arr = array['geral','instagram','tiktok'], format('-> both: %s', v_arr);

  update workflow_posts set platform = 'other' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral'] and v_plat = 'other', format('-> other: %s / %s', v_arr, v_plat);

  -- escrita direta em post_targets deriva platform
  insert into post_targets (conta_id, post_id, platform) values (v_ws, v_p, 'instagram');
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_plat = 'instagram', format('insert target ig: %s', v_plat);
  delete from post_targets where post_id = v_p and platform = 'instagram';
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_plat = 'other', format('delete target ig: %s', v_plat);

  -- 'both' legado num post de stories: TikTok não entra
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf, v_ws, 's', 'stories') returning id into v_p2;
  update workflow_posts set platform = 'both' where id = v_p2;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p2;
  select platform into v_plat from workflow_posts where id = v_p2;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('both em stories: %s / %s', v_arr, v_plat);

  -- quadro só TikTok: reels vira stories -> other; o auto-reparo do
  -- PlatformSelector grava 'instagram' e NÃO pode criar destino Instagram
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'T', 'T', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'TT', 'ativo', array['tiktok']) returning id into v_wf_tt;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_tt, v_ws, 't', 'reels') returning id into v_p2;
  select platform into v_plat from workflow_posts where id = v_p2;
  assert v_plat = 'tiktok', format('quadro TikTok: %s', v_plat);
  update workflow_posts set tipo = 'stories' where id = v_p2;
  select platform into v_plat from workflow_posts where id = v_p2;
  assert v_plat = 'other', format('TikTok->stories: %s', v_plat);
  update workflow_posts set platform = 'instagram' where id = v_p2;
  select platform into v_plat from workflow_posts where id = v_p2;
  assert v_plat = 'other', format('auto-reparo criou Instagram em quadro TikTok: %s', v_plat);
  assert not exists (select 1 from post_targets where post_id = v_p2), 'destino criado em quadro TikTok + stories';

  -- CHECKs
  v_rejected := false;
  begin insert into post_targets (conta_id, post_id, platform) values (v_ws, v_p, 'youtube');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'post_targets.platform youtube foi aceito';

  v_rejected := false;
  begin update post_targets set status = 'x' where post_id = v_p;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'post_targets.status invalido foi aceito';

  -- a2 deixa valor fora do domínio intacto; a CHECK recusa e o statement volta inteiro
  v_rejected := false;
  begin update workflow_posts set platform = 'geral' where id = v_p;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflow_posts.platform geral foi aceito (so other e valido)';

  -- post apagado leva os destinos
  delete from workflow_posts where id = v_p;
  assert not exists (select 1 from post_targets where post_id = v_p), 'destinos sobreviveram ao post';
end $$;
rollback;

-- 4. RLS e ACL de post_targets
begin;
-- post_targets fora da parity: o helper daria ALL (TRUNCATE incluso) e desfaria o REVOKE sob teste.
select et_grant_hosted_parity(array['post_targets']);
do $$
declare
  v_ws_a uuid; v_ws_b uuid; v_uid uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint; v_wf_a bigint; v_wf_b bigint; v_p_a bigint; v_p_b bigint;
  v_n int; v_rows int; v_rejected boolean;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws_a, 'owner'), (v_uid, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_uid, v_ws_a, v_cli_a, 'A', 'ativo') returning id into v_wf_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_uid, v_ws_b, v_cli_b, 'B', 'ativo') returning id into v_wf_b;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_a, v_ws_a, 'a') returning id into v_p_a;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_b, v_ws_b, 'b') returning id into v_p_b;

  assert not has_table_privilege('authenticated', 'public.post_targets', 'TRUNCATE'),
    'authenticated tem TRUNCATE em post_targets';
  assert not has_table_privilege('anon', 'public.post_targets', 'SELECT'),
    'anon le post_targets';
  assert not has_function_privilege('authenticated', 'public.post_targets_seed()', 'EXECUTE'),
    'authenticated executa post_targets_seed';
  assert not has_function_privilege('anon', 'public.workflow_posts_platform_to_targets()', 'EXECUTE'),
    'anon executa workflow_posts_platform_to_targets';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_n from post_targets;
  assert v_n = 1, format('esperava 1 destino visivel, veio %s', v_n);

  update post_targets set caption = 'x' where conta_id = v_ws_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'atualizou destino de outro workspace';

  v_rejected := false;
  begin insert into post_targets (conta_id, post_id, platform) values (v_ws_b, v_p_b, 'geral');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'inseriu destino com conta_id de outro workspace';

  -- post de B com conta_id de A: FK composta barra
  v_rejected := false;
  begin insert into post_targets (conta_id, post_id, platform) values (v_ws_a, v_p_b, 'geral');
  exception when foreign_key_violation then v_rejected := true; end;
  assert v_rejected, 'destino apontando post de outro workspace foi aceito';

  -- escrita no proprio workspace funciona (e deriva platform como authenticated)
  insert into post_targets (conta_id, post_id, platform) values (v_ws_a, v_p_a, 'geral');
end $$;
rollback;

-- 5. Automacoes de comentario do Instagram: post so Geral (platform 'other')
--    nao e alvo (migration 20261005100003)
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
  v_p bigint; v_auto uuid; v_plat text; v_rejected boolean;
  v_marked int; v_cleared int; v_stamp timestamptz;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'Geral', 'ativo', array['geral']) returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf, v_ws, 'So Geral', 'feed') returning id, platform into v_p, v_plat;
  assert v_plat = 'other', format('post de quadro geral deveria ser other, veio %s', v_plat);

  -- resolver: post other nao e alvo de automacao do Instagram
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
      values (v_ws, v_cli, 'Geral', array['x'], 'y', v_p);
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%must be an instagram post%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'post so Geral (other) nao pode ser alvo de automacao do Instagram';

  -- reconcile: post other 'postado' sem media NAO e orfao do Instagram
  alter table instagram_comment_automations disable trigger ica_a1_resolve_workflow_post_target;
  update workflow_posts set status = 'postado', published_at = now() where id = v_p;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ativo)
    values (v_ws, v_cli, 'Pendente other', array['x'], 'y', v_p, true) returning id into v_auto;
  alter table instagram_comment_automations enable trigger ica_a1_resolve_workflow_post_target;

  select marked, cleared into v_marked, v_cleared from reconcile_unlinked_automation_targets();
  select target_unlinked_at into v_stamp from instagram_comment_automations where id = v_auto;
  assert v_stamp is null, 'reconcile carimbou automacao cujo post e other (nao e post do Instagram)';
end $$;
rollback;

-- 6. Post Express é sempre Instagram, qualquer que seja o padrão do cliente
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli_g bigint; v_cli_t bigint;
  v_p bigint; v_arr text[]; v_plat text;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor, plataformas_padrao)
    values (v_uid, v_ws, 'G', 'G', '#000', array['geral']) returning id into v_cli_g;
  insert into clientes (user_id, conta_id, nome, sigla, cor, plataformas_padrao)
    values (v_uid, v_ws, 'T', 'T', '#000', array['tiktok']) returning id into v_cli_t;

  insert into workflow_posts (workflow_id, cliente_id, conta_id, titulo, tipo, is_express)
    values (null, v_cli_g, v_ws, 'x', 'feed', true) returning id, platform into v_p, v_plat;
  assert v_plat = 'instagram', format('express em cliente geral (RETURNING): %s', v_plat);
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['instagram'] and v_plat = 'instagram',
    format('express em cliente geral: %s / %s', v_arr, v_plat);

  insert into workflow_posts (workflow_id, cliente_id, conta_id, titulo, tipo, is_express)
    values (null, v_cli_t, v_ws, 'y', 'feed', true) returning id, platform into v_p, v_plat;
  assert v_plat = 'instagram', format('express em cliente tiktok (RETURNING): %s', v_plat);
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['instagram'] and v_plat = 'instagram',
    format('express em cliente tiktok: %s / %s', v_arr, v_plat);

  -- avulso comum do mesmo cliente segue o padrão (controle)
  insert into workflow_posts (workflow_id, cliente_id, conta_id, titulo, tipo)
    values (null, v_cli_t, v_ws, 'z', 'feed') returning platform into v_plat;
  assert v_plat = 'tiktok', format('avulso comum em cliente tiktok: %s', v_plat);
end $$;
rollback;

-- 7. Escrita legada que deixaria o post sem Instagram/TikTok não faz nada
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf_tt bigint; v_wf_ig bigint;
  v_p bigint; v_arr text[]; v_plat text;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'TT', 'ativo', array['tiktok','geral']) returning id into v_wf_tt;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'IG', 'ativo', array['instagram','geral']) returning id into v_wf_ig;

  -- quadro TikTok, usuário escolhe Instagram: Instagram é recusado e o TikTok fica
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_tt, v_ws, 'a', 'reels') returning id into v_p;
  update workflow_posts set platform = 'instagram' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','tiktok'] and v_plat = 'tiktok',
    format('quadro TikTok -> instagram: %s / %s', v_arr, v_plat);

  -- stories com Instagram, usuário escolhe TikTok: TikTok não tem stories, Instagram fica
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_ig, v_ws, 'b', 'stories') returning id into v_p;
  update workflow_posts set platform = 'tiktok' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('stories -> tiktok: %s / %s', v_arr, v_plat);
end $$;
rollback;

-- 8. Mudar de quadro sem Instagram/TikTok ganha os destinos sociais do quadro novo
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint;
  v_wf_geral bigint; v_wf_ig bigint; v_wf_tt bigint;
  v_p bigint; v_arr text[]; v_plat text;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor, plataformas_padrao)
    values (v_uid, v_ws, 'C', 'C', '#000', array['geral']) returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'Geral', 'ativo', array['geral']) returning id into v_wf_geral;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'IG', 'ativo', array['instagram']) returning id into v_wf_ig;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'TT', 'ativo', array['tiktok']) returning id into v_wf_tt;

  -- post só Geral vai para quadro Instagram: ganha Instagram, Geral fica
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_geral, v_ws, 'a', 'feed') returning id into v_p;
  perform set_config('app.allow_post_move', 'on', true);
  update workflow_posts set workflow_id = v_wf_ig where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('geral -> quadro IG: %s / %s', v_arr, v_plat);

  -- post com Instagram vai para quadro TikTok: nada muda (mover nunca tira destino)
  update workflow_posts set workflow_id = v_wf_tt where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('IG -> quadro TikTok: %s / %s', v_arr, v_plat);

  -- avulso só Geral anexado a quadro Instagram
  insert into workflow_posts (workflow_id, cliente_id, conta_id, titulo, tipo)
    values (null, v_cli, v_ws, 'b', 'feed') returning id into v_p;
  update workflow_posts set workflow_id = v_wf_ig where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('avulso geral -> quadro IG: %s / %s', v_arr, v_plat);

  -- stories só Geral vai para quadro TikTok: TikTok não tem stories, segue other
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_geral, v_ws, 'c', 'stories') returning id into v_p;
  update workflow_posts set workflow_id = v_wf_tt where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral'] and v_plat = 'other',
    format('stories geral -> quadro TikTok: %s / %s', v_arr, v_plat);

  -- reels só Geral vai para quadro TikTok: ganha TikTok
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_geral, v_ws, 'd', 'reels') returning id into v_p;
  update workflow_posts set workflow_id = v_wf_tt where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral','tiktok'] and v_plat = 'tiktok',
    format('reels geral -> quadro TikTok: %s / %s', v_arr, v_plat);
end $$;
rollback;

-- 9. Destino que troca de post recalcula platform dos dois posts
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf_ig bigint; v_wf_geral bigint;
  v_a bigint; v_b bigint; v_plat text;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'IG', 'ativo') returning id into v_wf_ig;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'Geral', 'ativo', array['geral']) returning id into v_wf_geral;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_ig, v_ws, 'a', 'feed') returning id into v_a;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_geral, v_ws, 'b', 'feed') returning id into v_b;

  update post_targets set post_id = v_b where post_id = v_a and platform = 'instagram';
  select platform into v_plat from workflow_posts where id = v_a;
  assert v_plat = 'other', format('post que perdeu o destino: %s', v_plat);
  select platform into v_plat from workflow_posts where id = v_b;
  assert v_plat = 'instagram', format('post que ganhou o destino: %s', v_plat);
end $$;
rollback;

-- 10. move_posts_to_new_flow: o fluxo novo herda plataformas da origem, então
-- um post só Geral não ganha Instagram pelo z8 (quadro novo nascia {instagram})
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf_geral bigint;
  v_p bigint; v_res jsonb; v_new_wf bigint; v_arr text[]; v_plat text; v_board text[];
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor, plataformas_padrao)
    values (v_uid, v_ws, 'C', 'C', '#000', array['geral']) returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'Geral', 'ativo', array['geral']) returning id into v_wf_geral;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias)
    values (v_wf_geral, 0, 'Unica', 1);
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_geral, v_ws, 'a', 'feed') returning id into v_p;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  v_res := move_posts_to_new_flow(array[v_p], v_wf_geral, 'Novo', 0);
  v_new_wf := (v_res->>'target_workflow_id')::bigint;

  select plataformas into v_board from workflows where id = v_new_wf;
  assert v_board = array['geral'], format('plataformas do fluxo novo: %s', v_board);
  assert (v_res->'workflow'->'plataformas') = '["geral"]'::jsonb,
    format('workflow no retorno: %s', v_res->'workflow'->'plataformas');
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['geral'] and v_plat = 'other',
    format('post geral movido para fluxo novo: %s / %s', v_arr, v_plat);
end $$;
rollback;

-- 11. Post Express ignora a escrita legada de platform (é sempre Instagram)
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint;
  v_p bigint; v_arr text[]; v_plat text;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (workflow_id, cliente_id, conta_id, titulo, tipo, is_express)
    values (null, v_cli, v_ws, 'x', 'feed', true) returning id into v_p;

  update workflow_posts set platform = 'tiktok' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['instagram'] and v_plat = 'instagram',
    format('express -> tiktok: %s / %s', v_arr, v_plat);

  update workflow_posts set platform = 'both' where id = v_p;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_p;
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_arr = array['instagram'] and v_plat = 'instagram',
    format('express -> both: %s / %s', v_arr, v_plat);
end $$;
rollback;

-- 12. duplicate_workflow (20261002000021 -> 20261005100005): a cópia herda as
-- plataformas do quadro. Antes nascia {instagram} e o post só Geral copiado
-- ficava sem destino nenhum (platform 'other' não semeia social, e o quadro
-- {instagram} não tem Geral).
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
  v_p bigint; v_new_wf bigint; v_clone bigint; v_arr text[]; v_plat text; v_board text[];
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor, plataformas_padrao)
    values (v_uid, v_ws, 'C', 'C', '#000', array['geral']) returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'Geral', 'ativo', array['geral']) returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf, v_ws, 'a', 'feed') returning id into v_p;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_new_wf := duplicate_workflow(v_wf, false);

  select plataformas into v_board from workflows where id = v_new_wf;
  assert v_board = array['geral'], format('plataformas da cópia do fluxo: %s', v_board);
  select id into v_clone from workflow_posts where workflow_id = v_new_wf;
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_clone;
  select platform into v_plat from workflow_posts where id = v_clone;
  assert v_arr = array['geral'] and v_plat = 'other',
    format('post geral na cópia do fluxo: %s / %s', v_arr, v_plat);
  raise notice 'PASS 99pt.12';
end $$;
rollback;

-- 13. _clone_post_row (20261002000020 -> 20261005100006): a cópia de um post
-- (duplicate_post e cada post de duplicate_workflow) tem os MESMOS destinos da
-- origem, com o formato, e não os padrões do quadro. Estado de publicação,
-- ids externos e legenda do destino não são copiados.
begin;
select et_grant_hosted_parity();
do $$
declare v_missing text;
begin
  -- Guarda de colunas. Se falhar: a coluna nova de post_targets precisa entrar
  -- em _clone_post_row (copiar ou deixar no default de propósito) E aqui.
  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'post_targets'
     and column_name not in (
       -- copiadas
       'platform','format',
       -- definidas pela cópia
       'conta_id','post_id',
       -- default de propósito (publicação, ids externos, conteúdo por destino)
       'caption','title','settings','scheduled_at','status','external_id',
       'permalink','error','error_code','retry_count','processing_at','published_at',
       -- geradas pelo banco
       'id','created_at','updated_at');
  assert v_missing is null, format('post_targets tem coluna nao classificada em _clone_post_row: %s', v_missing);
end $$;
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_cli2 bigint;
  v_wf_ig bigint; v_wf_mix bigint;
  v_a bigint; v_b bigint; v_c bigint; v_clone bigint; v_new_wf bigint;
  v_arr text[]; v_plat text; r record;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'D', 'D', '#000') returning id into v_cli2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'IG', 'ativo') returning id into v_wf_ig;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli2, 'Mix', 'ativo', array['instagram','geral']) returning id into v_wf_mix;

  -- A: quadro só Instagram com um destino Geral a mais (fora da lista do quadro),
  -- formato no destino Instagram e estado de publicação que não pode ir junto.
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_ig, v_ws, 'a', 'feed') returning id into v_a;
  insert into post_targets (conta_id, post_id, platform, caption)
    values (v_ws, v_a, 'geral', 'legenda geral');
  update post_targets
     set format = 'reels', status = 'publicado', external_id = 'ext-1',
         permalink = 'https://x/1', published_at = now()
   where post_id = v_a and platform = 'instagram';

  -- B: quadro Instagram+Geral, post legado sem o destino Geral.
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_mix, v_ws, 'b', 'feed') returning id into v_b;
  delete from post_targets where post_id = v_b and platform = 'geral';

  -- C: quadro só Instagram, post com TikTok pelo seletor legado.
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf_ig, v_ws, 'c', 'feed') returning id into v_c;
  update workflow_posts set platform = 'both' where id = v_c;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- duplicate_post A: mantém Geral; formato copiado; publicação não
  v_clone := duplicate_post(v_a, false);
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_clone;
  select platform into v_plat from workflow_posts where id = v_clone;
  assert v_arr = array['geral','instagram'] and v_plat = 'instagram',
    format('duplicate_post com Geral extra: %s / %s', v_arr, v_plat);
  select * into r from post_targets where post_id = v_clone and platform = 'instagram';
  assert r.format = 'reels', format('formato do destino: %s', r.format);
  assert r.status = 'pendente' and r.external_id is null and r.permalink is null
     and r.published_at is null,
    format('estado de publicação copiado: %s / %s', r.status, r.external_id);
  select * into r from post_targets where post_id = v_clone and platform = 'geral';
  assert r.caption is null, format('legenda do destino copiada: %s', r.caption);

  -- duplicate_post B: não ganha o Geral do quadro
  v_clone := duplicate_post(v_b, false);
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_clone;
  assert v_arr = array['instagram'], format('duplicate_post sem Geral: %s', v_arr);

  -- duplicate_post C: mantém TikTok
  v_clone := duplicate_post(v_c, false);
  select array_agg(platform order by platform) into v_arr from post_targets where post_id = v_clone;
  select platform into v_plat from workflow_posts where id = v_clone;
  assert v_arr = array['instagram','tiktok'] and v_plat = 'both',
    format('duplicate_post com TikTok: %s / %s', v_arr, v_plat);

  -- duplicate_workflow: cada post copiado mantém os destinos da origem
  v_new_wf := duplicate_workflow(v_wf_ig, false);
  select array_agg(t.platform order by t.platform) into v_arr
    from post_targets t join workflow_posts wp on wp.id = t.post_id
   where wp.workflow_id = v_new_wf and wp.titulo = 'a';
  assert v_arr = array['geral','instagram'], format('duplicate_workflow, post A: %s', v_arr);
  raise notice 'PASS 99pt.13';
end $$;
rollback;
