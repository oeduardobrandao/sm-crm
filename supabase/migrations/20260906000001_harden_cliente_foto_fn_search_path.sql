-- Endurece enforce_cliente_foto_owner_admin() contra shadowing via pg_temp.
--
-- A versão original (20260817000001_cliente_foto_manual_upload.sql) declara
-- `SET search_path = public` sem `pg_temp`. Quando pg_temp não aparece
-- explicitamente no search_path, o Postgres o busca PRIMEIRO — então uma
-- sessão autenticada poderia criar uma temp table `workspace_members` e
-- sombrear a tabela real dentro desta função SECURITY DEFINER, esvaziando o
-- check de papel (o NOT EXISTS acharia a temp table do atacante, não a
-- associação real do workspace).
--
-- Duas mudanças, corpo idêntico no resto:
--   1. `SET search_path = public, pg_temp` — pg_temp por último, como em
--      can_see_financials (20260728000001) e guard_financial_write
--      (20260728000002).
--   2. `workspace_members` qualificada como `public.workspace_members`.
--
-- As referências a auth.role()/auth.uid() já eram qualificadas. O trigger
-- trg_cliente_foto_owner_admin segue apontando para esta função — CREATE OR
-- REPLACE preserva o vínculo.
CREATE OR REPLACE FUNCTION public.enforce_cliente_foto_owner_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
      SELECT 1 FROM public.workspace_members
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
