-- Purge, 30-day expiry and orphan-release RPCs for the Google integration
-- (spec docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md, sections 4.2,
-- 4.6 and 5.2 step 5; Phase 2 plan task 3, rulings P2, P3 and P4).
--
-- youtube_purge_channel: YouTube API data is deleted at once on unlink and on invalid_grant
--   (spec 4.6). Deletes every youtube_* history row for (conta_id, channel_id), strips the
--   'youtube' key from that client's report_documents.data_snapshot and, where the key was there
--   and a PDF exists, queues the PDF in youtube_pdf_purges and clears pdf_storage_path/
--   pdf_generated_at. The calling function deletes the Storage objects after commit;
--   youtube-sync-cron retries leftovers. Returns the number of PDFs queued and writes one
--   audit_log row ('youtube-data-purged'). Phase 2 leaves the report layout alone (P2): no layout
--   can hold youtube_* blocks yet and report_documents has no youtube_channel_id. Phase 4 re-creates
--   this function with the layout block/section removal and youtube_channel_id = NULL.
--   Every delete is bounded by the primary-key prefix (conta_id, channel_id), so the purge stays
--   cheap inside google_mark_revoked, which runs while getFreshGoogleToken holds refresh_lock_at.
-- google_unlink_youtube / google_mark_revoked: the Phase 1 bodies (20261108000003) with the purge
--   added. The unlink purges with the channel_id its locked DELETE returned; mark_revoked purges
--   every channel it flips to 'revoked' and resets its cached stats, avatar and watermarks (P3:
--   title and handle stay for the "Reconectar" card, a reconnect re-backfills from NULL
--   watermarks). A second mark_revoked flips nothing, so it purges nothing.
-- google_expire_units: 30 days after a GMN unit was disconnected or revoked, its history and row
--   go; 30 days after a YouTube revoke, the channel is purged again (backstop for anything written
--   after the first purge) and its row goes. No sub lock on purpose (review M1): a sub left unused
--   is released by the next orphan sweep, and a reconnect racing an expiry re-inserts the channel
--   in the callback. Each row is deleted first, with its expiry condition re-checked, and its
--   history only when that delete hit: a unit reactivated by a concurrent reconnect keeps it.
-- google_orphan_subs / google_release_sub (P4): the orphan sweep lists subs no longer in use
--   (read-only), then releases them one call (one transaction, one sub lock) each.
--
-- All functions are SECURITY DEFINER with EXECUTE for service_role only.

SET LOCAL lock_timeout = '5s';

-- ============ (1) youtube_purge_channel ============
CREATE OR REPLACE FUNCTION public.youtube_purge_channel(
  p_conta_id uuid,
  p_channel_id text,
  p_client_id bigint
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows bigint := 0;
  v_n bigint;
  v_queued int;
BEGIN
  DELETE FROM public.youtube_video_daily WHERE conta_id = p_conta_id AND channel_id = p_channel_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;
  DELETE FROM public.youtube_videos WHERE conta_id = p_conta_id AND channel_id = p_channel_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;
  DELETE FROM public.youtube_channel_daily WHERE conta_id = p_conta_id AND channel_id = p_channel_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;
  DELETE FROM public.youtube_traffic_daily WHERE conta_id = p_conta_id AND channel_id = p_channel_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;
  DELETE FROM public.youtube_demographics WHERE conta_id = p_conta_id AND channel_id = p_channel_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- Lock the client's YouTube reports first, so a PDF export committing between the queue insert
  -- and the update cannot have its new path cleared without being queued.
  PERFORM 1 FROM public.report_documents
    WHERE conta_id = p_conta_id AND client_id = p_client_id AND data_snapshot ? 'youtube'
    FOR UPDATE;

  INSERT INTO public.youtube_pdf_purges (conta_id, client_id, storage_path)
  SELECT p_conta_id, p_client_id, rd.pdf_storage_path
    FROM public.report_documents rd
   WHERE rd.conta_id = p_conta_id AND rd.client_id = p_client_id AND rd.data_snapshot ? 'youtube'
     AND rd.pdf_storage_path IS NOT NULL;
  GET DIAGNOSTICS v_queued = ROW_COUNT;

  UPDATE public.report_documents rd
     SET data_snapshot = rd.data_snapshot - 'youtube',
         pdf_storage_path = NULL,
         pdf_generated_at = CASE WHEN rd.pdf_storage_path IS NULL THEN rd.pdf_generated_at END
   WHERE rd.conta_id = p_conta_id AND rd.client_id = p_client_id AND rd.data_snapshot ? 'youtube';

  INSERT INTO public.audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (p_conta_id, NULL, 'youtube-data-purged', 'youtube_channel', p_channel_id,
          jsonb_build_object('client_id', p_client_id, 'history_rows_deleted', v_rows,
                             'pdfs_queued', v_queued));

  RETURN v_queued;
END;
$$;
REVOKE ALL ON FUNCTION public.youtube_purge_channel(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_purge_channel(uuid, text, bigint) TO service_role;

-- ============ (2) google_unlink_youtube (Phase 1 body + purge) ============
CREATE OR REPLACE FUNCTION public.google_unlink_youtube(p_conta_id uuid, p_client_id bigint)
RETURNS TABLE(should_revoke boolean, revocation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_sub text;
  v_conn uuid;
  v_channel text;
  v_sub_now text;
BEGIN
  SELECT gc.google_sub INTO v_sub
    FROM public.youtube_channels yc
    JOIN public.google_connections gc ON gc.id = yc.connection_id
   WHERE yc.conta_id = p_conta_id AND yc.client_id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'youtube channel not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('google-sub:' || v_sub));

  -- Re-check after the wait: a concurrent unlink may have removed the row meanwhile.
  DELETE FROM public.youtube_channels WHERE conta_id = p_conta_id AND client_id = p_client_id
    RETURNING connection_id, channel_id INTO v_conn, v_channel;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'youtube channel not found' USING ERRCODE = 'P0002';
  END IF;

  -- Purge with the channel the locked DELETE returned, never one read before the lock (spec 4.6).
  PERFORM public.youtube_purge_channel(p_conta_id, v_channel, p_client_id);

  -- The sub read before the lock may be stale: the row may have been relinked to another
  -- connection while this call waited. Xact advisory locks cannot be released, so lock the sub
  -- actually referenced at delete time as well, and run the in-use check on that one.
  SELECT google_sub INTO v_sub_now FROM public.google_connections WHERE id = v_conn;
  IF v_sub_now IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;
  IF v_sub_now <> v_sub THEN
    PERFORM pg_advisory_xact_lock(hashtext('google-sub:' || v_sub_now));
  END IF;

  RETURN QUERY SELECT r.should_revoke, r.revocation_id FROM public._google_revoke_if_unused(v_sub_now) r;
END;
$$;
REVOKE ALL ON FUNCTION public.google_unlink_youtube(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_unlink_youtube(uuid, bigint) TO service_role;

-- ============ (3) google_mark_revoked (Phase 1 body + purge) ============
-- Only the channels this call flips from 'active' are purged and reset, so a second call is a
-- no-op. refresh_lock_at is still never touched (_shared/google.ts holds it and releases it).
CREATE OR REPLACE FUNCTION public.google_mark_revoked(p_connection_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub text;
  v_ch record;
BEGIN
  -- Same per-sub lock as the unlink/upsert paths, so a revocation cannot interleave with an
  -- in-use check. Unknown id: nothing to do.
  SELECT google_sub INTO v_sub FROM public.google_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('google-sub:' || v_sub));

  UPDATE public.google_connections
     SET status = 'revoked'
   WHERE id = p_connection_id AND status <> 'revoked';
  -- P3: cached stats, avatar and watermarks are reset with the flip (a reconnect re-backfills);
  -- title and handle stay so the "Reconectar" card can name the channel.
  FOR v_ch IN
    UPDATE public.youtube_channels
       SET authorization_status = 'revoked', revoked_at = now(),
           subscriber_count = NULL, view_count = NULL, video_count = NULL,
           shorts_count = NULL, long_count = NULL, avatar_url = NULL,
           data_through = NULL, content_type_through = NULL,
           traffic_through = NULL, videos_through = NULL
     WHERE connection_id = p_connection_id AND authorization_status = 'active'
    RETURNING conta_id, channel_id, client_id
  LOOP
    PERFORM public.youtube_purge_channel(v_ch.conta_id, v_ch.channel_id, v_ch.client_id);
  END LOOP;
  UPDATE public.gbp_locations
     SET status = 'revoked', disconnected_at = now()
   WHERE connection_id = p_connection_id AND status = 'active';
END;
$$;
REVOKE ALL ON FUNCTION public.google_mark_revoked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_mark_revoked(uuid) TO service_role;

-- ============ (4) google_expire_units ============
CREATE OR REPLACE FUNCTION public.google_expire_units()
RETURNS TABLE(gbp_locations_deleted int, youtube_channels_deleted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_loc record;
  v_ch record;
  v_gbp int := 0;
  v_yt int := 0;
BEGIN
  -- GMN: the row first (condition re-checked under its row lock), then its history in all four
  -- tables, keyed by the unit's own conta_id.
  FOR v_loc IN
    DELETE FROM public.gbp_locations
     WHERE status IN ('disconnected', 'revoked')
       AND disconnected_at < now() - interval '30 days'
    RETURNING conta_id, location_name
  LOOP
    DELETE FROM public.gbp_metrics_daily
     WHERE conta_id = v_loc.conta_id AND location_name = v_loc.location_name;
    DELETE FROM public.gbp_search_keywords_monthly
     WHERE conta_id = v_loc.conta_id AND location_name = v_loc.location_name;
    DELETE FROM public.gbp_reviews
     WHERE conta_id = v_loc.conta_id AND location_name = v_loc.location_name;
    DELETE FROM public.gbp_rating_daily
     WHERE conta_id = v_loc.conta_id AND location_name = v_loc.location_name;
    v_gbp := v_gbp + 1;
  END LOOP;

  -- YouTube: the row, then the backstop purge (P3) with its own (conta_id, channel_id, client_id).
  FOR v_ch IN
    DELETE FROM public.youtube_channels
     WHERE authorization_status = 'revoked'
       AND revoked_at < now() - interval '30 days'
    RETURNING conta_id, channel_id, client_id
  LOOP
    PERFORM public.youtube_purge_channel(v_ch.conta_id, v_ch.channel_id, v_ch.client_id);
    v_yt := v_yt + 1;
  END LOOP;

  RETURN QUERY SELECT v_gbp, v_yt;
END;
$$;
REVOKE ALL ON FUNCTION public.google_expire_units() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_expire_units() TO service_role;

-- ============ (5) google_orphan_subs ============
-- Read-only list of subs no longer in use. The predicate is _google_revoke_if_unused's in-use
-- test (20261108000003), evaluated per sub across every workspace's connections: no connection
-- of the sub authorized in the last hour, no channel and no active or revoked unit on any of
-- them. Change the two together. The sweep then calls google_release_sub per sub, which re-runs
-- the test under the sub lock, so a sub that came back into use meanwhile is left alone.
CREATE OR REPLACE FUNCTION public.google_orphan_subs(p_limit int)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.google_sub
    FROM (SELECT DISTINCT google_sub FROM public.google_connections) s
   WHERE NOT EXISTS (
           SELECT 1 FROM public.google_connections gc
            WHERE gc.google_sub = s.google_sub AND gc.authorized_at > now() - interval '1 hour')
     AND NOT EXISTS (
           SELECT 1 FROM public.youtube_channels yc
             JOIN public.google_connections gc ON gc.id = yc.connection_id
            WHERE gc.google_sub = s.google_sub)
     AND NOT EXISTS (
           SELECT 1 FROM public.gbp_locations gl
             JOIN public.google_connections gc ON gc.id = gl.connection_id
            WHERE gc.google_sub = s.google_sub AND gl.status IN ('active', 'revoked'))
   ORDER BY s.google_sub
   LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.google_orphan_subs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_orphan_subs(int) TO service_role;

-- ============ (6) google_release_sub ============
-- One sub per call (P4): the cron runs each call in its own transaction, so it never holds two
-- sub locks at once. A sub already released returns (false, NULL).
CREATE OR REPLACE FUNCTION public.google_release_sub(p_sub text)
RETURNS TABLE(should_revoke boolean, revocation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_sub IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('google-sub:' || p_sub));
  RETURN QUERY SELECT r.should_revoke, r.revocation_id FROM public._google_revoke_if_unused(p_sub) r;
END;
$$;
REVOKE ALL ON FUNCTION public.google_release_sub(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_release_sub(text) TO service_role;
