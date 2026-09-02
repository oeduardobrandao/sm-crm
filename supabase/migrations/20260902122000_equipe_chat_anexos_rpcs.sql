-- supabase/migrations/20260902122000_equipe_chat_anexos_rpcs.sql
-- Finalize/release de anexos do chat de equipe. Padrao
-- ideia_file_insert_with_quota / automation_media_finalize: lock no
-- workspace, quota checada e cobrada NA MESMA transacao do insert; release
-- estorna simetricamente. Chamadas exclusivamente pelo service role (edge
-- function equipe-chat-media e post-media-cleanup-cron).

CREATE OR REPLACE FUNCTION equipe_chat_anexo_finalize(p jsonb)
RETURNS TABLE (
  anexo_id   bigint,
  r2_key     text,
  file_name  text,
  mime_type  text,
  size_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta    uuid   := (p->>'conta_id')::uuid;
  v_conversa bigint := (p->>'conversa_id')::bigint;
  v_by       uuid   := (p->>'created_by')::uuid;
  v_key      text   := p->>'r2_key';
  v_size     bigint := (p->>'size_bytes')::bigint;
  v_quota    bigint;
  v_used     bigint;
  v_row      equipe_mensagem_anexos;
BEGIN
  -- Prefixo da key validado server-side contra o tenant (nunca confiar no
  -- caller): impede finalize de key de outro workspace.
  IF v_key NOT LIKE 'equipe-chat/' || v_conta::text || '/%' THEN
    RAISE EXCEPTION 'invalid_key' USING errcode = 'P0001';
  END IF;
  IF v_size IS NULL OR v_size <= 0 THEN
    RAISE EXCEPTION 'invalid_size' USING errcode = 'P0001';
  END IF;
  -- Conversa do workspace + criador participante (a edge ja checou; aqui e o
  -- cinto de seguranca transacional).
  IF NOT EXISTS (
    SELECT 1 FROM equipe_conversas ec
     WHERE ec.id = v_conversa AND ec.conta_id = v_conta
  ) OR NOT EXISTS (
    SELECT 1 FROM equipe_conversa_participantes pt
     WHERE pt.conversa_id = v_conversa AND pt.user_id = v_by
  ) THEN
    RAISE EXCEPTION 'conversa_not_found' USING errcode = 'P0001';
  END IF;

  -- Retry idempotente (resposta perdida): a key ja finalizada devolve a
  -- linha existente sem cobrar quota de novo.
  SELECT ax.* INTO v_row FROM equipe_mensagem_anexos ax WHERE ax.r2_key = v_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.r2_key, v_row.file_name,
                        v_row.mime_type, v_row.size_bytes;
    RETURN;
  END IF;

  -- Lock serializa finalizes concorrentes do mesmo workspace (quota correta).
  SELECT w.storage_used_bytes INTO v_used FROM workspaces w
   WHERE w.id = v_conta FOR UPDATE;
  v_quota := effective_plan_limit(v_conta, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND COALESCE(v_used, 0) + v_size > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded' USING errcode = 'P0001';
  END IF;

  INSERT INTO equipe_mensagem_anexos
    (conta_id, conversa_id, mensagem_id, r2_key, file_name, mime_type, size_bytes, created_by)
  VALUES
    (v_conta, v_conversa, NULL, v_key, p->>'file_name', p->>'mime_type', v_size, v_by)
  RETURNING equipe_mensagem_anexos.* INTO v_row;

  UPDATE workspaces w SET storage_used_bytes = COALESCE(w.storage_used_bytes, 0) + v_size
   WHERE w.id = v_conta;

  RETURN QUERY SELECT v_row.id, v_row.r2_key, v_row.file_name,
                      v_row.mime_type, v_row.size_bytes;
END;
$$;

-- Release de staged (cron): apaga a linha SE ainda estiver staged e estorna
-- a quota na mesma transacao. Devolve a r2_key para o caller trashear no R2,
-- ou NULL se o envio ganhou a corrida (mensagem_id preenchido) ou a linha
-- ja sumiu.
CREATE OR REPLACE FUNCTION equipe_chat_anexo_release(p_anexo_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row equipe_mensagem_anexos;
BEGIN
  DELETE FROM equipe_mensagem_anexos ax
   WHERE ax.id = p_anexo_id AND ax.mensagem_id IS NULL
  RETURNING ax.* INTO v_row;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE workspaces w
     SET storage_used_bytes = GREATEST(COALESCE(w.storage_used_bytes, 0) - v_row.size_bytes, 0)
   WHERE w.id = v_row.conta_id;
  RETURN v_row.r2_key;
END;
$$;

REVOKE ALL ON FUNCTION equipe_chat_anexo_finalize(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION equipe_chat_anexo_finalize(jsonb) TO service_role;
REVOKE ALL ON FUNCTION equipe_chat_anexo_release(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION equipe_chat_anexo_release(bigint) TO service_role;
