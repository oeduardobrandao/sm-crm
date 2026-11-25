\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Referências de contas do mesmo tamanho (20261201000003_ig_peer_benchmarks.sql):
-- ig_peer_benchmarks_mercado (sem grant ao CRM), a chave ig_peer_benchmarks_mesaas,
-- ig_peer_benchmarks_refresh() (SECURITY DEFINER) e o cron diário.
-- Spec: docs/superpowers/specs/2026-11-25-ig-account-health-design.md
--
-- Independe do conteúdo do seed: cada caso de refresh apaga o mercado dentro do
-- próprio bloco e insere as linhas de mercado que usa. Contas já existentes no
-- banco ficam inelegíveis (last_synced_at nulo) dentro de cada bloco.
-- As duas tabelas ficam fora do parity helper: os grants delas estão sob teste.

-- Conta elegível na faixa: workspace próprio (plano max), cliente, conta do IG com
-- p_followers, sincronizada há p_synced_days dias, e p_posts posts de feed (IMAGE)
-- com likes = p_likes cada, nos dias 1..p_posts. Devolve o id da conta.
create or replace function pg_temp.pb_acc(p_followers int, p_likes int, p_posts int default 3,
  p_ig_user text default null, p_synced_days numeric default 1) returns uuid language plpgsql as $$
declare v_ws uuid; v_owner uuid := gen_random_uuid(); v_c bigint; v_ia uuid; i int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws := et_make_workspace('max');
  insert into auth.users (id, email) values (v_owner, v_owner || '@pb.test');
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status)
    values (v_owner, v_ws, 'C', 'C', '#111', 'ativo') returning id into v_c;
  insert into instagram_accounts (client_id, instagram_user_id, follower_count, last_synced_at)
    values (v_c, coalesce(p_ig_user, 'pb-' || v_c), p_followers,
            now() - make_interval(secs => p_synced_days * 86400))
    returning id into v_ia;
  for i in 1..p_posts loop
    insert into instagram_posts (instagram_account_id, instagram_post_id, posted_at, likes, comments,
                                 media_type, media_product_type)
      values (v_ia, 'pb-' || gen_random_uuid(), now() - make_interval(days => i), p_likes, 0, 'IMAGE', 'FEED');
  end loop;
  return v_ia;
end $$;

-- p_n contas na faixa 5k_20k (10000 seguidores), a conta i com engagement_rate = i/100.
create or replace function pg_temp.pb_accs(p_n int) returns void language plpgsql as $$
declare i int;
begin
  for i in 1..p_n loop
    perform pg_temp.pb_acc(10000, 100 * i);
  end loop;
end $$;

-- Estado limpo do bloco: nenhuma conta pré-existente elegível, mercado e referências vazios.
create or replace function pg_temp.pb_reset(p_mesaas boolean) returns void language plpgsql as $$
begin
  update instagram_accounts set last_synced_at = null where last_synced_at is not null;
  delete from ig_peer_benchmarks_mercado where true;
  delete from ig_peer_benchmarks where true;  -- a cópia do seed feita pela migration
  update platform_settings set value = jsonb_build_object('enabled', p_mesaas)
   where key = 'ig_peer_benchmarks_mesaas';
  assert found, 'chave ig_peer_benchmarks_mesaas existe';
end $$;

-- 99 cortes crescentes a partir de p_base.
create or replace function pg_temp.pb_cuts(p_base numeric) returns numeric[] language sql as $$
  select array_agg(p_base + g / 1000.0 order by g) from generate_series(1, 99) g
$$;

-- =====================================================================
-- grants e catálogo
-- =====================================================================
begin;
select et_grant_hosted_parity(array['ig_peer_benchmarks', 'ig_peer_benchmarks_mercado']);
do $$
declare v_priv text;
begin
  -- ig_peer_benchmarks: authenticated só lê
  assert has_table_privilege('authenticated', 'public.ig_peer_benchmarks', 'select'),
    'authenticated lê ig_peer_benchmarks';
  foreach v_priv in array array['insert','update','delete','truncate'] loop
    assert not has_table_privilege('authenticated', 'public.ig_peer_benchmarks', v_priv),
      format('authenticated sem %s em ig_peer_benchmarks', v_priv);
  end loop;
  -- ig_peer_benchmarks_mercado: nada para o CRM
  foreach v_priv in array array['select','insert','update','delete','truncate','references','trigger'] loop
    assert not has_table_privilege('authenticated', 'public.ig_peer_benchmarks_mercado', v_priv),
      format('authenticated sem %s em ig_peer_benchmarks_mercado', v_priv);
    assert not has_table_privilege('anon', 'public.ig_peer_benchmarks_mercado', v_priv),
      format('anon sem %s em ig_peer_benchmarks_mercado', v_priv);
    assert not has_table_privilege('anon', 'public.ig_peer_benchmarks', v_priv),
      format('anon sem %s em ig_peer_benchmarks', v_priv);
  end loop;
  assert (select relrowsecurity from pg_class where oid = 'public.ig_peer_benchmarks_mercado'::regclass),
    'ig_peer_benchmarks_mercado com RLS';
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ig_peer_benchmarks_mercado'
                    and column_name = 'source_note'), 'mercado tem source_note';
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'ig_peer_benchmarks_mercado'
                        and column_name in ('cliente_id', 'sample_size')),
    'mercado sem cliente_id e sem sample_size';

  -- refresh: SECURITY DEFINER do postgres, search_path fixo, só service_role executa
  assert (select prosecdef from pg_proc where oid = 'public.ig_peer_benchmarks_refresh()'::regprocedure),
    'refresh é SECURITY DEFINER';
  assert (select pg_get_userbyid(proowner) from pg_proc
           where oid = 'public.ig_peer_benchmarks_refresh()'::regprocedure) = 'postgres', 'refresh do postgres';
  assert (select proconfig from pg_proc where oid = 'public.ig_peer_benchmarks_refresh()'::regprocedure)
         @> array['search_path=public'], 'refresh com search_path=public';
  assert not has_function_privilege('authenticated', 'public.ig_peer_benchmarks_refresh()', 'execute'),
    'authenticated não executa o refresh';
  assert not has_function_privilege('anon', 'public.ig_peer_benchmarks_refresh()', 'execute'),
    'anon não executa o refresh';
  assert has_function_privilege('service_role', 'public.ig_peer_benchmarks_refresh()', 'execute'),
    'service_role executa o refresh';

  -- chave padrão desligada
  assert (select value from platform_settings where key = 'ig_peer_benchmarks_mesaas') = '{"enabled": false}'::jsonb,
    'chave ig_peer_benchmarks_mesaas desligada';
  raise notice 'PASS 99_ig_peer_benchmarks grants';
end $$;
rollback;

-- authenticated de verdade: SELECT em mercado e EXECUTE do refresh dão 42501
begin;
select et_grant_hosted_parity(array['ig_peer_benchmarks', 'ig_peer_benchmarks_mercado']);
create or replace function pg_temp.err_as(p_role text, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    return sqlstate;
  end;
  execute 'reset role';
  return null;
end $f$;
do $$
begin
  assert pg_temp.err_as('authenticated', 'select count(*) from ig_peer_benchmarks_mercado') = '42501',
    'authenticated não lê mercado';
  assert pg_temp.err_as('authenticated', 'select ig_peer_benchmarks_refresh()') = '42501',
    'authenticated não executa o refresh';
  assert pg_temp.err_as('anon', 'select count(*) from ig_peer_benchmarks') = '42501',
    'anon não lê ig_peer_benchmarks';
  assert pg_temp.err_as('authenticated', 'select count(*) from ig_peer_benchmarks') is null,
    'authenticated lê ig_peer_benchmarks (controle positivo)';
  raise notice 'PASS 99_ig_peer_benchmarks roles';
end $$;
rollback;

-- =====================================================================
-- depois da migration: ig_peer_benchmarks = cópia exata do mercado
-- (vale com qualquer seed, inclusive vazio)
-- =====================================================================
do $$
begin
  assert not exists (select 1 from ig_peer_benchmarks where source <> 'mercado' or sample_size is not null),
    'só linhas de mercado depois da migration (chave desligada)';
  assert not exists (
    (select band, metric, cuts, computed_at from ig_peer_benchmarks
     except
     select band, metric, cuts, computed_at from ig_peer_benchmarks_mercado)
    union all
    (select band, metric, cuts, computed_at from ig_peer_benchmarks_mercado
     except
     select band, metric, cuts, computed_at from ig_peer_benchmarks)
  ), 'ig_peer_benchmarks e mercado com o mesmo conjunto de linhas';
  raise notice 'PASS 99_ig_peer_benchmarks copia inicial';
end $$;

-- =====================================================================
-- refresh com chave desligada copia o mercado (fixture própria)
-- =====================================================================
begin;
do $$
declare r record;
begin
  perform pg_temp.pb_reset(false);
  insert into ig_peer_benchmarks (band, metric, source, sample_size, cuts, computed_at)
    values ('lt1k', 'reel_views', 'mesaas', 99, pg_temp.pb_cuts(500), now());  -- some: sem mercado
  insert into ig_peer_benchmarks_mercado (band, metric, cuts, computed_at, source_note) values
    ('5k_20k', 'engagement_rate', pg_temp.pb_cuts(0), '2026-01-02', 'fixture'),
    ('1k_5k', 'posts_30d', pg_temp.pb_cuts(10), '2026-03-04', 'fixture');
  perform ig_peer_benchmarks_refresh();

  assert (select count(*) from ig_peer_benchmarks) = 2, 'só as 2 linhas de mercado';
  select * into r from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate';
  assert r.source = 'mercado' and r.sample_size is null and r.cuts = pg_temp.pb_cuts(0)
     and r.computed_at = '2026-01-02'::timestamptz, 'cópia exata de 5k_20k/engagement_rate';
  select * into r from ig_peer_benchmarks where band = '1k_5k' and metric = 'posts_30d';
  assert r.source = 'mercado' and r.cuts = pg_temp.pb_cuts(10), 'cópia exata de 1k_5k/posts_30d';
  raise notice 'PASS 99_ig_peer_benchmarks refresh copia mercado';
end $$;
rollback;

-- =====================================================================
-- 29 contas, chave ligada: fica mercado; sem mercado e < 30: sem linha
-- =====================================================================
begin;
do $$
declare r record;
begin
  perform pg_temp.pb_reset(true);
  insert into ig_peer_benchmarks_mercado (band, metric, cuts, computed_at, source_note)
    values ('5k_20k', 'engagement_rate', pg_temp.pb_cuts(0), now(), 'fixture');
  perform pg_temp.pb_accs(29);
  perform ig_peer_benchmarks_refresh();

  select * into r from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate';
  assert r.source = 'mercado' and r.sample_size is null and r.cuts = pg_temp.pb_cuts(0),
    '29 contas: engagement_rate continua mercado';
  -- posts_30d e reels_share têm 29 valores e nenhum mercado; reel_views nenhum
  assert not exists (select 1 from ig_peer_benchmarks where band = '5k_20k' and metric <> 'engagement_rate'),
    'sem mercado e < 30 contas: sem linha';
  assert (select count(*) from ig_peer_benchmarks) = 1, 'só a linha de mercado';
  raise notice 'PASS 99_ig_peer_benchmarks 29 contas';
end $$;
rollback;

-- =====================================================================
-- 30 contas, chave ligada: mesaas com 99 cortes e mediana certa
-- =====================================================================
begin;
do $$
declare r record; v_med float8; v_p1 float8;
begin
  perform pg_temp.pb_reset(true);
  insert into ig_peer_benchmarks_mercado (band, metric, cuts, computed_at, source_note) values
    ('5k_20k', 'engagement_rate', pg_temp.pb_cuts(0), now(), 'fixture'),
    ('1k_5k', 'reels_share', pg_temp.pb_cuts(0), now(), 'fixture');   -- outra faixa: segue mercado
  perform pg_temp.pb_accs(30);
  perform ig_peer_benchmarks_refresh();

  -- mediana independente: engagement_rate da conta i = i/100, i = 1..30
  select percentile_cont(0.5) within group (order by (g / 100.0)::float8),
         percentile_cont(0.01) within group (order by (g / 100.0)::float8)
    into v_med, v_p1 from generate_series(1, 30) g;

  select * into r from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate';
  assert r.source = 'mesaas', '30 contas: mesaas, veio ' || coalesce(r.source, 'nada');
  assert r.sample_size = 30, 'sample_size 30, veio ' || coalesce(r.sample_size::text, 'null');
  assert array_length(r.cuts, 1) = 99, '99 cortes';
  assert abs(r.cuts[50] - 0.155) < 1e-9, 'cuts[50] = 0.155, veio ' || r.cuts[50];
  assert abs(r.cuts[50] - v_med::numeric) < 1e-9, 'cuts[50] = mediana das 30';
  assert abs(r.cuts[1] - v_p1::numeric) < 1e-9, 'cuts[1] = p1 das 30';
  assert (select bool_and(r.cuts[i] <= r.cuts[i + 1]) from generate_series(1, 98) i), 'cortes não decrescentes';

  -- sem mercado e >= 30: mesaas (todas as contas têm 3 posts em 30 d e 0 reels)
  select * into r from ig_peer_benchmarks where band = '5k_20k' and metric = 'posts_30d';
  assert r.source = 'mesaas' and r.sample_size = 30 and r.cuts[1] = 3 and r.cuts[99] = 3,
    'posts_30d sem mercado e 30 contas: mesaas';
  select * into r from ig_peer_benchmarks where band = '5k_20k' and metric = 'reels_share';
  assert r.source = 'mesaas' and r.sample_size = 30 and r.cuts[50] = 0, 'reels_share mesaas';
  assert not exists (select 1 from ig_peer_benchmarks where band = '5k_20k' and metric = 'reel_views'),
    'reel_views sem reels e sem mercado: sem linha';
  select * into r from ig_peer_benchmarks where band = '1k_5k' and metric = 'reels_share';
  assert r.source = 'mercado' and r.sample_size is null, 'outra faixa segue no mercado';
  assert (select count(*) from ig_peer_benchmarks) = 4, '4 linhas, veio ' || (select count(*) from ig_peer_benchmarks);
  raise notice 'PASS 99_ig_peer_benchmarks 30 contas';
end $$;
rollback;

-- =====================================================================
-- 30 contas, chave desligada: tudo mercado
-- =====================================================================
begin;
do $$
declare r record;
begin
  perform pg_temp.pb_reset(false);
  insert into ig_peer_benchmarks_mercado (band, metric, cuts, computed_at, source_note)
    values ('5k_20k', 'engagement_rate', pg_temp.pb_cuts(0), now(), 'fixture');
  perform pg_temp.pb_accs(30);
  perform ig_peer_benchmarks_refresh();

  select * into r from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate';
  assert r.source = 'mercado' and r.sample_size is null and r.cuts = pg_temp.pb_cuts(0),
    'chave desligada: mercado';
  assert (select count(*) from ig_peer_benchmarks) = 1, 'chave desligada: nada de mesaas';

  -- mesma base, chave ligada: vira mesaas (controle positivo)
  update platform_settings set value = '{"enabled": true}' where key = 'ig_peer_benchmarks_mesaas';
  perform ig_peer_benchmarks_refresh();
  assert (select source from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate') = 'mesaas',
    'chave ligada: mesaas';
  -- e desligar volta para mercado
  update platform_settings set value = '{"enabled": false}' where key = 'ig_peer_benchmarks_mesaas';
  perform ig_peer_benchmarks_refresh();
  assert (select source from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate') = 'mercado',
    'desligar volta para mercado';
  -- valor malformado: fica desligado, sem erro
  update platform_settings set value = '{"enabled": "yes"}' where key = 'ig_peer_benchmarks_mesaas';
  perform ig_peer_benchmarks_refresh();
  assert (select source from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate') = 'mercado',
    '{"enabled": "yes"} fica em mercado';
  raise notice 'PASS 99_ig_peer_benchmarks chave';
end $$;
rollback;

-- =====================================================================
-- dedup por instagram_user_id: conta uma vez, a de last_synced_at mais recente
-- =====================================================================
begin;
do $$
declare r record;
begin
  perform pg_temp.pb_reset(true);
  insert into ig_peer_benchmarks_mercado (band, metric, cuts, computed_at, source_note)
    values ('5k_20k', 'engagement_rate', pg_temp.pb_cuts(0), now(), 'fixture');
  -- 29 contas distintas + 'dup' em dois workspaces: as duas linhas com posts
  perform pg_temp.pb_accs(29);
  perform pg_temp.pb_acc(10000, 5000, 3, 'dup', 2);
  perform pg_temp.pb_acc(10000, 6000, 3, 'dup', 1);
  perform ig_peer_benchmarks_refresh();
  select * into r from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate';
  assert r.source = 'mesaas' and r.sample_size = 30, 'duas linhas do mesmo IG contam 1: n = 30, veio '
    || coalesce(r.sample_size::text, 'null');
  -- valores 0.01..0.29 + o da linha mais recente (0.6): p99 = 0.29 + 0.71 × 0.31 = 0.5101
  -- (com a mais antiga, 0.5, daria 0.4391)
  assert abs(r.cuts[99] - 0.5101) < 1e-9, 'fica a linha mais recente: p99 0.5101, veio ' || r.cuts[99];
  raise notice 'PASS 99_ig_peer_benchmarks dedup conta uma vez';
end $$;
rollback;

begin;
do $$
declare r record;
begin
  perform pg_temp.pb_reset(true);
  insert into ig_peer_benchmarks_mercado (band, metric, cuts, computed_at, source_note)
    values ('5k_20k', 'engagement_rate', pg_temp.pb_cuts(0), now(), 'fixture');
  -- 29 distintas + 'dup': a mais antiga tem posts, a mais recente não tem nenhum.
  -- Ficando a mais recente, engagement_rate tem 29 valores → mercado.
  perform pg_temp.pb_accs(29);
  perform pg_temp.pb_acc(10000, 5000, 3, 'dup', 2);
  perform pg_temp.pb_acc(10000, 0, 0, 'dup', 1);
  perform ig_peer_benchmarks_refresh();
  select * into r from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate';
  assert r.source = 'mercado', 'dedup fica com a linha mais recente (sem posts): mercado';
  raise notice 'PASS 99_ig_peer_benchmarks dedup';
end $$;
rollback;

-- =====================================================================
-- elegibilidade: sincronizada há 15 dias fica fora; seguidores 0 fica fora
-- =====================================================================
begin;
do $$
declare v_stale uuid;
begin
  perform pg_temp.pb_reset(true);
  insert into ig_peer_benchmarks_mercado (band, metric, cuts, computed_at, source_note)
    values ('5k_20k', 'engagement_rate', pg_temp.pb_cuts(0), now(), 'fixture');
  perform pg_temp.pb_accs(29);
  v_stale := pg_temp.pb_acc(10000, 3000, 3, null, 15);
  perform ig_peer_benchmarks_refresh();
  assert (select source from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate') = 'mercado',
    'sincronizada há 15 dias fica fora';

  update instagram_accounts set last_synced_at = now() - interval '13 days' where id = v_stale;
  perform ig_peer_benchmarks_refresh();
  assert (select source from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate') = 'mesaas',
    'há 13 dias entra (controle positivo)';

  -- seguidores 0: fora (sem faixa); o refresh não quebra com faixa nula
  update instagram_accounts set follower_count = 0 where id = v_stale;
  perform ig_peer_benchmarks_refresh();
  assert (select source from ig_peer_benchmarks where band = '5k_20k' and metric = 'engagement_rate') = 'mercado',
    'seguidores 0 fica fora';
  assert not exists (select 1 from ig_peer_benchmarks where band is null), 'nenhuma linha sem faixa';
  raise notice 'PASS 99_ig_peer_benchmarks elegibilidade';
end $$;
rollback;

-- =====================================================================
-- cron
-- =====================================================================
do $$
begin
  perform 1 from cron.job
   where jobname = 'ig-peer-benchmarks-refresh' and schedule = '53 6 * * *'
     and command ilike '%ig_peer_benchmarks_refresh()%';
  assert found, 'job ig-peer-benchmarks-refresh às 06:53 UTC';
  assert (select count(*) from cron.job where jobname = 'ig-peer-benchmarks-refresh') = 1, 'um job só';
  raise notice 'PASS 99_ig_peer_benchmarks cron';
end $$;
