-- Estúdio v2: blob-aware render claim. Identical semantics to claim_design_render
-- (20260702000004 — FOR UPDATE before deciding reclaimability, superseded-'rendering'
-- manifests reaped into file_deletions atomically, 3-minute reclaim window), but returns
-- the .fig blob pointer + editor_version instead of the retired jsonb doc, plus the post's
-- current tipo so the orchestrator can decide tipo-sync without a second lookup.
--
-- claim_design_render (v1) stays in place untouched until the cutover slice — the deployed
-- v1 design-render function still references it.

CREATE OR REPLACE FUNCTION claim_design_render_blob(p_design_id bigint)
RETURNS TABLE (
  design_id bigint, conta_id uuid, post_id bigint,
  doc_r2_key text, doc_hash text, editor_version text, post_tipo text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_status text;
  v_old_manifest jsonb;
  v_started_at timestamptz;
  v_reclaimable boolean;
  v_entry jsonb;
BEGIN
  SELECT pd.render_status, pd.render_manifest, pd.render_started_at
    INTO v_old_status, v_old_manifest, v_started_at
  FROM post_designs pd WHERE pd.id = p_design_id
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

  UPDATE post_designs pd
  SET render_status = 'rendering', render_started_at = now(), render_manifest = '[]'::jsonb
  WHERE pd.id = p_design_id;

  IF v_old_status = 'rendering' AND v_old_manifest IS NOT NULL THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_old_manifest) LOOP
      INSERT INTO file_deletions (r2_key) VALUES (v_entry->>'r2_key');
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT pd.id, pd.conta_id, pd.post_id, pd.doc_r2_key, pd.doc_hash, pd.editor_version, wp.tipo
  FROM post_designs pd
  JOIN workflow_posts wp ON wp.id = pd.post_id
  WHERE pd.id = p_design_id;
END;
$$;

REVOKE ALL ON FUNCTION claim_design_render_blob(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_design_render_blob(bigint) TO service_role;
