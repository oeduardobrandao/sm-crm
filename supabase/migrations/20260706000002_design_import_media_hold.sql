-- Estúdio slice C (image → editable design): designs born from an imported image need a
-- render that is visible in the editor WITHOUT immediately overwriting the post's live media
-- with the (still-being-edited) imported page. media_apply_held marks a design's next
-- finalize as "render only, don't touch post media" — the same manifest-storage path already
-- used for unattached designs. The hold is a one-shot latch: the first save, or an
-- attach/detach, clears it, so the very next finalize after the user's first edit applies
-- media normally.
--
-- Spec: docs/superpowers/specs/2026-07-06-estudio-image-import-*.md (slice C plan)
-- Mirrors (change together): design-manage/handler.ts (import path sets p_media_hold), mcp
-- design tools if/when they gain import support.
-- Error strings are a contract with design-manage's mapDesignRpcError — unchanged here.

-- ============================================================
-- 0. Column
-- ============================================================
ALTER TABLE designs ADD COLUMN media_apply_held boolean NOT NULL DEFAULT false;

-- ============================================================
-- create_design — new p_media_hold param. A plain CREATE OR REPLACE would ADD an overload
-- (different arg list = different function), leaving two create_design entries that a 9-arg
-- caller could no longer resolve unambiguously once a 10-arg caller also exists. Drop the
-- exact 9-arg signature first so there is exactly one create_design afterward.
-- ============================================================
DROP FUNCTION create_design(uuid, bigint, bigint, text, text, text, text, int, uuid);

CREATE FUNCTION create_design(
  p_conta_id uuid, p_cliente_id bigint, p_post_id bigint, p_format text, p_name text,
  p_r2_key text, p_doc_hash text, p_doc_bytes int, p_created_by uuid,
  p_media_hold boolean DEFAULT false
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_cliente bigint := p_cliente_id;
  v_id bigint;
  v_hold boolean := p_media_hold AND p_post_id IS NOT NULL;
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
                         doc_r2_key, doc_hash, doc_bytes, created_by, updated_by,
                         media_apply_held)
    VALUES (p_conta_id, v_cliente, p_post_id, coalesce(p_name, 'Design sem título'), p_format,
            p_r2_key, p_doc_hash, p_doc_bytes, p_created_by, p_created_by, v_hold)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'post_already_designed' USING ERRCODE = 'P0001';
  END;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION create_design(uuid, bigint, bigint, text, text, text, text, int, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_design(uuid, bigint, bigint, text, text, text, text, int, uuid, boolean) TO service_role;

-- ============================================================
-- save_design_blob — signature unchanged. The first save after an import clears the hold
-- (the user has now taken over editing; from here on saves behave normally). Whatever the
-- held finalize stored in render_manifest becomes dead weight the instant the doc changes —
-- queue its r2_keys into file_deletions here, same pattern as claim_design_render's reap and
-- delete_design's cleanup, so the leak is closed in the same transaction that drops the
-- manifest reference.
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
  v_entry jsonb;
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

  IF v_design.render_manifest IS NOT NULL THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_design.render_manifest) LOOP
      INSERT INTO file_deletions (r2_key) VALUES (v_entry->>'r2_key');
    END LOOP;
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
         render_manifest = NULL,
         media_apply_held = false
   WHERE id = p_design_id
  RETURNING rev INTO v_new_rev;

  IF v_status = 'correcao_cliente' THEN
    UPDATE workflow_posts SET status = 'revisao_interna'
    WHERE id = v_design.post_id AND conta_id = p_conta_id;
  END IF;

  RETURN QUERY SELECT v_new_rev, v_design.doc_r2_key;
END $$;

REVOKE ALL ON FUNCTION save_design_blob(uuid, bigint, int, text, text, int, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_design_blob(uuid, bigint, int, text, text, int, text, uuid) TO service_role;

-- ============================================================
-- attach_design — clears the hold. Attaching is itself a fresh media-application decision
-- (attach's branch already forces a pending/stale re-render); a hold from a prior life of the
-- design (e.g. duplicated from a held import) must not suppress that next finalize's media
-- application.
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
           media_apply_held = false,
           updated_by = p_updated_by,
           updated_at = now()
     WHERE id = p_design_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'post_already_designed' USING ERRCODE = 'P0001';
  END;

  RETURN v_tipo;
END $$;

REVOKE ALL ON FUNCTION attach_design(uuid, bigint, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attach_design(uuid, bigint, bigint, uuid) TO service_role;

-- ============================================================
-- detach_design — clears the hold. Media already applied to the post stays untouched (same
-- rule as before); the hold is about a FUTURE finalize, which after detach cannot touch any
-- post at all, but a re-attach elsewhere must not inherit a stale hold either.
-- ============================================================
CREATE OR REPLACE FUNCTION detach_design(p_conta_id uuid, p_design_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE designs SET post_id = NULL, media_apply_held = false, updated_at = now()
  WHERE id = p_design_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;
END $$;

REVOKE ALL ON FUNCTION detach_design(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION detach_design(uuid, bigint) TO service_role;

-- ============================================================
-- finalize_design_render — a held design's finalize is routed through the existing
-- unattached branch (v_apply_media stays false): the manifest is stored on the row instead of
-- becoming post media, exactly like an unattached design's render. The hold does not clear
-- itself here — it is a one-shot latch cleared by the FIRST save/attach/detach, not by the
-- render that follows it, so an import that finalizes more than once before the user edits
-- keeps rendering held.
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
  v_media_held boolean := false;
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

  v_media_held := v_design.media_apply_held;

  IF v_design.post_id IS NOT NULL THEN
    SELECT tipo, status INTO v_post_tipo, v_post_status FROM workflow_posts
    WHERE id = v_design.post_id AND conta_id = v_design.conta_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
    END IF;
    v_apply_media := v_post_status IN ('rascunho', 'revisao_interna', 'correcao_cliente', 'enviado_cliente')
                     AND NOT v_media_held;
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
  -- (unattached, locked post, or held) → manifest stored; the next claim reaps it.
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

REVOKE ALL ON FUNCTION finalize_design_render(bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_design_render(bigint, text, jsonb) TO service_role;
