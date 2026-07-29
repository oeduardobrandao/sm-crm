-- =============================================================
-- Per-admin financial visibility — Migration B (BREAKING)
--
-- Requires the step-2 client bundle to be deployed first: it revokes the
-- table-level SELECT that the previous bundle's select('*') calls depend on.
-- Blast radius is app-wide, not financial-only — getClientes()/getMembros()
-- feed dashboard, deliveries, analytics and search.
--
-- -------------------------------------------------------------
-- SCHEMA-DRIFT NOTE — why the legacy sweep below exists.
--
-- The first attempt to apply this migration to production (2026-07-28) aborted
-- in its own post-condition: it asserted 8 policies on transacoes/contratos and
-- found 6. The transaction rolled back cleanly and production was unaffected.
--
-- Diagnosis, from a fresh production schema dump: production has never actually
-- run `20260315_rls_security_audit.sql`, even though that version IS recorded
-- in schema_migrations. The evidence is conclusive — three tables still carry
-- policies that 20260315 explicitly DROPs (`tags_conta` on instagram_post_tags,
-- `reports_conta` on analytics_reports, the old `profiles` triple), and
-- workflows_select in production reads `SELECT profiles.conta_id FROM profiles`
-- rather than 20260315's `get_my_conta_id()`. The version row was backfilled
-- without the SQL ever executing.
--
-- So production's transacoes/contratos are governed by FOUR hand-created
-- policies that exist in no migration:
--
--   "Users can CRUD own transacoes"                   USING (auth.uid() = user_id)
--   "Users can CRUD own contratos"                    USING (auth.uid() = user_id)
--   "Usuários podem gerenciar transações da sua conta" USING (auth.uid() = user_id
--                                        OR conta_id = get_user_conta_id())
--   "Usuários podem gerenciar contratos da sua conta"  (same shape)
--
-- All four are FOR ALL and PERMISSIVE. Permissive policies are OR'd together,
-- so leaving them in place would have let a restricted admin read and write
-- every financial row this migration is meant to hide — the capability check
-- would have been live, correct, and completely bypassed. The feature would
-- have looked deployed while enforcing nothing.
--
-- The post-condition caught this. That is the whole reason it is written as an
-- exact count rather than a smoke test.
--
-- WHY THIS EDITS AN ALREADY-COMMITTED MIGRATION RATHER THAN ADDING A LATER ONE.
--
-- Normally you do not edit a migration that is on main. Here a follow-up
-- migration cannot work, because `supabase db push` applies in version order and
-- stops at the first failure: anything numbered after this file is never reached
-- on production, since THIS file is what aborts. Production is also the only
-- environment that needs the sweep, and it has not applied this version —
-- `migration list --linked` shows 20260728000002 with no remote entry, because
-- the failed attempt rolled back cleanly.
--
-- The environments that will skip the revised version are staging and local dev,
-- both of which applied the original. In both the new logic is a verified no-op:
-- the original post-condition asserted exactly 8 policies on transacoes/contratos
-- and PASSED there, which is itself proof that no unowned policy existed — 9 would
-- have aborted it. The sweep has nothing to remove in either.
--
-- DELIBERATELY NOT FIXED HERE: clientes and membros carry the same legacy pair.
-- They do not defeat this migration — protection there is column-level SELECT
-- privilege plus the write trigger, and both are evaluated independently of
-- RLS. Dropping them would leave those tables with no policy at all and lock
-- the app out; replacing them correctly means porting the rest of 20260315,
-- which is a separate change with its own blast radius. Tracked separately.
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
-- All four commands are rewritten in full. SELECT-only RLS would leave INSERT
-- open, letting a restricted admin post entries they cannot read.
--
-- Starting state differs per environment, which is why every statement below is
-- unconditional rather than conditional on what it finds:
--   production — only transacoes_select / contratos_select exist (created by
--                20260404); there are no _insert/_update/_delete policies at
--                all, because 20260315 never ran. Writes were governed solely
--                by the legacy FOR ALL policies swept above.
--   migrations-built (local, staging) — all eight exist, from 20260315 with
--                SELECT later replaced by 20260404.
--
-- (SELECT public.can_see_financials()) is wrapped so it hoists to an InitPlan
-- instead of being evaluated per row.
-- -------------------------------------------------------------

-- Sweep any PERMISSIVE policy on these two tables that this migration does not
-- own.
--
-- Deliberately name-independent. Dropping by literal name would depend on
-- transcribing accented identifiers ("Usuários podem gerenciar transações da
-- sua conta") byte-exactly, and would silently miss any further hand-created
-- policy that drift has left behind. Since the post-condition asserts this
-- migration owns the complete policy set on both tables, anything else present
-- would abort the migration anyway — dropping it, loudly and with a name in the
-- log, is strictly better than failing on it.
--
-- RESTRICTIVE POLICIES ARE EXCLUDED, and that exclusion is load-bearing. The
-- justification for sweeping is that permissive policies are OR'd, so an unowned
-- one can grant access the capability check is meant to deny. Restrictive
-- policies are ANDed: they can only ever narrow access, never widen it, so they
-- cannot defeat can_see_financials() and the rationale above does not apply to
-- them. Dropping one would do the opposite of this migration's purpose — it
-- would silently GRANT access that something else deliberately denied, and the
-- post-condition would then pass, because the evidence had just been removed.
--
-- An unowned restrictive policy therefore aborts the migration instead, via the
-- exact-name-set post-condition. That is the correct outcome: nobody should
-- discover an emergency lockdown by having it deleted.
DO $$
DECLARE
  p record;
  n int := 0;
BEGIN
  FOR p IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('transacoes', 'contratos')
       AND permissive = 'PERMISSIVE'
       AND policyname NOT IN (
             'transacoes_select', 'transacoes_insert',
             'transacoes_update', 'transacoes_delete',
             'contratos_select',  'contratos_insert',
             'contratos_update',  'contratos_delete')
     ORDER BY tablename, policyname
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    RAISE NOTICE 'dropped unowned policy %.% — permissive policies are OR''d, '
                 'so it would have defeated the capability check',
                 p.tablename, p.policyname;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'legacy policy sweep on transacoes/contratos: % dropped', n;
END $$;

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
  n     int;
  stray text;
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

  -- Name set BEFORE count, deliberately. Both catch an unowned policy, but this
  -- one names it and reports whether it is PERMISSIVE or RESTRICTIVE, where the
  -- count says only "found 9". The restrictive case is exactly the one where an
  -- operator most needs to know what they are looking at.
  SELECT string_agg(format('%s.%s (%s)', tablename, policyname, permissive),
                    ', ' ORDER BY policyname) INTO stray
    FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('transacoes','contratos')
     AND policyname NOT IN (
           'transacoes_select', 'transacoes_insert',
           'transacoes_update', 'transacoes_delete',
           'contratos_select',  'contratos_insert',
           'contratos_update',  'contratos_delete');
  IF stray IS NOT NULL THEN
    -- A RESTRICTIVE entry here is the expected, deliberate abort: the sweep
    -- leaves those alone rather than silently widening access (see its comment).
    -- Decide what it is and why it exists before re-running; do not just drop it.
    RAISE EXCEPTION 'unowned policy survives on transacoes/contratos: %', stray;
  END IF;

  -- The name set alone cannot catch a MISSING policy — drop one of ours and
  -- nothing is "unowned". The count is what closes that half; together they
  -- mean this migration provably owns the whole policy set.
  IF n <> 8 THEN
    RAISE EXCEPTION 'expected 8 policies on transacoes/contratos, found %', n;
  END IF;

  -- Every one must still carry the tenant conjunct. A policy that lost it would
  -- turn a capability check into a tenant-wide exposure.
  --
  -- Checked on qual and with_check SEPARATELY, not via coalesce(). An UPDATE
  -- policy has both; coalesce() reads only qual, so a WITH CHECK that lost the
  -- tenant conjunct — the cross-tenant WRITE hole — would pass unnoticed.
  SELECT string_agg(format('%s.%s', tablename, policyname), ', ' ORDER BY policyname)
    INTO stray
    FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('transacoes','contratos')
     AND (   (qual       IS NOT NULL AND qual       NOT LIKE '%get_my_conta_id%')
          OR (with_check IS NOT NULL AND with_check NOT LIKE '%get_my_conta_id%'));
  IF stray IS NOT NULL THEN
    RAISE EXCEPTION 'policy lost its get_my_conta_id tenant conjunct: %', stray;
  END IF;

  -- ...and the capability conjunct, which is the entire point of the migration
  -- and was previously asserted nowhere. Without this, a policy silently
  -- reverting to a plain tenant check would leave the feature inert and the
  -- migration green.
  SELECT string_agg(format('%s.%s', tablename, policyname), ', ' ORDER BY policyname)
    INTO stray
    FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('transacoes','contratos')
     AND (   (qual       IS NOT NULL AND qual       NOT LIKE '%can_see_financials%')
          OR (with_check IS NOT NULL AND with_check NOT LIKE '%can_see_financials%'));
  IF stray IS NOT NULL THEN
    RAISE EXCEPTION 'policy lost its can_see_financials capability conjunct: %', stray;
  END IF;
END $$;
