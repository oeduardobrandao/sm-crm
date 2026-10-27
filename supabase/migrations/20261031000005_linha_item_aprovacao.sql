-- Linha editorial: per-row client approval (spec §13,
-- docs/superpowers/specs/2026-10-26-linha-editorial-design.md).
--
-- The client approves or asks for an ajuste on each row from the Hub, then finishes the
-- review with one decision (record_linha_decision). Row state lives on the item
-- (aprovacao null = pending); only the RPCs write it, so neither column is added to the
-- authenticated INSERT/UPDATE column grants (the table-level SELECT exposes both to the CRM).
--
-- - record_linha_item_decision (new): aprovado | ajustes | pendente on one row, while the
--   linha is enviada. An ajuste's comment is a plain client comentario on the row (not
--   acao 'ajustes': deleting the row would null its item_id and turn it into a fake
--   linha-level decision). The row's chip, not the thread, shows the state.
-- - record_linha_decision: 'aprovado' refuses while a row has an ajuste
--   (itens_com_ajustes) and approves every pending row.
-- - linha_editorial_enviar: rows with an ajuste come back as pending; approved rows keep
--   their approval (an agency edit never resets it either).
-- - create_linha_notification: metadata gains itens_ajustes.
--
-- Bodies of the three replaced functions are copied from 20261031000002/3; only the marked
-- lines change.

SET LOCAL lock_timeout = '5s';

-- ============ (1) COLUMNS ============
ALTER TABLE public.linha_editorial_itens
  ADD COLUMN aprovacao text NULL CHECK (aprovacao IN ('aprovado', 'ajustes')),
  ADD COLUMN aprovacao_at timestamptz NULL;

-- ============ (2) record_linha_item_decision ============
-- One row's decision while the linha is enviada. Returns the linha's row counts.
CREATE OR REPLACE FUNCTION public.record_linha_item_decision(
  p_linha_id   uuid,
  p_item_id    uuid,
  p_conta_id   uuid,
  p_cliente_id bigint,
  p_token      text,
  p_acao       text,
  p_comentario text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status     text;
  v_rodada     integer;
  v_comentario text := nullif(btrim(p_comentario), '');
  v_novo       text;
  v_counts     jsonb;
BEGIN
  IF p_conta_id IS NULL OR NOT public.effective_plan_feature(p_conta_id, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;
  IF p_acao IS NULL OR p_acao NOT IN ('aprovado', 'ajustes', 'pendente') THEN
    RAISE EXCEPTION 'acao_invalida' USING ERRCODE = 'P0001';
  END IF;

  -- FOR SHARE: row decisions run in parallel, but wait for a finish (FOR UPDATE) in flight.
  SELECT l.status, l.rodada INTO v_status, v_rodada
    FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = p_conta_id AND l.cliente_id = p_cliente_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.linha_editorial_itens i
   WHERE i.id = p_item_id AND i.linha_id = p_linha_id
   FOR UPDATE;
  IF p_item_id IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'enviada' THEN
    RAISE EXCEPTION 'status_invalido' USING ERRCODE = 'P0001';
  END IF;

  IF p_acao = 'ajustes' THEN
    IF v_comentario IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.linha_editorial_respostas r
                        WHERE r.linha_id = p_linha_id AND r.item_id = p_item_id AND r.rodada = v_rodada
                          AND NOT r.is_workspace_user AND nullif(btrim(r.comentario), '') IS NOT NULL) THEN
      RAISE EXCEPTION 'comentario_obrigatorio' USING ERRCODE = 'P0001';
    END IF;
    IF v_comentario IS NOT NULL THEN
      INSERT INTO public.linha_editorial_respostas
        (conta_id, linha_id, item_id, acao, comentario, is_workspace_user, author_user_id, token)
      VALUES (p_conta_id, p_linha_id, p_item_id, 'comentario', v_comentario, false, NULL, p_token);
    END IF;
  END IF;

  v_novo := CASE p_acao WHEN 'pendente' THEN NULL ELSE p_acao END;
  UPDATE public.linha_editorial_itens
     SET aprovacao = v_novo,
         aprovacao_at = CASE WHEN v_novo IS NULL THEN NULL ELSE now() END
   WHERE id = p_item_id;

  SELECT jsonb_build_object(
           'aprovados', count(*) FILTER (WHERE i.aprovacao = 'aprovado'),
           'ajustes',   count(*) FILTER (WHERE i.aprovacao = 'ajustes'),
           'pendentes', count(*) FILTER (WHERE i.aprovacao IS NULL))
    INTO v_counts
    FROM public.linha_editorial_itens i
   WHERE i.linha_id = p_linha_id;

  RETURN v_counts;
END;
$$;

-- ============ (3) record_linha_decision ============
-- Copied from 20261031000003 (2). Changed: 'aprovado' refuses while a row has an ajuste and
-- approves the pending rows.
CREATE OR REPLACE FUNCTION public.record_linha_decision(
  p_linha_id   uuid,
  p_conta_id   uuid,
  p_cliente_id bigint,
  p_token      text,
  p_acao       text,
  p_comentario text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status     text;
  v_rodada     integer;
  v_comentario text := nullif(btrim(p_comentario), '');
  v_novo       text;
  v_total      integer;
BEGIN
  IF p_conta_id IS NULL OR NOT public.effective_plan_feature(p_conta_id, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;
  IF p_acao IS NULL OR p_acao NOT IN ('aprovado', 'ajustes') THEN
    RAISE EXCEPTION 'acao_invalida' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.status, l.rodada INTO v_status, v_rodada
    FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = p_conta_id AND l.cliente_id = p_cliente_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'enviada' THEN
    RAISE EXCEPTION 'status_invalido' USING ERRCODE = 'P0001';
  END IF;

  IF p_acao = 'ajustes' AND v_comentario IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.linha_editorial_respostas r
                      WHERE r.linha_id = p_linha_id AND r.rodada = v_rodada
                        AND NOT r.is_workspace_user AND nullif(btrim(r.comentario), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'comentario_obrigatorio' USING ERRCODE = 'P0001';
  END IF;

  -- (new) Approving the linha approves its pending rows; a row with an ajuste blocks it.
  IF p_acao = 'aprovado' THEN
    IF EXISTS (SELECT 1 FROM public.linha_editorial_itens i
                WHERE i.linha_id = p_linha_id AND i.aprovacao = 'ajustes') THEN
      RAISE EXCEPTION 'itens_com_ajustes' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.linha_editorial_itens
       SET aprovacao = 'aprovado', aprovacao_at = now()
     WHERE linha_id = p_linha_id AND aprovacao IS NULL;
  END IF;

  INSERT INTO public.linha_editorial_respostas
    (conta_id, linha_id, item_id, acao, comentario, is_workspace_user, author_user_id, token)
  VALUES (p_conta_id, p_linha_id, NULL, p_acao, v_comentario, false, NULL, p_token);

  v_novo := CASE p_acao WHEN 'aprovado' THEN 'aprovada' ELSE 'ajustes' END;
  UPDATE public.linhas_editoriais SET status = v_novo, decidida_at = now() WHERE id = p_linha_id;

  SELECT count(*) INTO v_total FROM public.linha_editorial_respostas r
   WHERE r.linha_id = p_linha_id AND r.rodada = v_rodada
     AND NOT r.is_workspace_user AND nullif(btrim(r.comentario), '') IS NOT NULL;

  RETURN jsonb_build_object('status', v_novo, 'comentarios', v_total);
END;
$$;

-- ============ (4) linha_editorial_enviar ============
-- Copied from 20261031000002 (2). Changed: rows with an ajuste come back as pending.
CREATE OR REPLACE FUNCTION public.linha_editorial_enviar(p_linha_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_status text;
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.status INTO v_status FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = v_conta
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status NOT IN ('rascunho', 'ajustes', 'aprovada') THEN
    RAISE EXCEPTION 'status_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linha_editorial_itens i WHERE i.linha_id = p_linha_id) THEN
    RAISE EXCEPTION 'linha_vazia' USING ERRCODE = 'P0001';
  END IF;

  -- (new) Approvals carry over to the next round; ajustes go back to pending.
  UPDATE public.linha_editorial_itens
     SET aprovacao = NULL, aprovacao_at = NULL
   WHERE linha_id = p_linha_id AND aprovacao = 'ajustes';

  UPDATE public.linhas_editoriais
     SET status = 'enviada', enviada_at = now(), enviada_por = auth.uid(), rodada = rodada + 1
   WHERE id = p_linha_id;
END;
$$;

-- ============ (5) create_linha_notification ============
-- Copied from 20261031000003 (4). Changed: metadata gains itens_ajustes.
CREATE OR REPLACE FUNCTION public.create_linha_notification(p_linha_id uuid, p_acao text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type    text;
  v_l       public.linhas_editoriais;
  v_nome    text;
  v_targets uuid[];
  v_total   integer;
  v_ajustes integer;
BEGIN
  v_type := CASE p_acao
    WHEN 'aprovado' THEN 'linha_editorial_aprovada'
    WHEN 'ajustes'  THEN 'linha_editorial_ajustes'
    ELSE NULL
  END;
  IF v_type IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_l FROM public.linhas_editoriais WHERE id = p_linha_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT c.nome INTO v_nome FROM public.clientes c WHERE c.id = v_l.cliente_id;

  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_targets
    FROM (
      SELECT unnest(public.resolve_notification_targets(v_l.conta_id, NULL, ARRAY['owner', 'admin'])) AS u
      UNION
      SELECT wm.user_id FROM public.workspace_members wm
       WHERE wm.workspace_id = v_l.conta_id AND wm.user_id = v_l.enviada_por
    ) t
   WHERE u IS NOT NULL;

  SELECT count(*) INTO v_total FROM public.linha_editorial_respostas r
   WHERE r.linha_id = p_linha_id AND r.rodada = v_l.rodada
     AND NOT r.is_workspace_user AND nullif(btrim(r.comentario), '') IS NOT NULL;

  -- (new)
  SELECT count(*) INTO v_ajustes FROM public.linha_editorial_itens i
   WHERE i.linha_id = p_linha_id AND i.aprovacao = 'ajustes';

  PERFORM public.insert_notification_batch(
    v_l.conta_id,
    v_targets,
    v_type,
    '/entregas?view=linha&clientes=' || v_l.cliente_id || '&mes=' || to_char(v_l.periodo, 'YYYY-MM'),
    jsonb_build_object(
      'linha_id',      v_l.id,
      'cliente_id',    v_l.cliente_id,
      'cliente_nome',  v_nome,
      'periodo',       to_char(v_l.periodo, 'YYYY-MM-DD'),
      'comentarios',   v_total,
      'itens_ajustes', v_ajustes
    ),
    NULL
  );
END;
$$;

-- ============ (6) GRANTS ============
-- CREATE OR REPLACE keeps the existing ACL of the replaced functions; the new one is
-- service_role only, per 20260925000001_lockdown_definer_function_grants.sql.
REVOKE ALL ON FUNCTION public.record_linha_item_decision(uuid, uuid, uuid, bigint, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_linha_item_decision(uuid, uuid, uuid, bigint, text, text, text) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.role_column_grants
              WHERE table_schema = 'public' AND table_name = 'linha_editorial_itens'
                AND grantee IN ('authenticated', 'anon', 'PUBLIC')
                AND privilege_type IN ('INSERT', 'UPDATE')
                AND column_name IN ('aprovacao', 'aprovacao_at')) THEN
    RAISE EXCEPTION 'linha editorial: aprovacao must be RPC-only';
  END IF;
END
$$;
