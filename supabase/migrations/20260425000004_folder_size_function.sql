-- Recursive function to calculate total size (bytes) and file count for a folder tree
CREATE OR REPLACE FUNCTION folder_total_size(p_folder_id bigint)
RETURNS TABLE(total_size_bytes bigint, file_count bigint) AS $$
WITH RECURSIVE tree AS (
  SELECT id FROM folders WHERE id = p_folder_id
  UNION ALL
  SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
)
SELECT
  COALESCE(SUM(fi.size_bytes), 0)::bigint AS total_size_bytes,
  COUNT(fi.id)::bigint AS file_count
FROM tree t
LEFT JOIN files fi ON fi.folder_id = t.id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
