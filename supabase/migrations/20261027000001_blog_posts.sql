-- Blog automático: posts gerados por agente, aprovados no Admin, publicados no build.
--
-- Só o service role escreve (mcp-admin e platform-admin, que checam platform_admins).
-- O build da Vercel lê com a chave anon (não há service role no env dela), então o
-- anon enxerga APENAS posts publicando/publicado. authenticated não enxerga nada.
create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'rascunho'
    check (status in ('rascunho', 'ajuste_solicitado', 'publicando', 'publicado', 'rejeitado', 'despublicado')),
  category text not null
    check (category in ('comparativo', 'guia', 'noticia', 'tendencia', 'planejamento')),
  title text not null,
  h1 text not null,
  description text not null,
  lede text not null default '',
  body_md text not null default '',
  cover_image jsonb,
  images jsonb not null default '[]'::jsonb
    check (jsonb_typeof(images) = 'array'),
  sources jsonb not null
    check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) >= 1),
  feature_slug text,
  topic_reason text not null default '',
  checks jsonb not null default '{}'::jsonb
    check (jsonb_typeof(checks) = 'object'),
  revision_note text,
  revised_after_note boolean not null default false,
  rejection_reason text,
  author text not null default 'equipe'
    check (author in ('equipe')),
  date date,
  updated date,
  -- Bumpado a cada save de conteúdo; live_revision é a revisão confirmada no ar.
  revision integer not null default 1,
  live_revision integer,
  -- Último disparo do deploy hook, para retry/timeout.
  publish_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null
);

create index blog_posts_status_created_idx
  on public.blog_posts (status, created_at desc);

create or replace function public.blog_posts_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger blog_posts_set_updated_at
  before update on public.blog_posts
  for each row execute function public.blog_posts_set_updated_at();
revoke all on function public.blog_posts_set_updated_at() from public, anon, authenticated;

alter table public.blog_posts enable row level security;

-- FROM PUBLIC não cobre anon/authenticated (grants diretos do default ACL do Supabase).
revoke all on public.blog_posts from anon, authenticated;
grant select on public.blog_posts to anon;
grant all on public.blog_posts to service_role;

create policy blog_posts_public_read on public.blog_posts
  for select to anon
  using (status in ('publicando', 'publicado'));

-- Bucket público de imagens do blog (espelha kb-images). Sem policy de escrita:
-- uploads rodam com o service role, que ignora RLS.
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'blog-images', 'blog-images', true,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  10485760
)
on conflict (id) do update
  set public = excluded.public,
      allowed_mime_types = excluded.allowed_mime_types,
      file_size_limit = excluded.file_size_limit;

drop policy if exists "blog_images_public_read" on storage.objects;
create policy "blog_images_public_read"
  on storage.objects for select
  using (bucket_id = 'blog-images');
