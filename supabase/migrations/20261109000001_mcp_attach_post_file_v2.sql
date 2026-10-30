-- MCP Apps cards: the multi-image attach card (spec
-- docs/superpowers/specs/2026-10-29-mcp-attach-multi-images-design.md) sends one image per call, in
-- sequence. mcp_attach_post_file (20261105000002) alone is not safe for that:
--   * a call whose outcome is unknown (transport error after a commit) that the card retries would
--     append the same image twice and shift every later one;
--   * the card computed its positions from the post as it was when it opened: a CRM edit meanwhile
--     would make "replace slide 3" overwrite a different slide;
--   * "Substituir os slides atuais" with fewer images must drop the old slides after the last one in
--     the same transaction, or a concurrent editor's new slide could be deleted.
--
-- mcp_attach_post_file_v2 takes the post row lock FIRST (FOR UPDATE, the same lock the v1 RPC, the
-- CRM's post_file_link_replace and the publishers take), checks what the card expected, then runs v1
-- (re-entering the lock it already holds in this transaction) and, with p_trim_after, deletes the
-- links after p_position. All in one transaction: any raise rolls everything back.
--
-- Expected state, checked against the links in visible order (sort_order, id), before v1 renumbers:
--   * p_replace = true:  p_expected_link_id must be the id of the link at p_position. A replace keeps
--     the link id, so a retried replace still matches (it re-replaces the same slide: harmless).
--   * p_replace = false: p_expected_count must equal the post's current link count. A retried append
--     whose first try committed sees one more link and is refused instead of duplicating.
--   Mismatch, or the expectation missing: P0001 stale_post (the card asks to reopen it).
-- p_trim_after: after the attach, links with sort_order >= p_position go (v1 left them 0..n-1). The
-- files stay in Arquivos; trg_post_file_link_reassign_cover and the ref-count triggers run as for any
-- link delete. tipo is not recomputed (a carrossel left with one slide stays carrossel, as in the CRM
-- editor); v1 already moved correcao_cliente to revisao_interna.
--
-- Membership is checked before the lock, as in v1 (P0403 workspace_unavailable). v1 stays in place
-- for the mcp function deployed before this one; a later migration drops it.
CREATE OR REPLACE FUNCTION public.mcp_attach_post_file_v2(
  p_conta_id uuid,
  p_post_id bigint,
  p_actor uuid,
  p_file jsonb,
  p_position int,
  p_replace boolean,
  p_expected_count int,
  p_expected_link_id bigint,
  p_trim_after boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n int;
  v_link_at bigint;
  v_res jsonb;
  v_trimmed int := 0;
BEGIN
  PERFORM 1 FROM public.workspace_members
    WHERE user_id = p_actor AND workspace_id = p_conta_id
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'workspace_unavailable';
  END IF;

  PERFORM 1 FROM public.workflow_posts WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001'; END IF;

  IF COALESCE(p_replace, false) THEN
    SELECT id INTO v_link_at FROM (
      SELECT id, row_number() OVER (ORDER BY sort_order, id) AS pos
        FROM public.post_file_links WHERE post_id = p_post_id
    ) o WHERE o.pos = p_position;
    IF p_expected_link_id IS NULL OR v_link_at IS DISTINCT FROM p_expected_link_id THEN
      RAISE EXCEPTION 'stale_post' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT count(*) INTO v_n FROM public.post_file_links WHERE post_id = p_post_id;
    IF p_expected_count IS NULL OR v_n <> p_expected_count THEN
      RAISE EXCEPTION 'stale_post' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_res := public.mcp_attach_post_file(p_conta_id, p_post_id, p_actor, p_file, p_position, p_replace);

  IF COALESCE(p_trim_after, false) THEN
    DELETE FROM public.post_file_links WHERE post_id = p_post_id AND sort_order >= p_position;
    GET DIAGNOSTICS v_trimmed = ROW_COUNT;
  END IF;

  RETURN v_res || jsonb_build_object('trimmed', v_trimmed);
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_attach_post_file_v2(uuid, bigint, uuid, jsonb, int, boolean, int, bigint, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_attach_post_file_v2(uuid, bigint, uuid, jsonb, int, boolean, int, bigint, boolean)
  TO service_role;
