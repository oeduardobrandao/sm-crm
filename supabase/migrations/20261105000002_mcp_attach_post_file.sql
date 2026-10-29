-- MCP Apps cards: attach a chat image to slide N of a post (spec
-- docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md §4.6). The mcp
-- function has already fetched, sniffed and uploaded the image to
-- contas/<conta>/files/<uuid>.<ext>; this RPC does the database half in one
-- transaction: membership, post lock, eligibility, quota-charged files row and
-- the link. On any error the caller enqueues the uploaded key in file_deletions.
--
-- Membership is workspace_members ONLY (the MCP conta_id comes from the grant,
-- not profiles.active_workspace_id). The post row is locked FOR UPDATE, the
-- same row lock post_file_link_replace takes and the publishers take when they
-- claim a post: two clicks serialize with each other and with a publisher's
-- claim. It does not wait for a publish already in flight (the claim has
-- committed and released the lock), which is why a post with any publish marker
-- set is refused below, whatever its status says.
--
-- Eligibility mirrors post_file_link_replace (20260916000001): status in the
-- editable list, tipo feed or carrossel, and no publish marker (published_at,
-- instagram_media_id, instagram_container_id, publish_processing_at,
-- tiktok_publish_processing_at, tiktok_publish_status initiated/processing/
-- published, story_segments). A published post moved back to revisao_interna by
-- a plain status UPDATE keeps those markers and stays refused (post_published).
--
-- p_file is checked as defense in depth even though the caller built it: the key
-- must live under contas/<p_conta_id>/files/ and the mime must be JPEG or PNG
-- (invalid_file). conta_id, uploaded_by and kind come from the RPC; folder_id
-- and thumbnail_r2_key are forced to NULL.
--
-- Positions are 1-based; post_file_links.sort_order is 0-based. sort_order is
-- not guaranteed contiguous (link deletes never compact it and post-media-manage
-- PATCH writes any value), so the post's links are first renumbered 0..n-1 in
-- their visible order (sort_order, id). A sort_order-only UPDATE fires no
-- post_file_links trigger.
--
-- append (p_replace = false): at most 10 items (media_full, checked before the
--   files row exists), 1 <= p_position <= n + 1. Later links shift by one. At
--   position 1 the current cover is demoted first, then the new link is inserted
--   as the cover: post_file_links_one_cover is a non-deferrable partial unique
--   index. An empty post gets its cover from post_file_link_auto_cover.
-- replace (p_replace = true): 1 <= p_position <= n, allowed at 10 items. Only
--   file_id changes, so the link keeps its id, sort_order and is_cover (deleting
--   and re-inserting would fire post_file_link_reassign_cover and move the
--   cover). trg_file_ref_count_upd moves the reference count; the old file stays
--   in Arquivos.
-- Afterwards a feed with more than one item becomes carrossel and a post in
-- correcao_cliente moves to revisao_interna, as post_media_set_from_uploads does.
-- That move is recorded in post_status_events as a workspace_user change by
-- p_actor (same transaction-local settings as mcp_send_post_to_client).
--
-- Errors (P0001, mapped to pt-BR in the mcp function): invalid_position,
-- post_not_found, post_not_editable:<status>, tipo_not_image:<tipo>,
-- post_published, media_full, invalid_file, and quota_exceeded from
-- file_insert_with_quota. A non-member actor raises P0403 workspace_unavailable.
CREATE OR REPLACE FUNCTION public.mcp_attach_post_file(
  p_conta_id uuid,
  p_post_id bigint,
  p_actor uuid,
  p_file jsonb,
  p_position int,
  p_replace boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post public.workflow_posts%ROWTYPE;
  v_n int;
  v_replace boolean := COALESCE(p_replace, false);
  v_file public.files%ROWTYPE;
  v_link public.post_file_links%ROWTYPE;
  v_tipo text;
  v_status text;
BEGIN
  PERFORM 1 FROM public.workspace_members
    WHERE user_id = p_actor AND workspace_id = p_conta_id
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'workspace_unavailable';
  END IF;

  SELECT * INTO v_post FROM public.workflow_posts
    WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_post.status NOT IN ('rascunho', 'revisao_interna', 'correcao_cliente') THEN
    RAISE EXCEPTION 'post_not_editable:%', v_post.status USING ERRCODE = 'P0001';
  END IF;
  IF v_post.tipo NOT IN ('feed', 'carrossel') THEN
    RAISE EXCEPTION 'tipo_not_image:%', v_post.tipo USING ERRCODE = 'P0001';
  END IF;
  IF v_post.published_at IS NOT NULL OR v_post.instagram_media_id IS NOT NULL OR
     v_post.publish_processing_at IS NOT NULL OR
     v_post.tiktok_publish_processing_at IS NOT NULL OR
     v_post.tiktok_publish_status IN ('initiated', 'processing', 'published') OR
     v_post.instagram_container_id IS NOT NULL OR v_post.story_segments IS NOT NULL THEN
    RAISE EXCEPTION 'post_published' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.post_file_links l
     SET sort_order = o.pos
    FROM (SELECT id, (row_number() OVER (ORDER BY sort_order, id) - 1)::int AS pos
            FROM public.post_file_links WHERE post_id = p_post_id) o
   WHERE l.id = o.id AND l.sort_order <> o.pos;

  SELECT count(*) INTO v_n FROM public.post_file_links WHERE post_id = p_post_id;

  IF v_replace THEN
    IF p_position IS NULL OR p_position < 1 OR p_position > v_n THEN
      RAISE EXCEPTION 'invalid_position' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF v_n >= 10 THEN RAISE EXCEPTION 'media_full' USING ERRCODE = 'P0001'; END IF;
    IF p_position IS NULL OR p_position < 1 OR p_position > v_n + 1 THEN
      RAISE EXCEPTION 'invalid_position' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF (p_file->>'r2_key' LIKE 'contas/' || p_conta_id::text || '/files/%') IS NOT TRUE OR
     (p_file->>'mime_type' IN ('image/jpeg', 'image/png')) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid_file' USING ERRCODE = 'P0001';
  END IF;

  -- Workspace, uploader, kind, folder and thumbnail come from the RPC, never the payload.
  v_file := public.file_insert_with_quota(p_file || jsonb_build_object(
    'conta_id', p_conta_id, 'uploaded_by', p_actor, 'kind', 'image',
    'folder_id', NULL, 'thumbnail_r2_key', NULL));  -- raises 'quota_exceeded'

  IF v_replace THEN
    UPDATE public.post_file_links SET file_id = v_file.id
     WHERE post_id = p_post_id AND sort_order = p_position - 1
    RETURNING * INTO v_link;
  ELSE
    UPDATE public.post_file_links SET sort_order = sort_order + 1
     WHERE post_id = p_post_id AND sort_order >= p_position - 1;
    IF p_position = 1 THEN
      UPDATE public.post_file_links SET is_cover = false WHERE post_id = p_post_id AND is_cover;
    END IF;
    INSERT INTO public.post_file_links (post_id, conta_id, file_id, origin, sort_order, is_cover)
      VALUES (p_post_id, p_conta_id, v_file.id, 'manual', p_position - 1, p_position = 1)
    RETURNING * INTO v_link;  -- is_cover as stored: post_file_link_auto_cover may have set it
  END IF;

  v_tipo := CASE
    WHEN v_post.tipo = 'feed' AND v_n + CASE WHEN v_replace THEN 0 ELSE 1 END > 1 THEN 'carrossel'
    ELSE v_post.tipo
  END;
  v_status := CASE WHEN v_post.status = 'correcao_cliente' THEN 'revisao_interna' ELSE v_post.status END;
  IF v_tipo IS DISTINCT FROM v_post.tipo OR v_status IS DISTINCT FROM v_post.status THEN
    PERFORM set_config('app.actor_id', p_actor::text, true);
    PERFORM set_config('app.event_source', 'workspace_user', true);
    UPDATE public.workflow_posts SET tipo = v_tipo, status = v_status WHERE id = p_post_id;
  END IF;

  RETURN jsonb_build_object(
    'link_id', v_link.id,
    'file_id', v_link.file_id,
    'sort_order', v_link.sort_order,
    'is_cover', v_link.is_cover,
    'tipo', v_tipo);
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_attach_post_file(uuid, bigint, uuid, jsonb, int, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_attach_post_file(uuid, bigint, uuid, jsonb, int, boolean)
  TO service_role;
