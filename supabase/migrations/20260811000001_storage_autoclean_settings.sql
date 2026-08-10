-- =====================================================================
-- 20260811000001_storage_autoclean_settings.sql
-- Auto-limpeza de armazenamento: colunas de política + marcador de post +
-- guard owner-only. Spec: docs/superpowers/specs/2026-08-10-storage-autoclean-design.md
-- =====================================================================

-- ---------- workspaces: política (padrão da casa: colunas tipadas + CHECKs
-- nomeados, cf. 20260731000001_hub_branding_columns.sql) -------------------
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS storage_autoclean_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storage_autoclean_delay_days    int     NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS storage_autoclean_threshold_pct int,
  -- Últimos resultados, escritos SÓ pelo executor (storage_autoclean_run).
  ADD COLUMN IF NOT EXISTS storage_autoclean_last_run_at   timestamptz,
  ADD COLUMN IF NOT EXISTS storage_autoclean_last_files    int,
  ADD COLUMN IF NOT EXISTS storage_autoclean_last_bytes    bigint;

DO $$ BEGIN
  ALTER TABLE workspaces
    ADD CONSTRAINT storage_autoclean_delay_days_allowed
      CHECK (storage_autoclean_delay_days BETWEEN 0 AND 365);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE workspaces
    ADD CONSTRAINT storage_autoclean_threshold_pct_allowed
      CHECK (storage_autoclean_threshold_pct IS NULL
             OR storage_autoclean_threshold_pct BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- workflow_posts: marcador do placeholder -----------------------
-- Distingue "mídia removida pela auto-limpeza" de "post nunca teve mídia";
-- o CRM e o Hub usam isso para renderizar "Mídia removida para liberar espaço"
-- com o link da publicação.
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS media_autocleaned_at timestamptz;

-- ---------- Índices para o predicado de candidatos ------------------------
-- Não existia índice liderado por file_id em nenhuma das duas tabelas; além do
-- predicado da auto-limpeza, isso acelera as checagens da FK RESTRICT em
-- post_file_links a cada DELETE de files.
CREATE INDEX IF NOT EXISTS post_file_links_file_idx ON post_file_links (file_id);
CREATE INDEX IF NOT EXISTS ideia_files_file_idx     ON ideia_files (file_id);

-- ---------- Guard owner-only para as colunas de política ------------------
-- A RLS de workspaces (ws_update_owner_admin, 20260322) permite UPDATE a owner
-- OU admin e é row-level: RLS não compara OLD/NEW, então a restrição por coluna
-- precisa de trigger. auth.uid() IS NULL (service_role, funções definer, SQL
-- editor) passa direto; as colunas storage_autoclean_last_* ficam
-- deliberadamente fora do guard (o executor escreve nelas via service role de
-- qualquer forma).
CREATE OR REPLACE FUNCTION workspaces_guard_storage_autoclean()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.storage_autoclean_enabled       IS DISTINCT FROM OLD.storage_autoclean_enabled
   OR NEW.storage_autoclean_delay_days    IS DISTINCT FROM OLD.storage_autoclean_delay_days
   OR NEW.storage_autoclean_threshold_pct IS DISTINCT FROM OLD.storage_autoclean_threshold_pct)
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM workspace_members
        WHERE workspace_id = NEW.id
          AND user_id = auth.uid()
          AND role = 'owner')
  THEN
    RAISE EXCEPTION 'only_owner_can_change_storage_autoclean' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspaces_guard_storage_autoclean ON workspaces;
CREATE TRIGGER trg_workspaces_guard_storage_autoclean
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION workspaces_guard_storage_autoclean();
