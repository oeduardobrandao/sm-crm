-- supabase/migrations/20261003000001_report_image_block.sql
-- Bloco "Imagem" no relatório de blocos (spec 2026-10-02).
-- 1. validate_report_layout: regras do config de image (+ invariante de modelo).
-- 2. report_document_files: vínculo relatório->arquivo com FKs compostas por
--    conta_id, mantido por trigger; sobe/desce files.reference_count.
-- 3. storage_autoclean_candidates: não seleciona arquivo usado em relatório.

-- ---------- 1. validação ----------
CREATE OR REPLACE FUNCTION report_image_config_ok(p_cfg jsonb, p_is_template boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- coalesce: IN/->> sobre chave ausente ou null JSON dá NULL; o resultado tem
  -- de ser um boolean estrito (NULL num OR do trigger seria tratado como aceito).
  SELECT coalesce(CASE
    WHEN p_cfg IS NULL THEN true
    WHEN jsonb_typeof(p_cfg) <> 'object' THEN false
    ELSE
      NOT (p_cfg ? 'src') AND NOT (p_cfg ? 'r2_key')
      AND (NOT (p_cfg ? 'ratio') OR p_cfg ->> 'ratio' IN
           ('original','16:9','3:2','4:3','1:1','4:5','3:4','2:3','9:16'))
      AND (NOT (p_cfg ? 'fit') OR p_cfg ->> 'fit' IN ('cover','contain'))
      AND (NOT (p_cfg ? 'focal') OR (
            jsonb_typeof(p_cfg -> 'focal') = 'object'
            AND (p_cfg -> 'focal' -> 'x') IN ('0'::jsonb, '0.5'::jsonb, '1'::jsonb)
            AND (p_cfg -> 'focal' -> 'y') IN ('0'::jsonb, '0.5'::jsonb, '1'::jsonb)))
      AND (NOT (p_cfg ? 'file_id') OR (jsonb_typeof(p_cfg -> 'file_id') = 'number'
            AND (p_cfg ->> 'file_id') ~ '^[1-9][0-9]{0,17}$'))
      AND (NOT (p_cfg ? 'width') OR (jsonb_typeof(p_cfg -> 'width') = 'number'
            AND (p_cfg ->> 'width') ~ '^[1-9][0-9]{0,5}$'))
      AND (NOT (p_cfg ? 'height') OR (jsonb_typeof(p_cfg -> 'height') = 'number'
            AND (p_cfg ->> 'height') ~ '^[1-9][0-9]{0,5}$'))
      AND (NOT (p_cfg ? 'file_id') OR ((p_cfg ? 'width') AND (p_cfg ? 'height')))
      AND (NOT (p_cfg ? 'caption') OR (jsonb_typeof(p_cfg -> 'caption') = 'string'
            AND char_length(p_cfg ->> 'caption') <= 200))
      AND (NOT (p_cfg ? 'alt') OR (jsonb_typeof(p_cfg -> 'alt') = 'string'
            AND char_length(p_cfg ->> 'alt') <= 300))
      AND (NOT p_is_template OR NOT (p_cfg ?| ARRAY['file_id','width','height','caption','alt']))
  END, false)
$$;

-- Recria a função inteira preservando o corpo da 20260825000001 (a última
-- definição) e acrescentando só a condição de image ao EXISTS que valida
-- cada bloco.
CREATE OR REPLACE FUNCTION validate_report_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layout IS NULL
     OR jsonb_typeof(NEW.layout) <> 'object'
     OR (NEW.layout -> 'version') IS DISTINCT FROM to_jsonb(1)
     OR jsonb_typeof(NEW.layout -> 'blocks') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.layout -> 'blocks') > 200 THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- accent, quando presente, é string #rrggbb exata.
  IF NEW.layout ? 'accent' AND (
       jsonb_typeof(NEW.layout -> 'accent') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'accent' !~ '^#[0-9a-fA-F]{6}$'
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- theme/fonts, quando presentes, sao strings dos enums fechados.
  IF NEW.layout ? 'theme' AND (
       jsonb_typeof(NEW.layout -> 'theme') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'theme' NOT IN ('clean', 'editorial', 'bold', 'hub')
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'fonts' AND (
       jsonb_typeof(NEW.layout -> 'fonts') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'fonts' NOT IN ('system', 'fraunces', 'grotesk', 'playfair')
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
    WHERE jsonb_typeof(b) <> 'object'
       OR jsonb_typeof(b -> 'id') IS DISTINCT FROM 'string'
       OR b ->> 'id' = ''
       OR jsonb_typeof(b -> 'type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(b -> 'size') IS DISTINCT FROM 'string'
       OR b ->> 'size' NOT IN ('third', 'half', 'full')
       -- text só nos tipos textuais (subset estável; espelha TEXT_BLOCK_TYPES)
       OR (b ? 'text' AND b ->> 'type' NOT IN
           ('text', 'ai_summary', 'ai_recommendations', 'ai_goals'))
       -- capa é sempre largura cheia (spec 2026-08-25): pagina inteira nao faz
       -- sentido em largura parcial.
       OR (b ->> 'type' = 'cover' AND b ->> 'size' <> 'full')
       -- imagem (spec 2026-10-02): config válido; em modelo, sem conteúdo.
       OR (b ->> 'type' = 'image'
           AND report_image_config_ok(b -> 'config', TG_TABLE_NAME = 'report_templates')
               IS NOT TRUE)
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- id duplicado
  IF (SELECT count(*) <> count(DISTINCT b ->> 'id')
        FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  RETURN NEW;
END $$;

-- ---------- 2. vínculo ----------
ALTER TABLE report_documents
  ADD CONSTRAINT report_documents_id_conta_uq UNIQUE (id, conta_id);

CREATE TABLE report_document_files (
  report_id  uuid   NOT NULL,
  file_id    bigint NOT NULL,
  conta_id   uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, file_id),
  CONSTRAINT report_document_files_report_fk FOREIGN KEY (report_id, conta_id)
    REFERENCES report_documents (id, conta_id) ON DELETE CASCADE,
  -- Arquivo em uso não sai (como post_file_links.file_id). NO ACTION e não
  -- RESTRICT: na exclusão do workspace, workspaces->files e
  -- workspaces->report_documents->report_document_files cascateiam no mesmo
  -- statement; RESTRICT checa por linha (e falharia se files cascateasse
  -- antes), NO ACTION checa no fim do statement, depois de todas as cascatas.
  CONSTRAINT report_document_files_file_fk FOREIGN KEY (file_id, conta_id)
    REFERENCES files (id, conta_id) ON DELETE NO ACTION
);
CREATE INDEX report_document_files_file_idx ON report_document_files (file_id);

ALTER TABLE report_document_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_document_files_tenant_select ON report_document_files
  FOR SELECT TO authenticated USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY report_document_files_service_role_bypass ON report_document_files
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Privilégios explícitos por role: REVOKE FROM PUBLIC não tira anon/authenticated.
REVOKE ALL ON report_document_files FROM PUBLIC;
REVOKE ALL ON report_document_files FROM anon;
REVOKE ALL ON report_document_files FROM authenticated;
GRANT SELECT ON report_document_files TO authenticated;
GRANT ALL ON report_document_files TO service_role;

CREATE TRIGGER trg_report_document_files_ref_count_ins
  AFTER INSERT ON report_document_files
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();
CREATE TRIGGER trg_report_document_files_ref_count_del
  AFTER DELETE ON report_document_files
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();

-- Diff do layout -> vínculos. Só arquivos do MESMO workspace, imagem, e em
-- JPEG/PNG/WebP (o backend aceita GIF como kind='image'). Roda depois do
-- validate_report_layout (BEFORE), então file_id já é inteiro positivo.
CREATE OR REPLACE FUNCTION report_document_files_sync() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT f.id), '{}')
    INTO v_ids
    FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
    JOIN files f
      ON f.id = (b -> 'config' ->> 'file_id')::bigint
   WHERE b ->> 'type' = 'image'
     AND jsonb_typeof(b -> 'config' -> 'file_id') = 'number'
     AND f.conta_id = NEW.conta_id
     AND f.kind = 'image'
     AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp');

  DELETE FROM report_document_files
   WHERE report_id = NEW.id
     AND NOT (file_id = ANY (v_ids));

  INSERT INTO report_document_files (report_id, file_id, conta_id)
  SELECT NEW.id, x, NEW.conta_id FROM unnest(v_ids) AS x
  ON CONFLICT DO NOTHING;

  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION report_document_files_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION report_document_files_sync() FROM anon;
REVOKE ALL ON FUNCTION report_document_files_sync() FROM authenticated;

CREATE TRIGGER trg_report_document_files_sync
  AFTER INSERT OR UPDATE OF layout ON report_documents
  FOR EACH ROW EXECUTE FUNCTION report_document_files_sync();

-- ---------- 2b. órfão de ideia ----------
-- ideia_file_cleanup_orphan (20260626000001) apaga o arquivo quando some o
-- último vínculo de ideia/post. Com a FK NO ACTION de report_document_files,
-- apagar um arquivo ainda usado em relatório abortaria a remoção da ideia ou do
-- anexo; o guard passa a incluir o vínculo de relatório. Corpo idêntico ao
-- original, só o NOT EXISTS novo; ganha search_path fixo (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION ideia_file_cleanup_orphan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ideia_files     WHERE file_id = OLD.file_id)
     AND NOT EXISTS (SELECT 1 FROM post_file_links WHERE file_id = OLD.file_id)
     AND NOT EXISTS (SELECT 1 FROM report_document_files WHERE file_id = OLD.file_id) THEN
    DELETE FROM files WHERE id = OLD.file_id;
  END IF;
  RETURN OLD;
END;
$$;

-- ---------- 3. autoclean ----------
-- Só o predicado compartilhado muda: storage_autoclean_run reavalia este
-- predicado sob FOR UPDATE nos candidatos, e inserir em report_document_files
-- toma FOR KEY SHARE na linha de files (checagem da FK), então nenhum vínculo
-- de relatório aparece entre a reavaliação e o DELETE final. CREATE OR REPLACE
-- preserva os GRANTs de 20260811000002.
CREATE OR REPLACE FUNCTION storage_autoclean_candidates(p_workspace uuid, p_cutoff timestamptz)
RETURNS TABLE(file_id bigint, size_bytes bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT f.id, f.size_bytes
    FROM files f
   WHERE f.conta_id = p_workspace
     AND EXISTS (
       SELECT 1 FROM post_file_links pfl WHERE pfl.file_id = f.id)
     AND NOT EXISTS (
       SELECT 1
         FROM post_file_links pfl
         JOIN workflow_posts wp ON wp.id = pfl.post_id
        WHERE pfl.file_id = f.id
          AND (pfl.conta_id <> p_workspace
               OR wp.conta_id <> p_workspace
               OR wp.status <> 'postado'
               OR wp.published_at IS NULL
               OR wp.published_at > p_cutoff))
     AND NOT EXISTS (
       SELECT 1 FROM ideia_files idf WHERE idf.file_id = f.id)
     AND NOT EXISTS (
       SELECT 1 FROM hub_brand hb WHERE hb.logo_file_id = f.id)
     AND NOT EXISTS (
       SELECT 1 FROM report_document_files rdf WHERE rdf.file_id = f.id)
$$;
