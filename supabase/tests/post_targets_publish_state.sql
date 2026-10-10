\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- P4: estado de publicação do TikTok em post_targets
-- (migrations 20261013000001..20261013000003).
-- Spec: docs/superpowers/specs/2026-10-09-tiktok-publish-state-post-targets-design.md
-- Seções 1-4: Task 1 (coluna, backfill, privilégios, guarda de DELETE, a2/z7).
-- Seções 5-11: Task 2 (recompute, writers, reset). Seção 12: Task 3 (claim).

-- 1. publish_ref, índice, mapeamento legado -> destino e backfill com a regra de reset
begin;
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
  v_pub bigint; v_proc bigint; v_fail_live bigint; v_fail_reset bigint; v_none bigint;
  r record; v_bad bigint[]; v_legacy jsonb; v_dest jsonb;
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'post_targets'
                    and column_name = 'publish_ref'), 'post_targets.publish_ref ausente';
  assert exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'post_targets_publish_ref_idx'
                    and indexdef like '%(platform, publish_ref)%'
                    and indexdef like '%WHERE (publish_ref IS NOT NULL)%'),
    'indice parcial (platform, publish_ref) ausente';
  assert not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                      where c.relname = 'post_targets_publish_ref_idx' and i.indisunique),
    'indice de publish_ref nao pode ser unico';

  -- matriz do mapeamento (uma fonte para backfill, paridade e reconcile)
  assert tiktok_legacy_target_status(null, 'agendado') = 'pendente', 'NULL -> pendente';
  assert tiktok_legacy_target_status('initiated', 'agendado') = 'processando', 'initiated -> processando';
  assert tiktok_legacy_target_status('processing', 'rascunho') = 'processando', 'processing nunca reseta';
  assert tiktok_legacy_target_status('published', 'postado') = 'publicado', 'published -> publicado';
  assert tiktok_legacy_target_status('failed', 'falha_publicacao') = 'falha', 'failed em falha_publicacao';
  assert tiktok_legacy_target_status('failed', 'agendado') = 'falha', 'failed em agendado';
  assert tiktok_legacy_target_status('failed', 'postado') = 'falha', 'failed em postado';
  assert tiktok_legacy_target_status('failed', 'rascunho') = 'pendente', 'failed fora de publicacao reseta';
  assert tiktok_legacy_target_status('failed', 'aprovado_cliente') = 'pendente', 'failed em aprovado_cliente reseta';

  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_uid);
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_uid, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_uid, 'W', 'ativo') returning id into v_wf;

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, published_at,
      tiktok_publish_status, tiktok_publish_id, tiktok_post_id, tiktok_post_url)
    values (v_wf, v_ws, 'pub', 'feed', 'postado', 'tiktok', '2026-01-01T10:00:00Z',
      'published', 'pid-pub', 'tt-1', 'https://www.tiktok.com/@x/photo/tt-1')
    returning id into v_pub;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform,
      tiktok_publish_status, tiktok_publish_id, tiktok_publish_processing_at)
    values (v_wf, v_ws, 'proc', 'reels', 'agendado', 'both',
      'processing', 'pid-proc', '2026-01-02T10:00:00Z')
    returning id into v_proc;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform,
      tiktok_publish_status, tiktok_publish_id, tiktok_publish_error, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'fail-live', 'feed', 'falha_publicacao', 'tiktok',
      'failed', 'pid-fail', 'boom', 2)
    returning id into v_fail_live;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform,
      tiktok_publish_status, tiktok_publish_id, tiktok_publish_error, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'fail-reset', 'feed', 'rascunho', 'tiktok',
      'failed', 'pid-old', 'velho', 3)
    returning id into v_fail_reset;
  -- retry legado: status NULL mas tiktok_publish_id velho ficou para trás
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform,
      tiktok_publish_status, tiktok_publish_id, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'none', 'feed', 'agendado', 'tiktok', null, 'pid-stale', 1)
    returning id into v_none;

  -- A migration já rodou antes do teste: chama a MESMA função de backfill que ela
  -- chamou, restrita aos posts deste workspace (5 posts TikTok/both).
  assert tiktok_backfill_targets(v_ws) = 5, 'backfill deve tocar os 5 destinos TikTok do workspace';

  select * into r from post_targets where post_id = v_pub and platform = 'tiktok';
  assert r.status = 'publicado' and r.publish_ref = 'pid-pub' and r.external_id = 'tt-1'
     and r.permalink = 'https://www.tiktok.com/@x/photo/tt-1'
     and r.published_at = '2026-01-01T10:00:00Z'::timestamptz,
    format('publicado: %s', row_to_json(r));

  select * into r from post_targets where post_id = v_proc and platform = 'tiktok';
  assert r.status = 'processando' and r.publish_ref = 'pid-proc'
     and r.processing_at = '2026-01-02T10:00:00Z'::timestamptz and r.published_at is null,
    format('processando: %s', row_to_json(r));
  assert (select status from post_targets where post_id = v_proc and platform = 'instagram') = 'pendente',
    'destino Instagram nao e tocado pelo backfill';

  select * into r from post_targets where post_id = v_fail_live and platform = 'tiktok';
  assert r.status = 'falha' and r.publish_ref = 'pid-fail' and r.error = 'boom' and r.retry_count = 2,
    format('falha: %s', row_to_json(r));

  select * into r from post_targets where post_id = v_fail_reset and platform = 'tiktok';
  assert r.status = 'pendente' and r.publish_ref is null and r.error is null
     and r.error_code is null and r.retry_count = 0,
    format('reset: failed fora de publicacao vira pendente limpo: %s', row_to_json(r));

  select * into r from post_targets where post_id = v_none and platform = 'tiktok';
  assert r.status = 'pendente' and r.publish_ref is null and r.retry_count = 1,
    format('pendente legado nao herda publish_id velho: %s', row_to_json(r));

  -- paridade (as três asserções do DO block da migration, restritas a v_ws)
  select coalesce(jsonb_object_agg(st, n), '{}'::jsonb) into v_legacy from (
    select tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) as st, count(*) as n
      from workflow_posts wp
     where wp.conta_id = v_ws and wp.platform in ('tiktok','both')
     group by 1) s;
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_dest from (
    select t.status, count(*) as n from post_targets t
     where t.conta_id = v_ws and t.platform = 'tiktok'
     group by 1) s;
  assert v_legacy = v_dest, format('paridade por status: %s vs %s', v_legacy, v_dest);

  select array_agg(wp.id) into v_bad from workflow_posts wp
   where wp.conta_id = v_ws and wp.platform in ('tiktok','both')
     and (select count(*) from post_targets t
           where t.post_id = wp.id and t.platform = 'tiktok') <> 1;
  assert v_bad is null, format('tiktok/both sem exatamente um destino TikTok: %s', v_bad);
  select array_agg(t.post_id) into v_bad from post_targets t join workflow_posts wp on wp.id = t.post_id
   where t.conta_id = v_ws and t.platform = 'tiktok' and wp.platform not in ('tiktok','both');
  assert v_bad is null, format('destino TikTok em post sem tiktok/both: %s', v_bad);
  select array_agg(t.post_id) into v_bad from post_targets t join workflow_posts wp on wp.id = t.post_id
   where t.conta_id = v_ws and t.platform = 'tiktok' and wp.tipo = 'stories';
  assert v_bad is null, format('destino TikTok em stories: %s', v_bad);

  assert not has_function_privilege('anon', 'public.tiktok_legacy_target_status(text,text)', 'EXECUTE'),
    'anon executa tiktok_legacy_target_status';
  assert not has_function_privilege('authenticated', 'public.tiktok_legacy_target_status(text,text)', 'EXECUTE'),
    'authenticated executa tiktok_legacy_target_status';
  assert not has_function_privilege('anon', 'public.tiktok_backfill_targets(uuid)', 'EXECUTE'),
    'anon executa tiktok_backfill_targets';
  assert not has_function_privilege('authenticated', 'public.tiktok_backfill_targets(uuid)', 'EXECUTE'),
    'authenticated executa tiktok_backfill_targets';
  assert has_function_privilege('service_role', 'public.tiktok_backfill_targets(uuid)', 'EXECUTE'),
    'service_role deve executar tiktok_backfill_targets';
  raise notice 'PASS p4.1 publish_ref, mapeamento e backfill';
end $$;
rollback;

-- 2. Privilégios de coluna: authenticated não grava estado de publicação; a
--    semente de destinos (DEFINER) segue funcionando para um post criado por ele.
begin;
-- post_targets fora da parity: o helper daria ALL e desfaria os grants sob teste.
select et_grant_hosted_parity(array['post_targets']);
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint; v_p bigint;
  v_n int; v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W', 'ativo') returning id into v_wf;

  assert not has_table_privilege('authenticated', 'public.post_targets', 'UPDATE'),
    'authenticated ainda tem UPDATE de tabela inteira';
  assert not has_table_privilege('authenticated', 'public.post_targets', 'INSERT'),
    'authenticated ainda tem INSERT de tabela inteira';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'status', 'UPDATE'), 'UPDATE status';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'external_id', 'UPDATE'), 'UPDATE external_id';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'permalink', 'UPDATE'), 'UPDATE permalink';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'publish_ref', 'UPDATE'), 'UPDATE publish_ref';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'platform', 'UPDATE'), 'UPDATE platform';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'status', 'INSERT'), 'INSERT status';
  assert has_column_privilege('authenticated', 'public.post_targets', 'caption', 'UPDATE'), 'UPDATE caption';
  assert has_column_privilege('authenticated', 'public.post_targets', 'platform', 'INSERT'), 'INSERT platform';
  assert has_table_privilege('authenticated', 'public.post_targets', 'SELECT'), 'SELECT';
  assert has_table_privilege('authenticated', 'public.post_targets', 'DELETE'), 'DELETE';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'p', 'feed', 'both') returning id into v_p;
  select count(*) into v_n from post_targets
   where post_id = v_p and platform in ('instagram','tiktok');
  assert v_n = 2, format('seed de destinos como authenticated: %s', v_n);

  v_rejected := false;
  begin update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'authenticated gravou status';

  v_rejected := false;
  begin update post_targets set external_id = 'x' where post_id = v_p and platform = 'tiktok';
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'authenticated gravou external_id';

  v_rejected := false;
  begin update post_targets set publish_ref = 'x' where post_id = v_p and platform = 'tiktok';
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'authenticated gravou publish_ref';

  v_rejected := false;
  begin insert into post_targets (conta_id, post_id, platform, status) values (v_ws, v_p, 'geral', 'publicado');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'authenticated inseriu destino com status';

  update post_targets set caption = 'ok' where post_id = v_p and platform = 'tiktok';
  get diagnostics v_n = row_count;
  assert v_n = 1, 'authenticated deve poder gravar caption';
  insert into post_targets (conta_id, post_id, platform, caption) values (v_ws, v_p, 'geral', 'g');
  raise notice 'PASS p4.2 privilegios de coluna';
end $$;
rollback;

-- 3. Guarda de DELETE: processando/publicado não saem enquanto o post existe;
--    a cascata do DELETE do post passa.
begin;
select et_grant_hosted_parity(array['post_targets']);
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint; v_p bigint; v_q bigint;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'p', 'feed', 'both') returning id into v_p;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'q', 'feed', 'both') returning id into v_q;

  -- dono da tabela (stand-in do service_role): o trigger vale para qualquer papel
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  v_rejected := false;
  begin delete from post_targets where post_id = v_p and platform = 'tiktok';
  exception when sqlstate 'P0409' then
    assert sqlerrm = 'target_not_removable', format('mensagem: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'DELETE de destino publicado passou';

  update post_targets set status = 'processando' where post_id = v_q and platform = 'tiktok';
  v_rejected := false;
  begin delete from post_targets where post_id = v_q and platform = 'tiktok';
  exception when sqlstate 'P0409' then v_rejected := true; end;
  assert v_rejected, 'DELETE de destino processando passou';

  -- pendente sai normalmente
  delete from post_targets where post_id = v_q and platform = 'instagram';
  assert not exists (select 1 from post_targets where post_id = v_q and platform = 'instagram'),
    'destino pendente deve sair';

  -- como authenticated (caminho do CRM, removePostDestination)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rejected := false;
  begin delete from post_targets where post_id = v_p and platform = 'tiktok';
  exception when sqlstate 'P0409' then v_rejected := true; end;
  assert v_rejected, 'authenticated tirou destino publicado';
  execute 'reset role';

  -- cascata: o post sai com o destino publicado junto
  delete from workflow_posts where id = v_p;
  assert not exists (select 1 from post_targets where post_id = v_p),
    'cascata do DELETE do post deve levar o destino publicado';
  raise notice 'PASS p4.3 guarda de DELETE';
end $$;
rollback;

-- 4. a2 e z7 copiados para frente: escrita legada de platform e virar stories
--    deixam um destino TikTok publicando/publicado no lugar, sem erro.
begin;
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
  v_pub bigint; v_proc bigint; v_pend bigint; v_plat text;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_uid);
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_uid, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_uid, 'W', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'pub', 'reels', 'both') returning id into v_pub;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'proc', 'reels', 'both') returning id into v_proc;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'pend', 'reels', 'both') returning id into v_pend;
  update post_targets set status = 'publicado' where post_id = v_pub and platform = 'tiktok';
  update post_targets set status = 'processando' where post_id = v_proc and platform = 'tiktok';

  -- a2: PlatformSelector grava 'instagram'
  update workflow_posts set platform = 'instagram' where id = v_pub;
  assert (select status from post_targets where post_id = v_pub and platform = 'tiktok') = 'publicado',
    'a2 apagou destino TikTok publicado';
  select platform into v_plat from workflow_posts where id = v_pub;
  assert v_plat = 'both', format('platform segue derivado do que restou: %s', v_plat);

  -- controle: pendente sai como antes
  update workflow_posts set platform = 'instagram' where id = v_pend;
  assert not exists (select 1 from post_targets where post_id = v_pend and platform = 'tiktok'),
    'a2 deve continuar tirando destino TikTok pendente';
  select platform into v_plat from workflow_posts where id = v_pend;
  assert v_plat = 'instagram', format('controle a2: %s', v_plat);

  -- z7: virou stories
  update workflow_posts set tipo = 'stories' where id = v_proc;
  assert (select status from post_targets where post_id = v_proc and platform = 'tiktok') = 'processando',
    'z7 apagou destino TikTok processando';
  update workflow_posts set tipo = 'stories' where id = v_pub;
  assert exists (select 1 from post_targets where post_id = v_pub and platform = 'tiktok'),
    'z7 apagou destino TikTok publicado';
  raise notice 'PASS p4.4 a2/z7 respeitam a guarda de DELETE';
end $$;
rollback;
