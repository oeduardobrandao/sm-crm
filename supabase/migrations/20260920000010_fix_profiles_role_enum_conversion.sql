-- 20260505000002 tried to convert profiles.role from text to the user_role
-- enum, but wrapped the ALTER in `EXCEPTION WHEN others THEN NULL`. The ALTER
-- always failed -- the column's own `DEFAULT 'owner'::text` blocks the
-- automatic cast ("default for column \"role\" cannot be cast automatically
-- to type user_role") -- and the handler silently swallowed it. So
-- profiles.role has stayed `text` (with its original CHECK constraint) in
-- every environment, despite handle_new_user_workspace() and other functions
-- already writing `role::user_role` casts and comparing `p.role =
-- 'owner'::user_role` as if the column really were the enum.
--
-- That comparison form is a live landmine: `text = user_role` has no operator,
-- so it raises `operator does not exist`. It is unexercised in
-- handle_new_user_workspace()'s `ws_exists` branch (an invited user accepting
-- an invite for a conta whose workspace row doesn't exist yet), with no
-- exception handler around it -- a real signup could hit this and crash.
--
-- Fix the root cause: actually convert the column, so it matches what the
-- rest of the codebase already assumes.
DO $$
DECLARE
  v_current_type text;
BEGIN
  SELECT atttypid::regtype::text INTO v_current_type
  FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass
    AND attname = 'role'
    AND NOT attisdropped;

  IF v_current_type = 'user_role' THEN
    RETURN;
  END IF;

  -- audit_log.owner_admin_select reads profiles.role, which blocks the ALTER
  -- ("cannot alter type of a column used in a policy definition"). Its own
  -- comparison (`role IN ('owner', 'admin')`) is an untyped literal, so it
  -- works unchanged once role becomes the enum -- just needs to be dropped
  -- and recreated around the ALTER.
  DROP POLICY IF EXISTS "owner_admin_select" ON audit_log;

  -- profiles_role_check bakes in explicit `::text` casts
  -- (role = ANY (ARRAY['owner'::text, 'admin'::text, 'agent'::text]))), which
  -- blocks the ALTER too once role is no longer text. The enum type itself
  -- enforces the same three values afterwards, so this is dropped rather than
  -- recreated.
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

  ALTER TABLE public.profiles ALTER COLUMN role DROP DEFAULT;
  ALTER TABLE public.profiles ALTER COLUMN role TYPE user_role USING role::user_role;
  ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'owner'::user_role;

  CREATE POLICY "owner_admin_select" ON audit_log
    FOR SELECT USING (
      auth.uid() IN (
        SELECT id FROM profiles
        WHERE conta_id = audit_log.conta_id
        AND role IN ('owner', 'admin')
      )
    );
END $$;
