-- Saúde do Instagram vs contas do mesmo tamanho: referências de mercado, refresh
-- noturno e cron. Spec: docs/superpowers/specs/2026-11-25-ig-account-health-design.md
-- (seções "Tabela ig_peer_benchmarks", "Cron ig_peer_benchmarks_refresh()", "Seed de
-- mercado", "Privacidade").
--
-- Consome de 20261201000002: ig_peer_benchmarks, ig_follower_band,
-- ig_account_health_metrics. Tudo SQL, então agendar o cron aqui mesmo é seguro.
--
-- Rollback: desligar a chave ig_peer_benchmarks_mesaas (o próximo refresh volta tudo
-- para mercado). Tabelas, função e job podem ficar.

-- -------------------------------------------------------------
-- 1. ig_peer_benchmarks_mercado: referências públicas (só seed, sem grant ao CRM)
-- -------------------------------------------------------------
create table if not exists public.ig_peer_benchmarks_mercado (
  band text not null check (band in ('lt1k', '1k_5k', '5k_20k', '20k_100k', '100k_plus')),
  metric text not null check (metric in ('engagement_rate', 'posts_30d', 'reel_views', 'reels_share')),
  cuts numeric[] not null check (array_length(cuts, 1) = 99),  -- p1..p99, não decrescentes
  computed_at timestamptz not null,
  source_note text not null,  -- fonte, ano e se é estimativa (e de quê)
  primary key (band, metric)
);

comment on table public.ig_peer_benchmarks_mercado is
  'Referências públicas de mercado (p1..p99) por faixa de seguidores e métrica de saúde do Instagram. '
  'Só seed; o refresh copia para ig_peer_benchmarks quando o Mesaas não tem 30 contas. Sem grant ao CRM.';

alter table public.ig_peer_benchmarks_mercado enable row level security;
revoke all on public.ig_peer_benchmarks_mercado from public, anon, authenticated;
grant select, insert, update, delete on public.ig_peer_benchmarks_mercado to service_role;

-- -------------------------------------------------------------
-- 2. Seed de mercado
--
-- Regra (spec "Seed de mercado"): só entra uma (faixa, métrica) quando a fonte mede
-- a mesma coisa que a nossa definição. Os 99 cortes vêm de uma log-normal ajustada
-- à mediana e aos quartis (mu = ln m, sigma = (ln q3 - ln q1) / 1.349); reels_share
-- em logit-normal limitada a 0..1; posts_30d arredondado. O cálculo fica fora do repo.
--
-- Pesquisa de 2026-11-25: nenhuma fonte passou na regra, então 0 de 20 linhas.
-- Fontes conferidas e por que ficaram de fora:
--   IQFluence, "Influencer engagement rate benchmarks 2026" (2026): (likes+comments)
--     ÷ seguidores com p25/mediana/p75, mas média dos posts recentes por conta (a
--     nossa é mediana de 12) e faixas 1K-10K/10K-100K/... que não batem com as nossas.
--   HypeAuditor, calculadora de engajamento (2026) e Digest de agosto (2026): divide
--     por views quando há Reels (a maioria das contas), 30 posts, faixas diferentes.
--   HypeAuditor, estudo por tier (2018): faixas iguais às nossas, mas média, sem
--     fórmula e valores só em imagem.
--   Buffer, "What is a good Instagram engagement rate" e benchmarks (2025): engajamento
--     com saves ÷ impressões; posts/mês é média, sem dispersão.
--   Socialinsider, "2025 Instagram Benchmarks" (PDF, 2023-2024) e "2026 Instagram
--     Organic Benchmarks" (2025): médias de impressões/views de todos os reels, sem
--     dispersão; engajamento por post sem quebra por faixa.
--   Metricool × HypeAuditor, "Instagram Content Playbook 2025" (2025): alcance (não
--     views) e proporção de formatos agregada por tier, separada marcas/criadores.
--   mLabs Índice (2025): interações ÷ alcance, por setor, sem faixas.
--   Rival IQ (2025), Dash Social, Emplifi: por setor, não por tamanho de conta.
--
-- Para semear: acrescente linhas no insert abaixo, cada uma com o comentário da
-- fonte. Nada fora deste bloco precisa mudar.
-- -------------------------------------------------------------
-- ===== SEED DE MERCADO (início) =====
-- insert into public.ig_peer_benchmarks_mercado (band, metric, cuts, computed_at, source_note) values
--   -- (fonte, ano; estimativa log-normal a partir de mediana e quartis)
--   ('1k_5k', 'engagement_rate', array[...99 valores...]::numeric[], '2026-11-25', '...'),
--   ...
-- on conflict (band, metric) do update
--   set cuts = excluded.cuts, computed_at = excluded.computed_at, source_note = excluded.source_note;
-- ===== SEED DE MERCADO (fim) =====

-- -------------------------------------------------------------
-- 3. Chave: gravar referências do Mesaas (padrão desligada; liga só depois da
--    Política de Privacidade nova no ar)
-- -------------------------------------------------------------
insert into public.platform_settings (key, value)
values ('ig_peer_benchmarks_mesaas', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

-- -------------------------------------------------------------
-- 4. Refresh: por (faixa, métrica), mesaas com n >= 30 e chave ligada; senão a
--    linha de mercado (cópia exata); sem mercado, sem linha.
--    SECURITY DEFINER (dono postgres): lê contas de todos os workspaces, e só
--    cortes percentis agregados saem dela.
-- -------------------------------------------------------------
create or replace function public.ig_peer_benchmarks_refresh()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesaas boolean;
  v_levels float8[] := array(select g / 100.0 from generate_series(1, 99) g);
begin
  select coalesce((s.value ->> 'enabled')::boolean, false)
    into v_mesaas
    from (select 1) one
    left join platform_settings s on s.key = 'ig_peer_benchmarks_mesaas';

  -- Recompõe a tabela inteira dentro desta chamada (uma transação): quem lê vê o
  -- conjunto antigo até o commit.
  delete from ig_peer_benchmarks where true;

  if v_mesaas then
    insert into ig_peer_benchmarks (band, metric, source, sample_size, cuts, computed_at)
    with eligible as (
      -- mesma conta IG em dois workspaces conta uma vez: fica a sincronizada por último
      select distinct on (ia.instagram_user_id)
             ia.id, ig_follower_band(ia.follower_count) as band
        from instagram_accounts ia
       where ia.follower_count > 0
         and ia.last_synced_at >= now() - interval '14 days'
       order by ia.instagram_user_id, ia.last_synced_at desc, ia.id
    ),
    vals as (
      select e.band, v.metric, v.value
        from eligible e
        cross join lateral ig_account_health_metrics(e.id) m
        cross join lateral (values
          ('engagement_rate', m.engagement_rate),
          ('posts_30d', m.posts_30d::numeric),
          ('reel_views', m.reel_views),
          ('reels_share', m.reels_share)
        ) as v(metric, value)
       where v.value is not null
    ),
    peer as (
      select band, metric, count(*)::int as n,
             percentile_cont(v_levels) within group (order by value::float8) as cuts
        from vals
       group by band, metric
      having count(*) >= 30  -- piso de privacidade e de amostra
    )
    select p.band, p.metric, 'mesaas', p.n, p.cuts::numeric[], now()
      from peer p
    union all
    select k.band, k.metric, 'mercado', null, k.cuts, k.computed_at
      from ig_peer_benchmarks_mercado k
     where not exists (select 1 from peer p where p.band = k.band and p.metric = k.metric);
  else
    -- Chave desligada: nenhuma métrica de conta é lida, só o mercado.
    insert into ig_peer_benchmarks (band, metric, source, sample_size, cuts, computed_at)
    select k.band, k.metric, 'mercado', null, k.cuts, k.computed_at
      from ig_peer_benchmarks_mercado k;
  end if;
end;
$$;

alter function public.ig_peer_benchmarks_refresh() owner to postgres;
revoke all on function public.ig_peer_benchmarks_refresh() from public, anon, authenticated;
grant execute on function public.ig_peer_benchmarks_refresh() to service_role;

-- -------------------------------------------------------------
-- 5. Cópia inicial: a página funciona antes da primeira execução do cron
-- -------------------------------------------------------------
select public.ig_peer_benchmarks_refresh();

-- -------------------------------------------------------------
-- 6. Cron diário 06:53 UTC (minuto 53 livre). Idempotente.
-- -------------------------------------------------------------
do $$ begin
  if exists (select 1 from cron.job where jobname = 'ig-peer-benchmarks-refresh') then
    perform cron.unschedule('ig-peer-benchmarks-refresh');
  end if;
end $$;

select cron.schedule(
  'ig-peer-benchmarks-refresh',
  '53 6 * * *',
  $$select public.ig_peer_benchmarks_refresh()$$
);
