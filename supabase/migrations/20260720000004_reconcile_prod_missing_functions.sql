-- Reconcile prod: re-deliver functions that never recorded/applied on prod.
--
-- Prod's migration history diverged (issue #217). Two things prod is missing:
--   * the invite-security functions from 20260713000001
--   * hub_reorder_post_schedules from 20260701000001
-- This forward migration re-delivers exactly those, in their CURRENT form and
-- idempotently (CREATE OR REPLACE), so it is a safe no-op on databases that
-- already have them (e.g. staging).
--
-- DELIBERATELY EXCLUDES handle_new_user_workspace: prod already runs the current
-- version (from 20260719000002, with telefone + marketing_opt_in). Re-applying
-- 20260713000001's copy would REVERT those columns.
--
-- The post_designs-blob migrations (20260704000001 / 20260704000002) are NOT
-- re-delivered: 20260705000001_designs_first_class (applied on prod) DROPs those
-- functions and ports them into the first-class designs path — they are dead.
--
-- ⚠ REVIEW: get_my_conta_id below is the HARDENED version — it additionally
-- requires a workspace_members row for the active workspace. On prod this
-- replaces the older 20260315/20260317 definition (a stricter access check).
-- Verify on staging before prod. The accompanying history-repair runbook is in
-- the PR description / issue #217.

-- ========== get_my_conta_id (hardened) — verbatim from 20260713000001 ==========
CREATE OR REPLACE FUNCTION public.get_my_conta_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.active_workspace_id
  FROM profiles p
  WHERE p.id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM workspace_members wm
      WHERE wm.user_id = auth.uid()
        AND wm.workspace_id = p.active_workspace_id
    );
$$;

-- ========== accept_workspace_invite — verbatim from 20260713000001 ==========
CREATE OR REPLACE FUNCTION public.accept_workspace_invite(p_user_id uuid)
RETURNS TABLE (
  invite_id uuid,
  conta_id uuid,
  role text,
  email text,
  already_accepted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_conta_id uuid;
  v_invite public.invites%ROWTYPE;
BEGIN
  SELECT lower(u.email)
  INTO v_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.conta_id
  INTO v_conta_id
  FROM profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT i.*
  INTO v_invite
  FROM invites i
  WHERE lower(i.email) = v_email
    AND i.conta_id = v_conta_id
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT i.*
    INTO v_invite
    FROM invites i
    WHERE lower(i.email) = v_email
      AND i.conta_id = v_conta_id
      AND i.status = 'accepted'
      AND EXISTS (
        SELECT 1
        FROM workspace_members wm
        WHERE wm.user_id = p_user_id
          AND wm.workspace_id = i.conta_id
      )
    ORDER BY i.accepted_at DESC NULLS LAST, i.created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
    END IF;

    invite_id := v_invite.id;
    conta_id := v_invite.conta_id;
    role := v_invite.role;
    email := v_email;
    already_accepted := true;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO workspace_members (user_id, workspace_id, role)
  VALUES (p_user_id, v_invite.conta_id, v_invite.role)
  ON CONFLICT (user_id, workspace_id) DO UPDATE
  SET role = EXCLUDED.role;

  UPDATE profiles
  SET conta_id = v_invite.conta_id,
      active_workspace_id = v_invite.conta_id,
      role = v_invite.role::user_role,
      onboarding_complete = true
  WHERE id = p_user_id;

  UPDATE invites
  SET status = 'accepted',
      accepted_at = now()
  WHERE id = v_invite.id;

  invite_id := v_invite.id;
  conta_id := v_invite.conta_id;
  role := v_invite.role;
  email := v_email;
  already_accepted := false;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO service_role;

-- ========== hub_reorder_post_schedules — verbatim from 20260701000001 ==========
CREATE OR REPLACE FUNCTION hub_reorder_post_schedules(
  p_cliente_id bigint,
  p_conta_id   uuid,
  p_updates    jsonb
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
  JOIN workflows w ON w.id = wp.workflow_id
  WHERE wp.id = ANY(v_ids)
    AND w.cliente_id = p_cliente_id
    AND w.conta_id  = p_conta_id
  ORDER BY wp.id
  FOR UPDATE OF wp;

  -- Ownership: every id must resolve to a row owned by this token's client/account.
  SELECT count(*) INTO v_owned
  FROM workflow_posts wp
  JOIN workflows w ON w.id = wp.workflow_id
  WHERE wp.id = ANY(v_ids)
    AND w.cliente_id = p_cliente_id
    AND w.conta_id  = p_conta_id;
  IF v_owned <> v_count THEN
    RAISE EXCEPTION 'FORBIDDEN: post outside token scope';
  END IF;

  -- Status allowlist — reject the whole batch if any post is not reschedulable.
  SELECT array_agg(wp.id) INTO v_locked
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.status NOT IN ('enviado_cliente', 'correcao_cliente', 'aprovado_cliente', 'agendado');
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
        -- Defense-in-depth: Stories are not selectable in the preview, but if any
        -- segment already published we must not move it; otherwise drop prepared
        -- containers so the cron rebuilds them near the new time.
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
        UPDATE workflow_posts
        SET scheduled_at = v_new_at,
            instagram_container_id = CASE
              WHEN v_media_id IS NULL THEN NULL
              ELSE instagram_container_id
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

REVOKE ALL ON FUNCTION hub_reorder_post_schedules(bigint, uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION hub_reorder_post_schedules(bigint, uuid, jsonb) TO service_role;
