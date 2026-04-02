-- Fix portal_approvals: allow 'mensagem' action and add is_workspace_user column
ALTER TABLE portal_approvals DROP CONSTRAINT IF EXISTS portal_approvals_action_check;
ALTER TABLE portal_approvals ADD CONSTRAINT portal_approvals_action_check
  CHECK (action IN ('aprovado', 'correcao', 'mensagem'));

ALTER TABLE portal_approvals
  ADD COLUMN IF NOT EXISTS is_workspace_user boolean NOT NULL DEFAULT false;

-- ============================================================
-- workflow_posts — individual content pieces (sub-tasks)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_posts (
  id            bigserial PRIMARY KEY,
  workflow_id   bigint NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  conta_id      uuid NOT NULL,
  titulo        text NOT NULL DEFAULT '',
  conteudo      jsonb,
  conteudo_plain text DEFAULT '',
  tipo          text NOT NULL DEFAULT 'feed'
                CHECK (tipo IN ('feed', 'reels', 'stories', 'carrossel')),
  ordem         integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'rascunho'
                CHECK (status IN (
                  'rascunho',
                  'revisao_interna',
                  'aprovado_interno',
                  'enviado_cliente',
                  'aprovado_cliente',
                  'correcao_cliente'
                )),
  responsavel_id bigint REFERENCES membros(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_posts_workflow
  ON workflow_posts(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_posts_conta
  ON workflow_posts(conta_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_workflow_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workflow_posts_updated_at ON workflow_posts;
CREATE TRIGGER workflow_posts_updated_at
  BEFORE UPDATE ON workflow_posts
  FOR EACH ROW EXECUTE FUNCTION set_workflow_posts_updated_at();

-- ============================================================
-- post_approvals — per-post client feedback
-- ============================================================
CREATE TABLE IF NOT EXISTS post_approvals (
  id            bigserial PRIMARY KEY,
  post_id       bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  token         text NOT NULL,
  action        text NOT NULL
                CHECK (action IN ('aprovado', 'correcao', 'mensagem')),
  comentario    text,
  is_workspace_user boolean NOT NULL DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_approvals_post
  ON post_approvals(post_id);
CREATE INDEX IF NOT EXISTS idx_post_approvals_token
  ON post_approvals(token);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE workflow_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_approvals ENABLE ROW LEVEL SECURITY;

-- Workspace members full access on their conta
DROP POLICY IF EXISTS "workspace_posts_all" ON workflow_posts;
CREATE POLICY "workspace_posts_all" ON workflow_posts
  FOR ALL USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

-- post_approvals: workspace members on their workflows
DROP POLICY IF EXISTS "workspace_post_approvals_all" ON post_approvals;
CREATE POLICY "workspace_post_approvals_all" ON post_approvals
  FOR ALL USING (
    post_id IN (
      SELECT wp.id FROM workflow_posts wp
      WHERE wp.conta_id IN (SELECT public.get_my_conta_id())
    )
  );

-- Service role bypass (edge functions)
DROP POLICY IF EXISTS "service_role_bypass_posts" ON workflow_posts;
CREATE POLICY "service_role_bypass_posts" ON workflow_posts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_bypass_post_approvals" ON post_approvals;
CREATE POLICY "service_role_bypass_post_approvals" ON post_approvals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
