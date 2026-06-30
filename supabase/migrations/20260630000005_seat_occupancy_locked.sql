-- Occupancy reader for billing-seats decrease validation. Takes the SAME advisory
-- lock as enforce_plan_count_limit('max_team_members') so a concurrent invite cannot
-- slip an extra member between the read and the seat decrease (TOCTOU).
-- occupancy = workspace_members + pending invites, matching the invite seat gate
-- in invite-user/index.ts:140-145 (members by workspace_id, invites by conta_id).
create or replace function seat_occupancy_locked(ws_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  -- ADVISORY-LOCK KEY SYNC: byte-identical to the seat trigger so the two paths
  -- serialize. enforce_plan_count_limit (migration 20260611130002_enforce_plan_count_limit_fn.sql,
  -- line 38) composes the key as: pg_advisory_xact_lock(hashtext(v_ws_id::text || ':' || v_limit_key))
  -- with v_limit_key = 'max_team_members', i.e. the literal '<uuid>:max_team_members'.
  -- Building the same string here via ws_id::text || ':max_team_members' yields the
  -- same hashtext lock id. If you ever change one key, change BOTH.
  perform pg_advisory_xact_lock(hashtext(ws_id::text || ':max_team_members'));

  -- workspace_members is keyed on workspace_id; invites is keyed on conta_id
  -- (the invites table has NO workspace_id column — see 20260316_invites_table.sql).
  select
    (select count(*) from workspace_members where workspace_id = ws_id)
    + (select count(*) from invites
         where conta_id = ws_id and status = 'pending')
  into v_count;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function seat_occupancy_locked(uuid) from public, anon, authenticated;
