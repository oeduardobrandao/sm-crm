\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- entregas_saved_views (20261016000001): a user reads and writes only their own
-- rows, and only in their active workspace; anon gets nothing.
--
-- Grants: the table is excluded from the parity helper, and the migration's own
-- REVOKE ALL + GRANT CRUD is re-applied here because 92_reorder_fluxos_board.sql
-- calls et_grant_hosted_parity() outside any transaction, so in a full harness
-- run every public table permanently carries ALL for anon (same defensive lines
-- as 99_tarefa_series_rls.sql; rolled back with each transaction). Part D then
-- grants anon ALL on purpose, to prove RLS alone still denies it.
--
-- Fixture: inserting into auth.users fires handle_new_user_workspace(), which
-- creates a personal workspace + profile; the tests then point the profile at
-- the shared 'pro' workspace (two seats: free's max_team_members=1 would reject
-- the second member, see 64 Part B).

-- =============================================================
-- Part A: own rows only, active workspace only, WITH CHECK on insert/update.
-- =============================================================
begin;
select et_grant_hosted_parity(array['entregas_saved_views']);
revoke all on public.entregas_saved_views from anon, authenticated;
grant select, insert, update, delete on public.entregas_saved_views to authenticated;
grant all on public.entregas_saved_views to service_role;

do $$
declare
  v_ws_a uuid := et_make_workspace('pro');
  v_ws_b uuid := et_make_workspace('pro');
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_a1 uuid; v_b1 uuid; v_u2row uuid;
  v_n int;
  v_names text;
  v_rejected boolean;
  v_updated timestamptz;
begin
  insert into auth.users (id, email) values (v_u1, 'sv-u1@x.test'), (v_u2, 'sv-u2@x.test');
  insert into workspace_members (workspace_id, user_id, role) values
    (v_ws_a, v_u1, 'owner'), (v_ws_b, v_u1, 'owner'), (v_ws_a, v_u2, 'admin');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id in (v_u1, v_u2);

  -- Seed as the table owner (bypasses RLS).
  insert into entregas_saved_views (conta_id, user_id, name, query, updated_at)
    values (v_ws_a, v_u1, 'A1', 'view=list', now() - interval '1 day') returning id into v_a1;
  insert into entregas_saved_views (conta_id, user_id, name, query)
    values (v_ws_b, v_u1, 'B1', 'view=chart') returning id into v_b1;
  insert into entregas_saved_views (conta_id, user_id, name, query)
    values (v_ws_a, v_u2, 'U2', 'view=kanban') returning id into v_u2row;

  -- ---- as u1, active workspace A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Only A1: B1 is in a workspace that is not the active one, U2 belongs to u2.
  select count(*), string_agg(name, ',') into v_n, v_names from entregas_saved_views;
  assert v_n = 1 and v_names = 'A1', format('u1 must see only A1, saw %s (%s)', v_n, v_names);

  -- Insert into the active workspace works.
  insert into entregas_saved_views (conta_id, user_id, name, query)
    values (v_ws_a, v_u1, 'Nova', 'view=calendar');

  -- Insert into another workspace u1 IS a member of, but not the active one: refused.
  v_rejected := false;
  begin
    insert into entregas_saved_views (conta_id, user_id, name, query)
      values (v_ws_b, v_u1, 'Fora', 'view=list');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'insert into a non-active workspace must be refused by WITH CHECK';

  -- Insert on behalf of another user: refused.
  v_rejected := false;
  begin
    insert into entregas_saved_views (conta_id, user_id, name, query)
      values (v_ws_a, v_u2, 'Impostor', 'view=list');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'insert with another user_id must be refused by WITH CHECK';

  -- Moving an own row to another workspace: refused.
  v_rejected := false;
  begin
    update entregas_saved_views set conta_id = v_ws_b where id = v_a1;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'update moving a row to another workspace must be refused by WITH CHECK';

  -- Handing an own row to another user: refused.
  v_rejected := false;
  begin
    update entregas_saved_views set user_id = v_u2 where id = v_a1;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'update handing a row to another user must be refused by WITH CHECK';

  -- Other user's row and the non-active workspace's row: invisible to UPDATE/DELETE.
  update entregas_saved_views set name = 'hacked' where id in (v_u2row, v_b1);
  get diagnostics v_n = row_count;
  assert v_n = 0, format('u1 must not update rows it cannot see, updated %s', v_n);
  delete from entregas_saved_views where id in (v_u2row, v_b1);
  get diagnostics v_n = row_count;
  assert v_n = 0, format('u1 must not delete rows it cannot see, deleted %s', v_n);

  -- Rename an own row works and bumps updated_at (trigger).
  update entregas_saved_views set name = 'A1 renomeada' where id = v_a1;
  get diagnostics v_n = row_count;
  assert v_n = 1, 'u1 must be able to rename its own row';
  select updated_at into v_updated from entregas_saved_views where id = v_a1;
  assert v_updated > now() - interval '1 hour', 'updated_at trigger did not bump the column';

  reset role;

  -- The refused writes left nothing behind (checked as owner).
  assert (select name from entregas_saved_views where id = v_u2row) = 'U2', 'U2 row was modified';
  assert (select conta_id from entregas_saved_views where id = v_b1) = v_ws_b, 'B1 row was modified';
  assert not exists (select 1 from entregas_saved_views where name in ('Fora', 'Impostor')),
    'a refused insert left a row';

  -- ---- as u2, same workspace A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), string_agg(name, ',') into v_n, v_names from entregas_saved_views;
  assert v_n = 1 and v_names = 'U2',
    format('u2 must see only its own row in the same workspace, saw %s (%s)', v_n, v_names);
  reset role;

  raise notice 'PASS 99 entregas_saved_views Part A: own rows, active workspace, WITH CHECK';
end $$;
rollback;

-- =============================================================
-- Part B: name is unique per user + workspace, not globally; ON CONFLICT DO
-- NOTHING (the importer's upsert ignoreDuplicates) is a silent no-op.
-- =============================================================
begin;
select et_grant_hosted_parity(array['entregas_saved_views']);
revoke all on public.entregas_saved_views from anon, authenticated;
grant select, insert, update, delete on public.entregas_saved_views to authenticated;
grant all on public.entregas_saved_views to service_role;

do $$
declare
  v_ws uuid := et_make_workspace('pro');
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_n int;
  v_rejected boolean;
begin
  insert into auth.users (id, email) values (v_u1, 'sv-b1@x.test'), (v_u2, 'sv-b2@x.test');
  insert into workspace_members (workspace_id, user_id, role) values
    (v_ws, v_u1, 'owner'), (v_ws, v_u2, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_u1, v_u2);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u1, 'Mesma', 'a=1');

  v_rejected := false;
  begin
    insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u1, 'Mesma', 'a=2');
  exception when unique_violation then v_rejected := true; end;
  assert v_rejected, 'a second view with the same name for the same user+workspace must be rejected';

  insert into entregas_saved_views (conta_id, user_id, name, query)
    values (v_ws, v_u1, 'Mesma', 'a=3'), (v_ws, v_u1, 'Outra', 'a=4')
    on conflict (user_id, conta_id, name) do nothing;
  select count(*) into v_n from entregas_saved_views;
  assert v_n = 2, format('ON CONFLICT DO NOTHING must keep Mesma and add Outra, have %s', v_n);
  assert (select query from entregas_saved_views where name = 'Mesma') = 'a=1',
    'ON CONFLICT DO NOTHING must not overwrite the existing query';

  -- CHECKs: blank name, name over 80 chars, query over 4000 chars.
  v_rejected := false;
  begin
    insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u1, '   ', 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'blank name accepted';
  v_rejected := false;
  begin
    insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u1, repeat('n', 81), 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, '81-char name accepted';
  v_rejected := false;
  begin
    insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u1, 'Longa', repeat('q', 4001));
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, '4001-char query accepted';

  -- The same name for another user in the same workspace is fine.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
  insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u2, 'Mesma', 'b=1');
  reset role;

  raise notice 'PASS 99 entregas_saved_views Part B: unique per user+workspace, ON CONFLICT DO NOTHING, CHECKs';
end $$;
rollback;

-- =============================================================
-- Part C: leaving the workspace hides the rows and blocks writes; deleting the
-- user cascades instead of erroring.
-- =============================================================
begin;
select et_grant_hosted_parity(array['entregas_saved_views']);
revoke all on public.entregas_saved_views from anon, authenticated;
grant select, insert, update, delete on public.entregas_saved_views to authenticated;
grant all on public.entregas_saved_views to service_role;

do $$
declare
  v_ws uuid := et_make_workspace('pro');
  v_u uuid := gen_random_uuid();
  v_n int;
  v_rejected boolean;
begin
  insert into auth.users (id, email) values (v_u, 'sv-c@x.test');
  insert into workspace_members (workspace_id, user_id, role) values (v_ws, v_u, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_u;
  insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u, 'Minha', 'x=1');

  -- Removed from the workspace, profile still pointing at it.
  delete from workspace_members where workspace_id = v_ws and user_id = v_u;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from entregas_saved_views;
  assert v_n = 0, format('a removed member must see no rows, saw %s', v_n);
  v_rejected := false;
  begin
    insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u, 'Depois', 'x=2');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'a removed member must not be able to insert into the workspace';
  reset role;

  delete from auth.users where id = v_u;
  assert not exists (select 1 from entregas_saved_views where user_id = v_u),
    'deleting the user must cascade to their saved views';

  raise notice 'PASS 99 entregas_saved_views Part C: removed member, user delete cascades';
end $$;
rollback;

-- =============================================================
-- Part D: anon is denied, by the grants and by RLS on its own.
-- =============================================================
begin;
select et_grant_hosted_parity(array['entregas_saved_views']);
revoke all on public.entregas_saved_views from anon, authenticated;
grant select, insert, update, delete on public.entregas_saved_views to authenticated;
grant all on public.entregas_saved_views to service_role;

do $$
declare
  v_ws uuid := et_make_workspace('pro');
  v_u uuid := gen_random_uuid();
  v_n int;
  v_rejected boolean;
begin
  insert into auth.users (id, email) values (v_u, 'sv-d@x.test');
  insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u, 'Secreta', 'x=1');

  assert not has_table_privilege('anon', 'public.entregas_saved_views', 'SELECT'),
    'anon must not hold SELECT after the migration grants';

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  v_rejected := false;
  begin
    select count(*) into v_n from entregas_saved_views;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'anon select must be denied by the grants';
  reset role;

  -- Even with every privilege (hosted default ACL drift), RLS has no anon policy.
  grant all on public.entregas_saved_views to anon;
  set local role anon;
  select count(*) into v_n from entregas_saved_views;
  assert v_n = 0, format('anon with grants must still see 0 rows, saw %s', v_n);
  v_rejected := false;
  begin
    insert into entregas_saved_views (conta_id, user_id, name, query) values (v_ws, v_u, 'Anon', 'x=2');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'anon insert must be refused by RLS';
  update entregas_saved_views set name = 'hacked';
  get diagnostics v_n = row_count;
  assert v_n = 0, format('anon update must touch 0 rows, touched %s', v_n);
  reset role;

  raise notice 'PASS 99 entregas_saved_views Part D: anon denied';
end $$;
rollback;
