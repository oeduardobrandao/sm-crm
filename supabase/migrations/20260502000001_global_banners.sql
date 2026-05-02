-- Helper function: resolve effective plan for a workspace
-- Falls back to default plan if no explicit assignment exists
create or replace function resolve_workspace_plan(ws_id uuid)
returns text
language sql
security definer
stable
as $$
  select coalesce(
    (select plan_id from workspace_plan_overrides where workspace_id = ws_id),
    (select id from plans where is_default = true limit 1)
  );
$$;

-- Global banners table
create table global_banners (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  content text not null,
  link text,
  custom_color text,
  target_mode text not null,
  target_plan_ids text[],
  target_workspace_ids uuid[],
  dismissible boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft',
  created_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint global_banners_type_check
    check (type in ('info', 'warning', 'critical')),
  constraint global_banners_status_check
    check (status in ('draft', 'active', 'archived')),
  constraint global_banners_target_mode_check
    check (target_mode in ('all', 'plan', 'workspace')),
  constraint global_banners_plan_targets_check
    check (target_mode != 'plan' or (target_plan_ids is not null and array_length(target_plan_ids, 1) > 0)),
  constraint global_banners_workspace_targets_check
    check (target_mode != 'workspace' or (target_workspace_ids is not null and array_length(target_workspace_ids, 1) > 0)),
  constraint global_banners_schedule_check
    check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint global_banners_color_check
    check (custom_color is null or custom_color ~ '^#[0-9a-fA-F]{6}$')
);

-- Auto-update updated_at
create or replace function update_global_banners_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger global_banners_updated_at
  before update on global_banners
  for each row execute function update_global_banners_updated_at();

-- Banner dismissals table
create table banner_dismissals (
  id uuid primary key default gen_random_uuid(),
  banner_id uuid not null references global_banners(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  unique (banner_id, user_id)
);

-- RLS: global_banners
alter table global_banners enable row level security;

create policy "Authenticated users can read active banners matching their workspace"
  on global_banners for select to authenticated
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

-- RLS: banner_dismissals
alter table banner_dismissals enable row level security;

create policy "Users can read own dismissals"
  on banner_dismissals for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own dismissals"
  on banner_dismissals for insert to authenticated
  with check (user_id = auth.uid());
