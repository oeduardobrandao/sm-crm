-- Platform admins: users who can access the admin portal
create table platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  invited_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Add admin-portal columns to existing plans table
alter table plans add column if not exists is_default boolean not null default false;
alter table plans add column if not exists updated_at timestamptz not null default now();

-- Ensure only one default plan at a time
create unique index plans_single_default on plans (is_default) where is_default = true;

-- Per-workspace plan assignment and overrides
create table workspace_plan_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  plan_id text not null references plans(id) on delete restrict,
  resource_overrides jsonb,
  feature_overrides jsonb,
  notes text,
  updated_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
