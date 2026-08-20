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
--     stories sao rejeitados; as validacoes rodam SEMPRE que ha
--     workflow_post_id, inclusive no estado Ligado e no INSERT com ambos.
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
