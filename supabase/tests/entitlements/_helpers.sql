-- Creates a workspace on a given plan, returns its id. For use inside a tx that is rolled back.
create or replace function et_make_workspace(p_plan_id text, p_overrides jsonb default null)
returns uuid language plpgsql as $$
declare v_ws uuid;
begin
  insert into workspaces (name, plan_id, plan_source)
    values ('ET test ws', p_plan_id, 'manual')
    returning id into v_ws;
  if p_overrides is not null then
    insert into workspace_plan_overrides (workspace_id, resource_overrides)
      values (v_ws, p_overrides);
  end if;
  return v_ws;
end;
$$;

-- Seeds the Stripe mirror row for a workspace inside a rolled-back tx, so
-- effective_plan_limit's status-gated purchased_seats term can be exercised.
-- plan_id left NULL (nullable FK) — these tests don't depend on the mirror's plan_id.
create or replace function et_seed_subscription(p_ws uuid, p_seats int, p_status text default 'active')
returns void language plpgsql as $$
begin
  insert into workspace_subscriptions (workspace_id, status, purchased_seats)
    values (p_ws, p_status, p_seats)
  on conflict (workspace_id) do update
    set status = excluded.status, purchased_seats = excluded.purchased_seats;
end;
$$;
