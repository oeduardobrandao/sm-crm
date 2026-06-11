-- Effective per-workspace resource limit: plan value, overridden by
-- workspace_plan_overrides.resource_overrides. NULL = unlimited; 0 = fail-closed.
create or replace function effective_plan_limit(ws_id uuid, limit_key text)
returns bigint
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_plan_id text;
  v_override jsonb;
  v_limit bigint;
  v_rows   int;
begin
  select plan_id into v_plan_id from workspaces where id = ws_id;
  if not found then
    return 0; -- unknown workspace
  end if;

  if v_plan_id is null then
    select id into v_plan_id from plans where is_default limit 1;
    if v_plan_id is null then
      return 0; -- no default plan configured
    end if;
  end if;

  select resource_overrides into v_override
    from workspace_plan_overrides where workspace_id = ws_id;
  if v_override is not null and v_override ? limit_key then
    return (v_override ->> limit_key)::bigint;
  end if;

  execute format('select %I from plans where id = $1', limit_key)
    into v_limit using v_plan_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 0; -- plan_id references a missing plan
  end if;

  return v_limit; -- may be NULL => unlimited
end;
$$;
