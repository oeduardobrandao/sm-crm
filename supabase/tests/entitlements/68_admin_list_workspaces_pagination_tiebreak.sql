\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ts timestamptz := now();
  v_ws_a uuid;
  v_ws_b uuid;
  v_page0 jsonb;
  v_page1 jsonb;
  v_id0 uuid;
  v_id1 uuid;
begin
  -- Two workspaces sharing the exact same created_at -- admin_list_workspaces' page CTE
  -- previously ordered by created_at alone, so a tie like this made pagination
  -- nondeterministic across separate offset/limit calls: the same row could land on two
  -- pages, or on neither, depending on how Postgres happened to break the tie. Scoped by a
  -- unique name prefix (via p_search) so pre-existing workspaces can't interfere with the
  -- offset/limit assertions below.
  insert into workspaces (name, plan_id, plan_source, created_at)
    values ('ET pagination tiebreak A', 'max', 'manual', v_ts)
    returning id into v_ws_a;
  insert into workspaces (name, plan_id, plan_source, created_at)
    values ('ET pagination tiebreak B', 'max', 'manual', v_ts)
    returning id into v_ws_b;

  execute 'set local role service_role';
  v_page0 := admin_list_workspaces('ET pagination tiebreak', null, 0, 1);
  v_page1 := admin_list_workspaces('ET pagination tiebreak', null, 1, 1);
  execute 'reset role';

  assert (v_page0 ->> 'total')::int = 2,
    format('expected 2 matching workspaces, got %s', v_page0 ->> 'total');
  assert jsonb_array_length(v_page0 -> 'workspaces') = 1, 'page at offset 0 (limit 1) must return exactly one row';
  assert jsonb_array_length(v_page1 -> 'workspaces') = 1, 'page at offset 1 (limit 1) must return exactly one row';

  v_id0 := ((v_page0 -> 'workspaces') -> 0 ->> 'id')::uuid;
  v_id1 := ((v_page1 -> 'workspaces') -> 0 ->> 'id')::uuid;

  assert v_id0 <> v_id1,
    format('pages must not overlap: both returned %s', v_id0);
  assert v_id0 in (v_ws_a, v_ws_b) and v_id1 in (v_ws_a, v_ws_b),
    'both pages must come from the two tied workspaces, none dropped or substituted';

  raise notice 'PASS 68_admin_list_workspaces_pagination_tiebreak';
end $$;
rollback;
