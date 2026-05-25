-- ============================================================
-- post_edit_suggestions — client-suggested edits to post content
-- Clients edit text in the Hub; the team reviews diffs in the CRM.
-- ============================================================

CREATE TABLE IF NOT EXISTS post_edit_suggestions (
  id                       bigserial PRIMARY KEY,
  post_id                  bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  conta_id                 uuid NOT NULL,
  token                    text NOT NULL,

  -- Original content snapshot (captured on first suggestion creation)
  original_conteudo        jsonb,
  original_conteudo_plain  text,
  original_ig_caption      text,

  -- Suggested content from client
  suggested_conteudo       jsonb,
  suggested_conteudo_plain text,
  suggested_ig_caption     text,

  -- Which fields actually changed (derived server-side)
  changed_fields           text[] NOT NULL DEFAULT '{}',

  -- Status tracking
  status                   text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at              timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_edit_suggestions_post
  ON post_edit_suggestions(post_id);

-- Only one pending suggestion per post
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_edit_suggestions_pending
  ON post_edit_suggestions (post_id) WHERE status = 'pending';

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION set_post_edit_suggestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_edit_suggestions_updated_at ON post_edit_suggestions;
CREATE TRIGGER post_edit_suggestions_updated_at
  BEFORE UPDATE ON post_edit_suggestions
  FOR EACH ROW EXECUTE FUNCTION set_post_edit_suggestions_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE post_edit_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_edit_suggestions_all" ON post_edit_suggestions;
CREATE POLICY "workspace_edit_suggestions_all" ON post_edit_suggestions
  FOR ALL USING (
    conta_id IN (SELECT public.get_my_conta_id())
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "service_role_edit_suggestions_all" ON post_edit_suggestions;
CREATE POLICY "service_role_edit_suggestions_all" ON post_edit_suggestions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- RPC: upsert_edit_suggestion
-- Called by the hub-edit-suggestion edge function.
-- Handles the partial unique index correctly via ON CONFLICT.
-- Returns jsonb: { action, suggestion, is_new }
-- ============================================================
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
  -- Fetch current post content as the original snapshot
  SELECT conteudo, conteudo_plain, ig_caption
    INTO v_post
    FROM workflow_posts
    WHERE id = p_post_id;

  IF v_post IS NULL THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  -- Compute changed_fields by comparing suggested vs original
  IF COALESCE(p_suggested_conteudo_plain, '') IS DISTINCT FROM COALESCE(v_post.conteudo_plain, '') THEN
    v_changed := array_append(v_changed, 'conteudo_plain');
  END IF;
  IF p_suggested_conteudo::text IS DISTINCT FROM v_post.conteudo::text THEN
    v_changed := array_append(v_changed, 'conteudo');
  END IF;
  IF COALESCE(p_suggested_ig_caption, '') IS DISTINCT FROM COALESCE(v_post.ig_caption, '') THEN
    v_changed := array_append(v_changed, 'ig_caption');
  END IF;

  -- If no changes (client reverted to original), delete any pending suggestion
  IF array_length(v_changed, 1) IS NULL THEN
    DELETE FROM post_edit_suggestions
      WHERE post_id = p_post_id AND status = 'pending';
    RETURN jsonb_build_object('action', 'deleted', 'suggestion', NULL, 'is_new', false);
  END IF;

  -- Upsert: insert or update the pending suggestion
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
    -- original_* columns are NOT updated (preserve first snapshot)
    -- updated_at is handled by trigger
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

REVOKE ALL ON FUNCTION upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text) TO service_role;

-- ============================================================
-- RPC: accept_edit_suggestion
-- Atomically applies the suggested content and marks accepted.
-- ============================================================
CREATE OR REPLACE FUNCTION accept_edit_suggestion(
  p_suggestion_id bigint,
  p_user_id       uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suggestion record;
BEGIN
  -- Lock the suggestion row
  SELECT * INTO v_suggestion
    FROM post_edit_suggestions
    WHERE id = p_suggestion_id
    FOR UPDATE;

  IF v_suggestion IS NULL THEN
    RAISE EXCEPTION 'Suggestion not found';
  END IF;

  IF v_suggestion.status <> 'pending' THEN
    RAISE EXCEPTION 'Suggestion is not pending (status: %)', v_suggestion.status;
  END IF;

  -- Set flag so auto-reject trigger skips this update
  PERFORM set_config('app.accepting_edit_suggestion', v_suggestion.id::text, true);

  -- Apply suggested content to workflow_posts
  UPDATE workflow_posts SET
    conteudo       = COALESCE(v_suggestion.suggested_conteudo, conteudo),
    conteudo_plain = COALESCE(v_suggestion.suggested_conteudo_plain, conteudo_plain),
    ig_caption     = v_suggestion.suggested_ig_caption
  WHERE id = v_suggestion.post_id;

  -- Mark suggestion as accepted
  UPDATE post_edit_suggestions SET
    status      = 'accepted',
    reviewed_by = p_user_id,
    reviewed_at = now()
  WHERE id = p_suggestion_id;
END;
$$;

REVOKE ALL ON FUNCTION accept_edit_suggestion(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_edit_suggestion(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_edit_suggestion(bigint, uuid) TO service_role;

-- ============================================================
-- RPC: reject_edit_suggestion
-- ============================================================
CREATE OR REPLACE FUNCTION reject_edit_suggestion(
  p_suggestion_id bigint,
  p_user_id       uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suggestion record;
BEGIN
  SELECT * INTO v_suggestion
    FROM post_edit_suggestions
    WHERE id = p_suggestion_id
    FOR UPDATE;

  IF v_suggestion IS NULL THEN
    RAISE EXCEPTION 'Suggestion not found';
  END IF;

  IF v_suggestion.status <> 'pending' THEN
    RAISE EXCEPTION 'Suggestion is not pending (status: %)', v_suggestion.status;
  END IF;

  UPDATE post_edit_suggestions SET
    status      = 'rejected',
    reviewed_by = p_user_id,
    reviewed_at = now()
  WHERE id = p_suggestion_id;
END;
$$;

REVOKE ALL ON FUNCTION reject_edit_suggestion(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reject_edit_suggestion(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_edit_suggestion(bigint, uuid) TO service_role;

-- ============================================================
-- Trigger: auto-reject pending suggestion when team edits post
-- Fires BEFORE UPDATE on workflow_posts so the auto-reject
-- happens inside the same transaction as the team's edit.
-- ============================================================
CREATE OR REPLACE FUNCTION trg_auto_reject_pending_suggestion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip when accept_edit_suggestion RPC is applying the suggested content
  IF current_setting('app.accepting_edit_suggestion', true) IS NOT NULL
     AND current_setting('app.accepting_edit_suggestion', true) <> ''
  THEN
    RETURN NEW;
  END IF;

  IF OLD.conteudo::text IS DISTINCT FROM NEW.conteudo::text
     OR OLD.ig_caption IS DISTINCT FROM NEW.ig_caption
     OR OLD.status IS DISTINCT FROM NEW.status
  THEN
    UPDATE post_edit_suggestions
      SET status      = 'rejected',
          reviewed_at = now()
      WHERE post_id = NEW.id
        AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_reject_pending_suggestion ON workflow_posts;
CREATE TRIGGER auto_reject_pending_suggestion
  BEFORE UPDATE ON workflow_posts
  FOR EACH ROW EXECUTE FUNCTION trg_auto_reject_pending_suggestion();

-- ============================================================
-- Notification: extend type constraint + create RPC
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion'
  )
);

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
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
         w.conta_id, w.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
    JOIN workflows w ON w.id = wp.workflow_id
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := '/entregas?drawer=' || v_workflow_id;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id
  );

  PERFORM insert_notification_batch(v_conta_id, v_targets, 'post_edit_suggestion', v_link, v_metadata, NULL);

  v_count := array_length(v_targets, 1);
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION create_edit_suggestion_notification(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_edit_suggestion_notification(bigint) TO service_role;
