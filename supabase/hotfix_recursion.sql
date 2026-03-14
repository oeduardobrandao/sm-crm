-- HOTFIX: Fix infinite recursion in profiles RLS policy
-- Run this on the staging SQL editor

-- 1. Create helper function (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_my_conta_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT conta_id FROM profiles WHERE id = auth.uid();
$$;

-- 2. Drop and recreate the profiles SELECT policy
DROP POLICY IF EXISTS "profiles_select_same_workspace" ON profiles;
CREATE POLICY "profiles_select_same_workspace" ON profiles
  FOR SELECT USING (conta_id = public.get_my_conta_id());

-- 3. Fix all other policies that query profiles (prevent potential perf issues)

-- clientes
DROP POLICY IF EXISTS "clientes_select" ON clientes;
DROP POLICY IF EXISTS "clientes_insert" ON clientes;
DROP POLICY IF EXISTS "clientes_update" ON clientes;
DROP POLICY IF EXISTS "clientes_delete" ON clientes;

CREATE POLICY "clientes_select" ON clientes
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "clientes_insert" ON clientes
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "clientes_update" ON clientes
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "clientes_delete" ON clientes
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- transacoes
DROP POLICY IF EXISTS "transacoes_select" ON transacoes;
DROP POLICY IF EXISTS "transacoes_insert" ON transacoes;
DROP POLICY IF EXISTS "transacoes_update" ON transacoes;
DROP POLICY IF EXISTS "transacoes_delete" ON transacoes;

CREATE POLICY "transacoes_select" ON transacoes
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "transacoes_insert" ON transacoes
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "transacoes_update" ON transacoes
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "transacoes_delete" ON transacoes
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- contratos
DROP POLICY IF EXISTS "contratos_select" ON contratos;
DROP POLICY IF EXISTS "contratos_insert" ON contratos;
DROP POLICY IF EXISTS "contratos_update" ON contratos;
DROP POLICY IF EXISTS "contratos_delete" ON contratos;

CREATE POLICY "contratos_select" ON contratos
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "contratos_insert" ON contratos
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "contratos_update" ON contratos
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "contratos_delete" ON contratos
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- membros
DROP POLICY IF EXISTS "membros_select" ON membros;
DROP POLICY IF EXISTS "membros_insert" ON membros;
DROP POLICY IF EXISTS "membros_update" ON membros;
DROP POLICY IF EXISTS "membros_delete" ON membros;

CREATE POLICY "membros_select" ON membros
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "membros_insert" ON membros
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "membros_update" ON membros
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "membros_delete" ON membros
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- integracoes_status
DROP POLICY IF EXISTS "integracoes_status_select" ON integracoes_status;
DROP POLICY IF EXISTS "integracoes_status_insert" ON integracoes_status;
DROP POLICY IF EXISTS "integracoes_status_update" ON integracoes_status;
DROP POLICY IF EXISTS "integracoes_status_delete" ON integracoes_status;

CREATE POLICY "integracoes_status_select" ON integracoes_status
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "integracoes_status_insert" ON integracoes_status
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "integracoes_status_update" ON integracoes_status
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "integracoes_status_delete" ON integracoes_status
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- leads
DROP POLICY IF EXISTS "leads_select" ON leads;
DROP POLICY IF EXISTS "leads_insert" ON leads;
DROP POLICY IF EXISTS "leads_update" ON leads;
DROP POLICY IF EXISTS "leads_delete" ON leads;

CREATE POLICY "leads_select" ON leads
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "leads_insert" ON leads
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "leads_update" ON leads
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "leads_delete" ON leads
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- workflow_templates
DROP POLICY IF EXISTS "workflow_templates_select" ON workflow_templates;
DROP POLICY IF EXISTS "workflow_templates_insert" ON workflow_templates;
DROP POLICY IF EXISTS "workflow_templates_update" ON workflow_templates;
DROP POLICY IF EXISTS "workflow_templates_delete" ON workflow_templates;

CREATE POLICY "workflow_templates_select" ON workflow_templates
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "workflow_templates_insert" ON workflow_templates
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "workflow_templates_update" ON workflow_templates
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "workflow_templates_delete" ON workflow_templates
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- workflows
DROP POLICY IF EXISTS "workflows_select" ON workflows;
DROP POLICY IF EXISTS "workflows_insert" ON workflows;
DROP POLICY IF EXISTS "workflows_update" ON workflows;
DROP POLICY IF EXISTS "workflows_delete" ON workflows;

CREATE POLICY "workflows_select" ON workflows
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "workflows_insert" ON workflows
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "workflows_update" ON workflows
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "workflows_delete" ON workflows
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- workflow_etapas
DROP POLICY IF EXISTS "workflow_etapas_select" ON workflow_etapas;
DROP POLICY IF EXISTS "workflow_etapas_insert" ON workflow_etapas;
DROP POLICY IF EXISTS "workflow_etapas_update" ON workflow_etapas;
DROP POLICY IF EXISTS "workflow_etapas_delete" ON workflow_etapas;

CREATE POLICY "workflow_etapas_select" ON workflow_etapas
  FOR SELECT USING (workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id())));
CREATE POLICY "workflow_etapas_insert" ON workflow_etapas
  FOR INSERT WITH CHECK (workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id())));
CREATE POLICY "workflow_etapas_update" ON workflow_etapas
  FOR UPDATE USING (workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id())))
  WITH CHECK (workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id())));
CREATE POLICY "workflow_etapas_delete" ON workflow_etapas
  FOR DELETE USING (workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id())));

-- instagram_post_tags (hardened)
DROP POLICY IF EXISTS "tags_conta_select" ON instagram_post_tags;
DROP POLICY IF EXISTS "tags_conta_insert" ON instagram_post_tags;
DROP POLICY IF EXISTS "tags_conta_update" ON instagram_post_tags;
DROP POLICY IF EXISTS "tags_conta_delete" ON instagram_post_tags;

CREATE POLICY "tags_conta_select" ON instagram_post_tags
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "tags_conta_insert" ON instagram_post_tags
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "tags_conta_update" ON instagram_post_tags
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "tags_conta_delete" ON instagram_post_tags
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- analytics_reports (hardened)
DROP POLICY IF EXISTS "reports_conta_select" ON analytics_reports;
DROP POLICY IF EXISTS "reports_conta_insert" ON analytics_reports;
DROP POLICY IF EXISTS "reports_conta_update" ON analytics_reports;
DROP POLICY IF EXISTS "reports_conta_delete" ON analytics_reports;

CREATE POLICY "reports_conta_select" ON analytics_reports
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "reports_conta_insert" ON analytics_reports
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "reports_conta_update" ON analytics_reports
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY "reports_conta_delete" ON analytics_reports
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));
