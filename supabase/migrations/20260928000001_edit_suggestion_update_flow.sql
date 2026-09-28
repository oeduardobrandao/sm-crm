-- =====================================================================
-- 20260928000001_edit_suggestion_update_flow.sql
-- Hub: editar sugestão pendente (spec
-- docs/superpowers/specs/2026-09-28-hub-editar-sugestao-diff-design.md §3).
--
-- Every writer of a post's suggestion now locks in the same order:
-- workflow_posts row first, then post_edit_suggestions row. That is the
-- order the auto-reject trigger already uses (team UPDATE workflow_posts ->
-- trigger updates the suggestion), so client saves, client approvals and
-- team accepts serialize instead of racing or deadlocking.
--
-- All four functions keep their signatures; CREATE OR REPLACE keeps their
-- grants. The three service_role-only ones restate them anyway, matching
-- 20260925000001_lockdown_definer_function_grants.sql; accept_edit_suggestion
-- keeps its existing authenticated + service_role grants untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3a. upsert_edit_suggestion: lock the post and require enviado_cliente
-- in the same transaction as the upsert. Before, hub-edit-suggestion
-- checked the status in a separate query, so a team accept/reject landing
-- in between let the save recreate a pending suggestion on a post that was
-- no longer waiting for the client. Body otherwise identical to
-- 20260521000001.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_edit_suggestion(
  p_post_id                bigint,
  p_conta_id               uuid,
  p_token                  text,
  p_suggested_conteudo     jsonb,
  p_suggested_conteudo_plain text,
  p_suggested_ig_caption   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post             record;
  v_changed          text[] := '{}';
  v_result           record;
  v_is_new           boolean;
BEGIN
  SELECT conteudo, conteudo_plain, ig_caption, status, conta_id
    INTO v_post
    FROM workflow_posts
    WHERE id = p_post_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF v_post.status <> 'enviado_cliente' OR v_post.conta_id IS DISTINCT FROM p_conta_id THEN
    RAISE EXCEPTION 'post_not_pending' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_suggested_conteudo_plain, '') IS DISTINCT FROM COALESCE(v_post.conteudo_plain, '') THEN
    v_changed := array_append(v_changed, 'conteudo_plain');
  END IF;
  IF p_suggested_conteudo::text IS DISTINCT FROM v_post.conteudo::text THEN
    v_changed := array_append(v_changed, 'conteudo');
  END IF;
  IF COALESCE(p_suggested_ig_caption, '') IS DISTINCT FROM COALESCE(v_post.ig_caption, '') THEN
    v_changed := array_append(v_changed, 'ig_caption');
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    DELETE FROM post_edit_suggestions
      WHERE post_id = p_post_id AND status = 'pending';
    RETURN jsonb_build_object('action', 'deleted', 'suggestion', NULL, 'is_new', false);
  END IF;

  INSERT INTO post_edit_suggestions (
    post_id, conta_id, token,
    original_conteudo, original_conteudo_plain, original_ig_caption,
    suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption,
    changed_fields, status
  ) VALUES (
    p_post_id, p_conta_id, p_token,
    v_post.conteudo, v_post.conteudo_plain, v_post.ig_caption,
    p_suggested_conteudo, p_suggested_conteudo_plain, p_suggested_ig_caption,
    v_changed, 'pending'
  )
  ON CONFLICT (post_id) WHERE status = 'pending'
  DO UPDATE SET
    suggested_conteudo       = EXCLUDED.suggested_conteudo,
    suggested_conteudo_plain = EXCLUDED.suggested_conteudo_plain,
    suggested_ig_caption     = EXCLUDED.suggested_ig_caption,
    changed_fields           = EXCLUDED.changed_fields
  RETURNING *, (xmax = 0) AS _is_new
  INTO v_result;

  v_is_new := v_result._is_new;

  RETURN jsonb_build_object(
    'action', 'upserted',
    'is_new', v_is_new,
    'suggestion', jsonb_build_object(
      'id',                       v_result.id,
      'post_id',                  v_result.post_id,
      'suggested_conteudo',       v_result.suggested_conteudo,
      'suggested_conteudo_plain', v_result.suggested_conteudo_plain,
      'suggested_ig_caption',     v_result.suggested_ig_caption,
      'changed_fields',           v_result.changed_fields,
      'updated_at',               v_result.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- 3b. record_client_approval: a client approval or correction moves the
-- post's status, and the auto-reject trigger would then silently reject a
-- pending suggestion. Refuse it atomically (post locked, same order as the
-- upsert) instead of in a separate hub-approve query that could race a
-- concurrent save. Workspace users are not blocked. Body otherwise
-- identical to 20260925000010.
-- ---------------------------------------------------------------------
create or replace function record_client_approval(
  p_post_id           bigint,
  p_token             text,
  p_action            text,
  p_comentario        text,
  p_is_workspace_user boolean,
  p_new_status        text,
  p_motivo            text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval bigint;
begin
  perform 1 from workflow_posts where id = p_post_id for update;

  if not coalesce(p_is_workspace_user, false)
     and p_action in ('aprovado', 'correcao')
     and exists (
       select 1 from post_edit_suggestions
        where post_id = p_post_id and status = 'pending'
     )
  then
    raise exception 'pending_suggestion' using errcode = 'P0001';
  end if;

  insert into post_approvals (post_id, token, action, comentario, is_workspace_user, motivo)
  values (p_post_id, p_token, p_action, p_comentario, p_is_workspace_user, p_motivo)
  returning id into v_approval;

  perform set_config('app.event_source',     'client',         true);
  perform set_config('app.post_approval_id', v_approval::text, true);

  update workflow_posts set status = p_new_status where id = p_post_id;

  return v_approval;
end;
$$;

revoke all on function record_client_approval(bigint, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function record_client_approval(bigint, text, text, text, boolean, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 3c. create_edit_suggestion_notification: notify only while a pending row
-- exists, and say whether it is an update. The pending row is read FOR
-- SHARE: accept/reject take FOR UPDATE on it, so an in-flight resolution
-- makes this wait and then no longer match status = 'pending' (nothing is
-- sent), and a later one waits for this to commit. Locking the post would
-- not cover reject_edit_suggestion, which never locks the post. Body
-- otherwise identical to 20260830000003.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_edit_suggestion_notification(p_post_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_link           text;
  v_metadata       jsonb;
  v_count          integer := 0;
  v_updated        boolean;
BEGIN
  SELECT (s.updated_at > s.created_at)
    INTO v_updated
    FROM post_edit_suggestions s
   WHERE s.post_id = p_post_id
     AND s.status = 'pending'
     FOR SHARE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
         wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post_id
    ELSE '/entregas?drawer=' || v_workflow_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id,
    'updated',     COALESCE(v_updated, false)
  );

  PERFORM insert_notification_batch(v_conta_id, v_targets, 'post_edit_suggestion', v_link, v_metadata, NULL);

  v_count := array_length(v_targets, 1);
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION create_edit_suggestion_notification(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_edit_suggestion_notification(bigint) TO service_role;

-- ---------------------------------------------------------------------
-- 3d. accept_edit_suggestion: lock the post BEFORE the suggestion. It used
-- to lock the suggestion first and then update the post, the reverse of
-- the upsert above, so a team accept concurrent with a client save could
-- deadlock. Body otherwise identical to 20260923000001. Grants unchanged
-- (authenticated + service_role, the CRM calls it directly).
-- ---------------------------------------------------------------------
create or replace function accept_edit_suggestion(
  p_suggestion_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id    bigint;
  v_suggestion record;
begin
  select post_id into v_post_id
    from post_edit_suggestions
    where id = p_suggestion_id;

  if v_post_id is null then
    raise exception 'Suggestion not found';
  end if;

  perform 1 from workflow_posts where id = v_post_id for update;

  select * into v_suggestion
    from post_edit_suggestions
    where id = p_suggestion_id
    for update;

  if v_suggestion is null then
    raise exception 'Suggestion not found';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion is not pending (status: %)', v_suggestion.status;
  end if;

  perform set_config('app.accepting_edit_suggestion', v_suggestion.id::text, true);

  -- source is forced to 'client' (the TEXT is client-authored), while
  -- actor_user_id still resolves to auth.uid() via the content-version
  -- trigger's fallback (see 20260923000001).
  perform set_config('app.event_source', 'client', true);
  perform set_config('app.post_edit_suggestion_id', v_suggestion.id::text, true);

  update workflow_posts set
    conteudo       = coalesce(v_suggestion.suggested_conteudo, conteudo),
    conteudo_plain = coalesce(v_suggestion.suggested_conteudo_plain, conteudo_plain),
    ig_caption     = v_suggestion.suggested_ig_caption
  where id = v_suggestion.post_id;

  update post_edit_suggestions set
    status      = 'accepted',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_suggestion_id;
end;
$$;
