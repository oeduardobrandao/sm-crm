-- Cartão com imagem na DM da automação comentário -> DM (generic template).
-- Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md

-- Forma do dm_media. CASE para ordem de avaliação garantida (racional do
-- validate_ig_dm_buttons, 20260819000001).
CREATE FUNCTION validate_ig_dm_media(m jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN m IS NULL THEN true
    WHEN jsonb_typeof(m) <> 'object' THEN false
    ELSE coalesce(
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k)
        <@ ARRAY['content_type', 'height', 'key', 'size_bytes', 'width']
      AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k)
        @> ARRAY['content_type', 'key', 'size_bytes']
      AND jsonb_typeof(m->'key') = 'string'
      AND m->>'key' LIKE 'automation-media/%'
      AND m->>'content_type' IN ('image/jpeg', 'image/png', 'image/gif')
      AND jsonb_typeof(m->'size_bytes') = 'number'
      AND (m->>'size_bytes')::bigint BETWEEN 1 AND 8388608
      AND (m->'width' IS NULL OR (jsonb_typeof(m->'width') = 'number' AND (m->>'width')::int > 0))
      AND (m->'height' IS NULL OR (jsonb_typeof(m->'height') = 'number' AND (m->>'height')::int > 0))
    , false)
  END
$$;

ALTER TABLE instagram_comment_automations
  ADD COLUMN dm_media jsonb,
  ADD COLUMN dm_subtitle text,
  ADD CONSTRAINT ica_dm_media_valid CHECK (validate_ig_dm_media(dm_media)),
  -- Bind de tenant: RLS protege a LINHA, não o conteúdo do JSON. Sem isto, um
  -- usuário autenticado apontaria a própria automação para a key de OUTRA
  -- workspace e o envio (service role) pré-assinaria o objeto alheio.
  ADD CONSTRAINT ica_dm_media_tenant CHECK (
    dm_media IS NULL
    OR (dm_media->>'key') LIKE 'automation-media/' || conta_id::text || '/%'
  ),
  -- Subtítulo só existe com mídia; 1..80 após btrim.
  ADD CONSTRAINT ica_dm_subtitle_with_media CHECK (
    dm_subtitle IS NULL
    OR (dm_media IS NOT NULL AND char_length(btrim(dm_subtitle)) BETWEEN 1 AND 80)
  ),
  -- Com mídia, dm_message é o TÍTULO do cartão (limite da Meta: 80).
  ADD CONSTRAINT ica_dm_message_len_with_media CHECK (
    dm_media IS NULL OR char_length(dm_message) <= 80
  );

-- dm_kind ganha os valores do cartão. O CHECK original foi criado inline na
-- coluna (20260819000001), então o nome é o auto-gerado.
ALTER TABLE instagram_automation_sends
  DROP CONSTRAINT IF EXISTS instagram_automation_sends_dm_kind_check;
ALTER TABLE instagram_automation_sends
  ADD CONSTRAINT instagram_automation_sends_dm_kind_check CHECK (
    dm_kind IS NULL OR dm_kind IN
      ('text', 'buttons', 'buttons_fallback_text',
       'card', 'card_fallback_buttons', 'card_fallback_text')
  );

-- Quota: dm_media não tem linha própria em tabela de mídia (é jsonb), então
-- não há trigger para manter storage_used_bytes. A fonte de verdade é o
-- registro por objeto abaixo: finalize é IDEMPOTENTE por key (retry não
-- re-reserva) e o release lê o tamanho DAQUI, nunca do request (um cliente
-- não pode forjar bytes para drenar o contador). Chamadas SÓ pela function
-- automation-media (service role). Mesmo lock e mesma fonte de quota do
-- post_media_insert_with_quota (20260611150001). NUNCA criar um
-- "decrement_storage" genérico por cima (ver aviso em 20260811000002).
CREATE TABLE automation_media_objects (
  key text PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS ligado sem policies: só as RPCs SECURITY DEFINER (service role) tocam.
ALTER TABLE automation_media_objects ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION automation_media_finalize(p_conta_id uuid, p_key text, p_bytes bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used bigint;
  v_quota bigint;
BEGIN
  IF p_bytes IS NULL OR p_bytes <= 0 THEN
    RAISE EXCEPTION 'invalid_bytes';
  END IF;
  SELECT storage_used_bytes INTO v_used FROM workspaces WHERE id = p_conta_id FOR UPDATE;
  IF v_used IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;
  INSERT INTO automation_media_objects (key, conta_id, size_bytes)
    VALUES (p_key, p_conta_id, p_bytes)
    ON CONFLICT (key) DO NOTHING;
  IF NOT FOUND THEN
    -- Já finalizado (retry de cliente): idempotente, não re-reserva.
    RETURN false;
  END IF;
  v_quota := effective_plan_limit(p_conta_id, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND v_used + p_bytes > v_quota THEN
    -- O RAISE desfaz o INSERT acima na mesma transação.
    RAISE EXCEPTION 'quota_exceeded' USING errcode = 'P0001';
  END IF;
  UPDATE workspaces SET storage_used_bytes = storage_used_bytes + p_bytes
   WHERE id = p_conta_id;
  RETURN true;
END $$;

CREATE FUNCTION automation_media_release(p_conta_id uuid, p_key text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bytes bigint;
BEGIN
  DELETE FROM automation_media_objects
   WHERE key = p_key AND conta_id = p_conta_id
  RETURNING size_bytes INTO v_bytes;
  IF v_bytes IS NULL THEN
    -- Nunca finalizado, ou já liberado: no-op idempotente.
    RETURN 0;
  END IF;
  UPDATE workspaces
     SET storage_used_bytes = GREATEST(0, storage_used_bytes - v_bytes)
   WHERE id = p_conta_id;
  RETURN v_bytes;
END $$;

REVOKE ALL ON FUNCTION automation_media_finalize(uuid, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation_media_finalize(uuid, text, bigint) TO service_role;
REVOKE ALL ON FUNCTION automation_media_release(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation_media_release(uuid, text) TO service_role;
