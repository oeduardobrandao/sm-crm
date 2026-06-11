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
