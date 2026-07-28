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
-- pg_temp is named LAST and the relation this function reads directly
-- (workspace_members) is schema-qualified, so THIS function's own lookups
-- cannot be redirected by a session-local CREATE TEMP TABLE
-- workspace_members(...).
--
-- That hardening does not extend end-to-end. Workspace resolution is
-- delegated to public.get_my_conta_id(), whose live definition
-- (20260720000004_reconcile_prod_missing_functions.sql:25-41) is SECURITY
-- DEFINER with a bare `SET search_path = public` and unqualified `profiles` /
-- `workspace_members` references. With pg_temp absent from ITS path, a caller
-- running CREATE TEMP TABLE profiles(...) (or workspace_members(...)) still
-- controls which workspace get_my_conta_id() resolves to, one call below this
-- one. Hardening that shared function is out of scope here.
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
    ELSE false -- covers role='agent'; any other value is blocked at the source by workspace_members.role's CHECK (role IN ('owner','admin','agent')), so that path is unreachable and this suite cannot cover it
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
-- Masking views.
--
-- security_invoker is IMPOSSIBLE here: an invoker view evaluates the CASE with
-- the caller's privileges, so the caller would need SELECT on the very column
-- Migration B revokes. The view owner therefore bypasses base-table RLS, which
-- makes the explicit WHERE the ONLY tenant isolation on this path — it must
-- never be removed in favour of "RLS handles it".
--
-- Columns are enumerated, never SELECT *: a new base-table column would
-- otherwise appear here ungranted and unreviewed.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.membros_v WITH (security_barrier = true) AS
  SELECT m.id, m.user_id, m.conta_id, m.nome, m.cargo, m.tipo,
         m.avatar_url, m.data_pagamento, m.created_at, m.crm_user_id,
         CASE WHEN public.can_see_financials()
              THEN m.custo_mensal ELSE NULL END AS custo_mensal
  FROM public.membros m
  WHERE m.conta_id = public.get_my_conta_id();

CREATE OR REPLACE VIEW public.clientes_v WITH (security_barrier = true) AS
  SELECT c.id, c.user_id, c.conta_id, c.nome, c.sigla, c.cor, c.plano,
         c.email, c.telefone, c.status, c.created_at, c.notion_page_url,
         c.data_pagamento, c.especialidade, c.data_aniversario, c.dia_entrega,
         c.auto_publish_on_approval, c.send_report_email, c.include_ai_analysis,
         CASE WHEN public.can_see_financials()
              THEN c.valor_mensal ELSE NULL END AS valor_mensal
  FROM public.clientes c
  WHERE c.conta_id = public.get_my_conta_id();

-- The enumerated revoke is SECURITY-CRITICAL, not tidiness. These views are
-- auto-updatable on their simple columns, their owner bypasses base-table RLS,
-- and they carry no CHECK OPTION. Left with Supabase's default write grants to
-- `authenticated`, a caller could INSERT a row with an arbitrary conta_id, or
-- UPDATE an existing row's conta_id into another workspace — writing straight
-- past every policy this design relies on.
--
-- NOT granted to service_role, and the reason is stronger than "they would see
-- masked values": EXECUTE on a function is checked against the CURRENT USER
-- even inside a non-security_invoker view, so a service_role client selecting
-- this view hits permission denied on can_see_financials() given its REVOKE.
-- Edge functions must keep reading base tables, where their grants are
-- untouched. Do NOT "fix" this by granting EXECUTE to service_role.
REVOKE ALL ON public.membros_v  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.clientes_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.membros_v  TO authenticated;
GRANT SELECT ON public.clientes_v TO authenticated;

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
  -- A PUBLIC grant renders as a grantee-less aclitem (`=X/postgres`), not
  -- `anon=X` — textually distinct from the check above. array_to_string(...,
  -- ',') puts it either first in the string (no leading comma: `=X%`) or
  -- after another entry (preceded by a comma: `%,=X%`); check both.
  IF acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
    RAISE EXCEPTION 'can_see_financials(): PUBLIC retains EXECUTE — acl=%', acl;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public'
      AND tablename='workspace_members'
  ) THEN
    RAISE EXCEPTION 'workspace_members not in supabase_realtime publication';
  END IF;
END $$;

DO $$
DECLARE
  v      text;
  acl    text;
BEGIN
  FOREACH v IN ARRAY ARRAY['membros_v', 'clientes_v'] LOOP
    SELECT array_to_string(c.relacl, ',') INTO acl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname=v;

    IF acl IS NULL OR acl NOT LIKE '%authenticated=r/%' THEN
      RAISE EXCEPTION '%: authenticated lacks SELECT — acl=%', v, acl;
    END IF;
    -- 'a' = INSERT, 'w' = UPDATE, 'd' = DELETE. Any of them on authenticated is
    -- the auto-updatable-view escape path this design exists to close.
    IF acl ~ ('authenticated=[rwad]*[awd]') THEN
      RAISE EXCEPTION '%: authenticated retains write privilege — acl=%', v, acl;
    END IF;
    IF acl LIKE '%anon=%' THEN
      RAISE EXCEPTION '%: anon retains privilege — acl=%', v, acl;
    END IF;
    -- "Nothing may be granted to service_role" is a binding constraint, not an
    -- oversight (see the comment above the REVOKE), so it gets the same
    -- post-condition weight as authenticated/anon.
    IF acl LIKE '%service_role=%' THEN
      RAISE EXCEPTION '%: service_role retains privilege — acl=%', v, acl;
    END IF;
    -- A PUBLIC grant renders as a grantee-less aclitem (`=X/postgres`), not
    -- `anon=X` — textually distinct from the checks above, same as the
    -- function-ACL block a few lines up. Check both string positions.
    IF acl LIKE '=%' OR acl LIKE '%,=%' THEN
      RAISE EXCEPTION '%: PUBLIC retains privilege — acl=%', v, acl;
    END IF;
  END LOOP;
END $$;
