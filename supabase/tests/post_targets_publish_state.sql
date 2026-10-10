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

-- ===================== Task 2: recompute, writers, reset =====================
-- Helpers de sessão (pg_temp): fluxo pronto, post com destinos semeados pelo z4b
-- (platform 'tiktok' -> {tiktok}; 'both' -> {instagram,tiktok}; 'instagram' -> quadro)
-- e "esta chamada falha com SQLSTATE/mensagem".
create function pg_temp.p4_workflow() returns bigint language plpgsql as $$
declare v_ws uuid := et_make_workspace('pro'); v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
begin
  insert into auth.users (id) values (v_uid);
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_uid, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_uid, 'W', 'ativo') returning id into v_wf;
  return v_wf;
end $$;

create function pg_temp.p4_post(p_wf bigint, p_status text, p_platform text, p_tipo text default 'feed')
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
  select p_wf, w.conta_id, 'p', p_tipo, p_status, p_platform, now() - interval '1 hour'
    from workflows w where w.id = p_wf
  returning id into v_id;
  return v_id;
end $$;

create function pg_temp.p4_expect(p_sql text, p_state text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    assert sqlstate = p_state and sqlerrm = p_msg,
      format('esperado %s/%s, veio %s/%s em: %s', p_state, p_msg, sqlstate, sqlerrm, p_sql);
    return;
  end;
  raise exception 'deveria falhar com %/%: %', p_state, p_msg, p_sql;
end $$;

-- 5. recompute_post_publish_status: matriz TikTok x Instagram x status do post
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; v_r text; v_n int;
begin
  -- 5a TikTok só, destino publicado -> postado (com published_at e evento de status)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  v_r := recompute_post_publish_status(v_p, 'system');
  assert v_r = 'postado', format('5a retorno %s', v_r);
  assert (select status from workflow_posts where id = v_p) = 'postado', '5a post postado';
  assert (select published_at from workflow_posts where id = v_p) is not null, '5a published_at';
  select count(*) into v_n from post_status_events where post_id = v_p and to_status = 'postado';
  assert v_n = 1, format('5a um evento postado, veio %s', v_n);

  -- 5b TikTok só, destino falha -> falha_publicacao
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'falha' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') = 'falha_publicacao', '5b retorno';
  assert (select status from workflow_posts where id = v_p) = 'falha_publicacao', '5b post';

  -- 5c both: Instagram publicado, TikTok pendente -> segue agendado, sem evento novo
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  update workflow_posts set instagram_media_id = 'm1' where id = v_p;
  select count(*) into v_n from post_status_events where post_id = v_p;
  assert recompute_post_publish_status(v_p, 'system') = 'agendado', '5c retorno';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '5c post';
  assert (select count(*) from post_status_events where post_id = v_p) = v_n, '5c sem evento';

  -- 5d both em falha_publicacao, Instagram falhou (publish_error), TikTok publicado -> segue falha
  v_p := pg_temp.p4_post(v_wf, 'falha_publicacao', 'both');
  update workflow_posts set publish_error = 'ig boom' where id = v_p;
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') = 'falha_publicacao', '5d retorno';
  assert (select status from workflow_posts where id = v_p) = 'falha_publicacao', '5d post';

  -- 5e both agendado com publish_error ainda setado (retry do IG em voo) e TikTok
  --    publicado: Instagram conta como em andamento, não como falha
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  update workflow_posts set publish_error = 'ig velho' where id = v_p;
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') = 'agendado', '5e retorno';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '5e post';

  -- 5f postado nunca rebaixa
  v_p := pg_temp.p4_post(v_wf, 'postado', 'tiktok');
  update post_targets set status = 'falha' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') is null, '5f retorno';
  assert (select status from workflow_posts where id = v_p) = 'postado', '5f post';

  -- 5g status do usuário (rascunho) não é tocado
  v_p := pg_temp.p4_post(v_wf, 'rascunho', 'tiktok');
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') is null, '5g retorno';
  assert (select status from workflow_posts where id = v_p) = 'rascunho', '5g post';

  -- 5h só Geral (nenhum destino que publica sozinho) -> NULL, nada muda
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  insert into post_targets (conta_id, post_id, platform)
    select conta_id, id, 'geral' from workflow_posts where id = v_p;
  delete from post_targets where post_id = v_p and platform = 'tiktok';
  assert (select platform from workflow_posts where id = v_p) not in ('instagram','both','tiktok'),
    '5h platform derivado sem social';
  assert recompute_post_publish_status(v_p, 'system') is null, '5h retorno';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '5h post';

  -- 5i Geral ignorado ao lado do TikTok
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  insert into post_targets (conta_id, post_id, platform)
    select conta_id, id, 'geral' from workflow_posts where id = v_p;
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') = 'postado', '5i Geral nao segura o postado';
  raise notice 'PASS p4.5 recompute';
end $$;
rollback;

-- 6. mark_target_published e mark_platform_published copiado para frente
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record;
begin
  -- 6a destino TikTok publicado + post postado na mesma transação
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando', publish_ref = 'pub-6a', processing_at = now(),
         error = 'x', error_code = 'y'
   where post_id = v_p and platform = 'tiktok';
  perform mark_target_published(v_p, 'tiktok',
    jsonb_build_object('external_id', 'tt-6a', 'permalink', 'https://www.tiktok.com/@u/photo/tt-6a',
                       'published_at', '2026-02-01T10:00:00Z'));
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'publicado' and r.external_id = 'tt-6a'
     and r.permalink = 'https://www.tiktok.com/@u/photo/tt-6a'
     and r.published_at = '2026-02-01T10:00:00Z'::timestamptz
     and r.processing_at is null and r.error is null and r.error_code is null
     and r.publish_ref = 'pub-6a',
    format('6a destino: %s', row_to_json(r));
  assert (select status from workflow_posts where id = v_p) = 'postado', '6a post postado';
  -- reentrega sem campos não apaga o que já está lá
  perform mark_target_published(v_p, 'tiktok');
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.external_id = 'tt-6a' and r.published_at = '2026-02-01T10:00:00Z'::timestamptz,
    '6a COALESCE preserva external_id/published_at';

  -- 6b mark_platform_published('tiktok') com as chaves legadas cai no destino
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  perform mark_platform_published(v_p, 'tiktok', 'system', null,
    jsonb_build_object('tiktok_post_id', 'tt-6b', 'tiktok_post_url', 'https://www.tiktok.com/@u/video/tt-6b'));
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'publicado' and r.external_id = 'tt-6b'
     and r.permalink = 'https://www.tiktok.com/@u/video/tt-6b',
    format('6b traducao de chaves: %s', row_to_json(r));
  assert (select tiktok_publish_status is null and tiktok_post_id is null and tiktok_post_url is null
            from workflow_posts where id = v_p), '6b colunas tiktok_* congeladas';
  assert (select status from workflow_posts where id = v_p) = 'postado', '6b post postado';

  -- 6c ramo Instagram: paridade (IG só -> postado; both com TikTok pendente -> agendado)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  perform mark_platform_published(v_p, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'ig-6c'));
  assert (select status from workflow_posts where id = v_p) = 'agendado', '6c both espera o TikTok';
  assert (select instagram_media_id from workflow_posts where id = v_p) = 'ig-6c', '6c media';
  perform mark_target_published(v_p, 'tiktok', jsonb_build_object('external_id', 'tt-6c'));
  assert (select status from workflow_posts where id = v_p) = 'postado', '6c both postado';

  -- 6d recusas
  perform pg_temp.p4_expect(format('select mark_target_published(%s, %L)', v_p, 'instagram'),
    '22023', 'unsupported_platform');
  perform pg_temp.p4_expect('select mark_target_published(-1, ''tiktok'')', 'P0404', 'post_not_found');
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'other');
  perform pg_temp.p4_expect(format('select mark_target_published(%s, %L)', v_p, 'tiktok'),
    'P0404', 'target_not_found');
  raise notice 'PASS p4.6 mark_target_published / mark_platform_published';
end $$;
rollback;

-- 7. mark_target_failed: contagem, erro, idempotência, nunca rebaixa publicado
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record; v_ok boolean;
begin
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando', publish_ref = 'pub-7', processing_at = now()
   where post_id = v_p and platform = 'tiktok';
  v_ok := mark_target_failed(v_p, 'tiktok', repeat('e', 600), 'video_pull_failed', true);
  assert v_ok, '7a primeira falha grava';
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'falha' and r.retry_count = 1 and length(r.error) = 500
     and r.error_code = 'video_pull_failed' and r.processing_at is null and r.publish_ref = 'pub-7',
    format('7a destino: %s', row_to_json(r));
  assert (select status from workflow_posts where id = v_p) = 'falha_publicacao', '7a post';

  -- 7b o mesmo publish relatado de novo (status do cron + webhook failed): nada muda
  v_ok := mark_target_failed(v_p, 'tiktok', 'de novo', null, true);
  assert not v_ok, '7b segunda falha devolve false';
  assert (select retry_count from post_targets where post_id = v_p and platform = 'tiktok') = 1,
    '7b contagem nao dobra';

  -- 7c não-retentável esgota direto
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  perform mark_target_failed(v_p, 'tiktok', 'spam', 'spam_risk_too_many_posts', false);
  assert (select retry_count from post_targets where post_id = v_p and platform = 'tiktok') = 3,
    '7c retry_count = 3';

  -- 7d falha atrasada não rebaixa um destino publicado
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  perform mark_target_published(v_p, 'tiktok', jsonb_build_object('external_id', 'tt-7d'));
  assert not mark_target_failed(v_p, 'tiktok', 'tarde', null, true), '7d devolve false';
  assert (select status from post_targets where post_id = v_p and platform = 'tiktok') = 'publicado',
    '7d segue publicado';
  assert (select status from workflow_posts where id = v_p) = 'postado', '7d post segue postado';
  raise notice 'PASS p4.7 mark_target_failed';
end $$;
rollback;

-- 8. requeue_target
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record;
begin
  -- 8a TikTok só: falha -> agendado, post volta para agendado
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set publish_ref = 'pub-8a' where post_id = v_p and platform = 'tiktok';
  perform mark_target_failed(v_p, 'tiktok', 'boom', 'x', true);
  assert requeue_target(v_p, 'tiktok'), '8a agiu';
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'agendado' and r.error is null and r.error_code is null and r.publish_ref is null
     and r.processing_at is null and r.retry_count = 1,
    format('8a destino: %s', row_to_json(r));
  assert (select status from workflow_posts where id = v_p) = 'agendado', '8a post agendado';

  -- 8b both com os dois lados em falha: o post segue em falha_publicacao (bug 2)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  perform mark_target_failed(v_p, 'tiktok', 'boom', null, true);
  update workflow_posts set publish_error = 'ig boom' where id = v_p;
  assert requeue_target(v_p, 'tiktok'), '8b agiu';
  assert (select status from post_targets where post_id = v_p and platform = 'tiktok') = 'agendado', '8b destino';
  assert (select status from workflow_posts where id = v_p) = 'falha_publicacao', '8b post segue falha';

  -- 8c recusas silenciosas
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  assert not requeue_target(v_p, 'tiktok'), '8c destino pendente';
  v_p := pg_temp.p4_post(v_wf, 'rascunho', 'tiktok');
  update post_targets set status = 'falha' where post_id = v_p and platform = 'tiktok';
  assert not requeue_target(v_p, 'tiktok'), '8c post fora de publicacao';
  assert (select status from post_targets where post_id = v_p and platform = 'tiktok') = 'falha', '8c intacto';
  assert not requeue_target(-1, 'tiktok'), '8c post inexistente';
  raise notice 'PASS p4.8 requeue_target';
end $$;
rollback;

-- 9. begin_target_publish
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record;
begin
  -- 9a aprovado_cliente + pendente: post vai a agendado, trava o destino
  v_p := pg_temp.p4_post(v_wf, 'aprovado_cliente', 'tiktok');
  update workflow_posts set scheduled_at = null where id = v_p;
  assert begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9a tomou a trava';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '9a post agendado';
  -- now() é o instante da transação: o mesmo que a função gravou
  assert (select scheduled_at from workflow_posts where id = v_p) = now(),
    '9a publicar agora carimba scheduled_at (via record_post_status_change)';
  assert (select processing_at is not null and status = 'pendente'
            from post_targets where post_id = v_p and platform = 'tiktok'), '9a trava setada';
  -- 9b trava fresca: false, nada muda
  update workflow_posts set scheduled_at = now() + interval '1 day' where id = v_p;
  assert not begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9b trava segura';
  assert (select scheduled_at from workflow_posts where id = v_p) = now() + interval '1 day',
    '9b trava segura nao mexe em scheduled_at';
  -- 9c trava velha (> 10 min) é retomada
  update post_targets set processing_at = now() - interval '20 minutes'
   where post_id = v_p and platform = 'tiktok';
  assert begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9c trava velha retomada';

  -- 9d post já agendado (o publicar agora do Instagram rodou antes: bug 1)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  update workflow_posts set scheduled_at = now() + interval '3 days' where id = v_p;
  assert begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9d aceita agendado';
  assert (select scheduled_at from workflow_posts where id = v_p) = now(),
    '9d post ja agendado com data futura: scheduled_at carimbado para agora';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '9d post segue agendado';

  -- 9e destino re-enfileirado (agendado) também é aceito
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'agendado' where post_id = v_p and platform = 'tiktok';
  assert begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9e aceita destino agendado';

  -- 9f recusas
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando' where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_publishing');
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_published');
  update post_targets set status = 'falha' where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_not_ready');
  v_p := pg_temp.p4_post(v_wf, 'rascunho', 'tiktok');
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'post_not_publishable');
  assert (select status from workflow_posts where id = v_p) = 'rascunho', '9f recusa nao mexe no post';
  v_p := pg_temp.p4_post(v_wf, 'aprovado_cliente', 'other');
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_not_found');
  perform pg_temp.p4_expect('select begin_target_publish(-1, ''tiktok'', ''workspace_user'')',
    'P0404', 'post_not_found');
  raise notice 'PASS p4.9 begin_target_publish';
end $$;
rollback;

-- 10. cancel_target_publish
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record;
begin
  -- 10a both agendado com container do IG preparado: TikTok volta a pendente,
  --     campos do IG limpos, post em aprovado_cliente
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  update workflow_posts set instagram_container_id = 'c1', publish_error = 'e', publish_error_code = 'X'
   where id = v_p;
  update post_targets set status = 'agendado', error = 'velho', publish_ref = 'pub-old'
   where post_id = v_p and platform = 'tiktok';
  perform cancel_target_publish(v_p, 'tiktok', 'workspace_user');
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'pendente' and r.publish_ref is null and r.error is null and r.processing_at is null,
    format('10a destino: %s', row_to_json(r));
  assert (select status = 'aprovado_cliente' and instagram_container_id is null and publish_error is null
                 and publish_error_code is null and publish_processing_at is null
            from workflow_posts where id = v_p), '10a post e campos do IG';

  -- 10b TikTok só: não manda campos do IG (container fica como estava)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update workflow_posts set instagram_container_id = 'nao-mexe' where id = v_p;
  perform cancel_target_publish(v_p, 'tiktok', 'workspace_user');
  assert (select instagram_container_id from workflow_posts where id = v_p) = 'nao-mexe', '10b IG intacto';

  -- 10c recusas
  v_p := pg_temp.p4_post(v_wf, 'aprovado_cliente', 'tiktok');
  perform pg_temp.p4_expect(format('select cancel_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'post_not_scheduled');
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando' where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select cancel_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_publishing');
  update post_targets set status = 'pendente', processing_at = now() where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select cancel_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_publishing');
  update post_targets set status = 'publicado', processing_at = null where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select cancel_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_published');
  assert (select status from workflow_posts where id = v_p) = 'agendado', '10c recusa nao mexe no post';
  raise notice 'PASS p4.10 cancel_target_publish';
end $$;
rollback;

-- 11. Reset ao sair de publicação (z9) e ACLs
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; v_q bigint; v_s bigint; r record; f text;
begin
  -- 11a falha velha some quando o post volta para rascunho (bug 3)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set publish_ref = 'pub-11' where post_id = v_p and platform = 'tiktok';
  perform mark_target_failed(v_p, 'tiktok', 'boom', 'x', false);
  perform record_post_status_change(v_p, 'rascunho', 'workspace_user', null, null, '{}'::jsonb);
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'pendente' and r.error is null and r.error_code is null
     and r.publish_ref is null and r.retry_count = 0,
    format('11a reset: %s', row_to_json(r));

  -- 11b destino re-enfileirado também volta a pendente (post vai a aprovado_cliente)
  v_q := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'agendado' where post_id = v_q and platform = 'tiktok';
  update workflow_posts set status = 'aprovado_cliente' where id = v_q;
  assert (select status from post_targets where post_id = v_q and platform = 'tiktok') = 'pendente', '11b';

  -- 11c processando e publicado nunca são tocados
  v_s := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando', publish_ref = 'pub-11c'
   where post_id = v_s and platform = 'tiktok';
  update workflow_posts set status = 'rascunho' where id = v_s;
  assert (select status = 'processando' and publish_ref = 'pub-11c'
            from post_targets where post_id = v_s and platform = 'tiktok'), '11c processando fica';
  update post_targets set status = 'publicado' where post_id = v_s and platform = 'tiktok';
  update workflow_posts set status = 'revisao_interna' where id = v_s;
  assert (select status from post_targets where post_id = v_s and platform = 'tiktok') = 'publicado', '11c publicado fica';

  -- 11d dentro de publicação nada é resetado
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'falha', error = 'fica' where post_id = v_p and platform = 'tiktok';
  update workflow_posts set status = 'falha_publicacao' where id = v_p;
  assert (select error from post_targets where post_id = v_p and platform = 'tiktok') = 'fica', '11d';

  -- 11e ACLs: só service_role executa os writers; o recompute é interno
  foreach f in array array[
    'public.mark_target_published(bigint,text,jsonb,text,uuid)',
    'public.mark_target_failed(bigint,text,text,text,boolean,text,uuid)',
    'public.requeue_target(bigint,text,text,uuid)',
    'public.begin_target_publish(bigint,text,text,uuid)',
    'public.cancel_target_publish(bigint,text,text,uuid)',
    'public.mark_platform_published(bigint,text,text,uuid,jsonb)'
  ] loop
    assert not has_function_privilege('anon', f, 'EXECUTE'), format('anon executa %s', f);
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), format('authenticated executa %s', f);
    assert has_function_privilege('service_role', f, 'EXECUTE'), format('service_role sem %s', f);
  end loop;
  f := 'public.recompute_post_publish_status(bigint,text,uuid)';
  assert not has_function_privilege('anon', f, 'EXECUTE'), 'anon executa recompute';
  assert not has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated executa recompute';
  assert not has_function_privilege('anon', 'public.workflow_posts_reset_tiktok_target()', 'EXECUTE'),
    'anon executa a funcao do trigger';
  raise notice 'PASS p4.11 reset z9 e ACLs';
end $$;
rollback;

-- 12. Claim por destino: fase inválida recusada; claim antigo vazio
begin;
do $$
begin
  perform pg_temp.p4_expect('select * from claim_tiktok_targets_for_publishing(''bogus'', 5)',
    '22023', 'invalid_phase');
  perform pg_temp.p4_expect('select * from claim_tiktok_targets_for_publishing(null, 5)',
    '22023', 'invalid_phase');
  assert (select count(*) from claim_posts_for_tiktok_publishing('status', 25)) = 0,
    'claim antigo devolve zero linhas';
  raise notice 'PASS p4.12 claim por destino: fase invalida e claim antigo';
end $$;
rollback;
