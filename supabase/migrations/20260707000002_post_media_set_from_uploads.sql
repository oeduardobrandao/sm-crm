-- Atomically set a post's media from already-uploaded R2 objects (MCP set_post_media). Everything
-- under the post-row lock: eligibility, replace-all, idempotent files reuse, old-file GC, tipo/status
-- sync. Mirrors finalize_design_render's write pattern (20260705000001:411). Coded P0001 exceptions are
-- mapped to PT in mcp/media.ts.
CREATE OR REPLACE FUNCTION post_media_set_from_uploads(
  p_conta_id uuid, p_post_id bigint, p_uploaded_by uuid, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post workflow_posts;
  v_item jsonb;
  i int := 0;
  v_new_tipo text;
  v_old bigint[];
  v_new bigint[] := '{}';
  v_fid bigint;
BEGIN
  SELECT * INTO v_post FROM workflow_posts
    WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_post.status NOT IN ('rascunho','revisao_interna','correcao_cliente','enviado_cliente') THEN
    RAISE EXCEPTION 'post_not_editable:%', v_post.status USING ERRCODE = 'P0001';
  END IF;
  IF v_post.tipo NOT IN ('feed','carrossel') THEN
    RAISE EXCEPTION 'tipo_not_image:%', v_post.tipo USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM designs WHERE post_id = p_post_id AND conta_id = p_conta_id) THEN
    RAISE EXCEPTION 'design_attached' USING ERRCODE = 'P0001';
  END IF;

  v_new_tipo := CASE WHEN jsonb_array_length(p_items) > 1 THEN 'carrossel' ELSE 'feed' END;

  SELECT COALESCE(array_agg(file_id), '{}') INTO v_old
    FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;
  DELETE FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id INTO v_fid FROM files                                        -- P2-1 idempotent reuse
      WHERE conta_id = p_conta_id AND r2_key = v_item->>'r2_key' LIMIT 1;
    IF v_fid IS NULL THEN
      v_fid := (file_insert_with_quota(jsonb_build_object(
        'conta_id', p_conta_id, 'r2_key', v_item->>'r2_key',
        'name', COALESCE(v_item->>'filename', 'post-'||p_post_id||'-'||(i+1)),
        'kind','image', 'mime_type', v_item->>'mime_type',
        'size_bytes', (v_item->>'size_bytes')::bigint,
        'width', COALESCE(v_item->>'width',''), 'height', COALESCE(v_item->>'height',''),
        'uploaded_by', p_uploaded_by))).id;                                -- raises 'quota_exceeded'
    END IF;
    INSERT INTO post_file_links(post_id, conta_id, file_id, origin, sort_order, is_cover)
      VALUES (p_post_id, p_conta_id, v_fid, 'manual', i, i = 0);
    v_new := v_new || v_fid; i := i + 1;
  END LOOP;

  DELETE FROM files                                                        -- P2-2 GC old unreused
    WHERE conta_id = p_conta_id AND id = ANY(v_old) AND id <> ALL(v_new) AND reference_count = 0;

  UPDATE workflow_posts SET
    tipo = v_new_tipo,
    status = CASE WHEN status = 'correcao_cliente' THEN 'revisao_interna' ELSE status END
  WHERE id = p_post_id;

  RETURN jsonb_build_object('post_id', p_post_id, 'item_count', i, 'tipo', v_new_tipo,
                            'status', (SELECT status FROM workflow_posts WHERE id = p_post_id));
END; $$;

REVOKE ALL ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) TO service_role;
