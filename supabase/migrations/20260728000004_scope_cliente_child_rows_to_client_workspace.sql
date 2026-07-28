-- =============================================================
-- SECURITY FIX — tie cliente_datas / cliente_enderecos rows to the SAME
-- workspace as the client they reference
--
-- 20260727000006_fix_cliente_tables_active_workspace_rls.sql scoped these
-- tables' policies to the ACTIVE workspace via `conta_id`, but only the
-- CHILD row's own conta_id. Nothing ties `cliente_id` to that same workspace,
-- so an authenticated member of workspace A can INSERT (or UPDATE) a
-- cliente_datas / cliente_enderecos row with conta_id = A but cliente_id
-- pointing at a client that belongs to workspace B. That row passes both
-- existing conjuncts (A is a workspace the caller belongs to, and A is the
-- caller's active workspace) because neither one ever looks at what
-- cliente_id actually points to.
--
-- This is NOT a read leak — clientes_select and the read policies on these
-- two tables still scope by conta_id, so nobody can use this to see B's data.
-- What it gives an attacker:
--   * relationship corruption — a workspace-A row permanently mispointing at
--     a workspace-B client;
--   * a weak existence oracle — the insert only succeeds if a `clientes` row
--     with that id exists at all (cross-tenant id enumeration by trial and
--     error);
--   * collateral damage — if workspace B ever deletes that client, the
--     ON DELETE CASCADE (clientes -> cliente_datas/cliente_enderecos) takes
--     workspace A's row down with it, deleting data A never agreed to link.
--
-- Fix: require, in WITH CHECK, that a client row exists whose id AND conta_id
-- both match the child row's own cliente_id / conta_id — i.e. cliente_id must
-- belong to the very workspace the child row claims to be in.
--
-- Scope: this migration replaces ONLY the INSERT and UPDATE policies (their
-- WITH CHECK, specifically) on both tables. SELECT and DELETE are untouched —
-- there is no analogous "which row does this point at" decision to make on a
-- read or a delete, and 20260727000006 already governs which existing rows
-- are visible/deletable via conta_id. UPDATE's USING clause (which rows may
-- be targeted) is also left exactly as 20260727000006 defined it; only its
-- WITH CHECK (what the row may become) gains the new conjunct, matching where
-- an UPDATE could otherwise re-point cliente_id at a foreign client.
--
-- The original predicate from 20260727000006 is preserved VERBATIM below and
-- extended, not rewritten — do not re-derive it from scratch here.
--
-- Column qualification note: the EXISTS subquery below writes
-- `c.conta_id = <table>.conta_id` with the table name spelled out, rather
-- than a bare `conta_id`. `clientes` itself has a `conta_id` column, so an
-- unqualified `conta_id` on the right-hand side would resolve to the
-- subquery's OWN `clientes c` scope (Postgres searches the innermost FROM
-- list first) instead of to the row being inserted/updated — silently
-- collapsing the comparison to `c.conta_id = c.conta_id`, which is always
-- true. Under the current clientes_select policy that tautology happens to
-- still be caught (RLS on `clientes` itself hides rows outside the caller's
-- active workspace, and the preserved conjunct below already forces the
-- child row's own conta_id to equal the active workspace), but that is
-- incidental to a policy this migration does not own. Qualifying explicitly
-- makes the check correct on its own terms, not by accident of another
-- table's policy.
-- =============================================================

DO $$
DECLARE
  t text;
  suffix text;
  -- Verbatim from 20260727000006 — do not touch.
  predicate constant text :=
    'conta_id IN (SELECT workspace_id FROM public.workspace_members '
    '             WHERE user_id = auth.uid()) '
    'AND conta_id IN (SELECT public.get_my_conta_id())';
  check_predicate text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cliente_datas', 'cliente_enderecos'] LOOP
    suffix := replace(t, 'cliente_', '');
    check_predicate := predicate || format(
      ' AND EXISTS (SELECT 1 FROM public.clientes c '
      '             WHERE c.id = %I.cliente_id AND c.conta_id = %I.conta_id)',
      t, t
    );

    -- INSERT: WITH CHECK gains the anti-corruption conjunct.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'workspace_insert_' || suffix, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)',
                   'workspace_insert_' || suffix, t, check_predicate);

    -- UPDATE: USING stays the original predicate (unchanged — governs which
    -- existing rows may be targeted); WITH CHECK gains the conjunct (governs
    -- what the row may become, including re-pointing cliente_id).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'workspace_update_' || suffix, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (%s) WITH CHECK (%s)',
                   'workspace_update_' || suffix, t, predicate, check_predicate);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Post-condition 1: the INSERT and UPDATE policies on both tables now
-- reference BOTH get_my_conta_id (the preserved conjunct) AND public.clientes
-- (the new anti-corruption conjunct) in their WITH CHECK expression. Losing
-- either substring is exactly the regression this migration exists to
-- prevent.
-- -------------------------------------------------------------
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(x.tbl || '.' || x.pol, ', ') INTO bad
  FROM (
    SELECT v.tbl, v.pol
    FROM (VALUES
      ('cliente_datas','workspace_insert_datas'),
      ('cliente_datas','workspace_update_datas'),
      ('cliente_enderecos','workspace_insert_enderecos'),
      ('cliente_enderecos','workspace_update_enderecos')
    ) AS v(tbl, pol)
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public'
     AND p.tablename  = v.tbl
     AND p.policyname = v.pol
    WHERE p.policyname IS NULL
       OR COALESCE(p.with_check, '') NOT LIKE '%get_my_conta_id%'
       -- Postgres stores/displays catalog expressions with same-search_path
       -- schema qualifiers stripped (get_my_conta_id and workspace_members
       -- above are proof: written as public.* in the migration, shown bare
       -- in pg_policies), so match unqualified `clientes`, not `public.clientes`.
       OR COALESCE(p.with_check, '') NOT LIKE '%clientes%'
  ) x;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Policy missing tenant/client-ownership check in WITH CHECK: %', bad;
  END IF;
END $$;

-- -------------------------------------------------------------
-- Post-condition 2: SELECT and DELETE are untouched — still present, still
-- scoped via get_my_conta_id, and NOT carrying the new clientes conjunct
-- (proof this migration did not accidentally rewrite them too).
-- -------------------------------------------------------------
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(x.tbl || '.' || x.pol, ', ') INTO bad
  FROM (
    SELECT v.tbl, v.pol
    FROM (VALUES
      ('cliente_datas','workspace_read_datas'),
      ('cliente_datas','workspace_delete_datas'),
      ('cliente_enderecos','workspace_read_enderecos'),
      ('cliente_enderecos','workspace_delete_enderecos')
    ) AS v(tbl, pol)
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public'
     AND p.tablename  = v.tbl
     AND p.policyname = v.pol
    WHERE p.policyname IS NULL
       OR COALESCE(p.qual, '') NOT LIKE '%get_my_conta_id%'
       OR COALESCE(p.qual, '') LIKE '%clientes%'
  ) x;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'SELECT/DELETE policy unexpectedly changed by this migration: %', bad;
  END IF;
END $$;
