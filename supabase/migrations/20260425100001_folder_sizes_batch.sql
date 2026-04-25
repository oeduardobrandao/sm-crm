CREATE OR REPLACE FUNCTION folder_sizes_batch(p_folder_ids bigint[])
RETURNS TABLE(folder_id bigint, total_size_bytes bigint, file_count bigint) AS $$
  SELECT sub.folder_id, sub.total_size_bytes, sub.file_count
  FROM unnest(p_folder_ids) AS input(folder_id)
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(SUM(fi.size_bytes), 0)::bigint AS total_size_bytes,
      COUNT(fi.id)::bigint AS file_count
    FROM (
      WITH RECURSIVE tree AS (
        SELECT id FROM folders WHERE id = input.folder_id
        UNION ALL
        SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
      )
      SELECT id FROM tree
    ) t
    LEFT JOIN files fi ON fi.folder_id = t.id
  ) sub;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
