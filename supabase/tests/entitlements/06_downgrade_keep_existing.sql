\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- 5. Downgrade semantics: block-new / keep-existing.
--    Create a workspace on start (max_clients = 5) and fill it to the limit (5 clientes).
--    Then "downgrade" by writing a resource_overrides lowering max_clients to 2.
--    Existing rows are kept (count stays 5), but a NEW insert is blocked (over the lowered limit).
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_n int; v_blocked boolean := false; i int;
begin
  v_ws := et_make_workspace('start'); -- max_clients = 5, no overrides row yet
  for i in 1..5 loop
    insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C'||i, 'C'||i, '#000');
  end loop; -- 5 allowed at the start limit

  -- simulate a downgrade: lower max_clients to 2 via an override on this workspace
  insert into workspace_plan_overrides (workspace_id, resource_overrides)
    values (v_ws, '{"max_clients": 2}'::jsonb);

  -- existing rows are kept: count is still 5 even though the limit is now 2
  select count(*) into v_n from clientes where conta_id = v_ws;
  assert v_n = 5, format('existing clientes should be kept (expected 5, got %s)', v_n);

  -- a NEW insert must be blocked (5 >= 2)
  begin
    insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C6', 'C6', '#000');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_clients%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'new clientes insert after downgrade should have been blocked';
  raise notice 'PASS 06 downgrade block-new/keep-existing';
end $$;
rollback;
