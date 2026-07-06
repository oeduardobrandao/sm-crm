-- post_designs — versioned design document, 1:1 with workflow_posts (Estúdio, docs/estudio-design.md §4.1).
--
-- SECURITY MODEL: `authenticated` gets SELECT only. All writes (create/update/delete, and the
-- render lifecycle) flow through SECURITY DEFINER RPCs whose EXECUTE grant is service_role-only,
-- so a raw PostgREST client cannot reach them at all — the ownership/status/rev checks inside are
-- defense-in-depth against a bug in our own trusted callers (post-design-manage, mcp), not an
-- external access-control boundary (that boundary is the EXECUTE grant itself).

CREATE TABLE IF NOT EXISTS post_designs (
  id                 bigserial PRIMARY KEY,
  post_id            bigint NOT NULL UNIQUE REFERENCES workflow_posts(id) ON DELETE CASCADE,
  conta_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  doc                jsonb NOT NULL,
  doc_version        int  NOT NULL DEFAULT 1,           -- schema version (mirrors doc->>'version')
  rev                int  NOT NULL DEFAULT 1,           -- optimistic-concurrency counter, trigger-maintained
  doc_hash           text NOT NULL DEFAULT '',          -- md5(doc::text), trigger-maintained, never client-supplied
  updated_via        text NOT NULL DEFAULT 'human' CHECK (updated_via IN ('human','agent')),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  render_status      text NOT NULL DEFAULT 'pending'
                     CHECK (render_status IN ('pending','rendering','rendered','failed')),
  render_started_at  timestamptz,                       -- claim lock (publish_processing_at analog)
  render_manifest    jsonb,                             -- in-flight chunk outputs [{page_id, r2_key, bytes, width, height}]
  rendered_at        timestamptz,
  rendered_doc_hash  text,
  render_error       text,                              -- sanitized, tenant-visible; never a raw satori/provider error
  is_stale           boolean GENERATED ALWAYS AS (doc_hash IS DISTINCT FROM rendered_doc_hash) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_designs_doc_is_object CHECK (jsonb_typeof(doc) = 'object'),
  CONSTRAINT post_designs_doc_version_matches CHECK ((doc->>'version')::int = doc_version),
  CONSTRAINT post_designs_pages_1_to_10 CHECK (
    jsonb_typeof(doc->'pages') = 'array' AND jsonb_array_length(doc->'pages') BETWEEN 1 AND 10)
);

CREATE INDEX IF NOT EXISTS post_designs_conta_idx ON post_designs (conta_id);
CREATE INDEX IF NOT EXISTS post_designs_render_pending_idx
  ON post_designs (render_status, updated_at)
  WHERE render_status IN ('pending', 'rendering');

-- ============================================================
-- DOC-STATE TRIGGER: hash, rev, staleness reset — one place, never client-controlled
-- ============================================================
CREATE OR REPLACE FUNCTION set_post_designs_doc_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.doc_hash := md5(NEW.doc::text);
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.doc_hash IS DISTINCT FROM OLD.doc_hash THEN
    NEW.rev := OLD.rev + 1;
    NEW.render_status := 'pending';
    NEW.render_error := NULL;
    NEW.render_manifest := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS post_designs_doc_state ON post_designs;
CREATE TRIGGER post_designs_doc_state
  BEFORE INSERT OR UPDATE ON post_designs
  FOR EACH ROW EXECUTE FUNCTION set_post_designs_doc_state();

-- ============================================================
-- RLS: authenticated is SELECT-only; every write goes through the RPCs below
-- ============================================================
ALTER TABLE post_designs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_designs_select ON post_designs;
CREATE POLICY post_designs_select ON post_designs
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS post_designs_service_role_bypass ON post_designs;
CREATE POLICY post_designs_service_role_bypass ON post_designs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON post_designs FROM anon;
REVOKE ALL ON post_designs FROM authenticated;
GRANT SELECT ON post_designs TO authenticated;

-- ============================================================
-- design_asset_refs — pins files referenced inside a design doc (background images, layer
-- images) against garbage collection. These files are deliberately NOT linked via
-- post_file_links (§5.2: layer assets are never post media), so without this table a file
-- dragged into the canvas but not yet rendered would show reference_count = 0 and could be
-- deleted via Arquivos or reaped by express-post-cleanup-cron while still in active use.
-- ============================================================
CREATE TABLE IF NOT EXISTS design_asset_refs (
  id         bigserial PRIMARY KEY,
  design_id  bigint NOT NULL REFERENCES post_designs(id) ON DELETE CASCADE,
  file_id    bigint NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  conta_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS design_asset_refs_unique ON design_asset_refs (design_id, file_id);
CREATE INDEX IF NOT EXISTS design_asset_refs_file_idx ON design_asset_refs (file_id);

ALTER TABLE design_asset_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS design_asset_refs_select ON design_asset_refs;
CREATE POLICY design_asset_refs_select ON design_asset_refs
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS design_asset_refs_service_role_bypass ON design_asset_refs;
CREATE POLICY design_asset_refs_service_role_bypass ON design_asset_refs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON design_asset_refs FROM anon;
REVOKE ALL ON design_asset_refs FROM authenticated;
GRANT SELECT ON design_asset_refs TO authenticated;

-- Reuse the existing generic reference-count trigger (file_system_triggers.sql) — it only
-- touches NEW.file_id / OLD.file_id, so it's table-agnostic and safe to attach here too.
DROP TRIGGER IF EXISTS trg_design_asset_ref_count_ins ON design_asset_refs;
CREATE TRIGGER trg_design_asset_ref_count_ins
  AFTER INSERT ON design_asset_refs
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();

DROP TRIGGER IF EXISTS trg_design_asset_ref_count_del ON design_asset_refs;
CREATE TRIGGER trg_design_asset_ref_count_del
  AFTER DELETE ON design_asset_refs
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();

-- ============================================================
-- New columns on existing tables
-- ============================================================
ALTER TABLE post_file_links
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'design'));

ALTER TABLE hub_brand
  ADD COLUMN IF NOT EXISTS logo_file_id bigint REFERENCES files(id) ON DELETE SET NULL;

-- ============================================================
-- SHARED CHECK: post ownership + editable status + tipo sync (used by every write RPC below).
-- Mirrors EDITABLE_STATUSES in supabase/functions/mcp/queries.ts — keep the two in sync.
-- p_doc = NULL skips format→tipo derivation (used by delete, which has no doc to read).
-- ============================================================
CREATE OR REPLACE FUNCTION post_design_check_and_sync(
  p_conta_id uuid, p_post_id bigint, p_doc jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_tipo text;
  v_target_tipo text;
BEGIN
  SELECT status, tipo INTO v_status, v_tipo
  FROM workflow_posts WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente') THEN
    RAISE EXCEPTION 'post_not_editable:%', v_status USING ERRCODE = 'P0001';
  END IF;

  IF p_doc IS NOT NULL THEN
    v_target_tipo := CASE (p_doc->>'format')
      WHEN 'feed' THEN 'feed'
      WHEN 'carrossel' THEN 'carrossel'
      WHEN 'reel_cover' THEN 'reels'
      ELSE NULL
    END;
    IF v_target_tipo IS NULL THEN
      RAISE EXCEPTION 'invalid_format:%', coalesce(p_doc->>'format', 'null') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- correcao_cliente is live in the client portal — any design write pulls the post out of
  -- the client's view, mirroring the same rule in mcp/queries.ts::updatePost.
  IF v_status = 'correcao_cliente' THEN
    UPDATE workflow_posts
    SET tipo = coalesce(v_target_tipo, tipo), status = 'revisao_interna'
    WHERE id = p_post_id AND conta_id = p_conta_id;
  ELSIF p_doc IS NOT NULL AND v_tipo IS DISTINCT FROM v_target_tipo THEN
    UPDATE workflow_posts SET tipo = v_target_tipo WHERE id = p_post_id AND conta_id = p_conta_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION post_design_check_and_sync(uuid, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_design_check_and_sync(uuid, bigint, jsonb) TO service_role;

-- ============================================================
-- SHARED CHECK: diff design_asset_refs against the doc's current file_id set.
-- Also re-verifies tenancy of every referenced file — defense in depth; the application
-- validation layer (design-doc.ts / mcp/design.ts) already checked this before calling in.
-- ============================================================
CREATE OR REPLACE FUNCTION post_design_diff_asset_refs(
  p_design_id bigint, p_conta_id uuid, p_doc jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_file_ids bigint[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT fid), '{}'::bigint[]) INTO v_file_ids
  FROM (
    SELECT (layer->>'file_id')::bigint AS fid
    FROM jsonb_array_elements(p_doc->'pages') AS page,
         jsonb_array_elements(page->'layers') AS layer
    WHERE layer->>'file_id' IS NOT NULL
    UNION
    SELECT (page->'background'->>'file_id')::bigint AS fid
    FROM jsonb_array_elements(p_doc->'pages') AS page
    WHERE page->'background'->>'file_id' IS NOT NULL
  ) f;

  IF array_length(v_file_ids, 1) > 0 AND EXISTS (
    SELECT 1 FROM unnest(v_file_ids) AS fid
    LEFT JOIN files fl ON fl.id = fid AND fl.conta_id = p_conta_id
    WHERE fl.id IS NULL
  ) THEN
    RAISE EXCEPTION 'file_not_found_or_forbidden' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM design_asset_refs
  WHERE design_id = p_design_id
    AND (array_length(v_file_ids, 1) IS NULL OR file_id <> ALL(v_file_ids));

  INSERT INTO design_asset_refs (design_id, file_id, conta_id)
  SELECT p_design_id, fid, p_conta_id
  FROM unnest(v_file_ids) AS fid
  ON CONFLICT (design_id, file_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION post_design_diff_asset_refs(bigint, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_design_diff_asset_refs(bigint, uuid, jsonb) TO service_role;

-- ============================================================
-- WRITE RPCs — the only way authenticated-role callers (via edge functions using the
-- service-role key) may touch post_designs. Each composes the two shared checks above.
-- ============================================================

CREATE OR REPLACE FUNCTION create_post_design(
  p_conta_id uuid, p_post_id bigint, p_doc jsonb, p_doc_version int,
  p_updated_via text, p_updated_by uuid
) RETURNS post_designs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row post_designs;
BEGIN
  PERFORM post_design_check_and_sync(p_conta_id, p_post_id, p_doc);

  BEGIN
    INSERT INTO post_designs (post_id, conta_id, doc, doc_version, updated_via, updated_by)
    VALUES (p_post_id, p_conta_id, p_doc, p_doc_version, p_updated_via, p_updated_by)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'design_already_exists' USING ERRCODE = 'P0001';
  END;

  PERFORM post_design_diff_asset_refs(v_row.id, p_conta_id, p_doc);
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION create_post_design(uuid, bigint, jsonb, int, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_post_design(uuid, bigint, jsonb, int, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION update_post_design(
  p_conta_id uuid, p_post_id bigint, p_doc jsonb, p_doc_version int,
  p_expected_rev int, p_updated_via text, p_updated_by uuid
) RETURNS post_designs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row post_designs;
  v_current_rev int;
BEGIN
  PERFORM post_design_check_and_sync(p_conta_id, p_post_id, p_doc);

  SELECT rev INTO v_current_rev FROM post_designs
  WHERE post_id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_rev IS NOT NULL AND v_current_rev <> p_expected_rev THEN
    RAISE EXCEPTION 'rev_conflict:%', v_current_rev USING ERRCODE = 'P0001';
  END IF;

  UPDATE post_designs
  SET doc = p_doc, doc_version = p_doc_version, updated_via = p_updated_via, updated_by = p_updated_by
  WHERE post_id = p_post_id AND conta_id = p_conta_id
  RETURNING * INTO v_row;

  PERFORM post_design_diff_asset_refs(v_row.id, p_conta_id, p_doc);
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION update_post_design(uuid, bigint, jsonb, int, int, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_post_design(uuid, bigint, jsonb, int, int, text, uuid) TO service_role;

-- Get-or-create for post-design-manage's GET route: never overwrites an existing doc.
CREATE OR REPLACE FUNCTION get_or_create_post_design(
  p_conta_id uuid, p_post_id bigint, p_starter_doc jsonb, p_doc_version int, p_updated_by uuid
) RETURNS post_designs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row post_designs;
BEGIN
  -- No tipo sync: the starter doc's format is derived from the post's OWN current tipo by
  -- the caller, so there is nothing to reconcile on a first read.
  PERFORM post_design_check_and_sync(p_conta_id, p_post_id, NULL);

  SELECT * INTO v_row FROM post_designs WHERE post_id = p_post_id AND conta_id = p_conta_id;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  BEGIN
    INSERT INTO post_designs (post_id, conta_id, doc, doc_version, updated_via, updated_by)
    VALUES (p_post_id, p_conta_id, p_starter_doc, p_doc_version, 'human', p_updated_by)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a create race to a concurrent request; return what they created, untouched.
    SELECT * INTO v_row FROM post_designs WHERE post_id = p_post_id AND conta_id = p_conta_id;
    RETURN v_row;
  END;

  PERFORM post_design_diff_asset_refs(v_row.id, p_conta_id, p_starter_doc);
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION get_or_create_post_design(uuid, bigint, jsonb, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_post_design(uuid, bigint, jsonb, int, uuid) TO service_role;

-- Delete semantics per §5.2: feed/carrossel removes design-origin media (post left media-less,
-- pre-design manual links were already consumed by the first render and are not restorable);
-- reels leaves the video's last rendered thumbnail in place (replaceable via the thumbnail
-- picker). Idempotent no-op when no design exists.
CREATE OR REPLACE FUNCTION delete_post_design(p_conta_id uuid, p_post_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_design_id bigint;
  v_tipo text;
  v_link_ids bigint[];
  v_file_ids bigint[];
BEGIN
  PERFORM post_design_check_and_sync(p_conta_id, p_post_id, NULL);

  SELECT id INTO v_design_id FROM post_designs
  WHERE post_id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT tipo INTO v_tipo FROM workflow_posts WHERE id = p_post_id AND conta_id = p_conta_id;

  IF v_tipo <> 'reels' THEN
    SELECT array_agg(l.id), array_agg(l.file_id) INTO v_link_ids, v_file_ids
    FROM post_file_links l
    WHERE l.post_id = p_post_id AND l.conta_id = p_conta_id AND l.origin = 'design';

    IF v_link_ids IS NOT NULL THEN
      DELETE FROM post_file_links WHERE id = ANY(v_link_ids);
      DELETE FROM files WHERE id = ANY(v_file_ids);
    END IF;
  END IF;

  DELETE FROM design_asset_refs WHERE design_id = v_design_id;
  DELETE FROM post_designs WHERE id = v_design_id;
END;
$$;

REVOKE ALL ON FUNCTION delete_post_design(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_post_design(uuid, bigint) TO service_role;

-- ============================================================
-- RENDER LIFECYCLE RPCs — called only by design-render (cron-secret-gated, service role).
-- ============================================================

-- Atomic claim: pending/failed/rendered -> rendering, or reclaim a stale (dead-worker) lock.
CREATE OR REPLACE FUNCTION claim_design_render(p_design_id bigint)
RETURNS TABLE (design_id bigint, conta_id uuid, post_id bigint, doc jsonb, doc_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE post_designs pd
  SET render_status = 'rendering', render_started_at = now(), render_manifest = '[]'::jsonb
  WHERE pd.id = p_design_id
    AND (pd.render_status <> 'rendering'
         OR pd.render_started_at IS NULL
         OR pd.render_started_at < now() - interval '3 minutes')
  RETURNING pd.id, pd.conta_id, pd.post_id, pd.doc, pd.doc_hash;
$$;

REVOKE ALL ON FUNCTION claim_design_render(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_design_render(bigint) TO service_role;

-- One hash-guarded transaction: re-check the doc hasn't moved, swap post media per the
-- format-specific rules in §5.2, and mark the design rendered. Returns 'rendered' or 'stale'
-- (doc moved mid-render — the doc-state trigger already reset the row to 'pending'; the
-- caller queues p_manifest's R2 keys into file_deletions itself since nothing here does).
CREATE OR REPLACE FUNCTION finalize_design_render(
  p_design_id bigint, p_claimed_hash text, p_manifest jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_peek_conta_id uuid;
  v_peek_post_id bigint;
  v_design record;
  v_post record;
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
  -- Unlocked peek to discover which workflow_posts row to lock FIRST. post_id/conta_id are
  -- immutable once a post_designs row is created (no RPC ever updates them), so this is safe.
  -- Locking workflow_posts before post_designs here — matching the order every write RPC
  -- takes via post_design_check_and_sync — is required: the reverse order would deadlock
  -- against a concurrent editor autosave (update_post_design) finalizing for the same design,
  -- which is an expected concurrent scenario (autosave firing while a render is in flight).
  SELECT conta_id, post_id INTO v_peek_conta_id, v_peek_post_id
  FROM post_designs WHERE id = p_design_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, tipo INTO v_post FROM workflow_posts
  WHERE id = v_peek_post_id AND conta_id = v_peek_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, conta_id, post_id, doc_hash INTO v_design
  FROM post_designs WHERE id = p_design_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_design.doc_hash IS DISTINCT FROM p_claimed_hash THEN
    RETURN 'stale';
  END IF;

  IF v_post.tipo = 'reels' THEN
    -- Reel cover: no post_file_links row is created (a second link would make
    -- media.length > 1 and silently turn the Reel into a carousel — verified against
    -- supabase/functions/_shared/instagram-publish-utils.ts). Instead, the rendered JPEG
    -- becomes the linked video's thumbnail_r2_key, mirroring post-media-manage's existing
    -- manual thumbnail-PATCH path exactly (no quota charge there either — thumbnails are
    -- derived data, not counted against storage_quota_bytes).
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

  ELSE
    -- feed / carrossel: a design here must own ALL image media (§2.4 post_has_video_media
    -- already blocks creating a design on a post with video — this is the render-time
    -- defensive re-check for the same invariant, in case media changed between save-time
    -- validation and render time). Replace every existing link with the new design pages;
    -- manual FILES rows are never deleted (they stay in Arquivos), only their LINKS.
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
    -- already gone). This fires the existing AFTER DELETE trigger on files, which queues
    -- their R2 keys into file_deletions automatically.
    IF v_old_design_file_ids IS NOT NULL THEN
      DELETE FROM files WHERE id = ANY(v_old_design_file_ids);
    END IF;
  END IF;

  UPDATE post_designs
  SET render_status = 'rendered', rendered_at = now(), rendered_doc_hash = p_claimed_hash,
      render_error = NULL, render_started_at = NULL, render_manifest = NULL
  WHERE id = p_design_id;

  RETURN 'rendered';
END;
$$;

REVOKE ALL ON FUNCTION finalize_design_render(bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_design_render(bigint, text, jsonb) TO service_role;

-- Failure path. Guarded on render_status = 'rendering' so a concurrent doc edit that already
-- reset the row to 'pending' (via the doc-state trigger) is never clobbered by a stale failure.
CREATE OR REPLACE FUNCTION fail_design_render(p_design_id bigint, p_error text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE post_designs
  SET render_status = 'failed', render_error = p_error, render_started_at = NULL, render_manifest = NULL
  WHERE id = p_design_id AND render_status = 'rendering';
$$;

REVOKE ALL ON FUNCTION fail_design_render(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_design_render(bigint, text) TO service_role;
