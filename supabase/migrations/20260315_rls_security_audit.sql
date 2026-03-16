-- =============================================
-- Security Audit Migration - 2026-03-14
-- Enables RLS on all unprotected tables and
-- creates strict per-operation policies.
-- =============================================

-- =============================================
-- Helper: SECURITY DEFINER function to get the
-- current user's conta_id without triggering RLS.
-- =============================================
CREATE OR REPLACE FUNCTION public.get_my_conta_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT active_workspace_id FROM profiles WHERE id = auth.uid();
$$;

-- =============================================
-- 1. PROFILES — most critical table
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can only see profiles in their own workspace
DROP POLICY IF EXISTS "profiles_select_same_workspace" ON profiles;
CREATE POLICY "profiles_select_same_workspace" ON profiles
  FOR SELECT USING (
    conta_id = public.get_my_conta_id()
  );

-- Users can only update their OWN profile
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Block direct INSERT/DELETE from client — managed by auth triggers / edge functions
DROP POLICY IF EXISTS "profiles_insert_self" ON profiles;
CREATE POLICY "profiles_insert_self" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_no_delete" ON profiles;
CREATE POLICY "profiles_no_delete" ON profiles
  FOR DELETE USING (false);

-- CRITICAL: Revoke direct update on sensitive columns.
-- Role changes MUST go through the manage-workspace-user edge function.
-- We do this by revoking column-level UPDATE and re-granting only safe columns.
REVOKE UPDATE ON profiles FROM authenticated;
-- Grant UPDATE only on non-sensitive columns users should be able to edit.
-- Adjust this list to match your actual safe columns (nome, avatar_url, etc.)
GRANT UPDATE (nome, avatar_url) ON profiles TO authenticated;


-- =============================================
-- 2. CLIENTES
-- =============================================
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clientes_select" ON clientes;
CREATE POLICY "clientes_select" ON clientes
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "clientes_insert" ON clientes;
CREATE POLICY "clientes_insert" ON clientes
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "clientes_update" ON clientes;
CREATE POLICY "clientes_update" ON clientes
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "clientes_delete" ON clientes;
CREATE POLICY "clientes_delete" ON clientes
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 3. TRANSACOES
-- =============================================
ALTER TABLE transacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transacoes_select" ON transacoes;
CREATE POLICY "transacoes_select" ON transacoes
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "transacoes_insert" ON transacoes;
CREATE POLICY "transacoes_insert" ON transacoes
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "transacoes_update" ON transacoes;
CREATE POLICY "transacoes_update" ON transacoes
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "transacoes_delete" ON transacoes;
CREATE POLICY "transacoes_delete" ON transacoes
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 4. CONTRATOS
-- =============================================
ALTER TABLE contratos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contratos_select" ON contratos;
CREATE POLICY "contratos_select" ON contratos
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "contratos_insert" ON contratos;
CREATE POLICY "contratos_insert" ON contratos
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "contratos_update" ON contratos;
CREATE POLICY "contratos_update" ON contratos
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "contratos_delete" ON contratos;
CREATE POLICY "contratos_delete" ON contratos
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 5. MEMBROS
-- =============================================
ALTER TABLE membros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membros_select" ON membros;
CREATE POLICY "membros_select" ON membros
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "membros_insert" ON membros;
CREATE POLICY "membros_insert" ON membros
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "membros_update" ON membros;
CREATE POLICY "membros_update" ON membros
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "membros_delete" ON membros;
CREATE POLICY "membros_delete" ON membros
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 6. INTEGRACOES_STATUS
-- =============================================
ALTER TABLE integracoes_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integracoes_status_select" ON integracoes_status;
CREATE POLICY "integracoes_status_select" ON integracoes_status
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "integracoes_status_insert" ON integracoes_status;
CREATE POLICY "integracoes_status_insert" ON integracoes_status
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "integracoes_status_update" ON integracoes_status;
CREATE POLICY "integracoes_status_update" ON integracoes_status
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "integracoes_status_delete" ON integracoes_status;
CREATE POLICY "integracoes_status_delete" ON integracoes_status
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 7. LEADS
-- =============================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select" ON leads;
CREATE POLICY "leads_select" ON leads
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "leads_insert" ON leads;
CREATE POLICY "leads_insert" ON leads
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "leads_update" ON leads;
CREATE POLICY "leads_update" ON leads
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "leads_delete" ON leads;
CREATE POLICY "leads_delete" ON leads
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 8. WORKFLOW_TEMPLATES
-- =============================================
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_templates_select" ON workflow_templates;
CREATE POLICY "workflow_templates_select" ON workflow_templates
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "workflow_templates_insert" ON workflow_templates;
CREATE POLICY "workflow_templates_insert" ON workflow_templates
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "workflow_templates_update" ON workflow_templates;
CREATE POLICY "workflow_templates_update" ON workflow_templates
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "workflow_templates_delete" ON workflow_templates;
CREATE POLICY "workflow_templates_delete" ON workflow_templates
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 9. WORKFLOWS
-- =============================================
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflows_select" ON workflows;
CREATE POLICY "workflows_select" ON workflows
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "workflows_insert" ON workflows;
CREATE POLICY "workflows_insert" ON workflows
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "workflows_update" ON workflows;
CREATE POLICY "workflows_update" ON workflows
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "workflows_delete" ON workflows;
CREATE POLICY "workflows_delete" ON workflows
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 10. WORKFLOW_ETAPAS (no conta_id — chain via workflows)
-- =============================================
ALTER TABLE workflow_etapas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_etapas_select" ON workflow_etapas;
CREATE POLICY "workflow_etapas_select" ON workflow_etapas
  FOR SELECT USING (
    workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

DROP POLICY IF EXISTS "workflow_etapas_insert" ON workflow_etapas;
CREATE POLICY "workflow_etapas_insert" ON workflow_etapas
  FOR INSERT WITH CHECK (
    workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

DROP POLICY IF EXISTS "workflow_etapas_update" ON workflow_etapas;
CREATE POLICY "workflow_etapas_update" ON workflow_etapas
  FOR UPDATE USING (
    workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id()))
  ) WITH CHECK (
    workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

DROP POLICY IF EXISTS "workflow_etapas_delete" ON workflow_etapas;
CREATE POLICY "workflow_etapas_delete" ON workflow_etapas
  FOR DELETE USING (
    workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );


-- =============================================
-- 11. HARDEN EXISTING INSTAGRAM POLICIES
-- Replace FOR ALL with per-operation policies that
-- include WITH CHECK to prevent conta_id spoofing.
-- =============================================

-- instagram_post_tags: drop FOR ALL, add per-operation
DROP POLICY IF EXISTS "tags_conta" ON instagram_post_tags;

DROP POLICY IF EXISTS "tags_conta_select" ON instagram_post_tags;
CREATE POLICY "tags_conta_select" ON instagram_post_tags
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "tags_conta_insert" ON instagram_post_tags;
CREATE POLICY "tags_conta_insert" ON instagram_post_tags
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "tags_conta_update" ON instagram_post_tags;
CREATE POLICY "tags_conta_update" ON instagram_post_tags
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "tags_conta_delete" ON instagram_post_tags;
CREATE POLICY "tags_conta_delete" ON instagram_post_tags
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- analytics_reports: drop FOR ALL, add per-operation
DROP POLICY IF EXISTS "reports_conta" ON analytics_reports;

DROP POLICY IF EXISTS "reports_conta_select" ON analytics_reports;
CREATE POLICY "reports_conta_select" ON analytics_reports
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "reports_conta_insert" ON analytics_reports;
CREATE POLICY "reports_conta_insert" ON analytics_reports
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "reports_conta_update" ON analytics_reports;
CREATE POLICY "reports_conta_update" ON analytics_reports
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "reports_conta_delete" ON analytics_reports;
CREATE POLICY "reports_conta_delete" ON analytics_reports
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));
