-- Effective per-workspace feature flag: plan boolean, overridden by feature_overrides.
-- Contract: never throws — fail-closed (false) on invalid setup, malformed override, or unknown key.
create or replace function effective_plan_feature(ws_id uuid, feature_key text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_plan_id text;
  v_override jsonb;
  v_raw text;
  v_val boolean;
  v_rows bigint;
begin
  select plan_id into v_plan_id from workspaces where id = ws_id;
  if not found then return false; end if;

  if v_plan_id is null then
    select id into v_plan_id from plans where is_default limit 1;
    if v_plan_id is null then return false; end if;
  end if;

  select feature_overrides into v_override
    from workspace_plan_overrides where workspace_id = ws_id;
  if v_override is not null and v_override ? feature_key then
    v_raw := v_override ->> feature_key;
    if v_raw in ('true', 'false') then
      return v_raw::boolean;
    else
      return false; -- malformed override => fail closed
    end if;
  end if;

  begin
    execute format('select %I from plans where id = $1', feature_key)
      into v_val using v_plan_id;
    get diagnostics v_rows = row_count;
  exception when undefined_column then
    return false; -- unknown feature_key => fail closed
  end;
  if v_rows = 0 then return false; end if; -- missing plan row

  return coalesce(v_val, false);
end;
$$;
