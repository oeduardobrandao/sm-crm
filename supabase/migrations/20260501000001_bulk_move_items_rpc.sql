CREATE OR REPLACE FUNCTION bulk_move_items(
  p_conta_id uuid,
  p_file_ids bigint[],
  p_folder_ids bigint[],
  p_destination_id bigint DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_file_count int;
  v_folder_count int;
  v_folder_id bigint;
  v_ancestors bigint[];
BEGIN
  -- Validate all files belong to conta_id
  IF coalesce(array_length(p_file_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_file_count
    FROM files
    WHERE id = ANY(p_file_ids) AND conta_id = p_conta_id;

    IF v_file_count <> array_length(p_file_ids, 1) THEN
      RETURN json_build_object('error', 'Some files not found or not owned', 'code', 'invalid_files');
    END IF;
  END IF;

  -- Validate all folders belong to conta_id and are not system folders
  IF coalesce(array_length(p_folder_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_folder_count
    FROM folders
    WHERE id = ANY(p_folder_ids) AND conta_id = p_conta_id AND source = 'user';

    IF v_folder_count <> array_length(p_folder_ids, 1) THEN
      RETURN json_build_object('error', 'Some folders not found, not owned, or are system folders', 'code', 'invalid_folders');
    END IF;
  END IF;

  -- Validate destination exists and belongs to conta_id (if not null / root)
  IF p_destination_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM folders WHERE id = p_destination_id AND conta_id = p_conta_id) THEN
      RETURN json_build_object('error', 'Destination folder not found', 'code', 'invalid_destination');
    END IF;

    -- Check destination is not a post system folder when moving folders
    IF array_length(p_folder_ids, 1) > 0 THEN
      IF EXISTS (SELECT 1 FROM folders WHERE id = p_destination_id AND source = 'system' AND source_type = 'post') THEN
        RETURN json_build_object('error', 'Cannot move folders into post folders', 'code', 'post_folder_restriction');
      END IF;
    END IF;

    -- Check no folder is being moved into itself or a descendant
    FOREACH v_folder_id IN ARRAY p_folder_ids LOOP
      -- Build ancestor chain from destination up to root
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM folders WHERE id = p_destination_id
        UNION ALL
        SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
      )
      SELECT array_agg(id) INTO v_ancestors FROM ancestors;

      IF v_folder_id = ANY(v_ancestors) THEN
        RETURN json_build_object(
          'error', 'Cannot move folder into itself or a descendant',
          'code', 'cycle_detected',
          'folder_id', v_folder_id
        );
      END IF;
    END LOOP;
  END IF;

  -- Perform the moves
  IF array_length(p_file_ids, 1) > 0 THEN
    UPDATE files SET folder_id = p_destination_id WHERE id = ANY(p_file_ids) AND conta_id = p_conta_id;
  END IF;

  IF coalesce(array_length(p_folder_ids, 1), 0) > 0 THEN
    UPDATE folders SET parent_id = p_destination_id, updated_at = now() WHERE id = ANY(p_folder_ids) AND conta_id = p_conta_id;
  END IF;

  RETURN json_build_object('ok', true, 'files_moved', coalesce(array_length(p_file_ids, 1), 0), 'folders_moved', coalesce(array_length(p_folder_ids, 1), 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
