-- supabase/migrations/20261025000002_post_media_notes_rpcs.sql
-- Feedback em mídia: RPCs de escrita (spec
-- docs/superpowers/specs/2026-10-22-feedback-em-midia-design.md, calls 2, 4, 5, 6).
--
-- 1. _media_note_anchor: link -> arquivo, tipo de mídia, slide atual e
--    validação da âncora (INVOKER: no CRM roda sob o RLS de quem chama)
-- 2. hub_create_media_note / hub_add_media_note_reply (Hub, service role)
-- 3. record_client_approval_with_notes: aprovação/correção do cliente e o
--    snapshot das notas abertas visíveis ao cliente, na mesma transação travada
-- 4. create_team_media_note (CRM, SECURITY INVOKER, authenticated)
-- 5. create_post_approval_notification: link abre o post (&post=)
--
-- Erros: RAISE EXCEPTION com o código como mensagem (post_not_found,
-- post_not_visible, link_not_on_post, invalid_anchor, note_not_found,
-- post_not_pending); os handlers casam com includes. pending_suggestion do
-- record_client_approval passa adiante sem mudança.
--
-- Toda RPC do Hub trava o post (SELECT ... FOR UPDATE, com conta/cliente no
-- WHERE) antes de escrever, então notas, respostas e aprovações de um mesmo
-- post se serializam e nenhum token trava post alheio.
--
-- Rollback:
--   drop function hub_create_media_note(uuid, bigint, text, bigint, bigint, numeric, real, real, text),
--     hub_add_media_note_reply(uuid, bigint, text, bigint, text),
--     record_client_approval_with_notes(bigint, uuid, text, text, text, text, text),
--     create_team_media_note(bigint, bigint, numeric, real, real, text),
--     _media_note_anchor(bigint, bigint, numeric, real, real);
--   e recriar create_post_approval_notification com o link de
--   20260830000003_avulso_notifications_folders_views.sql.

-- =====================================================================
-- 1. _media_note_anchor
-- =====================================================================
-- O cliente nunca manda file_id: manda o post_file_links.id que está vendo.
-- Slide = posição 0-based por (sort_order, id) entre os vínculos do post (a
-- mesma regra de post_media_notes_v). Tempo só em vídeo, 0..duração + 1 quando
-- a duração é conhecida (folga para o currentTime arredondado do player).
CREATE OR REPLACE FUNCTION _media_note_anchor(
  p_post_id   bigint,
  p_link_id   bigint,
  p_t_seconds numeric,
  p_x         real,
  p_y         real,
  OUT o_file_id     bigint,
  OUT o_media_kind  text,
  OUT o_slide_index int
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_duration integer;
BEGIN
  SELECT r.file_id, r.slide_index INTO o_file_id, o_slide_index
    FROM (
      SELECT pfl.id, pfl.file_id,
             (row_number() OVER (ORDER BY pfl.sort_order, pfl.id) - 1)::int AS slide_index
        FROM post_file_links pfl
       WHERE pfl.post_id = p_post_id
    ) r
   WHERE r.id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_on_post';
  END IF;

  SELECT f.kind, f.duration_seconds INTO o_media_kind, v_duration
    FROM files f WHERE f.id = o_file_id;
  IF o_media_kind IS NULL OR o_media_kind NOT IN ('image', 'video') THEN
    RAISE EXCEPTION 'invalid_anchor';
  END IF;

  IF (p_x IS NULL) <> (p_y IS NULL)
     OR (p_x IS NOT NULL AND NOT (p_x BETWEEN 0 AND 1 AND p_y BETWEEN 0 AND 1)) THEN
    RAISE EXCEPTION 'invalid_anchor';
  END IF;

  IF p_t_seconds IS NOT NULL AND (
       o_media_kind <> 'video'
       OR p_t_seconds < 0
       OR p_t_seconds >= 1000000                      -- numeric(8,2)
       OR (v_duration IS NOT NULL AND p_t_seconds > v_duration + 1)) THEN
    RAISE EXCEPTION 'invalid_anchor';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION _media_note_anchor(bigint, bigint, numeric, real, real) FROM PUBLIC, anon, authenticated;
-- authenticated: chamado por create_team_media_note (INVOKER). Só lê, sob RLS.
GRANT EXECUTE ON FUNCTION _media_note_anchor(bigint, bigint, numeric, real, real) TO authenticated, service_role;

-- =====================================================================
-- 2. Hub: nota e resposta do cliente
-- =====================================================================
-- Mesmos status de HUB_VISIBLE_STATUSES (hub-approve/handler.ts): o cliente só
-- escreve num post que consegue ver.
CREATE OR REPLACE FUNCTION hub_create_media_note(
  p_conta_id   uuid,
  p_cliente_id bigint,
  p_token      text,
  p_post_id    bigint,
  p_link_id    bigint,
  p_t_seconds  numeric,
  p_x          real,
  p_y          real,
  p_body       text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post   workflow_posts%ROWTYPE;
  v_anchor record;
  v_id     bigint;
BEGIN
  -- Posse no WHERE da trava: um token nunca trava post de outro cliente/workspace.
  SELECT * INTO v_post FROM workflow_posts
   WHERE id = p_post_id AND conta_id = p_conta_id AND cliente_id = p_cliente_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;
  -- Gêmeo de HUB_VISIBLE_STATUSES (supabase/functions/hub-approve/handler.ts): mudar os dois juntos.
  IF v_post.status NOT IN ('enviado_cliente', 'aprovado_cliente', 'correcao_cliente',
                           'agendado', 'postado', 'falha_publicacao') THEN
    RAISE EXCEPTION 'post_not_visible';
  END IF;

  v_anchor := _media_note_anchor(p_post_id, p_link_id, p_t_seconds, p_x, p_y);

  INSERT INTO post_media_notes (conta_id, post_id, file_id, slide_index_at_creation, media_kind,
                                t_seconds, x, y, visibility, author_kind, hub_token, body)
  VALUES (p_conta_id, p_post_id, v_anchor.o_file_id, v_anchor.o_slide_index, v_anchor.o_media_kind,
          p_t_seconds, p_x, p_y, 'client', 'client', p_token, p_body)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION hub_create_media_note(uuid, bigint, text, bigint, bigint, numeric, real, real, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hub_create_media_note(uuid, bigint, text, bigint, bigint, numeric, real, real, text)
  TO service_role;

-- Nota interna nunca existe para o Hub: não acha (e o trigger de reabertura
-- nunca toca uma nota interna).
CREATE OR REPLACE FUNCTION hub_add_media_note_reply(
  p_conta_id   uuid,
  p_cliente_id bigint,
  p_token      text,
  p_note_id    bigint,
  p_body       text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post_id bigint;
  v_post    workflow_posts%ROWTYPE;
  v_id      bigint;
BEGIN
  SELECT n.post_id INTO v_post_id
    FROM post_media_notes n
   WHERE n.id = p_note_id AND n.conta_id = p_conta_id AND n.visibility = 'client';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'note_not_found';
  END IF;

  -- Posse no WHERE da trava: um token nunca trava post de outro cliente/workspace.
  SELECT * INTO v_post FROM workflow_posts
   WHERE id = v_post_id AND conta_id = p_conta_id AND cliente_id = p_cliente_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'note_not_found';
  END IF;
  -- Gêmeo de HUB_VISIBLE_STATUSES (supabase/functions/hub-approve/handler.ts): mudar os dois juntos.
  IF v_post.status NOT IN ('enviado_cliente', 'aprovado_cliente', 'correcao_cliente',
                           'agendado', 'postado', 'falha_publicacao') THEN
    RAISE EXCEPTION 'post_not_visible';
  END IF;

  INSERT INTO post_media_note_replies (note_id, conta_id, author_kind, hub_token, body)
  VALUES (p_note_id, p_conta_id, 'client', p_token, p_body)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION hub_add_media_note_reply(uuid, bigint, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hub_add_media_note_reply(uuid, bigint, text, bigint, text) TO service_role;

-- =====================================================================
-- 3. record_client_approval_with_notes
-- =====================================================================
-- O snapshot (call 4 do spec) nasce na mesma transação travada da aprovação:
-- trava o post (com a posse no WHERE), revalida o status sob a trava, trava
-- todas as notas do cliente no post, abertas e resolvidas (um resolver ou
-- reabrir concorrente do CRM espera o commit ou já está refletido; respostas
-- do Hub se serializam pela trava do post) e liga ao post_approvals
-- exatamente as notas do post com visibility 'client' e status 'open'. Notas
-- internas nunca entram nem são travadas.
CREATE OR REPLACE FUNCTION record_client_approval_with_notes(
  p_post_id    bigint,
  p_conta_id   uuid,
  p_token      text,
  p_action     text,
  p_comentario text,
  p_new_status text,
  p_motivo     text DEFAULT NULL
)
RETURNS TABLE (approval_id bigint, open_note_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta    uuid;
  v_status   text;
  v_approval bigint;
  v_count    int;
BEGIN
  SELECT wp.conta_id, wp.status INTO v_conta, v_status
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = p_conta_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;
  IF v_status NOT IN ('enviado_cliente', 'correcao_cliente') THEN
    RAISE EXCEPTION 'post_not_pending';
  END IF;

  -- Trava TODA nota do cliente no post, não só as abertas: um reabrir do CRM
  -- (resolved -> open) de uma nota resolvida espera este commit, então o
  -- snapshot abaixo e o status das notas não divergem.
  PERFORM 1 FROM post_media_notes n
   WHERE n.post_id = p_post_id AND n.visibility = 'client'
   FOR UPDATE;

  v_approval := record_client_approval(p_post_id, p_token, p_action, p_comentario, false,
                                       p_new_status, p_motivo);

  INSERT INTO post_approval_media_notes (post_approval_id, note_id)
  SELECT v_approval, n.id
    FROM post_media_notes n
   WHERE n.post_id = p_post_id AND n.visibility = 'client' AND n.status = 'open';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_approval, v_count;
END;
$$;
REVOKE ALL ON FUNCTION record_client_approval_with_notes(bigint, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_client_approval_with_notes(bigint, uuid, text, text, text, text, text)
  TO service_role;

-- =====================================================================
-- 4. create_team_media_note (CRM)
-- =====================================================================
-- SECURITY INVOKER: post, vínculo e arquivo resolvidos sob o RLS de quem chama
-- (post de outro workspace = post_not_found), e o INSERT passa pela policy
-- post_media_notes_team_insert. Só nomeia as colunas do GRANT INSERT por coluna
-- de 20261025000001 (nunca status, resolved_*, datas ou hub_token).
CREATE OR REPLACE FUNCTION create_team_media_note(
  p_post_id   bigint,
  p_link_id   bigint,
  p_t_seconds numeric,
  p_x         real,
  p_y         real,
  p_body      text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta  uuid;
  v_anchor record;
  v_id     bigint;
BEGIN
  SELECT wp.conta_id INTO v_conta FROM workflow_posts wp WHERE wp.id = p_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  v_anchor := _media_note_anchor(p_post_id, p_link_id, p_t_seconds, p_x, p_y);

  INSERT INTO post_media_notes (conta_id, post_id, file_id, slide_index_at_creation, media_kind,
                                t_seconds, x, y, visibility, author_kind, author_user_id, body)
  VALUES (v_conta, p_post_id, v_anchor.o_file_id, v_anchor.o_slide_index, v_anchor.o_media_kind,
          p_t_seconds, p_x, p_y, 'internal', 'team', auth.uid(), p_body)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION create_team_media_note(bigint, bigint, numeric, real, real, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_team_media_note(bigint, bigint, numeric, real, real, text) TO authenticated;

-- =====================================================================
-- 5. create_post_approval_notification: link abre o post
-- =====================================================================
-- Corpo de 20260830000003_avulso_notifications_folders_views.sql (o último
-- CREATE OR REPLACE), mudando só o link: com fluxo, drawer + post (o CRM já lê
-- os dois juntos em EntregasPage); avulso continua só com post. Grants de
-- 20260925000001.
CREATE OR REPLACE FUNCTION create_post_approval_notification(
  p_post_id bigint,
  p_action text,
  p_comentario text DEFAULT NULL
)
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
  v_type           text;
  v_link           text;
  v_metadata       jsonb;
  v_count          integer := 0;
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
         wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

  v_type := CASE p_action
    WHEN 'aprovado' THEN 'post_approved'
    WHEN 'correcao' THEN 'post_correction'
    WHEN 'mensagem' THEN 'post_message'
    ELSE NULL
  END;

  IF v_type IS NULL THEN
    RETURN 0;
  END IF;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post_id
    ELSE '/entregas?drawer=' || v_workflow_id || '&post=' || p_post_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id
  );

  IF v_type IN ('post_correction', 'post_message') THEN
    v_metadata := v_metadata || jsonb_build_object('comentario', p_comentario);
  END IF;

  PERFORM insert_notification_batch(v_conta_id, v_targets, v_type, v_link, v_metadata, NULL);

  v_count := array_length(v_targets, 1);
  RETURN COALESCE(v_count, 0);
END;
$$;
REVOKE ALL ON FUNCTION create_post_approval_notification(bigint, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_post_approval_notification(bigint, text, text) TO service_role;
