\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Saúde da conta do Instagram (20261201000002_ig_account_health_metrics.sql):
-- ig_follower_band, ig_account_health_metrics (as 4 métricas, só SQL),
-- ig_account_health (RPC do CRM, SECURITY INVOKER: RLS e acesso por cliente
-- valem) e a tabela ig_peer_benchmarks (agregada, SELECT para authenticated).
-- Spec: docs/superpowers/specs/2026-11-25-ig-account-health-design.md
--
-- ig_peer_benchmarks fica fora do parity helper: os grants dela estão sob teste.

-- Workspace + cliente + conta do Instagram com p_followers. Devolve os ids.
create or replace function pg_temp.ih_seed(p_followers int) returns jsonb language plpgsql as $$
declare v_ws uuid; v_owner uuid := gen_random_uuid(); v_c bigint; v_ia uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws := et_make_workspace('max');
  insert into auth.users (id, email) values (v_owner, v_owner || '@ih.test');
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status)
    values (v_owner, v_ws, 'C', 'C', '#111', 'ativo') returning id into v_c;
  insert into instagram_accounts (client_id, instagram_user_id, follower_count)
    values (v_c, 'ig-' || v_c, p_followers) returning id into v_ia;
  return jsonb_build_object('ws', v_ws, 'owner', v_owner, 'client', v_c, 'acc', v_ia);
end $$;

-- Um post: dias atrás, likes, comments, media_type, media_product_type, impressions.
create or replace function pg_temp.ih_post(p_acc uuid, p_days numeric, p_likes int, p_comments int,
  p_type text default 'IMAGE', p_product text default 'FEED', p_impr int default 0,
  p_unavail text[] default '{}') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into instagram_posts (instagram_account_id, instagram_post_id, posted_at, likes, comments,
                               media_type, media_product_type, impressions, unavailable_metrics)
    values (p_acc, 'p-' || gen_random_uuid(), now() - make_interval(secs => p_days * 86400),
            p_likes, p_comments, p_type, p_product, p_impr, p_unavail)
    returning id into v;
  return v;
end $$;

create or replace function pg_temp.ih_m(p_acc uuid)
returns table(engagement_rate numeric, posts_30d int, reel_views numeric, reels_share numeric,
              best_post_id uuid, best_post_ratio numeric)
language sql as $$ select * from ig_account_health_metrics(p_acc) $$;

-- =====================================================================
-- ig_follower_band
-- =====================================================================
do $$
begin
  assert ig_follower_band(999) = 'lt1k', 'band 999';
  assert ig_follower_band(1) = 'lt1k', 'band 1';
  assert ig_follower_band(1000) = '1k_5k', 'band 1000';
  assert ig_follower_band(4999) = '1k_5k', 'band 4999';
  assert ig_follower_band(5000) = '5k_20k', 'band 5000';
  assert ig_follower_band(19999) = '5k_20k', 'band 19999';
  assert ig_follower_band(20000) = '20k_100k', 'band 20000';
  assert ig_follower_band(99999) = '20k_100k', 'band 99999';
  assert ig_follower_band(100000) = '100k_plus', 'band 100000';
  assert ig_follower_band(0) is null, 'band 0';
  assert ig_follower_band(-5) is null, 'band negativo';
  assert ig_follower_band(null) is null, 'band null';
  assert (select provolatile from pg_proc where oid = 'public.ig_follower_band(int)'::regprocedure) = 'i',
    'ig_follower_band IMMUTABLE';
  raise notice 'PASS 99_ig_account_health_metrics band';
end $$;

-- =====================================================================
-- grants e catálogo
-- =====================================================================
begin;
do $$
declare v_priv text;
begin
  -- funções: anon nunca; authenticated e service_role executam
  assert not has_function_privilege('anon', 'public.ig_account_health(bigint)', 'execute'),
    'anon sem EXECUTE em ig_account_health';
  assert not has_function_privilege('anon', 'public.ig_account_health_metrics(uuid)', 'execute'),
    'anon sem EXECUTE em ig_account_health_metrics';
  assert has_function_privilege('authenticated', 'public.ig_account_health(bigint)', 'execute'),
    'authenticated executa ig_account_health';
  assert has_function_privilege('authenticated', 'public.ig_account_health_metrics(uuid)', 'execute'),
    'authenticated executa ig_account_health_metrics (chamada pela RPC invoker)';
  assert has_function_privilege('authenticated', 'public.ig_follower_band(int)', 'execute'),
    'authenticated executa ig_follower_band';
  assert has_function_privilege('service_role', 'public.ig_account_health_metrics(uuid)', 'execute'),
    'service_role executa ig_account_health_metrics';
  -- SECURITY INVOKER + STABLE + search_path fixo
  assert not (select prosecdef from pg_proc where oid = 'public.ig_account_health(bigint)'::regprocedure),
    'ig_account_health é SECURITY INVOKER';
  assert not (select prosecdef from pg_proc where oid = 'public.ig_account_health_metrics(uuid)'::regprocedure),
    'ig_account_health_metrics é SECURITY INVOKER';
  assert (select provolatile from pg_proc where oid = 'public.ig_account_health(bigint)'::regprocedure) = 's',
    'ig_account_health STABLE';
  assert (select provolatile from pg_proc where oid = 'public.ig_account_health_metrics(uuid)'::regprocedure) = 's',
    'ig_account_health_metrics STABLE';
  assert (select proconfig from pg_proc where oid = 'public.ig_account_health_metrics(uuid)'::regprocedure)
         @> array['search_path=public'], 'ig_account_health_metrics com search_path=public';
  assert (select proconfig from pg_proc where oid = 'public.ig_account_health(bigint)'::regprocedure)
         @> array['search_path=public'], 'ig_account_health com search_path=public';

  -- tabela: RLS ligada, SELECT só para authenticated, nada para anon
  assert (select relrowsecurity from pg_class where oid = 'public.ig_peer_benchmarks'::regclass),
    'ig_peer_benchmarks com RLS';
  assert has_table_privilege('authenticated', 'public.ig_peer_benchmarks', 'select'),
    'authenticated lê ig_peer_benchmarks';
  foreach v_priv in array array['insert','update','delete','truncate','references','trigger'] loop
    assert not has_table_privilege('authenticated', 'public.ig_peer_benchmarks', v_priv),
      format('authenticated sem %s em ig_peer_benchmarks', v_priv);
  end loop;
  foreach v_priv in array array['select','insert','update','delete','truncate','references','trigger'] loop
    assert not has_table_privilege('anon', 'public.ig_peer_benchmarks', v_priv),
      format('anon sem %s em ig_peer_benchmarks', v_priv);
  end loop;
  assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ig_peer_benchmarks'
                   and cmd = 'SELECT' and roles @> array['authenticated']::name[]),
    'policy SELECT para authenticated';
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'ig_peer_benchmarks'
                        and column_name = 'cliente_id'),
    'ig_peer_benchmarks sem cliente_id (fora do drift)';
  raise notice 'PASS 99_ig_account_health_metrics grants';
end $$;
rollback;

-- =====================================================================
-- ig_peer_benchmarks: constraints
-- =====================================================================
begin;
delete from public.ig_peer_benchmarks;
do $$
declare v_cuts numeric[] := (select array_agg(g::numeric) from generate_series(1, 99) g);
begin
  insert into ig_peer_benchmarks (band, metric, source, sample_size, cuts, computed_at)
    values ('5k_20k', 'engagement_rate', 'mercado', null, v_cuts, now());
  begin
    insert into ig_peer_benchmarks (band, metric, source, cuts, computed_at)
      values ('5k_20k', 'posts_30d', 'mercado', v_cuts[1:98], now());
    assert false, '98 cortes deveria falhar';
  exception when check_violation then null;
  end;
  begin
    insert into ig_peer_benchmarks (band, metric, source, cuts, computed_at)
      values ('5k_20k', 'posts_30d', 'outro', v_cuts, now());
    assert false, 'source inválido deveria falhar';
  exception when check_violation then null;
  end;
  begin
    insert into ig_peer_benchmarks (band, metric, source, cuts, computed_at)
      values ('5k_20k', 'engagement_rate', 'mesaas', v_cuts, now());
    assert false, 'pk (band, metric) duplicada deveria falhar';
  exception when unique_violation then null;
  end;
  raise notice 'PASS 99_ig_account_health_metrics table constraints';
end $$;
rollback;

-- =====================================================================
-- engagement_rate: mediana dos 12 feed mais recentes em 90 d ÷ seguidores
-- =====================================================================
begin;
do $$
declare s jsonb := pg_temp.ih_seed(10000); v_acc uuid := (s->>'acc')::uuid; i int; m record;
begin
  -- 12 feed (1..23 dias) com likes+comments 100..210; o mais recente tem 210
  for i in 0..11 loop
    perform pg_temp.ih_post(v_acc, 1 + (11 - i) * 2, 90 + i * 10, 10);
  end loop;
  -- 13º mais antigo (dentro de 90 d) com engajamento enorme: fora do top 12
  perform pg_temp.ih_post(v_acc, 60, 100000, 0);
  -- fora dos 90 d e story: ignorados
  perform pg_temp.ih_post(v_acc, 95, 100000, 0);
  perform pg_temp.ih_post(v_acc, 0.5, 100000, 0, 'STORY', null);
  select * into m from pg_temp.ih_m(v_acc);
  assert m.engagement_rate = 0.0155, 'engagement_rate 0.0155, veio ' || coalesce(m.engagement_rate::text, 'null');

  -- seguidores 0 → nulo
  update instagram_accounts set follower_count = 0 where id = v_acc;
  select * into m from pg_temp.ih_m(v_acc);
  assert m.engagement_rate is null, 'engagement_rate nulo com 0 seguidores';
  raise notice 'PASS 99_ig_account_health_metrics engagement_rate';
end $$;
rollback;

begin;
do $$
declare s jsonb := pg_temp.ih_seed(1000); v_acc uuid := (s->>'acc')::uuid; m record;
begin
  -- 2 feed → nulo; 3 → valor
  perform pg_temp.ih_post(v_acc, 2, 10, 0);
  perform pg_temp.ih_post(v_acc, 3, 20, 0);
  perform pg_temp.ih_post(v_acc, 4, 5000, 0, 'STORY', null);
  select * into m from pg_temp.ih_m(v_acc);
  assert m.engagement_rate is null, 'engagement_rate nulo com 2 posts';
  assert m.reels_share is null, 'reels_share nulo com 2 posts';
  perform pg_temp.ih_post(v_acc, 5, 30, 0);
  select * into m from pg_temp.ih_m(v_acc);
  assert m.engagement_rate = 0.02, 'engagement_rate 20/1000, veio ' || coalesce(m.engagement_rate::text, 'null');
  raise notice 'PASS 99_ig_account_health_metrics engagement_rate amostra';
end $$;
rollback;

-- =====================================================================
-- posts_30d
-- =====================================================================
begin;
do $$
declare s jsonb := pg_temp.ih_seed(5000); v_acc uuid := (s->>'acc')::uuid; i int; m record;
begin
  -- nenhum feed em 90 d (só antigo e story) → nulo
  perform pg_temp.ih_post(v_acc, 100, 10, 0);
  perform pg_temp.ih_post(v_acc, 2, 10, 0, 'STORY', null);
  select * into m from pg_temp.ih_m(v_acc);
  assert m.posts_30d is null, 'posts_30d nulo sem feed em 90 d';
  assert m.engagement_rate is null and m.reel_views is null and m.reels_share is null
     and m.best_post_id is null and m.best_post_ratio is null, 'tudo nulo sem feed em 90 d';

  -- 4 entre 31 e 89 d → 0 é valor válido
  perform pg_temp.ih_post(v_acc, 31, 10, 0);
  perform pg_temp.ih_post(v_acc, 45, 10, 0);
  perform pg_temp.ih_post(v_acc, 60, 10, 0);
  perform pg_temp.ih_post(v_acc, 89, 10, 0);
  select * into m from pg_temp.ih_m(v_acc);
  assert m.posts_30d = 0, 'posts_30d = 0, veio ' || coalesce(m.posts_30d::text, 'null');

  -- + 8 em 30 d → 8
  for i in 1..8 loop
    perform pg_temp.ih_post(v_acc, i * 3, 10, 0, case when i % 2 = 0 then 'VIDEO' else 'CAROUSEL_ALBUM' end,
                            case when i % 2 = 0 then 'REELS' else 'FEED' end);
  end loop;
  select * into m from pg_temp.ih_m(v_acc);
  assert m.posts_30d = 8, 'posts_30d = 8, veio ' || coalesce(m.posts_30d::text, 'null');
  raise notice 'PASS 99_ig_account_health_metrics posts_30d';
end $$;
rollback;

-- =====================================================================
-- reel_views
-- =====================================================================
begin;
do $$
declare s jsonb := pg_temp.ih_seed(5000); v_acc uuid := (s->>'acc')::uuid; m record;
begin
  perform pg_temp.ih_post(v_acc, 2, 1, 0, 'VIDEO', 'REELS', 1000);
  perform pg_temp.ih_post(v_acc, 3, 1, 0, 'VIDEO', null, 2000);           -- histórico sem o campo: reel
  -- não contam: VIDEO de feed, reel sem impressions, reel antigo, story
  perform pg_temp.ih_post(v_acc, 4, 1, 0, 'VIDEO', 'FEED', 900000);
  perform pg_temp.ih_post(v_acc, 5, 1, 0, 'VIDEO', 'REELS', 900000, array['impressions']);
  perform pg_temp.ih_post(v_acc, 95, 1, 0, 'VIDEO', 'REELS', 900000);
  perform pg_temp.ih_post(v_acc, 1, 1, 0, 'STORY', null, 900000);
  select * into m from pg_temp.ih_m(v_acc);
  assert m.reel_views is null, 'reel_views nulo com 2 reels válidos, veio ' || coalesce(m.reel_views::text, 'null');

  perform pg_temp.ih_post(v_acc, 6, 1, 0, 'VIDEO', 'REELS', 3000);
  select * into m from pg_temp.ih_m(v_acc);
  assert m.reel_views = 2000, 'reel_views 2000, veio ' || coalesce(m.reel_views::text, 'null');
  raise notice 'PASS 99_ig_account_health_metrics reel_views';
end $$;
rollback;

-- =====================================================================
-- reels_share
-- =====================================================================
begin;
do $$
declare s jsonb := pg_temp.ih_seed(5000); v_acc uuid := (s->>'acc')::uuid; i int; m record;
begin
  -- 12 feed mais recentes: 8 reels (6 REELS + 2 VIDEO nulo) e 4 não reels (1 VIDEO de feed)
  for i in 1..6 loop perform pg_temp.ih_post(v_acc, i, 1, 0, 'VIDEO', 'REELS'); end loop;
  for i in 7..8 loop perform pg_temp.ih_post(v_acc, i, 1, 0, 'VIDEO', null); end loop;
  perform pg_temp.ih_post(v_acc, 9, 1, 0, 'VIDEO', 'FEED');
  perform pg_temp.ih_post(v_acc, 10, 1, 0, 'IMAGE', 'FEED');
  perform pg_temp.ih_post(v_acc, 11, 1, 0, 'CAROUSEL_ALBUM', 'FEED');
  perform pg_temp.ih_post(v_acc, 12, 1, 0, 'IMAGE', null);
  -- fora do top 12 (mais antigo), e stories: não mudam a razão
  perform pg_temp.ih_post(v_acc, 40, 1, 0, 'VIDEO', 'REELS');
  perform pg_temp.ih_post(v_acc, 0.5, 1, 0, 'STORY', null);
  perform pg_temp.ih_post(v_acc, 0.6, 1, 0, 'STORY', 'STORY');
  select * into m from pg_temp.ih_m(v_acc);
  assert round(m.reels_share, 4) = 0.6667, 'reels_share 0.6667, veio ' || coalesce(m.reels_share::text, 'null');
  assert m.posts_30d = 12, 'stories fora do posts_30d, veio ' || coalesce(m.posts_30d::text, 'null');
  raise notice 'PASS 99_ig_account_health_metrics reels_share';
end $$;
rollback;

-- =====================================================================
-- melhor post
-- =====================================================================
begin;
do $$
declare s jsonb := pg_temp.ih_seed(5000); v_acc uuid := (s->>'acc')::uuid; v_best uuid; m record;
begin
  perform pg_temp.ih_post(v_acc, 5, 100, 0);
  select * into m from pg_temp.ih_m(v_acc);
  assert m.best_post_id is null and m.best_post_ratio is null, 'melhor post nulo com 1 post em 30 d';

  v_best := pg_temp.ih_post(v_acc, 10, 120, 20);   -- 140
  perform pg_temp.ih_post(v_acc, 40, 60, 0);
  perform pg_temp.ih_post(v_acc, 50, 100, 0);
  perform pg_temp.ih_post(v_acc, 70, 100, 0);
  perform pg_temp.ih_post(v_acc, 2, 100000, 0, 'STORY', null);   -- story ignorado
  perform pg_temp.ih_post(v_acc, 100, 100000, 0);                -- fora dos 90 d
  select * into m from pg_temp.ih_m(v_acc);
  assert m.best_post_ratio = 1.4, 'best_post_ratio 1.4, veio ' || coalesce(m.best_post_ratio::text, 'null');
  assert m.best_post_id = v_best, 'best_post_id = o de 140';
  raise notice 'PASS 99_ig_account_health_metrics best_post';
end $$;
rollback;

begin;
do $$
declare s jsonb := pg_temp.ih_seed(5000); v_acc uuid := (s->>'acc')::uuid; m record;
begin
  -- mediana 0 → nulo
  perform pg_temp.ih_post(v_acc, 5, 0, 0);
  perform pg_temp.ih_post(v_acc, 6, 0, 0);
  perform pg_temp.ih_post(v_acc, 40, 10, 0);
  select * into m from pg_temp.ih_m(v_acc);
  assert m.best_post_id is null and m.best_post_ratio is null, 'melhor post nulo com mediana 0';
  raise notice 'PASS 99_ig_account_health_metrics best_post mediana zero';
end $$;
rollback;

-- =====================================================================
-- ig_account_health: formato do JSON
-- =====================================================================
begin;
delete from public.ig_peer_benchmarks;
do $$
declare
  s jsonb := pg_temp.ih_seed(10000); v_acc uuid := (s->>'acc')::uuid; v_c bigint := (s->>'client')::bigint;
  v_cuts numeric[] := (select array_agg((g / 1000.0)::numeric) from generate_series(1, 99) g);
  i int; v_best uuid; j jsonb;
begin
  -- sem posts: métricas nulas, best_post null, benchmarks []
  j := ig_account_health(v_c);
  assert j = jsonb_build_object('followers', 10000, 'band', '5k_20k',
    'metrics', jsonb_build_object('engagement_rate', null, 'posts_30d', null, 'reel_views', null, 'reels_share', null),
    'best_post', null, 'benchmarks', '[]'::jsonb), 'json sem posts: ' || j::text;
  assert jsonb_typeof(j->'best_post') = 'null' and jsonb_typeof(j->'benchmarks') = 'array', 'tipos sem posts';

  -- cliente sem conta → null
  assert ig_account_health(-1) is null, 'cliente inexistente → null';

  for i in 0..11 loop
    perform pg_temp.ih_post(v_acc, 1 + (11 - i) * 2, 90 + i * 10, 10,
      case when i < 4 then 'VIDEO' else 'IMAGE' end, case when i < 4 then 'REELS' else 'FEED' end, 1000 * (i + 1));
  end loop;
  insert into ig_peer_benchmarks (band, metric, source, sample_size, cuts, computed_at) values
    ('5k_20k', 'engagement_rate', 'mesaas', 42, v_cuts, now()),
    ('5k_20k', 'posts_30d', 'mercado', null, v_cuts, now()),
    ('1k_5k', 'engagement_rate', 'mercado', null, v_cuts, now());
  j := ig_account_health(v_c);
  raise notice 'sample ig_account_health: %', j::text;

  assert (select array_agg(k order by k) from jsonb_object_keys(j) k)
         = array['band','benchmarks','best_post','followers','metrics'], 'chaves do topo';
  assert (select array_agg(k order by k) from jsonb_object_keys(j->'metrics') k)
         = array['engagement_rate','posts_30d','reel_views','reels_share'], 'chaves de metrics';
  assert (select array_agg(k order by k) from jsonb_object_keys(j->'best_post') k) = array['id','ratio'], 'chaves de best_post';
  assert jsonb_typeof(j->'followers') = 'number' and (j->>'followers')::int = 10000, 'followers';
  assert j->>'band' = '5k_20k', 'band';
  assert (j->'metrics'->>'engagement_rate')::numeric = 0.0155, 'engagement_rate no json';
  assert jsonb_typeof(j->'metrics'->'engagement_rate') = 'number', 'engagement_rate número';
  assert (j->'metrics'->>'posts_30d')::int = 12, 'posts_30d no json (todos entre 1 e 23 d)';
  assert (j->'metrics'->>'reel_views')::numeric = 2500, 'reel_views no json';
  assert round((j->'metrics'->>'reels_share')::numeric, 4) = 0.3333, 'reels_share no json';
  select id into v_best from instagram_posts where instagram_account_id = v_acc order by likes desc limit 1;
  assert (j->'best_post'->>'id')::uuid = v_best, 'best_post.id';
  assert jsonb_typeof(j->'best_post'->'ratio') = 'number', 'best_post.ratio número';

  -- benchmarks: só a faixa da conta, ordenados por métrica
  assert jsonb_array_length(j->'benchmarks') = 2, 'benchmarks da faixa: ' || (j->'benchmarks')::text;
  assert (select array_agg(k order by k) from jsonb_object_keys(j->'benchmarks'->0) k)
         = array['cuts','metric','sample_size','source'], 'chaves de benchmark';
  assert j->'benchmarks'->0->>'metric' = 'engagement_rate' and j->'benchmarks'->0->>'source' = 'mesaas'
     and (j->'benchmarks'->0->>'sample_size')::int = 42, 'benchmark mesaas';
  assert jsonb_typeof(j->'benchmarks'->0->'cuts') = 'array' and jsonb_array_length(j->'benchmarks'->0->'cuts') = 99
     and jsonb_typeof(j->'benchmarks'->0->'cuts'->0) = 'number'
     and (j->'benchmarks'->0->'cuts'->>0)::numeric = 0.001, 'cuts: 99 números';
  assert j->'benchmarks'->1->>'metric' = 'posts_30d' and j->'benchmarks'->1->>'source' = 'mercado'
     and jsonb_typeof(j->'benchmarks'->1->'sample_size') = 'null', 'benchmark mercado com sample_size null';

  -- seguidores 0: band null, benchmarks []
  update instagram_accounts set follower_count = 0 where id = v_acc;
  j := ig_account_health(v_c);
  assert jsonb_typeof(j->'band') = 'null' and j->'benchmarks' = '[]'::jsonb
     and (j->>'followers')::int = 0 and jsonb_typeof(j->'metrics'->'engagement_rate') = 'null',
    'seguidores 0: ' || j::text;
  raise notice 'PASS 99_ig_account_health_metrics json shape';
end $$;
rollback;

-- =====================================================================
-- RLS e acesso por cliente (como authenticated)
-- =====================================================================
begin;
delete from public.ig_peer_benchmarks;
select et_grant_hosted_parity(array['ig_peer_benchmarks']);
update plans set feature_acesso_por_cliente = true;

-- ig_account_health(p_client) como p_user
create or replace function pg_temp.h_as(p_user uuid, p_client bigint) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := ig_account_health(p_client);
  execute 'reset role';
  return v;
end $f$;
-- ig_account_health_metrics(p_acc) como p_user: número de linhas com algum valor
create or replace function pg_temp.m_as(p_user uuid, p_acc uuid) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v from ig_account_health_metrics(p_acc) m
   where m.engagement_rate is not null or m.posts_30d is not null or m.reel_views is not null
      or m.reels_share is not null or m.best_post_id is not null or m.best_post_ratio is not null;
  execute 'reset role';
  return v;
end $f$;
-- SQLSTATE de chamar ig_account_health como anon
create or replace function pg_temp.err_anon(p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
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
declare
  s_a jsonb := pg_temp.ih_seed(10000); s_b jsonb := pg_temp.ih_seed(3000);
  v_ws_a uuid := (s_a->>'ws')::uuid;
  v_owner_a uuid := (s_a->>'owner')::uuid; v_owner_b uuid := (s_b->>'owner')::uuid;
  v_c_a bigint := (s_a->>'client')::bigint; v_c_b bigint := (s_b->>'client')::bigint;
  v_acc_a uuid := (s_a->>'acc')::uuid; v_acc_b uuid := (s_b->>'acc')::uuid;
  v_restr uuid := gen_random_uuid(); v_todos uuid := gen_random_uuid();
  v_c_a2 bigint; i int; j jsonb;
  v_cuts numeric[] := (select array_agg(g::numeric) from generate_series(1, 99) g);
begin
  insert into auth.users (id, email) values (v_restr, 'restr@ih.test'), (v_todos, 'todos@ih.test');
  insert into workspace_members (user_id, workspace_id, role) values (v_restr, v_ws_a, 'agent'), (v_todos, v_ws_a, 'agent');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id in (v_restr, v_todos);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status)
    values (v_owner_a, v_ws_a, 'A2', 'A2', '#222', 'ativo') returning id into v_c_a2;
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws_a and user_id = v_restr;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws_a, v_restr, v_c_a2);

  for i in 1..5 loop
    perform pg_temp.ih_post(v_acc_a, i * 3, 100 + i, 0);
    perform pg_temp.ih_post(v_acc_b, i * 3, 100 + i, 0);
  end loop;
  insert into ig_peer_benchmarks (band, metric, source, sample_size, cuts, computed_at)
    values ('5k_20k', 'engagement_rate', 'mercado', null, v_cuts, now());

  -- controles positivos: dono e membro "todos" de A leem a conta de A (end to end como authenticated)
  j := pg_temp.h_as(v_owner_a, v_c_a);
  assert j is not null and (j->>'followers')::int = 10000 and (j->'metrics'->>'posts_30d')::int = 5
     and jsonb_array_length(j->'benchmarks') = 1, 'dono de A lê a conta de A: ' || coalesce(j::text, 'null');
  j := pg_temp.h_as(v_todos, v_c_a);
  assert j is not null and (j->'metrics'->>'posts_30d')::int = 5, 'membro todos de A lê a conta de A';
  assert pg_temp.m_as(v_owner_a, v_acc_a) = 1, 'dono de A lê as métricas da conta de A';

  -- outro workspace: null / nenhuma métrica
  assert pg_temp.h_as(v_owner_a, v_c_b) is null, 'membro de A chamando cliente de B recebe null';
  assert pg_temp.h_as(v_owner_b, v_c_a) is null, 'membro de B chamando cliente de A recebe null';
  assert pg_temp.m_as(v_owner_a, v_acc_b) = 0, 'membro de A não lê métricas da conta de B';
  assert pg_temp.h_as(v_owner_b, v_c_b) is not null, 'dono de B lê a própria conta';

  -- restrito sem atribuição ao cliente: null; atribuído: lê
  assert pg_temp.h_as(v_restr, v_c_a) is null, 'restrito sem atribuição recebe null';
  assert pg_temp.m_as(v_restr, v_acc_a) = 0, 'restrito sem atribuição não lê métricas';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws_a, v_restr, v_c_a);
  j := pg_temp.h_as(v_restr, v_c_a);
  assert j is not null and (j->'metrics'->>'posts_30d')::int = 5, 'restrito atribuído lê a conta';

  -- anon: sem EXECUTE
  assert pg_temp.err_anon(format('select ig_account_health(%s)', v_c_a)) = '42501', 'anon não executa ig_account_health';
  assert pg_temp.err_anon(format('select * from ig_account_health_metrics(%L)', v_acc_a)) = '42501',
    'anon não executa ig_account_health_metrics';
  raise notice 'PASS 99_ig_account_health_metrics rls';
end $$;
rollback;

-- =====================================================================
-- ig_account_health_metrics(uuid, timestamptz, int): ancorada numa data
-- (20261201000004_ig_account_health_metrics_as_of.sql). Janelas de 30/90 d
-- terminam em p_as_of (exclusivo); p_followers nulo = follower_count atual.
-- =====================================================================

-- Um post de feed numa data absoluta.
create or replace function pg_temp.ih_post_at(p_acc uuid, p_at timestamptz, p_likes int, p_comments int default 0)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into instagram_posts (instagram_account_id, instagram_post_id, posted_at, likes, comments,
                               media_type, media_product_type, impressions, unavailable_metrics)
    values (p_acc, 'p-' || gen_random_uuid(), p_at, p_likes, p_comments, 'IMAGE', 'FEED', 0, '{}')
    returning id into v;
  return v;
end $$;

create or replace function pg_temp.ih_m_at(p_acc uuid, p_as_of timestamptz, p_followers int default null)
returns table(engagement_rate numeric, posts_30d int, reel_views numeric, reels_share numeric,
              best_post_id uuid, best_post_ratio numeric)
language sql as $$ select * from ig_account_health_metrics(p_acc, p_as_of, p_followers) $$;

-- grants da sobrecarga
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.ig_account_health_metrics(uuid, timestamptz, int)', 'execute'),
    'anon sem EXECUTE na de 3 argumentos';
  assert has_function_privilege('authenticated', 'public.ig_account_health_metrics(uuid, timestamptz, int)', 'execute'),
    'authenticated executa a de 3 argumentos';
  assert has_function_privilege('service_role', 'public.ig_account_health_metrics(uuid, timestamptz, int)', 'execute'),
    'service_role executa a de 3 argumentos';
  assert not (select prosecdef from pg_proc
               where oid = 'public.ig_account_health_metrics(uuid, timestamptz, int)'::regprocedure),
    'de 3 argumentos é SECURITY INVOKER';
  assert (select proconfig from pg_proc
           where oid = 'public.ig_account_health_metrics(uuid, timestamptz, int)'::regprocedure)
         @> array['search_path=public'], 'de 3 argumentos com search_path=public';
  assert has_function_privilege('anon', 'public.ig_account_health_metrics(uuid)', 'execute') = false,
    'anon continua sem EXECUTE na de 1 argumento';
  raise notice 'PASS 99_ig_account_health_metrics as_of grants';
end $$;
rollback;

-- janelas, melhor post e 1 argumento = now()
begin;
do $$
declare
  s jsonb := pg_temp.ih_seed(5000); v_acc uuid := (s->>'acc')::uuid;
  v_sep5 uuid; v_sep20 uuid; v_oct10 uuid; v_jun15 uuid; m record; m1 record; m3 record;
begin
  v_sep5  := pg_temp.ih_post_at(v_acc, '2026-09-05 12:00+00', 50);
  v_sep20 := pg_temp.ih_post_at(v_acc, '2026-09-20 12:00+00', 100);
  v_oct10 := pg_temp.ih_post_at(v_acc, '2026-10-10 12:00+00', 1000);
  v_jun15 := pg_temp.ih_post_at(v_acc, '2026-06-15 12:00+00', 10);

  -- as_of 2026-10-01: set e 20/09 em 30 d; o de outubro ainda não existe; jun/15 fora dos 90 d
  select * into m from pg_temp.ih_m_at(v_acc, '2026-10-01+00');
  assert m.posts_30d = 2, 'posts_30d = 2 em as_of 2026-10-01, veio ' || coalesce(m.posts_30d::text, 'null');
  -- melhor post respeita as_of: o de outubro não entra; mediana(50,100) = 75 → 100/75
  assert m.best_post_id = v_sep20, 'melhor post de 2026-10-01 é o de 20/09';
  assert round(m.best_post_ratio, 4) = 1.3333, 'best_post_ratio 1.3333, veio ' || coalesce(m.best_post_ratio::text, 'null');

  -- post de junho: fora dos 90 d de 2026-10-01 (mediana 90 d = 75); dentro dos de 2026-09-10 (50,10 → 30)
  select * into m from pg_temp.ih_m_at(v_acc, '2026-09-10+00');
  assert m.posts_30d = 1, 'posts_30d = 1 em as_of 2026-09-10, veio ' || coalesce(m.posts_30d::text, 'null');
  assert m.best_post_id is null, 'melhor post nulo com 1 post em 30 d de 2026-09-10';
  perform pg_temp.ih_post_at(v_acc, '2026-09-08 12:00+00', 70);   -- agora 2 em 30 d: 70 e 50
  select * into m from pg_temp.ih_m_at(v_acc, '2026-09-10+00');
  -- mediana 90 d de 09/10 = mediana(10, 50, 70) = 50 → 70/50; sem o de junho seria mediana(50,70)=60
  assert round(m.best_post_ratio, 4) = 1.4, 'jun/15 conta nos 90 d de 2026-09-10, ratio 1.4, veio '
    || coalesce(m.best_post_ratio::text, 'null');

  -- limite superior exclusivo: post exatamente em as_of não entra
  select * into m from pg_temp.ih_m_at(v_acc, '2026-09-20 12:00+00');
  assert m.posts_30d = 2, 'post em as_of não entra (posts_30d = 2: 05/09 e 08/09), veio '
    || coalesce(m.posts_30d::text, 'null');

  -- 1 argumento = 3 argumentos com now() e followers nulo
  select * into m1 from pg_temp.ih_m(v_acc);
  select * into m3 from pg_temp.ih_m_at(v_acc, now(), null);
  assert m1 is not distinct from m3, '1 argumento = as_of now()';
  raise notice 'PASS 99_ig_account_health_metrics as_of janelas';
end $$;
rollback;

-- equivalência na fixture "existente" (posts relativos a now()) e posts futuros
begin;
do $$
declare s jsonb := pg_temp.ih_seed(10000); v_acc uuid := (s->>'acc')::uuid; i int; m1 record; m3 record;
begin
  for i in 0..11 loop
    perform pg_temp.ih_post(v_acc, 1 + (11 - i) * 2, 90 + i * 10, 10,
      case when i < 4 then 'VIDEO' else 'IMAGE' end, case when i < 4 then 'REELS' else 'FEED' end, 1000 * (i + 1));
  end loop;
  select * into m1 from pg_temp.ih_m(v_acc);
  select * into m3 from pg_temp.ih_m_at(v_acc, now(), null);
  assert m1 is not distinct from m3, 'fixture: 1 argumento = as_of now()';
  assert m1.engagement_rate = 0.0155, 'fixture: engagement_rate 0.0155';
  -- post futuro (relativo a now) não entra nem na de 1 argumento
  perform pg_temp.ih_post(v_acc, -2, 100000, 0);
  select * into m1 from pg_temp.ih_m(v_acc);
  assert m1.posts_30d = 12, 'post futuro fora das janelas, veio ' || coalesce(m1.posts_30d::text, 'null');
  raise notice 'PASS 99_ig_account_health_metrics as_of equivalência';
end $$;
rollback;

-- p_followers: denominador do engajamento
begin;
do $$
declare s jsonb := pg_temp.ih_seed(10000); v_acc uuid := (s->>'acc')::uuid; i int; m record;
begin
  for i in 1..3 loop perform pg_temp.ih_post(v_acc, i * 2, 100, 0); end loop;   -- mediana 100
  select * into m from pg_temp.ih_m_at(v_acc, now(), 5000);
  assert m.engagement_rate = 0.02, 'p_followers 5000 → 0.02, veio ' || coalesce(m.engagement_rate::text, 'null');
  select * into m from pg_temp.ih_m_at(v_acc, now(), null);
  assert m.engagement_rate = 0.01, 'p_followers nulo → follower_count 10000 → 0.01, veio '
    || coalesce(m.engagement_rate::text, 'null');
  select * into m from pg_temp.ih_m_at(v_acc, now(), 0);
  assert m.engagement_rate is null, 'p_followers 0 → nulo';
  raise notice 'PASS 99_ig_account_health_metrics as_of followers';
end $$;
rollback;
