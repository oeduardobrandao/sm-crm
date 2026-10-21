-- ============================================================
-- Instagram carousels: per-child container state, resumable across cron ticks
-- ============================================================
-- Mirrors 20260625000001_instagram_story_segments.sql. Before this, a carousel's
-- children were created AND the CAROUSEL parent assembled inside one synchronous
-- cron tick, with nothing persisted until the whole burst succeeded (prod post
-- 5093, 2026-09-17: 8 videos, failed identically on every attempt). A child is
-- never published on its own, so an element carries no media_id -- only whether
-- its container reached FINISHED before the parent is built.
-- Element shape: {file_id, kind: 'image'|'video', container_id, ready}

-- 1. Per-child state column (null for non-carousels)
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS carousel_children jsonb;

-- 2. Backfill in-flight carousels (agendado / falha_publicacao, no parent yet,
--    more than one media). ensureCarouselChildren builds this lazily anyway, so
--    this is a convenience for rows the cron will touch on its next tick, not a
--    correctness requirement. A post whose parent already exists keeps flowing
--    through the unchanged publish phase.
UPDATE workflow_posts wp
SET carousel_children = (
  SELECT jsonb_agg(
           jsonb_build_object(
             'file_id', pfl.file_id,
             'kind', CASE WHEN f.kind = 'video' THEN 'video' ELSE 'image' END,
             'container_id', NULL,
             'ready', false)
           ORDER BY pfl.sort_order)
  FROM post_file_links pfl
  JOIN files f ON f.id = pfl.file_id
  WHERE pfl.post_id = wp.id
)
WHERE COALESCE(wp.tipo, '') <> 'stories'
  AND wp.status IN ('agendado', 'falha_publicacao')
  AND wp.instagram_container_id IS NULL
  AND wp.instagram_media_id IS NULL
  AND wp.carousel_children IS NULL
  AND (SELECT count(*) FROM post_file_links pfl2 WHERE pfl2.post_id = wp.id) > 1;

-- 3. Targeted single-field child update (avoids whole-array rewrites).
--    p_value is jsonb, NOT text as in set_story_segment_field: `ready` is a
--    boolean and to_jsonb(text) would store the string "true". A SQL NULL
--    new_value makes jsonb_set return NULL for the whole column, hence the
--    COALESCE -- callers pass JSON null to clear container_id.
CREATE OR REPLACE FUNCTION set_carousel_child_field(
  p_post_id bigint,
  p_index int,
  p_field text,
  p_value jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE workflow_posts
  SET carousel_children = jsonb_set(
    COALESCE(carousel_children, '[]'::jsonb),
    ARRAY[p_index::text, p_field],
    COALESCE(p_value, 'null'::jsonb),
    true
  )
  WHERE id = p_post_id;
$$;

-- service_role only. REVOKE FROM public alone is not enough on hosted Supabase,
-- where default privileges grant EXECUTE directly to anon/authenticated
-- (house gotcha, 20260806000002).
REVOKE ALL ON FUNCTION set_carousel_child_field(bigint, int, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_carousel_child_field(bigint, int, text, jsonb) TO service_role;

-- 4. reorder_post_schedules copy-forward.
-- Canonical: 20260830000002_avulso_claim_reorder_ica.sql (section 3). Copied
-- verbatim; the ONLY change is in the non-story branch of the agendado UPDATE,
-- which now also nulls carousel_children when the post is unpublished. Without
-- it a reschedule >24h ahead keeps ready:true children whose Meta containers
-- have expired, and the next container phase would assemble a parent from dead
-- children and fail 3x identically -- the exact shape of the 5093 incident.
-- Stories already handle this here by nulling every segment's container_id.
-- hub_reorder_post_schedules (wrapper) is unchanged and keeps delegating.
CREATE OR REPLACE FUNCTION reorder_post_schedules(
  p_cliente_id       bigint,
  p_conta_id         uuid,
  p_updates          jsonb,
  p_allowed_statuses text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids       bigint[];
  v_count     int;
  v_owned     int;
  v_locked    bigint[];
  v_updated   int := 0;
  r           record;
  v_new_at    timestamptz;
  v_status    text;
  v_tipo      text;
  v_media_id  text;
  v_segments  jsonb;
BEGIN
  IF p_updates IS NULL
     OR jsonb_typeof(p_updates) <> 'array'
     OR jsonb_array_length(p_updates) = 0 THEN
    RAISE EXCEPTION 'BAD_REQUEST: empty updates';
  END IF;

  SELECT array_agg((e->>'post_id')::bigint) INTO v_ids
  FROM jsonb_array_elements(p_updates) e;

  -- A swap must reference each post at most once.
  IF (SELECT count(*) FROM unnest(v_ids)) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'BAD_REQUEST: duplicate post_id';
  END IF;
  v_count := array_length(v_ids, 1);

  -- Lock every owned target row up front, in a stable order, to serialize against
  -- claim_posts_for_publishing and any concurrent reorder.
  PERFORM 1
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.cliente_id = p_cliente_id
    AND wp.conta_id  = p_conta_id
  ORDER BY wp.id
  FOR UPDATE OF wp;

  -- Ownership: every id must resolve to a row owned by this client/account.
  SELECT count(*) INTO v_owned
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.cliente_id = p_cliente_id
    AND wp.conta_id  = p_conta_id;
  IF v_owned <> v_count THEN
    RAISE EXCEPTION 'FORBIDDEN: post outside token scope';
  END IF;

  -- Status allowlist — reject the whole batch if any post is not reschedulable.
  SELECT array_agg(wp.id) INTO v_locked
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND NOT (wp.status = ANY(p_allowed_statuses));
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED: forbidden status: %', v_locked;
  END IF;

  -- Publishing safety: an agendado row the cron is actively working on is off-limits.
  SELECT array_agg(wp.id) INTO v_locked
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.status = 'agendado'
    AND wp.publish_processing_at IS NOT NULL
    AND wp.publish_processing_at >= now() - interval '10 minutes';
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED: publishing in progress: %', v_locked;
  END IF;

  FOR r IN
    SELECT (e->>'post_id')::bigint AS pid, e->>'scheduled_at' AS at
    FROM jsonb_array_elements(p_updates) e
  LOOP
    v_new_at := CASE WHEN r.at IS NULL THEN NULL ELSE r.at::timestamptz END;

    SELECT wp.status, wp.tipo, wp.instagram_media_id, wp.story_segments
      INTO v_status, v_tipo, v_media_id, v_segments
    FROM workflow_posts wp
    WHERE wp.id = r.pid;

    IF v_status = 'agendado' THEN
      -- A scheduled post must keep a valid, not-immediate future slot.
      IF v_new_at IS NULL OR v_new_at < now() + interval '10 minutes' THEN
        RAISE EXCEPTION 'BAD_REQUEST: agendado needs a future date';
      END IF;

      IF v_tipo = 'stories' THEN
        -- Defense-in-depth: if any segment already published we must not move it;
        -- otherwise drop prepared containers so the cron rebuilds them near the new time.
        IF v_segments IS NOT NULL
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE s->>'media_id' IS NOT NULL) THEN
          RAISE EXCEPTION 'LOCKED: publishing in progress: {%}', r.pid;
        END IF;
        UPDATE workflow_posts
        SET scheduled_at = v_new_at,
            story_segments = CASE
              WHEN v_segments IS NULL THEN NULL
              ELSE (
                SELECT jsonb_agg(jsonb_set(s, '{container_id}', 'null'::jsonb))
                FROM jsonb_array_elements(v_segments) s
              )
            END
        WHERE id = r.pid;
      ELSE
        -- Non-story: clear a prepared (not-yet-published) container so a fresh one
        -- is built near the new time; never touch an already-published media.
        -- Carousel children are dropped for the same reason: their Meta containers
        -- expire in 24h and the parent is rebuilt from them (this migration).
        UPDATE workflow_posts
        SET scheduled_at = v_new_at,
            instagram_container_id = CASE
              WHEN v_media_id IS NULL THEN NULL
              ELSE instagram_container_id
            END,
            carousel_children = CASE
              WHEN v_media_id IS NULL THEN NULL
              ELSE carousel_children
            END
        WHERE id = r.pid;
      END IF;
    ELSE
      UPDATE workflow_posts SET scheduled_at = v_new_at WHERE id = r.pid;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION reorder_post_schedules(bigint, uuid, jsonb, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION reorder_post_schedules(bigint, uuid, jsonb, text[]) TO service_role;
