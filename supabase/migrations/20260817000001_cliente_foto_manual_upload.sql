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
CREATE OR REPLACE FUNCTION public.enforce_cliente_foto_owner_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.foto_url IS DISTINCT FROM OLD.foto_url THEN
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
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cliente_foto_owner_admin();
