-- Estúdio design-first core (slice A1): designs become first-class, workspace-owned rows.
-- Spec: docs/superpowers/specs/2026-07-04-estudio-design-first-model.md
-- Replaces post_designs (rows are dark-feature test data — dropped, not migrated) and the
-- whole post-keyed RPC family. The frozen blob contract (docs/estudio-v2-editor-contract.md)
-- keeps its semantics; only the key changes (design_id instead of post_id).
--
-- SECURITY MODEL (unchanged from post_designs): `authenticated` gets SELECT only. All writes
-- flow through SECURITY DEFINER RPCs whose EXECUTE grant is service_role-only — the checks
-- inside are defense-in-depth against bugs in our own trusted callers (design-manage,
-- design-render), not an external access-control boundary.
--
-- LOCK ORDERING (new convention, differs from v1 on purpose): designs row FIRST, then
-- workflow_posts. In v1 post_id was immutable so locking the post first was safe; in v2
-- attach/detach mutate post_id, so the authoritative post_id is only known while holding the
-- designs row lock. save_design_blob, attach_design and finalize_design_render all follow
-- designs → workflow_posts; no RPC in this family takes the locks in the reverse order.

-- ============================================================
-- 1. Drop the old world. post_designs rows are test data (feature ships dark) — wiped by
--    decision. design_asset_refs was v1-jsonb bookkeeping, already emptied by
--    20260704000001 and unreferenced by v2 code. The deployed v1 MCP design tools break at
--    runtime with this drop — expected and accepted (dark, test-only; slice B rewrites them).
-- ============================================================
DROP TABLE IF EXISTS design_asset_refs;
DROP TABLE IF EXISTS post_designs CASCADE;

-- Blob-world RPC family (replaced by the design_id-keyed family below).
DROP FUNCTION IF EXISTS get_or_create_post_design_blob(uuid, bigint, text, text, int, uuid);
DROP FUNCTION IF EXISTS save_post_design_blob(uuid, bigint, int, text, text, int, text, uuid);
DROP FUNCTION IF EXISTS delete_post_design(uuid, bigint);
DROP FUNCTION IF EXISTS claim_design_render_blob(bigint);

-- Dead v1 jsonb family (inert since 20260704000001; broken outright once the table is gone).
DROP FUNCTION IF EXISTS create_post_design(uuid, bigint, jsonb, int, text, uuid);
DROP FUNCTION IF EXISTS update_post_design(uuid, bigint, jsonb, int, int, text, uuid);
DROP FUNCTION IF EXISTS get_or_create_post_design(uuid, bigint, jsonb, int, uuid);
DROP FUNCTION IF EXISTS post_design_check_and_sync(uuid, bigint, jsonb);
DROP FUNCTION IF EXISTS post_design_diff_asset_refs(bigint, uuid, jsonb);

-- claim_design_render's return type changes (blob pointer instead of jsonb doc) — a plain
-- CREATE OR REPLACE cannot change a return type, so drop first. finalize/fail keep their
-- signatures and are replaced in-place below.
DROP FUNCTION IF EXISTS claim_design_render(bigint);

-- ============================================================
-- 2. First-class designs table
-- ============================================================
CREATE TABLE public.designs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Optional client association (activates brand-kit panels). Attach copies it from the post.
  cliente_id      bigint REFERENCES clientes(id) ON DELETE SET NULL,
  -- 1:1 attachment while attached. SET NULL (not CASCADE): designs are first-class — deleting
  -- a post detaches its design instead of destroying it.
  post_id         bigint UNIQUE REFERENCES workflow_posts(id) ON DELETE SET NULL,
  name            text NOT NULL DEFAULT 'Design sem título',
  format          text NOT NULL CHECK (format IN ('feed', 'carrossel', 'reel_cover', 'livre')),
  rev             integer NOT NULL DEFAULT 1,
  doc_r2_key      text NOT NULL,
  doc_hash        text NOT NULL,
  doc_bytes       integer NOT NULL,
  editor_version  text,
  render_status   text NOT NULL DEFAULT 'pending'
                  CHECK (render_status IN ('pending', 'rendering', 'rendered', 'failed')),
  -- v2 staleness is set explicitly by the RPCs (no rendered_doc_hash generated column):
  -- true on create/save/attach/duplicate, false when a finalize lands on the current hash.
  is_stale        boolean NOT NULL DEFAULT true,
  render_error    text,       -- sanitized, tenant-visible; never a raw provider error
  render_manifest jsonb,      -- in-flight chunk outputs; kept after finalize when unattached
  render_started_at timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX designs_conta_idx ON public.designs (conta_id, updated_at DESC);
-- Sweep cron scans for stuck pending/rendering rows (design-render-sweep-cron).
CREATE INDEX designs_render_pending_idx
  ON public.designs (render_status, updated_at)
  WHERE render_status IN ('pending', 'rendering');

ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;

CREATE POLICY designs_select ON public.designs
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY designs_service_role_bypass ON public.designs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.designs FROM anon;
REVOKE ALL ON public.designs FROM authenticated;
GRANT SELECT ON public.designs TO authenticated;

-- ============================================================
-- 3. Write RPCs — the only way edge functions (service-role key) touch designs.
--    Error strings are a contract with design-manage's mapDesignRpcError — change together.
-- ============================================================

-- Explicit creation (mint-on-GET is gone). The caller uploads the starter blob to p_r2_key
-- BEFORE calling, so a created row never points at nothing. With p_post_id the design is born
-- attached: post must be in-conta and editable; cliente is copied from the post's workflow.
CREATE FUNCTION create_design(
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
    IF v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente') THEN
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

REVOKE ALL ON FUNCTION create_design(uuid, bigint, bigint, text, text, text, text, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_design(uuid, bigint, bigint, text, text, text, text, int, uuid) TO service_role;

-- Rev-guarded save. Attached + locked post → 'read_only' (the design must not silently
-- diverge from what the client approved). A save while the attached post sits in
-- correcao_cliente pulls it back to revisao_interna (client-portal rule, unchanged from v1).
CREATE FUNCTION save_design_blob(
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
    IF FOUND AND v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente') THEN
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

REVOKE ALL ON FUNCTION save_design_blob(uuid, bigint, int, text, text, int, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_design_blob(uuid, bigint, int, text, text, int, text, uuid) TO service_role;

-- Attach: eligibility is validated HERE (at attach time), not at editor-open time. Media is
-- NOT swapped synchronously — the row is reset to pending/stale and the next render applies
-- it (finalize's attached+editable branch). Returns the post's tipo for the render trigger.
CREATE FUNCTION attach_design(
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
  IF v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente') THEN
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

REVOKE ALL ON FUNCTION attach_design(uuid, bigint, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attach_design(uuid, bigint, bigint, uuid) TO service_role;

-- Detach: the design lets go of the post. Media already applied to the post STAYS — it
-- simply stops updating (it is regular post media from here on). Idempotent when detached.
CREATE FUNCTION detach_design(p_conta_id uuid, p_design_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE designs SET post_id = NULL, updated_at = now()
  WHERE id = p_design_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;
END $$;

REVOKE ALL ON FUNCTION detach_design(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION detach_design(uuid, bigint) TO service_role;

-- Duplicate: fresh detached copy at rev 1. The caller copies the blob bytes in R2 to
-- p_new_r2_key BEFORE calling, so the new row never points at nothing.
CREATE FUNCTION duplicate_design(
  p_conta_id uuid, p_design_id bigint, p_new_r2_key text, p_created_by uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src designs%ROWTYPE;
  v_id bigint;
BEGIN
  SELECT * INTO v_src FROM designs
  WHERE id = p_design_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO designs (conta_id, cliente_id, post_id, name, format,
                       doc_r2_key, doc_hash, doc_bytes, editor_version,
                       created_by, updated_by)
  VALUES (v_src.conta_id, v_src.cliente_id, NULL, v_src.name || ' (cópia)', v_src.format,
          p_new_r2_key, v_src.doc_hash, v_src.doc_bytes, v_src.editor_version,
          p_created_by, p_created_by)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION duplicate_design(uuid, bigint, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION duplicate_design(uuid, bigint, text, uuid) TO service_role;

-- Delete: removes the row and queues its R2 leftovers (doc blob + any in-flight/stored
-- render manifest) into file_deletions IN THE SAME TRANSACTION — atomic, unlike a
-- caller-side queue that could be lost to a crash between RPC and cleanup. Media already
-- applied to a post is untouched (same rule as detach: applied media is post media now;
-- its files rows own their R2 keys and are managed by post-media flows).
CREATE FUNCTION delete_design(p_conta_id uuid, p_design_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_design designs%ROWTYPE;
  v_entry jsonb;
BEGIN
  SELECT * INTO v_design FROM designs
  WHERE id = p_design_id AND conta_id = p_conta_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM designs WHERE id = p_design_id;

  INSERT INTO file_deletions (r2_key) VALUES (v_design.doc_r2_key);
  IF v_design.render_manifest IS NOT NULL THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_design.render_manifest) LOOP
      INSERT INTO file_deletions (r2_key) VALUES (v_entry->>'r2_key');
    END LOOP;
  END IF;
END $$;

REVOKE ALL ON FUNCTION delete_design(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_design(uuid, bigint) TO service_role;

-- ============================================================
-- 4. Render lifecycle RPCs — called only by design-render (cron-secret-gated, service role).
-- ============================================================

-- Atomic claim, ported 1:1 from claim_design_render_blob with two v2 changes:
--   * LEFT JOIN workflow_posts — unattached designs render too (post_* come back NULL).
--   * The manifest reap now fires for ANY non-null manifest, not just superseded 'rendering'
--     rows: unattached finalizes STORE their manifest on the rendered row (gallery
--     thumbnails), and reclaiming such a row is the only moment those R2 keys can be retired
--     without leaking. Manifest keys on a 'rendered' row are never files-rows (the attached
--     branch clears the manifest after converting it to post media), so this never queues
--     live media.
CREATE FUNCTION claim_design_render(p_design_id bigint)
RETURNS TABLE (
  design_id bigint, conta_id uuid, post_id bigint,
  doc_r2_key text, doc_hash text, editor_version text, rev int, format text,
  post_tipo text, post_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_status text;
  v_old_manifest jsonb;
  v_started_at timestamptz;
  v_reclaimable boolean;
  v_entry jsonb;
BEGIN
  SELECT d.render_status, d.render_manifest, d.render_started_at
    INTO v_old_status, v_old_manifest, v_started_at
  FROM designs d WHERE d.id = p_design_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_reclaimable := (v_old_status <> 'rendering'
    OR v_started_at IS NULL
    OR v_started_at < now() - interval '3 minutes');

  IF NOT v_reclaimable THEN
    RETURN;
  END IF;

  UPDATE designs d
  SET render_status = 'rendering', render_started_at = now(), render_manifest = '[]'::jsonb
  WHERE d.id = p_design_id;

  IF v_old_manifest IS NOT NULL THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_old_manifest) LOOP
      INSERT INTO file_deletions (r2_key) VALUES (v_entry->>'r2_key');
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT d.id, d.conta_id, d.post_id, d.doc_r2_key, d.doc_hash, d.editor_version, d.rev,
         d.format, wp.tipo, wp.status
  FROM designs d
  LEFT JOIN workflow_posts wp ON wp.id = d.post_id
  WHERE d.id = p_design_id;
END;
$$;

REVOKE ALL ON FUNCTION claim_design_render(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_design_render(bigint) TO service_role;

-- One hash-guarded transaction. Media application (the v1 link-swap / reel-thumbnail rules,
-- verbatim) runs ONLY when the design is attached AND the post is still editable; otherwise
-- the manifest is stored on the row (gallery thumbnails) and media is not touched. Returns
-- 'rendered' or 'stale' (doc or attachment moved mid-render — the row was already reset to
-- 'pending' by the concurrent save/attach; the caller queues p_manifest's R2 keys into
-- file_deletions itself on 'stale', since nothing here does).
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
  -- Lock ordering: designs first (see header). post_id read under this lock is authoritative
  -- — a concurrent attach/detach serializes on it.
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
    v_apply_media := v_post_status IN ('rascunho', 'revisao_interna', 'correcao_cliente');
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

REVOKE ALL ON FUNCTION finalize_design_render(bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_design_render(bigint, text, jsonb) TO service_role;

-- Failure path. Guarded on render_status = 'rendering' so a concurrent save that already
-- reset the row to 'pending' is never clobbered by a stale failure.
CREATE OR REPLACE FUNCTION fail_design_render(p_design_id bigint, p_error text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE designs
  SET render_status = 'failed', render_error = p_error, render_started_at = NULL, render_manifest = NULL
  WHERE id = p_design_id AND render_status = 'rendering';
$$;

REVOKE ALL ON FUNCTION fail_design_render(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_design_render(bigint, text) TO service_role;
