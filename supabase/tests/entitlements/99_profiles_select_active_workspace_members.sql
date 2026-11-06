\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- profiles SELECT must cover every member of the caller's ACTIVE workspace,
-- not only profiles whose conta_id equals it. switch_workspace() rewrites
-- profiles.conta_id to whichever workspace the user is in, so a user who
-- belongs to two workspaces has a conta_id matching only one of them. The CRM
-- roster (getWorkspaceUsers: workspace_members + profiles!inner) silently
-- dropped such members from the other workspace's Membros list, while the
-- Admin (service role) still listed them.
--
-- Cast (all inside one rolled-back transaction):
--   ws1, ws2, ws3
--   A: member of ws1, active in ws1                    (the viewer)
--   B: member of ws1 AND ws2, active in ws2            (the hidden member)
--   C: member of ws2 only, active in ws2               (A must not see)
--   D: member of ws3 only, active in ws3               (must not see B)

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws1 uuid; v_ws2 uuid; v_ws3 uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_seen boolean;
  v_roster int;
begin
  v_ws1 := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');
  v_ws3 := et_make_workspace('max');

  insert into auth.users (id) values (v_a), (v_b), (v_c), (v_d);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_a, v_ws1, 'owner'),
    (v_b, v_ws1, 'admin'),
    (v_b, v_ws2, 'owner'),
    (v_c, v_ws2, 'agent'),
    (v_d, v_ws3, 'owner');
  update profiles set conta_id = v_ws1, active_workspace_id = v_ws1 where id = v_a;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_b;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_c;
  update profiles set conta_id = v_ws3, active_workspace_id = v_ws3 where id = v_d;

  -- 1. A (active ws1) sees B, a ws1 member whose conta_id is ws2.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select exists(select 1 from profiles where id = v_b) into v_seen;
  reset role;
  if not v_seen then
    raise exception 'A cannot see B although B is a member of A''s active workspace';
  end if;

  -- 2. The roster query itself (the shape getWorkspaceUsers sends) returns
  --    both ws1 members, not just the one whose conta_id matches.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select count(*) into v_roster
    from workspace_members wm
    join profiles p on p.id = wm.user_id
   where wm.workspace_id = v_ws1;
  reset role;
  if v_roster <> 2 then
    raise exception 'ws1 roster as A returned % rows, expected 2', v_roster;
  end if;

  -- 3. A does NOT see C: sharing a workspace with B is not sharing one with C.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select exists(select 1 from profiles where id = v_c) into v_seen;
  reset role;
  if v_seen then
    raise exception 'A can see C, a member of a workspace A does not belong to';
  end if;

  -- 4. Scope is the ACTIVE workspace only: B (active ws2) sees C but not A,
  --    even though B also belongs to ws1.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select exists(select 1 from profiles where id = v_c) into v_seen;
  reset role;
  if not v_seen then
    raise exception 'B cannot see C, a member of B''s active workspace';
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select exists(select 1 from profiles where id = v_a) into v_seen;
  reset role;
  if v_seen then
    raise exception 'B sees A through ws1 although B''s active workspace is ws2';
  end if;

  -- 5. An unrelated tenant sees neither B nor A, but does see itself.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_d, 'role', 'authenticated')::text, true);
  select exists(select 1 from profiles where id in (v_a, v_b)) into v_seen;
  reset role;
  if v_seen then
    raise exception 'D (ws3) can see a profile from ws1/ws2';
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_d, 'role', 'authenticated')::text, true);
  select exists(select 1 from profiles where id = v_d) into v_seen;
  reset role;
  if not v_seen then
    raise exception 'D cannot see its own profile';
  end if;

  raise notice '99_profiles_select_active_workspace_members: cross-workspace member visible, scope stays on the active workspace';
end $$;
rollback;

-- 6. A user whose active_workspace_id is NULL (get_my_conta_id() NULL) still
--    reads its own profile row. Prod's live policy carried `id = auth.uid()`;
--    staging's did not, and the migration keeps the prod behaviour.
begin;
select et_grant_hosted_parity();
do $$
declare
  v_u uuid := gen_random_uuid();
  v_seen boolean;
begin
  insert into auth.users (id) values (v_u);
  update profiles set active_workspace_id = null where id = v_u;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  select exists(select 1 from profiles where id = v_u) into v_seen;
  reset role;
  if not v_seen then
    raise exception 'user with NULL active_workspace_id cannot read its own profile';
  end if;
end $$;
rollback;
