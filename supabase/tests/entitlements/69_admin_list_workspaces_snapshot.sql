\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  -- now() is transaction_timestamp() under the hood: it returns the SAME value for every
  -- call within this one transaction, it does not advance between statements. So "before"
  -- and "after" the snapshot can't be expressed by just calling now() twice -- they have to
  -- be explicit offsets from one frozen capture instead.
  v_now timestamptz := now();
  v_as_of timestamptz;
  v_ws_a uuid;
  v_ws_b uuid;
  v_result jsonb;
begin
  -- Simulates the export's snapshot: workspace A exists before the snapshot is taken,
  -- workspace B is created after it (like a signup landing mid-export). Scoped by a unique
  -- name prefix (via p_search) so pre-existing workspaces can't interfere with the total
  -- assertions below.
  insert into workspaces (name, plan_id, plan_source, created_at)
    values ('ET snapshot test A', 'max', 'manual', v_now - interval '1 minute')
    returning id into v_ws_a;

  v_as_of := v_now - interval '30 seconds';

  insert into workspaces (name, plan_id, plan_source, created_at)
    values ('ET snapshot test B', 'max', 'manual', v_now)
    returning id into v_ws_b;

  execute 'set local role service_role';
  v_result := admin_list_workspaces('ET snapshot test', null, 0, 50, v_as_of);
  execute 'reset role';

  assert (v_result ->> 'total')::int = 1,
    format('snapshot must exclude workspaces created after p_as_of, got total=%s', v_result ->> 'total');
  assert jsonb_array_length(v_result -> 'workspaces') = 1,
    'exactly one workspace expected within the snapshot';
  assert ((v_result -> 'workspaces') -> 0 ->> 'id')::uuid = v_ws_a,
    'the snapshot must contain the workspace that existed as of p_as_of, not the later one';

  -- Omitting p_as_of (every existing caller -- the on-screen table, the Dashboard) must behave
  -- exactly as before: both workspaces visible, since created_at can never be in the future.
  execute 'set local role service_role';
  v_result := admin_list_workspaces('ET snapshot test', null, 0, 50);
  execute 'reset role';

  assert (v_result ->> 'total')::int = 2,
    format('omitting p_as_of must see both workspaces, got total=%s', v_result ->> 'total');

  raise notice 'PASS 69_admin_list_workspaces_snapshot';
end $$;
rollback;
