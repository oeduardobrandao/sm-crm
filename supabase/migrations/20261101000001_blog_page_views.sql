-- Contagem anonima de views do blog (spec 2026-10-27-blog-metrics-design.md, secao 3).
--
-- visitor_hash = sha256(sal_do_dia || ip || user_agent || slug), calculado na edge function
-- `blog-view` e usado so para deduplicar em 30 min. Com o slug no hash, o mesmo leitor tem um
-- hash diferente em cada post. O sal vive o dia de Sao Paulo e e apagado na virada,
-- entao depois disso ninguem consegue ligar um hash a um IP. IP e UA crus nunca sao gravados.
--
-- Tudo aqui e service_role: a edge function publica chama blog_view_salt_today() e
-- record_blog_view(); o backend do Admin chama blog_view_stats() e blog_view_daily().

create table if not exists blog_page_views (
  id           bigint generated always as identity primary key,
  slug         text not null,
  viewed_at    timestamptz not null default now(),
  visitor_hash text not null
);
create index if not exists blog_page_views_slug_time on blog_page_views (slug, viewed_at);

create table if not exists blog_view_salts (
  day  date primary key,   -- dia do calendario em America/Sao_Paulo
  salt text not null       -- 32 bytes aleatorios, hex
);

-- RLS ligada e sem policies. O Supabase hospedado concede ALL em tabela nova a
-- anon/authenticated por ACL padrao, dai o REVOKE explicito (ver 20260925130001_metrics_snapshots.sql).
alter table blog_page_views enable row level security;
alter table blog_view_salts enable row level security;
revoke all on blog_page_views from public, anon, authenticated;
revoke all on blog_view_salts from public, anon, authenticated;
-- A sequence da identidade tambem herda ACL padrao para anon/authenticated no hospedado.
revoke all on sequence blog_page_views_id_seq from public, anon, authenticated;
grant select, insert, delete on blog_page_views to service_role;
grant usage, select on sequence blog_page_views_id_seq to service_role;
grant select, insert, delete on blog_view_salts to service_role;

-- Grava uma view, salvo se o mesmo (slug, visitor_hash) ja tem linha nos ultimos 30 min (mesma
-- janela de record_kb_view). Duplicata ocasional sob concorrencia e aceita.
create or replace function public.record_blog_view(p_slug text, p_visitor_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from blog_page_views v
    where v.slug = p_slug
      and v.visitor_hash = p_visitor_hash
      and v.viewed_at > now() - interval '30 minutes'
  ) then
    return;
  end if;
  insert into blog_page_views (slug, visitor_hash) values (p_slug, p_visitor_hash);
end;
$$;

-- Sal de hoje (dia de Sao Paulo): cria se faltar e apaga todos os de dias anteriores na mesma
-- chamada. pgcrypto fica no schema `extensions` no Supabase hospedado.
create or replace function public.blog_view_salt_today()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_salt  text;
begin
  insert into blog_view_salts (day, salt)
  values (v_today, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (day) do nothing;

  delete from blog_view_salts where day < v_today;

  select s.salt into v_salt from blog_view_salts s where s.day = v_today;
  return v_salt;
end;
$$;

-- Mesmo delete, para o pg_cron: num dia sem views nenhuma chamada passaria por
-- blog_view_salt_today() e o sal de ontem ficaria ate a proxima visita.
create or replace function public.blog_view_prune_salts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from blog_view_salts
  where day < (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Views por post: 7 dias, 30 dias e total. So slugs com ao menos uma view.
create or replace function public.blog_view_stats()
returns table (slug text, views_7d bigint, views_30d bigint, views_total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select v.slug,
         count(*) filter (where v.viewed_at > now() - interval '7 days'),
         count(*) filter (where v.viewed_at > now() - interval '30 days'),
         count(*)
  from blog_page_views v
  group by v.slug;
$$;

-- Views por dia (America/Sao_Paulo) de um post nos ultimos p_days dias. So dias com views;
-- quem chama preenche os zeros.
create or replace function public.blog_view_daily(p_slug text, p_days int)
returns table (day date, views bigint)
language sql
stable
security definer
set search_path = public
as $$
  select (v.viewed_at at time zone 'America/Sao_Paulo')::date as day,
         count(*) as views
  from blog_page_views v
  where v.slug = p_slug
    and v.viewed_at > now() - make_interval(days => p_days)
  group by 1
  order by 1;
$$;

revoke all on function public.record_blog_view(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.blog_view_salt_today()
  from public, anon, authenticated, service_role;
revoke all on function public.blog_view_prune_salts()
  from public, anon, authenticated, service_role;
revoke all on function public.blog_view_stats()
  from public, anon, authenticated, service_role;
revoke all on function public.blog_view_daily(text, int)
  from public, anon, authenticated, service_role;
grant execute on function public.record_blog_view(text, text) to service_role;
grant execute on function public.blog_view_salt_today() to service_role;
grant execute on function public.blog_view_prune_salts() to service_role;
grant execute on function public.blog_view_stats() to service_role;
grant execute on function public.blog_view_daily(text, int) to service_role;

-- Prune diario as 00:23 Sao Paulo (03:23 UTC). O minuto 23 da hora 3 esta livre (03:05 e do
-- post-media-cleanup). Sem http: roda SQL direto, entao nao precisa dos segredos do vault.
-- Idempotente.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'blog-view-salt-prune') then
    perform cron.unschedule('blog-view-salt-prune');
  end if;
end $$;

select cron.schedule(
  'blog-view-salt-prune',
  '23 3 * * *',
  $$ select public.blog_view_prune_salts(); $$
);
