-- google_disconnect_identity: "Desconectar conta" in Configurações > Contas conectadas
-- (spec docs/superpowers/specs/2026-11-04-google-account-disconnect-design.md, section 3; parent
-- spec docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md, sections 4.2-4.6).
--
-- Removes one Google identity from one workspace in a single transaction: every YouTube channel
-- and GMN unit of the workspace on that connection is unlinked, the workspace's connection row is
-- deleted, and the grant is revoked at Google only when no other workspace still uses the
-- identity (section 4.2 rule, unchanged). Returns the unlink RPCs' (should_revoke, revocation_id)
-- contract plus the two counts, so the edge function's processUnlinkDecisionData consumes it as is.
--
-- It does NOT loop over google_unlink_youtube / google_unlink_gbp_location: each ends in
-- _google_revoke_if_unused, so an intermediate call could revoke and delete the connection while
-- units remain. Everything is inlined, in this order (do not reorder):
--   1. Tenant check: the connection must belong to p_conta_id, else P0002 (a foreign id answers
--      exactly like a missing one: no cross-tenant probe).
--   2. pg_advisory_xact_lock on the sub. One sub lock only: UNIQUE (conta_id, google_sub) means
--      every channel/unit of this workspace on this identity hangs off this one row. Lock order is
--      the documented one (advisory sub lock, then row locks), as in google_connection_upsert and
--      google_mark_revoked.
--   3. Under the lock, the connection row FOR UPDATE; gone meanwhile (a concurrent last-unlink,
--      another disconnect or the orphan sweep) -> P0002. The row lock makes a concurrent
--      channel/unit write referencing it (FK check, FOR KEY SHARE) wait and then fail on the FK.
--   3b. Consume this workspace's unconsumed Google OAuth states, so a consent tab opened before
--      the disconnect cannot reattach the account (verifyGoogleState needs consumed_at IS NULL).
--      States carry no sub, so this cancels every in-progress Google connect of the workspace.
--   4. YouTube, the per-channel unlink's purge order: delete each channel row on the connection and
--      run youtube_purge_channel(conta_id, channel_id, client_id) for it (history, report lock,
--      PDF queue, snapshot update, its audit row). Already-revoked channels go too.
--   5. GMN: lock every unit row on the connection, ALL statuses (closes the relink race with
--      handleLinkLocations' plain UPDATEs), then mark active/revoked units 'disconnected'
--      (disconnected_at kept when already set). History stays for the 30-day expiry in
--      google_expire_units; a relink within 30 days restores it. A 23514/23503 from an
--      interleaved link rolls everything back and the route answers 409 conflict.
--   6. End the fresh-connection grace for THIS workspace's row only (the picker being abandoned).
--   7. _google_revoke_if_unused(sub): unused everywhere -> queue google_revocations and delete every
--      row of the sub; in use elsewhere -> (false, NULL), nothing deleted.
--   8. Delete this workspace's row (no-op after a revoke). Safe only because of 4 and 5: no
--      channel references it (youtube_channels.connection_id is NO ACTION) and every unit still
--      referencing it is 'disconnected', so ON DELETE SET NULL passes gbp_locations_connection_check.
--   9. Return the decision and the two counts.
--
-- CLAUDE.md rule: google_connections rows are deleted only by the revocation RPCs. This function
-- is one (sub lock, section 4.2 decision through _google_revoke_if_unused, google_revocations
-- written when it revokes), and the only one that deletes the workspace's row while the identity
-- stays in use elsewhere (then no Google revoke: the grant is legitimately held by the other
-- workspace's row).
--
-- Fases seguintes (drift guard): step 4 inlines today's per-channel unlink.
--   - Phase 3 recreates google_unlink_youtube with the target/upload steps; it must recreate this
--     function with the same steps in step 4, or (preferred) extract one internal per-channel
--     helper (e.g. _google_unlink_youtube_channel, owner-only EXECUTE) that both call, keeping the
--     youtube_purge_channel call inside it.
--   - Phase 4 recreates youtube_purge_channel; it must keep the (uuid, text, bigint) signature and
--     the order histórico -> lock -> PDF queue -> update, because this function calls it by that
--     signature.
--
-- SECURITY DEFINER, EXECUTE for service_role only.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.google_disconnect_identity(p_conta_id uuid, p_connection_id uuid)
RETURNS TABLE(should_revoke boolean, revocation_id uuid,
              youtube_channels_unlinked int, gbp_locations_unlinked int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_sub text;
  v_ch record;
  v_yt int := 0;
  v_gbp int := 0;
  v_decision record;
BEGIN
  -- (1) Tenant check; a foreign id is indistinguishable from a missing one.
  SELECT gc.google_sub INTO v_sub
    FROM public.google_connections gc
   WHERE gc.id = p_connection_id AND gc.conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'google connection not found' USING ERRCODE = 'P0002';
  END IF;

  -- (2) The one sub lock (advisory first, then row locks).
  PERFORM pg_advisory_xact_lock(hashtext('google-sub:' || v_sub));

  -- (3) Re-check under the lock and hold the row.
  PERFORM 1 FROM public.google_connections gc
    WHERE gc.id = p_connection_id AND gc.conta_id = p_conta_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'google connection not found' USING ERRCODE = 'P0002';
  END IF;

  -- (3b) Cancel this workspace's in-progress Google connects (oauth_states.conta_id is text).
  UPDATE public.oauth_states
     SET consumed_at = now()
   WHERE provider = 'google' AND conta_id = p_conta_id::text AND consumed_at IS NULL;

  -- (4) YouTube: row delete, then the purge with the channel the locked DELETE returned.
  FOR v_ch IN
    DELETE FROM public.youtube_channels
     WHERE conta_id = p_conta_id AND connection_id = p_connection_id
    RETURNING channel_id, client_id
  LOOP
    PERFORM public.youtube_purge_channel(p_conta_id, v_ch.channel_id, v_ch.client_id);
    v_yt := v_yt + 1;
  END LOOP;

  -- (5) GMN: lock every unit row on this connection, whatever its status, then disconnect.
  PERFORM 1 FROM public.gbp_locations gl
    WHERE gl.connection_id = p_connection_id
    FOR UPDATE;
  UPDATE public.gbp_locations
     SET status = 'disconnected',
         disconnected_at = COALESCE(disconnected_at, now())
   WHERE conta_id = p_conta_id AND connection_id = p_connection_id
     AND status IN ('active', 'revoked');
  GET DIAGNOSTICS v_gbp = ROW_COUNT;

  -- (6) End the fresh-connection grace for this workspace's row only.
  UPDATE public.google_connections
     SET authorized_at = now() - interval '2 hours'
   WHERE id = p_connection_id AND authorized_at > now() - interval '2 hours';

  -- (7) Section 4.2 decision across every workspace.
  SELECT r.should_revoke, r.revocation_id INTO v_decision
    FROM public._google_revoke_if_unused(v_sub) r;

  -- (8) This workspace's row (no-op when step 7 revoked and deleted every row of the sub).
  DELETE FROM public.google_connections WHERE id = p_connection_id;

  -- (9)
  RETURN QUERY SELECT v_decision.should_revoke, v_decision.revocation_id, v_yt, v_gbp;
END;
$$;
REVOKE ALL ON FUNCTION public.google_disconnect_identity(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_disconnect_identity(uuid, uuid) TO service_role;
