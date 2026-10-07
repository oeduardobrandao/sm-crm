-- RPCs de leitura dos contatos das automações. SECURITY INVOKER: a RLS das
-- tabelas (mesmo predicado de ica_select) faz o filtro de tenant/permissão.

CREATE OR REPLACE FUNCTION list_instagram_automation_contacts(
  p_client_id      bigint      DEFAULT NULL,
  p_automation_id  uuid        DEFAULT NULL,
  p_from           timestamptz DEFAULT NULL,
  p_to             timestamptz DEFAULT NULL,
  p_reached_only   boolean     DEFAULT true,
  p_search         text        DEFAULT NULL,
  p_limit          int         DEFAULT 50,
  p_offset         int         DEFAULT 0,
  p_export         boolean     DEFAULT false,
  p_cursor_at      timestamptz DEFAULT NULL,
  p_cursor_id      uuid        DEFAULT NULL)
RETURNS TABLE (
  id uuid, client_id bigint, commenter_username text,
  first_interaction_at timestamptz, last_interaction_at timestamptz,
  interactions_count int, reached boolean, last_comment_text text,
  automation_id uuid, automation_name text, automation_deleted boolean,
  created_at timestamptz, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (
    SELECT c.id, c.client_id, c.commenter_username, c.created_at,
           CASE WHEN p_automation_id IS NULL THEN c.first_interaction_at ELSE l.first_interaction_at END AS first_interaction_at,
           CASE WHEN p_automation_id IS NULL THEN c.last_interaction_at ELSE l.last_interaction_at END AS last_interaction_at,
           CASE WHEN p_automation_id IS NULL THEN c.interactions_count ELSE l.interactions_count END AS interactions_count,
           CASE WHEN p_automation_id IS NULL THEN c.reached ELSE l.reached END AS reached,
           CASE WHEN p_automation_id IS NULL THEN c.last_comment_text ELSE l.last_comment_text END AS last_comment_text,
           CASE WHEN p_automation_id IS NULL THEN c.last_automation_id ELSE l.automation_id END AS automation_id,
           CASE WHEN p_automation_id IS NULL THEN c.last_automation_name ELSE l.automation_name END AS automation_name
      FROM instagram_automation_contacts c
      LEFT JOIN instagram_automation_contact_automations l
        ON p_automation_id IS NOT NULL AND l.contact_id = c.id AND l.automation_id = p_automation_id
     WHERE (p_automation_id IS NULL OR l.contact_id IS NOT NULL)
       AND (p_client_id IS NULL OR c.client_id = p_client_id)
  ), filtered AS (
    SELECT b.* FROM base b
     WHERE (NOT coalesce(p_reached_only, true) OR b.reached)
       AND (p_from IS NULL OR b.last_interaction_at >= p_from)
       AND (p_to IS NULL OR b.last_interaction_at < p_to)
       AND (coalesce(p_search, '') = ''
            OR b.commenter_username ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), counted AS (
    SELECT f.*, count(*) OVER () AS total_count FROM filtered f
  )
  SELECT x.id, x.client_id, x.commenter_username, x.first_interaction_at, x.last_interaction_at,
         x.interactions_count, x.reached, x.last_comment_text, x.automation_id, x.automation_name,
         (x.automation_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM instagram_comment_automations a WHERE a.id = x.automation_id)) AS automation_deleted,
         x.created_at, x.total_count
    FROM counted x
   WHERE NOT coalesce(p_export, false) OR p_cursor_at IS NULL
      OR (x.created_at, x.id) > (p_cursor_at, p_cursor_id)
   ORDER BY
     CASE WHEN coalesce(p_export, false) THEN x.created_at END ASC,
     CASE WHEN coalesce(p_export, false) THEN x.id END ASC,
     CASE WHEN NOT coalesce(p_export, false) THEN x.last_interaction_at END DESC,
     CASE WHEN NOT coalesce(p_export, false) THEN x.id END DESC
   LIMIT greatest(1, least(coalesce(p_limit, 50), 500))
  OFFSET CASE WHEN coalesce(p_export, false) THEN 0 ELSE greatest(0, coalesce(p_offset, 0)) END;
$$;

REVOKE EXECUTE ON FUNCTION list_instagram_automation_contacts(bigint, uuid, timestamptz, timestamptz, boolean, text, int, int, boolean, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION list_instagram_automation_contacts(bigint, uuid, timestamptz, timestamptz, boolean, text, int, int, boolean, timestamptz, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION instagram_automation_contact_counts()
RETURNS TABLE (
  automation_id uuid, automation_name text, client_id bigint,
  automation_deleted boolean, reached_count bigint, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT l.automation_id, max(l.automation_name), c.client_id,
         NOT EXISTS (SELECT 1 FROM instagram_comment_automations a WHERE a.id = l.automation_id),
         count(*) FILTER (WHERE l.reached), count(*)
    FROM instagram_automation_contact_automations l
    JOIN instagram_automation_contacts c ON c.id = l.contact_id
   GROUP BY l.automation_id, c.client_id;
$$;

REVOKE EXECUTE ON FUNCTION instagram_automation_contact_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION instagram_automation_contact_counts() TO authenticated, service_role;
