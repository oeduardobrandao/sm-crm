\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- The cross-tenant takeover, inverted into a regression test.
--
-- Production allowed: UPDATE profiles SET conta_id = '<victim ws>' WHERE
-- id = auth.uid(). conta_id is read by the legacy FOR ALL policies through
-- get_user_conta_id() and by ~15 edge functions as their tenant scope, so one
-- statement against your own row bought another workspace's data. Reproduced
-- before the fix: 0 rows visible, one UPDATE, 1 row visible.
--
-- profiles is EXCLUDED from et_grant_hosted_parity: this suite asserts the
-- migration's own column-level grant/revoke on that table, and a wholesale
-- re-grant would undo exactly what is under test. The suite still needs SELECT
-- so it can read rows back; that is granted explicitly below, deliberately
-- WITHOUT update. Both statements go inside each begin/rollback block, never at
-- file scope -- GRANT before an open transaction autocommits and leaks into
-- later suites (see 52_financial_enforcement.sql).
--
-- ON THE MUTATION TEST FOR THIS SUITE (Step 5 of the task brief). The brief
-- predicted: add conta_id to the migration's GRANT UPDATE list, reset -- the
-- migration's own post-condition aborts first with "client retains UPDATE on
-- protected profiles column(s): conta_id"; then also drop conta_id from the
-- post-condition's named protected-column check, reset again -- THIS suite
-- then fails with "client was able to write profiles.conta_id".
--
-- Verified: the first half holds, but through a different one of the
-- post-condition's two checks than predicted. The EXACT-SET comparison
-- (v_actual IS DISTINCT FROM v_expected) aborts first, before the named
-- protected-column check runs, because adding conta_id to the grant changes
-- the actual array regardless of which named list is being checked. Message
-- actually seen: "authenticated UPDATE columns on profiles are
-- conta_id,empresa,..., expected empresa,...". Functionally equivalent (the
-- migration still refuses to apply either way).
--
-- The second half does not hold, and this is the part worth recording.
-- Dropping conta_id from ONLY the named protected-column list still leaves
-- the exact-set check failing (v_expected there is untouched), so the
-- migration never applies -- editing that one list, per the brief's literal
-- wording, cannot even reach a state where this suite runs against a live
-- regression. Editing v_expected AS WELL lets the migration apply, and with
-- the grant restored to include conta_id, section 1 below PASSES -- it does
-- NOT fail as predicted.
--
-- Why: profiles has a pre-existing SELECT policy, profiles_select_same_workspace
-- (qual: conta_id = get_my_conta_id(), from 20260315_rls_security_audit.sql),
-- unrelated to this migration. PostgreSQL enforces a table's SELECT-policy
-- qual as an ADDITIONAL implicit WITH CHECK against the resulting row for
-- INSERT and UPDATE, on top of whatever the command-specific policy checks --
-- documented Postgres RLS behavior, not something introduced here. So even
-- with conta_id fully re-granted, `UPDATE profiles SET conta_id = <other ws>
-- WHERE id = auth.uid()` still gets refused: the resulting row (conta_id =
-- other ws, active_workspace_id unchanged = own ws) fails
-- profiles_select_same_workspace's check, and that refusal raises SQLSTATE
-- 42501 (insufficient_privilege) -- the exact code a plain column-privilege
-- denial also raises. Section 1's `exception when insufficient_privilege then
-- null` below cannot tell the two apart, so it treats this incidental RLS
-- refusal as proof the grant is correctly restricted, whether or not it
-- actually is.
--
-- This means section 1's conta_id sub-case, as written, cannot by itself
-- catch a future regression that re-adds conta_id to the GRANT UPDATE list,
-- as long as the attacker's own active_workspace_id differs from the target
-- workspace (the realistic case). It is NOT a gap in the shipped migration:
-- confirmed separately, with profiles_select_same_workspace DROPPED inside a
-- rolled-back transaction (isolating the RLS backstop out of the picture),
-- that the correctly-configured grant (conta_id absent) still refuses the
-- write -- this time with a genuine "permission denied for table profiles".
-- The privilege revoke works on its own merits; the gap is specifically in
-- this test's ability to PROVE that in isolation, for conta_id.
--
-- Contrast with active_workspace_id in the same loop: an accidental grant
-- there would be caught, not masked. trg_validate_active_workspace (BEFORE
-- UPDATE OF active_workspace_id, from 20260317_multi_workspace.sql) raises a
-- plain exception ('User is not a member of this workspace', SQLSTATE P0001,
-- not 42501), which `when insufficient_privilege` does NOT catch -- the suite
-- would fail loudly instead of silently passing. The masking above is
-- specific to conta_id, because its incidental backstop happens to share a
-- SQLSTATE with genuine privilege denial and active_workspace_id's does not.
--
-- Not fixed here: closing this would mean either dropping/disabling
-- profiles_select_same_workspace for the duration of the check (mirroring
-- 55_switch_workspace_rpc.sql's DISABLE TRIGGER isolation) or reworking the
-- assertion to distinguish on message text as well as SQLSTATE, and either
-- changes this suite's committed behavior -- left for a follow-up review
-- rather than a same-pass patch.

-- =============================================================
-- 1. The tenant selector and the role are not writable by their owner.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['profiles']);
grant select on public.profiles to authenticated;
do $$
declare
  v_ws_a   uuid;
  v_ws_b   uuid;
  v_uid    uuid := gen_random_uuid();
  v_col    text;
  v_got    uuid;
  v_role   text;
  v_rows   int;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a,
                      role = 'owner'
   where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Each protected column, individually. Privilege denial RAISES (unlike RLS's
  -- USING clause, which silently filters), so a plain exception check is the
  -- right shape here. Caveat: RLS's WITH CHECK also RAISES, with the same
  -- SQLSTATE as privilege denial -- see the mutation-test note above the top
  -- of this file for the one case (conta_id) where that overlap matters.
  foreach v_col in array ARRAY['conta_id','active_workspace_id'] loop
    begin
      execute format('update public.profiles set %I = $1 where id = $2', v_col)
        using v_ws_b, v_uid;
      reset role;
      raise exception 'client was able to write profiles.%', v_col;
    exception when insufficient_privilege then
      null;  -- expected
    end;
  end loop;

  begin
    update public.profiles set role = 'owner'::public.user_role where id = v_uid;
    reset role;
    raise exception 'client was able to write profiles.role';
  exception when insufficient_privilege then
    null;  -- expected
  end;

  reset role;

  -- Denial must also have changed nothing. A test that only asserts "it threw"
  -- would pass against a broken implementation that threw after writing.
  select conta_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_a then
    raise exception 'conta_id changed despite the denial (got %)', v_got;
  end if;
  select role::text into v_role from profiles where id = v_uid;
  if v_role is distinct from 'owner' then
    raise exception 'role changed despite the denial (got %)', v_role;
  end if;

  raise notice '56: tenant selector and role are not client-writable';
end $$;
rollback;

-- =============================================================
-- 2. The positive counterpart. Without it, a revoke that was far too broad --
--    say, all UPDATE removed -- would pass section 1 and break every profile
--    edit in the app.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['profiles']);
grant select on public.profiles to authenticated;
do $$
declare
  v_ws   uuid;
  v_uid  uuid := gen_random_uuid();
  v_nome text;
  v_ob   boolean;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Every column the app actually writes, not a representative sample: a grant
  -- that dropped one of them would break a real screen and go uncaught.
  update public.profiles
     set nome = 'Ana', empresa = 'Mesaas', telefone = '11999',
         whatsapp = '11888', marketing_opt_in = true, onboarding_complete = true
   where id = v_uid;

  reset role;
  select nome, onboarding_complete into v_nome, v_ob from profiles where id = v_uid;
  if v_nome is distinct from 'Ana' or v_ob is not true then
    raise exception 'a permitted profile edit did not persist (nome=%, ob=%)',
      v_nome, v_ob;
  end if;

  raise notice '56: permitted profile edits still work';
end $$;
rollback;

-- =============================================================
-- 3. A user cannot edit SOMEONE ELSE's profile. This is the RLS half rather
--    than the privilege half, so it denies by filtering: assert the affected
--    row count is zero AND the victim's data is untouched.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['profiles']);
grant select on public.profiles to authenticated;
do $$
declare
  v_ws     uuid;
  v_uid    uuid := gen_random_uuid();
  v_victim uuid := gen_random_uuid();
  v_rows   int;
  v_nome   text;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_uid), (v_victim);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws, 'owner'), (v_victim, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws,
                      nome = 'Victim'
   where id = v_victim;
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  update public.profiles set nome = 'Hacked' where id = v_victim;
  get diagnostics v_rows = ROW_COUNT;
  reset role;

  if coalesce(v_rows, -1) <> 0 then
    raise exception 'edited another user''s profile: % row(s)', v_rows;
  end if;
  select nome into v_nome from profiles where id = v_victim;
  if v_nome is distinct from 'Victim' then
    raise exception 'victim profile was modified (nome=%)', v_nome;
  end if;

  raise notice '56: cannot edit another user''s profile';
end $$;
rollback;
