\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Alvo "post em producao" das automacoes de comentario -> DM
-- (migrations 20260820000002 e 20260820000003).
--
-- O que esta sob teste e a maquina de estados do alvo:
--
--   Todos os posts   ig_media_id NULL  workflow_post_id NULL  tombstone NULL
--   Especifico pub.  ig_media_id set   workflow_post_id NULL  tombstone NULL
--   Pendente         ig_media_id NULL  workflow_post_id set   tombstone NULL
--   Ligado           ig_media_id set   workflow_post_id set   tombstone NULL
--   Tombstone        ig_media_id NULL  workflow_post_id NULL  tombstone set
--
-- 1.  Alvo de outro workspace: barrado pelo resolver E, independentemente
--     dele, pela FK composta ica_workflow_post_same_tenant (o teste desliga o
--     trigger para provar que a garantia e estrutural, nao so de trigger --
--     mesmo espirito da secao 4 da suite 65).
-- 2-4. Resolver: cliente errado (mesmo workspace), post so-TikTok e post de
--     stories sao rejeitados. A validacao dura vale para escrita DIRIGIDA PELO
--     USUARIO -- INSERT, ou UPDATE que mexe em workflow_post_id/client_id --,
--     o que cobre o INSERT com ambos os campos e a troca de client_id no
--     estado Ligado (ver secao 10 para o outro lado dessa regra).
-- 5-6. Vinculo: post que ja publicou preenche ig_media_id no proprio INSERT;
--     post que publica depois e ligado pelo z3, com o permalink chegando num
--     segundo UPDATE e um record_post_status_change posterior nao corrompendo
--     nada (o WHEN do z3 e o que segura isso).
-- 7-8. DELETE do post: pendente vira tombstone (desativado, sem alvo, sem
--     virar "todos os posts"); ligado sobrevive intacto.
-- 8b. Sobras uuid: o UPDATE one-shot da 20260820000002 (o mesmo predicado
--     regex, replicado aqui porque a migration ja rodou antes do teste).
-- 9.  sweep_pending_instagram_automation_links: rede de seguranca do cron para
--     a janela MVCC em que o z3 nao enxergou a automacao.
-- 10. DERIVA DE ALVO (regressao): o alvo pode virar invalido DEPOIS de
--     escolhido -- post vira stories, post vira so-TikTok, workflow e movido
--     para outro cliente. Como o z3 e o z4 escrevem na tabela de automacoes,
--     um RAISE do resolver nesses caminhos derrubaria o DELETE do post e a
--     PUBLICACAO. A regra: operacao do sistema nunca aborta por deriva, so
--     deixa de ligar; a automacao fica pendente ou vira tombstone.
-- 11. A CHECK ica_tombstone_inactive olha so o estado final da linha: sem a
--     guarda do resolver, UM write limparia o tombstone e ativaria de uma vez,
--     virando automacao GLOBAL ativa. Dois passos (e o write que ja traz alvo
--     novo) continuam valendo.
-- 12. O tombstone do z4 e SECURITY DEFINER: vale ate para um agent, que pela
--     RLS nem consegue dar UPDATE na automacao.
--
-- Tudo roda como dono da tabela, o mesmo stand-in do worker service-role usado
-- nas secoes 4 e 6 da suite 65: FK, CHECK e triggers nao dependem do papel.
-- A flag feature_instagram_automation nasce false em todo plano (ship dark),
-- entao "flag on" aqui e sempre um workspace_plan_overrides explicito.

-- 1. Alvo em outro workspace: resolver E FK composta
begin;
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_uid uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_wf_b bigint; v_post_b bigint;
  v_rejected boolean;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values
    (v_ws_a, '{"feature_instagram_automation": true}'::jsonb),
    (v_ws_b, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws_b, v_cli_b, 'WF B', 'ativo') returning id into v_wf_b;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_b, v_ws_b, 'Post B') returning id into v_post_b;

  -- (a) com o resolver ativo a mensagem e a dele: o SELECT filtra por conta_id
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
      values (v_ws_a, v_cli_a, 'Cross ws', array['x'], 'y', v_post_b);
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%not found in workspace%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'alvo de outro workspace deve ser rejeitado pelo resolver';

  -- (b) sem o resolver, a FK composta sozinha ainda rejeita
  alter table instagram_comment_automations disable trigger ica_a1_resolve_workflow_post_target;
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
      values (v_ws_a, v_cli_a, 'Cross ws sem trigger', array['x'], 'y', v_post_b);
  exception when foreign_key_violation then
    v_rejected := true;
  end;
  alter table instagram_comment_automations enable trigger ica_a1_resolve_workflow_post_target;
  assert v_rejected, 'ica_workflow_post_same_tenant deve rejeitar alvo de outro workspace';

  raise notice 'PASS 66 alvo cross-workspace (resolver + FK composta)';
end $$;
rollback;

-- 2-4. Resolver: cliente errado, tiktok-only, stories; e revalidacao no estado
--      Ligado (UPDATE so de client_id) e no INSERT com ambos preenchidos.
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli1 bigint; v_cli2 bigint;
  v_wf1 bigint; v_wf2 bigint;
  v_post bigint; v_post_tt bigint; v_post_st bigint; v_post_c2 bigint;
  v_post_pub bigint;
  v_auto uuid;
  v_rejected boolean;
  v_target bigint;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C1', 'C1', '#000') returning id into v_cli1;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C2', 'C2', '#000') returning id into v_cli2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli1, 'WF 1', 'ativo') returning id into v_wf1;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli2, 'WF 2', 'ativo') returning id into v_wf2;

  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf1, v_ws, 'Feed C1') returning id into v_post;
  insert into workflow_posts (workflow_id, conta_id, titulo, platform)
    values (v_wf1, v_ws, 'TikTok C1', 'tiktok') returning id into v_post_tt;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf1, v_ws, 'Stories C1', 'stories') returning id into v_post_st;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf2, v_ws, 'Feed C2') returning id into v_post_c2;
  insert into workflow_posts (workflow_id, conta_id, titulo, instagram_media_id)
    values (v_wf1, v_ws, 'Feed C1 publicado', 'IG-PUB-1') returning id into v_post_pub;

  -- 2. post de OUTRO cliente do mesmo workspace (a FK composta nao pega isso)
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
      values (v_ws, v_cli1, 'Cliente errado', array['x'], 'y', v_post_c2);
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%belongs to another client%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'post de outro cliente do mesmo workspace deve ser rejeitado';

  -- 3. tiktok-only e stories
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
      values (v_ws, v_cli1, 'TikTok', array['x'], 'y', v_post_tt);
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%tiktok-only post%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'post so-TikTok nao pode ser alvo de automacao do Instagram';

  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
      values (v_ws, v_cli1, 'Stories', array['x'], 'y', v_post_st);
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%stories post%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'post de stories nao pode ser alvo (sem comentarios)';

  -- alvo valido (pendente) para as revalidacoes abaixo
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli1, 'Valida', array['preco'], 'link no DM', v_post)
    returning id into v_auto;
  select workflow_post_id into v_target from instagram_comment_automations where id = v_auto;
  assert v_target = v_post, 'alvo valido deve persistir';

  -- 4. estado Ligado: UPDATE so de client_id revalida contra o post e rejeita
  update instagram_comment_automations set ig_media_id = 'IG-LIGADO'
    where id = v_auto; -- passa pelo resolver: post do cliente certo
  v_rejected := false;
  begin
    update instagram_comment_automations set client_id = v_cli2 where id = v_auto;
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%belongs to another client%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'trocar client_id com alvo ligado deve revalidar e rejeitar';

  -- 4b. INSERT com workflow_post_id E ig_media_id: valida do mesmo jeito
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ig_media_id)
    values (v_ws, v_cli1, 'Ligada na criacao', array['x'], 'y', v_post_pub, 'IG-PUB-1');

  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ig_media_id)
      values (v_ws, v_cli1, 'Ligada errada', array['x'], 'y', v_post_c2, 'IG-QUALQUER');
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%belongs to another client%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'INSERT ligado com post de outro cliente deve ser rejeitado';

  raise notice 'PASS 66 resolver (cliente, plataforma, tipo) + revalidacao no estado Ligado';
end $$;
rollback;

-- 5-6. Preenchimento imediato, ligacao na publicacao (z3) e permalink em
--      segundo UPDATE; mudanca de status posterior nao corrompe nada.
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint;
  v_post_pub bigint; v_post bigint;
  v_auto_pub uuid; v_auto uuid;
  v_a record;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;

  -- 5. post que JA publicou: o resolver preenche ig_media_id no proprio INSERT
  insert into workflow_posts
    (workflow_id, conta_id, titulo, instagram_media_id, instagram_permalink)
    values (v_wf, v_ws, 'Ja publicado', 'IG-JA-1', 'https://instagram.com/p/ja1')
    returning id into v_post_pub;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'Sobre o publicado', array['preco'], 'link no DM', v_post_pub)
    returning id into v_auto_pub;

  select * into v_a from instagram_comment_automations where id = v_auto_pub;
  assert v_a.ig_media_id = 'IG-JA-1',
    format('resolver deve preencher ig_media_id na hora, got %s', v_a.ig_media_id);
  assert v_a.media_permalink = 'https://instagram.com/p/ja1',
    format('resolver deve preencher o permalink, got %s', v_a.media_permalink);

  -- 6. post em producao: pendente ate publicar
  insert into workflow_posts (workflow_id, conta_id, titulo, ig_caption, status)
    values (v_wf, v_ws, 'Em producao', 'Legenda do post', 'aprovado_cliente')
    returning id into v_post;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'Pendente', array['quero'], 'link no DM', v_post)
    returning id into v_auto;

  select * into v_a from instagram_comment_automations where id = v_auto;
  assert v_a.ig_media_id is null, 'automacao de post nao publicado nasce pendente';
  assert v_a.pending_post_deleted_at is null, 'pendente nao e tombstone';

  -- publicacao real: mark_platform_published grava o media ID (sem permalink)
  perform mark_platform_published(v_post, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'IG-NOVO-1'));

  select * into v_a from instagram_comment_automations where id = v_auto;
  assert v_a.ig_media_id = 'IG-NOVO-1',
    format('z3 deve ligar a automacao na publicacao, got %s', v_a.ig_media_id);
  assert v_a.media_caption = 'Legenda do post',
    format('z3 deve snapshotar a caption, got %s', v_a.media_caption);
  assert v_a.media_permalink is null, 'permalink ainda nao chegou';
  assert v_a.workflow_post_id = v_post, 'o ponteiro para o post continua';

  -- o permalink chega num UPDATE separado DEPOIS: alcanca a automacao ja ligada
  update workflow_posts set instagram_permalink = 'https://instagram.com/p/novo1'
    where id = v_post;

  select * into v_a from instagram_comment_automations where id = v_auto;
  assert v_a.media_permalink = 'https://instagram.com/p/novo1',
    format('segundo UPDATE deve completar o permalink, got %s', v_a.media_permalink);
  assert v_a.ig_media_id = 'IG-NOVO-1', 'o media ID nao pode mudar no segundo UPDATE';

  -- mudanca de status posterior menciona as duas colunas no SET (CASE ... ELSE
  -- manter): o WHEN do z3 e o que impede o trigger de rodar a toa
  perform record_post_status_change(v_post, 'postado', 'system');

  select * into v_a from instagram_comment_automations where id = v_auto;
  assert v_a.ig_media_id = 'IG-NOVO-1' and v_a.media_permalink = 'https://instagram.com/p/novo1'
     and v_a.media_caption = 'Legenda do post',
    'mudanca de status posterior nao pode corromper o snapshot';

  raise notice 'PASS 66 preenchimento imediato + ligacao na publicacao (z3)';
end $$;
rollback;

-- 7-8. DELETE do post: pendente vira tombstone, ligado sobrevive.
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint;
  v_post bigint; v_post2 bigint; v_post_lig bigint;
  v_auto uuid; v_auto_lig uuid;
  v_a record;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf, v_ws, 'Pendente') returning id into v_post;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf, v_ws, 'Outro pendente') returning id into v_post2;
  insert into workflow_posts (workflow_id, conta_id, titulo, instagram_media_id)
    values (v_wf, v_ws, 'Ligado', 'IG-LIG-1') returning id into v_post_lig;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'Pendente', array['x'], 'y', v_post) returning id into v_auto;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'Ligada', array['x'], 'y', v_post_lig) returning id into v_auto_lig;

  -- 7. DELETE do post pendente: tombstone, NUNCA "todos os posts"
  delete from workflow_posts where id = v_post;

  select * into v_a from instagram_comment_automations where id = v_auto;
  assert v_a.ativo = false, 'tombstone deve desativar a automacao';
  assert v_a.pending_post_deleted_at is not null, 'tombstone deve ser marcado';
  assert v_a.workflow_post_id is null, 'o ponteiro cai pelo SET NULL da FK';
  assert v_a.ig_media_id is null, 'a automacao pendente nao tinha media ID';

  -- reativar sem reescolher alvo e barrado pela CHECK
  v_rejected := false;
  begin
    update instagram_comment_automations set ativo = true where id = v_auto;
  exception when check_violation then
    assert sqlerrm like '%ica_tombstone_inactive%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'nao se reativa um tombstone sem escolher novo alvo';

  -- escolher um alvo novo limpa o tombstone, sem reativar sozinho
  update instagram_comment_automations set workflow_post_id = v_post2 where id = v_auto;
  select * into v_a from instagram_comment_automations where id = v_auto;
  assert v_a.pending_post_deleted_at is null, 'novo alvo deve limpar o tombstone';
  assert v_a.workflow_post_id = v_post2, 'novo alvo deve persistir';
  assert v_a.ativo = false, 'limpar o tombstone nao reativa a automacao sozinho';

  -- e agora reativar passa
  update instagram_comment_automations set ativo = true where id = v_auto;
  select ativo into v_a.ativo from instagram_comment_automations where id = v_auto;
  assert v_a.ativo, 'com alvo novo a automacao pode voltar a ficar ativa';

  -- 8. DELETE do post JA ligado: a automacao continua funcionando
  delete from workflow_posts where id = v_post_lig;

  select * into v_a from instagram_comment_automations where id = v_auto_lig;
  assert v_a.ig_media_id = 'IG-LIG-1', 'automacao ligada mantem o media ID';
  assert v_a.workflow_post_id is null, 'so o ponteiro cai (SET NULL)';
  assert v_a.pending_post_deleted_at is null, 'automacao ligada nao vira tombstone';
  assert v_a.ativo, 'automacao ligada continua ativa';

  raise notice 'PASS 66 DELETE do post (tombstone do pendente, ligado intacto)';
end $$;
rollback;

-- 8b. Sobras uuid: o UPDATE one-shot da 20260820000002 replicado (a migration
--     ja rodou antes do teste, entao o que se prova aqui e o predicado).
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint;
  v_sobra uuid; v_ok uuid;
  v_a record;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- sobra: ig_media_id com o uuid interno de instagram_posts (cliente que
  -- desconectou o Instagram, entao a 20260820000001 nao teve como reparar)
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, ig_media_id, media_permalink, media_caption)
    values (v_ws, v_cli, 'Sobra', array['x'], 'y',
            '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
            'https://instagram.com/p/antigo', 'Legenda antiga')
    returning id into v_sobra;

  -- media ID de verdade do Graph: numerico, nao pode ser tocado
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, ig_media_id)
    values (v_ws, v_cli, 'Boa', array['x'], 'y', '17912345678901234')
    returning id into v_ok;

  update instagram_comment_automations
     set ativo = false,
         pending_post_deleted_at = now(),
         ig_media_id = null,
         media_permalink = null
   where ig_media_id ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$';

  select * into v_a from instagram_comment_automations where id = v_sobra;
  assert v_a.ativo = false, 'sobra uuid deve ser desativada';
  assert v_a.pending_post_deleted_at is not null, 'sobra uuid deve virar tombstone';
  assert v_a.ig_media_id is null, 'sobra uuid deve perder o alvo irreparavel';
  assert v_a.media_caption = 'Legenda antiga',
    'a caption fica para o usuario reconhecer a automacao';

  select * into v_a from instagram_comment_automations where id = v_ok;
  assert v_a.ig_media_id = '17912345678901234', 'media ID real nao pode ser tocado';
  assert v_a.ativo, 'automacao boa continua ativa';

  raise notice 'PASS 66 sobras uuid viram tombstone (predicado da 20260820000002)';
end $$;
rollback;

-- 9. sweep_pending_instagram_automation_links: janela MVCC em que o z3 nao
--    enxergou a automacao (simulada desligando o proprio z3).
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint; v_post bigint;
  v_auto uuid;
  v_a record;
  v_n integer;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, ig_caption)
    values (v_wf, v_ws, 'Em producao', 'Legenda para o sweep') returning id into v_post;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'Pendente', array['x'], 'y', v_post) returning id into v_auto;

  -- orfa: o post publica sem que o z3 alcance a automacao
  alter table workflow_posts disable trigger workflow_posts_z3_link_ig_automations;
  update workflow_posts
     set instagram_media_id = 'IG-SWEEP-1',
         instagram_permalink = 'https://instagram.com/p/sweep1'
   where id = v_post;
  alter table workflow_posts enable trigger workflow_posts_z3_link_ig_automations;

  select * into v_a from instagram_comment_automations where id = v_auto;
  assert v_a.ig_media_id is null, 'a automacao deve estar orfa antes do sweep';

  v_n := sweep_pending_instagram_automation_links();
  assert v_n = 1, format('o sweep deve religar exatamente 1 automacao, got %s', v_n);

  select * into v_a from instagram_comment_automations where id = v_auto;
  assert v_a.ig_media_id = 'IG-SWEEP-1',
    format('o sweep deve preencher o media ID, got %s', v_a.ig_media_id);
  assert v_a.media_permalink = 'https://instagram.com/p/sweep1', 'o sweep leva o permalink';
  assert v_a.media_caption = 'Legenda para o sweep', 'o sweep leva a caption';

  -- idempotente: nada mais a religar no segundo tick
  v_n := sweep_pending_instagram_automation_links();
  assert v_n = 0, format('segundo sweep nao deve religar nada, got %s', v_n);

  raise notice 'PASS 66 sweep religa a automacao orfa (e e idempotente)';
end $$;
rollback;

-- 10. Deriva de alvo: publicacao, DELETE e sweep NUNCA abortam; so nao ligam.
--     Os dois primeiros cenarios sao os repros da revisao do fix round 1.
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint; v_cli2 bigint;
  v_wf bigint; v_wf_mov bigint; v_wf_tt bigint;
  v_post_st bigint; v_post_mov bigint; v_post_tt bigint;
  v_auto_st uuid; v_auto_mov uuid; v_auto_tt uuid;
  v_a record;
  v_n integer;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C1', 'C1', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C2', 'C2', '#000') returning id into v_cli2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF movido', 'ativo') returning id into v_wf_mov;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF tiktok', 'ativo') returning id into v_wf_tt;

  insert into workflow_posts (workflow_id, conta_id, titulo, ig_caption)
    values (v_wf, v_ws, 'Vira stories', 'Legenda') returning id into v_post_st;
  insert into workflow_posts (workflow_id, conta_id, titulo, ig_caption)
    values (v_wf_mov, v_ws, 'Muda de cliente', 'Legenda') returning id into v_post_mov;
  insert into workflow_posts (workflow_id, conta_id, titulo, ig_caption)
    values (v_wf_tt, v_ws, 'Vira tiktok', 'Legenda') returning id into v_post_tt;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'No stories', array['x'], 'y', v_post_st) returning id into v_auto_st;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'No movido', array['x'], 'y', v_post_mov) returning id into v_auto_mov;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'No tiktok', array['x'], 'y', v_post_tt) returning id into v_auto_tt;

  -- (a/b) post vira stories: updateWorkflowPost aceita `tipo` num Partial, e
  --       operacao corriqueira de UI. Nem o UPDATE nem a publicacao podem
  --       falhar; a automacao so nao liga.
  update workflow_posts set tipo = 'stories' where id = v_post_st;
  update workflow_posts set instagram_media_id = 'IG-ST-1' where id = v_post_st;

  select * into v_a from instagram_comment_automations where id = v_auto_st;
  assert v_a.ig_media_id is null, 'z3 nao pode ligar alvo que virou stories';
  assert v_a.ativo, 'a automacao continua ativa, so pendente';

  -- (d) o sweep tambem recusa o alvo derivado
  v_n := sweep_pending_instagram_automation_links();
  assert v_n = 0, format('o sweep nao pode ligar alvo derivado, got %s', v_n);

  -- (a) e o DELETE do post FUNCIONA (era o repro 1: falhava com
  --     'cannot be a stories post'), deixando o tombstone normal
  delete from workflow_posts where id = v_post_st;
  select * into v_a from instagram_comment_automations where id = v_auto_st;
  assert v_a.ativo = false and v_a.pending_post_deleted_at is not null,
    'DELETE de post derivado deve tombstonar a automacao pendente';
  assert v_a.workflow_post_id is null and v_a.ig_media_id is null,
    'tombstone de alvo derivado nao pode carregar media ID';

  -- (c) workflow movido para outro cliente: a PUBLICACAO nao pode falhar
  --     (era o repro 2: 'belongs to another client' com o Graph ja publicado)
  update workflows set cliente_id = v_cli2 where id = v_wf_mov;
  perform mark_platform_published(v_post_mov, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'IG-MOV-1',
                       'instagram_permalink', 'https://instagram.com/p/mov1'));

  select * into v_a from instagram_comment_automations where id = v_auto_mov;
  assert v_a.ig_media_id is null,
    'z3 nao pode ligar a automacao do cliente antigo depois da migracao';
  assert v_a.media_permalink is null and v_a.media_caption is null,
    'nada do snapshot pode vazar para a automacao do cliente antigo';

  v_n := sweep_pending_instagram_automation_links();
  assert v_n = 0, format('o sweep nao pode ligar alvo de outro cliente, got %s', v_n);

  delete from workflow_posts where id = v_post_mov;
  select * into v_a from instagram_comment_automations where id = v_auto_mov;
  assert v_a.ativo = false and v_a.pending_post_deleted_at is not null,
    'DELETE de post migrado de cliente deve tombstonar, nao estourar';

  -- (b') mesma coisa para deriva de plataforma
  update workflow_posts set platform = 'tiktok' where id = v_post_tt;
  update workflow_posts set instagram_media_id = 'IG-TT-1' where id = v_post_tt;
  select * into v_a from instagram_comment_automations where id = v_auto_tt;
  assert v_a.ig_media_id is null, 'z3 nao pode ligar alvo que virou so-TikTok';

  v_n := sweep_pending_instagram_automation_links();
  assert v_n = 0, format('o sweep nao pode ligar alvo so-TikTok, got %s', v_n);

  delete from workflow_posts where id = v_post_tt; -- nao pode estourar

  -- a validacao dura continua valendo para escrita DIRIGIDA PELO USUARIO:
  -- reescolher um alvo derivado ainda e rejeitado na cara do usuario
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf, v_ws, 'Stories novo', 'stories') returning id into v_post_st;
  begin
    update instagram_comment_automations set workflow_post_id = v_post_st
      where id = v_auto_st;
    assert false, 'escolher um post de stories na mao ainda deve ser rejeitado';
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%stories post%', format('wrong msg: %s', sqlerrm);
  end;

  raise notice 'PASS 66 deriva de alvo nao aborta publicacao, DELETE nem sweep';
end $$;
rollback;

-- 11. Tombstone nao pode ser limpo E reativado sem alvo num UNICO write.
--     A CHECK ica_tombstone_inactive so olha o estado final da linha, entao
--     sozinha ela deixaria passar um UPDATE que limpa o tombstone e ativa ao
--     mesmo tempo -- o resultado seria uma automacao GLOBAL ativa que ninguem
--     pediu. Quem fecha isso e a guarda do resolver. O caminho legitimo (dois
--     passos) e o write que ja traz alvo novo continuam funcionando.
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint;
  v_post bigint; v_post2 bigint;
  v_a1 uuid; v_a2 uuid; v_a3 uuid;
  v_a record;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf, v_ws, 'Vai sumir') returning id into v_post;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf, v_ws, 'Alvo novo') returning id into v_post2;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'A1', array['x'], 'y', v_post) returning id into v_a1;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'A2', array['x'], 'y', v_post) returning id into v_a2;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'A3', array['x'], 'y', v_post) returning id into v_a3;

  delete from workflow_posts where id = v_post; -- tombstona as tres

  -- (a) o write malicioso de um statement so: limpa tombstone + ativa + sem alvo
  v_rejected := false;
  begin
    update instagram_comment_automations
       set pending_post_deleted_at = null, ativo = true,
           workflow_post_id = null, ig_media_id = null
     where id = v_a1;
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%without a target in one write%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'limpar tombstone e ativar sem alvo num write so deve ser rejeitado';

  select * into v_a from instagram_comment_automations where id = v_a1;
  assert v_a.pending_post_deleted_at is not null and v_a.ativo = false,
    'a linha rejeitada continua tombstoned e inativa';

  -- (b) caminho legitimo em DOIS passos: "Todos os posts" limpa sem ativar...
  update instagram_comment_automations set pending_post_deleted_at = null
    where id = v_a2;
  select * into v_a from instagram_comment_automations where id = v_a2;
  assert v_a.pending_post_deleted_at is null, 'passo 1 deve limpar o tombstone';
  assert v_a.ativo = false, 'passo 1 nao ativa';
  assert v_a.workflow_post_id is null and v_a.ig_media_id is null,
    'passo 1 deixa a automacao no estado "todos os posts"';

  -- ...e so entao o toggle reativa
  update instagram_comment_automations set ativo = true where id = v_a2;
  select * into v_a from instagram_comment_automations where id = v_a2;
  assert v_a.ativo, 'passo 2 deve reativar';

  -- (c) um write so que ja TRAZ alvo novo nao e o caso guardado: passa
  update instagram_comment_automations
     set pending_post_deleted_at = null, ativo = true, workflow_post_id = v_post2
   where id = v_a3;
  select * into v_a from instagram_comment_automations where id = v_a3;
  assert v_a.ativo and v_a.pending_post_deleted_at is null and v_a.workflow_post_id = v_post2,
    'escolher alvo novo e reativar no mesmo write deve passar';

  raise notice 'PASS 66 tombstone nao vira automacao global ativa num write so';
end $$;
rollback;

-- 12. O tombstone do DELETE vale para QUALQUER papel: mesmo um agent (que
--     desde 20260829000001 tem RLS de escrita completa na automacao, igual
--     owner/admin) aciona o z4 (SECURITY DEFINER) ao excluir o post alvo.
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint; v_post bigint;
  v_auto uuid;
  v_a record;
  v_rows bigint;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_owner), (v_agent);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'owner'
    where id = v_owner;
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'agent'
    where id = v_agent;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_owner, v_ws, v_cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf, v_ws, 'Pendente') returning id into v_post;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, workflow_post_id)
    values (v_ws, v_cli, 'Pendente', array['x'], 'y', v_post) returning id into v_auto;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);

  -- excluir o post e permitido para o agent, e o z4 tombstona a automacao
  delete from workflow_posts where id = v_post;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('agent deve conseguir excluir o post, afetou %s', v_rows);

  reset role;

  select * into v_a from instagram_comment_automations where id = v_auto;
  assert v_a.ativo = false, 'DELETE feito por agent tambem deve desativar';
  assert v_a.pending_post_deleted_at is not null,
    'DELETE feito por agent tambem deve gravar o tombstone (z4 e SECURITY DEFINER)';
  assert v_a.workflow_post_id is null, 'o ponteiro cai pelo SET NULL da FK';

  raise notice 'PASS 66 tombstone via SECURITY DEFINER vale ate para agent';
end $$;
rollback;
