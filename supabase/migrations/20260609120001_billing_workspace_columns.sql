-- Slice 1 billing: consolidate the effective-plan source of truth onto workspaces.plan_id.

-- (A) Ensure workspaces.plan_id exists. It is read/written across the codebase but was
-- created "via dashboard" and never migrated, so fresh/staging DBs lack it.
alter table workspaces
  add column if not exists plan_id text references plans(id) on delete set null;

-- (B) plan_source distinguishes Stripe-owned vs admin-comped plans.
--   system = unmanaged/free (webhook may take ownership on first checkout)
--   stripe = owned by an active Stripe subscription
--   manual = admin comp/enterprise (webhook never overrides plan_id)
alter table workspaces
  add column if not exists plan_source text not null default 'system'
  check (plan_source in ('system', 'stripe', 'manual'));

-- (F) Retire workspace_plan_overrides.plan_id as a source of truth. It is NOT NULL today,
-- which would block override-only rows once plan assignment lives on workspaces.plan_id.
alter table workspace_plan_overrides alter column plan_id drop not null;
comment on column workspace_plan_overrides.plan_id is
  'Deprecated: effective plan now lives in workspaces.plan_id; retained for back-compat, not read.';
