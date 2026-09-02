-- supabase/migrations/20260902121000_equipe_chat_rpcs.sql
-- RPCs do chat de equipe. Todas SECURITY DEFINER + SET search_path = public;
-- tenant SEMPRE derivado de get_my_conta_id() (nunca de parametro); acesso a
-- conversa SEMPRE re-validado por participacao. Colunas de RETURNS TABLE
-- sombreiam nomes - todas as referencias internas sao table-qualified.

-- ============ LISTA DE CONVERSAS ============
CREATE OR REPLACE FUNCTION get_equipe_conversas()
RETURNS TABLE (
  conversa_id         bigint,
  tipo                text,
  nome                text,
  display_nome        text,
  avatar_url          text,
  participantes_count int,
  last_author_name    text,
  last_content        text,
  last_has_anexo      boolean,
  last_created_at     timestamptz,
  last_message_id     bigint,
  unread_count        bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH minhas AS (
    SELECT ec.id AS c_id, ec.tipo AS c_tipo, ec.nome AS c_nome,
           pt.last_seen_message_id AS c_seen
      FROM equipe_conversa_participantes pt
      JOIN equipe_conversas ec ON ec.id = pt.conversa_id
     WHERE pt.user_id = v_uid AND ec.conta_id = v_conta
  ),
  outro AS (
    -- Para DMs: identidade do OUTRO participante (nome e avatar da linha).
    -- Escopado a c_tipo = 'dm': sem isso, um grupo de 3+ tambem bate no
    -- WHERE pt.user_id <> v_uid e o LEFT JOIN final fanned-out em uma linha
    -- por OUTRO participante do grupo, violando o contrato de 1 linha por
    -- conversa.
    SELECT pt.conversa_id AS c_id,
           COALESCE(mb.nome, p.nome, 'Colega') AS o_nome,
           COALESCE(mb.avatar_url, p.avatar_url) AS o_avatar
      FROM equipe_conversa_participantes pt
      JOIN minhas m ON m.c_id = pt.conversa_id AND m.c_tipo = 'dm'
      LEFT JOIN membros mb ON mb.crm_user_id = pt.user_id AND mb.conta_id = v_conta
      LEFT JOIN profiles p ON p.id = pt.user_id
     WHERE pt.user_id <> v_uid
  ),
  ultima AS (
    SELECT DISTINCT ON (em.conversa_id)
           em.conversa_id AS c_id, em.id AS m_id, em.content AS m_content,
           em.created_at AS m_created_at, em.author_user_id AS m_author
      FROM equipe_mensagens em
     WHERE em.conversa_id IN (SELECT m.c_id FROM minhas m)
     ORDER BY em.conversa_id, em.created_at DESC, em.id DESC
  ),
  nao_lidas AS (
    SELECT em.conversa_id AS c_id, count(*)::bigint AS n
      FROM equipe_mensagens em
      JOIN minhas m ON m.c_id = em.conversa_id
     WHERE em.id > m.c_seen AND em.author_user_id <> v_uid
     GROUP BY em.conversa_id
  )
  SELECT m.c_id, m.c_tipo, m.c_nome,
         CASE WHEN m.c_tipo = 'dm' THEN COALESCE(o.o_nome, 'Colega') ELSE m.c_nome END,
         CASE WHEN m.c_tipo = 'dm' THEN o.o_avatar ELSE NULL END,
         (SELECT count(*)::int FROM equipe_conversa_participantes pt2
           WHERE pt2.conversa_id = m.c_id),
         COALESCE(mb2.nome, p2.nome, 'Equipe'),
         u.m_content,
         EXISTS (SELECT 1 FROM equipe_mensagem_anexos ax
                  WHERE ax.mensagem_id = u.m_id),
         u.m_created_at,
         u.m_id,
         COALESCE(nl.n, 0)
    FROM minhas m
    LEFT JOIN outro o ON o.c_id = m.c_id
    LEFT JOIN ultima u ON u.c_id = m.c_id
    LEFT JOIN membros mb2 ON mb2.crm_user_id = u.m_author AND mb2.conta_id = v_conta
    LEFT JOIN profiles p2 ON p2.id = u.m_author
    LEFT JOIN nao_lidas nl ON nl.c_id = m.c_id
   ORDER BY u.m_created_at DESC NULLS LAST, m.c_id DESC;
END;
$$;

-- ============ FEED DE UMA CONVERSA ============
CREATE OR REPLACE FUNCTION get_equipe_mensagens(
  p_conversa_id bigint,
  p_before      timestamptz DEFAULT NULL,
  p_before_id   bigint      DEFAULT NULL,
  p_limit       int         DEFAULT 50
)
RETURNS TABLE (
  id                bigint,
  conversa_id       bigint,
  author_user_id    uuid,
  author_name       text,
  author_avatar_url text,
  content           text,
  created_at        timestamptz,
  anexos            jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL OR NOT EXISTS (
    SELECT 1 FROM equipe_conversa_participantes pt
      JOIN equipe_conversas ec ON ec.id = pt.conversa_id
     WHERE pt.conversa_id = p_conversa_id
       AND pt.user_id = v_uid AND ec.conta_id = v_conta
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT em.id, em.conversa_id, em.author_user_id,
         COALESCE(mb.nome, p.nome, 'Equipe'),
         COALESCE(mb.avatar_url, p.avatar_url),
         em.content, em.created_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', ax.id, 'file_name', ax.file_name,
                    'mime_type', ax.mime_type, 'size_bytes', ax.size_bytes)
                  ORDER BY ax.id)
             FROM equipe_mensagem_anexos ax
            WHERE ax.mensagem_id = em.id
         ), '[]'::jsonb)
    FROM equipe_mensagens em
    LEFT JOIN membros mb ON mb.crm_user_id = em.author_user_id AND mb.conta_id = v_conta
    LEFT JOIN profiles p ON p.id = em.author_user_id
   WHERE em.conversa_id = p_conversa_id
     -- Cursor keyset composto (created_at, id): now() e estavel por
     -- transacao, entao irmaos de batch compartilham created_at.
     AND (
       p_before IS NULL
       OR em.created_at < p_before
       OR (p_before_id IS NOT NULL AND em.created_at = p_before AND em.id < p_before_id)
     )
   ORDER BY em.created_at DESC, em.id DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;

-- ============ CRIAR CONVERSA ============
CREATE OR REPLACE FUNCTION create_equipe_conversa(
  p_tipo     text,
  p_nome     text,
  p_user_ids uuid[]
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_role  text;
  v_id    bigint;
  v_key   text;
  v_todos uuid[];
  v_validos int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'No active workspace';
  END IF;
  SELECT wm.role INTO v_role FROM workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_tipo = 'dm' THEN
    IF array_length(p_user_ids, 1) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'dm exige exatamente 1 destinatario';
    END IF;
    IF p_user_ids[1] = v_uid THEN
      RAISE EXCEPTION 'dm consigo mesmo nao e permitida';
    END IF;
    -- Destinatario tem que ser membro do workspace.
    IF NOT EXISTS (
      SELECT 1 FROM workspace_members wm
       WHERE wm.workspace_id = v_conta AND wm.user_id = p_user_ids[1]
    ) THEN
      RAISE EXCEPTION 'destinatario fora do workspace';
    END IF;

    v_key := least(v_uid::text, p_user_ids[1]::text) || ':' ||
             greatest(v_uid::text, p_user_ids[1]::text);
    -- Corrida de criacao simultanea: ON CONFLICT DO NOTHING + SELECT devolve
    -- a MESMA linha para os dois callers, nunca unique_violation.
    INSERT INTO equipe_conversas (conta_id, tipo, dm_key, created_by)
    VALUES (v_conta, 'dm', v_key, v_uid)
    ON CONFLICT (conta_id, dm_key) WHERE tipo = 'dm' DO NOTHING;
    SELECT ec.id INTO v_id FROM equipe_conversas ec
     WHERE ec.conta_id = v_conta AND ec.tipo = 'dm' AND ec.dm_key = v_key;
    -- Participantes idempotentes (o perdedor da corrida re-insere sem erro).
    INSERT INTO equipe_conversa_participantes (conversa_id, conta_id, user_id)
    VALUES (v_id, v_conta, v_uid), (v_id, v_conta, p_user_ids[1])
    ON CONFLICT (conversa_id, user_id) DO NOTHING;
    RETURN v_id;
  END IF;

  IF p_tipo = 'grupo' THEN
    IF v_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'apenas owner/admin cria grupos';
    END IF;
    IF p_nome IS NULL OR char_length(btrim(p_nome)) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'nome invalido';
    END IF;
    -- Criador sempre participa; dedup + valida TODOS contra workspace_members.
    SELECT array_agg(DISTINCT u) INTO v_todos
      FROM unnest(p_user_ids || v_uid) AS u;
    SELECT count(*) INTO v_validos FROM workspace_members wm
     WHERE wm.workspace_id = v_conta AND wm.user_id = ANY (v_todos);
    IF v_validos IS DISTINCT FROM array_length(v_todos, 1) THEN
      RAISE EXCEPTION 'participante fora do workspace';
    END IF;

    INSERT INTO equipe_conversas (conta_id, tipo, nome, created_by)
    VALUES (v_conta, 'grupo', btrim(p_nome), v_uid)
    RETURNING equipe_conversas.id INTO v_id;
    INSERT INTO equipe_conversa_participantes (conversa_id, conta_id, user_id)
    SELECT v_id, v_conta, u FROM unnest(v_todos) AS u;
    RETURN v_id;
  END IF;

  RAISE EXCEPTION 'tipo invalido: %', p_tipo;
END;
$$;

-- ============ GERIR CONVERSA (so grupos) ============
CREATE OR REPLACE FUNCTION manage_equipe_conversa(
  p_conversa_id bigint,
  p_action      text,
  p_nome        text DEFAULT NULL,
  p_user_id     uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_role  text;
  v_tipo  text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  SELECT ec.tipo INTO v_tipo FROM equipe_conversas ec
   WHERE ec.id = p_conversa_id AND ec.conta_id = v_conta;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'conversa nao encontrada';
  END IF;
  IF v_tipo <> 'grupo' THEN
    RAISE EXCEPTION 'dm nao tem gestao';
  END IF;
  SELECT wm.role INTO v_role FROM workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_action = 'leave' THEN
    -- Qualquer participante sai de si mesmo.
    DELETE FROM equipe_conversa_participantes pt
     WHERE pt.conversa_id = p_conversa_id AND pt.user_id = v_uid;
    RETURN;
  END IF;

  -- rename/add/remove: so owner/admin.
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'apenas owner/admin gerencia grupos';
  END IF;

  IF p_action = 'rename' THEN
    IF p_nome IS NULL OR char_length(btrim(p_nome)) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'nome invalido';
    END IF;
    UPDATE equipe_conversas ec SET nome = btrim(p_nome)
     WHERE ec.id = p_conversa_id;
  ELSIF p_action = 'add' THEN
    IF p_user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM workspace_members wm
       WHERE wm.workspace_id = v_conta AND wm.user_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'participante fora do workspace';
    END IF;
    INSERT INTO equipe_conversa_participantes (conversa_id, conta_id, user_id)
    VALUES (p_conversa_id, v_conta, p_user_id)
    ON CONFLICT (conversa_id, user_id) DO NOTHING;
  ELSIF p_action = 'remove' THEN
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'p_user_id obrigatorio';
    END IF;
    DELETE FROM equipe_conversa_participantes pt
     WHERE pt.conversa_id = p_conversa_id AND pt.user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'acao invalida: %', p_action;
  END IF;
END;
$$;

-- ============ MARK SEEN (high-water mark) ============
CREATE OR REPLACE FUNCTION mark_equipe_conversa_seen(
  p_conversa_id     bigint,
  p_last_message_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  -- GREATEST: nunca regride (dois marks fora de ordem nao "des-leem").
  UPDATE equipe_conversa_participantes pt
     SET last_seen_message_id = GREATEST(pt.last_seen_message_id, COALESCE(p_last_message_id, 0))
   WHERE pt.conversa_id = p_conversa_id
     AND pt.user_id = v_uid
     AND pt.conta_id = v_conta;
END;
$$;

-- ============ UNREAD TOTAL (badge) ============
CREATE OR REPLACE FUNCTION get_equipe_chat_unread()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid := auth.uid();
  v_n     bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN RETURN 0; END IF;
  SELECT COALESCE(sum(sub.n), 0) INTO v_n FROM (
    SELECT count(*)::bigint AS n
      FROM equipe_conversa_participantes pt
      JOIN equipe_mensagens em ON em.conversa_id = pt.conversa_id
     WHERE pt.user_id = v_uid AND pt.conta_id = v_conta
       AND em.id > pt.last_seen_message_id
       AND em.author_user_id <> v_uid
     GROUP BY pt.conversa_id
  ) sub;
  RETURN v_n;
END;
$$;

-- ============ MEMBROS DO WORKSPACE (picker) ============
CREATE OR REPLACE FUNCTION get_equipe_chat_members()
RETURNS TABLE (
  user_id    uuid,
  nome       text,
  avatar_url text,
  role       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT wm.user_id,
         COALESCE(mb.nome, p.nome,
                  u.raw_user_meta_data->>'full_name', u.email::text),
         COALESCE(mb.avatar_url, p.avatar_url),
         wm.role
    FROM workspace_members wm
    LEFT JOIN membros mb ON mb.crm_user_id = wm.user_id AND mb.conta_id = v_conta
    LEFT JOIN profiles p ON p.id = wm.user_id
    LEFT JOIN auth.users u ON u.id = wm.user_id
   WHERE wm.workspace_id = v_conta
   ORDER BY 2;
END;
$$;

-- ============ ENVIAR MENSAGEM (caminho unico do composer) ============
CREATE OR REPLACE FUNCTION send_equipe_mensagem(
  p_conversa_id bigint,
  p_content     text,
  p_anexo_ids   bigint[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta   uuid;
  v_uid     uuid := auth.uid();
  v_content text;
  v_id      bigint;
  v_linked  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;
  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL OR NOT EXISTS (
    SELECT 1 FROM equipe_conversa_participantes pt
      JOIN equipe_conversas ec ON ec.id = pt.conversa_id
     WHERE pt.conversa_id = p_conversa_id
       AND pt.user_id = v_uid AND ec.conta_id = v_conta
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  v_content := COALESCE(btrim(p_content), '');
  IF char_length(v_content) > 4000 THEN
    RAISE EXCEPTION 'content muito longo';
  END IF;
  IF v_content = '' AND (p_anexo_ids IS NULL OR array_length(p_anexo_ids, 1) IS NULL) THEN
    RAISE EXCEPTION 'texto ou anexo obrigatorio';
  END IF;

  INSERT INTO equipe_mensagens (conversa_id, conta_id, author_user_id, content)
  VALUES (p_conversa_id, v_conta, v_uid, v_content)
  RETURNING equipe_mensagens.id INTO v_id;

  IF p_anexo_ids IS NOT NULL AND array_length(p_anexo_ids, 1) IS NOT NULL THEN
    -- So liga anexos staged DO caller NESTA conversa; o lock de linha
    -- serializa contra o release do cron. Contagem diferente = algum anexo
    -- ja foi varrido ou nao e do caller: aborta tudo (rollback da mensagem).
    UPDATE equipe_mensagem_anexos ax
       SET mensagem_id = v_id
     WHERE ax.id = ANY (p_anexo_ids)
       AND ax.mensagem_id IS NULL
       AND ax.created_by = v_uid
       AND ax.conversa_id = p_conversa_id;
    GET DIAGNOSTICS v_linked = ROW_COUNT;
    IF v_linked IS DISTINCT FROM array_length(p_anexo_ids, 1) THEN
      RAISE EXCEPTION 'anexo_not_found';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ============ GRANTS ============
REVOKE ALL ON FUNCTION get_equipe_conversas() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_equipe_conversas() TO authenticated;
REVOKE ALL ON FUNCTION get_equipe_mensagens(bigint, timestamptz, bigint, int) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_equipe_mensagens(bigint, timestamptz, bigint, int) TO authenticated;
REVOKE ALL ON FUNCTION create_equipe_conversa(text, text, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_equipe_conversa(text, text, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION manage_equipe_conversa(bigint, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION manage_equipe_conversa(bigint, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION mark_equipe_conversa_seen(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mark_equipe_conversa_seen(bigint, bigint) TO authenticated;
REVOKE ALL ON FUNCTION get_equipe_chat_unread() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_equipe_chat_unread() TO authenticated;
REVOKE ALL ON FUNCTION get_equipe_chat_members() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_equipe_chat_members() TO authenticated;
REVOKE ALL ON FUNCTION send_equipe_mensagem(bigint, text, bigint[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION send_equipe_mensagem(bigint, text, bigint[]) TO authenticated, service_role;
