\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Plataformas por quadro + post_targets (migrations 20260929100001..3).
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
