-- Notas do admin por workspace, uma linha por nota (antes era um único texto em
-- workspace_plan_overrides.notes, que o último a salvar sobrescrevia inteiro).
-- Todo admin da plataforma lê todas as notas; só o platform-admin (service role) acessa a tabela.

CREATE TABLE IF NOT EXISTS admin_workspace_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- NULL quando o admin foi removido ou na nota migrada do texto antigo (autor desconhecido).
  author_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  -- Cópia do e-mail do autor, para a nota seguir assinada depois que o admin sai.
  author_email text,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_workspace_notes_workspace_idx
  ON admin_workspace_notes (workspace_id, created_at DESC);

ALTER TABLE admin_workspace_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_workspace_notes FROM PUBLIC, anon, authenticated;

-- Backfill: o texto antigo vira a primeira nota, sem autor (updated_by é de quem mexeu por
-- último nos overrides, não necessariamente de quem escreveu a nota). Idempotente: não repete
-- para workspace que já tem nota migrada.
INSERT INTO admin_workspace_notes (workspace_id, author_id, author_email, body, created_at)
SELECT o.workspace_id, NULL, NULL, left(btrim(o.notes), 5000), o.updated_at
FROM workspace_plan_overrides o
WHERE o.notes IS NOT NULL
  AND btrim(o.notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM admin_workspace_notes n
    WHERE n.workspace_id = o.workspace_id AND n.author_id IS NULL AND n.author_email IS NULL
  );

COMMENT ON COLUMN workspace_plan_overrides.notes IS
  'Legado: substituído por admin_workspace_notes (migration 20261128000001). Não é mais escrito pelo Admin.';
