-- MCP Apps cards: "Enviar ao cliente" from the post card (spec
-- docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md §5). The connector
-- runs with the service role, so it cannot use the CRM's RLS-guarded plain
-- UPDATE (store/posts.ts sendSelectedPostsToCliente); this is its guarded write.
--
-- p_actor is the grant's user, validated by the mcp function. Membership is
-- rechecked here against workspace_members ONLY: the MCP conta_id comes from the
-- grant, not from the user's active CRM workspace, so profiles.active_workspace_id
-- must not gate it. The send nonce is verified in TypeScript before this call
-- (EXECUTE is service_role only), which keeps the HKDF secret out of Postgres.
--
-- The actor and source are handed to record_post_status_event through the
-- transaction-local settings, so post_status_events records a workspace_user
-- send by p_actor ('mcp' would violate the source CHECK, which the trigger
-- swallows as a warning, dropping the event and the client digest).
--
-- Never raises for a post that moved: zero rows re-reads the post (scoped to
-- p_conta_id, so another workspace's post id never leaks its status) and
-- answers a code the card maps to copy.
--   sent          the post moved to enviado_cliente
--   already_sent  it is already enviado_cliente
--   approved      aprovado_cliente | agendado | postado
--   failed        falha_publicacao
--   stale         anything else, or no such post in this workspace
-- The skipped list mirrors SELECTION_SEND_SKIPPED_STATUSES (store/posts.ts).
CREATE OR REPLACE FUNCTION public.mcp_send_post_to_client(
  p_conta_id uuid,
  p_post_id bigint,
  p_expected_status text,
  p_actor uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM 1 FROM public.workspace_members
    WHERE user_id = p_actor AND workspace_id = p_conta_id
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'workspace_unavailable';
  END IF;

  PERFORM set_config('app.actor_id', p_actor::text, true);
  PERFORM set_config('app.event_source', 'workspace_user', true);

  UPDATE public.workflow_posts
     SET status = 'enviado_cliente', custom_status_id = NULL
   WHERE id = p_post_id
     AND conta_id = p_conta_id
     AND status = p_expected_status
     AND status NOT IN ('enviado_cliente', 'aprovado_cliente', 'agendado', 'postado', 'falha_publicacao');

  IF FOUND THEN
    RETURN 'sent';
  END IF;

  SELECT status INTO v_status FROM public.workflow_posts
    WHERE id = p_post_id AND conta_id = p_conta_id;

  RETURN CASE
    WHEN v_status = 'enviado_cliente' THEN 'already_sent'
    WHEN v_status IN ('aprovado_cliente', 'agendado', 'postado') THEN 'approved'
    WHEN v_status = 'falha_publicacao' THEN 'failed'
    ELSE 'stale'
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_send_post_to_client(uuid, bigint, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_send_post_to_client(uuid, bigint, text, uuid)
  TO service_role;
