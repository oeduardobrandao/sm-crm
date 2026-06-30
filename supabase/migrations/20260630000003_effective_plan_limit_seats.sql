-- Slice 1: effective_plan_limit now adds purchased seats to max_team_members.
-- Never edit the historical 20260611130001 file in place — ship a new CREATE OR REPLACE.
-- Contract for max_team_members (all other keys byte-identical to 20260611130001):
--   1. base = admin resource_overrides.max_team_members if present, else plans.max_team_members.
--   2. base IS NULL  => return NULL (unlimited; do NOT coalesce(base,0)+seats).
--   3. admin override present => return it OUTRIGHT (comp is replacement; seats NOT stacked).
--   4. else => base + COALESCE(purchased_seats WHERE status IN ('active','trialing'), 0).
--   5. fail-closed 0 for unknown ws / unknown key / malformed override / missing plan.
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
  v_raw text;
  v_limit bigint;
  v_rows bigint;
  v_seats bigint;
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
    v_raw := v_override ->> limit_key;
    if v_raw is null then
      return null;                 -- explicit null override => unlimited
    elsif v_raw ~ '^-?[0-9]+$' then
      return v_raw::bigint;        -- admin override wins OUTRIGHT (seats not stacked)
    else
      return 0;                    -- malformed override => fail closed
    end if;
  end if;

  begin
    execute format('select %I from plans where id = $1', limit_key)
      into v_limit using v_plan_id;
    get diagnostics v_rows = row_count;
  exception when undefined_column then
    return 0;                      -- unknown limit_key => fail closed
  end;
  if v_rows = 0 then
    return 0;                      -- plan row missing
  end if;

  -- Additive purchased seats: ONLY for max_team_members, ONLY when base is non-NULL.
  -- NULL base short-circuits to unlimited (never base+seats). Comp overrides already
  -- returned above. Seats are status-gated to (active|trialing); a missing sub row
  -- coalesces to +0 and never errors.
  if limit_key = 'max_team_members' and v_limit is not null then
    select coalesce(
      (select purchased_seats from workspace_subscriptions
         where workspace_id = ws_id and status in ('active','trialing')), 0)
      into v_seats;
    return v_limit + v_seats;
  end if;

  return v_limit; -- may be NULL => unlimited
end;
$$;
