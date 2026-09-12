\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Regression for 20260912000001. 20260505000002 tried to convert
-- profiles.role from text to the user_role enum, but the ALTER was wrapped in
-- `EXCEPTION WHEN others THEN NULL` -- it always failed (the column's own
-- `DEFAULT 'owner'::text` blocks the automatic cast) and the failure was
-- swallowed. profiles.role stayed `text` in every environment while
-- handle_new_user_workspace() and others already compared it as the enum
-- (`p.role = 'owner'::user_role`), which raises `operator does not exist:
-- text = user_role` against a real text column.

-- =============================================================
-- 1. profiles.role is actually the user_role enum, not text. This is the
--    exact fact the swallowed exception hid: asserting the live column type
--    is what would have caught the original migration silently no-op'ing.
-- =============================================================
do $$
declare
  v_type text;
begin
  select atttypid::regtype::text into v_type
  from pg_attribute
  where attrelid = 'public.profiles'::regclass
    and attname = 'role'
    and not attisdropped;

  if v_type is distinct from 'user_role' then
    raise exception 'profiles.role is %, expected user_role (20260505000002''s ALTER silently failed)', v_type;
  end if;

  raise notice '72: profiles.role is user_role';
end $$;

-- =============================================================
-- 2. A realistic signup path that compares profiles.role against a typed
--    ::user_role literal must not raise a type error. This is
--    handle_new_user_workspace()'s ws_exists branch: an invited user accepts
--    an invite for a conta whose workspace row doesn't exist yet, and the
--    trigger looks up an existing owner via
--    `p.role = 'owner'::user_role` with no exception handler around it.
--    Before the fix this aborted the whole signup with
--    "operator does not exist: text = user_role".
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_conta   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();
  v_invited uuid := gen_random_uuid();
  v_created_by uuid;
  v_role       public.user_role;
begin
  insert into contas (id, nome, slug) values (v_conta, 'Conta ET72', 'conta-et72');

  insert into auth.users (id, email) values (v_owner, 'et72-owner@example.com');
  update profiles set conta_id = v_conta, role = 'owner' where id = v_owner;

  insert into invites (conta_id, email, role, invited_by, status, expires_at)
    values (v_conta, 'et72-invited@example.com', 'agent', v_owner, 'pending', now() + interval '7 days');

  -- Fires handle_new_user_workspace(). workspaces has no row for v_conta yet,
  -- so this exercises the ws_exists = false branch and its
  -- `p.role = 'owner'::user_role` lookup.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_invited, 'et72-invited@example.com', jsonb_build_object('conta_id', v_conta));

  select conta_id, role into v_conta, v_role from profiles where id = v_invited;
  if v_role is distinct from 'agent'::public.user_role then
    raise exception 'invited profile has role %, expected agent', v_role;
  end if;

  select created_by into v_created_by from workspaces where id = v_conta;
  if v_created_by is distinct from v_owner then
    raise exception 'workspace created_by resolved to %, expected the existing owner %', v_created_by, v_owner;
  end if;

  raise notice '72: invited-user signup onto a not-yet-created workspace does not raise a type error';
end $$;
rollback;
