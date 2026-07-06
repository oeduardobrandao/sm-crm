-- Estúdio v2 (OpenPencil): post_designs stores a .fig blob pointer instead of a jsonb doc.
-- Spec: docs/superpowers/specs/2026-07-04-openpencil-estudio-design.md (+ spike amendment: .fig).
-- Contract implemented by post-design-manage /blob: docs/estudio-v2-editor-contract.md.
--
-- v1 rows are dark-feature test data (feature_estudio off on all plans) — wiped by decision.
-- The jsonb `doc` column stays (nullable, unused) until cutover: deployed v1 functions still
-- reference it and must not break harder than "inert".

DELETE FROM design_asset_refs;
DELETE FROM post_designs;

ALTER TABLE post_designs
  DROP CONSTRAINT IF EXISTS post_designs_doc_is_object,
  DROP CONSTRAINT IF EXISTS post_designs_doc_version_matches,
  DROP CONSTRAINT IF EXISTS post_designs_pages_1_to_10,
  ALTER COLUMN doc DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS doc_r2_key text,
  ADD COLUMN IF NOT EXISTS doc_bytes integer,
  ADD COLUMN IF NOT EXISTS editor_version text;

-- v1 trigger derived doc_hash/rev/render-reset from jsonb doc changes; v2 sets all of that
-- explicitly inside the RPCs (hash is sha256 of the blob, computed by post-design-manage).
DROP TRIGGER IF EXISTS post_designs_doc_state ON post_designs;
DROP FUNCTION IF EXISTS set_post_designs_doc_state();

-- ============================================================
-- Get-or-create (blob world). The caller uploads the starter blob to p_r2_key BEFORE calling,
-- so a created row never points at nothing. Minting requires an editable post (same statuses
-- as v1's check_and_sync); reading an existing design has no status requirement.
-- ============================================================
CREATE OR REPLACE FUNCTION get_or_create_post_design_blob(
  p_conta_id uuid, p_post_id bigint, p_r2_key text, p_doc_hash text, p_doc_bytes int,
  p_updated_by uuid
) RETURNS TABLE (o_id bigint, o_rev int, o_doc_r2_key text, o_created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_row post_designs%ROWTYPE;
  v_created boolean := false;
BEGIN
  SELECT status INTO v_status
  FROM workflow_posts WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM post_designs WHERE post_id = p_post_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.rev, v_row.doc_r2_key, false;
    RETURN;
  END IF;

  IF v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente') THEN
    RAISE EXCEPTION 'post_not_editable:%', v_status USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO post_designs (post_id, conta_id, rev, doc_hash, doc_r2_key, doc_bytes,
                            updated_via, updated_by, render_status)
  VALUES (p_post_id, p_conta_id, 1, p_doc_hash, p_r2_key, p_doc_bytes, 'human', p_updated_by, 'pending')
  ON CONFLICT (post_id) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.id IS NOT NULL THEN
    v_created := true;
  ELSE
    SELECT * INTO v_row FROM post_designs WHERE post_id = p_post_id;
  END IF;

  RETURN QUERY SELECT v_row.id, v_row.rev, v_row.doc_r2_key, v_created;
END $$;

REVOKE ALL ON FUNCTION get_or_create_post_design_blob(uuid, bigint, text, text, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_post_design_blob(uuid, bigint, text, text, int, uuid) TO service_role;

-- ============================================================
-- Rev-guarded save. Preserves v1 semantics that don't need doc parsing:
--   * editability statuses (rascunho | revisao_interna | correcao_cliente)
--   * a write on correcao_cliente pulls the post back to revisao_interna (client-portal rule)
--   * a doc change resets the render lifecycle (pending, error/manifest cleared)
-- Tipo-sync and deep validation are deferred to the doc-service slice (need .fig parsing).
-- ============================================================
CREATE OR REPLACE FUNCTION save_post_design_blob(
  p_conta_id uuid, p_post_id bigint, p_expected_rev int, p_doc_hash text, p_r2_key text,
  p_doc_bytes int, p_editor_version text, p_updated_by uuid
) RETURNS TABLE (o_rev int, o_prev_r2_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_new_rev int;
  v_prev_key text;
BEGIN
  SELECT status INTO v_status
  FROM workflow_posts WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente') THEN
    RAISE EXCEPTION 'post_not_editable:%', v_status USING ERRCODE = 'P0001';
  END IF;

  SELECT doc_r2_key INTO v_prev_key FROM post_designs WHERE post_id = p_post_id;

  UPDATE post_designs
     SET rev = rev + 1,
         doc_hash = p_doc_hash,
         doc_r2_key = p_r2_key,
         doc_bytes = p_doc_bytes,
         editor_version = p_editor_version,
         updated_via = 'human',
         updated_by = p_updated_by,
         updated_at = now(),
         render_status = 'pending',
         render_error = NULL,
         render_manifest = NULL
   WHERE post_id = p_post_id AND rev = p_expected_rev
  RETURNING rev INTO v_new_rev;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rev_conflict' USING ERRCODE = 'P0001';
  END IF;

  IF v_status = 'correcao_cliente' THEN
    UPDATE workflow_posts SET status = 'revisao_interna'
    WHERE id = p_post_id AND conta_id = p_conta_id;
  END IF;

  RETURN QUERY SELECT v_new_rev, v_prev_key;
END $$;

REVOKE ALL ON FUNCTION save_post_design_blob(uuid, bigint, int, text, text, int, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_post_design_blob(uuid, bigint, int, text, text, int, text, uuid) TO service_role;
