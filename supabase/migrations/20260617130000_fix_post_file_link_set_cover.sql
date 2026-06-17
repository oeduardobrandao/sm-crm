-- Fix: post_file_link_set_cover could raise
--   "duplicate key value violates unique constraint post_file_links_one_cover".
--
-- The previous body flipped both rows in a SINGLE statement and assumed
-- Postgres defers the partial-unique-index check to statement end. That is
-- false: a non-deferrable unique index (CREATE UNIQUE INDEX cannot be made
-- deferrable) is checked per row, mid-statement. When the target row was
-- flipped to is_cover=true BEFORE the old cover row was flipped to false,
-- two rows momentarily had is_cover=true for the same post_id and the index
-- rejected the second one. Whether it fired depended on physical row order,
-- hence the intermittent failure (the classic `UPDATE ... SET x = x + 1` trap).
--
-- Fix: clear the existing cover and promote the target in two SEPARATE
-- statements. Between statements the index is fully consistent, so no
-- transient duplicate can exist regardless of row processing order.
CREATE OR REPLACE FUNCTION post_file_link_set_cover(p_link_id bigint) RETURNS post_file_links
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_post_id bigint;
  v_row     post_file_links;
BEGIN
  SELECT post_id INTO v_post_id FROM post_file_links WHERE id = p_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'link not found'; END IF;

  -- 1) Demote whatever currently holds the cover (skip the target itself).
  UPDATE post_file_links
     SET is_cover = false
   WHERE post_id = v_post_id AND is_cover = true AND id <> p_link_id;

  -- 2) Promote the target. The is_cover = false guard keeps this idempotent
  --    when the target is already the cover.
  UPDATE post_file_links
     SET is_cover = true
   WHERE id = p_link_id AND is_cover = false;

  SELECT * INTO v_row FROM post_file_links WHERE id = p_link_id;
  RETURN v_row;
END;
$$;
