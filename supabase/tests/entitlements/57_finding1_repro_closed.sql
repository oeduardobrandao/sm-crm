\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Permanent regression gate for the ORIGINAL Finding 1 exploit, promoted from
-- the one-time manual reproduction at
-- docs/superpowers/specs/2026-07-28-finding1-reproduction.sql.
--
-- Reproduces PRODUCTION's actual starting ACL and policies on profiles/clientes
-- (GRANT ALL, no WITH CHECK on the UPDATE policy, the escape-hatched SELECT
-- policy, the legacy clientes pair) -- NOT whatever the local migrations-built
-- database happens to currently have, which is drift-prone and already known to
-- differ from production in exactly the ways that matter here (local's
-- profiles_select_same_workspace has no escape hatch; local's baseline grants
-- no SELECT on profiles to authenticated at all, only Dxtm). Then applies the
-- ACTUAL committed migration 20260729000002 on top, so this suite tests the
-- real file, not a hand-copied approximation of it.
--
-- WHY THIS MATTERS (found the hard way): an earlier version of this suite left
-- local's ambient profiles ACL/policies untouched and only recreated
-- get_user_conta_id() + the legacy clientes pair. It passed, but for reasons
-- unrelated to migration 20260729000002 -- local's baseline for `profiles`
-- grants `authenticated` no SELECT at all (confirmed via
-- information_schema.role_table_grants/column_privileges: only TRUNCATE,
-- REFERENCES, TRIGGER -- no arwd), so the exploit UPDATE failed with
-- "permission denied for table profiles" regardless of whether the migration's
-- own GRANT UPDATE(conta_id) revoke was present, reverted, or missing
-- entirely -- verified empirically identical in both the correct and a
-- deliberately-reintroduced-vulnerability state. A second, independent masking
-- layer sits underneath that one: local's `profiles_select_same_workspace`
-- SELECT policy (`conta_id = get_my_conta_id()`, no `id = auth.uid()` escape
-- hatch) blocks a self-row conta_id rewrite via an incidental RLS WITH CHECK
-- violation that has nothing to do with the column privilege under test --
-- production's real, current SELECT policy ("Users can view own workspace
-- profiles") has the escape hatch and would not mask it the same way. Explicitly
-- reproducing production's starting ACL/policies here, then applying the real
-- migration file on top, removes both false backstops.
begin;
select et_grant_hosted_parity(ARRAY['profiles', 'clientes']);

create or replace function public.get_user_conta_id() returns uuid
  language sql security definer set search_path to ''
  as $fn$ select conta_id from public.profiles where id = auth.uid(); $fn$;

-- Production's PRE-FIX profiles: GRANT ALL, UPDATE policy with no WITH CHECK,
-- SELECT policy WITH the id=auth.uid() escape hatch.
grant all on table public.profiles to authenticated;
drop policy if exists profiles_select_same_workspace on public.profiles;
drop policy if exists profiles_update_own            on public.profiles;
drop policy if exists profiles_insert_self           on public.profiles;
drop policy if exists profiles_no_delete             on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "Users can view own workspace profiles" on public.profiles
  for select using ((id = auth.uid()) or (conta_id = public.get_my_conta_id()));

-- Production's legacy clientes pair (permissive FOR ALL, no membership check).
grant all on table public.clientes to authenticated;
drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_insert on public.clientes;
drop policy if exists clientes_update on public.clientes;
drop policy if exists clientes_delete on public.clientes;
create policy "Users can CRUD own clientes" on public.clientes
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Usuários podem gerenciar clientes da sua conta" on public.clientes
  using ((auth.uid() = user_id) or (conta_id = public.get_user_conta_id()))
  with check ((auth.uid() = user_id) or (conta_id = public.get_user_conta_id()));

-- Now apply the ACTUAL shipped migration on top of that reproduced pre-fix
-- state. If it does its job, the GRANT ALL above is narrowed to the 6 safe
-- columns and the UPDATE policy gains a real WITH CHECK.
\i supabase/migrations/20260729000002_profiles_write_lockdown.sql

do $$
declare
  v_attacker_ws uuid;
  v_victim_ws   uuid;
  v_attacker    uuid := gen_random_uuid();
  v_victim      uuid := gen_random_uuid();
  v_before      int;
  v_after       int;
  v_switched    boolean := false;
begin
  v_attacker_ws := et_make_workspace('max');
  v_victim_ws   := et_make_workspace('max');

  insert into auth.users (id) values (v_attacker), (v_victim);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_attacker, v_attacker_ws, 'owner'), (v_victim, v_victim_ws, 'owner');
  update profiles set conta_id = v_attacker_ws, active_workspace_id = v_attacker_ws
   where id = v_attacker;
  update profiles set conta_id = v_victim_ws, active_workspace_id = v_victim_ws
   where id = v_victim;

  insert into clientes (nome, sigla, cor, conta_id, user_id, valor_mensal)
    values ('VICTIM CONFIDENTIAL', 'VC', '#000000', v_victim_ws, v_victim, 99999);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);

  select count(*) into v_before from clientes where conta_id = v_victim_ws;

  begin
    update profiles set conta_id = v_victim_ws where id = v_attacker;
    v_switched := true;
  exception when others then
    v_switched := false;
  end;

  select count(*) into v_after from clientes where conta_id = v_victim_ws;
  reset role;

  if v_before <> 0 then
    raise exception 'test setup is wrong: attacker could already see % victim row(s) '
                     'before attempting the exploit', v_before;
  end if;
  if v_switched then
    raise exception 'Finding 1 REGRESSION: attacker''s UPDATE profiles SET conta_id '
                     '= <victim workspace> succeeded — the write lockdown is not in effect';
  end if;
  if v_after <> 0 then
    raise exception 'Finding 1 REGRESSION: attacker can see % victim workspace row(s) '
                     'despite the conta_id write being refused — a different path is '
                     'leaking cross-tenant access', v_after;
  end if;

  raise notice '57_finding1_repro_closed: attacker cannot poison conta_id and gains '
               'zero cross-tenant rows';
end $$;
rollback;
