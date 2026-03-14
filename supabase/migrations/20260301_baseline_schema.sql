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
