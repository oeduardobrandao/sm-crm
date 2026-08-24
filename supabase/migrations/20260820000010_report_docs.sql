-- supabase/migrations/20260820000010_report_docs.sql
-- Relatório interativo de blocos (fundação): report_documents + report_templates.
-- Spec: docs/superpowers/specs/2026-08-20-report-builder-blocks-design.md

-- ============ REPORT_DOCUMENTS ============
CREATE TABLE report_documents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id            bigint NOT NULL,
  instagram_account_id uuid REFERENCES instagram_accounts(id) ON DELETE SET NULL,
  title                text NOT NULL DEFAULT '',
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  layout               jsonb NOT NULL,
  data_snapshot        jsonb,
  ai_content           jsonb,
  status               text NOT NULL DEFAULT 'ready'
                         CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  generation_error     text,
  pdf_storage_path     text,
  pdf_generated_at     timestamptz,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Amarra client_id ao conta_id estruturalmente (par único criado em
  -- 20260815000002: clientes_id_conta_uq). Documento morre com o cliente.
  CONSTRAINT report_documents_client_same_tenant FOREIGN KEY (client_id, conta_id)
    REFERENCES clientes (id, conta_id) ON DELETE CASCADE
);

CREATE INDEX report_documents_conta_idx  ON report_documents (conta_id);
CREATE INDEX report_documents_client_idx ON report_documents (client_id, period_start DESC);

CREATE OR REPLACE FUNCTION set_report_documents_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER report_documents_updated_at
  BEFORE UPDATE ON report_documents
  FOR EACH ROW EXECUTE FUNCTION set_report_documents_updated_at();

-- Validação grosseira do layout: escrita direta via PostgREST não pode
-- persistir lixo. A validação fina (tipos de bloco, bounds de config) é o
-- validador TS compartilhado; aqui só a forma.
CREATE OR REPLACE FUNCTION validate_report_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layout IS NULL
     OR jsonb_typeof(NEW.layout) <> 'object'
     -- Versão EXATA (jsonb 1): checar só 'number' aceitaria 1.5, que o
     -- validateLayout TS rejeita, furando o guard em escrita direta via
     -- PostgREST. IS DISTINCT FROM cobre a chave ausente (NULL). Um bump
     -- futuro de LAYOUT_VERSION atualiza este trigger na própria migration.
     OR (NEW.layout -> 'version') IS DISTINCT FROM to_jsonb(1)
     OR jsonb_typeof(NEW.layout -> 'blocks') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.layout -> 'blocks') > 200 THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
    WHERE jsonb_typeof(b) <> 'object'
       OR jsonb_typeof(b -> 'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(b -> 'type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(b -> 'size') IS DISTINCT FROM 'string'
       OR b ->> 'size' NOT IN ('third', 'half', 'full')
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER report_documents_validate_layout
  BEFORE INSERT OR UPDATE OF layout ON report_documents
  FOR EACH ROW EXECUTE FUNCTION validate_report_layout();

ALTER TABLE report_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_documents_select ON report_documents
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY report_documents_update ON report_documents
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY report_documents_service_role_bypass ON report_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Superfície de escrita: authenticated só lê e edita (layout, title).
-- Criação, deleção, status, snapshot e campos de PDF são exclusivos da edge
-- function. REVOKE direcionado (não FROM public: isso derrubaria service_role).
REVOKE ALL ON public.report_documents FROM anon, authenticated;
GRANT SELECT ON public.report_documents TO authenticated;
GRANT UPDATE (layout, title) ON public.report_documents TO authenticated;
GRANT ALL ON public.report_documents TO service_role;

-- ============ REPORT_TEMPLATES ============
CREATE TABLE report_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name       text NOT NULL,
  layout     jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_templates_conta_idx ON report_templates (conta_id);
-- No máximo UM default por workspace; troca atômica só pela RPC abaixo.
CREATE UNIQUE INDEX report_templates_one_default ON report_templates (conta_id)
  WHERE is_default;

CREATE OR REPLACE FUNCTION set_report_templates_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER report_templates_updated_at
  BEFORE UPDATE ON report_templates
  FOR EACH ROW EXECUTE FUNCTION set_report_templates_updated_at();

CREATE TRIGGER report_templates_validate_layout
  BEFORE INSERT OR UPDATE OF layout ON report_templates
  FOR EACH ROW EXECUTE FUNCTION validate_report_layout();

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_templates_select ON report_templates
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_templates_insert ON report_templates
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_templates_update ON report_templates
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_templates_delete ON report_templates
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_templates_service_role_bypass ON report_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_default_report_template(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE report_templates SET is_default = false
   WHERE conta_id = v_conta AND is_default;
  UPDATE report_templates SET is_default = true
   WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_default_report_template(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_default_report_template(uuid) TO authenticated, service_role;
