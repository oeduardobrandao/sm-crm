-- Estúdio: posts in 'enviado_cliente' become design-eligible (create-attached / attach /
-- save / media application). Product rule (2026-07-06): the team often finishes or swaps
-- the art AFTER sending the post for client review — the design must keep updating the
-- post in place while it sits in the client's queue.
--
-- Semantics:
--   * 'enviado_cliente' joins the editable set in create_design, save_design_blob,
--     attach_design and finalize_design_render (media application + manifest rules
--     unchanged otherwise).
--   * The save-time status flip stays EXCLUSIVE to correcao_cliente → revisao_interna
--     (client-portal rule). Saving on an enviado_cliente post does NOT move the post —
--     it stays in the client's approval queue with the refreshed art.
--   * Locked set is unchanged: aprovado_cliente / agendado / publicado etc. still raise
--     read_only / post_not_editable.
--
-- Mirrors (change together): design-manage/handler.ts, design-render/{handler,index}.ts,
-- mcp/{queries,capabilities}.ts, apps/crm/src/pages/estudio/applyEligibility.ts.
-- Error strings are a contract with design-manage's mapDesignRpcError — unchanged here.

-- ============================================================
-- create_design — body identical to 20260705000001, editable list +enviado_cliente
-- ============================================================
CREATE OR REPLACE FUNCTION create_design(
  p_conta_id uuid, p_cliente_id bigint, p_post_id bigint, p_format text, p_name text,
  p_r2_key text, p_doc_hash text, p_doc_bytes int, p_created_by uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_cliente bigint := p_cliente_id;
  v_id bigint;
BEGIN
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = p_cliente_id AND conta_id = p_conta_id
  ) THEN
    RAISE EXCEPTION 'cliente_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_post_id IS NOT NULL THEN
    SELECT p.status, w.cliente_id INTO v_status, v_cliente
    FROM workflow_posts p JOIN workflows w ON w.id = p.workflow_id
    WHERE p.id = p_post_id AND p.conta_id = p_conta_id
    FOR UPDATE OF p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
    END IF;
    IF v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente', 'enviado_cliente') THEN
      RAISE EXCEPTION 'post_not_editable:%', v_status USING ERRCODE = 'P0001';
    END IF;
  END IF;

  BEGIN
    INSERT INTO designs (conta_id, cliente_id, post_id, name, format,
                         doc_r2_key, doc_hash, doc_bytes, created_by, updated_by)
    VALUES (p_conta_id, v_cliente, p_post_id, coalesce(p_name, 'Design sem título'), p_format,
            p_r2_key, p_doc_hash, p_doc_bytes, p_created_by, p_created_by)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'post_already_designed' USING ERRCODE = 'P0001';
  END;

  RETURN v_id;
END $$;

-- ============================================================
-- save_design_blob — editable list +enviado_cliente; the status flip remains
-- correcao_cliente-only (see header).
-- ============================================================
CREATE OR REPLACE FUNCTION save_design_blob(
  p_conta_id uuid, p_design_id bigint, p_expected_rev int, p_doc_hash text, p_r2_key text,
  p_doc_bytes int, p_editor_version text, p_updated_by uuid
) RETURNS TABLE (o_rev int, o_prev_r2_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_design designs%ROWTYPE;
  v_status text;
  v_new_rev int;
BEGIN
  SELECT * INTO v_design FROM designs
  WHERE id = p_design_id AND conta_id = p_conta_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_design.post_id IS NOT NULL THEN
    SELECT status INTO v_status
    FROM workflow_posts WHERE id = v_design.post_id AND conta_id = p_conta_id
    FOR UPDATE;
    IF FOUND AND v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente', 'enviado_cliente') THEN
      RAISE EXCEPTION 'read_only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_design.rev <> p_expected_rev THEN
    RAISE EXCEPTION 'rev_conflict' USING ERRCODE = 'P0001';
  END IF;

  UPDATE designs
     SET rev = rev + 1,
         doc_hash = p_doc_hash,
         doc_r2_key = p_r2_key,
         doc_bytes = p_doc_bytes,
         editor_version = p_editor_version,
         updated_by = p_updated_by,
         updated_at = now(),
         is_stale = true,
         render_status = 'pending',
         render_error = NULL,
         render_manifest = NULL
   WHERE id = p_design_id
  RETURNING rev INTO v_new_rev;

  IF v_status = 'correcao_cliente' THEN
    UPDATE workflow_posts SET status = 'revisao_interna'
    WHERE id = v_design.post_id AND conta_id = p_conta_id;
  END IF;

  RETURN QUERY SELECT v_new_rev, v_design.doc_r2_key;
END $$;

-- ============================================================
-- attach_design — editable list +enviado_cliente
-- ============================================================
CREATE OR REPLACE FUNCTION attach_design(
  p_conta_id uuid, p_design_id bigint, p_post_id bigint, p_updated_by uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_design_post_id bigint;
  v_status text;
  v_tipo text;
  v_cliente bigint;
BEGIN
  SELECT post_id INTO v_design_post_id FROM designs
  WHERE id = p_design_id AND conta_id = p_conta_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_design_post_id IS NOT NULL THEN
    RAISE EXCEPTION 'design_already_attached' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.status, p.tipo, w.cliente_id INTO v_status, v_tipo, v_cliente
  FROM workflow_posts p JOIN workflows w ON w.id = p.workflow_id
  WHERE p.id = p_post_id AND p.conta_id = p_conta_id
  FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente', 'enviado_cliente') THEN
    RAISE EXCEPTION 'post_not_editable:%', v_status USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE designs
       SET post_id = p_post_id,
           cliente_id = v_cliente,
           is_stale = true,
           render_status = 'pending',
           render_error = NULL,
           render_manifest = NULL,
           updated_by = p_updated_by,
           updated_at = now()
     WHERE id = p_design_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'post_already_designed' USING ERRCODE = 'P0001';
  END;

  RETURN v_tipo;
END $$;

-- ============================================================
-- finalize_design_render — media application now also runs on enviado_cliente
-- ============================================================
CREATE OR REPLACE FUNCTION finalize_design_render(
  p_design_id bigint, p_claimed_hash text, p_manifest jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_design designs%ROWTYPE;
  v_post_tipo text;
  v_post_status text;
  v_apply_media boolean := false;
  v_video record;
  v_old_thumb text;
  v_new_key text;
  v_old_link_ids bigint[];
  v_old_design_file_ids bigint[];
  v_has_video boolean;
  v_page jsonb;
  v_row files;
  v_sort int := 0;
BEGIN
  -- Lock ordering: designs first (see 20260705000001 header). post_id read under this lock
  -- is authoritative — a concurrent attach/detach serializes on it.
  SELECT * INTO v_design FROM designs WHERE id = p_design_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_design.doc_hash IS DISTINCT FROM p_claimed_hash THEN
    RETURN 'stale';
  END IF;

  IF v_design.post_id IS NOT NULL THEN
    SELECT tipo, status INTO v_post_tipo, v_post_status FROM workflow_posts
    WHERE id = v_design.post_id AND conta_id = v_design.conta_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
    END IF;
    v_apply_media := v_post_status IN ('rascunho', 'revisao_interna', 'correcao_cliente', 'enviado_cliente');
  END IF;

  IF v_apply_media AND v_post_tipo = 'reels' THEN
    -- Reel cover: no post_file_links row is created (a second link would make
    -- media.length > 1 and silently turn the Reel into a carousel). The rendered JPEG
    -- becomes the linked video's thumbnail_r2_key, mirroring post-media-manage's manual
    -- thumbnail-PATCH path exactly (no quota charge — thumbnails are derived data).
    SELECT f.id, f.thumbnail_r2_key, f.reference_count INTO v_video
    FROM post_file_links l JOIN files f ON f.id = l.file_id
    WHERE l.post_id = v_design.post_id AND l.conta_id = v_design.conta_id AND f.kind = 'video'
    FOR UPDATE OF f;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'reel_video_missing' USING ERRCODE = 'P0001';
    END IF;
    IF v_video.reference_count <> 1 THEN
      RAISE EXCEPTION 'reel_video_shared' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_array_length(p_manifest) <> 1 THEN
      RAISE EXCEPTION 'reel_manifest_invalid' USING ERRCODE = 'P0001';
    END IF;

    v_old_thumb := v_video.thumbnail_r2_key;
    v_new_key := p_manifest->0->>'r2_key';
    UPDATE files SET thumbnail_r2_key = v_new_key WHERE id = v_video.id;
    IF v_old_thumb IS NOT NULL AND v_old_thumb IS DISTINCT FROM v_new_key THEN
      INSERT INTO file_deletions (r2_key) VALUES (v_old_thumb);
    END IF;

  ELSIF v_apply_media THEN
    -- feed / carrossel: the design owns ALL image media. Render-time defensive re-check of
    -- the no-video invariant (media can change between save-time validation and render).
    -- Replace every existing link with the new design pages; manual FILES rows are never
    -- deleted (they stay in Arquivos), only their LINKS.
    SELECT bool_or(f.kind = 'video') INTO v_has_video
    FROM post_file_links l JOIN files f ON f.id = l.file_id
    WHERE l.post_id = v_design.post_id AND l.conta_id = v_design.conta_id;
    IF v_has_video THEN
      RAISE EXCEPTION 'post_has_video_media' USING ERRCODE = 'P0001';
    END IF;

    SELECT array_agg(l.id), array_agg(l.file_id) FILTER (WHERE l.origin = 'design')
      INTO v_old_link_ids, v_old_design_file_ids
    FROM post_file_links l
    WHERE l.post_id = v_design.post_id AND l.conta_id = v_design.conta_id;

    IF v_old_link_ids IS NOT NULL THEN
      DELETE FROM post_file_links WHERE id = ANY(v_old_link_ids);
    END IF;

    FOR v_page IN SELECT * FROM jsonb_array_elements(p_manifest) LOOP
      v_row := file_insert_with_quota(jsonb_build_object(
        'conta_id', v_design.conta_id,
        'r2_key', v_page->>'r2_key',
        'name', 'design-' || v_design.id || '-' || (v_page->>'page_id'),
        'kind', 'image',
        'mime_type', 'image/jpeg',
        'size_bytes', (v_page->>'bytes')::bigint,
        'width', (v_page->>'width')::int,
        'height', (v_page->>'height')::int
      ));
      INSERT INTO post_file_links (post_id, conta_id, file_id, origin, sort_order, is_cover)
      VALUES (v_design.post_id, v_design.conta_id, v_row.id, 'design', v_sort, v_sort = 0);
      v_sort := v_sort + 1;
    END LOOP;

    -- The previous render's design-origin files can now be safely deleted (their links are
    -- already gone). The AFTER DELETE trigger on files queues their R2 keys automatically.
    IF v_old_design_file_ids IS NOT NULL THEN
      DELETE FROM files WHERE id = ANY(v_old_design_file_ids);
    END IF;
  END IF;

  -- Media consumed → manifest cleared (its keys are files rows now). Media skipped
  -- (unattached or locked post) → manifest stored; the next claim reaps it.
  UPDATE designs
  SET render_status = 'rendered',
      is_stale = false,
      render_error = NULL,
      render_started_at = NULL,
      render_manifest = CASE WHEN v_apply_media THEN NULL ELSE p_manifest END
  WHERE id = p_design_id;

  RETURN 'rendered';
END;
$$;
