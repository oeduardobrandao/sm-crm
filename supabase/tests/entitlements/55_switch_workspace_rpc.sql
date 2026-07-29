\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- switch_workspace() is the replacement for the client's direct UPDATE of
-- profiles.active_workspace_id / conta_id. Its whole value is the membership
-- check, so the non-member case below is the load-bearing test.
--
-- ON THE MUTATION TEST FOR THIS SUITE. The task brief for this migration
-- called for a mutation test: comment out the RPC's own
-- `IF NOT EXISTS (...) RAISE EXCEPTION 'not_a_member'` guard, re-apply,
-- confirm test 2 below now fails, restore, confirm it passes again -- proving
-- this suite is not vacuous. Running that mutation found the prediction was
-- wrong: with the guard removed, test 2's negative case (real switch target,
-- real non-member) STILL fails, but with a different error --
-- "User is not a member of this workspace" -- which comes from
-- validate_active_workspace(), the trigger installed by
-- 20260317_multi_workspace.sql as trg_validate_active_workspace. That trigger
-- fires BEFORE UPDATE OF active_workspace_id ON profiles whenever the new
-- value is non-NULL and changing, and independently checks workspace_members.
-- Because switch_workspace() always writes active_workspace_id and conta_id
-- in the same UPDATE (by design -- see this migration's own header comment
-- on "Both selectors in ONE statement"), the trigger backstops exactly the
-- scenario the mutation test exercises. So the naive mutation test does not
-- isolate the RPC's own guard -- it can't tell "the RPC's check works" apart
-- from "the trigger alone would have caught this anyway."
--
-- This is NOT a security bug. The property that matters -- a non-member
-- cannot switch into another real workspace -- is enforced twice,
-- independently, which is a reasonable defense-in-depth outcome. But the
-- RPC's own guard is not thereby decorative: the trigger only fires on
-- active_workspace_id changing to non-NULL. If a future edit to
-- switch_workspace() ever wrote conta_id without also changing
-- active_workspace_id in the same statement, or reordered the two writes
-- across statements, the trigger would not catch it -- only the RPC's own
-- membership check would. Do not remove the RPC's guard on the assumption
-- the trigger alone covers it.
--
-- PROVING THE RPC'S OWN GUARD IN ISOLATION. The only way to exercise the
-- RPC's check apart from the trigger is to disable the trigger for the
-- duration of the mutated call. This harness has no expect-failure mode for
-- "guard removed, expect success" (same limitation noted in
-- 54_financial_policy_ownership.sql: psql's \i cannot be wrapped in a plpgsql
-- exception handler), so it is not automated here. Verified by hand instead,
-- against a scratch copy of the function (switch_workspace_mutated, defined
-- inline in a throwaway psql session -- the committed migration file was
-- never edited) with the guard's `IF NOT EXISTS (...) RAISE EXCEPTION
-- 'not_a_member'` block removed and everything else identical:
--
--   BEGIN;
--   -- (et_make_workspace 'max' x2 -> v_ws_a, v_ws_b; test user is a member
--   --  of v_ws_a only, conta_id/active_workspace_id both = v_ws_a)
--
--   ALTER TABLE public.profiles DISABLE TRIGGER trg_validate_active_workspace;
--   -- as authenticated, with the guard-removed switch_workspace_mutated(v_ws_b):
--   NOTICE:  STEP2 (trigger DISABLED, guard removed): switch SUCCEEDED
--   NOTICE:  STEP2 conta_id=<v_ws_b>  active_workspace_id=<v_ws_b>  (v_ws_a=<v_ws_a>  v_ws_b=<v_ws_b>)
--   ALTER TABLE public.profiles ENABLE TRIGGER trg_validate_active_workspace;
--   ROLLBACK;
--
-- i.e. with the trigger disabled, removing the RPC's own guard DOES let a
-- non-member switch into a real other workspace succeed -- confirming the
-- guard, when present, is what blocks it. (For contrast, the same mutated
-- function with the trigger left ENABLED reproduces the "not vacuous but not
-- isolating" result above: switch DENIED with "User is not a member of this
-- workspace", i.e. the trigger's message, not the RPC's 'not_a_member'.)
-- Re-run by hand if switch_workspace()'s guard or its single-UPDATE shape is
-- ever touched.

-- =============================================================
-- 1. anon cannot execute it at all.
-- =============================================================
begin;
do $$
declare v_denied boolean := false;
begin
  set local role anon;
  begin
    perform public.switch_workspace(gen_random_uuid());
  exception when insufficient_privilege then
    v_denied := true;
  end;
  reset role;
  if not v_denied then
    raise exception 'anon must not be able to execute switch_workspace';
  end if;
end $$;
rollback;

-- =============================================================
-- 2. A member can switch; a non-member cannot. Both directions in one
--    transaction so the positive case proves the negative is not simply
--    "everything fails".
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a   uuid;
  v_ws_b   uuid;
  v_ws_c   uuid;
  v_uid    uuid := gen_random_uuid();
  v_got    uuid;
  v_denied boolean := false;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');
  v_ws_c := et_make_workspace('max');

  insert into auth.users (id) values (v_uid);
  -- Member of A and C, not B.
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws_a, 'owner');
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws_c, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Positive: switching to a DIFFERENT workspace we belong to (A -> C) succeeds
  -- and moves BOTH selectors. Starting and ending on the same workspace (A -> A)
  -- would let a no-op implementation pass trivially; A -> C is a genuine state
  -- transition. Checking only active_workspace_id would miss a partial write,
  -- and conta_id is the column the legacy policies actually read.
  perform public.switch_workspace(v_ws_c);
  reset role;
  select active_workspace_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_c then
    raise exception 'authorized switch did not set active_workspace_id (got %)', v_got;
  end if;
  select conta_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_c then
    raise exception 'authorized switch did not set conta_id (got %)', v_got;
  end if;

  -- Negative: workspace B, where we hold no membership.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  begin
    perform public.switch_workspace(v_ws_b);
  exception when others then
    v_denied := true;
  end;
  reset role;

  if not v_denied then
    raise exception 'switch_workspace allowed a non-member to switch';
  end if;

  -- And the refusal left nothing behind. The user's real current workspace at
  -- this point is C (set by the positive case above), not the original A.
  select conta_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_c then
    raise exception 'refused switch still mutated conta_id (got %)', v_got;
  end if;

  raise notice '55_switch_workspace_rpc: member switches A -> C, non-member switch to B refused';
end $$;
rollback;
