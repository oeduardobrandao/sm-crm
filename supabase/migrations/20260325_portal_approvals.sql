-- Add tipo column to workflow_etapas for distinguishing approval steps
ALTER TABLE workflow_etapas
  ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'padrao'
  CHECK (tipo IN ('padrao', 'aprovacao_cliente'));

-- Table to store client approval actions and comments from the portal
CREATE TABLE IF NOT EXISTS portal_approvals (
  id bigserial PRIMARY KEY,
  workflow_etapa_id bigint NOT NULL REFERENCES workflow_etapas(id) ON DELETE CASCADE,
  token text NOT NULL,
  action text NOT NULL CHECK (action IN ('aprovado', 'correcao')),
  comentario text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_approvals_etapa ON portal_approvals(workflow_etapa_id);
