-- RPCs over the Google connection tables of 20261107000005
-- (spec docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md, section 4.2).
--
-- google_connection_upsert: token merge from the OAuth callback. A new refresh token is a fresh
--   grant, whose scopes (sorted, distinct) replace the stored ones, so a scope unticked on
--   reconnect is no longer claimed; a NULL refresh token keeps the stored one and the scopes become
--   the sorted distinct union. Units that google_mark_revoked flipped to 'revoked' come back to
--   'active' only when the resulting scopes cover their product (R14: GMN needs business.manage,
--   YouTube all three YouTube scopes); a reconnect for one product leaves the other product's
--   units revoked, so the CRM keeps showing their reconnect banner. Disconnected units stay
--   disconnected.
-- google_connection_refresh_covers: whether the callback may trust the stored refresh token for
--   the scopes it needs (an active connection with a refresh token whose scopes contain them).
-- google_unlink_youtube / google_unlink_gbp_location: unlink one unit, then revoke the Google grant
--   when no unit in any workspace still uses that Google account. Returns (should_revoke,
--   revocation_id); the edge function revokes at Google right away and the cron retries the
--   google_revocations row on failure.
-- google_mark_revoked: invalid_grant on refresh. Idempotent and never touches refresh_lock_at,
--   because _shared/google.ts calls it while holding that lock and releases the lock itself.
--
-- Concurrency: every path that decides or changes whether a Google account (sub) is in use takes
-- pg_advisory_xact_lock(hashtext('google-sub:' || sub)) BEFORE reading the "in use" state. Two
-- concurrent last-unlinks in different workspaces therefore serialize: the second one waits, then
-- (READ COMMITTED, fresh snapshot per statement) sees the first one's unlink and revokes exactly
-- once. The upsert takes the same lock so a reconnect cannot interleave with a revocation.
--
-- Fresh-connection grace (controller ruling R10): a connection authorized in the last hour keeps
-- its sub "in use" even with no unit yet. That is the window between the callback's upsert and the
-- channel insert, and the whole GMN unit picker; a last-unlink of the same sub in that window must
-- not delete the fresh connection and revoke the grant. The grace reads google_connections.
-- authorized_at, which only the upsert writes. It cannot read updated_at: the BEFORE UPDATE trigger
-- bumps that on every token refresh and refresh-lock claim (_shared/google.ts) and on
-- google_mark_revoked, so any connection used in the last hour would never be revoked.
--
-- All public RPCs are SECURITY DEFINER for service_role only. _google_revoke_if_unused is an
-- internal helper executable by its owner alone (the DEFINER callers run as the owner).

SET LOCAL lock_timeout = '5s';

-- ============ (0) authorized_at: last OAuth authorization, written only by the upsert ============
ALTER TABLE public.google_connections
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz NOT NULL DEFAULT now();

-- ============ (1) google_connection_upsert ============
CREATE OR REPLACE FUNCTION public.google_connection_upsert(
  p_conta_id uuid,
  p_sub text,
  p_email text,
  p_display_name text,
  p_access_enc text,
  p_refresh_enc text,
  p_expires_at timestamptz,
  p_scopes text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_scopes text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('google-sub:' || p_sub));

  INSERT INTO public.google_connections AS gc (
    conta_id, google_sub, email, display_name, encrypted_access_token, encrypted_refresh_token,
    access_token_expires_at, scopes, status
  )
  VALUES (
    p_conta_id, p_sub, p_email, p_display_name, p_access_enc, p_refresh_enc, p_expires_at,
    COALESCE((SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(p_scopes) s), '{}'),
    'active'
  )
  ON CONFLICT (conta_id, google_sub) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    encrypted_access_token = EXCLUDED.encrypted_access_token,
    encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, gc.encrypted_refresh_token),
    access_token_expires_at = EXCLUDED.access_token_expires_at,
    -- EXCLUDED.scopes is already sorted, distinct and non-null (the VALUES expression above).
    scopes = CASE
      WHEN EXCLUDED.encrypted_refresh_token IS NOT NULL THEN EXCLUDED.scopes
      ELSE COALESCE(
        (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(gc.scopes || EXCLUDED.scopes) s), '{}')
    END,
    status = 'active',
    authorized_at = now()
  RETURNING gc.id, gc.scopes INTO v_id, v_scopes;

  IF v_scopes @> ARRAY['https://www.googleapis.com/auth/business.manage'] THEN
    UPDATE public.gbp_locations
       SET status = 'active', disconnected_at = NULL
     WHERE connection_id = v_id AND status = 'revoked';
  END IF;
  IF v_scopes @> ARRAY['https://www.googleapis.com/auth/youtube.upload',
                       'https://www.googleapis.com/auth/youtube.readonly',
                       'https://www.googleapis.com/auth/yt-analytics.readonly'] THEN
    UPDATE public.youtube_channels
       SET authorization_status = 'active', revoked_at = NULL
     WHERE connection_id = v_id AND authorization_status = 'revoked';
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.google_connection_upsert(uuid, text, text, text, text, text, timestamptz, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_connection_upsert(uuid, text, text, text, text, text, timestamptz, text[])
  TO service_role;

-- ============ (2) google_connection_refresh_covers ============
-- status = 'active' on top of the brief's two conditions: a revoked connection's refresh token is
-- known dead (invalid_grant), and trusting it would let the upsert's COALESCE keep that dead token
-- on a connection it marks active again. False sends the callback through the consent retry,
-- which yields a fresh refresh token.
CREATE OR REPLACE FUNCTION public.google_connection_refresh_covers(
  p_conta_id uuid,
  p_sub text,
  p_scopes text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.google_connections
     WHERE conta_id = p_conta_id
       AND google_sub = p_sub
       AND status = 'active'
       AND encrypted_refresh_token IS NOT NULL
       AND scopes @> COALESCE(p_scopes, '{}')
  );
$$;
REVOKE ALL ON FUNCTION public.google_connection_refresh_covers(uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_connection_refresh_covers(uuid, text, text[]) TO service_role;

-- ============ (3) _google_revoke_if_unused (internal) ============
-- Caller must hold the 'google-sub:' advisory lock for p_sub. VOLATILE on purpose: each statement
-- takes a fresh snapshot, so it sees what a previous lock holder committed.
-- Deletes the sub's connections in EVERY workspace (wider than spec section 4.2's "the
-- workspace's"): the grant is dead for all of them, and a stale row elsewhere would make
-- google_connection_refresh_covers lie. Disconnected units lose connection_id via ON DELETE SET
-- NULL; active/revoked units cannot exist here (they would make the sub "in use").
CREATE OR REPLACE FUNCTION public._google_revoke_if_unused(p_sub text)
RETURNS TABLE(should_revoke boolean, revocation_id uuid)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_token text;
  v_kind text;
  v_revocation_id uuid;
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.google_connections gc
        WHERE gc.google_sub = p_sub AND gc.authorized_at > now() - interval '1 hour')
     OR EXISTS (
       SELECT 1 FROM public.youtube_channels yc
         JOIN public.google_connections gc ON gc.id = yc.connection_id
        WHERE gc.google_sub = p_sub)
     OR EXISTS (
       SELECT 1 FROM public.gbp_locations gl
         JOIN public.google_connections gc ON gc.id = gl.connection_id
        WHERE gc.google_sub = p_sub AND gl.status IN ('active', 'revoked')) THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  SELECT gc.encrypted_refresh_token, 'refresh' INTO v_token, v_kind
    FROM public.google_connections gc
   WHERE gc.google_sub = p_sub AND gc.encrypted_refresh_token IS NOT NULL
   ORDER BY gc.updated_at DESC
   LIMIT 1;
  IF v_token IS NULL THEN
    SELECT gc.encrypted_access_token, 'access' INTO v_token, v_kind
      FROM public.google_connections gc
     WHERE gc.google_sub = p_sub
     ORDER BY gc.access_token_expires_at DESC
     LIMIT 1;
  END IF;
  IF v_token IS NULL THEN
    -- No connection left for this sub (already revoked by an earlier unlink).
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.google_revocations (google_sub, encrypted_token, token_kind)
    VALUES (p_sub, v_token, v_kind)
    RETURNING id INTO v_revocation_id;
  DELETE FROM public.google_connections WHERE google_sub = p_sub;

  RETURN QUERY SELECT true, v_revocation_id;
END;
$$;
REVOKE ALL ON FUNCTION public._google_revoke_if_unused(text) FROM PUBLIC, anon, authenticated, service_role;

-- ============ (4) google_unlink_youtube ============
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
    RETURNING connection_id INTO v_conn;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'youtube channel not found' USING ERRCODE = 'P0002';
  END IF;

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

-- ============ (5) google_unlink_gbp_location ============
-- A unit that is already disconnected with no connection left (its sub was revoked) is a no-op
-- returning (false, NULL): there is no sub to lock on or revoke.
CREATE OR REPLACE FUNCTION public.google_unlink_gbp_location(p_conta_id uuid, p_location_id uuid)
RETURNS TABLE(should_revoke boolean, revocation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_found boolean;
  v_sub text;
  v_conn uuid;
  v_sub_now text;
BEGIN
  SELECT true, gc.google_sub INTO v_found, v_sub
    FROM public.gbp_locations gl
    LEFT JOIN public.google_connections gc ON gc.id = gl.connection_id
   WHERE gl.id = p_location_id AND gl.conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'gbp location not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sub IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('google-sub:' || v_sub));

  UPDATE public.gbp_locations
     SET status = 'disconnected',
         disconnected_at = COALESCE(disconnected_at, now())
   WHERE id = p_location_id AND conta_id = p_conta_id
  RETURNING connection_id INTO v_conn;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'gbp location not found' USING ERRCODE = 'P0002';
  END IF;

  -- Same stale-sub guard as google_unlink_youtube: in-use check on the sub referenced now.
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
REVOKE ALL ON FUNCTION public.google_unlink_gbp_location(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_unlink_gbp_location(uuid, uuid) TO service_role;

-- ============ (6) google_mark_revoked ============
CREATE OR REPLACE FUNCTION public.google_mark_revoked(p_connection_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub text;
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
  UPDATE public.youtube_channels
     SET authorization_status = 'revoked', revoked_at = now()
   WHERE connection_id = p_connection_id AND authorization_status = 'active';
  UPDATE public.gbp_locations
     SET status = 'revoked', disconnected_at = now()
   WHERE connection_id = p_connection_id AND status = 'active';
END;
$$;
REVOKE ALL ON FUNCTION public.google_mark_revoked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_mark_revoked(uuid) TO service_role;
