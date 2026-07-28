-- =============================================================
-- Per-admin financial visibility — Migration A (ADDITIVE, inert)
-- See docs/superpowers/specs/2026-07-27-admin-financeiro-visibility-design.md
--
-- Nothing here changes behaviour for a deployed client: no base-table privilege
-- is revoked and no existing policy is touched. The only revokes are FROM PUBLIC
-- and named roles on objects this migration itself creates.
-- =============================================================

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS can_see_financials boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspace_members.can_see_financials IS
  'Meaningful for role=admin only. Owners always see financials; agents never do. '
  'Default true so existing admins are unaffected on deploy.';

-- -------------------------------------------------------------
-- The predicate.
--
-- Reads workspace_members, NOT profiles: profiles.role goes stale on workspace
-- switch (no switch path writes it), which would make an owner in workspace A
-- read as owner in workspace B where they are an agent.
--
-- pg_temp is named LAST and every relation is schema-qualified. Without both, a
-- caller able to run CREATE TEMP TABLE workspace_members(...) could shadow the
-- real table and dictate this function's answer — PostgreSQL searches the
-- session temp schema FIRST for relation names when pg_temp is absent from the
-- path.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_financials()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE wm.role
    WHEN 'owner' THEN true
    WHEN 'admin' THEN wm.can_see_financials
    ELSE false
  END
  FROM public.workspace_members AS wm
  WHERE wm.user_id = auth.uid()
    AND wm.workspace_id = public.get_my_conta_id();
$$;

-- Supabase's default privileges grant new objects in `public` directly to anon,
-- authenticated and service_role. REVOKE FROM PUBLIC alone leaves those intact,
-- so the named roles must be enumerated.
REVOKE ALL ON FUNCTION public.can_see_financials()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_financials() TO authenticated;

-- -------------------------------------------------------------
-- Realtime: the revocation subscription in AuthContext silently never fires
-- unless workspace_members is in the publication. No migration adds it today.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'workspace_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_members;
    RAISE NOTICE 'added workspace_members to supabase_realtime';
  ELSE
    RAISE NOTICE 'workspace_members already in supabase_realtime';
  END IF;
END $$;

-- -------------------------------------------------------------
-- Post-conditions
-- -------------------------------------------------------------
DO $$
DECLARE
  acl text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='workspace_members'
      AND column_name='can_see_financials'
      AND is_nullable='NO' AND column_default='true'
  ) THEN
    RAISE EXCEPTION 'can_see_financials column missing or wrong shape';
  END IF;

  SELECT array_to_string(p.proacl, ',') INTO acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='can_see_financials';

  IF acl IS NULL OR acl NOT LIKE '%authenticated=X%' THEN
    RAISE EXCEPTION 'can_see_financials(): authenticated lacks EXECUTE — acl=%', acl;
  END IF;
  IF acl LIKE '%anon=X%' THEN
    RAISE EXCEPTION 'can_see_financials(): anon retains EXECUTE — acl=%', acl;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public'
      AND tablename='workspace_members'
  ) THEN
    RAISE EXCEPTION 'workspace_members not in supabase_realtime publication';
  END IF;
END $$;
