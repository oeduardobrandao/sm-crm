-- Drop old signatures that required p_user_id
DROP FUNCTION IF EXISTS accept_edit_suggestion(bigint, uuid);
DROP FUNCTION IF EXISTS reject_edit_suggestion(bigint, uuid);

-- Recreate accept_edit_suggestion using auth.uid()
CREATE OR REPLACE FUNCTION accept_edit_suggestion(
  p_suggestion_id bigint
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

  PERFORM set_config('app.accepting_edit_suggestion', v_suggestion.id::text, true);

  UPDATE workflow_posts SET
    conteudo       = COALESCE(v_suggestion.suggested_conteudo, conteudo),
    conteudo_plain = COALESCE(v_suggestion.suggested_conteudo_plain, conteudo_plain),
    ig_caption     = v_suggestion.suggested_ig_caption
  WHERE id = v_suggestion.post_id;

  UPDATE post_edit_suggestions SET
    status      = 'accepted',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  WHERE id = p_suggestion_id;
END;
$$;

REVOKE ALL ON FUNCTION accept_edit_suggestion(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_edit_suggestion(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_edit_suggestion(bigint) TO service_role;

-- Recreate reject_edit_suggestion using auth.uid()
CREATE OR REPLACE FUNCTION reject_edit_suggestion(
  p_suggestion_id bigint
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
    reviewed_by = auth.uid(),
    reviewed_at = now()
  WHERE id = p_suggestion_id;
END;
$$;

REVOKE ALL ON FUNCTION reject_edit_suggestion(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reject_edit_suggestion(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_edit_suggestion(bigint) TO service_role;
