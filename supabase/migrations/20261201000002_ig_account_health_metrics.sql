-- Saúde da conta do Instagram vs contas do mesmo tamanho: as 4 métricas em SQL,
-- a RPC do CRM e a tabela de referências por faixa (vazia aqui; a Task 3 cria a
-- irmã de mercado, o seed, o refresh e o cron).
-- Spec: docs/superpowers/specs/2026-11-25-ig-account-health-design.md
--
-- Definições (iguais para a conta e para o grupo):
--   post de feed = instagram_posts com media_type em IMAGE, VIDEO, CAROUSEL_ALBUM;
--   reel = post de feed com media_product_type = 'REELS', ou VIDEO com
--          media_product_type nulo (histórico anterior à coluna);
--   "mais recentes" = posted_at desc, desempate por id; mediana = percentile_cont(0.5).
--   engagement_rate: mediana(likes+comments) dos 12 feed mais recentes em 90 d
--                    ÷ follower_count atual; nulo com < 3 posts ou seguidores <= 0.
--   posts_30d:       feed com posted_at nos últimos 30 d; nulo sem feed em 90 d.
--   reel_views:      mediana de impressions dos 12 reels mais recentes em 90 d,
--                    fora os com 'impressions' em unavailable_metrics; nulo com < 3.
--   reels_share:     reels ÷ feed nos 12 feed mais recentes em 90 d; nulo com < 3.
--   melhor post:     maior (likes+comments) em 30 d ÷ mediana(likes+comments) de
--                    todos os feed em 90 d; nulo com < 2 posts em 30 d ou mediana 0.

-- -------------------------------------------------------------
-- 1. ig_peer_benchmarks: cortes p1..p99 por (faixa, métrica)
-- -------------------------------------------------------------
create table if not exists public.ig_peer_benchmarks (
  band text not null check (band in ('lt1k', '1k_5k', '5k_20k', '20k_100k', '100k_plus')),
  metric text not null check (metric in ('engagement_rate', 'posts_30d', 'reel_views', 'reels_share')),
  source text not null check (source in ('mercado', 'mesaas')),
  sample_size int,           -- contas na amostra (mesaas) ou null (mercado)
  cuts numeric[] not null check (array_length(cuts, 1) = 99),  -- p1..p99, não decrescentes
  computed_at timestamptz not null,
  primary key (band, metric)
);

comment on table public.ig_peer_benchmarks is
  'Referências agregadas (percentis p1..p99) das 4 métricas de saúde do Instagram por faixa de seguidores. '
  'Sem cliente_id: dado agregado, não pertence a workspace. Escrita só pelo refresh (Task 3).';

alter table public.ig_peer_benchmarks enable row level security;

revoke all on public.ig_peer_benchmarks from public, anon, authenticated;
grant select on public.ig_peer_benchmarks to authenticated;
grant select, insert, update, delete on public.ig_peer_benchmarks to service_role;

drop policy if exists ig_peer_benchmarks_select on public.ig_peer_benchmarks;
create policy ig_peer_benchmarks_select on public.ig_peer_benchmarks
  for select to authenticated using (true);

-- -------------------------------------------------------------
-- 2. Faixa de seguidores (limite inferior inclusivo)
-- -------------------------------------------------------------
create or replace function public.ig_follower_band(p_followers int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_followers is null or p_followers <= 0 then null
    when p_followers < 1000 then 'lt1k'
    when p_followers < 5000 then '1k_5k'
    when p_followers < 20000 then '5k_20k'
    when p_followers < 100000 then '20k_100k'
    else '100k_plus'
  end
$$;

revoke all on function public.ig_follower_band(int) from public, anon;
grant execute on function public.ig_follower_band(int) to authenticated, service_role;

-- -------------------------------------------------------------
-- 3. As 4 métricas de uma conta (SECURITY INVOKER: a RLS de
--    instagram_accounts/instagram_posts decide o que o chamador vê; conta
--    invisível = nenhuma linha)
-- -------------------------------------------------------------
create or replace function public.ig_account_health_metrics(p_account_id uuid)
returns table (
  engagement_rate numeric,
  posts_30d int,
  reel_views numeric,
  reels_share numeric,
  best_post_id uuid,
  best_post_ratio numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with acc as (
    select coalesce(ia.follower_count, 0) as followers
      from instagram_accounts ia
     where ia.id = p_account_id
  ),
  feed90 as (
    select p.id,
           p.posted_at,
           (coalesce(p.likes, 0) + coalesce(p.comments, 0)) as eng,
           p.impressions,
           coalesce(p.unavailable_metrics, '{}') as unavailable_metrics,
           (p.media_product_type = 'REELS'
             or (p.media_type = 'VIDEO' and p.media_product_type is null)) as is_reel
      from instagram_posts p
     where p.instagram_account_id = p_account_id
       and p.media_type in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')
       and p.posted_at >= now() - interval '90 days'
  ),
  top12 as (
    select * from feed90 order by posted_at desc, id desc limit 12
  ),
  reels12 as (
    select impressions from feed90
     where is_reel and not ('impressions' = any(unavailable_metrics))
     order by posted_at desc, id desc limit 12
  ),
  feed30 as (
    select * from feed90 where posted_at >= now() - interval '30 days'
  ),
  agg as (
    select
      (select count(*) from feed90) as n90,
      (select count(*) from top12) as n12,
      (select count(*) from top12 where is_reel) as n12_reels,
      (select percentile_cont(0.5) within group (order by eng) from top12)::numeric as med12,
      (select count(*) from reels12) as n_reels,
      (select percentile_cont(0.5) within group (order by impressions) from reels12)::numeric as med_reels,
      (select count(*) from feed30) as n30,
      (select percentile_cont(0.5) within group (order by eng) from feed90)::numeric as med90
  ),
  best as (
    select id, eng from feed30 order by eng desc, posted_at desc, id desc limit 1
  )
  select
    case when agg.n12 >= 3 and acc.followers > 0
         then trim_scale(agg.med12 / acc.followers) end,
    case when agg.n90 > 0 then agg.n30::int end,
    case when agg.n_reels >= 3 then trim_scale(agg.med_reels) end,
    case when agg.n12 >= 3 then agg.n12_reels::numeric / agg.n12 end,
    case when agg.n30 >= 2 and agg.med90 > 0 then best.id end,
    case when agg.n30 >= 2 and agg.med90 > 0 then trim_scale(best.eng::numeric / agg.med90) end
  from acc
  cross join agg
  left join best on true
$$;

revoke all on function public.ig_account_health_metrics(uuid) from public, anon;
grant execute on function public.ig_account_health_metrics(uuid) to authenticated, service_role;

-- -------------------------------------------------------------
-- 4. RPC do CRM: métricas da conta do cliente + referências da faixa.
--    null se o chamador não vê nenhuma conta do Instagram do cliente.
-- -------------------------------------------------------------
create or replace function public.ig_account_health(p_client_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_acc_id uuid;
  v_followers int;
  v_band text;
  m record;
  v_benchmarks jsonb;
begin
  select ia.id, coalesce(ia.follower_count, 0)
    into v_acc_id, v_followers
    from instagram_accounts ia
   where ia.client_id = p_client_id
   order by ia.last_synced_at desc nulls last, ia.id
   limit 1;

  if v_acc_id is null then
    return null;
  end if;

  v_band := ig_follower_band(v_followers);

  select * into m from ig_account_health_metrics(v_acc_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'metric', b.metric,
           'source', b.source,
           'sample_size', b.sample_size,
           'cuts', to_jsonb(b.cuts)
         ) order by b.metric), '[]'::jsonb)
    into v_benchmarks
    from ig_peer_benchmarks b
   where b.band = v_band;

  return jsonb_build_object(
    'followers', v_followers,
    'band', v_band,
    'metrics', jsonb_build_object(
      'engagement_rate', m.engagement_rate,
      'posts_30d', m.posts_30d,
      'reel_views', m.reel_views,
      'reels_share', m.reels_share
    ),
    'best_post', case when m.best_post_id is not null
                      then jsonb_build_object('id', m.best_post_id, 'ratio', m.best_post_ratio)
                 end,
    'benchmarks', v_benchmarks
  );
end;
$$;

revoke all on function public.ig_account_health(bigint) from public, anon;
grant execute on function public.ig_account_health(bigint) to authenticated;
