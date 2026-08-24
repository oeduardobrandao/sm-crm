ALTER TABLE public.clientes ADD COLUMN foto_url text;

-- Column-level grant allowlist must be re-declared in full (REVOKE was
-- already applied in 20260728000002; this extends that same explicit list).
REVOKE SELECT ON public.clientes FROM authenticated;
GRANT SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis,
  foto_url
) ON public.clientes TO authenticated;

-- DEVIATION FROM THE TASK BRIEF'S LITERAL SQL: the brief placed c.foto_url
-- BEFORE the valor_mensal CASE expression, which was the view's last column.
-- Verified empirically (scratch Postgres 14) that CREATE OR REPLACE VIEW only
-- allows a new column to be appended strictly after the previous last column
-- -- inserting one in the middle renames whatever used to sit at that
-- ordinal position and fails with "cannot change name of view column
-- valor_mensal to foto_url". foto_url is therefore appended AFTER
-- valor_mensal here instead. This is a pure column-order fix; every column
-- name, source expression and the WHERE clause are unchanged from the brief.
CREATE OR REPLACE VIEW public.clientes_v WITH (security_barrier = true) AS
  SELECT c.id, c.user_id, c.conta_id, c.nome, c.sigla, c.cor, c.plano,
         c.email, c.telefone, c.status, c.created_at, c.notion_page_url,
         c.data_pagamento, c.especialidade, c.data_aniversario, c.dia_entrega,
         c.auto_publish_on_approval, c.send_report_email, c.include_ai_analysis,
         CASE WHEN public.can_see_financials()
              THEN c.valor_mensal ELSE NULL END AS valor_mensal,
         c.foto_url
  FROM public.clientes c
  WHERE c.conta_id = public.get_my_conta_id();

-- Storage RLS: path pattern clientes/{cliente_id}/foto.*
-- clientes.id is bigserial (bigint) — NOT the uuid workspace_id is.
CREATE POLICY "cliente_photo_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'clientes'
    AND (storage.foldername(name))[2]::bigint IN (
      SELECT c.id FROM public.clientes c
      WHERE c.conta_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

CREATE POLICY "cliente_photo_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'clientes'
    AND (storage.foldername(name))[2]::bigint IN (
      SELECT c.id FROM public.clientes c
      WHERE c.conta_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- SECURITY-CRITICAL: avatars_service_write/_update (20260319_avatars_bucket.sql)
-- were created with no `TO` clause, defaulting to PUBLIC — today ANY
-- authenticated user can write to ANY path in the 'avatars' bucket, which
-- means the path-scoped policies above (and the pre-existing
-- workspace_logo_insert/_update ones) add no real restriction until this is
-- closed: RLS policies for the same command are OR'd together. Their own doc
-- comments already say the intent was service_role-only.
--
-- Verified safe: the only client-side writes into 'avatars' today
-- (WorkspaceTab's logo, RelatoriosTab's report-splash art, and this new
-- client photo) all live under workspaces/* or clientes/*, each with its own
-- dedicated scoped policy. service_role bypasses RLS entirely in Supabase,
-- so this is a no-op for edge-function writes.
DROP POLICY "avatars_service_write" ON storage.objects;
DROP POLICY "avatars_service_update" ON storage.objects;
CREATE POLICY "avatars_service_write"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'avatars');
CREATE POLICY "avatars_service_update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'avatars');

-- DB-level enforcement of "owner/admin only": clientes_update RLS permits
-- any workspace member to update a client row (20260315_rls_security_audit.sql),
-- so a UI-only role gate cannot stop an agent-role user from calling the API
-- directly and setting foto_url to an arbitrary string. SECURITY DEFINER +
-- SET search_path, matching get_my_conta_id()'s existing pattern, so this
-- check is deterministic regardless of the caller's own RLS visibility into
-- workspace_members.
--
-- POST-REVIEW FIX #1: BEFORE UPDATE alone left an INSERT-time hole -- the
-- clientes_insert RLS policy (20260315_rls_security_audit.sql) has no role
-- check at all, so an agent-role user could INSERT a brand-new clientes row
-- with foto_url already set, bypassing this guard entirely by writing the
-- column at creation time instead of via a later UPDATE. Now fires on
-- INSERT too, branching on TG_OP before touching OLD (which is unassigned
-- on INSERT) -- same shape as guard_financial_write()
-- (20260728000002_financial_visibility_b_enforcement.sql), the existing
-- precedent for this exact same-table INSERT/UPDATE column guard pattern.
--
-- POST-REVIEW FIX #2: added a trusted-caller escape hatch, but deliberately
-- NARROWER than guard_financial_write()'s literal shape
-- (20260728000002_financial_visibility_b_enforcement.sql:235-238) --
-- service_role only, no postgres/supabase_admin arm. Two escalating reasons,
-- both verified empirically against a scratch Postgres 14, not assumed:
--
-- 1. current_user is unsafe here. guard_financial_write() is SECURITY
--    INVOKER, where current_user correctly reflects the real caller. This
--    function is SECURITY DEFINER (see the comment above this one), and
--    SECURITY DEFINER reassigns current_user to the FUNCTION OWNER for the
--    entire duration of the call -- confirmed both as a plain function call
--    and inside a live BEFORE INSERT trigger: current_user read back
--    "postgres" (the owner, since migrations run as postgres) no matter who
--    actually called it. Copying current_user IN ('postgres','supabase_
--    admin') into THIS function would make that branch unconditionally
--    true and permanently disable the whole guard for every caller --
--    exactly the landmine 20260728000002's own "DEVIATION FROM THE ORIGINAL
--    DRAFT" comment warns about, just triggered by copying the check into
--    the wrong kind of function instead of by marking the function itself
--    SECURITY DEFINER.
--
-- 2. The natural fix for (1) -- session_user, which SECURITY DEFINER does
--    NOT reassign (confirmed with a real second login, not just SET ROLE:
--    it kept reading back the actual connecting login throughout) -- turns
--    out to be unsafe for a different reason, caught by actually running
--    this file's own test after adding it: EVERY entitlement test in this
--    repo, including this one, impersonates a role by connecting once as
--    `postgres` and then `SET LOCAL ROLE authenticated/service_role/...`
--    (see the IMPORTANT note below) -- SET ROLE does not change
--    session_user, so session_user stays 'postgres' for the caller's ENTIRE
--    file regardless of persona. A session_user-based escape hatch is
--    therefore not just untestable here, it is a real hole: any connection
--    that authenticates as postgres/supabase_admin and then downgrades via
--    SET ROLE -- Supabase Studio's SQL editor, a leaked postgres credential
--    used from psql, an internal debugging tool -- would silently disable
--    the guard regardless of the role it actually downgraded to. Confirmed
--    live: adding it made this file's own Case 1 (agent update, expected
--    rejected) pass for the wrong reason -- the escape hatch fired instead
--    of the owner/admin check ever running.
--
-- auth.role() = 'service_role' is unaffected by either problem: like
-- auth.uid(), it is GUC-based (current_setting('request.jwt.claims', ...)),
-- not identity-based, so it already correctly reflects the real caller
-- inside a SECURITY DEFINER function AND correctly tracks this repo's
-- SET LOCAL ROLE test-impersonation technique (test cases set the JWT
-- role claim together with SET LOCAL ROLE, not as a substitute for it) --
-- exactly what this migration's own auth.uid() check below already relied
-- on before this fix. It is also the only escape this feature actually
-- needs today: every real server-side writer of this column (the
-- Instagram-avatar cache, the report-splash art, this feature itself, and
-- any future backend/MCP path) is an edge function authenticating with the
-- service role key. A one-off admin backfill connecting directly as
-- postgres remains possible -- explicitly, via
-- `ALTER TABLE clientes DISABLE TRIGGER trg_cliente_foto_owner_admin` for
-- its duration, the same kind of deliberate, auditable escape valve
-- 56_profiles_write_lockdown.sql already uses (DISABLE ROW LEVEL SECURITY)
-- for the analogous problem on profiles -- rather than an automatic,
-- identity-based bypass that a downgraded postgres session would also
-- trigger by accident.
--
-- Deliberately NOT using auth.uid() IS NULL as an additional heuristic for
-- "not an API-mediated request" either: this migration's own sibling
-- (20260728000002) already documents why -- "auth.uid() IS NULL is NOT a
-- proxy for service role -- it also covers anonymous requests."
CREATE OR REPLACE FUNCTION public.enforce_cliente_foto_owner_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed boolean;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.foto_url IS NOT NULL;
  ELSE
    v_changed := NEW.foto_url IS DISTINCT FROM OLD.foto_url;
  END IF;

  IF v_changed THEN
    IF NOT EXISTS (
      SELECT 1 FROM workspace_members
      WHERE user_id = auth.uid()
        AND workspace_id = NEW.conta_id
        AND role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cliente_foto_owner_admin
  BEFORE INSERT OR UPDATE ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cliente_foto_owner_admin();
