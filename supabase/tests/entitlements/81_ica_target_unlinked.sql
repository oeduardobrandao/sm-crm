\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Alvo orfao (migration 20260913000001): a reconciliacao carimba automacao cujo
-- post alvo virou 'postado' sem instagram_media_id, limpa quando nao vale mais,
-- e o resolver limpa na hora em qualquer troca de alvo dirigida pelo usuario.

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws       uuid;
  v_uid      uuid := gen_random_uuid();
  v_cli      bigint;
  v_cli2     bigint;
  v_post     bigint;   -- postado SEM media: o orfao
  v_post_api bigint;   -- caminho da API: media antes do status
  v_post_st  bigint;   -- stories
  v_post_tt  bigint;   -- tiktok
  v_post_dv  bigint;   -- cliente divergente
  v_a_orfao  uuid;
  v_a_api    uuid;
  v_a_inativa uuid;
  v_a_stories uuid;
  v_a_tiktok  uuid;
  v_a_deriva  uuid;
  v_post_h   bigint;  -- media chega depois, isolado do resolver: ramo ig_media_id IS NULL
  v_a_h      uuid;
  v_post_i   bigint;  -- deriva para stories DEPOIS de ja carimbado: guarda de deriva do NOT EXISTS
  v_a_i      uuid;
  v_marked   int;
  v_cleared  int;
  v_stamp    timestamptz;
begin
  -- feature_instagram_automation nasce false em todo plano (ship dark, ver
  -- suite 66) -- sem o override (coluna feature_overrides, NAO
  -- resource_overrides) o INSERT em instagram_comment_automations bate no
  -- enforce_plan_feature() antes de chegar perto do que esta sob teste aqui.
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'D', 'D', '#000') returning id into v_cli2;

  -- posts
  insert into workflow_posts (conta_id, cliente_id, titulo, status, tipo, published_at)
    values (v_ws, v_cli, 'orfao', 'postado', 'carrossel', now()) returning id into v_post;
  insert into workflow_posts (conta_id, cliente_id, titulo, status, tipo)
    values (v_ws, v_cli, 'api', 'agendado', 'reels') returning id into v_post_api;
  -- st/tt/dv nascem como alvo VALIDO (tipo normal, plataforma instagram,
  -- mesmo cliente da automacao): o resolver ja valida o alvo na hora do
  -- INSERT da automacao ('instagram automation target cannot be a
  -- stories/tiktok-only post', 'belongs to another client'), entao um post
  -- ja invalido de saida nunca passaria pelos INSERTs abaixo. Cada um
  -- DERIVA para o estado invalido DEPOIS que a automacao ja aponta pra ele
  -- (mais adiante) -- o mesmo cenario de "DERIVA DE ALVO" que a suite 66
  -- (secao 10) ja cobre para o resolver, e o que reconcile() precisa
  -- enxergar pelas MESMAS guardas.
  insert into workflow_posts (conta_id, cliente_id, titulo, status, tipo)
    values (v_ws, v_cli, 'st', 'agendado', 'reels') returning id into v_post_st;
  insert into workflow_posts (conta_id, cliente_id, titulo, status, tipo)
    values (v_ws, v_cli, 'tt', 'agendado', 'reels') returning id into v_post_tt;
  insert into workflow_posts (conta_id, cliente_id, titulo, status, tipo)
    values (v_ws, v_cli, 'dv', 'agendado', 'reels') returning id into v_post_dv;

  -- automacoes pendentes (ig_media_id nulo, alvo interno)
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ativo)
    values (v_ws, v_cli, 'orfao', array['x'], 'oi', v_post, true) returning id into v_a_orfao;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ativo)
    values (v_ws, v_cli, 'api', array['x'], 'oi', v_post_api, true) returning id into v_a_api;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ativo)
    values (v_ws, v_cli, 'inativa', array['x'], 'oi', v_post, false) returning id into v_a_inativa;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ativo)
    values (v_ws, v_cli, 'stories', array['x'], 'oi', v_post_st, true) returning id into v_a_stories;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ativo)
    values (v_ws, v_cli, 'tiktok', array['x'], 'oi', v_post_tt, true) returning id into v_a_tiktok;
  -- deriva: automacao do cliente v_cli apontando para post que vai migrar
  -- para o cliente v_cli2 (post AINDA em v_cli neste INSERT -- alvo valido)
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ativo)
    values (v_ws, v_cli, 'deriva', array['x'], 'oi', v_post_dv, true) returning id into v_a_deriva;

  -- deriva os tres alvos DEPOIS que a automacao ja aponta pra eles: nenhum
  -- trigger de workflow_posts (tipo/platform/cliente_id) toca de volta em
  -- instagram_comment_automations, entao cada automacao fica com o
  -- workflow_post_id intacto apontando pra um alvo que virou invalido.
  update workflow_posts set tipo = 'stories', status = 'postado' where id = v_post_st;
  update workflow_posts set platform = 'tiktok', status = 'postado' where id = v_post_tt;
  -- post_a0_sync_cliente bloqueia PATCH direto de cliente_id
  -- (post_move_requires_rpc); as RPCs reais (20260830000001,
  -- 20260830000004, 20260901110000) setam esta GUC transacional antes de
  -- mover, entao o teste faz o mesmo para simular a deriva.
  PERFORM set_config('app.allow_post_move', 'on', true);
  update workflow_posts set cliente_id = v_cli2, status = 'postado' where id = v_post_dv;

  -- (a) carimba so o orfao e a inativa (mesmo post), nao os tres derivados
  select marked, cleared into v_marked, v_cleared from reconcile_unlinked_automation_targets();
  assert v_marked = 2, 'reconcile deveria carimbar exatamente as 2 automacoes do post orfao, carimbou ' || v_marked;
  assert (select target_unlinked_at is not null from instagram_comment_automations where id = v_a_orfao),
         'automacao orfa nao foi carimbada';
  assert (select target_unlinked_at is not null from instagram_comment_automations where id = v_a_inativa),
         'automacao INATIVA deveria ser carimbada tambem';
  assert (select target_unlinked_at is null from instagram_comment_automations where id = v_a_stories),
         'stories nao pode ser carimbado';
  assert (select target_unlinked_at is null from instagram_comment_automations where id = v_a_tiktok),
         'tiktok nao pode ser carimbado';
  assert (select target_unlinked_at is null from instagram_comment_automations where id = v_a_deriva),
         'cliente divergente nao pode ser carimbado';
  assert (select ativo from instagram_comment_automations where id = v_a_orfao),
         'carimbar nao pode desligar a automacao';

  -- (b) idempotente: nao remarca nem mexe no timestamp
  select target_unlinked_at into v_stamp from instagram_comment_automations where id = v_a_orfao;
  select marked into v_marked from reconcile_unlinked_automation_targets();
  assert v_marked = 0, 'segunda rodada remarcou ' || v_marked;
  assert (select target_unlinked_at from instagram_comment_automations where id = v_a_orfao) = v_stamp,
         'segunda rodada alterou o timestamp';

  -- (c) caminho da API: media chega ANTES do status -> nunca carimba
  update workflow_posts set instagram_media_id = '17999999999999999' where id = v_post_api;
  update workflow_posts set status = 'postado' where id = v_post_api;
  select marked into v_marked from reconcile_unlinked_automation_targets();
  assert (select target_unlinked_at is null from instagram_comment_automations where id = v_a_api),
         'automacao do caminho da API foi carimbada indevidamente';

  -- (d) o post orfao SAI de 'postado' -> a metade que limpa apaga a marca.
  --     NAO usamos "media chega depois" aqui: setar instagram_media_id
  --     dispara o z3 (workflow_posts_z3_link_ig_automations, ja existente),
  --     que liga IMEDIATAMENTE as automacoes pendentes (nao filtra por
  --     ativo) escrevendo ig_media_id nelas -- e essa propria escrita ja
  --     aciona o bloco novo do resolver (secao e/f), que limpa a marca na
  --     hora. A metade que limpa do reconcile() nunca seria exercitada
  --     por esse caminho: das 3 razoes do comentario da migration ("media
  --     chegou, alvo mudou, ou o post saiu de 'postado'"), so a 3a nao passa
  --     por nenhum trigger de instagram_comment_automations.
  update workflow_posts set status = 'rascunho' where id = v_post;
  select cleared into v_cleared from reconcile_unlinked_automation_targets();
  assert v_cleared = 2, 'reconcile deveria limpar as 2 marcas do post, limpou ' || v_cleared;

  -- (e) resolver limpa na hora ao re-mirar PRESERVANDO workflow_post_id
  update instagram_comment_automations set target_unlinked_at = now() where id = v_a_orfao;
  update instagram_comment_automations set ig_media_id = '17777777777777777' where id = v_a_orfao;
  assert (select target_unlinked_at is null from instagram_comment_automations where id = v_a_orfao),
         'resolver nao limpou a marca quando ig_media_id mudou com workflow_post_id igual';

  -- (f) resolver limpa ao virar "Todos os posts" (ambos nulos): o bloco NAO herda
  --     a guarda IS NOT NULL do tombstone
  update instagram_comment_automations set target_unlinked_at = now() where id = v_a_inativa;
  update instagram_comment_automations set ig_media_id = null, workflow_post_id = null where id = v_a_inativa;
  assert (select target_unlinked_at is null from instagram_comment_automations where id = v_a_inativa),
         'resolver nao limpou a marca ao virar global';

  -- (g) ramo `a.ig_media_id IS NULL` da metade que limpa: a midia chega
  --     depois, isolada do resolver. Sem isolar, o UPDATE que o z3
  --     (workflow_posts_z3_link_ig_automations, ja existente) faz em
  --     ig_media_id passaria pelo trigger novo do resolver (secoes e/f acima)
  --     e limparia a marca ALI MESMO -- o reconcile() nunca chegaria a
  --     exercitar esse ramo da metade que limpa. Confirmado empiricamente:
  --     com o resolver ATIVO, setar workflow_posts.instagram_media_id aqui
  --     zera target_unlinked_at antes do reconcile() rodar (v_cleared = 0).
  insert into workflow_posts (conta_id, cliente_id, titulo, status, tipo)
    values (v_ws, v_cli, 'h', 'postado', 'carrossel') returning id into v_post_h;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ativo)
    values (v_ws, v_cli, 'h', array['x'], 'oi', v_post_h, true) returning id into v_a_h;
  select marked into v_marked from reconcile_unlinked_automation_targets();
  assert v_marked = 1, 'reconcile deveria carimbar a automacao h, carimbou ' || v_marked;

  alter table instagram_comment_automations disable trigger ica_a1_resolve_workflow_post_target;
  update workflow_posts set instagram_media_id = '17666666666666666' where id = v_post_h;
  alter table instagram_comment_automations enable trigger ica_a1_resolve_workflow_post_target;

  assert (select ig_media_id is not null from instagram_comment_automations where id = v_a_h),
         'z3 deveria ter ligado ig_media_id mesmo com o resolver desabilitado';
  assert (select target_unlinked_at is not null from instagram_comment_automations where id = v_a_h),
         'com o resolver desabilitado a marca NAO pode ter sido limpa pelo trigger';

  select cleared into v_cleared from reconcile_unlinked_automation_targets();
  assert v_cleared = 1, 'reconcile deveria limpar a marca quando a midia chega (ramo ig_media_id), limpou ' || v_cleared;
  assert (select target_unlinked_at is null from instagram_comment_automations where id = v_a_h),
         'marca deveria ter sido limpa pelo reconcile quando a midia chegou';

  -- (h) guarda de deriva dentro do NOT EXISTS: automacao ja carimbada cujo
  --     post deriva para 'stories' deve ter a marca limpa. Mudar wp.tipo nao
  --     aciona nenhum trigger em instagram_comment_automations -- sem essa
  --     guarda dentro do NOT EXISTS a marca ficaria presa para sempre num
  --     post que nao e mais um alvo valido.
  insert into workflow_posts (conta_id, cliente_id, titulo, status, tipo)
    values (v_ws, v_cli, 'i', 'postado', 'carrossel') returning id into v_post_i;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message, workflow_post_id, ativo)
    values (v_ws, v_cli, 'i', array['x'], 'oi', v_post_i, true) returning id into v_a_i;
  select marked into v_marked from reconcile_unlinked_automation_targets();
  assert v_marked = 1, 'reconcile deveria carimbar a automacao i, carimbou ' || v_marked;

  update workflow_posts set tipo = 'stories' where id = v_post_i;
  select cleared into v_cleared from reconcile_unlinked_automation_targets();
  assert v_cleared = 1, 'reconcile deveria limpar a marca quando o post deriva para stories, limpou ' || v_cleared;
  assert (select target_unlinked_at is null from instagram_comment_automations where id = v_a_i),
         'marca deveria ter sido limpa quando o post derivou para stories';

  -- (i) grants: checa proacl, NAO has_function_privilege. A regra da casa
  --     (AGENTS.md:111) existe porque has_function_privilege resolve via PUBLIC e
  --     esconde se o grant direto do papel foi mesmo revogado.
  assert (select array_to_string(proacl, ',') like '%service_role=X%'
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'reconcile_unlinked_automation_targets'),
         'service_role deveria ter EXECUTE direto na RPC';
  assert (select array_to_string(proacl, ',') not like '%anon=X%'
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'reconcile_unlinked_automation_targets'),
         'anon NAO pode ter EXECUTE na RPC';
  assert (select array_to_string(proacl, ',') not like '%authenticated=X%'
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'reconcile_unlinked_automation_targets'),
         'authenticated NAO pode ter EXECUTE na RPC';
  -- PUBLIC (grantee 0 em aclexplode) e o que has_function_privilege(anon,...)
  -- checaria por baixo dos panos e o que os LIKEs acima NAO pegam: um GRANT
  -- via PUBLIC aparece no acl como a entrada bare '=X', que nao casa com
  -- '%anon=X%' nem '%authenticated=X%'. Sem REVOKE ALL ... FROM PUBLIC na
  -- migration, o acl fica so '=X/postgres,postgres=X/postgres,service_role=X/postgres'
  -- e as tres assercoes acima passam verdes mesmo com anon/authenticated
  -- conseguindo chamar a RPC via PUBLIC -- exatamente o cenario que este
  -- assert precisa pegar.
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
     where n.nspname = 'public'
       and p.proname = 'reconcile_unlinked_automation_targets'
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
    'PUBLIC NAO pode ter EXECUTE na RPC';
end $$;
rollback;
