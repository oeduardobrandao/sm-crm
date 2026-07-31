-- supabase/migrations/20260731000003_mensagens_consolidadas.sql
-- Consolidated client<->agency messaging: general-channel `mensagens` table,
-- per-side read markers, author identity on post_approvals, and the
-- federated-feed RPCs consumed by the CRM (RLS) and hub-mensagens (service role).
-- Spec: docs/superpowers/specs/2026-07-31-mensagens-consolidadas-design.md

-- ============ MENSAGENS (general channel, one conversation per cliente) ============
CREATE TABLE mensagens (
  id                bigserial PRIMARY KEY,
  conta_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cliente_id        bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  content           text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  is_workspace_user boolean NOT NULL DEFAULT false,
  author_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mensagens_conta_cliente_created_idx
  ON mensagens (conta_id, cliente_id, created_at DESC);

ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;

-- WITH CHECK pins cliente_id to the row's own workspace (20260728000004 pattern);
-- a plain FK alone would let a member of workspace A point at workspace B's cliente.
CREATE POLICY mensagens_tenant_all ON mensagens
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = mensagens.cliente_id AND c.conta_id = mensagens.conta_id
    )
  );

CREATE POLICY mensagens_service_role_bypass ON mensagens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ AUTHOR IDENTITY ON EXISTING POST FEEDBACK ============
-- New agency replies record who wrote them; historical rows stay NULL and
-- render as "Equipe".
ALTER TABLE post_approvals
  ADD COLUMN IF NOT EXISTS author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============ READ MARKERS ============
-- Exactly one of (user_id, cliente_id) is set:
--   user_id set    -> a CRM user's marker (covers the whole workspace feed)
--   cliente_id set -> the client side's marker (one reader entity per cliente)
CREATE TABLE mensagens_last_seen (
  id           bigserial PRIMARY KEY,
  conta_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cliente_id   bigint REFERENCES clientes(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (cliente_id IS NULL))
);

CREATE UNIQUE INDEX mensagens_last_seen_user_uq
  ON mensagens_last_seen (conta_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX mensagens_last_seen_cliente_uq
  ON mensagens_last_seen (conta_id, cliente_id) WHERE cliente_id IS NOT NULL;

-- All reads/writes go through the SECURITY DEFINER RPCs below (plus the
-- service role in the edge function), so no authenticated policy is needed.
ALTER TABLE mensagens_last_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY mensagens_last_seen_service_role_bypass ON mensagens_last_seen
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ NOTIFICATIONS: new type + trigger ============
-- Type list copied from the LATEST definition (20260730000006), plus client_message.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message'
  )
);

-- General client message -> notify owners/admins (mirrors trg_notify_post_approval).
CREATE OR REPLACE FUNCTION trg_notify_client_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.conta_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.conta_id,
      v_targets,
      'client_message',
      '/mensagens',
      jsonb_build_object(
        'client_name', v_client_name,
        'comentario',  left(NEW.content, 280),
        'cliente_id',  NEW.cliente_id
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_client_message failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_client_message ON mensagens;
CREATE TRIGGER notify_client_message
  AFTER INSERT ON mensagens
  FOR EACH ROW
  WHEN (NEW.is_workspace_user = false)
  EXECUTE FUNCTION trg_notify_client_message();

-- ============ FEED RPC ============
-- Auth model: authenticated CRM callers are scoped to get_my_conta_id()
-- (p_conta_id, if passed, must match). The service role (hub-mensagens edge
-- function, auth.uid() IS NULL) must pass p_conta_id explicitly and, for the
-- hub, always passes p_cliente_id so a client only ever sees their own thread.
-- All references inside the query are table-qualified: the RETURNS TABLE
-- column names would otherwise shadow them in plpgsql.
CREATE OR REPLACE FUNCTION get_mensagens_feed(
  p_conta_id   uuid        DEFAULT NULL,
  p_cliente_id bigint      DEFAULT NULL,
  p_before     timestamptz DEFAULT NULL,
  p_limit      int         DEFAULT 50
)
RETURNS TABLE (
  source            text,
  item_id           bigint,
  cliente_id        bigint,
  cliente_nome      text,
  post_id           bigint,
  workflow_id       bigint,
  post_titulo       text,
  action            text,
  content           text,
  is_workspace_user boolean,
  author_user_id    uuid,
  author_name       text,
  author_avatar_url text,
  created_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN
      RAISE EXCEPTION 'No active workspace';
    END IF;
    IF p_conta_id IS NOT NULL AND p_conta_id <> v_conta THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  ELSE
    IF p_conta_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id required';
    END IF;
    v_conta := p_conta_id;
  END IF;

  RETURN QUERY
  WITH feed AS (
    SELECT 'post_feedback'::text AS f_source, pa.id AS f_item_id,
           w.cliente_id AS f_cliente_id, wp.id AS f_post_id,
           wp.workflow_id AS f_workflow_id, wp.titulo AS f_post_titulo,
           pa.action AS f_action, pa.comentario AS f_content,
           pa.is_workspace_user AS f_iwu, pa.author_user_id AS f_author,
           pa.created_at AS f_created_at
      FROM post_approvals pa
      JOIN workflow_posts wp ON wp.id = pa.post_id
      JOIN workflows w ON w.id = wp.workflow_id
     WHERE w.conta_id = v_conta
    UNION ALL
    SELECT 'edit_suggestion', es.id,
           w.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           es.status, left(es.suggested_conteudo_plain, 280),
           false, NULL::uuid, es.created_at
      FROM post_edit_suggestions es
      JOIN workflow_posts wp ON wp.id = es.post_id
      JOIN workflows w ON w.id = wp.workflow_id
     WHERE es.conta_id = v_conta
    UNION ALL
    SELECT 'mensagem', m.id,
           m.cliente_id, NULL::bigint, NULL::bigint, NULL::text,
           NULL::text, m.content,
           m.is_workspace_user, m.author_user_id, m.created_at
      FROM mensagens m
     WHERE m.conta_id = v_conta
  )
  SELECT f.f_source, f.f_item_id, f.f_cliente_id, c.nome,
         f.f_post_id, f.f_workflow_id, f.f_post_titulo,
         f.f_action, f.f_content, f.f_iwu,
         f.f_author, mb.nome, mb.avatar_url,
         f.f_created_at
    FROM feed f
    JOIN clientes c ON c.id = f.f_cliente_id
    LEFT JOIN membros mb ON mb.crm_user_id = f.f_author AND mb.conta_id = v_conta
   WHERE (p_cliente_id IS NULL OR f.f_cliente_id = p_cliente_id)
     AND (p_before IS NULL OR f.f_created_at < p_before)
   ORDER BY f.f_created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_feed(uuid, bigint, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_feed(uuid, bigint, timestamptz, int)
  TO authenticated, service_role;

-- ============ UNREAD RPC ============
-- Workspace side (auth.uid() set): counts CLIENT-authored items newer than the
-- caller's single marker, grouped per cliente (the CRM sums for the nav badge
-- and uses per-cliente rows for filter chips).
-- Client side (service role): single row for the cliente, counting
-- WORKSPACE-authored items newer than the cliente marker.
CREATE OR REPLACE FUNCTION get_mensagens_unread(
  p_conta_id   uuid   DEFAULT NULL,
  p_cliente_id bigint DEFAULT NULL
)
RETURNS TABLE (cliente_id bigint, unread_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_since timestamptz;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN RETURN; END IF;

    SELECT ls.last_seen_at INTO v_since
      FROM mensagens_last_seen ls
     WHERE ls.conta_id = v_conta AND ls.user_id = v_uid;
    v_since := COALESCE(v_since, '-infinity'::timestamptz);

    RETURN QUERY
    SELECT f.f_cliente_id, count(*)::bigint
      FROM (
        SELECT w.cliente_id AS f_cliente_id, pa.created_at AS f_created_at
          FROM post_approvals pa
          JOIN workflow_posts wp ON wp.id = pa.post_id
          JOIN workflows w ON w.id = wp.workflow_id
         WHERE w.conta_id = v_conta AND pa.is_workspace_user = false
        UNION ALL
        SELECT w.cliente_id, es.created_at
          FROM post_edit_suggestions es
          JOIN workflow_posts wp ON wp.id = es.post_id
          JOIN workflows w ON w.id = wp.workflow_id
         WHERE es.conta_id = v_conta
        UNION ALL
        SELECT m.cliente_id, m.created_at
          FROM mensagens m
         WHERE m.conta_id = v_conta AND m.is_workspace_user = false
      ) f
     WHERE f.f_created_at > v_since
     GROUP BY f.f_cliente_id;
  ELSE
    IF p_conta_id IS NULL OR p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id and p_cliente_id required';
    END IF;

    SELECT ls.last_seen_at INTO v_since
      FROM mensagens_last_seen ls
     WHERE ls.conta_id = p_conta_id AND ls.cliente_id = p_cliente_id;
    v_since := COALESCE(v_since, '-infinity'::timestamptz);

    RETURN QUERY
    SELECT p_cliente_id, count(*)::bigint
      FROM (
        SELECT pa.created_at AS f_created_at
          FROM post_approvals pa
          JOIN workflow_posts wp ON wp.id = pa.post_id
          JOIN workflows w ON w.id = wp.workflow_id
         WHERE w.conta_id = p_conta_id AND w.cliente_id = p_cliente_id
           AND pa.is_workspace_user = true
        UNION ALL
        SELECT m.created_at
          FROM mensagens m
         WHERE m.conta_id = p_conta_id AND m.cliente_id = p_cliente_id
           AND m.is_workspace_user = true
      ) f
     WHERE f.f_created_at > v_since;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_unread(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_unread(uuid, bigint)
  TO authenticated, service_role;

-- ============ MARK-SEEN RPC ============
CREATE OR REPLACE FUNCTION mark_mensagens_seen(
  p_conta_id   uuid   DEFAULT NULL,
  p_cliente_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid;
  v_conta uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN RETURN; END IF;
    INSERT INTO mensagens_last_seen (conta_id, user_id, last_seen_at)
    VALUES (v_conta, v_uid, now())
    ON CONFLICT (conta_id, user_id) WHERE user_id IS NOT NULL
    DO UPDATE SET last_seen_at = now();
  ELSE
    IF p_conta_id IS NULL OR p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id and p_cliente_id required';
    END IF;
    INSERT INTO mensagens_last_seen (conta_id, cliente_id, last_seen_at)
    VALUES (p_conta_id, p_cliente_id, now())
    ON CONFLICT (conta_id, cliente_id) WHERE cliente_id IS NOT NULL
    DO UPDATE SET last_seen_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mark_mensagens_seen(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_mensagens_seen(uuid, bigint)
  TO authenticated, service_role;
