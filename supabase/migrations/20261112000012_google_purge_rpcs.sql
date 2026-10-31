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
--   Then an orphan pass: history rows whose unit row no longer exists in its link table
--   (youtube_channels by (conta_id, channel_id), gbp_locations by (conta_id, location_name)) are
--   deleted, at most 10,000 rows per table per call. That is how history leaves after a
--   client or workspace delete, which cascades the link rows away while the history tables have
--   no FK by design. A disconnected GMN unit keeps its row for its 30 days, so the pass never
--   fights the soft delete; an expired unit's history is already gone by then (deleted above).
-- google_workspace_release_identities (BEFORE DELETE trigger on workspaces): the cascade would
--   drop the workspace's google_connections with their tokens, never revoked at Google. For each
--   sub of the workspace (sub locks taken first, in sub order) it deletes the workspace's channel
--   and unit rows, ends the fresh-connection grace for the workspace's own connections, and runs
--   google_release_sub, so spec 4.2 still decides: the grant is revoked (a google_revocations row,
--   retried by gbp-sync-cron) only when no OTHER workspace still uses the identity. History is
--   left to the orphan pass above.
-- google_orphan_subs / google_release_sub (P4): the orphan sweep lists subs no longer in use
--   (read-only), then releases them one call (one transaction, one sub lock) each.
--
-- All functions are SECURITY DEFINER with EXECUTE for service_role only (the trigger function
-- is not callable outside its trigger anyway).

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
RETURNS TABLE(gbp_locations_deleted int, youtube_channels_deleted int,
              orphan_youtube_rows_deleted int, orphan_gbp_rows_deleted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Per table per call: the cron runs hourly, so a large orphaned channel drains over a few runs.
  c_orphan_batch CONSTANT int := 10000;
  v_loc record;
  v_ch record;
  v_gbp int := 0;
  v_yt int := 0;
  v_orphan_yt int := 0;
  v_orphan_gbp int := 0;
  v_n int;
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

  -- Orphan pass (after the expiries, so it only counts what a client or workspace delete left
  -- behind). Plain deletes, not youtube_purge_channel: the client is gone (report_documents went
  -- with it) and the purge's audit row would name a workspace that may no longer exist. Each
  -- delete is keyed by the history row's own (conta_id, unit), the link tables' unique keys.
  DELETE FROM public.youtube_video_daily WHERE ctid = ANY (ARRAY(
    SELECT h.ctid FROM public.youtube_video_daily h
     WHERE NOT EXISTS (SELECT 1 FROM public.youtube_channels c
                        WHERE c.conta_id = h.conta_id AND c.channel_id = h.channel_id)
     LIMIT c_orphan_batch));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_orphan_yt := v_orphan_yt + v_n;
  DELETE FROM public.youtube_videos WHERE ctid = ANY (ARRAY(
    SELECT h.ctid FROM public.youtube_videos h
     WHERE NOT EXISTS (SELECT 1 FROM public.youtube_channels c
                        WHERE c.conta_id = h.conta_id AND c.channel_id = h.channel_id)
     LIMIT c_orphan_batch));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_orphan_yt := v_orphan_yt + v_n;
  DELETE FROM public.youtube_channel_daily WHERE ctid = ANY (ARRAY(
    SELECT h.ctid FROM public.youtube_channel_daily h
     WHERE NOT EXISTS (SELECT 1 FROM public.youtube_channels c
                        WHERE c.conta_id = h.conta_id AND c.channel_id = h.channel_id)
     LIMIT c_orphan_batch));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_orphan_yt := v_orphan_yt + v_n;
  DELETE FROM public.youtube_traffic_daily WHERE ctid = ANY (ARRAY(
    SELECT h.ctid FROM public.youtube_traffic_daily h
     WHERE NOT EXISTS (SELECT 1 FROM public.youtube_channels c
                        WHERE c.conta_id = h.conta_id AND c.channel_id = h.channel_id)
     LIMIT c_orphan_batch));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_orphan_yt := v_orphan_yt + v_n;
  DELETE FROM public.youtube_demographics WHERE ctid = ANY (ARRAY(
    SELECT h.ctid FROM public.youtube_demographics h
     WHERE NOT EXISTS (SELECT 1 FROM public.youtube_channels c
                        WHERE c.conta_id = h.conta_id AND c.channel_id = h.channel_id)
     LIMIT c_orphan_batch));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_orphan_yt := v_orphan_yt + v_n;
  DELETE FROM public.gbp_metrics_daily WHERE ctid = ANY (ARRAY(
    SELECT h.ctid FROM public.gbp_metrics_daily h
     WHERE NOT EXISTS (SELECT 1 FROM public.gbp_locations l
                        WHERE l.conta_id = h.conta_id AND l.location_name = h.location_name)
     LIMIT c_orphan_batch));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_orphan_gbp := v_orphan_gbp + v_n;
  DELETE FROM public.gbp_search_keywords_monthly WHERE ctid = ANY (ARRAY(
    SELECT h.ctid FROM public.gbp_search_keywords_monthly h
     WHERE NOT EXISTS (SELECT 1 FROM public.gbp_locations l
                        WHERE l.conta_id = h.conta_id AND l.location_name = h.location_name)
     LIMIT c_orphan_batch));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_orphan_gbp := v_orphan_gbp + v_n;
  DELETE FROM public.gbp_reviews WHERE ctid = ANY (ARRAY(
    SELECT h.ctid FROM public.gbp_reviews h
     WHERE NOT EXISTS (SELECT 1 FROM public.gbp_locations l
                        WHERE l.conta_id = h.conta_id AND l.location_name = h.location_name)
     LIMIT c_orphan_batch));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_orphan_gbp := v_orphan_gbp + v_n;
  DELETE FROM public.gbp_rating_daily WHERE ctid = ANY (ARRAY(
    SELECT h.ctid FROM public.gbp_rating_daily h
     WHERE NOT EXISTS (SELECT 1 FROM public.gbp_locations l
                        WHERE l.conta_id = h.conta_id AND l.location_name = h.location_name)
     LIMIT c_orphan_batch));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_orphan_gbp := v_orphan_gbp + v_n;

  RETURN QUERY SELECT v_gbp, v_yt, v_orphan_yt, v_orphan_gbp;
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

-- ============ (7) google_workspace_release_identities (BEFORE DELETE ON workspaces) ============
-- Deleting a workspace cascades google_connections away, tokens included, so without this the
-- grant would stay alive at Google. Order, all inside the deleting transaction (the workspace row
-- is already locked, so no new connection or unit can reference it meanwhile):
--   1. Every sub of the workspace is locked first, sorted, before any in-use state changes (the
--      lock rule of 20261108000003). This is the one path besides the YouTube relink that holds
--      more than one sub lock in a transaction; the fixed order keeps two workspace deletes from
--      deadlocking each other, and Postgres breaks any other cycle by aborting one side.
--   2. The workspace's channel and unit rows go (by conta_id, so disconnected units with a NULL
--      connection_id go too), so they no longer count as "in use". Their history stays for the
--      orphan pass of google_expire_units.
--   3. The workspace's own connections leave the fresh-connection grace (authorized_at moved two
--      hours back): that grace protects a picker still open in THIS workspace, which is going away.
--      Another workspace's fresh connection still keeps the sub in use.
--   4. google_release_sub per sub: _google_revoke_if_unused decides with spec 4.2's rule (revoke
--      only when no workspace still uses the identity), queues google_revocations (retried by
--      gbp-sync-cron) and deletes the sub's connections. A sub still in use elsewhere is left
--      alone, and this workspace's connection then goes with the cascade.
CREATE OR REPLACE FUNCTION public.google_workspace_release_identities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subs text[];
  v_sub text;
BEGIN
  v_subs := ARRAY(
    SELECT DISTINCT gc.google_sub FROM public.google_connections gc
     WHERE gc.conta_id = OLD.id
     ORDER BY gc.google_sub);
  IF cardinality(v_subs) = 0 THEN
    RETURN OLD;
  END IF;

  FOREACH v_sub IN ARRAY v_subs LOOP
    PERFORM pg_advisory_xact_lock(hashtext('google-sub:' || v_sub));
  END LOOP;

  DELETE FROM public.youtube_channels WHERE conta_id = OLD.id;
  DELETE FROM public.gbp_locations WHERE conta_id = OLD.id;
  UPDATE public.google_connections
     SET authorized_at = now() - interval '2 hours'
   WHERE conta_id = OLD.id AND authorized_at > now() - interval '2 hours';

  FOREACH v_sub IN ARRAY v_subs LOOP
    PERFORM 1 FROM public.google_release_sub(v_sub);
  END LOOP;

  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.google_workspace_release_identities() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspaces_google_release ON public.workspaces;
CREATE TRIGGER trg_workspaces_google_release
  BEFORE DELETE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.google_workspace_release_identities();
