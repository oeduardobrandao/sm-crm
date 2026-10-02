-- supabase/tests/entitlements/99_duplicate_post.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- duplicate_post (20261002000020). Cobre:
-- 99p.0 guarda de colunas: toda coluna de workflow_posts, post_file_links,
--       post_processes e post_process_steps esta classificada
-- 99p.1 "manter status": colunas copiadas, publicacao zerada, scheduled_at
--       mantido, sufixo, ordem logo depois, irmaos empurrados, links e capa
-- 99p.2 matriz de status nos dois modos (inclui status customizado)
-- 99p.3 board_ordem: ponto medio, +1024 sem vizinho, null quando muda de coluna
-- 99p.4 post individual: processo e steps clonados; sem a feature, sem processo
-- 99p.5 isolamento e grants: outra conta -> not_found; anon sem EXECUTE;
--       authenticated nao executa _clone_post_row
-- 99p.6 limite de plano desfaz tudo

create or replace function pg_temp.dp_env(
  out ws uuid, out usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (usr, ws, cli, 'WF', 'ativo') returning id into wf;
end $$;

create or replace function pg_temp.dp_as(p_usr uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 99p.0 guarda de colunas. Se falhar: a coluna nova precisa entrar em
-- _clone_post_row (copiar ou zerar) E na lista abaixo.
begin;
do $$
declare v_missing text;
begin
  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'workflow_posts'
     and column_name not in (
       -- copiadas
       'titulo','conteudo','conteudo_plain','tipo','platform','responsavel_id',
       'ig_caption','music_note','cover_url','tiktok_caption','tiktok_title',
       'tiktok_settings','ig_trial_strategy','is_express','scheduled_at',
       'cliente_id','conta_id','workflow_id','ordem','status','custom_status_id',
       'board_ordem','created_via',
       -- zeradas (default da coluna)
       'instagram_container_id','instagram_media_id','instagram_permalink',
       'published_at','publish_error','publish_error_code','publish_retry_count',
       'publish_processing_at','story_segments','carousel_children',
       'tiktok_publish_id','tiktok_post_id','tiktok_post_url','tiktok_publish_status',
       'tiktok_publish_error','tiktok_publish_retry_count','tiktok_publish_processing_at',
       'media_autocleaned_at',
       -- geradas pelo banco
       'id','created_at','updated_at');
  assert v_missing is null, format('workflow_posts tem coluna nao classificada em _clone_post_row: %s', v_missing);

  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'post_file_links'
     and column_name not in ('id','post_id','file_id','conta_id','is_cover','sort_order','created_at','origin');
  assert v_missing is null, format('post_file_links tem coluna nao classificada: %s', v_missing);

  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'post_processes'
     and column_name not in ('id','conta_id','post_id','template_id','template_nome',
       'assinatura','origem_workflow_id','origem_descricao','estado','motivo_encerramento',
       'etapa_atual','modo_prazo','board_position','revisao','created_by','created_at',
       'updated_at','concluido_em');
  assert v_missing is null, format('post_processes tem coluna nao classificada: %s', v_missing);

  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'post_process_steps'
     and column_name not in ('id','conta_id','process_id','ordem','nome','tipo',
       'responsavel_id','prazo_dias','tipo_prazo','prazo_efetivo','estado','iniciado_em',
       'concluido_em','interrompido_em','origem_etapa_ordem','origem_etapa_nome');
  assert v_missing is null, format('post_process_steps tem coluna nao classificada: %s', v_missing);
  raise notice 'PASS 99p.0';
end $$;
rollback;

-- 99p.1 manter status: copia, zera publicacao, posiciona, linka midia
begin;
select et_grant_hosted_parity();
do $$
declare
  e record; v_m bigint; p1 bigint; p2 bigint; p3 bigint; v_new bigint;
  f1 bigint; f2 bigint; f3 bigint; r record; v_n int; v_refs int;
begin
  e := pg_temp.dp_env();
  insert into membros (user_id, conta_id, nome, cargo, tipo)
    values (e.usr, e.ws, 'M', 'x', 'clt') returning id into v_m;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status) values
    (e.wf, e.ws, 'Antes', 0, 'rascunho') returning id into p1;
  insert into workflow_posts (
      workflow_id, conta_id, titulo, ordem, status, tipo, platform, responsavel_id,
      conteudo, conteudo_plain, ig_caption, music_note, scheduled_at,
      instagram_container_id, instagram_media_id, instagram_permalink, publish_error,
      publish_retry_count, story_segments, tiktok_post_id)
    values (e.wf, e.ws, 'Original', 1, 'enviado_cliente', 'carrossel', 'instagram', v_m,
      '{"type":"doc"}', 'texto', 'Legenda', 'musica', timestamptz '2026-11-05 15:00+00',
      'c1', 'm1', 'https://instagram.com/p/x', 'erro', 2, '[{"file_id":1}]', 'tt1')
    returning id into p2;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status) values
    (e.wf, e.ws, 'Depois', 2, 'rascunho') returning id into p3;

  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes) values
    (e.ws, 'k1', 'f1', 'image', 'image/png', 10) returning id into f1;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes) values
    (e.ws, 'k2', 'f2', 'image', 'image/png', 10) returning id into f2;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes) values
    (e.ws, 'k3', 'f3', 'image', 'image/png', 10) returning id into f3;
  -- f1 entra primeiro (o auto-cover a marcaria), depois a capa vira f2.
  insert into post_file_links (post_id, file_id, conta_id, sort_order) values (p2, f1, e.ws, 0);
  update post_file_links set is_cover = false where post_id = p2;
  insert into post_file_links (post_id, file_id, conta_id, sort_order, is_cover) values (p2, f2, e.ws, 1, true);
  insert into post_file_links (post_id, file_id, conta_id, sort_order) values (p2, f3, e.ws, 2);

  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(p2, false);
  execute 'reset role';

  select * into r from workflow_posts where id = v_new;
  assert r.titulo = 'Original (cópia)', format('titulo: %s', r.titulo);
  assert r.workflow_id = e.wf and r.cliente_id = e.cli, 'fluxo/cliente';
  assert r.status = 'enviado_cliente', format('status: %s', r.status);
  assert r.tipo = 'carrossel' and r.platform = 'instagram' and r.responsavel_id = v_m, 'tipo/platform/resp';
  assert r.conteudo = '{"type":"doc"}'::jsonb and r.conteudo_plain = 'texto', 'conteudo';
  assert r.ig_caption = 'Legenda' and r.music_note = 'musica', 'legenda/musica';
  assert r.scheduled_at = timestamptz '2026-11-05 15:00+00', 'scheduled_at mantido';
  assert r.instagram_container_id is null and r.instagram_media_id is null
     and r.instagram_permalink is null and r.publish_error is null
     and r.publish_retry_count = 0 and r.story_segments is null
     and r.tiktok_post_id is null and r.published_at is null, 'publicacao zerada';
  assert r.created_via = 'human', 'created_via';
  assert r.ordem = 2, format('ordem do clone: %s', r.ordem);
  assert (select ordem from workflow_posts where id = p3) = 3, 'irmao depois do original empurrado';
  assert (select ordem from workflow_posts where id = p1) = 0, 'irmao antes do original intocado';

  select count(*) into v_n from post_file_links where post_id = v_new;
  assert v_n = 3, format('links: %s', v_n);
  assert (select file_id from post_file_links where post_id = v_new and is_cover) = f2, 'capa preservada';
  assert (select sort_order from post_file_links where post_id = v_new and file_id = f3) = 2, 'sort_order';
  select reference_count into v_refs from files where id = f1;
  assert v_refs = 2, format('reference_count de f1: %s', v_refs);
  raise notice 'PASS 99p.1';
end $$;
rollback;

-- 99p.2 matriz de status
begin;
select et_grant_hosted_parity();
do $$
declare
  e record; v_def uuid; v_src bigint; v_new bigint; v_st text; v_cs uuid;
  s text;
begin
  e := pg_temp.dp_env();
  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (e.ws, 'Em design', 'revisao_interna') returning id into v_def;

  foreach s in array array['rascunho','revisao_interna','aprovado_interno','enviado_cliente',
                           'aprovado_cliente','correcao_cliente','agendado','postado','falha_publicacao'] loop
    insert into workflow_posts (workflow_id, conta_id, titulo, status)
      values (e.wf, e.ws, s, s) returning id into v_src;
    perform pg_temp.dp_as(e.usr);
    v_new := duplicate_post(v_src, false);
    execute 'reset role';
    select status into v_st from workflow_posts where id = v_new;
    if s in ('agendado','postado','falha_publicacao') then
      assert v_st = 'aprovado_cliente', format('manter %s -> %s', s, v_st);
    else
      assert v_st = s, format('manter %s -> %s', s, v_st);
    end if;
    perform pg_temp.dp_as(e.usr);
    v_new := duplicate_post(v_src, true);
    execute 'reset role';
    select status into v_st from workflow_posts where id = v_new;
    assert v_st = 'rascunho', format('rascunho %s -> %s', s, v_st);
  end loop;

  -- status customizado: mantido no modo manter, zerado no modo rascunho
  insert into workflow_posts (workflow_id, conta_id, titulo, status, custom_status_id)
    values (e.wf, e.ws, 'custom', 'revisao_interna', v_def) returning id into v_src;
  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_src, false);
  execute 'reset role';
  select status, custom_status_id into v_st, v_cs from workflow_posts where id = v_new;
  assert v_st = 'revisao_interna' and v_cs = v_def, format('custom manter: %s %s', v_st, v_cs);
  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_src, true);
  execute 'reset role';
  select status, custom_status_id into v_st, v_cs from workflow_posts where id = v_new;
  assert v_st = 'rascunho' and v_cs is null, format('custom rascunho: %s %s', v_st, v_cs);
  raise notice 'PASS 99p.2';
end $$;
rollback;

-- 99p.3 board_ordem
begin;
select et_grant_hosted_parity();
do $$
declare e record; a bigint; b bigint; c bigint; u bigint; v_new bigint; v_bo double precision;
begin
  e := pg_temp.dp_env();
  insert into workflow_posts (workflow_id, conta_id, titulo, status, board_ordem)
    values (e.wf, e.ws, 'A', 'revisao_interna', 1024) returning id into a;
  insert into workflow_posts (workflow_id, conta_id, titulo, status, board_ordem)
    values (e.wf, e.ws, 'B', 'revisao_interna', 2048) returning id into b;
  insert into workflow_posts (workflow_id, conta_id, titulo, status, board_ordem)
    values (e.wf, e.ws, 'C', 'aprovado_interno', 5000) returning id into c;
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (e.wf, e.ws, 'U', 'revisao_interna') returning id into u;

  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(a, false);                    -- mesma coluna, vizinho B
  select board_ordem into v_bo from workflow_posts where id = v_new;
  assert v_bo = 1536, format('ponto medio: %s', v_bo);

  v_new := duplicate_post(b, false);                    -- mesma coluna, sem vizinho ranqueado depois
  select board_ordem into v_bo from workflow_posts where id = v_new;
  assert v_bo = 3072, format('+1024: %s', v_bo);

  v_new := duplicate_post(a, true);                     -- vira rascunho: outra coluna
  select board_ordem into v_bo from workflow_posts where id = v_new;
  assert v_bo is null, format('outra coluna: %s', v_bo);

  v_new := duplicate_post(u, false);                    -- original sem ranque
  select board_ordem into v_bo from workflow_posts where id = v_new;
  assert v_bo is null, format('sem ranque: %s', v_bo);
  execute 'reset role';
  raise notice 'PASS 99p.3';
end $$;
rollback;

-- 99p.4 post individual
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_post bigint; v_proc bigint; v_new bigint; r record; v_n int;
begin
  e := pg_temp.dp_env();
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = e.ws);
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (e.ws, e.cli, 'Avulso', 'revisao_interna') returning id into v_post;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual, board_position)
    values (e.ws, v_post, '0|Copy|padrao' || chr(10) || '1|Design|padrao', 'ativo', 1, 4)
    returning id into v_proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado, concluido_em)
    values (e.ws, v_proc, 0, 'Copy', 'padrao', 'concluido', timestamptz '2026-10-01 10:00+00');
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado, iniciado_em)
    values (e.ws, v_proc, 1, 'Design', 'padrao', 'ativo', timestamptz '2026-10-01 10:00+00');

  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_post, false);
  execute 'reset role';

  select * into r from workflow_posts where id = v_new;
  assert r.workflow_id is null and r.cliente_id = e.cli, 'clone avulso no mesmo cliente';
  select * into r from post_processes where post_id = v_new;
  assert found, 'processo clonado';
  assert r.estado = 'ativo' and r.etapa_atual = 1 and r.revisao = 1 and r.created_by = e.usr,
    format('processo: %s %s %s', r.estado, r.etapa_atual, r.revisao);
  assert r.board_position = 5, format('board_position no fim: %s', r.board_position);
  select count(*) into v_n from post_process_steps where process_id = r.id;
  assert v_n = 2, format('steps: %s', v_n);
  assert (select estado from post_process_steps where process_id = r.id and ordem = 1) = 'ativo', 'etapa ativa mantida';

  -- sem a feature: clone sem processo, sem erro
  update plans set feature_post_processes = false where id = (select plan_id from workspaces where id = e.ws);
  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_post, false);
  execute 'reset role';
  assert not exists (select 1 from post_processes where post_id = v_new), 'sem feature: sem processo';
  raise notice 'PASS 99p.4';
end $$;
rollback;

-- 99p.5 isolamento e grants
begin;
select et_grant_hosted_parity();
do $$
declare e record; o record; v_post bigint; v_raised boolean;
begin
  e := pg_temp.dp_env();
  o := pg_temp.dp_env();
  insert into workflow_posts (workflow_id, conta_id, titulo) values (e.wf, e.ws, 'P') returning id into v_post;

  perform pg_temp.dp_as(o.usr);
  v_raised := false;
  begin
    perform duplicate_post(v_post, false);
  exception when others then
    v_raised := true;
    assert sqlerrm = 'not_found', format('outra conta: %s', sqlerrm);
  end;
  assert v_raised, 'outra conta duplicou o post';
  execute 'reset role';  -- a contagem como o dono da tabela: sob RLS a outra conta enxerga 0
  assert (select count(*) from workflow_posts where workflow_id = e.wf) = 1, 'nada criado';
  perform pg_temp.dp_as(o.usr);

  v_raised := false;
  begin
    perform _clone_post_row(e.ws, v_post, e.wf, false, '{}'::jsonb, true);
  exception when insufficient_privilege then v_raised := true;
  end;
  assert v_raised, 'authenticated executa _clone_post_row';
  execute 'reset role';

  assert not has_function_privilege('anon', 'public.duplicate_post(bigint, boolean)', 'EXECUTE'),
    'anon tem EXECUTE em duplicate_post';
  assert has_function_privilege('service_role', 'public.duplicate_post(bigint, boolean)', 'EXECUTE'),
    'service_role sem EXECUTE em duplicate_post';
  raise notice 'PASS 99p.5';
end $$;
rollback;

-- 99p.6 limite de plano desfaz tudo (max_posts_per_workflow = 2)
begin;
select et_grant_hosted_parity();
do $$
declare e record; p1 bigint; p2 bigint; v_raised boolean;
begin
  e := pg_temp.dp_env();
  insert into workspace_plan_overrides (workspace_id, resource_overrides)
    values (e.ws, '{"max_posts_per_workflow": 2}'::jsonb);
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem) values (e.wf, e.ws, 'P1', 0) returning id into p1;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem) values (e.wf, e.ws, 'P2', 1) returning id into p2;

  perform pg_temp.dp_as(e.usr);
  v_raised := false;
  begin
    perform duplicate_post(p1, false);
  exception when others then
    v_raised := true;
    assert sqlerrm like 'plan_limit_exceeded:max_posts_per_workflow%', format('msg: %s', sqlerrm);
  end;
  execute 'reset role';
  assert v_raised, 'limite nao barrou';
  assert (select count(*) from workflow_posts where workflow_id = e.wf) = 2, 'post criado apesar do limite';
  assert (select ordem from workflow_posts where id = p2) = 1, 'empurrao de ordem nao foi desfeito';
  raise notice 'PASS 99p.6';
end $$;
rollback;
