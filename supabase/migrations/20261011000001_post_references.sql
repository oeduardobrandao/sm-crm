-- supabase/migrations/20261011000001_post_references.sql
-- Referências do cliente no post (spec
-- docs/superpowers/specs/2026-10-08-client-post-references-design.md).
--
-- 1. files.attached_to + stream_status 'skipped' (+ 1b. bulk_move_items ignora arquivo com dono)
-- 2. post_references (tabela, índices, RLS, grants)
-- 3. triggers: updated_at, reference_count, limpeza de órfão, guarda de vínculo
-- 4. post_reference_can_remove / post_reference_list
-- 5. RPCs de escrita do Hub (insert de arquivo e link, nota, remoção)
-- 6. notificação post_client_reference (CHECKs + RPC com coalescência de 15 min)
--
-- Forward-only: um rollback mantém a CHECK expandida de stream_status enquanto
-- existir vídeo de referência (ver "Rollout" no spec).

-- =====================================================================
-- 1. files
-- =====================================================================
-- Arquivo de referência pertence ao post, não ao gerenciador de Arquivos.
-- file-manage filtra attached_to IS NULL na raiz.
ALTER TABLE files ADD COLUMN attached_to text
  CONSTRAINT files_attached_to_check CHECK (attached_to IN ('post_reference'));

COMMENT ON COLUMN files.attached_to IS
  'Dono do arquivo fora do gerenciador de Arquivos. post_reference = anexo do cliente em post_references; nunca listado em Arquivos.';

-- 'skipped' = vídeo que nunca vai para o Cloudflare Stream (referências).
-- A ingest do post-media-cleanup-cron só pega stream_status NULL/'pending'
-- (stream-steps.ts), o settle e o webhook só 'pending'; todo leitor de
-- playback testa === 'ready' e cai para o R2. Nome da constraint: gerado
-- pelo CHECK inline de 20260814000002_stream_video_playback.sql.
ALTER TABLE files DROP CONSTRAINT files_stream_status_check;
ALTER TABLE files ADD CONSTRAINT files_stream_status_check
  CHECK (stream_status IN ('pending', 'ready', 'error', 'skipped'));

-- 1b. bulk_move_items não move arquivo com dono (attached_to). Corpo
-- idêntico ao de 20260501000001_bulk_move_items_rpc.sql (a única definição;
-- 20260925000001 só trocou os grants), mais o predicado attached_to IS NULL
-- na validação (arquivo de referência conta como "não encontrado") e no
-- UPDATE. CREATE OR REPLACE preserva o ACL; o REVOKE/GRANT abaixo repete o
-- de 20260925000001:131-132 só para deixar explícito.
CREATE OR REPLACE FUNCTION bulk_move_items(
  p_conta_id uuid,
  p_file_ids bigint[],
  p_folder_ids bigint[],
  p_destination_id bigint DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_file_count int;
  v_folder_count int;
  v_folder_id bigint;
  v_ancestors bigint[];
BEGIN
  -- Validate all files belong to conta_id
  IF coalesce(array_length(p_file_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_file_count
    FROM files
    WHERE id = ANY(p_file_ids) AND conta_id = p_conta_id AND attached_to IS NULL;

    IF v_file_count <> array_length(p_file_ids, 1) THEN
      RETURN json_build_object('error', 'Some files not found or not owned', 'code', 'invalid_files');
    END IF;
  END IF;

  -- Validate all folders belong to conta_id and are not system folders
  IF coalesce(array_length(p_folder_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_folder_count
    FROM folders
    WHERE id = ANY(p_folder_ids) AND conta_id = p_conta_id AND source = 'user';

    IF v_folder_count <> array_length(p_folder_ids, 1) THEN
      RETURN json_build_object('error', 'Some folders not found, not owned, or are system folders', 'code', 'invalid_folders');
    END IF;
  END IF;

  -- Validate destination exists and belongs to conta_id (if not null / root)
  IF p_destination_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM folders WHERE id = p_destination_id AND conta_id = p_conta_id) THEN
      RETURN json_build_object('error', 'Destination folder not found', 'code', 'invalid_destination');
    END IF;

    -- Check destination is not a post system folder when moving folders
    IF array_length(p_folder_ids, 1) > 0 THEN
      IF EXISTS (SELECT 1 FROM folders WHERE id = p_destination_id AND source = 'system' AND source_type = 'post') THEN
        RETURN json_build_object('error', 'Cannot move folders into post folders', 'code', 'post_folder_restriction');
      END IF;
    END IF;

    -- Check no folder is being moved into itself or a descendant
    FOREACH v_folder_id IN ARRAY p_folder_ids LOOP
      -- Build ancestor chain from destination up to root
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM folders WHERE id = p_destination_id
        UNION ALL
        SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
      )
      SELECT array_agg(id) INTO v_ancestors FROM ancestors;

      IF v_folder_id = ANY(v_ancestors) THEN
        RETURN json_build_object(
          'error', 'Cannot move folder into itself or a descendant',
          'code', 'cycle_detected',
          'folder_id', v_folder_id
        );
      END IF;
    END LOOP;
  END IF;

  -- Perform the moves
  IF array_length(p_file_ids, 1) > 0 THEN
    UPDATE files SET folder_id = p_destination_id
     WHERE id = ANY(p_file_ids) AND conta_id = p_conta_id AND attached_to IS NULL;
  END IF;

  IF coalesce(array_length(p_folder_ids, 1), 0) > 0 THEN
    UPDATE folders SET parent_id = p_destination_id, updated_at = now() WHERE id = ANY(p_folder_ids) AND conta_id = p_conta_id;
  END IF;

  RETURN json_build_object('ok', true, 'files_moved', coalesce(array_length(p_file_ids, 1), 0), 'folders_moved', coalesce(array_length(p_folder_ids, 1), 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION bulk_move_items(uuid, bigint[], bigint[], bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION bulk_move_items(uuid, bigint[], bigint[], bigint) TO service_role;

-- =====================================================================
-- 2. post_references
-- =====================================================================
CREATE TABLE post_references (
  id               bigserial PRIMARY KEY,
  post_id          bigint NOT NULL,
  conta_id         uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind             text   NOT NULL CHECK (kind IN ('file', 'link')),
  file_id          bigint,
  url              text,
  link_title       text CHECK (link_title IS NULL OR char_length(link_title) <= 120),
  note             text CHECK (note IS NULL OR char_length(note) <= 500),
  post_approval_id bigint REFERENCES post_approvals(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- FKs compostas: post e arquivo presos ao workspace da própria linha
  -- (workflow_posts_id_conta_uq 20260820000002, files_id_conta_uq 20260626000001).
  CONSTRAINT post_references_post_fk
    FOREIGN KEY (post_id, conta_id) REFERENCES workflow_posts(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_references_file_fk
    FOREIGN KEY (file_id, conta_id) REFERENCES files(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_references_shape CHECK (
    (kind = 'file' AND file_id IS NOT NULL AND url IS NULL AND link_title IS NULL) OR
    (kind = 'link' AND file_id IS NULL AND url IS NOT NULL)),
  -- Rede de segurança grosseira (esquema, host não vazio, sem user:pass@,
  -- sem espaço/controle, tamanho). A política autoritativa é do handler.
  CONSTRAINT post_references_url_shape CHECK (
    url IS NULL OR (
      char_length(url) <= 2048
      AND url ~* '^https?://[^/?#@[:space:]]+([/?#]|$)'
      AND url !~ '[[:space:][:cntrl:]]'))
);

CREATE INDEX post_references_post_idx ON post_references (post_id, created_at);
CREATE UNIQUE INDEX post_references_file_uq ON post_references (file_id) WHERE file_id IS NOT NULL;
CREATE INDEX post_references_approval_idx ON post_references (post_approval_id)
  WHERE post_approval_id IS NOT NULL;
-- FK composta de conta_id -> workspaces e a exclusão de workspace em cascata.
CREATE INDEX post_references_conta_idx ON post_references (conta_id);

ALTER TABLE post_references ENABLE ROW LEVEL SECURITY;

-- O CRM lê só a contagem (badge do drawer). Toda escrita passa por edge
-- function com service role: nenhuma policy de escrita para authenticated.
CREATE POLICY post_references_tenant_select ON post_references
  FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY post_references_service_role_bypass ON post_references
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Hosted default ACLs dão ALL em tabela nova para anon/authenticated:
-- revoga explicitamente e devolve só SELECT.
REVOKE ALL ON post_references FROM PUBLIC, anon, authenticated;
GRANT SELECT ON post_references TO authenticated;
GRANT ALL ON post_references TO service_role;
REVOKE ALL ON SEQUENCE post_references_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE post_references_id_seq TO service_role;

-- =====================================================================
-- 3. triggers
-- =====================================================================
CREATE OR REPLACE FUNCTION set_post_references_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION set_post_references_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER post_references_updated_at
  BEFORE UPDATE ON post_references
  FOR EACH ROW EXECUTE FUNCTION set_post_references_updated_at();

-- reference_count: reaproveita file_update_reference_count()
-- (20260425000002), que lê NEW/OLD.file_id. Links não têm arquivo: o WHEN
-- evita o UPDATE inútil.
CREATE TRIGGER trg_post_reference_ref_count_ins
  AFTER INSERT ON post_references
  FOR EACH ROW WHEN (NEW.file_id IS NOT NULL)
  EXECUTE FUNCTION file_update_reference_count();
CREATE TRIGGER trg_post_reference_ref_count_del
  AFTER DELETE ON post_references
  FOR EACH ROW WHEN (OLD.file_id IS NOT NULL)
  EXECUTE FUNCTION file_update_reference_count();

-- Último vínculo some -> apaga o files, o que dispara file_enqueue_delete
-- (R2) e file_update_used_bytes (devolve a cota). Mesmo modelo de
-- ideia_file_cleanup_orphan (corpo mais recente em 20261003000001), checando
-- os quatro vínculos direto (independente da ordem dos triggers). Invariante:
-- arquivo de referência (files.attached_to) nunca é vinculado em outra tabela,
-- por isso ideia_file_cleanup_orphan e storage_autoclean_candidates não mudam.
-- A invariante é imposta no banco pelo trigger reference_file_not_linkable
-- (logo abaixo) nas quatro tabelas de vínculo: sem ele, post_file_link_replace
-- (que aceita qualquer arquivo do workspace) poderia pôr uma referência num
-- post, o autoclean a apagaria após a publicação e o ON DELETE CASCADE de
-- post_references_file_fk removeria em silêncio a referência do cliente.
CREATE OR REPLACE FUNCTION post_reference_cleanup_orphan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM post_references       WHERE file_id = OLD.file_id)
     AND NOT EXISTS (SELECT 1 FROM ideia_files           WHERE file_id = OLD.file_id)
     AND NOT EXISTS (SELECT 1 FROM post_file_links       WHERE file_id = OLD.file_id)
     AND NOT EXISTS (SELECT 1 FROM report_document_files WHERE file_id = OLD.file_id) THEN
    DELETE FROM files WHERE id = OLD.file_id;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION post_reference_cleanup_orphan() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_post_reference_cleanup_orphan
  AFTER DELETE ON post_references
  FOR EACH ROW WHEN (OLD.file_id IS NOT NULL)
  EXECUTE FUNCTION post_reference_cleanup_orphan();

-- Guarda da invariante acima. SECURITY DEFINER para ler files independente de
-- RLS/grants de quem escreve o vínculo. O nome da coluna do arquivo vem em
-- TG_ARGV[0] (file_id, ou logo_file_id em hub_brand); NULL passa.
CREATE OR REPLACE FUNCTION reference_file_not_linkable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_file_id bigint := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::bigint;
BEGIN
  IF v_file_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM files f WHERE f.id = v_file_id AND f.attached_to IS NOT NULL) THEN
    RAISE EXCEPTION 'reference_file_not_linkable' USING errcode = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION reference_file_not_linkable() FROM PUBLIC, anon, authenticated;

-- Mesmas tabelas que storage_autoclean_candidates consulta (+ post_references
-- fica de fora de propósito: é a dona do arquivo).
CREATE TRIGGER trg_post_file_links_reference_file_guard
  BEFORE INSERT OR UPDATE OF file_id ON post_file_links
  FOR EACH ROW EXECUTE FUNCTION reference_file_not_linkable('file_id');
CREATE TRIGGER trg_ideia_files_reference_file_guard
  BEFORE INSERT OR UPDATE OF file_id ON ideia_files
  FOR EACH ROW EXECUTE FUNCTION reference_file_not_linkable('file_id');
CREATE TRIGGER trg_report_document_files_reference_file_guard
  BEFORE INSERT OR UPDATE OF file_id ON report_document_files
  FOR EACH ROW EXECUTE FUNCTION reference_file_not_linkable('file_id');
CREATE TRIGGER trg_hub_brand_reference_file_guard
  BEFORE INSERT OR UPDATE OF logo_file_id ON hub_brand
  FOR EACH ROW EXECUTE FUNCTION reference_file_not_linkable('logo_file_id');

-- =====================================================================
-- 4. leitura
-- =====================================================================
-- Decisão 2 do spec: o cliente remove/edita enquanto o post espera aprovação
-- E a equipe não agiu depois da referência:
--   - nenhuma resposta da equipe (post_approvals.is_workspace_user) depois;
--   - nenhum evento de status fora do cliente (reenvio da equipe, sistema)
--     depois. Isso trava as referências da rodada 1 quando a equipe manda
--     uma versão nova de volta para enviado_cliente.
-- post_approvals.created_at é nullable: linha com NULL nunca trava
-- (NULL > x é NULL, o NOT EXISTS não a conta).
CREATE OR REPLACE FUNCTION post_reference_can_remove(p_ref_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM post_references r
      JOIN workflow_posts wp ON wp.id = r.post_id AND wp.conta_id = r.conta_id
     WHERE r.id = p_ref_id
       AND wp.status = 'enviado_cliente'
       AND NOT EXISTS (
         SELECT 1 FROM post_approvals pa
          WHERE pa.post_id = r.post_id
            AND pa.is_workspace_user = true
            AND pa.created_at > r.created_at)
       AND NOT EXISTS (
         SELECT 1 FROM post_status_events e
          WHERE e.post_id = r.post_id
            AND e.source <> 'client'
            AND e.created_at > r.created_at)
  );
$$;
REVOKE ALL ON FUNCTION post_reference_can_remove(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_can_remove(bigint) TO service_role;

-- Lista do post com os campos do arquivo (LEFT JOIN: links não têm).
-- Ownership do post é checada pelo handler; p_conta é a defesa extra.
CREATE OR REPLACE FUNCTION post_reference_list(p_post_id bigint, p_conta uuid)
RETURNS TABLE (
  id bigint, kind text, file_id bigint, url text, link_title text, note text,
  post_approval_id bigint, created_at timestamptz, can_remove boolean,
  name text, mime_type text, file_kind text, size_bytes bigint, width int, height int,
  duration_seconds int, r2_key text, thumbnail_r2_key text, blur_data_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.kind, r.file_id, r.url, r.link_title, r.note,
         r.post_approval_id, r.created_at, post_reference_can_remove(r.id),
         f.name, f.mime_type, f.kind, f.size_bytes, f.width, f.height,
         f.duration_seconds, f.r2_key, f.thumbnail_r2_key, f.blur_data_url
    FROM post_references r
    LEFT JOIN files f ON f.id = r.file_id AND f.conta_id = r.conta_id
   WHERE r.post_id = p_post_id
     AND r.conta_id = p_conta
   ORDER BY r.created_at, r.id;
$$;
REVOKE ALL ON FUNCTION post_reference_list(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_list(bigint, uuid) TO service_role;

-- =====================================================================
-- 5. escrita (Hub, service role)
-- =====================================================================
-- Finalize atômico de arquivo: trava o post (dono = token), gate de status,
-- limite de 10, cota, files + referência, cobra a cota. Cota igual a
-- ideia_file_insert_with_quota (20260626000001): cobra só size_bytes,
-- simétrico ao reembolso de file_update_used_bytes; NULL = ilimitado.
CREATE OR REPLACE FUNCTION post_reference_file_insert(p jsonb)
RETURNS post_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid   := (p->>'conta_id')::uuid;
  v_cliente bigint := NULLIF(p->>'cliente_id', '')::bigint;
  v_post    bigint := (p->>'post_id')::bigint;
  v_size    bigint := (p->>'size_bytes')::bigint;
  v_kind    text   := p->>'file_kind';
  v_key     text   := NULLIF(p->>'r2_key', '');
  v_thumb   text   := NULLIF(p->>'thumbnail_r2_key', '');
  v_status  text;
  v_count   int;
  v_quota   bigint;
  v_used    bigint;
  v_file    files;
  v_row     post_references;
BEGIN
  -- 1. Trava o post: confere workspace + cliente do token E serializa
  --    finalizes concorrentes (limite race-safe). Mesmo lock que
  --    record_client_approval e as mudanças de status da equipe tomam.
  SELECT wp.status INTO v_status
    FROM workflow_posts wp
   WHERE wp.id = v_post AND wp.conta_id = v_conta AND wp.cliente_id = v_cliente
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING errcode = 'P0001'; END IF;
  IF v_status <> 'enviado_cliente' THEN
    RAISE EXCEPTION 'post_not_pending' USING errcode = 'P0001';
  END IF;

  -- 2. Limite (arquivos + links), serializado pelo lock acima.
  SELECT count(*) INTO v_count FROM post_references r WHERE r.post_id = v_post;
  IF v_count >= 10 THEN RAISE EXCEPTION 'reference_limit' USING errcode = 'P0001'; END IF;

  -- 2b. Chave nova de verdade. files.r2_key não é UNIQUE: sem isto um
  --     cliente do Hub finalizaria uma referência sobre a chave de uma
  --     mídia existente (de qualquer workspace), e o trigger de órfão
  --     apagaria depois o objeto dela no R2. Vale para as duas chaves, nas
  --     duas colunas (files_r2_key_idx, files_thumbnail_r2_key_idx).
  IF v_key IS NULL OR v_key = v_thumb OR EXISTS (
       SELECT 1 FROM files f
        WHERE f.r2_key = v_key OR f.thumbnail_r2_key = v_key
           OR f.r2_key = v_thumb OR f.thumbnail_r2_key = v_thumb) THEN
    RAISE EXCEPTION 'upload_mismatch' USING errcode = 'P0001';
  END IF;

  -- 3. Cota do plano. Trava a linha do workspace para ler used_bytes.
  SELECT w.storage_used_bytes INTO v_used FROM workspaces w WHERE w.id = v_conta FOR UPDATE;
  v_quota := effective_plan_limit(v_conta, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND COALESCE(v_used, 0) + v_size > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded' USING errcode = 'P0001';
  END IF;

  -- 4. Arquivo: fora de pastas, dono = referência, sem uploader (Hub).
  --    Vídeo nunca vai para o Stream (decisão 3).
  INSERT INTO files (
    conta_id, folder_id, r2_key, thumbnail_r2_key, name, kind, mime_type,
    size_bytes, width, height, duration_seconds, blur_data_url, uploaded_by,
    attached_to, stream_status
  ) VALUES (
    v_conta, NULL, v_key, v_thumb,
    p->>'name', v_kind, p->>'mime_type', v_size,
    NULLIF(p->>'width', '')::int, NULLIF(p->>'height', '')::int,
    NULLIF(p->>'duration_seconds', '')::int,
    NULLIF(p->>'blur_data_url', ''), NULL,
    'post_reference', CASE WHEN v_kind = 'video' THEN 'skipped' END
  ) RETURNING * INTO v_file;

  -- 5. Referência (dispara o reference_count).
  INSERT INTO post_references (post_id, conta_id, kind, file_id, note)
  VALUES (v_post, v_conta, 'file', v_file.id, NULLIF(p->>'note', ''))
  RETURNING * INTO v_row;

  -- 6. Cobra a cota (só o arquivo, simétrico ao reembolso).
  UPDATE workspaces SET storage_used_bytes = storage_used_bytes + v_size
   WHERE id = v_conta;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION post_reference_file_insert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_file_insert(jsonb) TO service_role;

-- Link: mesmo lock, gate e limite. URL já validada pelo handler; a CHECK
-- post_references_url_shape é a rede de segurança.
CREATE OR REPLACE FUNCTION post_reference_link_insert(p jsonb)
RETURNS post_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid   := (p->>'conta_id')::uuid;
  v_cliente bigint := NULLIF(p->>'cliente_id', '')::bigint;
  v_post    bigint := (p->>'post_id')::bigint;
  v_status  text;
  v_count   int;
  v_row     post_references;
BEGIN
  SELECT wp.status INTO v_status
    FROM workflow_posts wp
   WHERE wp.id = v_post AND wp.conta_id = v_conta AND wp.cliente_id = v_cliente
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING errcode = 'P0001'; END IF;
  IF v_status <> 'enviado_cliente' THEN
    RAISE EXCEPTION 'post_not_pending' USING errcode = 'P0001';
  END IF;

  SELECT count(*) INTO v_count FROM post_references r WHERE r.post_id = v_post;
  IF v_count >= 10 THEN RAISE EXCEPTION 'reference_limit' USING errcode = 'P0001'; END IF;

  INSERT INTO post_references (post_id, conta_id, kind, url, link_title, note)
  VALUES (v_post, v_conta, 'link', p->>'url',
          NULLIF(p->>'link_title', ''), NULLIF(p->>'note', ''))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION post_reference_link_insert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_link_insert(jsonb) TO service_role;

-- Nota e remoção pelo cliente. Checagem e escrita sob o lock do post: uma
-- resposta ou reenvio da equipe em paralelo espera ou vence, nunca intercala.
-- 'not_found': referência inexistente ou de post de outro cliente/workspace.
-- 'locked': can_remove (decisão 2) falso.
CREATE OR REPLACE FUNCTION post_reference_client_update(
  p_id bigint, p_conta uuid, p_cliente bigint, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post bigint;
BEGIN
  SELECT r.post_id INTO v_post
    FROM post_references r
    JOIN workflow_posts wp ON wp.id = r.post_id AND wp.conta_id = r.conta_id
   WHERE r.id = p_id AND r.conta_id = p_conta AND wp.cliente_id = p_cliente;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  PERFORM 1 FROM workflow_posts wp WHERE wp.id = v_post FOR UPDATE;

  -- Pode ter sumido enquanto esperava o lock.
  IF NOT EXISTS (SELECT 1 FROM post_references r WHERE r.id = p_id) THEN
    RETURN 'not_found';
  END IF;
  IF NOT post_reference_can_remove(p_id) THEN RETURN 'locked'; END IF;

  UPDATE post_references SET note = NULLIF(p_note, '') WHERE id = p_id;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION post_reference_client_update(bigint, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_client_update(bigint, uuid, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION post_reference_client_delete(
  p_id bigint, p_conta uuid, p_cliente bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post bigint;
BEGIN
  SELECT r.post_id INTO v_post
    FROM post_references r
    JOIN workflow_posts wp ON wp.id = r.post_id AND wp.conta_id = r.conta_id
   WHERE r.id = p_id AND r.conta_id = p_conta AND wp.cliente_id = p_cliente;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  PERFORM 1 FROM workflow_posts wp WHERE wp.id = v_post FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM post_references r WHERE r.id = p_id) THEN
    RETURN 'not_found';
  END IF;
  IF NOT post_reference_can_remove(p_id) THEN RETURN 'locked'; END IF;

  -- Dispara reference_count e a limpeza de órfão (files -> R2 + cota).
  DELETE FROM post_references WHERE id = p_id;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION post_reference_client_delete(bigint, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_client_delete(bigint, uuid, bigint) TO service_role;

-- =====================================================================
-- 6. notificação post_client_reference
-- =====================================================================
-- Listas copiadas de 20261008000002_agenda_convidados.sql (a definição mais
-- recente), só ACRESCENTANDO post_client_reference. Fora das prefs de e-mail:
-- claim_notification_emails tem allowlist própria, nenhum e-mail sai. Este
-- arquivo passa a ser a definição mais recente: a próxima migration copia
-- DAQUI.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'instagram_connected_by_client',
    'post_publish_failed', 'storage_autoclean_report',
    'instagram_automation_failed',
    'event_invited', 'event_updated', 'event_cancelled', 'event_rsvp', 'event_reminder',
    'event_client_rsvp', 'event_reschedule_requested', 'event_guest_rsvp',
    'post_client_reference'
  )
);

ALTER TABLE public.notification_inapp_prefs DROP CONSTRAINT notification_inapp_prefs_type_check;
ALTER TABLE public.notification_inapp_prefs ADD CONSTRAINT notification_inapp_prefs_type_check CHECK (type IN (
  'post_approved','post_correction','post_message','post_edit_suggestion',
  'idea_submitted','briefing_answered','step_activated','step_completed',
  'post_assigned','task_assigned','workflow_completed','deadline_approaching',
  'invite_accepted','member_role_changed','member_removed','client_message',
  'mention','post_status_automation','instagram_connected_by_client',
  'post_publish_failed','storage_autoclean_report','instagram_automation_failed',
  'event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
  'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
  'post_client_reference',
  '__all__'
));

-- Alvos e link iguais a create_edit_suggestion_notification (20260928150001,
-- que lê conta/cliente direto do post: funciona para post avulso).
-- Coalescência: pula o alvo que já tem uma post_client_reference não lida
-- (e não dispensada) do mesmo post criada nos últimos 15 minutos, então dez
-- envios seguidos geram uma notificação. insert_notification_batch não tem
-- dedupe; o advisory lock por post serializa chamadas concorrentes para que
-- duas não passem juntas pelo filtro.
CREATE OR REPLACE FUNCTION create_post_reference_notification(p_post_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_link           text;
  v_metadata       jsonb;
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo, wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('post_client_reference:' || p_post_id, 0));

  SELECT c.nome INTO v_client_name FROM clientes c WHERE c.id = v_cliente_id;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);

  SELECT array_agg(t) INTO v_targets
    FROM unnest(COALESCE(v_targets, '{}'::uuid[])) AS t
   WHERE t IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM notifications n
        WHERE n.user_id = t
          AND n.type = 'post_client_reference'
          AND n.read_at IS NULL
          AND n.dismissed_at IS NULL
          AND n.metadata->>'post_id' = p_post_id::text
          AND n.created_at > now() - interval '15 minutes');

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post_id
    ELSE '/entregas?drawer=' || v_workflow_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id
  );

  PERFORM insert_notification_batch(v_conta_id, v_targets, 'post_client_reference', v_link, v_metadata, NULL);

  RETURN array_length(v_targets, 1);
END;
$$;
REVOKE ALL ON FUNCTION create_post_reference_notification(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_post_reference_notification(bigint) TO service_role;
