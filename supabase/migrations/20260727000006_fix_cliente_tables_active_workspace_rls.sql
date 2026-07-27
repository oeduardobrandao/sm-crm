-- =============================================================
-- SECURITY FIX — scope cliente_enderecos / cliente_datas to the ACTIVE workspace
--
-- Migration 20260727000001 adopted production's policies verbatim. Those
-- policies scope by *any* workspace the caller belongs to:
--
--   conta_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
--
-- Every other tenant table in this schema scopes to the ACTIVE workspace via
-- get_my_conta_id() (e.g. clientes_select, 20260315_rls_security_audit.sql).
-- The mismatch is exploitable because the client code adds no tenant filter of
-- its own:
--
--   * getClienteEnderecos / getClienteDatas (store/clients.ts) filter only by
--     cliente_id, and ClienteDetalhePage fires both off the :id route param
--     regardless of whether the parent clientes row loaded. clientes.id is a
--     globally sequential bigint, so visiting /clientes/<id-in-another-workspace>
--     renders that workspace's addresses and dates — and UPDATE/DELETE are
--     equally broad.
--
--   * getAllClienteDatas() has NO filter at all and feeds CalendarioPage, so a
--     multi-workspace user's calendar passively shows other workspaces' client
--     dates. No crafted URL required.
--
-- Adopting production as-is meant adopting this. Preserving it would ship a
-- verified cross-workspace PII read/write path into every environment that runs
-- the adoption migration, so it is corrected here instead.
--
-- The new predicate adds active-workspace scoping, which is the actual fix.
--
-- It also retains the original membership clause, but purely as belt-and-braces:
-- get_my_conta_id() has proven membership itself since
-- 20260713000001_secure_workspace_invites.sql, which redefined it to require
-- EXISTS (SELECT 1 FROM workspace_members WHERE user_id = auth.uid()
--         AND workspace_id = p.active_workspace_id),
-- and 20260720000004_reconcile_prod_missing_functions.sql re-delivered that
-- hardened body to production. No later migration redefines it.
--
-- So the conjunct is redundant, not load-bearing. It is kept because it costs
-- nothing and reads explicitly, but do NOT infer from its presence that
-- get_my_conta_id() is unsafe on its own — it is not, and an earlier version of
-- this comment wrongly said otherwise by citing the superseded 20260315
-- definition.
--
-- BEHAVIOUR CHANGE: this tightens production. No legitimate flow regresses,
-- because every other table already restricts the caller to the active
-- workspace — a user can only reach clients in the workspace they are in.
-- =============================================================

DO $$
DECLARE
  t text;
  suffix text;
  predicate constant text :=
    'conta_id IN (SELECT workspace_id FROM public.workspace_members '
    '             WHERE user_id = auth.uid()) '
    'AND conta_id IN (SELECT public.get_my_conta_id())';
BEGIN
  FOREACH t IN ARRAY ARRAY['cliente_datas', 'cliente_enderecos'] LOOP
    suffix := replace(t, 'cliente_', '');

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'workspace_read_' || suffix, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (%s)',
                   'workspace_read_' || suffix, t, predicate);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'workspace_insert_' || suffix, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)',
                   'workspace_insert_' || suffix, t, predicate);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'workspace_update_' || suffix, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (%s) WITH CHECK (%s)',
                   'workspace_update_' || suffix, t, predicate, predicate);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'workspace_delete_' || suffix, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (%s)',
                   'workspace_delete_' || suffix, t, predicate);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Post-condition: all eight policies exist and every one references
-- get_my_conta_id(). A policy that lost the active-workspace clause is exactly
-- the regression this migration exists to prevent.
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
      ('cliente_datas','workspace_insert_datas'),
      ('cliente_datas','workspace_update_datas'),
      ('cliente_datas','workspace_delete_datas'),
      ('cliente_enderecos','workspace_read_enderecos'),
      ('cliente_enderecos','workspace_insert_enderecos'),
      ('cliente_enderecos','workspace_update_enderecos'),
      ('cliente_enderecos','workspace_delete_enderecos')
    ) AS v(tbl, pol)
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public'
     AND p.tablename  = v.tbl
     AND p.policyname = v.pol
    WHERE p.policyname IS NULL
       OR COALESCE(p.qual, '') || COALESCE(p.with_check, '') NOT LIKE '%get_my_conta_id%'
  ) x;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Policy not scoped to active workspace: %', bad;
  END IF;
END $$;
