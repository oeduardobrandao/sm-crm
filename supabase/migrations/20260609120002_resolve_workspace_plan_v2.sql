-- Make resolve_workspace_plan() read the single source of truth (workspaces.plan_id),
-- so banner targeting and workspace-limits agree. Previously it read
-- workspace_plan_overrides.plan_id, which the Stripe webhook does not write.
create or replace function resolve_workspace_plan(ws_id uuid)
returns text
language sql
security definer
stable
as $$
  select coalesce(
    (select plan_id from workspaces where id = ws_id),
    (select id from plans where is_default = true limit 1)
  );
$$;
