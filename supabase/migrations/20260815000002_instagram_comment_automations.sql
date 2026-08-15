-- Automação de comentário -> DM no Instagram (núcleo ManyChat).
-- Spec: docs/superpowers/specs/2026-08-14-instagram-comment-dm-automation-design.md
-- Ship dark: a flag nasce false em todos os planos; effective_plan_feature lê
-- colunas dinamicamente, então só a coluna basta (padrão 20260721000001).

ALTER TABLE plans ADD COLUMN IF NOT EXISTS feature_instagram_automation boolean NOT NULL DEFAULT false;

-- Alvo para FK composta tenant-safe (padrão post_status_definitions_id_conta_uq,
-- 20260805000001). clientes.id já é PK; o par (id, conta_id) permite que tabelas
-- filhas amarrem client_id ao conta_id estruturalmente, não só via RLS.
ALTER TABLE clientes ADD CONSTRAINT clientes_id_conta_uq UNIQUE (id, conta_id);

CREATE TABLE instagram_comment_automations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id        bigint NOT NULL,
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- NULL = todos os posts da conta. Snapshot de permalink/caption para a UI
  -- não depender do sync dos últimos 50 posts (instagram_posts é incompleta).
  ig_media_id      text,
  media_permalink  text,
  media_caption    text,
  keywords         text[] NOT NULL CHECK (array_length(keywords, 1) >= 1),
  dm_message       text NOT NULL CHECK (char_length(dm_message) BETWEEN 1 AND 1000),
  public_reply     text CHECK (public_reply IS NULL OR char_length(public_reply) BETWEEN 1 AND 500),
  ativo            boolean NOT NULL DEFAULT true,
  dms_sent_count   int NOT NULL DEFAULT 0,
  last_triggered_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Par exportado para a FK composta de instagram_automation_sends (Task 2).
  CONSTRAINT ica_id_conta_uq UNIQUE (id, conta_id),
  -- Um bug do processador (service role, fora da RLS) não consegue apontar
  -- client_id para cliente de outro workspace.
  CONSTRAINT ica_client_same_tenant FOREIGN KEY (client_id, conta_id)
    REFERENCES clientes (id, conta_id) ON DELETE CASCADE
);

CREATE INDEX idx_ica_conta_ativo ON instagram_comment_automations (conta_id) WHERE ativo;
CREATE INDEX idx_ica_client_ativo ON instagram_comment_automations (client_id) WHERE ativo;

CREATE OR REPLACE FUNCTION set_instagram_comment_automations_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER instagram_comment_automations_updated_at
  BEFORE UPDATE ON instagram_comment_automations
  FOR EACH ROW EXECUTE FUNCTION set_instagram_comment_automations_updated_at();

-- Gate INSERT-only (política pós-downgrade da casa: existentes continuam
-- legíveis, tocáveis e executando; só criar novas é bloqueado).
CREATE TRIGGER trg_feature_instagram_automation
  BEFORE INSERT ON instagram_comment_automations
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_feature('feature_instagram_automation', 'direct', 'conta_id');

-- RLS. Desvio INTENCIONAL de post_status_automations (que restringe até o
-- SELECT a owner/admin): aqui agent LÊ para acompanhar resultados, sem mutar.
ALTER TABLE instagram_comment_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ica_select ON instagram_comment_automations
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY ica_insert ON instagram_comment_automations
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IN ('owner', 'admin')
  );

CREATE POLICY ica_update ON instagram_comment_automations
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IN ('owner', 'admin')
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IN ('owner', 'admin')
  );

CREATE POLICY ica_delete ON instagram_comment_automations
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IN ('owner', 'admin')
  );

CREATE POLICY service_role_bypass_ica ON instagram_comment_automations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
