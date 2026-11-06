-- Search Console do blog (spec 2026-10-27-blog-metrics-design.md, secao 4).
--
-- Tudo aqui e service_role: o cron `blog-search-console-cron` chama blog_search_replace() e le/grava
-- blog_search_state, blog_search_runs e blog_index_status; o backend do Admin chama
-- blog_search_stats() e blog_search_series() e le blog_index_status e blog_search_runs.

create table if not exists blog_search_daily (
  slug        text not null,
  day         date not null,        -- dia do Search Console (fuso do Google), sem conversao
  clicks      int  not null,
  impressions int  not null,
  position    numeric not null,     -- media entre hosts ponderada por impressoes
  primary key (slug, day)
);
-- stats/series filtram por day (janela terminando em max(day)); a PK cobre so (slug, day).
create index if not exists blog_search_daily_day on blog_search_daily (day);

create table if not exists blog_index_status (
  slug             text primary key,
  verdict          text,            -- PASS | NEUTRAL | FAIL | PARTIAL | VERDICT_UNSPECIFIED
  coverage_state   text,            -- texto do Google, ex.: "Submitted and indexed"
  last_crawl_time  timestamptz,
  google_canonical text,
  inspection_link  text,            -- inspectionResult.inspectionResultLink
  checked_at       timestamptz not null
);

create table if not exists blog_search_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  error       text                  -- mensagem interna, nunca devolvida crua
);

-- Cursor do backfill: o dia mais antigo ja preenchido. Linha unica.
create table if not exists blog_search_state (
  id              int primary key default 1 check (id = 1),
  backfill_before date
);
insert into blog_search_state (id) values (1) on conflict (id) do nothing;

-- RLS ligada e sem policies. O Supabase hospedado concede ALL em tabela nova a
-- anon/authenticated por ACL padrao, dai o REVOKE explicito (ver 20260925130001_metrics_snapshots.sql
-- e 20261101000001_blog_page_views.sql).
alter table blog_search_daily enable row level security;
alter table blog_index_status enable row level security;
alter table blog_search_runs enable row level security;
alter table blog_search_state enable row level security;
revoke all on blog_search_daily from public, anon, authenticated;
revoke all on blog_index_status from public, anon, authenticated;
revoke all on blog_search_runs from public, anon, authenticated;
revoke all on blog_search_state from public, anon, authenticated;
-- A sequence da identidade tambem herda ACL padrao para anon/authenticated no hospedado.
revoke all on sequence blog_search_runs_id_seq from public, anon, authenticated;
-- blog_search_daily so e escrita por blog_search_replace (SECURITY DEFINER); o resto o cron grava direto.
grant select on blog_search_daily to service_role;
grant select, insert, update on blog_index_status to service_role;
grant select, insert, update on blog_search_runs to service_role;
grant usage, select on sequence blog_search_runs_id_seq to service_role;
grant select, insert, update on blog_search_state to service_role;

-- Troca a janela [p_from, p_to] inteira: o Google omite dias sem dados, entao um upsert deixaria
-- para tras o dia que foi revisado para zero. p_rows: [{slug, day, clicks, impressions, position}].
-- Uma transacao (a da chamada): erro em qualquer linha desfaz o delete. Linha malformada tambem
-- falha, com 23502 (campo faltando) ou 23505 (slug/day repetido em p_rows), e desfaz a chamada toda.
create or replace function public.blog_search_replace(p_from date, p_to date, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'janela invalida' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows precisa ser um array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(slug text, day date, clicks int, impressions int, position numeric)
    where x.day is null or x.day < p_from or x.day > p_to
  ) then
    raise exception 'linha fora da janela' using errcode = '22023';
  end if;

  delete from blog_search_daily where day between p_from and p_to;

  insert into blog_search_daily (slug, day, clicks, impressions, position)
  select x.slug, x.day, x.clicks, x.impressions, x.position
  from jsonb_to_recordset(p_rows) as x(slug text, day date, clicks int, impressions int, position numeric);
end;
$$;

-- Totais por post nos p_days dias que terminam em max(day) da tabela (o dado do Google chega com
-- atraso, entao "hoje" nao serve de ancora). Posicao ponderada por impressoes; sem impressoes,
-- ctr sai 0 e a posicao sai null (posicao do Google e >= 1, entao 0 nao existe). p_days nulo ou
-- < 1 vira 28; o teto 486 dias e o que o Search Console guarda (~16 meses, o mesmo horizonte do
-- backfill do cron) e valores maiores sao limitados a ele.
create or replace function public.blog_search_stats(p_days int default 28)
returns table (slug text, clicks bigint, impressions bigint, ctr numeric, "position" numeric)
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select case when p_days is null or p_days < 1 then 28 else least(p_days, 486) end as days,
           max(day) as last_day
    from blog_search_daily
  )
  select d.slug,
         sum(d.clicks)::bigint,
         sum(d.impressions)::bigint,
         case when sum(d.impressions) > 0
              then sum(d.clicks)::numeric / sum(d.impressions) else 0 end,
         case when sum(d.impressions) > 0
              then sum(d.position * d.impressions) / sum(d.impressions) else null end
  from blog_search_daily d, w
  where d.day > w.last_day - w.days
  group by d.slug;
$$;

-- Serie diaria de um post na mesma janela. So dias com linha; quem chama preenche os zeros.
create or replace function public.blog_search_series(p_slug text, p_days int)
returns table (day date, clicks int, impressions int)
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select case when p_days is null or p_days < 1 then 28 else least(p_days, 486) end as days,
           max(day) as last_day
    from blog_search_daily
  )
  select d.day, d.clicks, d.impressions
  from blog_search_daily d, w
  where d.slug = p_slug
    and d.day > w.last_day - w.days
  order by d.day;
$$;

revoke all on function public.blog_search_replace(date, date, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.blog_search_stats(int)
  from public, anon, authenticated, service_role;
revoke all on function public.blog_search_series(text, int)
  from public, anon, authenticated, service_role;
grant execute on function public.blog_search_replace(date, date, jsonb) to service_role;
grant execute on function public.blog_search_stats(int) to service_role;
grant execute on function public.blog_search_series(text, int) to service_role;
