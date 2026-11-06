-- supabase/migrations/20261121000001_post_material_requests.sql
-- Posts aguardando material (spec
-- docs/superpowers/specs/2026-11-06-posts-aguardando-material-design.md).
--
-- 1. post_material_requests / post_material_items (tabelas, chaves, CHECKs, triggers, ACL)
-- 2. post_references.material_item_id (FK composta, índice)
-- 3. notificação post_material_complete (CHECKs + emissor), RPCs do pedido,
--    RPCs de referência redefinidas, gatilho de status

-- =====================================================================
-- 1. tabelas
-- =====================================================================
CREATE TABLE post_material_requests (
  id         bigserial PRIMARY KEY,
  post_id    bigint NOT NULL,
  conta_id   uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status     text   NOT NULL CHECK (status IN ('aberto', 'concluido', 'cancelado')),
  closed_by  text   CHECK (closed_by IN ('auto', 'client', 'team', 'system')),
  closed_at  timestamptz,
  -- Nulo de propósito: excluir o usuário não pode travar. Reescrito, junto com
  -- opened_at, a cada reabertura.
  opened_by  uuid   REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_material_requests_post_fk
    FOREIGN KEY (post_id, conta_id) REFERENCES workflow_posts(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_material_requests_post_uq UNIQUE (post_id),
  -- alvo da FK composta dos itens
  CONSTRAINT post_material_requests_id_post_conta_uq UNIQUE (id, post_id, conta_id),
  -- closed_by e closed_at são nulos se e somente se o pedido está aberto
  CONSTRAINT post_material_requests_closed_state CHECK (
    (status = 'aberto' AND closed_by IS NULL AND closed_at IS NULL) OR
    (status <> 'aberto' AND closed_by IS NOT NULL AND closed_at IS NOT NULL))
);

CREATE INDEX post_material_requests_conta_status_idx
  ON post_material_requests (conta_id, status);

CREATE TABLE post_material_items (
  id         bigserial PRIMARY KEY,
  request_id bigint NOT NULL,
  post_id    bigint NOT NULL,
  conta_id   uuid   NOT NULL,
  label      text   NOT NULL
    CONSTRAINT post_material_items_label_len CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  detail     text
    CONSTRAINT post_material_items_detail_len CHECK (detail IS NULL OR char_length(detail) <= 300),
  position   int    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- post_id e conta_id denormalizados, presos ao pedido pela FK composta
  CONSTRAINT post_material_items_request_fk
    FOREIGN KEY (request_id, post_id, conta_id)
    REFERENCES post_material_requests(id, post_id, conta_id) ON DELETE CASCADE,
  -- alvo da FK composta de post_references
  CONSTRAINT post_material_items_id_post_conta_uq UNIQUE (id, post_id, conta_id)
);

CREATE INDEX post_material_items_request_pos_idx
  ON post_material_items (request_id, position);
-- conta_id e post_id: cascatas de workspace e de post
CREATE INDEX post_material_items_post_idx ON post_material_items (post_id);
CREATE INDEX post_material_items_conta_idx ON post_material_items (conta_id);
CREATE INDEX post_material_requests_conta_idx ON post_material_requests (conta_id);

-- updated_at
CREATE OR REPLACE FUNCTION set_post_material_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION set_post_material_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER post_material_requests_updated_at
  BEFORE UPDATE ON post_material_requests
  FOR EACH ROW EXECUTE FUNCTION set_post_material_updated_at();
CREATE TRIGGER post_material_items_updated_at
  BEFORE UPDATE ON post_material_items
  FOR EACH ROW EXECUTE FUNCTION set_post_material_updated_at();

-- Só service role: RLS ligada, sem policy, sem grant para os papéis de cliente.
-- Toda leitura e escrita passa pelas edge functions (que aplicam o escopo).
ALTER TABLE post_material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_material_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON post_material_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON post_material_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON post_material_requests TO service_role;
GRANT ALL ON post_material_items TO service_role;

REVOKE ALL ON SEQUENCE post_material_requests_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE post_material_items_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE post_material_requests_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE post_material_items_id_seq TO service_role;

-- =====================================================================
-- 2. post_references.material_item_id
-- =====================================================================
ALTER TABLE post_references ADD COLUMN material_item_id bigint;

-- Postgres 15+: a lista de colunas zera só material_item_id ao apagar o item,
-- nunca post_id nem conta_id (que são NOT NULL).
ALTER TABLE post_references ADD CONSTRAINT post_references_material_item_fk
  FOREIGN KEY (material_item_id, post_id, conta_id)
  REFERENCES post_material_items(id, post_id, conta_id)
  ON DELETE SET NULL (material_item_id);

CREATE INDEX post_references_material_item_idx
  ON post_references (material_item_id) WHERE material_item_id IS NOT NULL;

COMMENT ON COLUMN post_references.material_item_id IS
  'Item do pedido de material a que este arquivo ou link responde. Apagar o item mantém a referência (material_item_id vira nulo).';

-- =====================================================================
-- 3a. notificação post_material_complete
-- =====================================================================
-- ATENCAO: listas copiadas das definicoes MAIS RECENTES no momento de escrever
-- (notifications_type_check e notification_inapp_prefs_type_check:
-- 20261104000001_tarefa_comentarios.sql) e que apenas ACRESCENTAM
-- 'post_material_complete'. notification_email_prefs_type_check e
-- claim_notification_emails NAO mudam: sem e-mail. Este arquivo passa a ser a
-- definicao mais recente das duas listas: a proxima migration copia DAQUI.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'instagram_connected_by_client',
    'post_publish_failed', 'storage_autoclean_report',
    'instagram_automation_failed',
    'event_invited', 'event_updated', 'event_cancelled', 'event_rsvp', 'event_reminder',
    'event_client_rsvp', 'event_reschedule_requested', 'event_guest_rsvp',
    'post_client_reference',
    'team_message',
    'post_discussion',
    'linha_editorial_aprovada', 'linha_editorial_ajustes',
    'task_comment',
    'post_material_complete'
  )
);

alter table notification_inapp_prefs
  drop constraint notification_inapp_prefs_type_check;
alter table notification_inapp_prefs
  add constraint notification_inapp_prefs_type_check check (type in (
    'post_approved','post_correction','post_message','post_edit_suggestion',
    'idea_submitted','briefing_answered','step_activated','step_completed',
    'post_assigned','task_assigned','workflow_completed','deadline_approaching',
    'invite_accepted','member_role_changed','member_removed','client_message',
    'mention','post_status_automation','instagram_connected_by_client',
    'post_publish_failed','storage_autoclean_report','instagram_automation_failed',
    'event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
    'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
    'post_client_reference',
    'team_message',
    'post_discussion',
    'linha_editorial_aprovada','linha_editorial_ajustes',
    'task_comment',
    'post_material_complete',
    '__all__'
  ));

-- Alvos, link e advisory lock iguais a create_post_reference_notification
-- (definição mais recente: 20261117000011_acesso_por_cliente_f_notificacoes.sql,
-- com p_cliente_id em resolve_notification_targets e insert_notification_batch),
-- SEM a coalescência de 15 minutos: dispara uma vez por fechamento. Metadata
-- leva post_id (chave do item para notification_item_visible), closed_by,
-- done e total, mais client_name/post_title/workflow_id para o texto.
CREATE OR REPLACE FUNCTION create_post_material_notification(
  p_post bigint, p_closed_by text, p_done int, p_total int)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo, wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('post_material_complete:' || p_post, 0));

  SELECT c.nome INTO v_client_name FROM clientes c WHERE c.id = v_cliente_id;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin'], v_cliente_id);

  SELECT array_agg(t) INTO v_targets
    FROM unnest(COALESCE(v_targets, '{}'::uuid[])) AS t
   WHERE t IS NOT NULL;

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post
    ELSE '/entregas?drawer=' || v_workflow_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post,
    'closed_by',   p_closed_by,
    'done',        p_done,
    'total',       p_total
  );

  PERFORM insert_notification_batch(v_conta_id, v_targets, 'post_material_complete', v_link, v_metadata, NULL, v_cliente_id);

  RETURN array_length(v_targets, 1);
END;
$$;
REVOKE ALL ON FUNCTION create_post_material_notification(bigint, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_post_material_notification(bigint, text, int, int) TO service_role;

-- =====================================================================
-- 3b. helpers internos (sem grant para ninguém; chamados só pelas RPCs
--     SECURITY DEFINER abaixo, que rodam como dono)
-- =====================================================================
-- Forma única do pedido (salvar, listagem do Hub): itens em ordem, com
-- file_count e done = file_count > 0 (nunca gravado).
CREATE OR REPLACE FUNCTION _post_material_request_json(p_request_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
           'id',        q.id,
           'post_id',   q.post_id,
           'status',    q.status,
           'closed_by', q.closed_by,
           'closed_at', q.closed_at,
           'opened_by', q.opened_by,
           'opened_at', q.opened_at,
           'items', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'id',         i.id,
                      'label',      i.label,
                      'detail',     i.detail,
                      'position',   i.position,
                      'file_count', c.n,
                      'done',       c.n > 0)
                    ORDER BY i.position, i.id)
               FROM post_material_items i
               CROSS JOIN LATERAL (
                 SELECT count(*)::int AS n FROM post_references r WHERE r.material_item_id = i.id) c
              WHERE i.request_id = q.id), '[]'::jsonb))
    FROM post_material_requests q
   WHERE q.id = p_request_id;
$$;
REVOKE ALL ON FUNCTION _post_material_request_json(bigint) FROM PUBLIC, anon, authenticated, service_role;

-- Conclusão: pedido aberto com todo item com >= 1 referência vira
-- concluido/p_closed_by. Devolve true quando fechou. p_notify = false quando
-- quem causou foi a própria equipe. Só fecha; reabrir é de quem chama
-- (salvar, remoção da equipe). O chamador já tem o lock do post.
CREATE OR REPLACE FUNCTION _post_material_complete_check(
  p_request_id bigint, p_notify boolean, p_closed_by text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req   post_material_requests;
  v_total int;
  v_done  int;
BEGIN
  SELECT * INTO v_req FROM post_material_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.status <> 'aberto' THEN
    RETURN false;
  END IF;

  SELECT count(*)::int,
         (count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM post_references r WHERE r.material_item_id = i.id)))::int
    INTO v_total, v_done
    FROM post_material_items i
   WHERE i.request_id = p_request_id;

  IF v_total = 0 OR v_done < v_total THEN
    RETURN false;
  END IF;

  UPDATE post_material_requests
     SET status = 'concluido', closed_by = p_closed_by, closed_at = now()
   WHERE id = p_request_id;

  IF p_notify THEN
    PERFORM create_post_material_notification(v_req.post_id, p_closed_by, v_done, v_total);
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION _post_material_complete_check(bigint, boolean, text) FROM PUBLIC, anon, authenticated, service_role;

-- =====================================================================
-- 3c. salvar o pedido (equipe)
-- =====================================================================
-- p_items = lista ordenada de {id?, label, detail?}. Ids fora da lista são
-- apagados (os arquivos viram referência livre pelo SET NULL), itens sem id
-- entram, os demais são atualizados. Chaves extras são ignoradas.
--   p_open = false: pedido existente vira cancelado/team (já cancelado fica
--     como está); p_items é ignorado e os itens ficam. Sem pedido: devolve
--     NULL (nada a cancelar, nenhuma linha criada).
--   p_open = true: recusa post agendado/postado/falha_publicacao; cria ou
--     reabre (reabrir reescreve opened_by/opened_at e limpa closed_*; editar
--     um pedido já aberto não troca quem abriu) e roda a conclusão SEM
--     notificar. Reabrir vale também para concluido/client: salvar de novo
--     pergunta outra vez ao cliente.
-- Limites: 1..10 itens; itens + referências que ficarão livres depois do
-- salvar (sem item, ou de item que sai da lista) <= 10; label aparado 1..120;
-- detail aparado <= 300 ('' vira NULL).
CREATE OR REPLACE FUNCTION post_material_request_save(
  p_conta uuid, p_post bigint, p_user uuid, p_open boolean, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_req    post_material_requests;
  v_n      int;
  v_el     jsonb;
  v_ord    bigint;
  v_id     bigint;
  v_label  text;
  v_detail text;
  v_ids    bigint[] := '{}';
  v_free   int;
BEGIN
  SELECT wp.status INTO v_status
    FROM workflow_posts wp
   WHERE wp.id = p_post AND wp.conta_id = p_conta
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING errcode = 'P0001'; END IF;

  SELECT * INTO v_req FROM post_material_requests q WHERE q.post_id = p_post;

  IF NOT COALESCE(p_open, false) THEN
    IF v_req.id IS NULL THEN
      RETURN NULL;
    END IF;
    IF v_req.status <> 'cancelado' THEN
      UPDATE post_material_requests
         SET status = 'cancelado', closed_by = 'team', closed_at = now()
       WHERE id = v_req.id;
    END IF;
    RETURN _post_material_request_json(v_req.id);
  END IF;

  IF v_status IN ('agendado', 'postado', 'falha_publicacao') THEN
    RAISE EXCEPTION 'post_not_requestable' USING errcode = 'P0001';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) = 'null' THEN
    RAISE EXCEPTION 'items_required' USING errcode = 'P0001';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_item' USING errcode = 'P0001';
  END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n = 0 THEN RAISE EXCEPTION 'items_required' USING errcode = 'P0001'; END IF;
  IF v_n > 10 THEN RAISE EXCEPTION 'too_many_items' USING errcode = 'P0001'; END IF;

  -- Valida tudo antes de escrever.
  FOR v_el IN SELECT e.value FROM jsonb_array_elements(p_items) e LOOP
    IF jsonb_typeof(v_el) <> 'object'
       OR jsonb_typeof(v_el->'label') IS DISTINCT FROM 'string'
       OR char_length(btrim(v_el->>'label')) NOT BETWEEN 1 AND 120
       OR COALESCE(jsonb_typeof(v_el->'detail'), 'null') NOT IN ('string', 'null')
       OR COALESCE(char_length(btrim(v_el->>'detail')), 0) > 300
       OR COALESCE(jsonb_typeof(v_el->'id'), 'null') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'invalid_item' USING errcode = 'P0001';
    END IF;
    IF jsonb_typeof(v_el->'id') = 'number' THEN
      IF (v_el->>'id') !~ '^[0-9]{1,18}$' THEN
        RAISE EXCEPTION 'invalid_item' USING errcode = 'P0001';
      END IF;
      v_id := (v_el->>'id')::bigint;
      IF v_req.id IS NULL OR v_id = ANY (v_ids) OR NOT EXISTS (
           SELECT 1 FROM post_material_items i WHERE i.id = v_id AND i.request_id = v_req.id) THEN
        RAISE EXCEPTION 'invalid_item' USING errcode = 'P0001';
      END IF;
      v_ids := v_ids || v_id;
    END IF;
  END LOOP;

  -- Cada item precisa caber pelo menos um arquivo no limite de 10 referências.
  SELECT count(*)::int INTO v_free
    FROM post_references r
   WHERE r.post_id = p_post
     AND (r.material_item_id IS NULL OR r.material_item_id <> ALL (v_ids));
  IF v_n + v_free > 10 THEN
    RAISE EXCEPTION 'too_many_items' USING errcode = 'P0001';
  END IF;

  IF v_req.id IS NULL THEN
    INSERT INTO post_material_requests (post_id, conta_id, status, opened_by, opened_at)
    VALUES (p_post, p_conta, 'aberto', p_user, now())
    RETURNING * INTO v_req;
  ELSIF v_req.status <> 'aberto' THEN
    UPDATE post_material_requests
       SET status = 'aberto', closed_by = NULL, closed_at = NULL,
           opened_by = p_user, opened_at = now()
     WHERE id = v_req.id;
  END IF;

  DELETE FROM post_material_items i
   WHERE i.request_id = v_req.id AND i.id <> ALL (v_ids);

  FOR v_el, v_ord IN SELECT e.value, e.ord FROM jsonb_array_elements(p_items) WITH ORDINALITY e(value, ord) LOOP
    v_label  := btrim(v_el->>'label');
    v_detail := NULLIF(btrim(v_el->>'detail'), '');
    IF jsonb_typeof(v_el->'id') = 'number' THEN
      UPDATE post_material_items
         SET label = v_label, detail = v_detail, position = (v_ord - 1)::int
       WHERE id = (v_el->>'id')::bigint;
    ELSE
      INSERT INTO post_material_items (request_id, post_id, conta_id, label, detail, position)
      VALUES (v_req.id, p_post, p_conta, v_label, v_detail, (v_ord - 1)::int);
    END IF;
  END LOOP;

  PERFORM _post_material_complete_check(v_req.id, false, 'auto');
  RETURN _post_material_request_json(v_req.id);
END;
$$;
REVOKE ALL ON FUNCTION post_material_request_save(uuid, bigint, uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_material_request_save(uuid, bigint, uuid, boolean, jsonb) TO service_role;

-- =====================================================================
-- 3d. inserts de referência do Hub (corpos de 20261011000001 + item)
-- =====================================================================
-- Novo material_item_id opcional no jsonb. Ordem das checagens, depois do
-- lock do post (dono = token):
--   com item: o item tem que ser deste post (FK composta garante que o pedido
--     dele é o pedido do post), o pedido tem que estar aberto e o post fora de
--     agendado/postado/falha_publicacao (defesa extra ao gatilho); senão
--     request_closed (item apagado pela equipe ou pedido encerrado no meio).
--   sem item: post fora de enviado_cliente com pedido aberto -> item_required
--     (no rascunho o cliente só responde itens); sem pedido aberto ->
--     post_not_pending, como antes.
-- Depois do insert com item roda a conclusão (notifica, closed_by auto) na
-- mesma transação: uma chamada separada e não fatal poderia deixar todo item
-- marcado num pedido que nunca fecha. Referência livre não marca item nem
-- dispara a conclusão. Limite de 10 e cota não mudam.
CREATE OR REPLACE FUNCTION post_reference_file_insert(p jsonb)
RETURNS post_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid   := (p->>'conta_id')::uuid;
  v_cliente bigint := NULLIF(p->>'cliente_id', '')::bigint;
  v_post    bigint := (p->>'post_id')::bigint;
  v_item    bigint := NULLIF(p->>'material_item_id', '')::bigint;
  v_size    bigint := (p->>'size_bytes')::bigint;
  v_kind    text   := p->>'file_kind';
  v_key     text   := NULLIF(p->>'r2_key', '');
  v_thumb   text   := NULLIF(p->>'thumbnail_r2_key', '');
  v_status  text;
  v_req     post_material_requests;
  v_count   int;
  v_quota   bigint;
  v_used    bigint;
  v_file    files;
  v_row     post_references;
BEGIN
  -- 1. Trava o post: confere workspace + cliente do token E serializa
  --    finalizes concorrentes (limite race-safe). Mesmo lock que
  --    record_client_approval e as mudanças de status da equipe tomam.
  SELECT wp.status INTO v_status
    FROM workflow_posts wp
   WHERE wp.id = v_post AND wp.conta_id = v_conta AND wp.cliente_id = v_cliente
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING errcode = 'P0001'; END IF;

  -- 1b. Gate: enviado_cliente ou pedido de material aberto.
  SELECT * INTO v_req FROM post_material_requests q WHERE q.post_id = v_post;
  IF v_item IS NOT NULL THEN
    IF v_req.status IS DISTINCT FROM 'aberto'
       OR v_status IN ('agendado', 'postado', 'falha_publicacao')
       OR NOT EXISTS (
         SELECT 1 FROM post_material_items i
          WHERE i.id = v_item AND i.post_id = v_post AND i.conta_id = v_conta) THEN
      RAISE EXCEPTION 'request_closed' USING errcode = 'P0001';
    END IF;
  ELSIF v_status <> 'enviado_cliente' THEN
    IF v_req.status = 'aberto' THEN
      RAISE EXCEPTION 'item_required' USING errcode = 'P0001';
    END IF;
    RAISE EXCEPTION 'post_not_pending' USING errcode = 'P0001';
  END IF;

  -- 2. Limite (arquivos + links), serializado pelo lock acima.
  SELECT count(*) INTO v_count FROM post_references r WHERE r.post_id = v_post;
  IF v_count >= 10 THEN RAISE EXCEPTION 'reference_limit' USING errcode = 'P0001'; END IF;

  -- 2b. Chave nova de verdade. files.r2_key não é UNIQUE: sem isto um
  --     cliente do Hub finalizaria uma referência sobre a chave de uma
  --     mídia existente (de qualquer workspace), e o trigger de órfão
  --     apagaria depois o objeto dela no R2. Vale para as duas chaves, nas
  --     duas colunas (files_r2_key_idx, files_thumbnail_r2_key_idx).
  IF v_key IS NULL OR v_key = v_thumb OR EXISTS (
       SELECT 1 FROM files f
        WHERE f.r2_key = v_key OR f.thumbnail_r2_key = v_key
           OR f.r2_key = v_thumb OR f.thumbnail_r2_key = v_thumb) THEN
    RAISE EXCEPTION 'upload_mismatch' USING errcode = 'P0001';
  END IF;

  -- 3. Cota do plano. Trava a linha do workspace para ler used_bytes.
  SELECT w.storage_used_bytes INTO v_used FROM workspaces w WHERE w.id = v_conta FOR UPDATE;
  v_quota := effective_plan_limit(v_conta, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND COALESCE(v_used, 0) + v_size > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded' USING errcode = 'P0001';
  END IF;

  -- 4. Arquivo: fora de pastas, dono = referência, sem uploader (Hub).
  --    Vídeo nunca vai para o Stream (decisão 3).
  INSERT INTO files (
    conta_id, folder_id, r2_key, thumbnail_r2_key, name, kind, mime_type,
    size_bytes, width, height, duration_seconds, blur_data_url, uploaded_by,
    attached_to, stream_status
  ) VALUES (
    v_conta, NULL, v_key, v_thumb,
    p->>'name', v_kind, p->>'mime_type', v_size,
    NULLIF(p->>'width', '')::int, NULLIF(p->>'height', '')::int,
    NULLIF(p->>'duration_seconds', '')::int,
    NULLIF(p->>'blur_data_url', ''), NULL,
    'post_reference', CASE WHEN v_kind = 'video' THEN 'skipped' END
  ) RETURNING * INTO v_file;

  -- 5. Referência (dispara o reference_count).
  INSERT INTO post_references (post_id, conta_id, kind, file_id, note, material_item_id)
  VALUES (v_post, v_conta, 'file', v_file.id, NULLIF(p->>'note', ''), v_item)
  RETURNING * INTO v_row;

  -- 6. Cobra a cota (só o arquivo, simétrico ao reembolso).
  UPDATE workspaces SET storage_used_bytes = storage_used_bytes + v_size
   WHERE id = v_conta;

  -- 7. Conclusão automática do pedido (notifica).
  IF v_item IS NOT NULL THEN
    PERFORM _post_material_complete_check(v_req.id, true, 'auto');
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION post_reference_file_insert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_file_insert(jsonb) TO service_role;

-- Link: mesmo lock, gate, limite e conclusão. URL já validada pelo handler; a
-- CHECK post_references_url_shape é a rede de segurança.
CREATE OR REPLACE FUNCTION post_reference_link_insert(p jsonb)
RETURNS post_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid   := (p->>'conta_id')::uuid;
  v_cliente bigint := NULLIF(p->>'cliente_id', '')::bigint;
  v_post    bigint := (p->>'post_id')::bigint;
  v_item    bigint := NULLIF(p->>'material_item_id', '')::bigint;
  v_status  text;
  v_req     post_material_requests;
  v_count   int;
  v_row     post_references;
BEGIN
  SELECT wp.status INTO v_status
    FROM workflow_posts wp
   WHERE wp.id = v_post AND wp.conta_id = v_conta AND wp.cliente_id = v_cliente
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING errcode = 'P0001'; END IF;

  SELECT * INTO v_req FROM post_material_requests q WHERE q.post_id = v_post;
  IF v_item IS NOT NULL THEN
    IF v_req.status IS DISTINCT FROM 'aberto'
       OR v_status IN ('agendado', 'postado', 'falha_publicacao')
       OR NOT EXISTS (
         SELECT 1 FROM post_material_items i
          WHERE i.id = v_item AND i.post_id = v_post AND i.conta_id = v_conta) THEN
      RAISE EXCEPTION 'request_closed' USING errcode = 'P0001';
    END IF;
  ELSIF v_status <> 'enviado_cliente' THEN
    IF v_req.status = 'aberto' THEN
      RAISE EXCEPTION 'item_required' USING errcode = 'P0001';
    END IF;
    RAISE EXCEPTION 'post_not_pending' USING errcode = 'P0001';
  END IF;

  SELECT count(*) INTO v_count FROM post_references r WHERE r.post_id = v_post;
  IF v_count >= 10 THEN RAISE EXCEPTION 'reference_limit' USING errcode = 'P0001'; END IF;

  INSERT INTO post_references (post_id, conta_id, kind, url, link_title, note, material_item_id)
  VALUES (v_post, v_conta, 'link', p->>'url',
          NULLIF(p->>'link_title', ''), NULLIF(p->>'note', ''), v_item)
  RETURNING * INTO v_row;

  IF v_item IS NOT NULL THEN
    PERFORM _post_material_complete_check(v_req.id, true, 'auto');
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION post_reference_link_insert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_link_insert(jsonb) TO service_role;

-- =====================================================================
-- 3e. "Enviei o que tenho" (Hub)
-- =====================================================================
-- Exige pedido aberto e pelo menos um item com arquivo. 'not_found': post de
-- outro cliente/workspace ou sem pedido.
CREATE OR REPLACE FUNCTION post_material_client_close(p_conta uuid, p_cliente bigint, p_post bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req   post_material_requests;
  v_total int;
  v_done  int;
BEGIN
  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = p_post AND wp.conta_id = p_conta AND wp.cliente_id = p_cliente
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  SELECT * INTO v_req FROM post_material_requests q WHERE q.post_id = p_post;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_req.status <> 'aberto' THEN RETURN 'request_closed'; END IF;

  SELECT count(*)::int,
         (count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM post_references r WHERE r.material_item_id = i.id)))::int
    INTO v_total, v_done
    FROM post_material_items i
   WHERE i.request_id = v_req.id;
  IF v_done = 0 THEN RETURN 'nothing_sent'; END IF;

  UPDATE post_material_requests
     SET status = 'concluido', closed_by = 'client', closed_at = now()
   WHERE id = v_req.id;
  PERFORM create_post_material_notification(p_post, 'client', v_done, v_total);
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION post_material_client_close(uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_material_client_close(uuid, bigint, bigint) TO service_role;

-- =====================================================================
-- 3f. can_remove e lista
-- =====================================================================
-- Regra de 20261011000001 (decisão 2) OU arquivo de item com pedido aberto,
-- com o post fora de agendado/postado/falha_publicacao. Fechado o pedido, o arquivo de item
-- volta para a regra antiga: num post em enviado_cliente o cliente ainda pode
-- remover um arquivo de item de um pedido concluido (e nada o reabre).
-- client_update e client_delete chamam este predicado sob o lock do post.
CREATE OR REPLACE FUNCTION post_reference_can_remove(p_ref_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM post_references r
      JOIN workflow_posts wp ON wp.id = r.post_id AND wp.conta_id = r.conta_id
     WHERE r.id = p_ref_id
       AND wp.status = 'enviado_cliente'
       AND NOT EXISTS (
         SELECT 1 FROM post_approvals pa
          WHERE pa.post_id = r.post_id
            AND pa.is_workspace_user = true
            AND pa.created_at > r.created_at)
       AND NOT EXISTS (
         SELECT 1 FROM post_status_events e
          WHERE e.post_id = r.post_id
            AND e.source <> 'client'
            AND e.created_at > r.created_at)
  ) OR EXISTS (
    SELECT 1
      FROM post_references r
      JOIN post_material_items i ON i.id = r.material_item_id
      JOIN post_material_requests q ON q.id = i.request_id
      JOIN workflow_posts wp ON wp.id = r.post_id AND wp.conta_id = r.conta_id
     WHERE r.id = p_ref_id
       AND q.status = 'aberto'
       AND wp.status NOT IN ('agendado', 'postado', 'falha_publicacao')
  );
$$;
REVOKE ALL ON FUNCTION post_reference_can_remove(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_can_remove(bigint) TO service_role;

-- RETURNS TABLE muda (material_item_id no fim): DROP + CREATE + grant.
DROP FUNCTION post_reference_list(bigint, uuid);
CREATE FUNCTION post_reference_list(p_post_id bigint, p_conta uuid)
RETURNS TABLE (
  id bigint, kind text, file_id bigint, url text, link_title text, note text,
  post_approval_id bigint, created_at timestamptz, can_remove boolean,
  name text, mime_type text, file_kind text, size_bytes bigint, width int, height int,
  duration_seconds int, r2_key text, thumbnail_r2_key text, blur_data_url text,
  material_item_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.kind, r.file_id, r.url, r.link_title, r.note,
         r.post_approval_id, r.created_at, post_reference_can_remove(r.id),
         f.name, f.mime_type, f.kind, f.size_bytes, f.width, f.height,
         f.duration_seconds, f.r2_key, f.thumbnail_r2_key, f.blur_data_url,
         r.material_item_id
    FROM post_references r
    LEFT JOIN files f ON f.id = r.file_id AND f.conta_id = r.conta_id
   WHERE r.post_id = p_post_id
     AND r.conta_id = p_conta
   ORDER BY r.created_at, r.id;
$$;
REVOKE ALL ON FUNCTION post_reference_list(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_list(bigint, uuid) TO service_role;

-- =====================================================================
-- 3g. remoção pela equipe (CRM)
-- =====================================================================
-- Sob o lock do post. Se a referência era o último arquivo do item dela e o
-- pedido estava concluido, o pedido reabre (sem notificar, opened_* intactos):
-- o cliente é perguntado de novo e as contagens do CRM ficam certas. Post já
-- agendado/postado/falha_publicacao nunca reabre pedido. Apagar
-- referência livre nunca reabre (um pedido fechado pelo cliente já tem itens
-- vazios). 'not_found': inexistente ou de outro workspace.
CREATE OR REPLACE FUNCTION post_reference_team_delete(p_conta uuid, p_ref_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post   bigint;
  v_item   bigint;
  v_status text;
BEGIN
  SELECT r.post_id INTO v_post
    FROM post_references r
   WHERE r.id = p_ref_id AND r.conta_id = p_conta;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  SELECT wp.status INTO v_status FROM workflow_posts wp WHERE wp.id = v_post FOR UPDATE;

  -- Dispara reference_count e a limpeza de órfão (files -> R2 + cota).
  DELETE FROM post_references r
   WHERE r.id = p_ref_id AND r.conta_id = p_conta
  RETURNING r.material_item_id INTO v_item;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF v_item IS NOT NULL
     AND v_status NOT IN ('agendado', 'postado', 'falha_publicacao')
     AND NOT EXISTS (SELECT 1 FROM post_references r WHERE r.material_item_id = v_item) THEN
    UPDATE post_material_requests q
       SET status = 'aberto', closed_by = NULL, closed_at = NULL
      FROM post_material_items i
     WHERE i.id = v_item AND q.id = i.request_id AND q.status = 'concluido';
  END IF;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION post_reference_team_delete(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_reference_team_delete(uuid, bigint) TO service_role;

-- =====================================================================
-- 3h. leituras (Hub e CRM)
-- =====================================================================
-- Pedidos abertos dos posts do cliente (qualquer status do post), na forma
-- de _post_material_request_json.
CREATE OR REPLACE FUNCTION post_material_requests_for(p_conta uuid, p_cliente bigint)
RETURNS TABLE (post_id bigint, request jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT q.post_id, _post_material_request_json(q.id)
    FROM post_material_requests q
    JOIN workflow_posts wp ON wp.id = q.post_id AND wp.conta_id = q.conta_id
   WHERE q.conta_id = p_conta
     AND wp.cliente_id = p_cliente
     AND q.status = 'aberto'
   ORDER BY q.opened_at, q.id;
$$;
REVOKE ALL ON FUNCTION post_material_requests_for(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_material_requests_for(uuid, bigint) TO service_role;

-- Resumo para cards e filtro: uma linha por post listado que tem pedido
-- (qualquer status). O handler limita o tamanho de p_post_ids e o escopo.
CREATE OR REPLACE FUNCTION post_material_summary(p_conta uuid, p_post_ids bigint[])
RETURNS TABLE (post_id bigint, status text, done int, total int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT q.post_id, q.status, c.done, c.total
    FROM post_material_requests q
    CROSS JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM post_references r WHERE r.material_item_id = i.id)))::int AS done,
             count(*)::int AS total
        FROM post_material_items i
       WHERE i.request_id = q.id) c
   WHERE q.conta_id = p_conta
     AND q.post_id = ANY (p_post_ids);
$$;
REVOKE ALL ON FUNCTION post_material_summary(uuid, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_material_summary(uuid, bigint[]) TO service_role;

-- =====================================================================
-- 3i. gatilho de status
-- =====================================================================
-- Post agendado ou postado cancela o pedido aberto (cancelado/system).
-- falha_publicacao só vem desses dois, então nunca tem pedido aberto.
-- SECURITY DEFINER: o CRM muda status como authenticated, que não tem grant
-- nas tabelas do pedido.
CREATE OR REPLACE FUNCTION post_material_cancel_on_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE post_material_requests
     SET status = 'cancelado', closed_by = 'system', closed_at = now()
   WHERE post_id = NEW.id AND status = 'aberto';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION post_material_cancel_on_status() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER workflow_posts_material_cancel
  AFTER UPDATE OF status ON workflow_posts
  FOR EACH ROW
  WHEN (NEW.status IN ('agendado', 'postado') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION post_material_cancel_on_status();
