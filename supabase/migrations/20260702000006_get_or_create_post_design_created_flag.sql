-- Fix an audit-log accuracy bug in get_or_create_post_design (PR 1.6 review finding): the
-- original version closes the actual create-race correctly at the DB level (on unique_violation
-- it returns the winner's row untouched), but gave post-design-manage's caller no way to tell
-- "I created this row" apart from "someone else already had". The edge function inferred
-- "created" purely from whether it had to call this RPC at all, so BOTH the race winner and the
-- loser recorded a `create` audit-log entry for the same event — the loser's entry misattributes
-- a creation it didn't perform, using the winner's row/doc contents.
--
-- Fix: return an explicit `created` flag computed atomically inside the same function, so the
-- caller can audit-log accurately. Return type changes (post_designs -> TABLE with an added
-- `created boolean`), which Postgres requires DROP + CREATE for (CREATE OR REPLACE cannot change
-- a function's return type) — safe here since this RPC has exactly one caller in committed code
-- (post-design-manage, shipping in this same PR) and no other consumer exists yet.
--
-- Only the columns post-design-manage's caller actually uses are returned (id, doc, rev,
-- render_status, is_stale) rather than mirroring every post_designs column — this RPC has no
-- other consumer to keep a wider shape for.

DROP FUNCTION IF EXISTS get_or_create_post_design(uuid, bigint, jsonb, int, uuid);

CREATE FUNCTION get_or_create_post_design(
  p_conta_id uuid, p_post_id bigint, p_starter_doc jsonb, p_doc_version int, p_updated_by uuid
) RETURNS TABLE (
  id bigint, doc jsonb, rev int, render_status text, is_stale boolean, created boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row post_designs;
  v_created boolean := false;
BEGIN
  -- No tipo sync: the starter doc's format is derived from the post's OWN current tipo by
  -- the caller, so there is nothing to reconcile on a first read.
  PERFORM post_design_check_and_sync(p_conta_id, p_post_id, NULL);

  SELECT * INTO v_row FROM post_designs pd WHERE pd.post_id = p_post_id AND pd.conta_id = p_conta_id;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO post_designs (post_id, conta_id, doc, doc_version, updated_via, updated_by)
      VALUES (p_post_id, p_conta_id, p_starter_doc, p_doc_version, 'human', p_updated_by)
      RETURNING * INTO v_row;
      v_created := true;
    EXCEPTION WHEN unique_violation THEN
      -- Lost a create race to a concurrent request; return what they created, untouched.
      -- v_created stays false — this caller did not create anything.
      SELECT * INTO v_row FROM post_designs pd WHERE pd.post_id = p_post_id AND pd.conta_id = p_conta_id;
    END;

    IF v_created THEN
      PERFORM post_design_diff_asset_refs(v_row.id, p_conta_id, p_starter_doc);
    END IF;
  END IF;

  RETURN QUERY SELECT v_row.id, v_row.doc, v_row.rev, v_row.render_status, v_row.is_stale, v_created;
END;
$$;

REVOKE ALL ON FUNCTION get_or_create_post_design(uuid, bigint, jsonb, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_post_design(uuid, bigint, jsonb, int, uuid) TO service_role;
