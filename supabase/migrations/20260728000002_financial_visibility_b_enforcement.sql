-- =============================================================
-- Per-admin financial visibility — Migration B (BREAKING)
--
-- Requires the step-2 client bundle to be deployed first: it revokes the
-- table-level SELECT that the previous bundle's select('*') calls depend on.
-- Blast radius is app-wide, not financial-only — getClientes()/getMembros()
-- feed dashboard, deliveries, analytics and search.
-- =============================================================

-- -------------------------------------------------------------
-- Column-level grants.
--
-- A table-level GRANT SELECT permits EVERY column, and a column-level revoke
-- does not carve out of it. The table grant must be revoked first, then an
-- explicit allowlist re-granted. The allowlist is also what keeps
-- UPDATE … RETURNING working on the write paths.
-- -------------------------------------------------------------
REVOKE SELECT ON public.membros  FROM authenticated;
REVOKE SELECT ON public.clientes FROM authenticated;

GRANT SELECT (
  id, user_id, conta_id, nome, cargo, tipo, avatar_url, data_pagamento,
  created_at, crm_user_id
) ON public.membros TO authenticated;

GRANT SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis
) ON public.clientes TO authenticated;

-- -------------------------------------------------------------
-- Whole-row policies on transacoes / contratos.
--
-- The capability is CONJOINED with the tenant check, never substituted for it:
-- can_see_financials() does not authorize a target row's conta_id, so replacing
-- a USING expression with it alone would expose every workspace's rows.
--
-- Only SELECT carried an agent predicate (20260404); INSERT/UPDATE/DELETE
-- carried tenant checks only (20260315). Each is therefore rewritten in full —
-- SELECT-only RLS would leave INSERT open, letting a restricted admin post
-- entries they cannot read.
--
-- (SELECT public.can_see_financials()) is wrapped so it hoists to an InitPlan
-- instead of being evaluated per row.
-- -------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transacoes', 'contratos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      )$f$, t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      )$f$, t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      ) WITH CHECK (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      )$f$, t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      )$f$, t || '_delete', t);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Write guards.
--
-- auth.uid() IS NULL is NOT a proxy for service role — it also covers anonymous
-- requests. Only named trusted roles bypass.
--
-- DEVIATION FROM THE ORIGINAL DRAFT: this function must be SECURITY INVOKER,
-- NOT SECURITY DEFINER. SECURITY DEFINER changes current_user to the function
-- OWNER (postgres, since migrations run as postgres) for the entire duration of
-- the call — verified empirically against this local DB. If this trigger were
-- itself SECURITY DEFINER, `current_user IN ('postgres','supabase_admin')`
-- would be true on every single invocation regardless of who issued the write,
-- permanently disabling the guard for everyone. Kept SECURITY INVOKER,
-- current_user correctly reflects the real caller ('authenticated', 'anon',
-- etc.), UNLESS this statement is itself nested inside another SECURITY
-- DEFINER function's body (e.g. set_membro_crm_user, owned by postgres) — that
-- narrower, intentional bypass is what the note below describes.
--
-- NOTE: the current_user branch also exempts every SECURITY DEFINER function
-- owned by postgres, not just superuser sessions. Acceptable today (the only
-- such path writing these tables is set_membro_crm_user, which touches
-- crm_user_id alone). Any NEW SECURITY DEFINER path that can write a financial
-- column must call can_see_financials() itself.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_financial_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  col     text := TG_ARGV[0];
  old_val numeric;
  new_val numeric;
BEGIN
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT ($1).%I', col) INTO new_val USING NEW;
  IF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT ($1).%I', col) INTO old_val USING OLD;
  END IF;

  -- Only a CHANGE to the financial value is guarded. An INSERT carrying NULL,
  -- or an UPDATE that leaves the column alone, passes untouched — otherwise a
  -- restricted admin could not change a phone number.
  IF (TG_OP = 'INSERT' AND new_val IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND new_val IS DISTINCT FROM old_val) THEN
    IF public.can_see_financials() IS NOT TRUE THEN
      RAISE EXCEPTION 'financial_access_denied'
        USING HINT = format('column %s requires financial access', col);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_membros_custo   ON public.membros;
DROP TRIGGER IF EXISTS trg_guard_clientes_valor  ON public.clientes;

CREATE TRIGGER trg_guard_membros_custo
  BEFORE INSERT OR UPDATE ON public.membros
  FOR EACH ROW EXECUTE FUNCTION public.guard_financial_write('custo_mensal');

CREATE TRIGGER trg_guard_clientes_valor
  BEFORE INSERT OR UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.guard_financial_write('valor_mensal');

-- -------------------------------------------------------------
-- Post-conditions
-- -------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  -- authenticated must NOT hold table-wide SELECT on either table
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name IN ('membros','clientes')
      AND grantee='authenticated' AND privilege_type='SELECT'
  ) THEN
    RAISE EXCEPTION 'table-level SELECT survives on membros/clientes for authenticated';
  END IF;

  -- ...but must hold column SELECT on a representative allowlisted column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='clientes'
      AND grantee='authenticated' AND privilege_type='SELECT' AND column_name='nome'
  ) THEN
    RAISE EXCEPTION 'authenticated lost SELECT on clientes.nome';
  END IF;

  -- ...and must NOT hold it on the protected columns
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema='public' AND grantee='authenticated' AND privilege_type='SELECT'
      AND ((table_name='clientes' AND column_name='valor_mensal')
        OR (table_name='membros'  AND column_name='custo_mensal'))
  ) THEN
    RAISE EXCEPTION 'authenticated retains SELECT on a protected financial column';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('transacoes','contratos');
  IF n <> 8 THEN
    RAISE EXCEPTION 'expected 8 policies on transacoes/contratos, found %', n;
  END IF;

  -- Every one must still carry the tenant conjunct. A policy that lost it would
  -- turn a capability check into a tenant-wide exposure.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('transacoes','contratos')
      AND coalesce(qual, with_check) NOT LIKE '%get_my_conta_id%'
  ) THEN
    RAISE EXCEPTION 'a policy lost its get_my_conta_id tenant conjunct';
  END IF;
END $$;
