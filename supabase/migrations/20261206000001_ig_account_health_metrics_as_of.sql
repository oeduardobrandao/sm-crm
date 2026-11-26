-- Saúde da conta do Instagram ancorada numa data: as janelas de 30/90 dias
-- terminam em p_as_of (limite superior exclusivo) em vez de now(), para o bloco
-- do relatório calcular no corte do relatório. Mesmas definições da migration
-- 20261201000002; p_followers (nulo = follower_count atual) é o denominador do
-- engajamento, para o relatório usar os seguidores do corte.
-- Spec: docs/superpowers/specs/2026-11-25-ig-account-health-report-block-design.md

create or replace function public.ig_account_health_metrics(p_account_id uuid, p_as_of timestamptz, p_followers int)
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
    select coalesce(p_followers, ia.follower_count, 0) as followers
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
       and p.posted_at >= p_as_of - interval '90 days'
       and p.posted_at < p_as_of
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
    select * from feed90 where posted_at >= p_as_of - interval '30 days'
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
    case when agg.n12 >= 3 then round(agg.n12_reels::numeric / agg.n12, 4) end,
    case when agg.n30 >= 2 and agg.med90 > 0 then best.id end,
    case when agg.n30 >= 2 and agg.med90 > 0 then trim_scale(best.eng::numeric / agg.med90) end
  from acc
  cross join agg
  left join best on true
$$;

revoke all on function public.ig_account_health_metrics(uuid, timestamptz, int) from public, anon;
grant execute on function public.ig_account_health_metrics(uuid, timestamptz, int) to authenticated, service_role;

-- A de 1 argumento (usada por ig_account_health) vira atalho: agora, seguidores atuais.
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
  select * from public.ig_account_health_metrics(p_account_id, now(), null)
$$;

revoke all on function public.ig_account_health_metrics(uuid) from public, anon;
grant execute on function public.ig_account_health_metrics(uuid) to authenticated, service_role;
