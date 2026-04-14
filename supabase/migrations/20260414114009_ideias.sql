-- ideias table
create table ideias (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  cliente_id  integer not null references clientes(id) on delete cascade,
  titulo      text not null,
  descricao   text not null,
  links       text[] not null default '{}',
  status      text not null default 'nova'
                constraint ideias_status_check
                check (status in ('nova','em_analise','aprovada','descartada')),
  comentario_agencia  text,
  comentario_autor_id integer references membros(id) on delete set null,
  comentario_at       timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- updated_at trigger (reuses pattern from other tables)
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ideias_updated_at
  before update on ideias
  for each row execute function set_updated_at();

-- ideia_reactions table
create table ideia_reactions (
  id         uuid primary key default gen_random_uuid(),
  ideia_id   uuid not null references ideias(id) on delete cascade,
  membro_id  integer not null references membros(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  unique (ideia_id, membro_id, emoji)
);

-- RLS: ideias
alter table ideias enable row level security;

create policy "workspace members can manage ideias"
  on ideias for all
  using (
    workspace_id in (
      select conta_id from membros where user_id = auth.uid()
    )
  );

-- RLS: ideia_reactions
alter table ideia_reactions enable row level security;

create policy "workspace members can manage reactions"
  on ideia_reactions for all
  using (
    ideia_id in (
      select id from ideias
      where workspace_id in (
        select conta_id from membros where user_id = auth.uid()
      )
    )
  );
