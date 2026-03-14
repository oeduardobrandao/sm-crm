-- =============================================
-- Baseline Schema - Core tables
-- These were originally created via the Supabase
-- dashboard and need to exist before other migrations.
-- Migration: 2026-03-01
-- =============================================

-- 1. PROFILES (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL,
  role text DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'agent')),
  nome text,
  avatar_url text,
  empresa text,
  telefone text,
  whatsapp text,
  whatsapp_opt_in boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. CLIENTES
CREATE TABLE IF NOT EXISTS clientes (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  nome text NOT NULL,
  sigla text NOT NULL,
  cor text NOT NULL,
  plano text,
  email text,
  telefone text,
  status text DEFAULT 'ativo' CHECK (status IN ('ativo', 'pausado', 'encerrado')),
  valor_mensal numeric,
  notion_page_url text,
  data_pagamento integer,
  created_at timestamptz DEFAULT now()
);

-- 3. TRANSACOES
CREATE TABLE IF NOT EXISTS transacoes (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  data text NOT NULL,
  descricao text,
  detalhe text,
  categoria text,
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  valor numeric NOT NULL,
  cliente_id bigint REFERENCES clientes(id) ON DELETE SET NULL,
  status text DEFAULT 'pago' CHECK (status IN ('pago', 'agendado')),
  referencia_agendamento text,
  created_at timestamptz DEFAULT now()
);

-- 4. CONTRATOS
CREATE TABLE IF NOT EXISTS contratos (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  cliente_id bigint REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  titulo text NOT NULL,
  data_inicio text NOT NULL,
  data_fim text NOT NULL,
  status text DEFAULT 'vigente' CHECK (status IN ('vigente', 'a_assinar', 'encerrado')),
  valor_total numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 5. MEMBROS
CREATE TABLE IF NOT EXISTS membros (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  nome text NOT NULL,
  cargo text,
  tipo text CHECK (tipo IN ('clt', 'freelancer_mensal', 'freelancer_demanda')),
  custo_mensal numeric,
  avatar_url text,
  data_pagamento integer,
  created_at timestamptz DEFAULT now()
);

-- 6. INTEGRACOES_STATUS
CREATE TABLE IF NOT EXISTS integracoes_status (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  integracao_id text NOT NULL,
  status text DEFAULT 'desconectado' CHECK (status IN ('conectado', 'desconectado', 'em_breve')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, integracao_id)
);

-- 7. LEADS
CREATE TABLE IF NOT EXISTS leads (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  nome text NOT NULL,
  email text,
  telefone text,
  instagram text,
  canal text,
  origem text DEFAULT 'manual' CHECK (origem IN ('manual', 'typeform', 'instagram')),
  status text DEFAULT 'novo' CHECK (status IN ('novo', 'contatado', 'qualificado', 'perdido', 'convertido')),
  notas text,
  especialidade text,
  faturamento text,
  objetivo text,
  tags text,
  created_at timestamptz DEFAULT now()
);

-- 8. WORKFLOW_TEMPLATES
CREATE TABLE IF NOT EXISTS workflow_templates (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  nome text NOT NULL,
  etapas jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- 9. WORKFLOWS
CREATE TABLE IF NOT EXISTS workflows (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  cliente_id bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  template_id bigint REFERENCES workflow_templates(id) ON DELETE SET NULL,
  status text DEFAULT 'ativo' CHECK (status IN ('ativo', 'concluido', 'arquivado')),
  etapa_atual integer DEFAULT 0,
  recorrente boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 10. WORKFLOW_ETAPAS
CREATE TABLE IF NOT EXISTS workflow_etapas (
  id bigserial PRIMARY KEY,
  workflow_id bigint NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  ordem integer NOT NULL,
  nome text NOT NULL,
  prazo_dias integer NOT NULL,
  tipo_prazo text DEFAULT 'corridos' CHECK (tipo_prazo IN ('uteis', 'corridos')),
  responsavel_id bigint REFERENCES membros(id) ON DELETE SET NULL,
  status text DEFAULT 'pendente' CHECK (status IN ('pendente', 'ativo', 'concluido')),
  iniciado_em timestamptz,
  concluido_em timestamptz
);

-- 11. INSTAGRAM_ACCOUNTS
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  instagram_user_id text NOT NULL,
  username text,
  profile_picture_url text,
  follower_count integer DEFAULT 0,
  following_count integer DEFAULT 0,
  media_count integer DEFAULT 0,
  encrypted_access_token text,
  token_expires_at timestamptz,
  reach_28d integer DEFAULT 0,
  impressions_28d integer DEFAULT 0,
  profile_views_28d integer DEFAULT 0,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(client_id)
);

-- 12. INSTAGRAM_POSTS
CREATE TABLE IF NOT EXISTS instagram_posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  instagram_account_id uuid NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  instagram_post_id text NOT NULL,
  caption text,
  media_type text,
  permalink text,
  posted_at timestamptz,
  likes integer DEFAULT 0,
  comments integer DEFAULT 0,
  reach integer DEFAULT 0,
  impressions integer DEFAULT 0,
  saved integer DEFAULT 0,
  shares integer DEFAULT 0,
  synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(instagram_post_id)
);

-- 13. INSTAGRAM_FOLLOWER_HISTORY
CREATE TABLE IF NOT EXISTS instagram_follower_history (
  id bigserial PRIMARY KEY,
  instagram_account_id uuid NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  date text NOT NULL,
  follower_count integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(instagram_account_id, date)
);
-- Analytics Module - Database Schema
-- Migration: 2026-03-06

-- 1. Add especialidade to clientes (for specialty segmentation)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS especialidade text DEFAULT '';

-- 2. Analytics cache (6-hour TTL for API responses)
CREATE TABLE IF NOT EXISTS instagram_analytics_cache (
  id bigserial PRIMARY KEY,
  instagram_account_id uuid REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instagram_account_id, cache_key)
);

-- 3. Post topic tags (workspace-scoped)
CREATE TABLE IF NOT EXISTS instagram_post_tags (
  id bigserial PRIMARY KEY,
  conta_id uuid NOT NULL,
  tag_name text NOT NULL,
  color text NOT NULL DEFAULT '#eab308',
  UNIQUE(conta_id, tag_name)
);

CREATE TABLE IF NOT EXISTS instagram_post_tag_assignments (
  id bigserial PRIMARY KEY,
  post_id uuid REFERENCES instagram_posts(id) ON DELETE CASCADE,
  tag_id bigint REFERENCES instagram_post_tags(id) ON DELETE CASCADE,
  UNIQUE(post_id, tag_id)
);

-- 4. Monthly PDF reports
CREATE TABLE IF NOT EXISTS analytics_reports (
  id bigserial PRIMARY KEY,
  conta_id uuid NOT NULL,
  client_id bigint REFERENCES clientes(id) ON DELETE CASCADE,
  instagram_account_id uuid REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  report_month text NOT NULL,
  report_url text,
  storage_path text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  UNIQUE(instagram_account_id, report_month)
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_ig_posts_account_posted ON instagram_posts(instagram_account_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_cache_account_key ON instagram_analytics_cache(instagram_account_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_ig_follower_hist_date ON instagram_follower_history(instagram_account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_reports_client ON analytics_reports(client_id, report_month);

-- 6. RLS
ALTER TABLE instagram_analytics_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_post_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_post_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_conta" ON instagram_post_tags
  FOR ALL USING (conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "tag_assignments_via_tags" ON instagram_post_tag_assignments
  FOR ALL USING (tag_id IN (
    SELECT id FROM instagram_post_tags
    WHERE conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "reports_conta" ON analytics_reports
  FOR ALL USING (conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "cache_via_account" ON instagram_analytics_cache
  FOR ALL USING (instagram_account_id IN (
    SELECT ia.id FROM instagram_accounts ia
    JOIN clientes c ON c.id = ia.client_id
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));
-- Enable RLS on core Instagram tables
-- These tables were created via dashboard without RLS policies

-- 1. instagram_accounts
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_conta" ON instagram_accounts
  FOR ALL USING (client_id IN (
    SELECT c.id FROM clientes c
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));

-- 2. instagram_posts
ALTER TABLE instagram_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_via_account" ON instagram_posts
  FOR ALL USING (instagram_account_id IN (
    SELECT ia.id FROM instagram_accounts ia
    JOIN clientes c ON c.id = ia.client_id
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));

-- 3. instagram_follower_history
ALTER TABLE instagram_follower_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follower_history_via_account" ON instagram_follower_history
  FOR ALL USING (instagram_account_id IN (
    SELECT ia.id FROM instagram_accounts ia
    JOIN clientes c ON c.id = ia.client_id
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));
-- Add thumbnail_url to instagram_posts for image previews
ALTER TABLE instagram_posts ADD COLUMN IF NOT EXISTS thumbnail_url text;
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
  SELECT public.get_my_conta_id();
$$;

-- =============================================
-- 1. PROFILES — most critical table
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can only see profiles in their own workspace
CREATE POLICY "profiles_select_same_workspace" ON profiles
  FOR SELECT USING (
    conta_id = public.get_my_conta_id()
  );

-- Users can only update their OWN profile
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Block direct INSERT/DELETE from client — managed by auth triggers / edge functions
CREATE POLICY "profiles_insert_self" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

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

CREATE POLICY "clientes_select" ON clientes
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "clientes_insert" ON clientes
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "clientes_update" ON clientes
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "clientes_delete" ON clientes
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 3. TRANSACOES
-- =============================================
ALTER TABLE transacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transacoes_select" ON transacoes
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "transacoes_insert" ON transacoes
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "transacoes_update" ON transacoes
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "transacoes_delete" ON transacoes
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 4. CONTRATOS
-- =============================================
ALTER TABLE contratos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contratos_select" ON contratos
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "contratos_insert" ON contratos
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "contratos_update" ON contratos
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "contratos_delete" ON contratos
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 5. MEMBROS
-- =============================================
ALTER TABLE membros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "membros_select" ON membros
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "membros_insert" ON membros
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "membros_update" ON membros
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "membros_delete" ON membros
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 6. INTEGRACOES_STATUS
-- =============================================
ALTER TABLE integracoes_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integracoes_status_select" ON integracoes_status
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "integracoes_status_insert" ON integracoes_status
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "integracoes_status_update" ON integracoes_status
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "integracoes_status_delete" ON integracoes_status
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 7. LEADS
-- =============================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_select" ON leads
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "leads_insert" ON leads
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "leads_update" ON leads
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "leads_delete" ON leads
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 8. WORKFLOW_TEMPLATES
-- =============================================
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_templates_select" ON workflow_templates
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "workflow_templates_insert" ON workflow_templates
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "workflow_templates_update" ON workflow_templates
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "workflow_templates_delete" ON workflow_templates
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 9. WORKFLOWS
-- =============================================
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflows_select" ON workflows
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "workflows_insert" ON workflows
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "workflows_update" ON workflows
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

CREATE POLICY "workflows_delete" ON workflows
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );


-- =============================================
-- 10. WORKFLOW_ETAPAS (no conta_id — chain via workflows)
-- =============================================
ALTER TABLE workflow_etapas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_etapas_select" ON workflow_etapas
  FOR SELECT USING (
    workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

CREATE POLICY "workflow_etapas_insert" ON workflow_etapas
  FOR INSERT WITH CHECK (
    workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

CREATE POLICY "workflow_etapas_update" ON workflow_etapas
  FOR UPDATE USING (
    workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id()))
  ) WITH CHECK (
    workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

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

CREATE POLICY "tags_conta_select" ON instagram_post_tags
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "tags_conta_insert" ON instagram_post_tags
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "tags_conta_update" ON instagram_post_tags
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "tags_conta_delete" ON instagram_post_tags
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- analytics_reports: drop FOR ALL, add per-operation
DROP POLICY IF EXISTS "reports_conta" ON analytics_reports;

CREATE POLICY "reports_conta_select" ON analytics_reports
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "reports_conta_insert" ON analytics_reports
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "reports_conta_update" ON analytics_reports
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "reports_conta_delete" ON analytics_reports
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));
