-- Acesso por cliente: converge as policies de produção para as do repo ANTES das
-- migrations 20261117*.
--
-- Produção carrega um drift documentado em
-- docs/superpowers/specs/2026-07-28-rls-drift-reconciliation-scope.md (Finding 3): a
-- 20260315_rls_security_audit está registrada como aplicada mas nunca rodou. Por isso
-- clientes, membros e integracoes_status têm duas policies legadas FOR ALL cada
-- ("Users can CRUD own …" e "Usuários podem gerenciar … da sua conta", via
-- get_user_conta_id()), instagram_post_tags e analytics_reports têm uma FOR ALL cada
-- (tags_conta, reports_conta), e workflows/workflow_etapas leem uma subquery de profiles.
-- Fora da 20260315, hub_brand, hub_brand_files, hub_pages, client_hub_tokens,
-- portal_approvals e portal_tokens têm cópias antigas ("workspace members can manage …",
-- "owners_…") ao lado das policies do repo.
--
-- Policies PERMISSIVE se somam com OR: qualquer uma dessas que sobrar abre a tabela
-- inteira para um membro restrito, por mais que as 20261117* reescrevam as do repo. E a
-- 20261117000002 faz ALTER POLICY em clientes_*, que falha em prod sem elas.
--
-- O que esta migration faz (no-op local e em quem já está no estado do repo):
--   1. apaga as policies legadas por nome (DROP POLICY IF EXISTS);
--   2. cria cada policy do repo que faltar, ou realinha o corpo da que existe, com o corpo
--      exato que o repo produz em 20261116000001 (gerado de um banco limpo do repo).
-- Efeito para quem não é restrito: nenhum. Em prod todo profile tem conta_id =
-- active_workspace_id, então get_user_conta_id() e get_my_conta_id() coincidem; some só o
-- acesso pelo user_id do criador em outro workspace (2 clientes e 1 membro de quem já
-- saiu do workspace), que é o comportamento pretendido pela spec.

BEGIN;

-- 1. legadas
DROP POLICY IF EXISTS "Users can CRUD own clientes" ON public.clientes;
DROP POLICY IF EXISTS "Usuários podem gerenciar clientes da sua conta" ON public.clientes;
DROP POLICY IF EXISTS "Users can CRUD own membros" ON public.membros;
DROP POLICY IF EXISTS "Usuários podem gerenciar membros da sua conta" ON public.membros;
DROP POLICY IF EXISTS "Users can CRUD own integracoes_status" ON public.integracoes_status;
DROP POLICY IF EXISTS "Usuários podem gerenciar status de integração da sua conta" ON public.integracoes_status;
DROP POLICY IF EXISTS tags_conta ON public.instagram_post_tags;
DROP POLICY IF EXISTS reports_conta ON public.analytics_reports;
DROP POLICY IF EXISTS "workspace members can manage hub tokens" ON public.client_hub_tokens;
DROP POLICY IF EXISTS "workspace members can manage hub brand" ON public.hub_brand;
DROP POLICY IF EXISTS "workspace members can manage hub brand files" ON public.hub_brand_files;
DROP POLICY IF EXISTS "workspace members can manage hub pages" ON public.hub_pages;
DROP POLICY IF EXISTS "Users can view portal approvals for their accounts" ON public.portal_approvals;
DROP POLICY IF EXISTS owners_insert_portal_approvals ON public.portal_approvals;
DROP POLICY IF EXISTS owners_manage_portal_tokens ON public.portal_tokens;

-- 2. policies do repo (corpo de um banco limpo em 20261116000001)
-- analytics_reports.reports_conta_delete
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_reports' AND policyname = 'reports_conta_delete') THEN
    CREATE POLICY reports_conta_delete ON public.analytics_reports AS PERMISSIVE FOR DELETE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY reports_conta_delete ON public.analytics_reports TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- analytics_reports.reports_conta_insert
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_reports' AND policyname = 'reports_conta_insert') THEN
    CREATE POLICY reports_conta_insert ON public.analytics_reports AS PERMISSIVE FOR INSERT TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY reports_conta_insert ON public.analytics_reports TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- analytics_reports.reports_conta_select
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_reports' AND policyname = 'reports_conta_select') THEN
    CREATE POLICY reports_conta_select ON public.analytics_reports AS PERMISSIVE FOR SELECT TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY reports_conta_select ON public.analytics_reports TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- analytics_reports.reports_conta_update
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_reports' AND policyname = 'reports_conta_update') THEN
    CREATE POLICY reports_conta_update ON public.analytics_reports AS PERMISSIVE FOR UPDATE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY reports_conta_update ON public.analytics_reports TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- clientes.clientes_delete
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clientes' AND policyname = 'clientes_delete') THEN
    CREATE POLICY clientes_delete ON public.clientes AS PERMISSIVE FOR DELETE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY clientes_delete ON public.clientes TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- clientes.clientes_insert
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clientes' AND policyname = 'clientes_insert') THEN
    CREATE POLICY clientes_insert ON public.clientes AS PERMISSIVE FOR INSERT TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY clientes_insert ON public.clientes TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- clientes.clientes_select
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clientes' AND policyname = 'clientes_select') THEN
    CREATE POLICY clientes_select ON public.clientes AS PERMISSIVE FOR SELECT TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY clientes_select ON public.clientes TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- clientes.clientes_update
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clientes' AND policyname = 'clientes_update') THEN
    CREATE POLICY clientes_update ON public.clientes AS PERMISSIVE FOR UPDATE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY clientes_update ON public.clientes TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- instagram_post_tags.tags_conta_delete
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'instagram_post_tags' AND policyname = 'tags_conta_delete') THEN
    CREATE POLICY tags_conta_delete ON public.instagram_post_tags AS PERMISSIVE FOR DELETE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY tags_conta_delete ON public.instagram_post_tags TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- instagram_post_tags.tags_conta_insert
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'instagram_post_tags' AND policyname = 'tags_conta_insert') THEN
    CREATE POLICY tags_conta_insert ON public.instagram_post_tags AS PERMISSIVE FOR INSERT TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY tags_conta_insert ON public.instagram_post_tags TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- instagram_post_tags.tags_conta_select
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'instagram_post_tags' AND policyname = 'tags_conta_select') THEN
    CREATE POLICY tags_conta_select ON public.instagram_post_tags AS PERMISSIVE FOR SELECT TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY tags_conta_select ON public.instagram_post_tags TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- instagram_post_tags.tags_conta_update
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'instagram_post_tags' AND policyname = 'tags_conta_update') THEN
    CREATE POLICY tags_conta_update ON public.instagram_post_tags AS PERMISSIVE FOR UPDATE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY tags_conta_update ON public.instagram_post_tags TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- integracoes_status.integracoes_status_delete
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integracoes_status' AND policyname = 'integracoes_status_delete') THEN
    CREATE POLICY integracoes_status_delete ON public.integracoes_status AS PERMISSIVE FOR DELETE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY integracoes_status_delete ON public.integracoes_status TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- integracoes_status.integracoes_status_insert
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integracoes_status' AND policyname = 'integracoes_status_insert') THEN
    CREATE POLICY integracoes_status_insert ON public.integracoes_status AS PERMISSIVE FOR INSERT TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY integracoes_status_insert ON public.integracoes_status TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- integracoes_status.integracoes_status_select
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integracoes_status' AND policyname = 'integracoes_status_select') THEN
    CREATE POLICY integracoes_status_select ON public.integracoes_status AS PERMISSIVE FOR SELECT TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY integracoes_status_select ON public.integracoes_status TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- integracoes_status.integracoes_status_update
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integracoes_status' AND policyname = 'integracoes_status_update') THEN
    CREATE POLICY integracoes_status_update ON public.integracoes_status AS PERMISSIVE FOR UPDATE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY integracoes_status_update ON public.integracoes_status TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- membros.membros_delete
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'membros' AND policyname = 'membros_delete') THEN
    CREATE POLICY membros_delete ON public.membros AS PERMISSIVE FOR DELETE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY membros_delete ON public.membros TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- membros.membros_insert
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'membros' AND policyname = 'membros_insert') THEN
    CREATE POLICY membros_insert ON public.membros AS PERMISSIVE FOR INSERT TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY membros_insert ON public.membros TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- membros.membros_select
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'membros' AND policyname = 'membros_select') THEN
    CREATE POLICY membros_select ON public.membros AS PERMISSIVE FOR SELECT TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY membros_select ON public.membros TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- membros.membros_update
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'membros' AND policyname = 'membros_update') THEN
    CREATE POLICY membros_update ON public.membros AS PERMISSIVE FOR UPDATE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY membros_update ON public.membros TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- workflow_etapas.workflow_etapas_delete
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflow_etapas' AND policyname = 'workflow_etapas_delete') THEN
    CREATE POLICY workflow_etapas_delete ON public.workflow_etapas AS PERMISSIVE FOR DELETE TO public
      USING ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))));
  ELSE
    ALTER POLICY workflow_etapas_delete ON public.workflow_etapas TO public
      USING ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))));
  END IF;
END $do$;

-- workflow_etapas.workflow_etapas_insert
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflow_etapas' AND policyname = 'workflow_etapas_insert') THEN
    CREATE POLICY workflow_etapas_insert ON public.workflow_etapas AS PERMISSIVE FOR INSERT TO public
      WITH CHECK ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))));
  ELSE
    ALTER POLICY workflow_etapas_insert ON public.workflow_etapas TO public
      WITH CHECK ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))));
  END IF;
END $do$;

-- workflow_etapas.workflow_etapas_select
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflow_etapas' AND policyname = 'workflow_etapas_select') THEN
    CREATE POLICY workflow_etapas_select ON public.workflow_etapas AS PERMISSIVE FOR SELECT TO public
      USING ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))));
  ELSE
    ALTER POLICY workflow_etapas_select ON public.workflow_etapas TO public
      USING ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))));
  END IF;
END $do$;

-- workflow_etapas.workflow_etapas_update
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflow_etapas' AND policyname = 'workflow_etapas_update') THEN
    CREATE POLICY workflow_etapas_update ON public.workflow_etapas AS PERMISSIVE FOR UPDATE TO public
      USING ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))))
      WITH CHECK ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))));
  ELSE
    ALTER POLICY workflow_etapas_update ON public.workflow_etapas TO public
      USING ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))))
      WITH CHECK ((workflow_id IN ( SELECT workflows.id
   FROM workflows
  WHERE (workflows.conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))));
  END IF;
END $do$;

-- workflows.workflows_delete
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflows' AND policyname = 'workflows_delete') THEN
    CREATE POLICY workflows_delete ON public.workflows AS PERMISSIVE FOR DELETE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY workflows_delete ON public.workflows TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- workflows.workflows_insert
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflows' AND policyname = 'workflows_insert') THEN
    CREATE POLICY workflows_insert ON public.workflows AS PERMISSIVE FOR INSERT TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY workflows_insert ON public.workflows TO public
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- workflows.workflows_select
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflows' AND policyname = 'workflows_select') THEN
    CREATE POLICY workflows_select ON public.workflows AS PERMISSIVE FOR SELECT TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY workflows_select ON public.workflows TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- workflows.workflows_update
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflows' AND policyname = 'workflows_update') THEN
    CREATE POLICY workflows_update ON public.workflows AS PERMISSIVE FOR UPDATE TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  ELSE
    ALTER POLICY workflows_update ON public.workflows TO public
      USING ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)))
      WITH CHECK ((conta_id IN ( SELECT get_my_conta_id() AS get_my_conta_id)));
  END IF;
END $do$;

-- pós-condição: nas tabelas acima sobra exatamente o conjunto de policies que o repo define
-- em 20261116000001 (gerado de um banco limpo). Qualquer policy a mais, conhecida ou não,
-- aborta: somada com OR, ela anularia o escopo por cliente.
DO $$
DECLARE v text;
BEGIN
  WITH esperado(t, p) AS (VALUES
    ('analytics_reports', 'reports_conta_delete'),
    ('analytics_reports', 'reports_conta_insert'),
    ('analytics_reports', 'reports_conta_select'),
    ('analytics_reports', 'reports_conta_update'),
    ('client_hub_tokens', 'client_hub_tokens_service_role'),
    ('client_hub_tokens', 'client_hub_tokens_workspace_all'),
    ('clientes', 'clientes_delete'),
    ('clientes', 'clientes_insert'),
    ('clientes', 'clientes_select'),
    ('clientes', 'clientes_update'),
    ('hub_brand', 'hub_brand_service_role'),
    ('hub_brand', 'hub_brand_workspace_all'),
    ('hub_brand_files', 'hub_brand_files_service_role'),
    ('hub_brand_files', 'hub_brand_files_workspace_all'),
    ('hub_pages', 'hub_pages_service_role'),
    ('hub_pages', 'hub_pages_workspace_all'),
    ('instagram_post_tags', 'tags_conta_delete'),
    ('instagram_post_tags', 'tags_conta_insert'),
    ('instagram_post_tags', 'tags_conta_select'),
    ('instagram_post_tags', 'tags_conta_update'),
    ('integracoes_status', 'integracoes_status_delete'),
    ('integracoes_status', 'integracoes_status_insert'),
    ('integracoes_status', 'integracoes_status_select'),
    ('integracoes_status', 'integracoes_status_update'),
    ('membros', 'membros_delete'),
    ('membros', 'membros_insert'),
    ('membros', 'membros_select'),
    ('membros', 'membros_update'),
    ('portal_approvals', 'portal_approvals_delete'),
    ('portal_approvals', 'portal_approvals_insert'),
    ('portal_approvals', 'portal_approvals_select'),
    ('portal_approvals', 'portal_approvals_update'),
    ('portal_tokens', 'portal_tokens_service_role'),
    ('portal_tokens', 'portal_tokens_workspace_all'),
    ('workflow_etapas', 'workflow_etapas_delete'),
    ('workflow_etapas', 'workflow_etapas_insert'),
    ('workflow_etapas', 'workflow_etapas_select'),
    ('workflow_etapas', 'workflow_etapas_update'),
    ('workflows', 'workflows_delete'),
    ('workflows', 'workflows_insert'),
    ('workflows', 'workflows_select'),
    ('workflows', 'workflows_update'))
  SELECT string_agg(pp.tablename || '.' || pp.policyname, ', ' ORDER BY 1) INTO v
    FROM pg_policies pp
   WHERE pp.schemaname = 'public'
     AND pp.tablename IN ('analytics_reports', 'client_hub_tokens', 'clientes', 'hub_brand', 'hub_brand_files', 'hub_pages', 'instagram_post_tags', 'integracoes_status', 'membros', 'portal_approvals', 'portal_tokens', 'workflow_etapas', 'workflows')
     AND NOT EXISTS (SELECT 1 FROM esperado e WHERE e.t = pp.tablename AND e.p = pp.policyname);
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'reconcilia_policies: policies fora do repo: %', v;
  END IF;

  WITH esperado(t, p) AS (VALUES
    ('analytics_reports', 'reports_conta_delete'),
    ('analytics_reports', 'reports_conta_insert'),
    ('analytics_reports', 'reports_conta_select'),
    ('analytics_reports', 'reports_conta_update'),
    ('client_hub_tokens', 'client_hub_tokens_service_role'),
    ('client_hub_tokens', 'client_hub_tokens_workspace_all'),
    ('clientes', 'clientes_delete'),
    ('clientes', 'clientes_insert'),
    ('clientes', 'clientes_select'),
    ('clientes', 'clientes_update'),
    ('hub_brand', 'hub_brand_service_role'),
    ('hub_brand', 'hub_brand_workspace_all'),
    ('hub_brand_files', 'hub_brand_files_service_role'),
    ('hub_brand_files', 'hub_brand_files_workspace_all'),
    ('hub_pages', 'hub_pages_service_role'),
    ('hub_pages', 'hub_pages_workspace_all'),
    ('instagram_post_tags', 'tags_conta_delete'),
    ('instagram_post_tags', 'tags_conta_insert'),
    ('instagram_post_tags', 'tags_conta_select'),
    ('instagram_post_tags', 'tags_conta_update'),
    ('integracoes_status', 'integracoes_status_delete'),
    ('integracoes_status', 'integracoes_status_insert'),
    ('integracoes_status', 'integracoes_status_select'),
    ('integracoes_status', 'integracoes_status_update'),
    ('membros', 'membros_delete'),
    ('membros', 'membros_insert'),
    ('membros', 'membros_select'),
    ('membros', 'membros_update'),
    ('portal_approvals', 'portal_approvals_delete'),
    ('portal_approvals', 'portal_approvals_insert'),
    ('portal_approvals', 'portal_approvals_select'),
    ('portal_approvals', 'portal_approvals_update'),
    ('portal_tokens', 'portal_tokens_service_role'),
    ('portal_tokens', 'portal_tokens_workspace_all'),
    ('workflow_etapas', 'workflow_etapas_delete'),
    ('workflow_etapas', 'workflow_etapas_insert'),
    ('workflow_etapas', 'workflow_etapas_select'),
    ('workflow_etapas', 'workflow_etapas_update'),
    ('workflows', 'workflows_delete'),
    ('workflows', 'workflows_insert'),
    ('workflows', 'workflows_select'),
    ('workflows', 'workflows_update'))
  SELECT string_agg(e.t || '.' || e.p, ', ' ORDER BY 1) INTO v
    FROM esperado e
   WHERE NOT EXISTS (SELECT 1 FROM pg_policies pp
                      WHERE pp.schemaname = 'public' AND pp.tablename = e.t AND pp.policyname = e.p);
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'reconcilia_policies: faltam policies do repo: %', v;
  END IF;
END $$;

COMMIT;
