-- =============================================================
-- FULL teardown of the financial-visibility feature:
--   20260728000001_financial_visibility_a_additive.sql   (Migration A)
--   20260728000002_financial_visibility_b_enforcement.sql (Migration B)
--   20260728000003_set_financial_access_rpc.sql            (the RPC)
--
-- Run ONLY together with a frontend rollback to a pre-view bundle -- i.e. a
-- deployed client that predates task 3 (the one that first reads
-- membros_v/clientes_v). This script DROPS those views; running it while any
-- deployed client still reads them breaks that client. If the step-2 (or
-- later) bundle is still live, use scripts/rollback-migration-b.sql instead --
-- it undoes Migration B only and deliberately leaves the views in place.
--
-- Left untouched: Migration A's other side effect, adding workspace_members
-- to the supabase_realtime publication. That fixed a pre-existing gap in
-- AuthContext's own revocation-subscription logic (see Migration A's
-- comments) -- it is not financial-visibility-specific, and reverting it
-- would silently reintroduce that unrelated bug.
-- =============================================================

-- Undo Migration B first. That script commits on its own (BEGIN/COMMIT
-- inside it) -- do NOT wrap this \i in an outer transaction, or its internal
-- COMMIT will close your transaction early and the statements below will run
-- unprotected in a second, separate transaction instead of atomically with
-- this one. Keeping the two scripts as two transactions is intentional here.
\i scripts/rollback-migration-b.sql

BEGIN;

-- -------------------------------------------------------------
-- Migration A's masking views. Dropped BEFORE the functions below: both
-- views reference can_see_financials() in their SELECT list, and Postgres
-- records that as a real dependency (unlike a plain SQL function body), so
-- DROP FUNCTION would fail without CASCADE if these still existed.
-- -------------------------------------------------------------
DROP VIEW IF EXISTS public.membros_v;
DROP VIEW IF EXISTS public.clientes_v;

-- The owner-only RPC (20260728000003_set_financial_access_rpc.sql).
DROP FUNCTION IF EXISTS public.set_financial_access(uuid, uuid, uuid, boolean);

-- Migration A's predicate function. Safe now that both views (the only
-- things that read it via a tracked dependency) are gone.
DROP FUNCTION IF EXISTS public.can_see_financials();

-- Migration A's column. Nothing left references it: the function that read
-- it is gone, and no RLS policy (pre- or post-B) ever touched it directly.
ALTER TABLE public.workspace_members DROP COLUMN IF EXISTS can_see_financials;

-- -------------------------------------------------------------
-- Post-conditions
-- -------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname IN ('membros_v', 'clientes_v')
  ) THEN
    RAISE EXCEPTION 'membros_v/clientes_v survived teardown';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN ('can_see_financials', 'set_financial_access')
  ) THEN
    RAISE EXCEPTION 'a financial-visibility helper function survived teardown';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_members'
      AND column_name = 'can_see_financials'
  ) THEN
    RAISE EXCEPTION 'workspace_members.can_see_financials survived teardown';
  END IF;
END $$;

COMMIT;
