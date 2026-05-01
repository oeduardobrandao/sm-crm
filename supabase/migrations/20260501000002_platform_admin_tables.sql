-- Platform admins: users who can access the admin portal
create table platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  invited_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Plan templates defining default resource limits and feature flags
create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  resource_limits jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-workspace plan assignment and overrides
create table workspace_plan_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete restrict,
  resource_overrides jsonb,
  feature_overrides jsonb,
  notes text,
  updated_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure only one default plan at a time
create unique index plans_single_default on plans (is_default) where is_default = true;
