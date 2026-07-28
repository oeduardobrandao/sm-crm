\set ON_ERROR_STOP on
-- =============================================================
-- Rollback for Migration B ONLY
-- (supabase/migrations/20260728000002_financial_visibility_b_enforcement.sql)
--
-- Safe to run while the step-2 client bundle is still deployed -- that bundle
-- reads public.membros_v / public.clientes_v (added by Migration A), and this
-- script does NOT touch them.
--
-- Explicitly NOT touched (Migration A / the RPC migration, not Migration B):
--   - public.membros_v / public.clientes_v
--   - public.can_see_financials()
--   - public.set_financial_access(uuid, uuid, uuid, boolean)
--   - workspace_members.can_see_financials column
-- Dropping any of those here would break the step-2 bundle this rollback
-- exists to stabilise, trading one outage for a worse one. They are harmless
-- once the table grants below are restored: the views' CASE keeps evaluating
-- can_see_financials(), it just stops being the only way to reach the raw
-- column, since direct table access is unmasked again too. A full teardown
-- (views, helper functions, the column) is scripts/teardown-financial-visibility.sql,
-- and is only safe paired with a frontend rollback to a pre-view bundle.
--
-- ORDER MATTERS.
--   1. Triggers first, then their function. The triggers survive a grant/
--      policy restore on their own; left in place, the OLD (pre-step-2)
--      bundle's payloads -- 0 / null for financial fields it can't see --
--      would keep tripping guard_financial_write()'s "value changed" check
--      and rejecting ordinary client/member edits for restricted admins. A
--      rollback that leaves the app broken in a NEW way is not a rollback.
--      This ordering is also not optional mechanically: DROP FUNCTION on a
--      function still wired to a trigger fails outright without CASCADE.
--   2. Policies on transacoes/contratos, restored to their exact pre-B text.
--   3. Grants, restored last.
--
-- The restored SELECT predicate was copied verbatim, not reconstructed from
-- memory -- see the policy block below for exactly which lines of which
-- migration each policy comes from.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Write guards (added by Migration B).
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_guard_membros_custo  ON public.membros;
DROP TRIGGER IF EXISTS trg_guard_clientes_valor ON public.clientes;
DROP FUNCTION IF EXISTS public.guard_financial_write();

-- -------------------------------------------------------------
-- 2. Restore the pre-B policies on transacoes/contratos verbatim.
--
-- SELECT: supabase/migrations/20260404_agent_rls_restriction.sql, the
-- transacoes_select (lines 24-29) and contratos_select (lines 32-37) bodies --
-- tenant check AND get_my_role() IS DISTINCT FROM 'agent'. 20260404 is the
-- last migration to touch these SELECT policies before Migration B (grepped
-- across supabase/migrations/ -- no migration between 20260404 and B touches
-- them), so this is the exact pre-B text, not an approximation.
--
-- INSERT/UPDATE/DELETE: supabase/migrations/20260315_rls_security_audit.sql,
-- lines 100-118 (transacoes) / 132-150 (contratos) -- tenant check only.
-- 20260404 only ever replaced the three *_select policies (see its own
-- comment header), so 20260315 remains the last word on these three.
-- -------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transacoes', 'contratos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND public.get_my_role() IS DISTINCT FROM 'agent'
      )$f$, t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (
        conta_id IN (SELECT public.get_my_conta_id())
      )$f$, t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE USING (
        conta_id IN (SELECT public.get_my_conta_id())
      ) WITH CHECK (
        conta_id IN (SELECT public.get_my_conta_id())
      )$f$, t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE USING (
        conta_id IN (SELECT public.get_my_conta_id())
      )$f$, t || '_delete', t);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- 3. Grants. The true inverse of Migration B's grant change, not just a
-- superset add: revoke the exact column-level grants Migration B created
-- (listed there verbatim), THEN restore the table-level grant they replaced.
-- Skipping the revoke would still leave authenticated able to read every
-- column (a table grant is a superset of any column grant), but it would
-- also leave a stale, misleading column-level ACL behind that no longer
-- means anything -- the whole point of this step is to put the grants back
-- exactly as 20260315/20260404-era code found them.
-- -------------------------------------------------------------
REVOKE SELECT (
  id, user_id, conta_id, nome, cargo, tipo, avatar_url, data_pagamento,
  created_at, crm_user_id
) ON public.membros FROM authenticated;

REVOKE SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis
) ON public.clientes FROM authenticated;

GRANT SELECT ON public.membros  TO authenticated;
GRANT SELECT ON public.clientes TO authenticated;

-- -------------------------------------------------------------
-- Post-conditions. Mirrors the shape of Migration B's own post-condition
-- block so a failure here reads the same way a failed migration would.
-- -------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname IN ('trg_guard_membros_custo', 'trg_guard_clientes_valor')
  ) THEN
    RAISE EXCEPTION 'a guard trigger survived rollback';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'guard_financial_write'
  ) THEN
    RAISE EXCEPTION 'guard_financial_write() survived rollback';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='membros'
      AND grantee='authenticated' AND privilege_type='SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated missing table-level SELECT on membros';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='clientes'
      AND grantee='authenticated' AND privilege_type='SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated missing table-level SELECT on clientes';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('transacoes','contratos');
  IF n <> 8 THEN
    RAISE EXCEPTION 'expected 8 policies on transacoes/contratos, found %', n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('transacoes','contratos')
      AND coalesce(qual, with_check) LIKE '%can_see_financials%'
  ) THEN
    RAISE EXCEPTION 'a policy still references can_see_financials() after rollback';
  END IF;

  -- membros_v / clientes_v are deliberately NOT asserted here -- this script
  -- must not drop them, and it has no other claim to make about them.
END $$;

COMMIT;
