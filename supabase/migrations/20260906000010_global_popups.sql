-- Global popups: anúncios em modal, no máximo um por sessão no CRM
-- (spec docs/superpowers/specs/2026-09-04-global-popups-design.md).
-- Espelha global_banners (20260502000001) com conteúdo em páginas.

create table global_popups (
  id uuid primary key default gen_random_uuid(),
  pages jsonb not null,
  cta_label text,
  cta_url text,
  cta_style text not null default 'ink',
  secondary_label text,
  frequency text not null default 'once',
  require_ack boolean not null default false,
  target_mode text not null,
  target_plan_ids text[],
  target_workspace_ids uuid[],
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft',
  created_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- O formato interno de cada página (title/body obrigatórios, tamanhos) é
  -- validado no platform-admin, único caminho de escrita. O banco garante só
  -- que é um array de 1 a 6 itens.
  constraint global_popups_pages_check
    check (jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) between 1 and 6),
  constraint global_popups_cta_style_check
    check (cta_style in ('ink', 'brand')),
  constraint global_popups_frequency_check
    check (frequency in ('once', 'until_cta')),
  constraint global_popups_cta_pair_check
    check ((cta_label is null) = (cta_url is null)),
  constraint global_popups_until_cta_needs_cta_check
    check (frequency <> 'until_cta' or cta_url is not null),
  -- Com confirmação obrigatória não existe "closed", então until_cta seria
  -- idêntico a once. Proibido para não virar um estado sem efeito no admin.
  constraint global_popups_ack_frequency_check
    check (not (require_ack and frequency = 'until_cta')),
  constraint global_popups_status_check
    check (status in ('draft', 'active', 'archived')),
  constraint global_popups_target_mode_check
    check (target_mode in ('all', 'plan', 'workspace')),
  constraint global_popups_plan_targets_check
    check (target_mode <> 'plan' or (target_plan_ids is not null and array_length(target_plan_ids, 1) > 0)),
  constraint global_popups_workspace_targets_check
    check (target_mode <> 'workspace' or (target_workspace_ids is not null and array_length(target_workspace_ids, 1) > 0)),
  constraint global_popups_schedule_check
    check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create or replace function update_global_popups_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger global_popups_updated_at
  before update on global_popups
  for each row execute function update_global_popups_updated_at();

-- Append-only: um usuário em until_cta acumula vários 'closed' antes do 'cta'.
create table popup_interactions (
  id uuid primary key default gen_random_uuid(),
  popup_id uuid not null references global_popups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  -- O INSERT é feito direto pelo cliente sob RLS, sem handler na frente.
  constraint popup_interactions_action_check
    check (action in ('seen', 'closed', 'cta', 'ack'))
);

create index popup_interactions_popup_user_idx on popup_interactions (popup_id, user_id);

-- Métricas da lista do admin em uma query. Só o service role lê.
create view popup_interaction_counts as
  select popup_id, action, count(distinct user_id)::int as users
  from popup_interactions
  group by popup_id, action;

revoke all on popup_interaction_counts from public, anon, authenticated;
-- REVOKE FROM PUBLIC derruba o service_role junto: re-conceder explicitamente.
grant select on popup_interaction_counts to service_role;

-- RLS: global_popups (cópia da política dos banners)
alter table global_popups enable row level security;

create policy "Authenticated users can read active popups matching their workspace"
  on global_popups for select to authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and (
      target_mode = 'all'
      or (
        target_mode = 'plan'
        and resolve_workspace_plan(
          (select conta_id from profiles where id = auth.uid())
        ) = any(target_plan_ids)
      )
      or (
        target_mode = 'workspace'
        and (select conta_id from profiles where id = auth.uid()) = any(target_workspace_ids)
      )
    )
  );

-- RLS: popup_interactions
alter table popup_interactions enable row level security;

create policy "Users can read own popup interactions"
  on popup_interactions for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own popup interactions"
  on popup_interactions for insert to authenticated
  with check (user_id = auth.uid());
