CREATE OR REPLACE FUNCTION folder_breadcrumbs(p_folder_id bigint)
RETURNS TABLE(id bigint, name text) AS $$
  WITH RECURSIVE ancestors AS (
    SELECT f.id, f.parent_id, f.name, 0 AS depth
    FROM folders f WHERE f.id = p_folder_id
    UNION ALL
    SELECT f.id, f.parent_id, f.name, a.depth + 1
    FROM folders f JOIN ancestors a ON f.id = a.parent_id
  )
  SELECT ancestors.id, ancestors.name FROM ancestors ORDER BY depth DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
